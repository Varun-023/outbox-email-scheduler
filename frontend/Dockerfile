# Production image for the dashboard (used by the Railway "frontend" service).
# Build context is the repository root: the frontend imports the @outbox/shared workspace.
# Caddy serves the Vite build and proxies /api and /admin to the backend, keeping the
# same-origin setup the Vite dev proxy provides locally (first-party cookies, no CORS).

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --no-audit --no-fund
COPY packages/shared packages/shared
COPY frontend frontend
RUN npm run build -w @outbox/frontend

FROM caddy:2-alpine
COPY frontend/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/frontend/dist /srv
