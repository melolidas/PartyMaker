# PartyMaker

Dark social meetup app concept built with Expo, React Native and TypeScript.

## Run locally

```bash
npm install
npm run typecheck
npm test
npm start
```

Scan the QR code with Expo Go or press `a` to open an Android emulator.

## Auth/Profile and Lobby integration

Start the local NestJS backend separately using [the backend setup instructions](backend/README.md). Set `EXPO_PUBLIC_API_BASE_URL` in the shell or in your local `.env` (copy `.env.example` only if `.env` does not already exist). The value is public Expo configuration, must be an absolute HTTP(S) URL, and must end in `/api/v1`. Never put `JWT_ACCESS_SECRET`, `DATABASE_URL`, passwords, or other backend secrets in the Expo environment.

Choose the URL for the device running Expo:

- Web or an iOS simulator on the same computer: `http://localhost:3000/api/v1`.
- Android emulator: usually `http://10.0.2.2:3000/api/v1`.
- Physical iOS or Android device: use the development computer's reachable LAN address, for example `http://192.168.1.25:3000/api/v1`. The phone and computer must be on the same network, and the backend port must be reachable through the local firewall.

The frontend now uses these backend endpoints through one typed API client:

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /users/me`
- `PATCH /users/me`
- `PUT /users/me/extroversion`
- `POST /users/me/avatar` (one multipart `file`)
- `GET /media/avatars/:id` (public, currently assigned processed avatar only)
- `GET /lobbies?scope=all|mine&q=<literal-search>&limit=20&after=<opaque-cursor>`
- `GET /lobbies/:id`
- `POST /lobbies`
- `POST /lobbies/:id/join`
- `POST /lobbies/:id/leave`
- `GET /lobbies/:id/messages?limit=30&before=<opaque-cursor>`
- `POST /lobbies/:id/messages`

The access token exists only in application memory. On iOS and Android, the refresh token is stored with Expo SecureStore. On web, the refresh token is intentionally kept in memory and is never written to `localStorage`, so a browser-page refresh requires signing in again.

At startup, the app rotates a stored refresh token and then loads `/users/me`. Protected requests receive the in-memory access token. One `401 INVALID_ACCESS_TOKEN` can trigger one shared refresh operation and one request retry. A failed refresh attempts local invalidation; a storage failure is reported rather than presented as a successful session clear. Logout performs durable local invalidation first and completes without waiting for the backend; server revocation is best-effort using the current access token or an already-running refresh operation.

Refresh persistence uses a write-ahead protocol: an acknowledged `pending` operation record precedes the token envelope, and an operation-specific `committed` result follows the completed token write. Reads require matching operation ids, a committed result, no operation tombstone, and an unchanged revocation barrier. Logout changes that independent barrier; credential writers never remove it. Quarantine also writes an append-only tombstone for the exact operation, which a late writer cannot undo. Unknown records and old unversioned tokens are not restored (existing installations must sign in again).

**Confirmed logout vs. storage error:** durable clear requires an acknowledged revocation barrier, even when deleting the token succeeds. A fresh storage wrapper cannot know whether another writer is still pending, and deletion alone cannot revoke a late token write. When `logout()` returns `SESSION_STORAGE_ERROR`, logout is **not confirmed**: no successful session-cleared callback is emitted, and the current shared client context stays fenced against restore, refresh, and protected requests. The same error from recovery means readiness is unconfirmed; it does not undo an earlier confirmed logout.

**Logout confirmation is not recovery readiness.** A successful logout confirms revocation of the old credentials; it does not prove that a foreign writer has finished or that a new session can be stored. Recovery has a separate `ready` result and always performs the storage adapter's read-only `assertReadyForNewSession` check, including with a fresh raw adapter/wrapper and no local quarantine. A missing/unknown terminal result, malformed record, or changed operation head fails that check. Logout never waits for this readiness read.

Once unresolved/unknown storage state is detected, a shared in-memory readiness fence prevents subsequent login/register network requests, restore, and refresh. Confirmed logout does not reset that fence: its callback reports that storage recovery is still required, and the login screen keeps the error and disabled sign-in action. Only an explicit recovery with confirmed readiness clears it. A fresh wrapper never deletes pending evidence or invents an `aborted` result; the owning runtime must safely reconcile its old operation. After that proof is available, retry recovery succeeds and the user may explicitly sign in.

Storage mutations have a five-second deadline. A timeout returns `SESSION_STORAGE_ERROR` and quarantines the shared session immediately, without awaiting further marker writes or cleanup. Login, restore, and protected requests fail locally while quarantined. Reconciliation waits in the background for **all** original mutation and quarantine I/O to settle, confirms a durable revocation barrier, and records `aborted` before permitting another explicit login.

If reconciliation temporarily fails, use **Retry recovery / Повторить восстановление** on the login/register screen. The same action is available from the profile after a logout storage error. It goes through AuthProvider → ApiClient → SessionCoordinator, coalesces repeated requests (including clients sharing storage), and never starts competing cleanup. Known unresolved quarantined I/O produces an error immediately; each reconciliation/readiness observation has a five-second deadline. Timeout does not cancel cleanup, release quarantine, or clear the readiness fence. Readiness checks use the read lane, not the mutation lane: a stalled check cannot hold up durable clear or a later retry, and its late result cannot release a fence or change a newer session. The action remains retryable, shows an error if readiness is unconfirmed, and enables an explicit sign-in only after recovery succeeds; it never signs in automatically.

**Restart limitation:** a timeout is an in-memory safety boundary, not proof of durable invalidation. Pending/unknown persistent records are not restored, and a new runtime never clears them merely because its WeakMap is empty. However, if a delayed `committed` write physically completes while revocation/tombstone writes are unavailable, a new runtime can observe matching committed credentials. Without confirmed durable cleanup (or confirmed server revocation), absence of session restoration after restart cannot be guaranteed. The regression suite explicitly covers this limit. If the process dies with an unresolved pending writer and no terminal proof, recovery cannot safely unlock it automatically. No extra markers are added to claim a stronger guarantee.

Profile name, bio, city, country code, extroversion level and avatar are backed by the API. Home's upcoming catalog, Your lobbies / View all, Search, lobby details, Create Lobby, the paper-plane chat inbox and lobby text chat use PostgreSQL through the same authenticated ApiClient. Gallery, stats and Moments remain demos; Activity now shows real LOBBY_JOINED notifications. Real joining/leaving and organizer cancellation work, including from search results. Basic organizer editing is available for future lobbies. Invitations, push/other notification types, organizer transfer, schedule editing, physical deletion and media other than profile avatars are not implemented.

### Profile avatars: limited local Media slice

Profile → **Change avatar / Изменить аватар** opens the photo library (one image, no camera/microphone), then a preview with explicit confirmation or cancellation. JPEG/PNG only: 5 MiB maximum input, 20 million decoded pixels, one static frame. The server verifies the actual image and matching MIME, auto-orients, crops to 512×512 and writes JPEG without original EXIF/GPS/metadata. The original is not saved. Missing/unloadable avatars use a neutral icon; the gallery and statistics remain labeled demo data.

The avatar is **public**: anyone with its URL can download it without signing in. The URL comes from the existing configured API base, never a hardcoded host. Replaced/unassigned files are not served, but replacing an avatar cannot revoke already-downloaded public copies or an in-flight download. No avatar deletion feature is included.

The same nullable `avatar: { id, width, height, mimeType }` is returned by the common user DTO in login/register/refresh and profile responses. Upload returns only `{ avatar }`. Avatar, text-profile and extroversion responses merge only their own fields; a late avatar read cannot undo a newer replacement. Closing the editor, logout and account switch discard late picker/upload/read results. Multipart uses fresh FormData for the existing single retry after an explicit `401 INVALID_ACCESS_TOKEN`, without manually setting Content-Type/boundary. Network/5xx/malformed responses never auto-retry or claim success: **Reload profile avatar**, inspect the confirmed image, then explicitly retry if needed. Reloading is not presented as confirmation of the earlier upload.

Run the API from `backend/`; it creates `uploads/avatars` locally and needs write permission there. This folder is ignored by Git. PostgreSQL stores MediaAsset metadata and the avatar assignment; the filesystem stores only processed JPEGs. Files are prepared before a user-row-locked DB transaction changes the assignment. The old avatar remains assigned until commit. PostgreSQL and disk do **not** share an atomic transaction: uncertain DB failures deliberately retain prepared files. Old assets/files and crash-orphans are retained; automatic cleanup, quotas, shared/multi-instance storage, CDN and backups are not implemented. Do not indiscriminately delete old assets because they may have other relations. See [backend avatar contract](backend/README.md#profile-avatar-api) for validation/error details.

Dependencies added for this slice: SDK-compatible `expo-image-picker`, backend `sharp`, and development-only `@types/multer`. The picker config disables camera/microphone permissions; native config changes require rebuilding a standalone/dev app. Expo Go uses its bundled picker. Browser regression: two isolated accounts, choose → preview/cancel → confirm → replace → sign out/in → verify persisted avatar and account separation. A browser check is not a physical-phone check.

Verified locally in Expo Web with PostgreSQL: PNG selection/preview/cancellation, confirmed upload, JPEG replacement, persisted 512×512 image after sign-out/sign-in, separate avatars for two accounts, and the matching bottom-nav avatar. Only the two test accounts and their three processed files were removed afterward. Automated checks: frontend 284 tests/typecheck; backend 103 tests/typecheck/lint/build. A physical phone was not available for this check. Existing dependency versions were not upgraded; only the picker/image-processing dependencies and their transitive packages were added.

Avatar corrective patch: **Reload profile avatar** also retries the image itself, even when `/users/me` returns the same media id. A successful current manual read publishes an account/session-bound retry key shared by Profile, the editor and bottom navigation. It remounts the image with a fresh request URL (`?retry=...`); no token or private data is put in the URL. A repeated image failure leaves the neutral placeholder until another explicit refresh. Old image errors and late profile reads cannot invalidate a newer request/account or overwrite independent profile edits. The refresh message confirms only the metadata read, not image delivery or a previously uncertain upload.

The input limit is inclusive: **5,242,880 bytes is accepted**, larger input returns `413 AVATAR_TOO_LARGE`. Regression fixtures are valid JPEGs with legal APP15 segments at MAX−1/MAX/MAX+1, exercised through multipart HTTP and the real decoder. Browser recovery is checked using a temporary 404 for only one isolated test avatar (its own file is temporarily moved and restored); the API and database remain running. All three images recover with the same id after manual refresh; a different account has no inherited image/retry state. This tests image-HTTP-error recovery, not a physical phone or an actual radio/network outage. Corrective-patch checks: frontend 287 tests/typecheck; backend 104 tests/typecheck/lint/build against the original PartyMaker PostgreSQL cluster on localhost:55432, without reset/reseed or a connection change.

### Run Auth/Profile in Expo Web

Use the PostgreSQL already configured in `backend/.env`, or follow the backend README's Docker Compose setup and initial migrations. In one PowerShell terminal, from the repository root:

```powershell
Set-Location backend
$env:CORS_ALLOWED_ORIGINS = 'http://localhost:8081'
npm run build
npm run start:prod
```

In another terminal, from the repository root:

```powershell
$env:EXPO_PUBLIC_API_BASE_URL = 'http://localhost:3000/api/v1'
npm run web -- --port 8081 --host localhost
```

Open `http://localhost:8081`. These process-scoped settings do not overwrite existing `.env` files. Register a test user, open Profile, edit the name/extroversion, then sign out and back in to verify persistence. Reloading the web page deliberately returns to sign-in because web refresh tokens are memory-only.

