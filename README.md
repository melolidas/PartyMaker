# PartyMaker

Dark social meetup app concept built with Expo, React Native and TypeScript.

## Run locally

```bash
npm install
npm start
```

Scan the QR code with Expo Go or press `a` to open an Android emulator.

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

The composer sends only to in-memory mock state: whitespace-only messages are ignored, outer whitespace is trimmed, and input is limited to 2,000 characters. Each lobby id owns its own draft and locally sent messages, including separate current and archived lobby instances. `MockChatProvider` is mounted above the app screens, so drafts and sent messages survive closing/reopening chats and switching tabs during the same app session. They are not stored on disk and reset on a full app reload. User-authored messages stay as typed when the interface language changes. There is no backend, real message delivery, recipient response or notification.

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
