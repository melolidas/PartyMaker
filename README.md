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
- `GET /lobbies?scope=all|mine&limit=20&after=<opaque-cursor>`
- `GET /lobbies/:id`
- `POST /lobbies`
- `POST /lobbies/:id/join`
- `POST /lobbies/:id/leave`

The access token exists only in application memory. On iOS and Android, the refresh token is stored with Expo SecureStore. On web, the refresh token is intentionally kept in memory and is never written to `localStorage`, so a browser-page refresh requires signing in again.

At startup, the app rotates a stored refresh token and then loads `/users/me`. Protected requests receive the in-memory access token. One `401 INVALID_ACCESS_TOKEN` can trigger one shared refresh operation and one request retry. A failed refresh attempts local invalidation; a storage failure is reported rather than presented as a successful session clear. Logout performs durable local invalidation first and completes without waiting for the backend; server revocation is best-effort using the current access token or an already-running refresh operation.

Refresh persistence uses a write-ahead protocol: an acknowledged `pending` operation record precedes the token envelope, and an operation-specific `committed` result follows the completed token write. Reads require matching operation ids, a committed result, no operation tombstone, and an unchanged revocation barrier. Logout changes that independent barrier; credential writers never remove it. Quarantine also writes an append-only tombstone for the exact operation, which a late writer cannot undo. Unknown records and old unversioned tokens are not restored (existing installations must sign in again).

**Confirmed logout vs. storage error:** durable clear requires an acknowledged revocation barrier, even when deleting the token succeeds. A fresh storage wrapper cannot know whether another writer is still pending, and deletion alone cannot revoke a late token write. When `logout()` returns `SESSION_STORAGE_ERROR`, logout is **not confirmed**: no successful session-cleared callback is emitted, and the current shared client context stays fenced against restore, refresh, and protected requests. The same error from recovery means readiness is unconfirmed; it does not undo an earlier confirmed logout.

**Logout confirmation is not recovery readiness.** A successful logout confirms revocation of the old credentials; it does not prove that a foreign writer has finished or that a new session can be stored. Recovery has a separate `ready` result and always performs the storage adapter's read-only `assertReadyForNewSession` check, including with a fresh raw adapter/wrapper and no local quarantine. A missing/unknown terminal result, malformed record, or changed operation head fails that check. Logout never waits for this readiness read.

Once unresolved/unknown storage state is detected, a shared in-memory readiness fence prevents subsequent login/register network requests, restore, and refresh. Confirmed logout does not reset that fence: its callback reports that storage recovery is still required, and the login screen keeps the error and disabled sign-in action. Only an explicit recovery with confirmed readiness clears it. A fresh wrapper never deletes pending evidence or invents an `aborted` result; the owning runtime must safely reconcile its old operation. After that proof is available, retry recovery succeeds and the user may explicitly sign in.

Storage mutations have a five-second deadline. A timeout returns `SESSION_STORAGE_ERROR` and quarantines the shared session immediately, without awaiting further marker writes or cleanup. Login, restore, and protected requests fail locally while quarantined. Reconciliation waits in the background for **all** original mutation and quarantine I/O to settle, confirms a durable revocation barrier, and records `aborted` before permitting another explicit login.

If reconciliation temporarily fails, use **Retry recovery / Повторить восстановление** on the login/register screen. The same action is available from the profile after a logout storage error. It goes through AuthProvider → ApiClient → SessionCoordinator, coalesces repeated requests (including clients sharing storage), and never starts competing cleanup. Known unresolved quarantined I/O produces an error immediately; each reconciliation/readiness observation has a five-second deadline. Timeout does not cancel cleanup, release quarantine, or clear the readiness fence. Readiness checks use the read lane, not the mutation lane: a stalled check cannot hold up durable clear or a later retry, and its late result cannot release a fence or change a newer session. The action remains retryable, shows an error if readiness is unconfirmed, and enables an explicit sign-in only after recovery succeeds; it never signs in automatically.

**Restart limitation:** a timeout is an in-memory safety boundary, not proof of durable invalidation. Pending/unknown persistent records are not restored, and a new runtime never clears them merely because its WeakMap is empty. However, if a delayed `committed` write physically completes while revocation/tombstone writes are unavailable, a new runtime can observe matching committed credentials. Without confirmed durable cleanup (or confirmed server revocation), absence of session restoration after restart cannot be guaranteed. The regression suite explicitly covers this limit. If the process dies with an unresolved pending writer and no terminal proof, recovery cannot safely unlock it automatically. No extra markers are added to claim a stronger guarantee.

