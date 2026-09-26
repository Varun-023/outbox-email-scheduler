/**
 * Reads variables that integration tests need, failing with setup instructions
 * rather than an opaque connection error when one is missing.
 */
export function requireTestEnv<const K extends string>(names: readonly K[]): Record<K, string> {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(', ')}. Copy .env.example to .env, fill it in, and run \`npm run infra:up\`.`,
    );
  }
  return Object.fromEntries(names.map((name) => [name, process.env[name] as string])) as Record<
    K,
    string
  >;
}
