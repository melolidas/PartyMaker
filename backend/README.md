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

On the current PartyMaker Windows workstation, the existing PG17 cluster is `backend/.local-postgres/data`; its `PG_VERSION` and `postmaster.opts` identify PostgreSQL 17 and `-p 55432 -h localhost`. When that exact cluster is stopped, run from `backend/` (not against another installed PostgreSQL service):

```powershell
Get-Content .local-postgres/data/PG_VERSION
Get-Content .local-postgres/data/postmaster.opts
$partyMakerClusterPath = (Resolve-Path .local-postgres/data).Path
& 'C:/Program Files/PostgreSQL/17/bin/pg_ctl.exe' status -D $partyMakerClusterPath
# Only if this confirmed existing cluster is stopped:
& 'C:/Program Files/PostgreSQL/17/bin/pg_ctl.exe' start -D $partyMakerClusterPath -l .local-postgres/postgres.log -o '-p 55432 -h localhost' -w -t 30
& 'C:/Program Files/PostgreSQL/17/bin/pg_isready.exe' -h localhost -p 55432
```

Verify the connection from the unchanged `.env`: `current_database()` is `partymaker`, `current_setting('data_directory')` is that exact directory, and `inet_server_port()` is 55432. This is a restart of existing data, not provisioning: do not run initdb, reset, reseed, create a substitute DB or change DATABASE_URL to make tests pass. If the identity/path cannot be verified on another workstation, stop and investigate its actual setup instead.

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

On web, refresh tokens remain **memory-only**; reloading the page requires explicit sign-in. There is no cookie or localStorage session persistence. Profile changes, newly created lobbies and text messages persist in PostgreSQL. Home and Search load real upcoming lobbies, personal memberships and details with working join/leave. The paper-plane inbox loads available JOINED chats, including past PUBLISHED events. Activity now lists real LOBBY_JOINED events for organizers. Schedule editing/physical deletion, Moments, other notification types and media APIs other than profile avatars remain unimplemented; existing demo sections stay separate and labeled.

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
- 409 LOBBY_ORGANIZER_CANNOT_LEAVE: leaving as organizer; transfer is not implemented. Cancelling a future event is a separate organizer action.

**Concurrency:** both actions run in a PostgreSQL ReadCommitted transaction and first acquire a parameterized `SELECT id FROM "Lobby" WHERE id = ... FOR UPDATE` on the same parent row. Membership, startsAt and JOINED count are read/checked **after** obtaining the lock; writes and the response projection occur before releasing it at commit. Competing actions serialize per lobby across backend processes, not through an in-memory mutex. The existing (lobbyId, userId) primary key remains. A second join sees the first commit: either the same user's no-op or LOBBY_FULL, never an extra place. All future membership/capacity writers must honor this parent-row protocol; arbitrary SQL/imports bypassing it are outside the API guarantee. No Prisma schema/migration changes.

Concurrency tests hold the actual PostgreSQL row lock and observe both HTTP requests waiting in pg_stat_activity before release. They cover the last place, duplicate user joins and overlapping join/leave; no sequential simulation. See [PostgreSQL row locks](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS).

### POST /api/v1/lobbies/:id/cancel

Bearer is required. No body or query fields are accepted (400 VALIDATION_FAILED); malformed UUIDs return 400. Success is **200 `{ id, status: "CANCELLED" }`**, not a Lobby details DTO.

- Only Lobby.organizerId determines ownership, not membership/role/isJoined.
- Future PUBLISHED → CANCELLED. Started PUBLISHED → **409 LOBBY_STARTED**.
- Non-organizer of PUBLISHED → **403 LOBBY_ORGANIZER_REQUIRED**.
- Missing, DRAFT or COMPLETED → **404 LOBBY_NOT_FOUND**. CANCELLED is also hidden with 404 from non-organizers.
- Organizer replay of CANCELLED → the same 200, **before checking startsAt**. No repeated write, updatedAt change or history change, even after the scheduled start.

