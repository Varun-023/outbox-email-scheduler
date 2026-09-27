// Lists senders; --reveal prints the Ethereal password (to log in at https://ethereal.email).
//   npm run sender:list -- [--user you@gmail.com] [--reveal]
import { parseArgs } from 'node:util';
import { asc, eq } from 'drizzle-orm';
import { loadEnvOrExit } from '../src/config/env';
import { createDatabase, createDatabasePool } from '../src/db/client';
import { senders, users } from '../src/db/schema';
import { SecretBox } from '../src/lib/crypto';

const { values } = parseArgs({
  options: { user: { type: 'string' }, reveal: { type: 'boolean', default: false } },
});

const env = loadEnvOrExit();
const pool = createDatabasePool({ url: env.DATABASE_URL, connectionLimit: 1 });
const db = createDatabase(pool);
const secrets = new SecretBox(env.ENCRYPTION_KEY);

try {
  const rows = await db
    .select({ sender: senders, ownerEmail: users.email })
    .from(senders)
    .innerJoin(users, eq(users.id, senders.userId))
    .where(values.user ? eq(users.email, values.user.toLowerCase()) : undefined)
    .orderBy(asc(users.email), asc(senders.createdAt));

  console.table(
    rows.map(({ sender, ownerEmail }) => ({
      owner: ownerEmail,
      label: sender.label,
      fromEmail: sender.fromEmail,
      smtp: `${sender.smtpHost}:${sender.smtpPort}`,
      password: values.reveal ? secrets.decrypt(sender.smtpPassEnc) : '(use --reveal)',
    })),
  );
} finally {
  await pool.end();
}
