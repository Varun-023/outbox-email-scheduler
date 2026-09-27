import { describe, expect, it } from 'vitest';
import type { UserRow } from '../../../src/db/schema';
import { AuthService, LoginError, safeReturnTo } from '../../../src/modules/auth/auth.service';
import { pkceChallenge } from '../../../src/modules/auth/google-client';
import type { GoogleProfile, UsersRepository } from '../../../src/modules/users/users.repository';
import { FakeGoogleAuthClient, googleIdentity } from '../../helpers/fakes';

function fakeUsers() {
  const saved: GoogleProfile[] = [];
  const repository = {
    async upsertFromGoogle(profile: GoogleProfile) {
      saved.push(profile);
      return { id: 'user-1', ...profile } as unknown as UserRow;
    },
  } as unknown as UsersRepository;
  return { saved, repository };
}

function setup() {
  const google = new FakeGoogleAuthClient();
  const users = fakeUsers();
  const auth = new AuthService(google, users.repository);
  const { pending } = auth.beginLogin('/scheduled', 1_000);
  return { google, users, auth, pending };
}

async function loginError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof LoginError) return err.code;
    throw err;
  }
  throw new Error('Expected a LoginError');
}

describe('AuthService', () => {
  it('stores state, nonce, PKCE verifier and return path for the callback', () => {
    const { google, pending } = setup();
    const issued = google.issued[0];

    expect(pending).toEqual({
      state: issued?.state,
      nonce: issued?.nonce,
      codeVerifier: issued?.codeVerifier,
      returnTo: '/scheduled',
      createdAt: 1_000,
    });
  });

  it('exchanges the code with the stored verifier and nonce, then upserts the user', async () => {
    const { google, users, auth, pending } = setup();
    const identity = googleIdentity({ name: 'Oliver Brown' });
    const code = google.approve(pending.state, identity);

    const user = await auth.completeLogin(pending, { code, state: pending.state }, 2_000);

    expect(user.id).toBe('user-1');
    expect(users.saved).toEqual([
      { sub: identity.sub, email: identity.email, name: 'Oliver Brown', picture: identity.picture },
    ]);
  });

  it.each([
    ['a mismatched state', { state: 'forged' }, 2_000],
    ['a missing state', { state: undefined }, 2_000],
    ['an expired login attempt', {}, 1_000 + 10 * 60_000 + 1],
  ])('rejects %s', async (_label, query, now) => {
    const { google, auth, pending } = setup();
    const code = google.approve(pending.state, googleIdentity());

    expect(
      await loginError(auth.completeLogin(pending, { code, state: pending.state, ...query }, now)),
    ).toBe('oauth_state');
  });

  it('rejects a callback without a pending login (e.g. a replayed URL)', async () => {
    const { auth } = setup();

    expect(await loginError(auth.completeLogin(undefined, { code: 'c', state: 's' }))).toBe(
      'oauth_state',
    );
  });

  it('reports a user who cancels on Google', async () => {
    const { auth, pending } = setup();

    expect(
      await loginError(
        auth.completeLogin(pending, { error: 'access_denied', state: pending.state }),
      ),
    ).toBe('oauth_denied');
  });

  it('refuses accounts whose email Google has not verified', async () => {
    const { google, users, auth, pending } = setup();
    const code = google.approve(pending.state, googleIdentity({ emailVerified: false }));

    expect(
      await loginError(auth.completeLogin(pending, { code, state: pending.state }, 2_000)),
    ).toBe('email_unverified');
    expect(users.saved).toHaveLength(0);
  });

  it('turns a failed code exchange into oauth_failed', async () => {
    const { auth, pending } = setup();

    expect(
      await loginError(
        auth.completeLogin(pending, { code: 'unknown', state: pending.state }, 2_000),
      ),
    ).toBe('oauth_failed');
  });

  it('reports oauth_unavailable when Google is not configured', () => {
    const auth = new AuthService(null, fakeUsers().repository);

    expect(() => auth.beginLogin('/')).toThrow(LoginError);
  });
});

describe('safeReturnTo', () => {
  it.each([
    ['/scheduled', '/scheduled'],
    ['/emails/abc?x=1', '/emails/abc?x=1'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['https://evil.example', '/'],
    ['', '/'],
    [undefined, '/'],
    [['/a', '/b'], '/'],
  ])('%j → %j', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});

describe('pkceChallenge', () => {
  it('matches the RFC 7636 S256 test vector', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});