Backend CORS defaults to no cross-origin permission. `CORS_ALLOWED_ORIGINS` accepts explicit comma-separated serialized HTTP(S) origins, without a trailing slash, credentials, path, query, fragment, wildcard or `null`. Use lower-case scheme/host and omit default ports. The browser's scheme, host and port must match exactly: `http://localhost:8081` does not allow `http://127.0.0.1:8081` or a different port. If Expo's address changes, update the allowlist and restart the API. Bearer Authorization and JSON preflight are enabled for allowed origins; cookie credentials are not. Native clients do not need an Origin header. CORS does not replace endpoint authorization or protect the API from non-browser callers.

## Included screens

- Home with independent real upcoming catalog and personal upcoming lobbies
- Your lobbies / View all: a paginated real list of the current user's upcoming JOINED memberships
- Search: real PostgreSQL substring search by title or venue, with paginated results and membership actions
- Live text chat opened from real lobby details or the Home paper-plane inbox (JOINED only, manual refresh)
- Real chat inbox including already-started PUBLISHED events, ordered by latest message activity
- Moments social feed
- Create Lobby: real form and atomic PostgreSQL creation with organizer membership
- Activity: real organizer join notifications, individual read action, manual refresh
- Profile with real editable avatar and a separately labeled demo photo gallery

