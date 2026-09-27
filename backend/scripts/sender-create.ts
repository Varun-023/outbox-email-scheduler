// Creates an Ethereal sender for an existing user:
//   npm run sender:create -- --user you@gmail.com [--label "Sales"]
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { loadEnvOrExit } from '../src/config/env';
import { createDatabase, createDatabasePool } from '../src/db/client';
import { senders, users } from '../src/db/schema';
import { SecretBox } from '../src/lib/crypto';
import { newId } from '../src/lib/ids';
import { etherealAccountProvider } from '../src/modules/senders/ethereal';

const { values } = parseArgs({
  options: { user: { type: 'string' }, label: { type: 'string' } },
});
if (!values.user) {
  console.error('Usage: npm run sender:create -- --user <email> [--label <label>]');
  process.exit(1);
}

const env = loadEnvOrExit();
const pool = createDatabasePool({ url: env.DATABASE_URL, connectionLimit: 1 });
const db = createDatabase(pool);

try {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, values.user.toLowerCase()))
    .limit(1);
  if (!user) {
    console.error(`No user with email ${values.user}. Sign in with Google once first.`);
    process.exitCode = 1;
  } else {
    const account = await etherealAccountProvider.createAccount();
    const now = new Date();
    await db.insert(senders).values({
      id: newId(),
      userId: user.id,
      label: values.label ?? 'Ethereal sender',
      fromName: user.name,
      fromEmail: account.user.toLowerCase(),
      provider: 'ethereal',
      smtpHost: account.smtp.host,
      smtpPort: account.smtp.port,
      smtpSecure: account.smtp.secure,
      smtpUser: account.user,
      smtpPassEnc: new SecretBox(env.ENCRYPTION_KEY).encrypt(account.pass),
      createdAt: now,
      updatedAt: now,
    });
    console.warn(`Created Ethereal sender ${account.user} for ${user.email}.`);
  }
} finally {
  await pool.end();
}
