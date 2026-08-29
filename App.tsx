import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BottomNav } from './src/components/BottomNav';
import { ActivityScreen } from './src/screens/ActivityScreen';
import { CreateLobbyScreen } from './src/screens/CreateLobbyScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { MomentsScreen } from './src/screens/MomentsScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { colors } from './src/theme';
import { RouteName } from './src/types';

export default function App() {
  const [route, setRoute] = useState<RouteName>('home');
  const [previousRoute, setPreviousRoute] = useState<RouteName>('home');

  const navigate = (next: RouteName) => {
    if (next === 'create') {
      setPreviousRoute(route);
    }
    setRoute(next);
  };

  const screen = (() => {
    switch (route) {
      case 'moments':
        return <MomentsScreen />;
      case 'create':
        return <CreateLobbyScreen onClose={() => setRoute(previousRoute)} />;
      case 'activity':
        return <ActivityScreen />;
      case 'profile':
        return <ProfileScreen />;
      default:
        return <HomeScreen />;
    }
  })();

  return (
    <View style={styles.app}>
      {screen}
      {route !== 'create' ? <BottomNav active={route} onChange={navigate} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
