import { StyleSheet, View } from 'react-native';

type Props = {
  reduceTransparency: boolean;
};

export function GlassNavSurface({ reduceTransparency }: Props) {
  return (
    <View
      testID="nav-glass-surface"
      style={[styles.surface, reduceTransparency && styles.opaque]}
    />
  );
}

const styles = StyleSheet.create({
  surface: {
    ...StyleSheet.absoluteFill,
    pointerEvents: 'none',
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: 'rgba(13, 16, 17, 0.8)',
    borderWidth: 1,
    borderColor: '#303536',
  },
  opaque: { backgroundColor: '#0D1011' },
});