The ReadCommitted transaction takes the same parameterized Lobby `FOR UPDATE` row lock as join/leave/send, then rechecks existence, status, owner and time. First cancellation writes only status and the normal updatedAt. Membership rows/statuses/timestamps, messages and related records are neither deleted nor rewritten. A preceding join/leave/send retains its committed effect; if cancellation commits first, those later actions return LOBBY_NOT_FOUND. No in-memory lock, background job, new table, schema or migration is involved.

CANCELLED events disappear from all/mine/search/inbox; details and messages return 404, including for the organizer. Owner access to the idempotent cancel endpoint does not grant archive/history access. Reads already running before cancellation may finish against their earlier snapshot.

The client must validate the cancel POST receipt, not infer success from GET 404 or an absent card. An uncertain network/5xx/invalid response retains an in-memory target for an explicit same-id retry, even after startsAt; no automatic network retry. A successful receipt closes details and invalidates all available lobby/chat views for the current session. Restore/physical deletion, archive endpoints, cancellation notifications and organizer transfer remain unavailable.

`npm test` includes isolated PostgreSQL cancellation fixtures: ownership/status/time/field validation, history preservation, post-start replay without timestamp changes, visibility across all lists, and genuine overlapping cancel/cancel, cancel/join and cancel/send transactions in both applicable orders. The concurrency helper observes actual lock waits before releasing a blocker; requests are not a sequential imitation. Root README describes the two-user browser smoke and unconfirmed response/retry check.

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

Creation POST has no idempotency key or automatic network retry. A lost response can mean the record was already saved; inspect the catalog or personal list before explicitly resubmitting. The frontend only retries after a definite guard rejection (`401 INVALID_ACCESS_TOKEN`) using its existing refresh mechanism. Home and View all now show real upcoming participation. Organizer cancellation is documented above; completed-event history, schedule editing/physical deletion, invitations, push/other notification types, organizer transfer and lobby/message media remain out of scope.

`npm test` includes database-backed Lobby tests using isolated random-UUID fixtures, cleaned up by their own ids; it never resets or reseeds the database. The seed updates fixed records, so do not rerun it just to refresh Home dates in an existing database. Existing past seed events correctly produce an empty upcoming catalog. For a manual smoke test, create isolated future PUBLISHED fixtures with known ids and clean up only those fixtures; see the root README for list/details/empty/error-retry steps.

## Lobby text messages (REST, no realtime)

- `GET /api/v1/lobbies/:id/messages?limit=30&before=<opaque-cursor>` returns `{ items, nextCursor }`. Limit is an integer 1–50, default 30. Newest first: createdAt DESC, id DESC. Cursor encodes canonical UTC createdAt (four-digit AD year 0001–9999) and UUID; malformed cursors/queries, arrays, objects and unknown fields return 400 VALIDATION_FAILED. Lobby and deletedAt=null filters apply before pagination. Each GET checks access and reads history in one RepeatableRead transaction. A read begun before leave may finish; separate pages are not a frozen snapshot.
- `POST /api/v1/lobbies/:id/messages` accepts only `{ clientMessageId: UUID, body: string }`, no query fields. Trimmed body must have 1–2000 Unicode characters and no NUL (PostgreSQL text restriction). Author comes exclusively from Bearer, lobby from path, createdAt from the database clock. Existing LobbyMessage.id stores the client UUID; no new table, schema change or migration.
- First insert: **201**. Exact UUID + author + lobby + normalized body retry: **200**, same row and original createdAt. Different payload, author, lobby, or a deleted id: **409 MESSAGE_ID_CONFLICT**, without returning another message's content/author. No update on replay. A client must preserve the pair for explicit retry after an uncertain network result, not invent a fresh UUID.
- Both endpoints require Bearer and a current JOINED membership. Organizer access is through membership, not merely organizerId. Missing or non-PUBLISHED: **404 LOBBY_NOT_FOUND**; outsider/LEFT/REMOVED: **403 LOBBY_CHAT_FORBIDDEN**. A past PUBLISHED event remains chat-accessible. COMPLETED/CANCELLED archives are not supported.
- Safe DTO only: `id, lobbyId, body, createdAt, author: { id, displayName, handle }`. No full User, email, auth fields, deletedAt/editedAt, internal media keys or fabricated avatars.