## Languages

The interface automatically uses the device's primary language via `expo-localization`:

- Russian (`ru`, including `ru-RU` and `ru-KG`) → Russian.
- English and all other languages → English. Russian as a secondary language does not override this.

There is no in-app language selector. Android refreshes the language when returning to the app; on iOS, reopen the app after changing the system language. When testing in Expo Go, fully close and reopen Expo Go.

Both languages are declared in the Expo native config. These native settings take effect in a new standalone/development build; Expo Go already includes the localization module for detecting the device language.

UI translations and localized demo content live in `src/i18n/translations.ts`. Future user-authored posts, names and lobby titles should remain as written, not be translated automatically.

## Home: real catalog and membership

“Upcoming lobbies” / “Предстоящие лобби” loads only future PUBLISHED events, ordered by `startsAt ASC, id ASC`, in pages of 20. Refresh replaces the list; Load more appends the next cursor page. Loading, empty, error/retry and pagination-error states never substitute demo records. There is no geographic search or fabricated distance.

Titles and descriptions are literal user-authored text, not translation keys. Schedule labels use the event's IANA `timeZone`; countdowns use the absolute ISO `startsAt` and do not restart on rerender. Lobby images remain category placeholders; the avatar slice does not enable lobby photos. Counts include JOINED members only, and a membership badge identifies the current user's JOINED membership. The group gauge averages real JOINED users' extroversion scores, rounds to the nearest 0.5 (ties upward), and is hidden for an empty group. It is a group aggregate, not invented sample data.

Tap a real card to fetch details from `/lobbies/:id` and join/leave as a regular participant before the event starts. The organizer cannot leave. JOINED participants can open the real text chat; real ids never enter demo joining or mock conversations. A published past event remains viewable by id, but unpublished/missing details show an unavailable state. Lists/details discard late results after logout, account switch or a newer load. The authenticated app tree and local demo conversations reset on account switch.

Cursor pages are not a database snapshot: events may start or be edited between requests; Refresh obtains a fresh catalog. Existing seed events may already be in the past, so an empty catalog can be correct. Do not reseed/reset an existing database to populate Home: use isolated future test lobbies with known ids, and remove only those fixtures afterward.

