import { copyFile } from 'node:fs/promises';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/worker.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // The shared workspace ships TypeScript source, so it is bundled rather than required at runtime.
  noExternal: [/^@outbox\//],
  // The send gate reads its Lua script from next to the bundled module.
  async onSuccess() {
    await copyFile('src/rate-limit/send-gate.lua', 'dist/send-gate.lua');
  },
});
