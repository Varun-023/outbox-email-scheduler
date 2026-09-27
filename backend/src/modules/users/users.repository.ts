import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { users, type UserRow } from '../../db/schema';
import { newId } from '../../lib/ids';

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

export class UsersRepository {
  constructor(private readonly db: Database) {}

  /**
   * Creates the user on first login and refreshes profile fields on later ones. The only
   * unique key that can collide is google_sub (the id is a fresh UUID), so the upsert is exact.
   */
  async upsertFromGoogle(profile: GoogleProfile, now = new Date()): Promise<UserRow> {
    await this.db
      .insert(users)
      .values({
        id: newId(),
        googleSub: profile.sub,
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.picture,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
      })
      .onDuplicateKeyUpdate({
        set: {
          email: profile.email,
          name: profile.name,
          avatarUrl: profile.picture,
          updatedAt: now,
          lastLoginAt: now,
        },
      });

    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.googleSub, profile.sub))
      .limit(1);
    if (!row) throw new Error('User upsert was not persisted');
    return row;
  }

  async findById(id: string): Promise<UserRow | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row;
  }
}