For browser smoke testing, sign in at the Expo Web URL above, check the real list and details, then the empty state with no future published fixtures. Temporarily stop only the local API, press Refresh to see an error, restart it and press Retry. Legacy demo chat fixtures never replace the real inbox, list or search results.

## Your lobbies: real upcoming participation

Home's compact personal section and the full “View all” screen each request `GET /lobbies?scope=mine` through the same authenticated ApiClient. The server requires PUBLISHED, future startsAt and a JOINED LobbyMember belonging to the Bearer user. Organizer participation is the membership created atomically by POST, not an organizerId shortcut. LEFT/REMOVED, unpublished and past events are excluded. No userId/organizerId selector is accepted.

Mine is not filtered from the first all page: an event far beyond that page still appears in the personal query. Each list owns its items, cursor, loading/error state and request generation; refreshing or paging one does not append to or fail the other. Both use pages of 20 with stable startsAt/id order. Home offers Refresh, View all and Load more; the full screen offers Refresh and Load more. The empty state offers Create lobby. No loaded-row count is presented as a total.

Personal cards open the same real details with membership actions, never a mock chat. Group counts and mean extroversion still use **all** JOINED members. Returning from View all reloads Home's lists; returning after successful creation also reloads both scopes and opens the new id even if absent from their first pages. Logout/account switch discards list state and late reload/page results. No demo fallback exists.

Browser regression: create an isolated lobby → Home personal section → View all → details → logout/relogin → verify membership persists. Sign in as a different isolated user: the lobby may appear in all, but not mine without their own JOINED membership. Also test the empty/Create state and Refresh → error → Retry by temporarily stopping only the local API. Use known fixture ids; never reset/reseed or modify pre-existing records. Completed-event history, editing/deleting and lobby/message media remain unavailable.

## Create a real lobby

Use the central + button. Enter title, description, category, date (`YYYY-MM-DD`), 24-hour time (`HH:MM`), capacity and meeting format. In-person events require a venue name; online events send `venueName: null`. The form explicitly uses **Asia/Bishkek (UTC+06:00)**, not the device/computer timezone. It checks the calendar and round-trips the named timezone, rejecting impossible dates such as February 30 rather than normalizing them. Photos, maps and geocoding are visibly unavailable; no demo photo is preselected.

Submission uses the existing ApiClient/session and a synchronous double-submit lock. The server atomically creates a PUBLISHED lobby and one ORGANIZER/JOINED membership for the authenticated user. You occupy one capacity slot. A confirmed 201 returns to Home, reloads both independent server-sorted lists (all and mine) and opens details by the returned id—even if that event is beyond the first page. The real id never enters demo membership or conversations.

Errors preserve the draft while the form stays mounted. An ambiguous network/server/response error warns that creation might already have committed: **check Home before manually submitting again**. There is no automatic POST retry for those errors and no idempotency key in this stage; a deliberate repeated request can create a duplicate. The existing bounded refresh/retry after an explicit `401 INVALID_ACCESS_TOKEN` remains enabled. Closing the form discards its local draft. Logout/account switch/unmount invalidates late UI callbacks; the server may already have created the old account's lobby, but its late response cannot navigate or populate the new account's UI.

For browser smoke testing, create a uniquely named test lobby, verify Home → details and the organizer's `1 / capacity` count, then sign out/in and open it again from the catalog. Use only isolated test users/records and clean up by their known ids; no database reset or full reseed is required. Page reload still requires sign-in on web (refresh token is memory-only).

## Real membership: join and leave

Details use explicit server `membershipStatus` (null/JOINED/LEFT/REMOVED) and `isOrganizer`, never an organizer guess based on isJoined. Join appears for a nonmember or LEFT member with space; an ordinary JOINED participant can leave before startsAt. The organizer, excluded users, full lobbies and started events show a disabled membership action with a localized reason. Organizer cancellation is a separate action below; invitations and organizer transfer remain unavailable.

Both actions use the existing Bearer ApiClient. A synchronous UI lock prevents double/opposite taps until the response and verification GET complete. No membership change is shown optimistically. A network/ambiguous failure is **not** success: the UI explains the uncertainty and rechecks GET. If verification fails, actions stay disabled until Refresh/Retry succeeds. A later explicit retry is allowed; no automatic network POST retry is made. The existing bounded auth-refresh retry after INVALID_ACCESS_TOKEN remains.

Each ApiClient has a shared invalidation channel (no credentials or page cache). A membership request's completion/error invalidates all mounted catalog, compact personal, full personal and search stores and details. List generations advance synchronously, so earlier reload/page results cannot restore old counts or memberships. Search reloads its current query independently. Unmounted lists load afresh; other devices/users see changes on their next load/Refresh (no push notifications or polling). Late responses after logout/account switch are rejected before invalidating the new account. SessionCoordinator and storage/recovery protocols are unchanged.

Open details subscribe to the same app clock as countdowns: join/leave becomes visibly unavailable when startsAt is reached (on the next shared one-second tick, or on foreground resume), without another GET or a per-card timer. The action handler and backend still independently check time.

