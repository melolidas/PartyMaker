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

## Auth/Profile backend integration

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

The access token exists only in application memory. On iOS and Android, the refresh token is stored with Expo SecureStore. On web, the refresh token is intentionally kept in memory and is never written to `localStorage`, so a browser-page refresh requires signing in again.

At startup, the app rotates a stored refresh token and then loads `/users/me`. Protected requests receive the in-memory access token. One `401 INVALID_ACCESS_TOKEN` can trigger one shared refresh operation and one request retry. A failed refresh attempts local invalidation; a storage failure is reported rather than presented as a successful session clear. Logout performs durable local invalidation first and completes without waiting for the backend; server revocation is best-effort using the current access token or an already-running refresh operation.

Refresh persistence uses a write-ahead protocol: an acknowledged `pending` operation record precedes the token envelope, and an operation-specific `committed` result follows the completed token write. Reads require matching operation ids, a committed result, no operation tombstone, and an unchanged revocation barrier. Logout changes that independent barrier; credential writers never remove it. Quarantine also writes an append-only tombstone for the exact operation, which a late writer cannot undo. Unknown records and old unversioned tokens are not restored (existing installations must sign in again).

**Confirmed logout vs. storage error:** durable clear requires an acknowledged revocation barrier, even when deleting the token succeeds. A fresh storage wrapper cannot know whether another writer is still pending, and deletion alone cannot revoke a late token write. When `logout()` returns `SESSION_STORAGE_ERROR`, logout is **not confirmed**: no successful session-cleared callback is emitted, and the current shared client context stays fenced against restore, refresh, and protected requests. The same error from recovery means readiness is unconfirmed; it does not undo an earlier confirmed logout.

**Logout confirmation is not recovery readiness.** A successful logout confirms revocation of the old credentials; it does not prove that a foreign writer has finished or that a new session can be stored. Recovery has a separate `ready` result and always performs the storage adapter's read-only `assertReadyForNewSession` check, including with a fresh raw adapter/wrapper and no local quarantine. A missing/unknown terminal result, malformed record, or changed operation head fails that check. Logout never waits for this readiness read.

Once unresolved/unknown storage state is detected, a shared in-memory readiness fence prevents subsequent login/register network requests, restore, and refresh. Confirmed logout does not reset that fence: its callback reports that storage recovery is still required, and the login screen keeps the error and disabled sign-in action. Only an explicit recovery with confirmed readiness clears it. A fresh wrapper never deletes pending evidence or invents an `aborted` result; the owning runtime must safely reconcile its old operation. After that proof is available, retry recovery succeeds and the user may explicitly sign in.

Storage mutations have a five-second deadline. A timeout returns `SESSION_STORAGE_ERROR` and quarantines the shared session immediately, without awaiting further marker writes or cleanup. Login, restore, and protected requests fail locally while quarantined. Reconciliation waits in the background for **all** original mutation and quarantine I/O to settle, confirms a durable revocation barrier, and records `aborted` before permitting another explicit login.

If reconciliation temporarily fails, use **Retry recovery / Повторить восстановление** on the login/register screen. The same action is available from the profile after a logout storage error. It goes through AuthProvider → ApiClient → SessionCoordinator, coalesces repeated requests (including clients sharing storage), and never starts competing cleanup. Known unresolved quarantined I/O produces an error immediately; each reconciliation/readiness observation has a five-second deadline. Timeout does not cancel cleanup, release quarantine, or clear the readiness fence. Readiness checks use the read lane, not the mutation lane: a stalled check cannot hold up durable clear or a later retry, and its late result cannot release a fence or change a newer session. The action remains retryable, shows an error if readiness is unconfirmed, and enables an explicit sign-in only after recovery succeeds; it never signs in automatically.

**Restart limitation:** a timeout is an in-memory safety boundary, not proof of durable invalidation. Pending/unknown persistent records are not restored, and a new runtime never clears them merely because its WeakMap is empty. However, if a delayed `committed` write physically completes while revocation/tombstone writes are unavailable, a new runtime can observe matching committed credentials. Without confirmed durable cleanup (or confirmed server revocation), absence of session restoration after restart cannot be guaranteed. The regression suite explicitly covers this limit. If the process dies with an unresolved pending writer and no terminal proof, recovery cannot safely unlock it automatically. No extra markers are added to claim a stronger guarantee.

Profile name, bio, city, country code, and extroversion level are now backed by `/users/me`. Avatar, gallery, stats, tabs, and their images remain demo UI. Existing Lobby, Chat, Moments, Activity, Media, and Create Lobby data and behavior remain mocked.

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

- Home with your lobbies and nearby lobbies
- Your lobbies: the full joined-lobby list, opened with View all
- Search with live filtering of demo lobbies by name and venue
- Chats with active and archived lobby rows, opened using the paper-plane button on Home
- Mock lobby conversations with sample messages and a working local composer
- Moments social feed
- Create Lobby form
- Activity notifications
- Profile and photo gallery

## Languages

The interface automatically uses the device's primary language via `expo-localization`:

- Russian (`ru`, including `ru-RU` and `ru-KG`) → Russian.
- English and all other languages → English. Russian as a secondary language does not override this.

There is no in-app language selector. Android refreshes the language when returning to the app; on iOS, reopen the app after changing the system language. When testing in Expo Go, fully close and reopen Expo Go.

Both languages are declared in the Expo native config. These native settings take effect in a new standalone/development build; Expo Go already includes the localization module for detecting the device language.

UI translations and localized demo content live in `src/i18n/translations.ts`. Future user-authored posts, names and lobby titles should remain as written, not be translated automatically.

## Home interactions (demo)

Lobby cards show the original localized demo time and distance directly below the venue name, with a live `HH:MM:SS` countdown beneath. The schedule labels and distances are static mock data; the separate demo countdown is relative to app launch and does not reset when switching tabs. At zero, the countdown displays “Already started”.

Tap a card in “Your lobbies” to open that lobby's conversation directly, without a preview popup. Back returns to Home. Nearby lobby cards still open their description popup: Join updates local membership and the participant count, and adds the lobby to “Your lobbies” and the chat list; Decline, the close button, tapping outside, or Android Back simply dismisses the popup. Joining is a local demo only and resets on a full app reload. No server requests or notifications are sent.

“View all” opens a separate “Your lobbies” page with the same joined memberships as Home, including newly joined demo lobbies. Full-width cards show the venue, schedule, countdown and participant count. A card opens its existing conversation; Back from that conversation returns to the full list, and Back from the list returns to Home. The list stays mounted under the conversation so its scroll position is preserved. The Home section sits directly below the top icon row with compact spacing.

Home has a compact header with a white magnifying glass on a dark circular background at the top left, and the existing Chats button at the right. Search opens a separate page with live filtering of demo lobbies by localized name and venue. Empty input shows all lobbies; the clear button resets the query, and an empty state handles unmatched searches. Result cards open the existing lobby preview within the same native modal, with local demo joining. Back or a left-edge swipe returns to Home. Search uses no backend or persistent storage.

## Chats (demo)

The white paper-plane button on Home opens a full-screen chat list; the Chats header contains only Back and its title, without a duplicate paper-plane icon. It starts with “Beer tonight” and “CS2 squad”, using the same lobby photos and member counts as Home. Joining another lobby adds a chat row; event start times do not remove existing rows. Tap any active or archived row to open its mock conversation. Back from a conversation opened this way returns to the list; opening from Home's “Your lobbies” skips the list, so Back returns directly to Home.

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
