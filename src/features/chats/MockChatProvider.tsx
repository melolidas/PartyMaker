import { createContext, ReactNode, useCallback, useContext, useMemo, useReducer } from 'react';
import { getMockChatThread, MockChatState, sendMockChatMessage, updateMockChatDraft } from './mockConversation';

type ChatAction =
  | { type: 'draft'; lobbyId: string; text: string }
  | { type: 'send'; lobbyId: string; now: number };

const MockChatContext = createContext<{
  state: MockChatState;
  setDraft: (lobbyId: string, text: string) => void;
  sendMessage: (lobbyId: string) => void;
} | null>(null);

function reducer(state: MockChatState, action: ChatAction): MockChatState {
  return action.type === 'draft'
    ? updateMockChatDraft(state, action.lobbyId, action.text)
    : sendMockChatMessage(state, action.lobbyId, action.now);
}

// Deliberately session-only: this design prototype has no transport or storage.
export function MockChatProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {});
  const setDraft = useCallback((lobbyId: string, text: string) => {
    dispatch({ type: 'draft', lobbyId, text });
  }, []);
  const sendMessage = useCallback((lobbyId: string) => {
    dispatch({ type: 'send', lobbyId, now: Date.now() });
  }, []);
  const value = useMemo(() => ({ state, setDraft, sendMessage }), [state, setDraft, sendMessage]);

  return <MockChatContext.Provider value={value}>{children}</MockChatContext.Provider>;
}

export function useMockChat(lobbyId: string) {
  const context = useContext(MockChatContext);
  if (!context) throw new Error('useMockChat requires MockChatProvider');
  const { state, setDraft, sendMessage } = context;
  const updateDraft = useCallback((text: string) => setDraft(lobbyId, text), [lobbyId, setDraft]);
  const send = useCallback(() => sendMessage(lobbyId), [lobbyId, sendMessage]);
  return { ...getMockChatThread(state, lobbyId), setDraft: updateDraft, sendMessage: send };
}
