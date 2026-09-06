import { useCallback, useRef, useState } from 'react';
import { Keyboard, Modal, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useI18n } from '../../i18n/LocalizationProvider';
import { NavScrollContext } from '../../navigation/NavScrollContext';
import { SearchScreen } from '../../screens/SearchScreen';
import { SwipeBackPage } from '../chats/SwipeBackPage';
import { CancelledLobbyNotice, LiveLobbyDetails } from '../home/LiveLobbyDetails';

const ignoreNavScroll = () => {};

export function SearchModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [selectedLobby, setSelectedLobby] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const requestBack = useRef(onClose);
  const registerBack = useCallback((close: () => void) => { requestBack.current = close; }, []);
  const openLobby = useCallback((lobby: string) => {
    Keyboard.dismiss();
    setSelectedLobby(lobby);
  }, []);

  return (
    <Modal
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      onRequestClose={() => selectedLobby ? setSelectedLobby(null) : requestBack.current()}
      accessibilityLabel={selectedLobby ? t('lobbies.details') : t('search.title')}
    >
      <GestureHandlerRootView style={styles.overlay}>
        <NavScrollContext.Provider value={ignoreNavScroll}>
          <SwipeBackPage
            name="search"
            edgeOnly
            active={selectedLobby === null}
            onClose={onClose}
            onBackReady={registerBack}
          >
            {(close, scrollGesture) => (
              <SearchScreen active={selectedLobby === null} onClose={close} onSelectLobby={openLobby} scrollGesture={scrollGesture} />
            )}
          </SwipeBackPage>
          {cancelled && !selectedLobby ? <View style={styles.notice}><CancelledLobbyNotice onDismiss={() => setCancelled(false)} /></View> : null}
          {selectedLobby ? <LiveLobbyDetails id={selectedLobby} onClose={() => setSelectedLobby(null)} onCancelled={() => setCancelled(true)} /> : null}
        </NavScrollContext.Provider>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  notice: { position: 'absolute', left: 18, right: 18, bottom: 24 },
  overlay: { flex: 1, overflow: 'hidden' },
});
