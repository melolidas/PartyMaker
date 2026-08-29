import { ReactNode } from 'react';
import {
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar as NativeStatusBar,
  StyleProp,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { colors } from '../theme';

type Props = {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scroll?: boolean;
};

export function Screen({ children, contentContainerStyle, scroll = true }: Props) {
  const content = scroll ? (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.content, contentContainerStyle]}
    >
      {children}
    </ScrollView>
  ) : (
    children
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      {content}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: Platform.OS === 'android' ? NativeStatusBar.currentHeight : 0,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 112,
  },
});
