import { useCallback, useRef, useState } from 'react';
import { Keyboard, Modal, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useI18n } from '../../i18n/LocalizationProvider';
import { NavScrollContext } from '../../navigation/NavScrollContext';
import { SearchScreen } from '../../screens/SearchScreen';
import { SwipeBackPage } from '../chats/SwipeBackPage';
import { DemoLobby } from '../home/lobbies';
import { LobbyPreview } from '../home/LobbyPreview';

const ignoreNavScroll = () => {};

export function SearchModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [selectedLobby, setSelectedLobby] = useState<DemoLobby | null>(null);
  const requestBack = useRef(onClose);
  const registerBack = useCallback((close: () => void) => { requestBack.current = close; }, []);
  const openLobby = useCallback((lobby: DemoLobby) => {
    Keyboard.dismiss();
    setSelectedLobby(lobby);
  }, []);

  return (
    <Modal
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
      onRequestClose={() => selectedLobby ? setSelectedLobby(null) : requestBack.current()}
      accessibilityLabel={selectedLobby ? t(selectedLobby.titleKey) : t('search.title')}
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
          {selectedLobby ? <LobbyPreview inline lobby={selectedLobby} onClose={() => setSelectedLobby(null)} /> : null}
        </NavScrollContext.Provider>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, overflow: 'hidden' },
});
