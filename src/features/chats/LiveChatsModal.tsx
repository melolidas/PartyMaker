import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import type { ChatSummary } from '../../api/lobbyTypes';
import { getLobbyInvalidation } from '../../api/lobbyInvalidation';
import { useAuth } from '../../auth/AuthProvider';
import { Screen } from '../../components/Screen';
import { useI18n } from '../../i18n/LocalizationProvider';
import { NavScrollContext } from '../../navigation/NavScrollContext';
import { emptyInbox, LiveChatInboxStore } from './liveChatInbox';
import { LiveChatsScreen } from './LiveChatsScreen';
import { LiveLobbyChatScreen } from './LiveLobbyChatScreen';
import { SwipeBackPage } from './SwipeBackPage';

const ignoreNavScroll = () => {};
export function LiveChatsModal({ onClose }: { onClose: () => void }) {
  const { user, lobbyApi, storageRecoveryRequired } = useAuth();
  const { t } = useI18n();
  const account = storageRecoveryRequired ? null : user?.id ?? null;
  const store = useMemo(() => new LiveChatInboxStore(after => lobbyApi.listChats(after)), [lobbyApi]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [selected, setSelected] = useState<{ account: string; row: ChatSummary } | null>(null);
  const current = snapshot.account === account ? snapshot : emptyInbox(account);
  const selection = account && selected?.account === account ? selected.row : null;
  useEffect(() => {
    store.setAccount(account); setSelected(null);
    const off = getLobbyInvalidation(lobbyApi).subscribe(store.invalidate);
    return () => { off(); store.setAccount(null); };
  }, [store, lobbyApi, account]);
  const requestBack = useRef(onClose);
  const registerBack = useCallback((close: () => void) => { requestBack.current = close; }, []);
  const returnToList = useCallback(() => { setSelected(null); void store.reload(); }, [store]);
  return <Modal transparent animationType="none" presentationStyle="overFullScreen" onRequestClose={() => requestBack.current()} accessibilityLabel={selection?.lobby.title ?? t('chats.title')}>
    <GestureHandlerRootView style={styles.overlay}>
      <NavScrollContext.Provider value={ignoreNavScroll}>
        <SwipeBackPage name="chats" active={!selection} onClose={onClose} onBackReady={registerBack}>
          {(close, gesture) => <LiveChatsScreen state={current} active={!selection} onClose={close} scrollGesture={gesture}
            onSelect={row => { if (account) setSelected({ account, row }); }} onRefresh={() => void store.reload()} onMore={() => void store.loadMore()} />}
        </SwipeBackPage>
        {selection ? <SwipeBackPage key={`${account}/${selection.lobby.id}`} name="conversation" edgeOnly onClose={returnToList} onBackReady={registerBack}>
          {(close, gesture) => <Screen scroll={false}><View style={styles.conversation}>
            <LiveLobbyChatScreen lobbyId={selection.lobby.id} title={selection.lobby.title} onBack={close} backLabel={t('liveChat.backToChats')}
              scrollGesture={gesture} onSent={() => void store.reload()} onAccessLost={() => store.accessLost(selection.lobby.id)} />
          </View></Screen>}
        </SwipeBackPage> : null}
      </NavScrollContext.Provider>
    </GestureHandlerRootView>
  </Modal>;
}
const styles = StyleSheet.create({ overlay: { flex: 1, overflow: 'hidden' }, conversation: { flex: 1, padding: 18 } });