Profile name, bio, city, country code, and extroversion level are backed by `/users/me`. Home's upcoming catalog, Your lobbies / View all, lobby details and Create Lobby use PostgreSQL through the same authenticated ApiClient. Avatar, gallery, stats, Search, Chat, Moments and Activity remain explicitly labeled demos. Real joining/leaving now works. Chat, invitations, notifications, organizer transfer, cancellation, editing/deleting lobbies and Media are not implemented.

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
- Search with live filtering of demo lobbies by name and venue
- Chats with active and archived lobby rows, opened using the paper-plane button on Home
- Mock lobby conversations with sample messages and a working local composer
- Moments social feed
- Create Lobby: real form and atomic PostgreSQL creation with organizer membership
- Activity notifications
- Profile and photo gallery

## Languages

The interface automatically uses the device's primary language via `expo-localization`:

- Russian (`ru`, including `ru-RU` and `ru-KG`) → Russian.
- English and all other languages → English. Russian as a secondary language does not override this.

There is no in-app language selector. Android refreshes the language when returning to the app; on iOS, reopen the app after changing the system language. When testing in Expo Go, fully close and reopen Expo Go.

Both languages are declared in the Expo native config. These native settings take effect in a new standalone/development build; Expo Go already includes the localization module for detecting the device language.

UI translations and localized demo content live in `src/i18n/translations.ts`. Future user-authored posts, names and lobby titles should remain as written, not be translated automatically.

## Home: real catalog and membership

“Upcoming lobbies” / “Предстоящие лобби” loads only future PUBLISHED events, ordered by `startsAt ASC, id ASC`, in pages of 20. Refresh replaces the list; Load more appends the next cursor page. Loading, empty, error/retry and pagination-error states never substitute demo records. There is no geographic search or fabricated distance.

Titles and descriptions are literal user-authored text, not translation keys. Schedule labels use the event's IANA `timeZone`; countdowns use the absolute ISO `startsAt` and do not restart on rerender. Images are category placeholders until Media is available. Counts include JOINED members only, and a membership badge identifies the current user's JOINED membership. The group gauge averages real JOINED users' extroversion scores, rounds to the nearest 0.5 (ties upward), and is hidden for an empty group. It is a group aggregate, not invented sample data.

Tap a real card to fetch details from `/lobbies/:id` and join/leave as a regular participant before the event starts. The organizer cannot leave. Chat remains explicitly disabled; real ids never enter demo joining or mock conversations. A published past event remains viewable by id, but unpublished/missing details show an unavailable state. Lists/details discard late results after logout, account switch or a newer load. The authenticated app tree and local demo conversations reset on account switch.

Cursor pages are not a database snapshot: events may start or be edited between requests; Refresh obtains a fresh catalog. Existing seed events may already be in the past, so an empty catalog can be correct. Do not reseed/reset an existing database to populate Home: use isolated future test lobbies with known ids, and remove only those fixtures afterward.

For browser smoke testing, sign in at the Expo Web URL above, check the real list and details, then the empty state with no future published fixtures. Temporarily stop only the local API, press Refresh to see an error, restart it and press Retry. The separate demo search/chat tools should remain labeled and never replace the real list.

## Your lobbies: real upcoming participation

Home's compact personal section and the full “View all” screen each request `GET /lobbies?scope=mine` through the same authenticated ApiClient. The server requires PUBLISHED, future startsAt and a JOINED LobbyMember belonging to the Bearer user. Organizer participation is the membership created atomically by POST, not an organizerId shortcut. LEFT/REMOVED, unpublished and past events are excluded. No userId/organizerId selector is accepted.

Mine is not filtered from the first all page: an event far beyond that page still appears in the personal query. Each list owns its items, cursor, loading/error state and request generation; refreshing or paging one does not append to or fail the other. Both use pages of 20 with stable startsAt/id order. Home offers Refresh, View all and Load more; the full screen offers Refresh and Load more. The empty state offers Create lobby. No loaded-row count is presented as a total.

Personal cards open the same real details with membership actions, never a mock chat. Group counts and mean extroversion still use **all** JOINED members. Returning from View all reloads Home's lists; returning after successful creation also reloads both scopes and opens the new id even if absent from their first pages. Logout/account switch discards list state and late reload/page results. No demo fallback exists.

