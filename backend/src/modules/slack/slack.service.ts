import type { SlackConnectionStatus } from '@outbox/shared';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { SlackOAuthConfig } from '../../config/env';
import type { Database } from '../../db/client';
import { campaigns, senders, slackConnections, users } from '../../db/schema';
import { AppError } from '../../lib/app-error';
import type { SecretBox } from '../../lib/crypto';
import { newId } from '../../lib/ids';
import type { RateLimitNotificationJobData } from '../../queue/queues';

export interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  app_id?: string;
  authed_user?: { id: string; scope?: string; access_token?: string; token_type?: string };
  scope?: string;
  token_type?: string;
  access_token?: string;
  bot_user_id?: string;
  team?: { id: string; name: string };
  incoming_webhook?: {
    channel: string;
    channel_id: string;
    configuration_url: string;
    url: string;
  };
}

export interface SlackOAuthClient {
  exchangeCode(code: string, redirectUri: string): Promise<SlackOAuthResponse>;
}

export class SlackService {
  constructor(
    private readonly db: Database,
    private readonly config: SlackOAuthConfig | null,
    private readonly secrets: SecretBox,
    private readonly logger: Logger,
    private readonly oauthClient?: SlackOAuthClient,
  ) {}

  isConfigured(): boolean {
    return this.config !== null;
  }

