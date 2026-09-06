import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { DemoLobby, HomeSession, joinDemoLobby } from './lobbies';

const HomeContext = createContext<{
  session: HomeSession;
  joinLobby: (lobby: DemoLobby) => void;
} | null>(null);
const ClockContext = createContext<number | null>(null);

export function HomeExperienceProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<HomeSession>(() => ({ startedAt: Date.now(), joinedIds: [] }));

  const joinLobby = useCallback((lobby: DemoLobby) => {
    setSession((previous) => joinDemoLobby(previous, lobby, Date.now()));
  }, []);
  const value = useMemo(() => ({ session, joinLobby }), [session, joinLobby]);

  return (
    <HomeContext.Provider value={value}>
      <HomeClockProvider>{children}</HomeClockProvider>
    </HomeContext.Provider>
  );
}

function HomeClockProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const updateClock = (active: boolean) => {
      clearInterval(interval);
      interval = undefined;
      if (active) {
        setNow(Date.now());
        interval = setInterval(() => setNow(Date.now()), 1000);
      }
    };
    updateClock(AppState.currentState === 'active' || AppState.currentState == null);
    const subscription = AppState.addEventListener('change', (state) => updateClock(state === 'active'));
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, []);
  // Only countdown consumers subscribe; navigation does not rerender each second.
  return <ClockContext.Provider value={now}>{children}</ClockContext.Provider>;
}

export function useHomeExperience() {
  const value = useContext(HomeContext);
  if (!value) throw new Error('useHomeExperience requires HomeExperienceProvider');
  return value;
}

export function useHomeClock() {
  const value = useContext(ClockContext);
  if (value === null) throw new Error('useHomeClock requires HomeExperienceProvider');
  return value;
}
