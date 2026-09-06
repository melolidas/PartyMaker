import { useCallback, useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider, useAuth } from './src/auth/AuthProvider';
import { BottomNav } from './src/components/BottomNav';
import { LocalizationProvider } from './src/i18n/LocalizationProvider';
import { HomeExperienceProvider } from './src/features/home/HomeExperienceProvider';
import { MockChatProvider } from './src/features/chats/MockChatProvider';
import { NavScrollContext } from './src/navigation/NavScrollContext';
import { ActivityScreen } from './src/screens/ActivityScreen';
import { UnreadNotificationsProvider } from './src/features/activity/UnreadNotificationsProvider';
import { AuthLoadingScreen, AuthScreen } from './src/screens/AuthScreen';
import { CreateLobbyScreen } from './src/screens/CreateLobbyScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { MomentsScreen } from './src/screens/MomentsScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { colors } from './src/theme';
import { RouteName } from './src/types';

export default function App() {
  return (
    <GestureHandlerRootView style={styles.screen}>
      <LocalizationProvider>
        <AuthProvider>
          <AppGate />
        </AuthProvider>
      </LocalizationProvider>
    </GestureHandlerRootView>
  );
}

function AppGate() {
  const { status, user } = useAuth();

  if (status === 'restoring') return <AuthLoadingScreen />;
  if (status === 'unauthenticated') return <AuthScreen />;

  return (
    <HomeExperienceProvider key={user?.id}>
      <UnreadNotificationsProvider>
        <MockChatProvider>
          <PartyMaker />
        </MockChatProvider>
      </UnreadNotificationsProvider>
    </HomeExperienceProvider>
  );
}

function PartyMaker() {
  const [route, setRoute] = useState<RouteName>('home');
  const [previousRoute, setPreviousRoute] = useState<RouteName>('home');
  const [navCompact, setNavCompact] = useState(false);
  const [createdLobbyId, setCreatedLobbyId] = useState<string | null>(null);
  const handleCreated = useCallback((id: string) => {
    setCreatedLobbyId(id);
    setNavCompact(false);
    setRoute('home');
  }, []);
  const consumeCreatedLobby = useCallback(() => setCreatedLobbyId(null), []);

  const navigate = useCallback((next: RouteName) => {
    if (next === route) return;
    setNavCompact(false);
    if (next === 'create') {
      setPreviousRoute(route);
    }
    setRoute(next);
  }, [route]);

  const screen = useMemo(() => {
    switch (route) {
      case 'moments':
        return <MomentsScreen />;
      case 'create':
        return <CreateLobbyScreen onClose={() => navigate(previousRoute)} onCreated={handleCreated} />;
      case 'activity':
        return <ActivityScreen />;
      case 'profile':
        return <ProfileScreen />;
      default:
        // Home mounts fresh after Create: both independent scopes reload in server order.
        return <HomeScreen initialLobbyId={createdLobbyId} onInitialLobbyConsumed={consumeCreatedLobby} onCreate={() => navigate('create')} />;
    }
  }, [navigate, previousRoute, route, createdLobbyId, handleCreated, consumeCreatedLobby]);

  return (
    <NavScrollContext.Provider value={setNavCompact}>
      <View style={styles.app}>
        <View style={styles.screen}>
          {screen}
        </View>
        {route !== 'create' ? (
          <BottomNav active={route} compact={navCompact} onChange={navigate} />
        ) : null}
      </View>
    </NavScrollContext.Provider>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  app: {
    flex: 1,
    ...Platform.select({
      web: {},
      default: { direction: 'ltr' as const },
    }),
    backgroundColor: colors.background,
  },
});
