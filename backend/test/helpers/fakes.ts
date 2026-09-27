import { randomBytes } from 'node:crypto';
import type {
  GoogleAuthClient,
  GoogleAuthorizationRequest,
  GoogleIdentity,
} from '../../src/modules/auth/google-client';
import { pkceChallenge } from '../../src/modules/auth/google-client';
import type { EtherealAccount, EtherealAccountProvider } from '../../src/modules/senders/ethereal';
import type { SlackOAuthResponse } from '../../src/modules/slack/slack.service';

const token = () => randomBytes(16).toString('hex');

/**
 * Stands in for Google: issues authorization requests and, like the real token endpoint,
 * only honours a code together with the PKCE verifier and nonce of the request it belongs to.
 */
export class FakeGoogleAuthClient implements GoogleAuthClient {
  readonly issued: GoogleAuthorizationRequest[] = [];
  private readonly codes = new Map<string, { identity: GoogleIdentity; state: string }>();

  createAuthorizationRequest(): GoogleAuthorizationRequest {
    const state = token();
    const nonce = token();
    const codeVerifier = token() + token();
    const url = `https://accounts.google.test/auth?state=${state}&code_challenge=${pkceChallenge(codeVerifier)}`;
    const request = { url, state, nonce, codeVerifier };
    this.issued.push(request);
    return request;
  }

  /** Simulates the user approving the consent screen for the request with this state. */
  approve(state: string, identity: GoogleIdentity): string {
    const code = `code-${token()}`;
    this.codes.set(code, { identity, state });
    return code;
  }

  async exchangeCode(input: { code: string; codeVerifier: string; nonce: string }) {
    const grant = this.codes.get(input.code);
    this.codes.delete(input.code);
    const request = this.issued.find((issued) => issued.state === grant?.state);
    if (!grant || !request) throw new Error('invalid_grant');
    if (request.codeVerifier !== input.codeVerifier) throw new Error('PKCE verifier mismatch');
    if (request.nonce !== input.nonce) throw new Error('nonce mismatch');
    return grant.identity;
  }
}

/** Creates "Ethereal" accounts that point at the local fake SMTP server. */
export class FakeEtherealProvider implements EtherealAccountProvider {
  created = 0;
  failNext = 0;
  delayMs = 0;

  constructor(private readonly smtpPort: number) {}

  async createAccount(): Promise<EtherealAccount> {
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('Ethereal API unavailable');
    }
    this.created += 1;
    return {
      user: `sender-${this.created}-${token().slice(0, 6)}@ethereal.test`,
      pass: `secret-${token()}`,
      smtp: { host: '127.0.0.1', port: this.smtpPort, secure: false },
    };
  }
}

export function googleIdentity(overrides: Partial<GoogleIdentity> = {}): GoogleIdentity {
  const id = token().slice(0, 8);
  return {
    sub: `google-${id}`,
    email: `user-${id}@example.com`,
    emailVerified: true,
    name: `User ${id}`,
    picture: `https://lh3.googleusercontent.test/${id}`,
    ...overrides,
  };
}

export class FakeSlackOAuthClient {
  approveNext: SlackOAuthResponse | null = null;
  lastCode: string | null = null;
  lastRedirectUri: string | null = null;

  async exchangeCode(code: string, redirectUri: string): Promise<SlackOAuthResponse> {
    this.lastCode = code;
    this.lastRedirectUri = redirectUri;
    if (this.approveNext) {
      const res = this.approveNext;
      this.approveNext = null;
      return res;
    }
    return {
      ok: true,
      app_id: 'A0123456789',
      authed_user: { id: 'U0123456789' },
      scope: 'incoming-webhook,chat:write',
      team: { id: 'T0123456789', name: 'Acme Corp' },
      incoming_webhook: {
        channel: '#general',
        channel_id: 'C0123456789',
        configuration_url: 'https://acme.slack.com/services/B0123456789',
        url: 'https://hooks.slack.com/services/T00/B00/XXXX',
      },
    };
  }
}
