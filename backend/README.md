# PartyMaker backend

Independent NestJS REST API for the PartyMaker Expo application. Auth, Profile and the read-only Lobby catalog/details are connected to Expo, including Expo Web through an explicit CORS allowlist.

## Requirements

- Node.js 20.19 or newer
- npm 11 or newer
- Docker Desktop with Compose, or a local PostgreSQL 14+ server

The bundled Compose configuration exposes PostgreSQL on port `55432` to avoid colliding with a PostgreSQL instance already using `5432`.

## Start from a fresh clone

Run all commands from the `backend` directory.

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Replace the rejected `JWT_ACCESS_SECRET` placeholder in `.env` with the generated value, then continue:

```powershell
npm install
docker compose up -d
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:seed
npm run lint
npm run typecheck
npm test
npm run build
npm run start:prod
```

On macOS or Linux, replace the first command with `cp .env.example .env`.

When Docker is not available, create the database and user from `.env` in a local PostgreSQL installation, then run the same Prisma commands. `DATABASE_URL` is never hard-coded in application or Prisma source files; both read it from `.env`.

For an existing Windows cluster, make sure its loopback listener matches the hostname in `DATABASE_URL`. With `localhost`, listen on both `127.0.0.1` and `::1` (for example, start that cluster with PostgreSQL's `-h localhost`). An IPv4-only listener can cause a slow IPv6 fallback and Prisma transaction-acquisition timeouts; this is separate from CORS. Do not reinitialize the cluster or discard its data to fix the listener.

## Development

```powershell
docker compose up -d
npm run prisma:migrate:dev -- --name describe_change
npm run start:dev
```

- Health: <http://localhost:3000/api/v1/health>
- Swagger UI: <http://localhost:3000/docs>
- OpenAPI JSON: <http://localhost:3000/docs-json>

Stop the API with `Ctrl+C`. Stop PostgreSQL without deleting its data with:

```powershell
docker compose stop
```

## Validation and database commands

```powershell
npm run prisma:validate
npm run prisma:migrate:deploy
npm run prisma:seed
npm run lint
npm run typecheck
npm test
```

The seed is idempotent. It copies the four existing demo photos into the ignored `backend/uploads/demo` directory and creates users, current and historical lobbies, memberships, chat messages, moments, likes, comments, follows, invitations, and activity notifications. Seed users intentionally keep placeholder password hashes and are not valid authentication fixtures.

## Environment

- `DATABASE_URL` is required and is read only from `.env`.
- `JWT_ACCESS_SECRET` is required, must contain at least 32 characters, and must not equal the known value committed in `.env.example`. Generate a unique value before starting the API.
- `JWT_ACCESS_TTL_SECONDS` controls the access-token lifetime and defaults to `900`.
- `JWT_REFRESH_TTL_DAYS` controls the refresh-session lifetime and defaults to `30`.
- `PORT` defaults to `3000`.
- `CORS_ALLOWED_ORIGINS` defaults to an empty list (no cross-origin permission). For local Expo Web, use `http://localhost:8081`.

Do not commit `.env`. The committed `.env.example` contains development-only placeholders.

## Expo Web and CORS

Use the existing local PostgreSQL configured in `.env`, or start the Compose database above. Do not reset/recreate an existing database. After initial installation/migrations, start the API from `backend/`:

```powershell
# Process-scoped configuration; does not overwrite your .env.
$env:CORS_ALLOWED_ORIGINS = 'http://localhost:8081'
npm run build
npm run start:prod
```

In a second terminal, from the repository root:

```powershell
npm install
$env:EXPO_PUBLIC_API_BASE_URL = 'http://localhost:3000/api/v1'
npm run web -- --port 8081 --host localhost
```

Open `http://localhost:8081`. If Expo uses another port or hostname, update the backend allowlist and restart the API. `localhost` and `127.0.0.1` are different browser origins. Never put `DATABASE_URL`, `JWT_ACCESS_SECRET`, or any backend secret in `EXPO_PUBLIC_*`.

The allowlist is a comma-separated list of **serialized HTTP(S) origins**, for example `http://localhost:8081,https://app.example.com`. Whitespace around entries is ignored. Use lower-case scheme/host and omit default ports (`:80` for HTTP, `:443` for HTTPS). Wildcards, `null`, credentials, paths (including a trailing `/`), queries, fragments, and empty entries within a list are rejected at startup. Origins are matched exactly by scheme, host and port; subdomains and alternative ports are not implicitly allowed.

The shared `configureApp` applies the same policy in tests and production bootstrap. Allowed origins receive CORS headers on responses (including API errors) and preflight for GET, POST, PATCH, PUT and OPTIONS with Authorization and Content-Type. Cookie credentials are disabled. Unlisted origins receive **no Access-Control-Allow-Origin** header; the server may still process the request. CORS is a browser response-access policy, not authentication or network access control. Protected endpoints still require Bearer authentication. Requests without Origin continue to work for native clients and server tools.

`npm run test:cors` runs the CORS/configuration checks without PostgreSQL or `.env`. The same tests also run in `npm test`, alongside the database-backed Auth/Profile suite.

On web, refresh tokens remain **memory-only**; reloading the page requires explicit sign-in. There is no cookie or localStorage session persistence. Profile changes persist in PostgreSQL. Home loads real upcoming lobbies and read-only details. Lobby creation/joining, Search, Chat, Moments, Activity/Notifications and Media APIs remain unimplemented; their separate frontend sections are labeled demos.

## Auth and profile API

All routes use the `/api/v1` prefix.

- `POST /auth/register` accepts `email`, `password`, `handle`, and `displayName`; it creates a user and session and returns the auth response below.
- `POST /auth/login` accepts `email` and `password`; invalid email and password attempts share the same `401 INVALID_CREDENTIALS` response.
- `POST /auth/refresh` accepts `refreshToken`; it atomically rotates the session token and returns a new auth response. Reusing the old token returns `401 INVALID_REFRESH_TOKEN`.
- `POST /auth/logout` requires `Authorization: Bearer <access-token>` and returns `204`; it revokes only the session identified by the token's `sub` and `sid` claims.
- `GET /users/me` requires bearer authentication and returns the owner-safe profile.
- `PATCH /users/me` requires bearer authentication and accepts only `displayName`, `bio`, `city`, and `countryCode`. Nullable fields are cleared with `null`.
- `PUT /users/me/extroversion` requires bearer authentication and accepts `{ "level": 6.5 }`. The level must be from 1 through 10 in increments of 0.5.

Register is limited to 5 requests per minute per IP, and login to 10 requests per minute per IP. The official NestJS limiter currently uses in-memory storage for this single-instance/local MVP. Counters are not shared between backend instances, and proxy trust is intentionally not enabled yet.

Successful register, login, and refresh requests return:

```json
{
  "accessToken": "<short-lived-jwt>",
  "refreshToken": "<opaque-refresh-token>",
  "tokenType": "Bearer",
  "accessTokenExpiresIn": 900,
  "user": {
    "id": "<uuid>",
    "email": "user@example.com",
    "handle": "alex",
    "displayName": "Alex",
    "bio": null,
    "city": null,
    "countryCode": null,
    "extroversionLevel": 5.5,
    "createdAt": "<ISO-8601>",
    "updatedAt": "<ISO-8601>"
  }
}
```

Passwords are hashed with Argon2id. Refresh tokens are random opaque values; only their SHA-256 hashes are stored. Access JWTs contain `sub` (user id) and `sid` (session id). Logout revokes refresh for the current session; an access token already issued for it remains valid until its short TTL expires.

## Read-only Lobby API

Both endpoints require the existing Bearer access-token guard. Swagger documents their DTOs and validation errors; no database schema change is needed.

- `GET /api/v1/lobbies?limit=20&after=<cursor>` returns `{ "items": [...], "nextCursor": "..." }` (or `null` for the last page). `limit` is an integer from 1 to 50, default 20. `after` is the opaque keyset cursor returned by the preceding page; malformed cursors return `400 VALIDATION_FAILED`.
- The catalog includes only `PUBLISHED` events with `startsAt > now`, sorted by `startsAt ASC, id ASC`. Equal timestamps use id as the stable tie-breaker. Each request evaluates the current time; pages are not a frozen snapshot of concurrent event edits.
- `GET /api/v1/lobbies/:id` returns a published lobby, including a past published event. Missing, draft, cancelled or completed lobbies return `404 LOBBY_NOT_FOUND`; malformed UUIDs return validation error 400.

The explicit response projection contains only `id`, `title`, `description`, `category`, `startsAt` (absolute ISO timestamp), `timeZone`, `isOnline`, `venueName` (null for online events), `capacity`, `joinedCount`, `isJoined`, and `groupExtroversionLevel`. No participant lists, emails, credential hashes, raw tokens, coordinates or internal media storage keys are exposed. LEFT and REMOVED memberships do not count and do not set `isJoined`.

The group score is `round(sum(JOINED users' extroversionScoreX2) / joinedCount) / 2`: mean level rounded to the nearest half-level, with positive ties upward. It is null when no JOINED users exist. The client hides an absent score and uses category placeholders instead of exposing internal media paths. No distance is claimed without geographic search.

`npm test` includes database-backed Lobby tests using isolated random-UUID fixtures, cleaned up by their own ids; it never resets or reseeds the database. The seed updates fixed records, so do not rerun it just to refresh Home dates in an existing database. Existing past seed events correctly produce an empty upcoming catalog. For a manual smoke test, create isolated future PUBLISHED fixtures with known ids and clean up only those fixtures; see the root README for list/details/empty/error-retry steps.

## Error response

Every API error is normalized to this shape:

```json
{
  "statusCode": 400,
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request validation failed",
    "details": ["field must be a string"]
  },
  "path": "/api/v1/example",
  "timestamp": "2026-09-04T12:00:00.000Z"
}
```

Health, Auth, Profile and read-only Lobby endpoints are implemented. Lobby mutations, chat, moments, notifications and media APIs remain outside this stage; demo frontend records are kept separate from real lobbies.