Home ↔ View all explicitly expands navCompact on both transitions, including a short destination with no upward scroll possible. The scroll algorithm itself is unchanged.

Browser regression with two isolated users: organizer creates → second user opens the catalog card and joins → Home and View all show their JOINED event → leaving removes it from both mine lists → organizer Refresh shows the updated count. Check the organizer's disabled leave action and JOINED-only chat access. Only test-created records are cleaned up by known ids.

## Cancel a future lobby

The server's `isOrganizer` enables **Cancel lobby / Отменить лобби** in real details. Confirmation stays inside the existing Modal, names the event and warns that it will disappear from available lobbies/chats and cannot be restored in this version. **Keep lobby / Не отменять** sends nothing. The shared app clock disables the initial action/confirmation when startsAt arrives; the handler and server also check time. A synchronous operation lock prevents double/conflicting participation actions.

`POST /api/v1/lobbies/:id/cancel` accepts no body/query fields and returns only `200 { id, status: "CANCELLED" }`. The organizer is determined by Lobby.organizerId. First cancellation changes only a future PUBLISHED lobby's status and normal updatedAt, under the same PostgreSQL Lobby row lock as join/leave/send. Membership rows, JOINED/LEFT/REMOVED, joinedAt/leftAt, messages and related history stay intact. Owner replay of CANCELLED is a no-op, including after startsAt, without timestamp changes. Started PUBLISHED returns 409 LOBBY_STARTED; PUBLISHED nonowners get 403 LOBBY_ORGANIZER_REQUIRED; missing/DRAFT/COMPLETED and CANCELLED nonowners get 404 LOBBY_NOT_FOUND. There is no physical deletion or archive access.

Only the cancel endpoint's matching id/status confirms success. Then a localized receipt appears on the source screen, details close, and the existing lobby invalidation channel refreshes all/mine, full mine, current Search and inbox. Old page/GET responses cannot resurrect removed cards. Open chats recheck access and hide history/sending on 404. Other users/devices see cancellation after manual Refresh/reopening; no notifications, polling or realtime were added. An already-running authorized read can finish before it observes the new status.

Network/5xx/invalid responses are **unconfirmed**, not success. The open UI retains the target account/id/title independently of its loaded Lobby DTO and offers **Retry cancellation / Повторить отмену** with the same POST. An optional GET 404 or disappearance from lists is **not proof**. Retry remains available even after startsAt or while a verification GET is pending: the server distinguishes an already-CANCELLED no-op from a still-PUBLISHED started event. No automatic network retry is added; existing bounded auth-refresh retry remains. The pending target is memory-only and is discarded on close/unmount, lobby change, logout or account switch; late results cannot confirm/close another context.

Browser regression (Expo Web + PostgreSQL): two isolated users create/join and exchange messages, organizer declines confirmation, then cancels; both users' refreshed lists/inbox exclude the event and the participant's open chat becomes unavailable. Verify history in the database before cleaning only those known fixture ids. Also exercise a committed cancellation whose successful response is replaced with a test 503: GET 404 must leave the retry UI open, and only a repeated POST 200 shows success without changing updatedAt. This browser check does not imply a physical-phone/native check. Restoration, organizer transfer, schedule editing, archives, cancellation notifications and lobby/message media remain out of scope.

## Remaining demo fixtures

Home's personal section, View all and paper-plane inbox are real API data, not demo memberships. The old demo-list path inside ChatsModal is retained separately for legacy fixtures/tests; Home no longer opens it and does not navigate real cards or ids into it.

Only demo cards retain localized sample schedules/distances and a countdown relative to app launch. These are separate from real event timestamps.

Only demo chat rows open mock conversations. Remaining demo previews and joining affect only local demo membership and chat lists; real search results never enter that path. Demo membership resets on reload, logout or account switch.

Home's “View all” opens PersonalLobbiesScreen and fetches scope=mine; it does not open ChatsModal or its legacy YourLobbiesScreen demo list.

## Search: real lobbies

Home's magnifying glass opens the existing search page; Back and the left-edge swipe return to Home. Results open LiveLobbyDetails, with real join/leave and no mock conversation. Closing details keeps the query and search page. Keyboard dismissal, clear/focus and scroll gestures are retained. Neither real Search nor the paper-plane Chats inbox has a demo badge.

`GET /lobbies?q=...` accepts a trimmed string of at most 100 characters. Missing/blank q means the ordinary upcoming catalog. It matches a **literal case-insensitive substring** of title OR venueName, not translated keys, individual words, distance, or description. `%`, `_` and backslash are literal characters. Arrays/objects/overlong queries return `400 VALIDATION_FAILED`. Filtering is in PostgreSQL before pagination; q, scope=all|mine and the startsAt/id cursor apply together. Changing q resets the cursor. No total count is returned or inferred from loaded cards.

The search store owns its pages and errors. Input changes immediately invalidate all older requests and clear old results, then debounce the next GET by 300ms. Loading, empty, error/retry, Refresh and Load more states have no demo fallback. Next-page errors retain the loaded cards and cursor; retries cannot start duplicate page requests. Closing/unmounting, logout, account switch and membership invalidation discard late responses. No search text or tokens are persisted by search.

