import { eq } from 'drizzle-orm';
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { isDuplicateKeyError } from '../../src/db/errors';
import { emails, users } from '../../src/db/schema';
import { newId } from '../../src/lib/ids';
import { EmailsRepository } from '../../src/modules/emails/emails.repository';
import { UsersRepository } from '../../src/modules/users/users.repository';
import { createTestContext } from '../helpers/context';
import { createCampaign, createSender, createUser, emailRow } from '../helpers/factories';

const ctx = createTestContext();
const repository = new EmailsRepository(ctx.db);

beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

async function oneEmail() {
  const user = await createUser(ctx.db);
  const sender = await createSender(ctx.db, ctx.secrets, { userId: user.id, smtpPort: 2525 });
  const fixture = await createCampaign(ctx.db, {
    user,
    sender,
    recipients: ['john@example.com'],
    scheduledAt: new Date(),
  });
  return fixture.emails[0]!;
}

describe('DATETIME(3) UTC round trip', () => {
  it('stores and returns the same instant although the process runs in Asia/Kolkata', async () => {
    // The integration project sets TZ=Asia/Kolkata (UTC+05:30); this guards the premise.
    expect(new Date('2026-01-01T00:00:00Z').getTimezoneOffset()).toBe(-330);
    const instant = new Date('2026-09-27T10:15:30.123Z');
    const user = await createUser(ctx.db, { createdAt: instant, lastLoginAt: instant });

    const [viaDrizzle] = await ctx.db.select().from(users).where(eq(users.id, user.id));
    const [raw] = await ctx.pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s.%f') AS wallClock, created_at AS viaDriver
       FROM users WHERE id = ?`,
      [user.id],
    );

    expect(viaDrizzle?.createdAt.toISOString()).toBe('2026-09-27T10:15:30.123Z');
    expect(raw[0]?.wallClock).toBe('2026-09-27 10:15:30.123000'); // the UTC wall clock, not IST
    expect((raw[0]?.viaDriver as Date).toISOString()).toBe('2026-09-27T10:15:30.123Z');
  });
});

describe('generated columns', () => {
  it('derive folder from status and search_dirty from the versions', async () => {
    const email = await oneEmail();
    expect(email).toMatchObject({ folder: 'scheduled', searchDirty: true, version: 1 });

    await repository.claim(email.id, newId(), new Date(Date.now() + 60_000));
    await ctx.db
      .update(emails)
      .set({ status: 'failed', indexedVersion: 2 })
      .where(eq(emails.id, email.id));

    expect(await emailRow(ctx.db, email.id)).toMatchObject({
      status: 'failed',
      folder: 'sent',
      version: 2,
      indexedVersion: 2,
      searchDirty: false,
    });
  });
});

describe('unique constraints', () => {
  it('reject a second user with the same Google subject (errno 1062)', async () => {
    await createUser(ctx.db, { googleSub: 'google-1' });

    const duplicate = createUser(ctx.db, { googleSub: 'google-1' });

    await expect(duplicate).rejects.toSatisfy((err: unknown) =>
      isDuplicateKeyError(err, 'uq_users_google_sub'),
    );
  });

  it('reject the same recipient twice in one campaign', async () => {
    const email = await oneEmail();

    const duplicate = ctx.db.insert(emails).values({
      ...email,
      id: newId(),
      seqNo: 99,
      folder: undefined,
      searchDirty: undefined,
    } as never);

    await expect(duplicate).rejects.toSatisfy((err: unknown) =>
      isDuplicateKeyError(err, 'uq_emails_campaign_recipient'),
    );
  });
});

describe('users upsert', () => {
  it('creates a user once and refreshes the profile on later logins', async () => {
    const usersRepository = new UsersRepository(ctx.db);
    const first = await usersRepository.upsertFromGoogle({
      sub: 'google-42',
      email: 'oliver@example.com',
      name: 'Oliver',
      picture: null,
    });
    const second = await usersRepository.upsertFromGoogle({
      sub: 'google-42',
      email: 'oliver@example.com',
      name: 'Oliver Brown',
      picture: 'https://lh3.googleusercontent.test/a',
    });

    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({
      name: 'Oliver Brown',
      avatarUrl: 'https://lh3.googleusercontent.test/a',
    });
    expect(await ctx.db.select().from(users)).toHaveLength(1);
  });
});

describe('email state transitions', () => {
  it('let exactly one of many concurrent claims win', async () => {
    const email = await oneEmail();
    const tokens = Array.from({ length: 10 }, () => newId());

    const results = await Promise.all(
      tokens.map((token) => repository.claim(email.id, token, new Date(Date.now() + 60_000))),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    const row = await emailRow(ctx.db, email.id);
    expect(row.claimToken).toBe(tokens[results.indexOf(true)]);
    expect(row).toMatchObject({ status: 'sending', attemptCount: 1, version: 2 });
  });

  it('only let the claim holder mark the email sent or failed', async () => {
    const email = await oneEmail();
    const token = newId();
    await repository.claim(email.id, token, new Date(Date.now() + 60_000));
    const receipt = {
      messageId: '<m@x>',
      response: '250 OK',
      previewUrl: null,
      sentAt: new Date(),
    };

    expect(await repository.markSent(email.id, newId(), receipt)).toBe(false);
    expect(await repository.markFailed(email.id, newId(), 'X', 'y')).toBe(false);
    expect(await repository.markSent(email.id, token, receipt)).toBe(true);
    expect(await repository.markSent(email.id, token, receipt)).toBe(false);

    expect(await emailRow(ctx.db, email.id)).toMatchObject({
      status: 'sent',
      folder: 'sent',
      messageId: '<m@x>',
      claimToken: null,
      leaseUntil: null,
    });
  });

  it('let a confirmed receipt override a DELIVERY_UNCERTAIN verdict', async () => {
    const email = await oneEmail();
    const token = newId();
    await repository.claim(email.id, token, new Date(Date.now() - 1_000));
    expect(await repository.markUncertainIfLeaseExpired(email.id)).toBe(true);
    expect((await emailRow(ctx.db, email.id)).errorCode).toBe('DELIVERY_UNCERTAIN');

    const receipt = {
      messageId: '<m@x>',
      response: '250 OK',
      previewUrl: null,
      sentAt: new Date(),
    };
    expect(await repository.markSent(email.id, token, receipt)).toBe(true);
    expect(await emailRow(ctx.db, email.id)).toMatchObject({ status: 'sent', errorCode: null });
  });

  it('never mark an unexpired lease as uncertain', async () => {
    const email = await oneEmail();
    await repository.claim(email.id, newId(), new Date(Date.now() + 60_000));

    expect(await repository.markUncertainIfLeaseExpired(email.id)).toBe(false);
  });

  it('defer only scheduled emails and record why', async () => {
    const email = await oneEmail();
    const later = new Date(Date.now() + 3_600_000);

    expect(await repository.defer(email.id, later, 'sender_hourly_limit')).toBe(true);
    expect(await emailRow(ctx.db, email.id)).toMatchObject({
      status: 'scheduled',
      scheduledAt: later,
      originalScheduledAt: email.originalScheduledAt,
      deferCount: 1,
      lastDeferredReason: 'sender_hourly_limit',
    });

    await repository.claim(email.id, newId(), new Date(Date.now() + 60_000));
    expect(await repository.defer(email.id, later, 'sender_hourly_limit')).toBe(false);
  });
});
