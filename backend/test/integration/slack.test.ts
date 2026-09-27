import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { slackConnections, users, type UserRow } from '../../src/db/schema';
import { SlackService } from '../../src/modules/slack/slack.service';
import { createTestApp, HTTPS, signIn } from '../helpers/app';
import { createTestContext } from '../helpers/context';
import { createCampaign, createSender } from '../helpers/factories';
import {
  FakeEtherealProvider,
  FakeGoogleAuthClient,
  FakeSlackOAuthClient,
  googleIdentity,
} from '../helpers/fakes';

const ctx = createTestContext();
const google = new FakeGoogleAuthClient();
const fakeSlack = new FakeSlackOAuthClient();
const app = createTestApp(ctx, {
  google,
  ethereal: new FakeEtherealProvider(2525),
  slack: fakeSlack,
});
const slackService = new SlackService(
  ctx.db,
  {
    clientId: 'test-slack-client-id',
    clientSecret: 'test-slack-client-secret',
    redirectUri: 'https://localhost:5173/api/integrations/slack/callback',
  },
  ctx.secrets,
  ctx.logger,
  fakeSlack,
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
  ({ cookie, user } = await signedInUser());
});
afterAll(() => ctx.close());

describe('Slack OAuth & Persistence', () => {
  it('begins OAuth flow by generating a valid Slack authorize redirect with state', async () => {
    const res = await request(app)
      .get('/api/integrations/slack/authorize?returnTo=/dashboard')
      .set(HTTPS)
      .set('Cookie', cookie);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('https://slack.com/oauth/v2/authorize');
    expect(res.headers.location).toContain('client_id=test-slack-client-id');
    expect(res.headers.location).toContain('state=');
  });

  it('completes OAuth callback, securely stores encrypted tokens, and reports connection status', async () => {
    // Begin auth to generate state
    const authRes = await request(app)
      .get('/api/integrations/slack/authorize?returnTo=/')
      .set(HTTPS)
      .set('Cookie', cookie);
    const redirectUrl = new URL(authRes.headers.location as string);
    const state = redirectUrl.searchParams.get('state');

    // Callback with code & state
    const callbackRes = await request(app)
      .get(`/api/integrations/slack/callback?code=mock-code-123&state=${state}`)
      .set(HTTPS)
      .set('Cookie', cookie);

    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.location).toContain('?slack=connected');

    // Verify row was persisted in MySQL with encrypted credentials
    const [conn] = await ctx.db
      .select()
      .from(slackConnections)
      .where(eq(slackConnections.userId, user.id));
    expect(conn).toBeDefined();
    expect(conn?.teamName).toBe('Acme Corp');
    expect(conn?.channelName).toBe('#general');
    expect(conn?.status).toBe('active');
    expect(conn?.webhookUrlEnc).toBeTruthy();
    // Raw URL should NOT be plaintext
    expect(conn?.webhookUrlEnc).not.toContain('https://hooks.slack.com');

    // Check status API endpoint (tokens/webhooks are never exposed)
    const statusRes = await request(app).get('/api/integrations/slack').set('Cookie', cookie);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toMatchObject({
      configured: true,
      connected: true,
      teamName: 'Acme Corp',
      channelName: '#general',
    });
    expect(statusRes.body.webhookUrl).toBeUndefined();
    expect(statusRes.body.botToken).toBeUndefined();
  });

  it('allows disconnecting Slack and updates status', async () => {
    // First connect
    const { url } = slackService.beginAuth(user.id);
    const state = new URL(url).searchParams.get('state')!;
    await slackService.completeAuth({ code: 'code-123', state });

    const beforeStatus = await request(app).get('/api/integrations/slack').set('Cookie', cookie);
    expect(beforeStatus.body.connected).toBe(true);

    // Disconnect
    const disconnectRes = await request(app)
      .post('/api/integrations/slack/disconnect')
      .set('Cookie', cookie);
    expect(disconnectRes.status).toBe(204);

    const afterStatus = await request(app).get('/api/integrations/slack').set('Cookie', cookie);
    expect(afterStatus.body.connected).toBe(false);
  });
});

describe('Slack Hourly Rate-Limit Notifications', () => {
  it('delivers rate-limit notification webhook to Slack when connected', async () => {
    // Connect Slack
    const { url } = slackService.beginAuth(user.id);
    const state = new URL(url).searchParams.get('state')!;
    await slackService.completeAuth({ code: 'code-123', state });

    const sender = await createSender(ctx.db, ctx.secrets, { userId: user.id, smtpPort: 2525 });
    const { campaign } = await createCampaign(ctx.db, {
      user,
      sender,
      recipients: ['r1@example.com'],
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'ok',
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      await slackService.sendRateLimitNotification({
        userId: user.id,
        senderId: sender.id,
        campaignId: campaign.id,
        scope: 'sender',
        windowIdx: 490000,
        limit: 200,
        resumesAt: new Date(Date.now() + 3600000).toISOString(),
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledOpts] = mockFetch.mock.calls[0] as [string, { body: string }];
      expect(calledUrl).toBe('https://hooks.slack.com/services/T00/B00/XXXX');
      const body = JSON.parse(calledOpts.body);
      expect(body.text).toContain('Rate limit reached');
      expect(body.blocks).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('safely skips notification without throwing if Slack is not connected', async () => {
    const sender = await createSender(ctx.db, ctx.secrets, { userId: user.id, smtpPort: 2525 });
    const { campaign } = await createCampaign(ctx.db, {
      user,
      sender,
      recipients: ['r1@example.com'],
    });

    // Should not throw or fail
    await expect(
      slackService.sendRateLimitNotification({
        userId: user.id,
        senderId: sender.id,
        campaignId: campaign.id,
        scope: 'sender',
        windowIdx: 490000,
        limit: 200,
        resumesAt: new Date(Date.now() + 3600000).toISOString(),
      }),
    ).resolves.toBeUndefined();
  });

  it('handles webhook network failure gracefully without throwing or crashing', async () => {
    // Connect Slack
    const { url } = slackService.beginAuth(user.id);
    const state = new URL(url).searchParams.get('state')!;
    await slackService.completeAuth({ code: 'code-123', state });

    const sender = await createSender(ctx.db, ctx.secrets, { userId: user.id, smtpPort: 2525 });
    const { campaign } = await createCampaign(ctx.db, {
      user,
      sender,
      recipients: ['r1@example.com'],
    });

    const mockFetch = vi.fn().mockRejectedValue(new Error('Slack API connection timeout'));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      await expect(
        slackService.sendRateLimitNotification({
          userId: user.id,
          senderId: sender.id,
          campaignId: campaign.id,
          scope: 'sender',
          windowIdx: 490000,
          limit: 200,
          resumesAt: new Date(Date.now() + 3600000).toISOString(),
        }),
      ).resolves.toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