PostgreSQL must provide its deterministic ICU collation `und-x-icu`; it is explicitly used so Cyrillic and Latin case matching also works on the existing local database initialized with locale C. The page ids and safe DTO are read in one RepeatableRead transaction; separate pages are not a frozen snapshot. No extensions, schema changes, geosearch, ranking or search engine were added. For large datasets, unindexed substring search will need a separately measured indexing stage.

Browser smoke: create a known isolated event → find it by title and venue (including different case and literal `%_`) → another user opens details, joins and sees updated search and mine → leave removes it from mine and updates search counters. Test empty search, no matches, clear, and API-offline → Retry. Remove only these fixtures by known ids. Browser verification does not imply a physical-phone test.

## Live lobby text chat

Open **Open lobby chat / Открыть чат лобби** from real details after joining, or select a row in the paper-plane inbox. Organizer access also requires JOINED membership. From details, chat replaces the content of the same details Modal; **To lobby / К лобби** returns to those details, keeping the underlying search/personal-list context. From the inbox, **To chats / К чатам** returns to its list inside the same native Modal.

Messages are stored in the existing PostgreSQL LobbyMessage model; no schema change. GET returns the newest 30 messages (limit 1–50) ordered by createdAt DESC, id DESC, with an opaque `before` cursor. An inverted FlatList displays them chronologically, initially at the newest end. Older-page loading preserves the reading offset; a confirmed own send reveals the sent message. **Manual Refresh** retains already loaded history and compensates for new rows while the user reads older messages, rather than forcing a jump to the bottom. Refresh resets the pagination cursor to the newest page so intervening messages can be fetched; previously loaded rows may be revisited and are deduplicated by server id. Confirmed sends survive older GET snapshots. There is no total message count, realtime or polling.

POST accepts only `{ clientMessageId: UUID, body: string }`. Body is trimmed plain text, 1–2000 Unicode characters; PostgreSQL cannot store NUL. UUIDs come from Expo's existing native/web UUID facility. One logical send keeps one id and normalized body: first save is 201, an identical explicit retry is 200 with the original createdAt, conflicting id/payload/author/lobby is 409 MESSAGE_ID_CONFLICT. There is no automatic network POST retry or simulated delivery; only the existing bounded 401 auth refresh retry. Failed/uncertain sends keep their draft and original pair for **Retry send**. Editing the composer meanwhile prepares a separate draft; a late success does not erase it. **Stop retrying** releases the failed attempt without deleting any message that the server may already have saved. Pending attempts/drafts exist only while that chat is open; reopening loads confirmed server history.

Only current JOINED participants can read/send. Missing/non-PUBLISHED: 404; outsider/LEFT/REMOVED: 403 LOBBY_CHAT_FORBIDDEN. startsAt does not close a PUBLISHED chat. Sending shares join/leave's PostgreSQL parent-row lock and rechecks access after acquiring it. History access and data use one RepeatableRead snapshot; a GET that began before leave may finish. On an observed 403/404 the UI removes history, disables sending and refreshes details access. Logout/account/lobby changes and closing discard late responses. Auth storage is unchanged.

Browser smoke: create an isolated lobby as organizer → join with a second test user → send as organizer → manually refresh as member and reply → reopen both chats to verify persistence → leave as member and verify access is unavailable. Use only known fixture ids for cleanup; never reset or reseed existing data. Physical-phone behavior must be verified separately; automated/native-compatible code is not a phone test.

No attachments, reactions, read receipts, typing, message edit/delete, push or WebSocket is implemented. The read-only participant list is available separately from lobby details (below).

## Available chats (real inbox)

The paper-plane button on Home opens `GET /api/v1/chats?limit=20&after=<cursor>`. Only current JOINED memberships in PUBLISHED lobbies are included, **including already-started events**. Organizer access also depends on JOINED. This is not `scope=mine`, which intentionally remains upcoming-only. LEFT/REMOVED and unpublished/COMPLETED/CANCELLED events are excluded. No Chat table or schema change is needed.

Each row shows the real lobby title, category placeholder, last-message author/preview/time, or “No messages yet”. There are no fabricated photos, active/inactive groups, unread dots or member/total counters. Loading, empty, error/retry, Refresh and Load more never substitute demo rows. A next-page failure retains rows and cursor. Rows are deduplicated by lobby id.

The server selects the latest undeleted message by `createdAt DESC, id DESC`; `activityAt` is that timestamp, or Lobby.createdAt for an empty chat. Chats sort by `activityAt DESC, lobbyId DESC`. `limit` is 1–50 (default 20); `after` encodes canonical UTC activityAt and lobbyId. Invalid/unknown query fields return 400 VALIDATION_FAILED. One parameterized PostgreSQL statement performs access filtering, indexed latest-message selection, ordering and pagination before limiting the page. Only a plain-text preview of at most 160 Unicode code points leaves SQL; no full history/private User fields.

