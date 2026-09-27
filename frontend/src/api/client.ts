import type {
  AuthUser,
  CreateCampaignRequest,
  CreateCampaignResponse,
  EmailCounts,
  EmailDetail,
  EmailFolder,
  EmailStatus,
  ListEmailsResponse,
  Sender,
  SlackConnectionStatus,
} from '@outbox/shared';

export class ApiError extends Error {
  code: string;
  details?: Array<{ path: string; message: string }>;
  requestId?: string;
  statusCode: number;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Array<{ path: string; message: string }>,
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return {} as T;
  }

  const contentType = response.headers.get('content-type');
  const isJson = contentType && contentType.includes('application/json');

  if (!response.ok) {
    if (isJson) {
      try {
        const errorBody = await response.json();
        const err = errorBody?.error;
        if (err) {
          throw new ApiError(
            response.status,
            err.code || 'UNKNOWN_ERROR',
            err.message || 'An error occurred',
            err.details,
            err.requestId,
          );
        }
      } catch (e) {
        if (e instanceof ApiError) throw e;
      }
    }
    const text = await response.text().catch(() => '');
    throw new ApiError(
      response.status,
      response.status === 401 ? 'UNAUTHENTICATED' : 'HTTP_ERROR',
      text || `Request failed with status ${response.status}`,
    );
  }

  if (isJson) {
    return (await response.json()) as T;
  }
  return {} as T;
}

export interface ListEmailsParams {
  folder: EmailFolder;
  status?: EmailStatus;
  rescheduled?: boolean;
  senderId?: string;
  cursor?: string;
  limit?: number;
}

export interface SearchEmailsParams {
  q: string;
  folder?: EmailFolder;
  status?: EmailStatus;
  limit?: number;
}

export const api = {
  async getMe(): Promise<AuthUser> {
    const res = await fetch('/api/auth/me', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const data = await handleResponse<{ user: AuthUser }>(res);
    return data.user;
  },

  async logout(): Promise<void> {
    const res = await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    await handleResponse<void>(res);
  },

  async getSenders(): Promise<Sender[]> {
    const res = await fetch('/api/senders', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const data = await handleResponse<{ items: Sender[] }>(res);
    return data.items;
  },

  async getEmailCounts(): Promise<EmailCounts> {
    const res = await fetch('/api/emails/counts', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    return await handleResponse<EmailCounts>(res);
  },

  async listEmails(params: ListEmailsParams): Promise<ListEmailsResponse> {
    const query = new URLSearchParams();
    query.set('folder', params.folder);
    if (params.status) query.set('status', params.status);
    if (params.rescheduled !== undefined) query.set('rescheduled', String(params.rescheduled));
    if (params.senderId) query.set('senderId', params.senderId);
    if (params.cursor) query.set('cursor', params.cursor);
    if (params.limit) query.set('limit', String(params.limit));

    const res = await fetch(`/api/emails?${query.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    return await handleResponse<ListEmailsResponse>(res);
  },

  async searchEmails(params: SearchEmailsParams): Promise<ListEmailsResponse> {
    const query = new URLSearchParams();
    query.set('q', params.q);
    if (params.folder) query.set('folder', params.folder);
    if (params.status) query.set('status', params.status);
    if (params.limit) query.set('limit', String(params.limit));

    const res = await fetch(`/api/emails/search?${query.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    return await handleResponse<ListEmailsResponse>(res);
  },

  async getEmailDetail(id: string): Promise<EmailDetail> {
    const res = await fetch(`/api/emails/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    return await handleResponse<EmailDetail>(res);
  },

  async createCampaign(
    payload: CreateCampaignRequest,
    idempotencyKey: string,
  ): Promise<CreateCampaignResponse> {
    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    });
    return await handleResponse<CreateCampaignResponse>(res);
  },

  async getSlackStatus(): Promise<SlackConnectionStatus> {
    const res = await fetch('/api/integrations/slack', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    return await handleResponse<SlackConnectionStatus>(res);
  },

  async disconnectSlack(): Promise<void> {
    const res = await fetch('/api/integrations/slack/disconnect', {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    await handleResponse<void>(res);
  },
};
