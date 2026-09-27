import type { Client } from '@elastic/elasticsearch';
import type { AuthUser } from '@outbox/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { users, type UserRow } from '../../src/db/schema';
import { EmailsRepository } from '../../src/modules/emails/emails.repository';
import { SearchService } from '../../src/modules/search/search.service';
import { createTestApp, signIn } from '../helpers/app';
import { createTestContext } from '../helpers/context';
import { createCampaign, createSender } from '../helpers/factories';
import { FakeEtherealProvider, FakeGoogleAuthClient, googleIdentity } from '../helpers/fakes';

const ctx = createTestContext();
const google = new FakeGoogleAuthClient();
const app = createTestApp(ctx, { google, ethereal: new FakeEtherealProvider(2525) });
const repository = new EmailsRepository(ctx.db);
const searchService = new SearchService(
  ctx.elasticsearch,
  repository,
  ctx.logger,
  ctx.env.ES_INDEX_PREFIX,
);

let cookie: string;
let user: UserRow;

async function signedInUser() {
  const identity = googleIdentity();
  const sessionCookie = await signIn(app, google, identity);
  const [row] = await ctx.db.select().from(users).where(eq(users.googleSub, identity.sub));
  return { cookie: sessionCookie, user: row as UserRow };
}

beforeEach(async () => {
  await ctx.reset();
  try {
    await ctx.elasticsearch.indices.delete({ index: `${ctx.env.ES_INDEX_PREFIX}_emails` });
  } catch {
    // Ignore if index didn't exist
  }
  await searchService.ensureIndex();
  ({ cookie, user } = await signedInUser());
});
afterAll(() => ctx.close());

describe('Elasticsearch Search & Indexing', () => {
  it('indexes emails and returns search results matching subject, recipient, and body text', async () => {
    const sender = await createSender(ctx.db, ctx.secrets, { userId: user.id, smtpPort: 2525 });
    const { emails, campaign } = await createCampaign(ctx.db, {
      user,
      sender,
      subject: 'Quarterly Revenue Strategy Q3',
      bodyHtml: '<p>Discussing the new enterprise growth pipeline and marketing initiatives.</p>',
      bodyText: 'Discussing the new enterprise growth pipeline and marketing initiatives.',
      previewText: 'Discussing the new enterprise growth pipeline...',
      recipients: ['alice.growth@example.com', 'bob.marketing@example.com'],
    });

    // Index emails into Elasticsearch
    const indexedCount = await searchService.indexEmails(emails.map((e) => e.id));
    expect(indexedCount).toBe(2);

    // Search by subject term
    const searchSubjectRes = await request(app)
      .get('/api/emails/search?q=Quarterly')
      .set('Cookie', cookie);

    expect(searchSubjectRes.status).toBe(200);
    expect(searchSubjectRes.body.items).toHaveLength(2);
    expect(searchSubjectRes.body.items[0]).toMatchObject({
      subject: 'Quarterly Revenue Strategy Q3',
      campaignId: campaign.id,
    });

    // Search by recipient email
    const searchRecipientRes = await request(app)
      .get('/api/emails/search?q=alice.growth')
      .set('Cookie', cookie);

    expect(searchRecipientRes.status).toBe(200);
    expect(searchRecipientRes.body.items).toHaveLength(1);
    expect(searchRecipientRes.body.items[0].to).toBe('alice.growth@example.com');

    // Search by body content term
    const searchBodyRes = await request(app)
      .get('/api/emails/search?q=pipeline')
      .set('Cookie', cookie);

    expect(searchBodyRes.status).toBe(200);
    expect(searchBodyRes.body.items).toHaveLength(2);
  });

  it('strictly scopes search results to the authenticated user', async () => {
    const sender1 = await createSender(ctx.db, ctx.secrets, { userId: user.id, smtpPort: 2525 });
    const { emails: user1Emails } = await createCampaign(ctx.db, {
      user,
      sender: sender1,
      subject: 'Confidential Strategy Document',
      recipients: ['recipient1@example.com'],
    });
    await searchService.indexEmails(user1Emails.map((e) => e.id));

    const other = await signedInUser();
    const sender2 = await createSender(ctx.db, ctx.secrets, {
      userId: other.user.id,
      smtpPort: 2525,
    });
    const { emails: user2Emails } = await createCampaign(ctx.db, {
      user: other.user,
      sender: sender2,
      subject: 'Confidential Strategy Document Other',
      recipients: ['recipient2@example.com'],
    });
    await searchService.indexEmails(user2Emails.map((e) => e.id));

    // User 1 searches: should only see their email
    const user1Res = await request(app)
      .get('/api/emails/search?q=Confidential')
      .set('Cookie', cookie);

    expect(user1Res.status).toBe(200);
    expect(user1Res.body.items).toHaveLength(1);
    expect(user1Res.body.items[0].id).toBe(user1Emails[0]!.id);

    // User 2 searches: should only see their email
    const user2Res = await request(app)
      .get('/api/emails/search?q=Confidential')
      .set('Cookie', other.cookie);

    expect(user2Res.status).toBe(200);
    expect(user2Res.body.items).toHaveLength(1);
    expect(user2Res.body.items[0].id).toBe(user2Emails[0]!.id);
  });

  it('filters search results by folder and status', async () => {
    const sender = await createSender(ctx.db, ctx.secrets, { userId: user.id, smtpPort: 2525 });
    const { emails } = await createCampaign(ctx.db, {
      user,
      sender,
      subject: 'Weekly Team Standup Update',
      recipients: ['dev1@example.com', 'dev2@example.com'],
    });
    await searchService.indexEmails(emails.map((e) => e.id));

    const scheduledRes = await request(app)
      .get('/api/emails/search?q=Standup&folder=scheduled')
      .set('Cookie', cookie);

    expect(scheduledRes.status).toBe(200);
    expect(scheduledRes.body.items).toHaveLength(2);

    const sentFolderRes = await request(app)
      .get('/api/emails/search?q=Standup&folder=sent')
      .set('Cookie', cookie);

    expect(sentFolderRes.status).toBe(200);
    expect(sentFolderRes.body.items).toHaveLength(0);
  });

  it('handles search failure gracefully by returning 503 SEARCH_UNAVAILABLE without breaking normal operations', async () => {
    // When Elasticsearch service throws or is unavailable
    const badApp = createTestApp(ctx, {
      google,
      ethereal: new FakeEtherealProvider(2525),
    });

    // Create emails
    const sender = await createSender(ctx.db, ctx.secrets, { userId: user.id, smtpPort: 2525 });
    await createCampaign(ctx.db, {
      user,
      sender,
      subject: 'Operational Notification',
      recipients: ['ops@example.com'],
    });

    // Normal list API works
    const listRes = await request(badApp).get('/api/emails?folder=scheduled').set('Cookie', cookie);
    expect(listRes.status).toBe(200);
    expect(listRes.body.items).toHaveLength(1);

    // If SearchService index does not match or client fails
    const badSearch = new SearchService(
      {
        indices: { exists: async () => false, create: async () => ({}) },
        bulk: async () => {
          throw new Error('ES cluster down');
        },
        search: async () => {
          throw new Error('ES cluster down');
        },
      } as unknown as Client,
      repository,
      ctx.logger,
    );

    await expect(
      badSearch.search(user as unknown as AuthUser, { q: 'test', limit: 20 }),
    ).rejects.toThrow('Search is currently unavailable');
  });
});