Pages are **not a frozen snapshot**: a new message can move a chat above a cursor already passed. Refresh/reopening returns the current order. External messages appear only after these explicit reads, not polling. Confirmed sends and returning from a conversation refresh the inbox without resetting its conversation's pending-send state. The existing membership-invalidation channel refreshes available chats. Reload, account/logout, close and invalidation discard old GET/page responses. An observed conversation 403/404 hides its history/composer, removes its inbox row, refetches available chats and retains a clear return action.

Browser smoke: create an isolated event → second user joins → both open it through the paper-plane inbox and exchange messages → Back/Refresh updates preview and order → leaving a future event removes it from that user's inbox. Separately use a past PUBLISHED fixture with 75 messages: verify JOINED access, initial latest position, older-page anchor, Refresh while reading history, and own-send visibility. Tests/fixtures are isolated and removed only by known ids. Physical-phone scrolling/gestures require a separate device check.

Legacy `ChatsModal`, `ChatsScreen`, `LobbyChatScreen` and `MockChatProvider` remain for existing demo fixtures/tests and are not fed real ids. Their local composer and sample data are not delivery, backend messages or a fallback for this inbox. Moments, gallery and profile statistics remain demo-only. Chat search, archives, chat unread/read receipts and chat notifications are not implemented.

### Back navigation and native gestures

The inbox and conversations share one native modal rather than nesting modals. Home remains mounted underneath, preserving its scroll position and navigation state; the inbox also stays mounted beneath a list-origin conversation to preserve its scroll position. Scrolling chat pages does not compact Home's bottom navigation.

`SwipeBackPage` uses React Native Gesture Handler (`Gesture.Pan` plus `Gesture.Native` for the scrolling content) and the shared `chatSwipeController` lifecycle. Gesture recognition and scroll arbitration are handled by the native recognizers, not by PanResponder. `GestureHandlerRootView` wraps both the app and the modal, and the back gesture blocks the scrolling gesture until the swipe direction resolves.

Both gesture builders explicitly set `.runOnJS(true)`. This app uses React Native Animated and does not initialize Reanimated. In RNGH 2.32, a callback-free `Gesture.Native()` otherwise selects Reanimated event dispatch on a Bridgeless device, which can invoke Expo Go's uninitialized native animation module when scrolling. Keep this setting on the scroll gesture as well as the back gesture; it does not move native scroll recognition onto the JS thread. After changing gesture runtime configuration, fully quit and reopen Expo Go before device testing.

To test this update in Expo Go, run `npm install`, restart Metro with `npx expo start --go --clear`, then choose Reload in Expo Go or reopen the project. The native gesture module is included in Expo Go; this change does not require a separate development build.

Swipe left-to-right anywhere on the inbox to return to Home. Conversation back swipes start within the leftmost 28 points, leaving horizontal text selection in the composer available. The page follows the recognizer's full translation; a light swipe (about 15% of a phone's width) or a short quick flick goes back. A deliberately reversed or too-short drag settles back and can be interrupted by another swipe. Vertical scrolling and multi-touch do not dismiss the page. Back, Android Back, accessibility escape and Escape on web target the active page and preserve its entry-specific destination. Returning from a conversation dismisses the keyboard. Reduced Motion shortens gesture settling and avoids automatic full-screen sliding for button-based dismissal.

## Real lobby participants

Details → **Participants** opens a read-only page inside the same Modal. Back and system Back return to the same details; chat and cancellation keep their existing paths. Only current JOINED users can view it, including organizers and participants in already-started PUBLISHED events. Other users see an explanation instead of an enabled action.

`GET /api/v1/lobbies/:id/members?limit=20&after=<cursor>` returns real names, handles, nullable processed avatars, organizer and “You” badges. Organizer is determined by the server's Lobby.organizerId; no demo profiles or participant totals are invented. Public avatar URLs use the existing API base and an opaque image-retry identifier, not account/lobby ids. Refresh retries failed images even if their media id is unchanged; it never reads `/users/me` per participant or alters the signed-in profile.

The page has loading, empty, error/retry, Refresh and Load more. Refresh replaces page one and resets pagination; a next-page network error preserves rows/cursor for explicit retry. Rows deduplicate by user id. Shared lobby invalidation immediately removes old rows and rereads access. Any 403/404, including during pagination, hides rows and cursor, explains lost access and rechecks details directly without an invalidation loop. Late responses after refresh, close, account/lobby change or logout are ignored.

Only manual refresh/reopening discovers external changes. Separate cursor pages are not a frozen snapshot. An authorized GET begun before leave/cancel may complete; this does not promise instant revocation of already received data. No invitations, removing members, organizer transfer, public user pages, participant search or realtime are included. Auth storage, Prisma schema and seed are unchanged. Browser verification does not substitute for testing on a physical phone.

## Edit a future lobby

The organizer can open **Edit** from real details, inside the same Modal. Back/system Back discards the local draft without PATCH and returns to the same Home/Search/personal-list context. The editor reads current API data once on opening. It allows title, description, category, capacity and the linked online/venue pair. The original schedule and time zone are displayed read-only, never converted through the Bishkek create form and never included in PATCH.

