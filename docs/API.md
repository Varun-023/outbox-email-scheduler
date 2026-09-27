# OutBox API Reference

All endpoints are served by the Express API (port `4000`) and reached through the Vite dev
server's same-origin proxy at `https://localhost:5173`. JSON only. Authenticated endpoints use
the `outbox.sid` session cookie (HttpOnly, SameSite=Lax, Secure over HTTPS) set by Google sign-in.

Every error response uses one envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "…",
    "details": [{ "path": "recipients[1].email", "message": "Invalid email address" }],
    "requestId": "…"
  }
}
```

Codes: `BAD_REQUEST` / `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401), `FORBIDDEN` (403),
`NOT_FOUND` (404), `PAYLOAD_TOO_LARGE` (413), `IDEMPOTENCY_KEY_REUSED` (422),
`SERVICE_UNAVAILABLE` / `SEARCH_UNAVAILABLE` (503), `INTERNAL` (500). Each response carries an
`X-Request-Id` header.

## Auth

| Method | Path                        | Auth | Description                                                                                                                                                                                     |
| ------ | --------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/auth/google`          | –    | Browser navigation. Starts Google OAuth (PKCE S256, state, nonce) and redirects to Google. Optional `?returnTo=/path` (relative paths only).                                                    |
| GET    | `/api/auth/google/callback` | –    | Google redirects here. Verifies state and ID token (`email_verified` required), upserts the user, regenerates the session, redirects to `returnTo`. Failures redirect to `/login?error=<code>`. |
| GET    | `/api/auth/me`              | ✓    | `200 { "user": { "id", "name", "email", "avatarUrl" } }` or `401`.                                                                                                                              |
| POST   | `/api/auth/logout`          | –    | Destroys the Redis session and clears the cookie. `204`.                                                                                                                                        |

## Senders

| Method | Path           | Auth | Description                                                                                                                                                                                                                                                                                   |
| ------ | -------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/senders` | ✓    | `200 { "items": [{ "id", "label", "fromName", "fromEmail", "provider": "ethereal", "hourlyLimit", "minDelayMs" }] }`. Creates `AUTO_PROVISION_SENDERS` Ethereal senders on first use (Redis lock prevents duplicates). SMTP credentials are never returned. `503` if Ethereal is unreachable. |

## Campaigns

`POST /api/campaigns` — Auth ✓. Header **`Idempotency-Key`** (required, 1–64 printable ASCII).

```json
{
  "senderId": "uuid",
  "subject": "Meeting follow-up",
  "bodyHtml": "<p>Hi…</p>",
  "recipients": [{ "email": "john@example.com", "name": "John" }],
  "startAt": "2026-10-01T09:00:00Z",
  "delayBetweenEmailsSeconds": 5,
  "hourlyLimit": 50
}
```

- `startAt` optional (default now; not in the past; within `MAX_SCHEDULE_AHEAD_DAYS`).
- `delayBetweenEmailsSeconds` 0–3600, raised to the sender's minimum gap.
- `hourlyLimit` ≤ the sender's hourly limit (default: the sender limit).
- Recipients are normalised and de-duplicated; invalid addresses → `400` listing up to 20.
- HTML is sanitised; a plain-text part and preview are derived.

Responses:

- `201` — new campaign; one MySQL row and one BullMQ delayed job (`email-<emailId>`) per recipient.
- `200` + `Idempotent-Replayed: true` — same key and same body replayed.
- `422 IDEMPOTENCY_KEY_REUSED` — same key, different body.
- `404` — sender not found / not owned.

```json
{
  "campaign": {
    "id", "senderId", "subject", "recipientCount", "startAt",
    "effectiveDelaySeconds", "effectiveHourlyLimit",
    "firstScheduledAt", "lastScheduledAt",
    "queueStatus": "queued | pending", "createdAt"
  },
  "recipients": { "accepted": 2, "duplicatesRemoved": 1 }
}
```

`queueStatus: "pending"` means the rows are committed in MySQL but Redis was unavailable; the
maintenance reconciler enqueues the jobs later.

## Emails

| Method | Path                 | Auth | Description                                                                                                                                                                                                                                                                            |
| ------ | -------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/emails`        | ✓    | Query: `folder=scheduled\|sent` (required), `status`, `rescheduled=true\|false`, `senderId`, `cursor`, `limit` (1–100, default 25). Scheduled: `scheduledAt` ascending; Sent (sent + failed): `completedAt` descending. `200 { "items": EmailSummary[], "nextCursor": string\|null }`. |
| GET    | `/api/emails/counts` | ✓    | `200 { "scheduled": n, "sent": n }` (sent includes failed).                                                                                                                                                                                                                            |
| GET    | `/api/emails/:id`    | ✓    | Email detail: summary + `bodyHtml`, `fromName`, `attemptCount`, `messageId`, `previewUrl` (Ethereal), `errorCode`, `errorMessage`, `originalScheduledAt`, `campaign {…}`. `404` if not owned, `400` for a malformed id.                                                                |

`EmailSummary`: `id, campaignId, to, toName, subject, preview, status (scheduled|sending|sent|failed), scheduledAt, sentAt, completedAt, deferCount, lastDeferredReason, sender { id, fromEmail }`.

## Search

| Method | Path                 | Auth | Description                                                                                                                                                                                                                                                 |
| ------ | -------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/emails/search` | ✓    | Elasticsearch full-text search. Query: `q` (required), `folder`, `status`, `limit`. Always filtered to the signed-in user. Same response shape as `/api/emails`. `503 SEARCH_UNAVAILABLE` if Elasticsearch is down (scheduling and sending are unaffected). |

## Slack

| Method | Path                                 | Auth    | Description                                                                                                                                                             |
| ------ | ------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/integrations/slack/authorize`  | ✓       | Browser navigation. Redirects to Slack OAuth v2 (`incoming-webhook,chat:write`) with an encrypted, expiring state.                                                      |
| GET    | `/api/integrations/slack/callback`   | session | Slack redirects here. Must be the same signed-in user who started the flow. Stores the encrypted webhook/token and redirects to `/?slack=connected` or `/?slack=error`. |
| GET    | `/api/integrations/slack`            | ✓       | `200 { "configured", "connected", "teamName"?, "channelName"?, "connectedAt"? }`.                                                                                       |
| POST   | `/api/integrations/slack/disconnect` | ✓       | Revokes the connection. `204`.                                                                                                                                          |

## Health

| Method | Path                | Auth | Description                                                                                                                                                             |
| ------ | ------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/health`       | –    | Liveness: `200 { "status": "ok", "uptimeSec" }`.                                                                                                                        |
| GET    | `/api/health/ready` | –    | Readiness: `{ "status": "ok\|degraded\|unavailable", "checks": { "mysql", "redis", "elasticsearch" } }`. MySQL/Redis down → `503`; Elasticsearch down → `200 degraded`. |

## Bull Board

`/admin/queues` — live BullMQ dashboard (queues: `emails`, `notifications`, `search-sync`,
`maintenance`). Requires a signed-in session whose email is in `ADMIN_EMAILS`; otherwise `401`/`403`.
Read-only unless `BULL_BOARD_READ_ONLY=false` (the default outside development is read-only).