Browser regression: create an isolated lobby → Home personal section → View all → details → logout/relogin → verify membership persists. Sign in as a different isolated user: the lobby may appear in all, but not mine without their own JOINED membership. Also test the empty/Create state and Refresh → error → Retry by temporarily stopping only the local API. Use known fixture ids; never reset/reseed or modify pre-existing records. Completed-event history, editing/deleting, real chats/search and Media remain unavailable.

## Create a real lobby

Use the central + button. Enter title, description, category, date (`YYYY-MM-DD`), 24-hour time (`HH:MM`), capacity and meeting format. In-person events require a venue name; online events send `venueName: null`. The form explicitly uses **Asia/Bishkek (UTC+06:00)**, not the device/computer timezone. It checks the calendar and round-trips the named timezone, rejecting impossible dates such as February 30 rather than normalizing them. Photos, maps and geocoding are visibly unavailable; no demo photo is preselected.

Submission uses the existing ApiClient/session and a synchronous double-submit lock. The server atomically creates a PUBLISHED lobby and one ORGANIZER/JOINED membership for the authenticated user. You occupy one capacity slot. A confirmed 201 returns to Home, reloads both independent server-sorted lists (all and mine) and opens details by the returned id—even if that event is beyond the first page. The real id never enters demo membership or conversations.

Errors preserve the draft while the form stays mounted. An ambiguous network/server/response error warns that creation might already have committed: **check Home before manually submitting again**. There is no automatic POST retry for those errors and no idempotency key in this stage; a deliberate repeated request can create a duplicate. The existing bounded refresh/retry after an explicit `401 INVALID_ACCESS_TOKEN` remains enabled. Closing the form discards its local draft. Logout/account switch/unmount invalidates late UI callbacks; the server may already have created the old account's lobby, but its late response cannot navigate or populate the new account's UI.

For browser smoke testing, create a uniquely named test lobby, verify Home → details and the organizer's `1 / capacity` count, then sign out/in and open it again from the catalog. Use only isolated test users/records and clean up by their known ids; no database reset or full reseed is required. Page reload still requires sign-in on web (refresh token is memory-only).

## Real membership: join and leave

Details use explicit server `membershipStatus` (null/JOINED/LEFT/REMOVED) and `isOrganizer`, never an organizer guess based on isJoined. Join appears for a nonmember or LEFT member with space; an ordinary JOINED participant can leave before startsAt. The organizer, excluded users, full lobbies and started events show a disabled action with a localized reason. There are no invitations, organizer transfer or event cancellation in this stage.

Both actions use the existing Bearer ApiClient. A synchronous UI lock prevents double/opposite taps until the response and verification GET complete. No membership change is shown optimistically. A network/ambiguous failure is **not** success: the UI explains the uncertainty and rechecks GET. If verification fails, actions stay disabled until Refresh/Retry succeeds. A later explicit retry is allowed; no automatic network POST retry is made. The existing bounded auth-refresh retry after INVALID_ACCESS_TOKEN remains.

Each ApiClient has a shared invalidation channel (no credentials or page cache). A membership request's completion/error invalidates all mounted catalog, compact personal and full personal stores and details. List generations advance synchronously, so earlier reload/page results cannot restore old counts or memberships. Unmounted lists load afresh; other devices/users see changes on their next load/Refresh (no push notifications or polling). Late responses after logout/account switch are rejected before invalidating the new account. SessionCoordinator and storage/recovery protocols are unchanged.

Home ↔ View all explicitly expands navCompact on both transitions, including a short destination with no upward scroll possible. The scroll algorithm itself is unchanged.

Browser regression with two isolated users: organizer creates → second user opens the catalog card and joins → Home and View all show their JOINED event → leaving removes it from both mine lists → organizer Refresh shows the updated count. Check the organizer's disabled leave action and the absent real chat action. Only test-created records are cleaned up by known ids.

## Home demo tools

Home's personal section and View all are real API data, not demo memberships. The old demo-list path inside ChatsModal is separate; Home does not navigate real cards or ids into it.

Only demo cards retain localized sample schedules/distances and a countdown relative to app launch. These are separate from real event timestamps.

Only demo chat rows open mock conversations. Search results open the demo preview, where Join updates only local demo membership and chat lists. This never joins a real lobby, sends notifications or calls a Lobby mutation endpoint. Demo membership resets on reload, logout or account switch.

