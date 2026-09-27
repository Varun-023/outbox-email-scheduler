# OutBox — Full-Stack Email Job Scheduler

A production-style email scheduler and dashboard built with **Node.js, TypeScript, Express,
MySQL, Redis, BullMQ, Ethereal SMTP, Elasticsearch and React**: schedule cold-email campaigns,
throttle them per sender, survive restarts without losing or duplicating emails, search them,
and get a Slack alert when a sender hits its hourly limit.

> **MySQL is the source of truth. BullMQ delayed jobs in Redis are used for scheduling. The
> maintenance reconciler only restores missing/overdue queue jobs after failures; it is not the
> email scheduler.** There is no cron, node-cron or Agenda anywhere in this project.

API reference: [`docs/API.md`](docs/API.md) · Figma references: [`docs/figma/`](docs/figma/)

---

## Contents

1. [Architecture](#architecture)
2. [Features mapped to requirements](#features-mapped-to-requirements)
3. [How it works](#how-it-works) — MySQL, BullMQ, scheduling, concurrency, delay, hourly limit,
   rescheduling, restart recovery, idempotency, Elasticsearch, Slack, Google OAuth, Ethereal,
   Bull Board
4. [Frontend](#frontend)
5. [Local setup](#local-setup)
6. [Environment variables](#environment-variables)
7. [Google OAuth setup](#google-oauth-setup)
8. [Slack app setup](#slack-app-setup)
9. [Testing](#testing)
10. [Demo instructions](#demo-instructions)
11. [Trade-offs and known limitations](#trade-offs-and-known-limitations)

---

## Architecture

```
 Browser ── React SPA (Vite, https://localhost:5173) ── same-origin proxy: /api, /admin
                                   │
                                   ▼
 ┌────────────────────────── API process (Express 5) ───────────────────────────┐
 │ auth (Google OAuth) · senders · campaigns · emails · search · slack · health │
 │ Redis sessions · zod validation · JSON error envelope · Bull Board (admin)   │
 └──────┬────────────────────┬──────────────────────────┬──────────────────────┘
        │ transactions        │ delayed jobs              │ search
        ▼                     ▼                           ▼
   MySQL 8.4            Redis 7 (AOF)                Elasticsearch 8.19
   (source of truth)    BullMQ queues:               (search projection)
   users, senders,        emails · notifications       ▲
   campaigns, emails,     search-sync · maintenance    │ index
   slack_connections    send-gate Lua · receipts ·     │
        ▲               sessions                        │
        │                     ▲                         │
 ┌──────┴───────────── Worker process(es), start any number ─────────────────────┐
 │ emails worker        → send gate (rate limits) → claim → Ethereal SMTP → sent │
 │ notifications worker → Slack webhook                                           │
 │ search-sync worker   → Elasticsearch                                           │
 │ maintenance worker   → BullMQ Maintenance Scheduler / Reconciler (recovery)    │
 └────────────────────────────────────────────────────────────────────────────────┘
```

Monorepo (npm workspaces): `backend/` (API + workers), `frontend/` (React), `packages/shared/`
(zod schemas and types used by both), `docker-compose.yml` (MySQL, Redis, Elasticsearch).

---

## Features mapped to requirements

| Requirement                                                      | Implementation                                                                            |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Accept scheduling requests via API                               | `POST /api/campaigns` (one campaign → one email row + one delayed job per recipient)      |
| Relational DB                                                    | MySQL 8.4 via Drizzle ORM, reviewed SQL migrations (`backend/src/db/migrations`)          |
| BullMQ delayed jobs, no cron                                     | Each email is a BullMQ delayed job `email-<emailId>`; no cron/node-cron/Agenda            |
| Multiple senders via Ethereal                                    | `senders` table; 2 Ethereal accounts auto-created per user; choose in Compose             |
| Persistent across restarts                                       | Jobs live in Redis (AOF); MySQL holds state; startup + periodic reconciliation            |
| No duplicate sends                                               | Idempotency-Key, unique constraints, fixed job ids, DB claim + lease, Redis send receipts |
| Configurable worker concurrency                                  | `EMAIL_WORKER_CONCURRENCY`; run any number of worker processes                            |
| Delay between emails                                             | Per-sender `MIN_DELAY_BETWEEN_EMAILS_MS` + per-campaign delay, enforced in Redis          |
| Hourly limit (configurable)                                      | `MAX_EMAILS_PER_HOUR_PER_SENDER` + per-campaign limit, atomic Redis Lua counters          |
| Limit reached → reschedule, keep order                           | Deferred to the next window with ordered tickets; never failed                            |
| Slack alert on limit                                             | Real Slack OAuth; alert via a separate `notifications` queue; optional                    |
| Elasticsearch search                                             | `search-sync` queue indexes emails; `GET /api/emails/search`                              |
| Live queue dashboard                                             | Bull Board at `/admin/queues` (admin allowlist)                                           |
| Google login, name/email/avatar, logout                          | Real Google OAuth (PKCE); sidebar user card                                               |
| Dashboard: Scheduled / Sent, Compose                             | Figma-based React UI with search, filters, refresh                                        |
| Compose: subject, body, CSV/TXT, count, start time, delay, limit | Compose page with recipient chips, upload, rich editor, Send Later picker                 |
| Loading / empty / error states                                   | Skeletons, empty states, toasts                                                           |

---

## How it works

### MySQL (source of truth)

Tables: `users`, `senders`, `campaigns`, `emails`, `slack_connections`. IDs are app-generated
UUIDv7 (`CHAR(36)`), times are `DATETIME(3)` in UTC. Every email row has a `status`
(`scheduled → sending → sent | failed`), `scheduled_at`, `defer_count`, `last_deferred_reason`,
`claim_token`, `lease_until`, `attempt_count`, `message_id`, `preview_url` and a `version` used
for search sync. Secrets (SMTP passwords, Slack webhooks/tokens) are AES-256-GCM encrypted.

### Redis / BullMQ

Queues (prefix `BULLMQ_PREFIX`): **`emails`** (sending), **`notifications`** (Slack),
**`search-sync`** (Elasticsearch) and **`maintenance`** (reconciler). Redis runs with AOF
persistence (`appendfsync everysec`) and `noeviction`, as BullMQ requires.

### Email scheduling

`POST /api/campaigns` validates and de-duplicates recipients, plans a send time for each email,
writes the campaign and all email rows in one MySQL transaction, then adds one **BullMQ delayed
job per email** (`jobId = email-<emailId>`, `delay = scheduledAt − now`) and records
`campaigns.enqueued_at`. When the delay expires BullMQ hands the job to a worker. This is the only
scheduling mechanism.

### Worker concurrency

`EMAIL_WORKER_CONCURRENCY` (default 5) jobs run in parallel per worker process, and any number of
worker processes can run (`npm run dev:worker` in several terminals). BullMQ gives each job to
one worker (Redis locks, stall detection); every rate limit lives in Redis, so all workers share it.

### Delay between emails

The gap between two sends is the larger of the sender's `MIN_DELAY_BETWEEN_EMAILS_MS` (default
2 s; per-sender override possible) and the campaign's "Delay between 2 emails". The Redis Lua
send gate reserves send slots that far apart for all workers, and just before sending a second
atomic check compares against the previous _actual_ send, so a job that BullMQ woke late cannot
squeeze the gap.

### Hourly rate limiting

Fixed clock windows (`RATE_LIMIT_WINDOW_MS`, default one hour, keyed by Redis `TIME`). Limits:
per sender (`MAX_EMAILS_PER_HOUR_PER_SENDER`, default 200) and per campaign (the Compose "Hourly
Limit", ≤ the sender limit). The check-and-increment happens in one Lua script
(`backend/src/rate-limit/send-gate.lua`), so concurrent workers cannot exceed the limit.

### Rate-limit rescheduling

When a window is full the email is **not failed**. The gate hands it an ordered ticket in the next
window(s); the worker updates `scheduled_at`, increments `defer_count`, sets
`last_deferred_reason` (`sender_hourly_limit` / `campaign_hourly_limit`), keeps `status =
scheduled` and re-delays the same BullMQ job. Tickets are issued in processing order, so emails
keep their relative order as far as possible. The dashboard shows these as "Rescheduled".

### Restart and recovery

- **API restart:** no effect; jobs are in Redis, sessions in Redis.
- **Worker restart/crash:** delayed jobs stay in Redis; on start BullMQ runs overdue jobs
  (late, once) and future ones on time. Jobs from a killed worker are recovered by BullMQ stall
  detection.
- **BullMQ Maintenance Scheduler / Reconciler:** runs at worker startup and every
  `RECONCILE_INTERVAL_MS` (a BullMQ repeatable job on the `maintenance` queue; `0` = startup
  only). It re-enqueues campaigns whose jobs never reached Redis (`enqueued_at IS NULL`), re-adds
  missing jobs or retries failed ones for overdue scheduled emails, rebuilds every scheduled job
  after Redis data loss (startup) and resolves expired send leases. All re-adds use the fixed job
  id, so they cannot create duplicates. It never decides when an email is sent.

### Idempotency / no duplicate sending

1. `Idempotency-Key` header + unique `(user_id, idempotency_key)`: a retried request returns the
   original campaign; the same key with a different body is rejected.
2. Unique `(campaign_id, recipient_email)`: no duplicate recipients.
3. Fixed BullMQ job id `email-<emailId>`: adding the same email twice is ignored.
4. Claim: `UPDATE … SET status='sending', claim_token, lease_until WHERE status='scheduled'`
   — exactly one worker wins.
5. After SMTP accepts the message a **receipt** is written to Redis before MySQL is updated; a
   retry that finds it marks the email sent without sending again.
6. Finished emails (`sent`/`failed`) are skipped.

Exactly-once across SMTP and a database is impossible. If a worker dies between SMTP accepting
the message and the receipt write (a few ms), the email is marked `failed` with
`DELIVERY_UNCERTAIN` and **not resent** (`UNCERTAIN_DELIVERY_POLICY=fail`, at-most-once;
`resend` switches to at-least-once).

### Elasticsearch

Emails are indexed on creation and re-indexed after every status change (rows with a changed
`version` are "search dirty"; the `search-sync` queue indexes them). Search is always filtered by
user. If Elasticsearch is down, search returns `503 SEARCH_UNAVAILABLE`; scheduling, sending and
the lists (served from MySQL) keep working.

### Slack

"Connect Slack" runs Slack OAuth v2 (`incoming-webhook`, `chat:write`) with an encrypted,
expiring state bound to the signed-in user. The webhook URL is stored encrypted. When a sender or
campaign fills its window, one notification job per window is queued and the notifications worker
posts a Block Kit message. Slack is optional: without a connection the job simply completes, and
Slack errors never affect sending (separate queue).

### Google OAuth

Authorization-code flow with PKCE (S256), state and nonce; the ID token is verified and
`email_verified` is required. Users are upserted by Google subject. Sessions are stored in Redis;
the cookie is HttpOnly, SameSite=Lax and Secure over HTTPS.

### Ethereal

Each sender is an Ethereal SMTP account created with Nodemailer's `createTestAccount()`
(credentials encrypted in MySQL). Ethereal captures messages instead of delivering them; each sent
email stores Ethereal's preview URL, shown in the email detail view. `npm run sender:list --
--reveal` (backend workspace) prints sender logins for https://ethereal.email.

### Bull Board

`https://localhost:5173/admin/queues` shows all four queues (delayed, active, completed, failed
jobs). Access requires a signed-in user whose email is in `ADMIN_EMAILS`.

---

## Frontend

React 19 + TypeScript + Tailwind v4 (Vite), following `docs/figma`: Google login page;
dashboard with sidebar user card (name, email, avatar, logout), Scheduled / Sent tabs with counts,
Elasticsearch search, status/rescheduled filters and refresh; email detail with Ethereal preview
link; Compose page with sender selector, recipient chips, CSV/TXT upload with recipient count,
subject, rich-text body, delay, hourly limit and a Send Later date/time picker; Slack connect in
the sidebar; loading skeletons, empty states, error toasts; responsive layout.

---

## Local setup

Prerequisites: **Node.js ≥ 22.12**, **npm ≥ 10**, **Docker Desktop**.

```bash
# 1. Environment: copy the template, then fill in the blanks (never commit .env)
cp .env.example .env

# 2. Dependencies
npm install

# 3. MySQL, Redis and Elasticsearch (waits until healthy)
npm run infra:up

# 4. Database schema
npm run db:migrate

# 5. API + worker + frontend
npm run dev
```

Open **https://localhost:5173** and accept the self-signed development certificate once.
Individual processes: `npm run dev:api`, `npm run dev:worker`, `npm run dev:web`.
Stop infrastructure with `npm run infra:down`.

---

## Environment variables

All variables are documented in [`.env.example`](.env.example); one root `.env` is read by Docker
Compose, the backend and the Vite proxy. `.env` is git-ignored — only the template is committed.

| Group         | Variables                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App           | `APP_ORIGIN`, `API_PORT`, `TRUST_PROXY`, `LOG_LEVEL`                                                                                                                                                                                        |
| MySQL         | `MYSQL_*`, `MYSQL_HOST_PORT` (use `3307` if a local MySQL uses 3306), `DATABASE_URL`, `DATABASE_URL_TEST`                                                                                                                                   |
| Redis         | `REDIS_PASSWORD`, `REDIS_URL`, `REDIS_URL_TEST`, `BULLMQ_PREFIX`                                                                                                                                                                            |
| Elasticsearch | `ELASTICSEARCH_URL`, `ES_INDEX_PREFIX`                                                                                                                                                                                                      |
| Security      | `SESSION_SECRET` (≥ 32 chars), `ENCRYPTION_KEY` (base64 of 32 bytes), `ADMIN_EMAILS`, `BULL_BOARD_READ_ONLY`                                                                                                                                |
| Google        | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`                                                                                                                                                                           |
| Slack         | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI`                                                                                                                                                                              |
| Sending       | `AUTO_PROVISION_SENDERS`, `EMAIL_WORKER_CONCURRENCY`, `EMAIL_JOB_ATTEMPTS`, `EMAIL_JOB_BACKOFF_MS`, `MIN_DELAY_BETWEEN_EMAILS_MS`, `MAX_EMAILS_PER_HOUR_PER_SENDER`, `RATE_LIMIT_WINDOW_MS`, `MAX_RECIPIENTS_PER_CAMPAIGN`, `SEND_LEASE_MS` |
| Recovery      | `UNCERTAIN_DELIVERY_POLICY`, `RECONCILE_INTERVAL_MS`, `SHUTDOWN_GRACE_MS`                                                                                                                                                                   |

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

## Google OAuth setup

1. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID** →
   _Web application_.
2. Authorized JavaScript origin: `https://localhost:5173`.
3. Authorized redirect URI: `https://localhost:5173/api/auth/google/callback`.
4. OAuth consent screen: External; add your Google account as a test user.
5. Put the client id/secret in `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) and your email
   in `ADMIN_EMAILS` for Bull Board access.

## Slack app setup

1. https://api.slack.com/apps → **Create New App** → From scratch → your workspace.
2. OAuth & Permissions → Redirect URL `https://localhost:5173/api/integrations/slack/callback`;
   bot scopes `incoming-webhook`, `chat:write`.
3. Basic Information → copy Client ID / Client Secret into `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET`.
4. In the dashboard sidebar click **Connect Slack** and pick a channel.

---

## Testing

```bash
npm run typecheck      # all workspaces
npm run lint
npm run format:check
npm test               # unit + integration (integration needs `npm run infra:up`)
npm run test:unit      # no infrastructure needed
npm run build
```

Integration tests use a separate `outbox_test` database (migrated from empty on every run),
Redis db 1 and an in-process fake SMTP server. They cover migrations, UTC round trips,
idempotency, concurrent claims, retries, permanent/transient SMTP errors, receipt recovery,
uncertain delivery, hourly limits, rescheduling order, minimum delay, reconciliation after Redis
loss, Google/Slack OAuth (with fake providers), search and Bull Board authorization.

---

## Demo instructions

1. `npm run infra:up`, `npm run db:migrate`, `npm run dev`; open https://localhost:5173.
2. **Login with Google** → dashboard shows your name, email and avatar.
3. **Connect Slack** in the sidebar (optional) and pick a channel.
4. **Compose**: choose a sender, upload a CSV/TXT of addresses (the recipient count appears),
   enter subject and body, set _Delay between 2 emails_ (e.g. 5) and _Hourly Limit_ (e.g. 3),
   **Send Later** → pick a time a minute ahead → schedule.
5. **Scheduled** tab shows each email's time; https://localhost:5173/admin/queues shows the
   delayed jobs.
6. **Restart**: stop `npm run dev` (Ctrl+C) before the time, start it again → emails still send
   on time, once.
7. **Sent** tab → open an email → **Ethereal preview** link shows the delivered message.
8. **Rate limit**: with hourly limit 3 and more than 3 recipients, 3 send and the rest show as
   Rescheduled for the next hour; the Slack channel receives the limit alert.
9. **Search** for a recipient or subject word; use the filters and refresh.

---

## Trade-offs and known limitations

- **Fixed windows**: up to 2× the limit can be sent around a window boundary (bounded by the
  minimum gap). A sliding log would avoid this at higher cost.
- **At-most-once in the uncertain window** (see Idempotency); configurable.
- **Ordering** is preserved approximately; strict FIFO would need concurrency 1 per sender.
- **Gap jitter**: the gap is enforced when a send starts; the SMTP server can observe gaps a few
  tens of ms different (e.g. a worker's first, cold connection).
- **Search is eventually consistent** (≈ seconds behind MySQL).
- **Local only**: HTTPS uses a self-signed certificate; no hosted deployment is included. Google
  and Slack apps must be created with your own credentials.
- Email/password login, attachments, star/archive shown in the Figma are visual only.