POST uses the same Lobby `FOR UPDATE` row lock and ReadCommitted transaction as join/leave. It rechecks status/membership after locking, then inserts with PostgreSQL ON CONFLICT DO NOTHING (Prisma createMany/skipDuplicates), inspects the exact stored row and either returns the replay or raises the generic conflict. This also handles cross-lobby concurrent UUID collisions without an aborted P2002 transaction. If leave commits first, send is forbidden; if send commits first, its message remains saved. All future membership/status writers must follow the same parent-row lock protocol. See [Prisma bulk inserts and skipDuplicates](https://docs.prisma.io/docs/orm/v6/prisma-client/queries/crud).

`npm test` includes real PostgreSQL read/send, privacy, validation, deleted-history, tuple-pagination and idempotency tests. Concurrent send/replay and send/leave tests observe both HTTP transactions waiting on actual PostgreSQL locks, not sequential mocks. Fixtures are isolated and deleted only by their known ids.

Expo displays chronological history, older-page loading with a retained reading position, manual latest Refresh, confirmed sends and explicit same-id retries. Initial opening and a confirmed own send show the newest end; Refresh retains loaded history without forcing a reader of older messages down. No polling, chat notifications, attachments, reactions, read receipts, typing, message edit/delete or WebSocket. The separate real member list is described below.

## Available chat inbox

`GET /api/v1/chats?limit=20&after=<opaque-cursor>` requires the existing Bearer guard. It returns only PUBLISHED lobbies with a JOINED membership for the authenticated user, including already-started events. Organizer access is through that membership, not organizerId. LEFT/REMOVED, outsiders and non-PUBLISHED events are excluded before pagination. No userId/scope selector is accepted; `/lobbies?scope=mine` remains upcoming-only.

Response: `{ items, nextCursor }`. Each item contains only:

- `lobby: { id, title, category }`;
- `lastMessage: null | { id, preview, createdAt, author: { id, displayName } }`;
- `activityAt`: latest undeleted message createdAt, or Lobby.createdAt if there are no undeleted messages.

Latest-message order is `createdAt DESC, id DESC`; inbox order is `activityAt DESC, lobbyId DESC`. The preview is the first 160 Unicode code points of plain text (not HTML); no full history, email, auth fields or media storage keys. The query uses parameterized Prisma SQL with a LATERAL latest-message projection over the existing index, membership filtering, tuple cursor and limit+1 in **one PostgreSQL statement/snapshot**. There are no per-row history calls, JS sorting of all lobbies, duplicated lastMessage/activity columns, Chat table or migration.

Limit is an integer 1–50, default 20. Cursor encodes canonical UTC activityAt (four-digit AD year 0001–9999) and lobbyId UUID. Invalid parameters/cursors, arrays, objects and unknown query fields return **400 VALIDATION_FAILED** in the common error format. Cursor never substitutes for the JOINED filter. Pages are **not a frozen snapshot**: new messages may raise a chat above an already-passed cursor. Manual Refresh/reopening returns the current order; the UI deduplicates lobby ids.

The real paper-plane inbox and LiveLobbyChatScreen share one native Modal and source-aware Back labels. Confirmed sends/return refetch previews, and join/leave invalidates available chats. Inbox refresh does not reset a pending send. A detected conversation 403/404 blocks history/sending, removes the inaccessible row and refreshes available chats. Read/page errors have explicit retry; there is no demo fallback, total/unread counter, fabricated grouping, realtime, polling, chat search or COMPLETED/CANCELLED archive.

`npm test` includes real PostgreSQL inbox access, past/future membership, empty/deleted history, Unicode preview/privacy, same-timestamp pagination and activity-after-send checks. See the root README for the two-user browser scenario and 75-message scroll/anchor smoke test. Clean up only isolated fixture ids; never reset or reseed the existing database.

## Profile avatar API

The 5 MiB input boundary is **inclusive**: valid 5,242,879-byte and 5,242,880-byte images pass; 5,242,881 bytes returns `413 AVATAR_TOO_LARGE`. The multipart transport is bounded at `MAX_AVATAR_BYTES + 1`, because its parser rejects on reaching the configured limit. The normalizer still enforces the exact `buffer.length > MAX_AVATAR_BYTES` rejection before decoding. Other multipart/format/pixel/frame/metadata checks are unchanged. Real-DB HTTP tests use legal JPEG APP15 padding and verify normalized output, not just a direct validator call.

`POST /api/v1/users/me/avatar` requires Bearer and exactly one multipart file named `file`. Body/query fields (including ownerId, userId, mediaId and storageKey) are forbidden. The authenticated user is always the owner. Success is **200** `{ "avatar": { "id": "<uuid>", "width": 512, "height": 512, "mimeType": "image/jpeg" } }`. The common UserProfile mapper returns the same nullable `avatar` in GET/PATCH `/users/me`, extroversion update, login, register and refresh. Internal keys, paths, original filenames and private fields are never projected.

Input: static JPEG/PNG with matching declared MIME and actual decoded format, at most **5 MiB** compressed and **20,000,000 pixels** decoded. Multer limits the multipart buffer before processing; Sharp applies its pixel limit and a five-second processing deadline. Invalid/corrupt images, animation (including APNG) and other formats such as SVG/HEIC are rejected. Output is auto-oriented, center-cropped/resized to **512×512 JPEG**, flattened onto white, without source EXIF/GPS/XMP/ICC metadata. The original is not persisted or served. Errors use the existing envelope: `400 VALIDATION_FAILED` (multipart shape), `400 AVATAR_INVALID_IMAGE`, `413 AVATAR_TOO_LARGE`, `413 AVATAR_PIXEL_LIMIT`, `415 AVATAR_UNSUPPORTED_FORMAT`, `503 AVATAR_STORAGE_UNAVAILABLE`; DB failures use the existing 500 envelope. A lost/error response can have an uncertain commit outcome: re-read the profile before an explicit retry, never blindly retry an upload on network failure.

The local `uploads/avatars` directory is resolved from the backend working directory and created as needed. Start from `backend/` with write permission. The injected directory is overridden to an isolated temporary directory in tests. A fresh UUID determines the exact storage key `avatars/<uuid>.jpg`; client filenames never determine paths. The unique processed file is written and synced first, then a PostgreSQL transaction locks the User row `FOR UPDATE`, creates MediaAsset and replaces avatarMediaId. Concurrent replacements serialize on that row; the last committed assignment wins. Existing schema/relations are reused without migrations or seed changes.

`GET /api/v1/media/avatars/:id` is **public** and requires a UUID. It returns only a currently assigned avatar whose owner, kind, canonical server key, JPEG MIME and dimensions match the processed-avatar contract. It is not a generic MediaAsset endpoint or a static directory mount. Demo keys, other media, originals, temporary/orphan and former avatars are unavailable. Missing/unavailable files return `404 AVATAR_NOT_FOUND`. Responses use `Content-Type: image/jpeg`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`. Path containment is verified, including realpath before reading. Replacing a public avatar cannot revoke downloaded copies or a read already in progress.

There is no global DB/filesystem atomicity. Disk/processing failure preserves the old assignment. A failed/uncertain DB transaction deliberately does **not** delete the prepared file: it may already have been committed. Old MediaAsset rows/files are retained because other relations may still use them. Crash-orphan/old-file cleanup, storage quotas, avatar deletion, distributed storage, cloud/CDN and background jobs are deferred. Back up PostgreSQL and processed files together; do not purge the directory or all unassigned assets indiscriminately. `uploads/` and test artifacts are Git-ignored. This is a single-instance local MVP, not a general media platform.

`npm test` includes real-DB avatar ownership, multipart/decoder/size validation, metadata stripping, processing/disk/DB failure, ambiguous commit and overlapping row-lock replacement checks. It verifies public access restrictions and avatar persistence across login/refresh/profile edits. Tests use isolated users and an injected temporary directory and remove only their own fixture records/files. The browser smoke workflow is documented in the root README; native-device verification is separate.

## Read-only lobby participants

`GET /api/v1/lobbies/:id/members?limit=20&after=<cursor>` requires Bearer and the current user's JOINED membership, even if they are Lobby.organizerId. PUBLISHED events include past startsAt. Missing/DRAFT/CANCELLED/COMPLETED return `404 LOBBY_NOT_FOUND`; outsiders/LEFT/REMOVED return `403 LOBBY_MEMBERS_FORBIDDEN`.

Response: `{ items: [{ user: { id, displayName, handle, avatar }, isOrganizer, joinedAt }], nextCursor }`. Only JOINED rows are returned. `isOrganizer` compares Lobby.organizerId, not membership.role. The nullable avatar projection reuses `avatarSelect/toAvatar` with that participant's owner id and exposes only `{ id, width, height, mimeType }`. It is not the full UserResponseDto: no email, bio, location, extroversion, auth data or storage keys. Ordinary Lobby responses still do not embed participants.

Limit is 1–50, default 20. `after` is an opaque base64url cursor containing canonical UTC joinedAt and UUID userId. Order: joinedAt ASC, userId ASC. Invalid UUID/limit/cursor and unknown query fields return `400 VALIDATION_FAILED`. Access, lobby/status filtering, ordering and limit+1 pagination run inside one RepeatableRead transaction. No read-side FOR UPDATE and no in-memory whole-roster sorting. A cursor never bypasses membership or lobby filtering.

Each page shares an access/data snapshot, but separate pages are not frozen. External membership/profile changes require Refresh or reopening; an authorized read begun before leave/cancel may finish. Frontend observed 403/404 removes participant data and rechecks details. Existing models, schema and seed are unchanged. The PostgreSQL members e2e suite is included in `npm test` and uses only isolated fixture ids.

## PATCH /api/v1/lobbies/:id

Bearer and Lobby.organizerId ownership are required (membership.role does not grant editing). Only a future PUBLISHED lobby is editable. Send a nonempty partial body with changed `title` (trim, 1–40), `description` (trim, 1–200), existing `category`, integer `capacity` (2–2147483647), or the **complete pair** `isOnline`/`venueName`. Online requires null venue; offline requires a trimmed nonempty name up to 140 characters. Omitted properties are allowed, arbitrary null is not. Empty/invalid bodies, unknown fields and any query fields return `400 VALIDATION_FAILED`.

200 returns the existing safe Lobby DTO. Missing/non-PUBLISHED returns `404 LOBBY_NOT_FOUND`; a different organizer returns `403 LOBBY_ORGANIZER_REQUIRED`; started events return `409 LOBBY_STARTED`. Capacity below actual JOINED returns `409 LOBBY_CAPACITY_BELOW_JOINED`; below persisted minimum returns `409 LOBBY_CAPACITY_BELOW_MIN_PARTICIPANTS`. Effective capacity must be at least max(2, minParticipants, joinedCount); LEFT/REMOVED do not count. No automatic participant removal or minimum reduction.

ReadCommitted plus the shared Lobby FOR UPDATE serializes PATCH with join/leave/cancel/send. Status/organizer/start time and JOINED count are reread after the lock wait; the clock is sampled after acquiring the lock. Only provided fields are written, so independent patches do not overwrite one another. For the same field, last successful commit wins. There is no version/ETag conflict protocol. startsAt (including precision), timeZone, organizer, status, minParticipants, memberships/timestamps and messages remain unchanged except normal Lobby.updatedAt.

No edit notifications or schedule editing. External edits appear on manual refresh. Network uncertainty is not success: the frontend preserves the draft, permits a manual GET comparison and explicit PATCH retry, with only the existing bounded auth rejection retry. A GET is not a receipt for a particular PATCH. Tests include real overlapping PostgreSQL lock waits, capacity races, cancellation and a controlled clock advancing while a request waits. No schema/migration/seed changes are needed.

## Notifications: first limited Activity slice

Only `NotificationType.LOBBY_JOINED` is supported. `GET /api/v1/notifications?limit=20&after=<cursor>` requires Bearer, filters recipientId from that user and type BEFORE pagination, and returns `{ items, nextCursor }`. Limit is 1–50; order/cursor are createdAt DESC, id DESC. Unknown query fields, arrays/objects, unsupported dates/UUIDs and malformed cursors return 400 VALIDATION_FAILED. A RepeatableRead transaction provides a consistent bounded page and current related projections.

Each item: `{ id, type, createdAt, readAt, actor, lobby }`. Actor is null if deleted; otherwise only id/displayName/handle and the existing safe processed-avatar mapper. Lobby is id/title only while PUBLISHED, otherwise null. No email/recipientId/auth/storage paths/Moment/Comment relations are serialized. Titles and names are current related values, not immutable snapshots; the event is historical and does not guarantee current JOINED membership. Cancellation preserves the stored notification but hides its lobby. Other seed notification types remain stored, excluded from this API; no backfill/reseed.

Real absent/LEFT → JOINED transitions create the notification under the same Lobby FOR UPDATE and PostgreSQL transaction as membership. Notification failures roll back participation. Repeated/concurrent already-JOINED requests, leave, refused joins, organizer self-joins and automatic organizer creation do not notify. Real rejoins create a new UUID, not a unique recipient/actor/lobby tuple.

`POST /api/v1/notifications/:id/read` accepts no body/query fields and returns 200 `{ id, readAt }`. The conditional UPDATE includes id/recipientId/type/readAt=null; concurrent requests recheck after the row lock and preserve the first readAt. Foreign/missing/unsupported IDs all return 404 NOTIFICATION_NOT_FOUND, including after being read. There is no read-all/unread/delete endpoint. Both endpoints are in Swagger and `npm test`; tests include real overlapping PostgreSQL transactions and isolated notification-insert failure/rollback.

`GET /api/v1/notifications/unread-count` requires Bearer, accepts no query parameters and returns only `{ unreadCount: nonnegative integer }`. It uses a database COUNT with recipientId=current user, type=LOBBY_JOINED and readAt=null, not list pagination or loaded rows. Null actor/lobby and cancelled-lobby notifications still count; other types and read records do not. Reading the same event repeatedly does not decrement twice. Existing indexes/schema/seed remain unchanged. Swagger and PostgreSQL tests cover isolation, more than one page, null relations, cancellation and idempotent read.

The frontend uses this total for the Activity navigation badge (1–99/99+, unknown/error distinguished from zero). Refresh points are authenticated startup, Activity opening/Refresh and confirmed read-state changes, not realtime. No push, polling or other notification types. No Prisma schema/migration or auth lifecycle changes.

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

Health, Auth, Profile including public avatars, Lobby creation/cancellation, catalog/details, join/leave, per-lobby text messages and the available-chat inbox are implemented. Basic organizer editing and LOBBY_JOINED Activity/read are also implemented. Other Lobby mutations, moments, other notification types and media other than profile avatars remain outside this stage; demo frontend records are kept separate from real lobbies.
