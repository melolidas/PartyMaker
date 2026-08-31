import { ReactNode, useCallback, useContext, useRef } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
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
import { NavScrollContext } from '../navigation/NavScrollContext';
import { getNavScrollInput, getNavScrollState, initialNavScrollState } from '../navigation/navScroll';

type Props = {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scroll?: boolean;
};

export function Screen({ children, contentContainerStyle, scroll = true }: Props) {
  const setNavCompact = useContext(NavScrollContext);
  const scrollState = useRef(initialNavScrollState);
  const scrollMeasurements = useRef({ contentHeight: 0, viewportHeight: 0 });
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { offset, maxOffset } = getNavScrollInput(event.nativeEvent, scrollMeasurements.current);
    const previous = scrollState.current;
    const next = getNavScrollState(
      previous,
      offset,
      maxOffset,
    );
    scrollState.current = next;
    if (next.compact !== previous.compact) {
      setNavCompact(next.compact);
    }
  }, [setNavCompact]);

  const content = scroll ? (
    <ScrollView
      testID="screen-scroll"
      onScroll={handleScroll}
      onScrollBeginDrag={handleScroll}
      onScrollEndDrag={handleScroll}
      onMomentumScrollEnd={handleScroll}
      onContentSizeChange={(_width, height) => {
        scrollMeasurements.current.contentHeight = height;
      }}
      onLayout={(event) => {
        scrollMeasurements.current.viewportHeight = event.nativeEvent.layout.height;
      }}
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
      style={styles.scroll}
      scrollEventThrottle={16}
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
  scroll: { flex: 1 },
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
