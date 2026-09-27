import { createHash, randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import type { GoogleOAuthConfig } from '../../config/env';

// Everything Google-specific lives here behind GoogleAuthClient, so tests can stub it.

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPES = 'openid email profile';

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string | null;
}

export interface GoogleAuthorizationRequest {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface GoogleAuthClient {
  createAuthorizationRequest(): GoogleAuthorizationRequest;
  /** Exchanges the code (with the PKCE verifier) and verifies the ID token, including its nonce. */
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<GoogleIdentity>;
}

const randomToken = () => randomBytes(32).toString('base64url');

/** RFC 7636 S256 code challenge. */
export function pkceChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

export function createGoogleAuthClient(config: GoogleOAuthConfig): GoogleAuthClient {
  const oauth = new OAuth2Client({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
  });

  return {
    createAuthorizationRequest() {
      const state = randomToken();
      const nonce = randomToken();
      const codeVerifier = randomToken();
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: SCOPES,
        state,
        nonce,
        code_challenge: pkceChallenge(codeVerifier),
        code_challenge_method: 'S256',
        prompt: 'select_account',
        access_type: 'online',
      });
      return { url: `${AUTHORIZATION_ENDPOINT}?${params.toString()}`, state, nonce, codeVerifier };
    },

    async exchangeCode({ code, codeVerifier, nonce }) {
      const { tokens } = await oauth.getToken({
        code,
        codeVerifier,
        redirect_uri: config.redirectUri,
      });
      if (!tokens.id_token) throw new Error('Google did not return an ID token');

      // Verifies the signature against Google's keys plus audience, issuer and expiry.
      const ticket = await oauth.verifyIdToken({
        idToken: tokens.id_token,
        audience: config.clientId,
      });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email) throw new Error('ID token lacks subject or email');
      if (payload.nonce !== nonce) throw new Error('ID token nonce does not match');

      return {
        sub: payload.sub,
        email: payload.email.toLowerCase(),
        emailVerified: payload.email_verified === true,
        name: payload.name ?? payload.email,
        picture: payload.picture ?? null,
      };
    },
  };
}
