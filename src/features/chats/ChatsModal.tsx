import { useCallback, useRef, useState } from 'react';
import { Modal, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useI18n } from '../../i18n/LocalizationProvider';
import { NavScrollContext } from '../../navigation/NavScrollContext';
import { ChatsScreen } from '../../screens/ChatsScreen';
import { LobbyChatScreen } from '../../screens/LobbyChatScreen';
import { YourLobbiesScreen } from '../../screens/YourLobbiesScreen';
import { DemoLobby } from '../home/lobbies';
import { SwipeBackPage } from './SwipeBackPage';

const ignoreNavScroll = () => {};

type Props = { onClose: () => void; initialLobby?: DemoLobby; listPage?: 'chats' | 'your-lobbies' };

/** One native modal owns the selected lobby list and its conversations. */
export function ChatsModal({ onClose, initialLobby, listPage = 'chats' }: Props) {
  const { t } = useI18n();
  const [selectedLobby, setSelectedLobby] = useState<DemoLobby | null>(initialLobby ?? null);
  const requestBack = useRef(onClose);
  const registerBack = useCallback((close: () => void) => { requestBack.current = close; }, []);
  const returnToList = useCallback(() => setSelectedLobby(null), []);
  const directEntry = initialLobby !== undefined;
  const showYourLobbies = listPage === 'your-lobbies';
  const listTitle = t(showYourLobbies ? 'home.yourLobbies' : 'chats.title');
  const conversationBackLabel = t(directEntry ? 'conversation.backToHome' : showYourLobbies ? 'conversation.backToYourLobbies' : 'conversation.backToChats');

  return (
    <Modal
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      onRequestClose={() => requestBack.current()}
      accessibilityLabel={selectedLobby ? t(selectedLobby.titleKey) : listTitle}
    >
      <GestureHandlerRootView style={styles.overlay}>
        {/* Scrolling either page must not compact Home's navigation below. */}
        <NavScrollContext.Provider value={ignoreNavScroll}>
          {!directEntry && (
            <SwipeBackPage
              name={listPage}
              edgeOnly={showYourLobbies}
              active={selectedLobby === null}
              onClose={onClose}
              onBackReady={registerBack}
            >
              {(close, scrollGesture) => (
                showYourLobbies
                  ? <YourLobbiesScreen active={selectedLobby === null} onClose={close} onOpenChat={setSelectedLobby} scrollGesture={scrollGesture} />
                  : <ChatsScreen active={selectedLobby === null} onClose={close} onOpenChat={setSelectedLobby} scrollGesture={scrollGesture} />
              )}
            </SwipeBackPage>
          )}
          {selectedLobby && (
            <SwipeBackPage
              key={selectedLobby.id}
              name="conversation"
              edgeOnly
              onClose={directEntry ? onClose : returnToList}
              onBackReady={registerBack}
            >
              {(close, scrollGesture) => (
                <LobbyChatScreen
                  lobby={selectedLobby}
                  onBack={close}
                  backLabel={conversationBackLabel}
                  scrollGesture={scrollGesture}
                />
              )}
            </SwipeBackPage>
          )}
        </NavScrollContext.Provider>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, overflow: 'hidden' },
});