Home's “View all” opens PersonalLobbiesScreen and fetches scope=mine; it does not open ChatsModal or its legacy YourLobbiesScreen demo list.

Home has a compact header with a white magnifying glass on a dark circular background at the top left, and the existing Chats button at the right. Search opens a separate page with live filtering of demo lobbies by localized name and venue. Empty input shows all lobbies; the clear button resets the query, and an empty state handles unmatched searches. Result cards open the existing lobby preview within the same native modal, with local demo joining. Back or a left-edge swipe returns to Home. Search uses no backend or persistent storage.

## Chats (demo)

The white paper-plane button on Home opens a full-screen chat list; the Chats header contains only Back and its title, without a duplicate paper-plane icon. It starts with “Beer tonight” and “CS2 squad”, using demo photos and member counts, independent of real Home memberships. Joining another **demo** lobby adds a mock chat row; event start times do not remove existing rows. Tap any active or archived row to open its mock conversation. Back from a conversation opened this way returns to the list. Home's real “Your lobbies” never opens a mock conversation.

Chats are grouped below two label-free 16px status markers without divider lines: a red dot with a visible size/brightness pulse and outward wave for active memberships, and a still grey dot for inactive demo chats (a past cinema night and hike). The status labels remain available to screen readers. Reduce Motion uses a slower brightness-only pulse: bright red for most of the cycle with a brief, clearly visible dip, without scaling or travelling waves. Animation pauses in the background and stops when the screen closes. Historical fixtures have separate ids and do not add Home memberships; starting an event alone does not mark its chat inactive.

Conversation pages include the lobby photo, participant count, meeting details, participant message bubbles and a multiline composer. Sample messages are localized in Russian and English and vary by lobby category; archived cinema and hike chats use distinct historical conversations. Explicit sample/local-message labels and a demo note keep these fixtures separate from user-authored text. The inbox snippets remain static demo previews.

The composer sends only to in-memory mock state: whitespace-only messages are ignored, outer whitespace is trimmed, and input is limited to 2,000 characters. Each lobby id owns its own draft and locally sent messages, including separate current and archived lobby instances. `MockChatProvider` is mounted above the app screens, so drafts and sent messages survive closing/reopening chats and switching tabs during the same app session. They are not stored on disk and reset on a full app reload. User-authored messages stay as typed when the interface language changes. There is no Chat backend integration, real message delivery, recipient response or notification.

### Back navigation and native gestures

The inbox and conversations share one native modal rather than nesting modals. Home remains mounted underneath, preserving its scroll position and navigation state; the inbox also stays mounted beneath a list-origin conversation to preserve its scroll position. Scrolling chat pages does not compact Home's bottom navigation.

`SwipeBackPage` uses React Native Gesture Handler (`Gesture.Pan` plus `Gesture.Native` for the scrolling content) and the shared `chatSwipeController` lifecycle. Gesture recognition and scroll arbitration are handled by the native recognizers, not by PanResponder. `GestureHandlerRootView` wraps both the app and the modal, and the back gesture blocks the scrolling gesture until the swipe direction resolves.

Both gesture builders explicitly set `.runOnJS(true)`. This app uses React Native Animated and does not initialize Reanimated. In RNGH 2.32, a callback-free `Gesture.Native()` otherwise selects Reanimated event dispatch on a Bridgeless device, which can invoke Expo Go's uninitialized native animation module when scrolling. Keep this setting on the scroll gesture as well as the back gesture; it does not move native scroll recognition onto the JS thread. After changing gesture runtime configuration, fully quit and reopen Expo Go before device testing.

To test this update in Expo Go, run `npm install`, restart Metro with `npx expo start --go --clear`, then choose Reload in Expo Go or reopen the project. The native gesture module is included in Expo Go; this change does not require a separate development build.

Swipe left-to-right anywhere on the inbox to return to Home. Conversation back swipes start within the leftmost 28 points, leaving horizontal text selection in the composer available. The page follows the recognizer's full translation; a light swipe (about 15% of a phone's width) or a short quick flick goes back. A deliberately reversed or too-short drag settles back and can be interrupted by another swipe. Vertical scrolling and multi-touch do not dismiss the page. Back, Android Back, accessibility escape and Escape on web target the active page and preserve its entry-specific destination. Returning from a conversation dismisses the keyboard. Reduced Motion shortens gesture settling and avoids automatic full-screen sliding for button-based dismissal.

## Checks

```bash
npm run typecheck
npm test
```