  beginAuth(userId: string, returnTo = '/'): { url: string } {
    if (!this.config) {
      throw new AppError(
        503,
        'SERVICE_UNAVAILABLE',
        'Slack integration is not configured on this server',
      );
    }

    const statePayload = {
      userId,
      returnTo,
      nonce: newId(),
    };
    const state = Buffer.from(JSON.stringify(statePayload)).toString('base64url');

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      scope: 'incoming-webhook,chat:write',
      redirect_uri: this.config.redirectUri,
      state,
    });

    return {
      url: `https://slack.com/oauth/v2/authorize?${params.toString()}`,
    };
  }

  async completeAuth(query: {
    code?: string;
    state?: string;
    error?: string;
  }): Promise<{ teamName: string; channelName: string; returnTo: string }> {
    if (query.error) {
      this.logger.warn({ error: query.error }, 'Slack OAuth was cancelled or denied');
      throw new AppError(400, 'BAD_REQUEST', `Slack authorization failed: ${query.error}`);
    }

    if (!query.code || !query.state) {
      throw new AppError(400, 'BAD_REQUEST', 'Missing code or state in Slack OAuth callback');
    }

    if (!this.config) {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Slack integration is not configured');
    }

    let parsedState: { userId: string; returnTo?: string };
    try {
      parsedState = JSON.parse(Buffer.from(query.state, 'base64url').toString('utf8'));
      if (!parsedState.userId) throw new Error('Missing userId in state');
    } catch {
      throw new AppError(400, 'BAD_REQUEST', 'Invalid state parameter in Slack OAuth callback');
    }

    // Verify user exists
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, parsedState.userId))
      .limit(1);
    if (!user) {
      throw new AppError(404, 'NOT_FOUND', 'User not found');
    }

    let response: SlackOAuthResponse;
    if (this.oauthClient) {
      response = await this.oauthClient.exchangeCode(query.code, this.config.redirectUri);
    } else {
      const tokenUrl = 'https://slack.com/api/oauth.v2.access';
      const body = new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code: query.code,
        redirect_uri: this.config.redirectUri,
      });

      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      response = (await res.json()) as SlackOAuthResponse;
    }

    if (!response.ok || !response.team) {
      this.logger.warn({ response }, 'Failed to exchange Slack code for access token');
      throw new AppError(
        400,
        'BAD_REQUEST',
        response.error || 'Failed to authorize Slack application',
      );
    }

    const teamId = response.team.id;
    const teamName = response.team.name;
    const channelId = response.incoming_webhook?.channel_id || 'default';
    const channelName = response.incoming_webhook?.channel || '#general';
    const rawWebhook = response.incoming_webhook?.url;
    const rawBotToken = response.access_token;

    const webhookUrlEnc = rawWebhook ? this.secrets.encrypt(rawWebhook) : null;
    const botTokenEnc = rawBotToken ? this.secrets.encrypt(rawBotToken) : null;

    const now = new Date();

    // Upsert into slack_connections
    const [existing] = await this.db
      .select()
      .from(slackConnections)
      .where(eq(slackConnections.userId, user.id))
      .limit(1);

    if (existing) {
      await this.db
        .update(slackConnections)
        .set({
          teamId,
          teamName,
          channelId,
          channelName,
          appId: response.app_id || 'outbox',
          botUserId: response.bot_user_id || null,
          slackUserId: response.authed_user?.id || null,
          scopes: response.scope || 'incoming-webhook',
          webhookUrlEnc,
          botTokenEnc,
          status: 'active',
          lastError: null,
          connectedAt: now,
          revokedAt: null,
          updatedAt: now,
        })
        .where(eq(slackConnections.id, existing.id));
    } else {
      await this.db.insert(slackConnections).values({
        id: newId(),
        userId: user.id,
        teamId,
        teamName,
        channelId,
        channelName,
        appId: response.app_id || 'outbox',
        botUserId: response.bot_user_id || null,
        slackUserId: response.authed_user?.id || null,
        scopes: response.scope || 'incoming-webhook',
        webhookUrlEnc,
        botTokenEnc,
        status: 'active',
        connectedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    this.logger.info({ userId: user.id, teamName, channelName }, 'Slack connected successfully');
    return { teamName, channelName, returnTo: parsedState.returnTo || '/' };
  }

  async getStatus(userId: string): Promise<SlackConnectionStatus> {
    const [connection] = await this.db
      .select()
      .from(slackConnections)
      .where(eq(slackConnections.userId, userId))
      .limit(1);

    const connected = Boolean(connection && connection.status === 'active');
    return {
      configured: this.isConfigured(),
      connected,
      teamName: connected ? connection?.teamName : undefined,
      channelName: connected ? connection?.channelName : undefined,
      connectedAt: connected ? connection?.connectedAt.toISOString() : undefined,
    };
  }

  async disconnect(userId: string): Promise<void> {
    const [connection] = await this.db
      .select()
      .from(slackConnections)
      .where(eq(slackConnections.userId, userId))
      .limit(1);

    if (connection) {
      await this.db
        .update(slackConnections)
        .set({
          status: 'revoked',
          webhookUrlEnc: null,
          botTokenEnc: null,
          revokedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(slackConnections.id, connection.id));
    }
  }

  async sendRateLimitNotification(data: RateLimitNotificationJobData): Promise<void> {
    try {
      const [connection] = await this.db
        .select()
        .from(slackConnections)
        .where(eq(slackConnections.userId, data.userId))
        .limit(1);

      if (!connection || connection.status !== 'active') {
        return;
      }

      const webhookUrl = connection.webhookUrlEnc
        ? this.secrets.decrypt(connection.webhookUrlEnc)
        : null;

      if (!webhookUrl) {
        this.logger.warn(
          { userId: data.userId },
          'No webhook URL available on active Slack connection',
        );
        return;
      }

      // Query sender details
      const [senderRow] = await this.db
        .select()
        .from(senders)
        .where(eq(senders.id, data.senderId))
        .limit(1);

      // Query campaign details
      const [campaignRow] = await this.db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, data.campaignId))
        .limit(1);

      const fromEmail = senderRow?.fromEmail || 'OutBox Sender';
      const subject = campaignRow?.subject || 'Campaign';
      const resumeTime = new Date(data.resumesAt).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });

      const messagePayload = {
        text: `⚠️ Rate limit reached for ${fromEmail} (${data.limit} emails/hour)`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '⚠️ OutBox Hourly Rate Limit Reached',
              emoji: true,
            },
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Sender:*\n\`${fromEmail}\``,
              },
              {
                type: 'mrkdwn',
                text: `*Hourly Limit:*\n${data.limit} emails/hr`,
              },
              {
                type: 'mrkdwn',
                text: `*Scope:*\n${data.scope === 'sender' ? 'Sender Limit' : 'Campaign Limit'}`,
              },
              {
                type: 'mrkdwn',
                text: `*Resumes At:*\n${resumeTime}`,
              },
            ],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Campaign:* ${subject}\n_Remaining emails have been deferred to the next hourly window automatically._`,
            },
          },
        ],
      };

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messagePayload),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn({ status: res.status, text }, 'Slack webhook returned non-200 response');
        await this.db
          .update(slackConnections)
          .set({ lastError: `HTTP ${res.status}: ${text.slice(0, 200)}`, updatedAt: new Date() })
          .where(eq(slackConnections.id, connection.id));
      } else {
        await this.db
          .update(slackConnections)
          .set({ lastNotifiedAt: new Date(), lastError: null, updatedAt: new Date() })
          .where(eq(slackConnections.id, connection.id));
        this.logger.info(
          { userId: data.userId, teamName: connection.teamName },
          'Slack rate limit alert sent',
        );
      }
    } catch (err) {
      this.logger.warn(
        { err, userId: data.userId },
        'Failed to deliver Slack rate limit notification',
      );
    }
  }
}
