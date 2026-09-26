import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig(({ mode }) => {
  // The root .env is shared with the backend; here it only tells the proxy where the API listens.
  const rootEnv = loadEnv(mode, repoRoot, '');
  const toApi = { target: `http://127.0.0.1:${rootEnv.API_PORT || '4000'}`, xfwd: true };

  return {
    // HTTPS on localhost is required for the Slack OAuth redirect and for Secure cookies.
    plugins: [react(), tailwindcss(), basicSsl()],
    server: {
      port: 5173,
      strictPort: true,
      // Same-origin /api and /admin keep session cookies first-party and avoid CORS entirely.
      proxy: { '/api': toApi, '/admin': toApi },
    },
  };
});