Only changed normalized fields, plus fields retained from earlier unconfirmed attempts in this opening, are submitted to `PATCH /api/v1/lobbies/:id`. Background invalidation or manual GET cannot overwrite an unsaved draft. A synchronous save lock prevents double submission. A correctly shaped response with the expected id confirms saving, returns to updated details and invalidates all/mine/full mine/Search/inbox through the existing channel. A renamed event may no longer match the current search. Old reads and callbacks cannot replace newer details or another account/opening.

Network/5xx/invalid responses mean **Saving is not confirmed**; there is no automatic network retry. **Check current server data** displays the current fields separately, keeping the draft. This GET (even when identical to the intended changes, or 404) never proves the previous PATCH succeeded. Inspect it and deliberately save again if appropriate. Only the existing bounded refresh retry after an explicit 401 remains. Confirmed loss of access or startsAt disables editing; no participant or message history is deleted.

The editor keeps the original snapshot, the current draft, and a memory-only set of **field names from unconfirmed PATCH attempts**. An explicit retry sends the current validated values for those fields even when the user has returned them to the original values. For example, a committed-but-lost title change followed by undoing that title still sends the original title. Online/venue is always one complete validated pair. Untouched fields are not replayed, so another device's independent change is not overwritten. Undoing a local edit before the first submission still produces no PATCH. Known validation/auth/business rejections do not add retry fields, and a rejected later attempt does not erase earlier uncertainty. Successful/failed GETs do not discharge it. A valid PATCH receipt or closing/changing the editor's account/lobby clears this opening's retry state; it is not persisted or transferred to a new opening. This is not multi-device version control: the server still uses last successful commit for concurrent changes to the same field.

`npm run test:lobby-edit:integration` (from the repository root, with backend dependencies and the existing PostgreSQL running) compiles the frontend tests/backend and runs the real store + ApiClient against the normal Nest app on a temporary loopback port. It uses the unchanged `backend/.env`, drops only the test client's successful PATCH response **after verifying the commit in PostgreSQL**, then checks edited retries, unrelated changes, exact schedule, membership/messages and the delayed success receipt. It removes only its own returned fixture IDs; no reset, reseed, substitute DB or interruption of shared services. The regular frontend `npm test` also covers no-commit failures, GET failures, venue-pair reversions, rejections and late responses without requiring PostgreSQL.

Capacity cannot fall below JOINED count or persisted minParticipants. The organizer counts as joined; LEFT/REMOVED do not. Database writes share Lobby FOR UPDATE with membership/cancel/send, so independent changed fields merge; for the same field the last successful commit wins. Schedule changes, transfer, physical deletion, photos and participant notifications are not included. Other users see edits after Refresh/reopening, not realtime. Physical-phone behavior requires a separate device check.

## Activity: organizer join notifications

Activity loads the authenticated user's real `LOBBY_JOINED` notifications on tab opening and manual Refresh. New absent/LEFT → JOINED participation creates an event for Lobby.organizerId in the SAME PostgreSQL transaction/parent row lock as membership. Failed notification insertion rolls back the join. No-op/concurrent duplicate joins, leave, rejected joins and organizer self-membership do not create events; a later real rejoin creates a new event. There is no backfill or change to seed data.

`GET /api/v1/notifications?limit=20&after=…` filters recipient/type before bounded `createdAt DESC, id DESC` pagination, with a consistent snapshot per page. Rows expose only id/type/createdAt/readAt, safe actor `{ id, displayName, handle, avatar }` or null, and lobby `{ id, title }` or null. Actor names/avatars and lobby titles are **current**, not historical snapshots. Cancelled/non-PUBLISHED lobbies are hidden without deleting the notification; deleted actors use a neutral placeholder. A notification records a past join, not current membership. Existing other notification types remain in the DB but are excluded from this API.

The separate **Mark as read** action uses bodyless `POST /api/v1/notifications/:id/read`. Repeated/concurrent requests keep the first readAt. A matching valid POST receipt or a non-null server readAt from Refresh/pagination confirms the current read state. That confirmation clears stale unconfirmed-action errors, including a late lost-POST error; 403/404 access errors remain distinct. Without confirmation, an explicit safe retry remains available, with no optimistic read or automatic network retry (existing bounded auth rejection refresh is preserved). Late unread GET/page data cannot undo confirmed read state. Loading/empty/error/retry, independent next-page errors, deduplication, real avatar placeholders/dates and logout/account/unmount guards are covered by tests. Available lobby rows open real details over Activity; Close refreshes and returns to the same list. Only confirmed cancellation through those details shows the existing dismissible cancellation receipt on Activity, retained even if that refresh fails. It belongs to that opening/account; ordinary close, details 404 and uncertain cancellation are not success, and switching accounts clears the receipt. A lobby that became inaccessible shows the existing real-details 404 state, not another record.

No push delivery, polling, WebSocket, bottom-nav badge, mark-all, unread reversal, deletion, or edit/cancel/chat/other-type notifications. Other users' events appear on opening/Refresh, not realtime. Native/physical-phone testing is separate from the browser smoke test. Schema, seed and Auth/SessionCoordinator are unchanged.

## Checks

```bash
npm run typecheck
npm test
```
