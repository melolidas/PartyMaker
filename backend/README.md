# PartyMaker backend

Independent NestJS REST API for the PartyMaker Expo application. Auth, Profile, Lobby creation and catalog/details are connected to Expo, including Expo Web through an explicit CORS allowlist.

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

On web, refresh tokens remain **memory-only**; reloading the page requires explicit sign-in. There is no cookie or localStorage session persistence. Profile changes and newly created lobbies persist in PostgreSQL. Home and Search load real upcoming lobbies, personal memberships and details with working join/leave. Editing/deleting lobbies, Chat, Moments, Activity/Notifications and Media APIs remain unimplemented; existing demo sections stay separate and labeled.

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

## Lobby API: catalog, personal upcoming list, details and creation

All Lobby endpoints require the existing Bearer access-token guard. Swagger documents their DTOs and validation errors; no database schema change is needed.

### Literal search

Optional `q` on `GET /api/v1/lobbies` is a string, trimmed, maximum 100 characters. Missing or whitespace-only q retains the ordinary catalog. Match is a case-insensitive substring of **title OR venueName** (not description). `%`, `_` and `\` are escaped as literal characters, not patterns. Arrays, nested objects and overlong strings return the existing `400 VALIDATION_FAILED` envelope.

Search requires PostgreSQL's built-in deterministic ICU collation `und-x-icu` (available on the configured local PostgreSQL). A parameterized query uses it explicitly for Cyrillic and Latin, even when database locale is `C`; no user input is interpolated as SQL. Search, future PUBLISHED visibility, Bearer JOINED membership for mine, and tuple cursor conditions are all combined **before** startsAt/id ordering and limit. The matching page ids and existing safe DTO are read in one RepeatableRead transaction. No internal raw rows are returned; whole-group statistics are unchanged. Missing/blank q keeps the original Prisma catalog path. Separate cursor requests are not a fixed snapshot.

Check ICU availability on a separately provisioned database with `SELECT collname FROM pg_collation WHERE collname = 'und-x-icu';`. No extension, schema migration, alternate search service, ranking, word splitting or geographic search is added. Large-volume substring indexing is deferred. See [PostgreSQL pattern matching](https://www.postgresql.org/docs/17/functions-matching.html) for literal escaping and collation-dependent ILIKE behavior.

Example: `GET /api/v1/lobbies?scope=mine&q=Sport%20Court&limit=20&after=<opaque-cursor>`. Reuse the same q/scope for subsequent pages; reset after when changing search. No total count is reported. Real PostgreSQL tests cover Cyrillic/Latin case, literal metacharacters, malformed q, hidden/past events, mine and equal-time multi-page cursor composition using only isolated fixtures.

- `GET /api/v1/lobbies?limit=20&after=<cursor>` returns `{ "items": [...], "nextCursor": "..." }` (or `null` for the last page). `limit` is an integer from 1 to 50, default 20. `after` is the opaque keyset cursor returned by the preceding page; malformed cursors return `400 VALIDATION_FAILED`. Cursor dates must be canonical UTC ISO timestamps with a four-digit AD year (0001–9999); extended years such as `+275760` are rejected before Prisma rather than producing 500.
- The catalog includes only `PUBLISHED` events with `startsAt > now`, sorted by `startsAt ASC, id ASC`. Equal timestamps use id as the stable tie-breaker. Each request evaluates the current time; pages are not a frozen snapshot of concurrent event edits.
- `scope=all|mine` is optional, default `all` (unchanged catalog). `GET /api/v1/lobbies?scope=mine&limit=20&after=<cursor>` adds a JOINED membership filter for the Bearer user, still restricted to future PUBLISHED events. Organizer participation comes through the actual membership created with POST; organizerId alone is insufficient. LEFT/REMOVED, past and unpublished events are excluded. Invalid scope or userId/organizerId query parameters return `400 VALIDATION_FAILED`; clients cannot select another user's list. Pagination is independent of all, with the same tuple ordering and bounds. No total count is returned.
- `GET /api/v1/lobbies/:id` returns a published lobby, including a past published event. Missing, draft, cancelled or completed lobbies return `404 LOBBY_NOT_FOUND`; malformed UUIDs return validation error 400.

The explicit response projection contains only `id`, `title`, `description`, `category`, `startsAt` (absolute ISO timestamp), `timeZone`, `isOnline`, `venueName` (null for online events), `capacity`, `joinedCount`, `isJoined`, `membershipStatus` (the Bearer user's status or null), `isOrganizer` (from organizerId, not isJoined), and `groupExtroversionLevel`. No participant lists, emails, credential hashes, raw tokens, coordinates or internal media storage keys are exposed. LEFT and REMOVED memberships do not count and do not set `isJoined`.

The group score is `round(sum(JOINED users' extroversionScoreX2) / joinedCount) / 2`: mean level rounded to the nearest half-level, with positive ties upward. It is null when no JOINED users exist. In mine, both count and score still use **all** JOINED members, not only the requesting user. The client hides an absent score and uses category placeholders instead of exposing internal media paths. No distance is claimed without geographic search.

### POST /api/v1/lobbies/:id/join and /:id/leave

Both return **200** with the same current safe Lobby DTO. No body/query fields are accepted (omit the body or send an empty JSON object); userId, role, status and other fields return 400 VALIDATION_FAILED. Only the Bearer membership can change. Malformed id: 400; absent/unpublished lobby: 404 LOBBY_NOT_FOUND; missing/invalid Bearer: 401 INVALID_ACCESS_TOKEN.

- Join: JOINED is a successful no-op, even if full or already started; joinedAt and counts do not change. No membership / LEFT can join before startsAt if a place exists. LEFT reuses the same composite-key row, sets a fresh joinedAt and clears leftAt. REMOVED cannot self-rejoin.
- Leave: organizer is blocked. Ordinary JOINED transitions to LEFT only before startsAt, setting leftAt and preserving joinedAt/role. LEFT and absent memberships are successful no-ops, including after startsAt; no row is inserted. REMOVED is rejected, never changed to LEFT.
- 409 LOBBY_FULL: no free place for a real join (organizer occupies a place).
- 409 LOBBY_STARTED: a real membership transition was requested after the event started.
- 409 LOBBY_MEMBERSHIP_REMOVED: self-changing a REMOVED membership, including the leave → join bypass.
- 409 LOBBY_ORGANIZER_CANNOT_LEAVE: leaving as organizer; transfer/cancellation are not implemented.

**Concurrency:** both actions run in a PostgreSQL ReadCommitted transaction and first acquire a parameterized `SELECT id FROM "Lobby" WHERE id = ... FOR UPDATE` on the same parent row. Membership, startsAt and JOINED count are read/checked **after** obtaining the lock; writes and the response projection occur before releasing it at commit. Competing actions serialize per lobby across backend processes, not through an in-memory mutex. The existing (lobbyId, userId) primary key remains. A second join sees the first commit: either the same user's no-op or LOBBY_FULL, never an extra place. All future membership/capacity writers must honor this parent-row protocol; arbitrary SQL/imports bypassing it are outside the API guarantee. No Prisma schema/migration changes.

Concurrency tests hold the actual PostgreSQL row lock and observe both HTTP requests waiting in pg_stat_activity before release. They cover the last place, duplicate user joins and overlapping join/leave; no sequential simulation. See [PostgreSQL row locks](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS).

### POST /api/v1/lobbies

Returns **201** with the same safe Lobby DTO. Required JSON fields:

- `title`: trimmed string, 1–40 Unicode characters.
- `description`: trimmed string, 1–200 characters.
- `category`: DRINKS, GAMING, FOOD, SPORT, MOVIES or OUTDOORS.
- `startsAt`: a real future RFC3339 instant with explicit `Z` or `±HH:MM`, seconds and optional 1–3 fractional digits. Both civil and UTC years must be 0001–9999. Invalid calendar dates, implicit local time, 24:00 and extended years are rejected.
- `timeZone`: valid named IANA zone (up to 64 characters), e.g. `Asia/Bishkek`; numeric offset strings are not IANA zones. It controls display and does not override the absolute instant.
- `capacity`: integer 2–2147483647 (PostgreSQL INTEGER range, not a new product limit).
- `isOnline`: JSON boolean, not a string or number.
- `venueName`: explicitly null online; trimmed nonempty string up to 140 characters offline.

The authenticated user supplies `organizerId` implicitly through the guard. The server sets `status=PUBLISHED` and `minParticipants=2`. Unknown/internal fields (`organizerId`, `status`, `members`, `id`, media, etc.) return `400 VALIDATION_FAILED`, as do invalid inputs. A nested Prisma create atomically inserts the lobby and exactly one organizer membership (`role=ORGANIZER`, `status=JOINED`); a child-insert failure rolls back the lobby. The response immediately reports `joinedCount=1`, `isJoined=true` and the organizer's real group score.

POST has no idempotency key or automatic network retry. A lost response can mean the record was already saved; inspect the catalog or personal list before explicitly resubmitting. The frontend only retries after a definite guard rejection (`401 INVALID_ACCESS_TOKEN`) using its existing refresh mechanism. Home and View all now show real upcoming participation. Completed-event history, editing/deleting, invitations, notifications, organizer transfer, cancellation and Media remain out of scope.

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

Health, Auth, Profile, Lobby creation, catalog/details and join/leave are implemented. Other Lobby mutations, chat, moments, notifications and media APIs remain outside this stage; demo frontend records are kept separate from real lobbies.
