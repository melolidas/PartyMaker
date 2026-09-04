import { Platform, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';
import { getExtroversionVisual } from './extroversion';

type Props = {
  level: number;
  size?: number;
  accessibilityLabel: string;
  testID?: string;
};

export function ExtroversionGauge({ level, size = 96, accessibilityLabel, testID }: Props) {
  const visual = getExtroversionVisual(level);
  const gradientId = `extroversion-gauge-${size}-${String(visual.level).replace('.', '-')}`;

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.container,
        {
          width: size,
          height: size,
          shadowColor: visual.color,
        },
      ]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 120 120" accessible={false}>
        <Defs>
          <LinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={visual.highlight} />
            <Stop offset="32%" stopColor={visual.color} />
            <Stop offset="72%" stopColor={visual.color} />
            <Stop offset="100%" stopColor={visual.shadow} />
          </LinearGradient>
        </Defs>

        <Path
          d="M 37 100 A 46 46 0 1 1 83 100"
          fill="none"
          stroke={visual.color}
          strokeOpacity={0.28}
          strokeWidth={27}
          strokeLinecap="round"
        />
        <Path
          d="M 37 100 A 46 46 0 1 1 83 100"
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={19}
          strokeLinecap="round"
        />
        <Path
          d="M 37 100 A 46 46 0 1 1 83 100"
          fill="none"
          stroke={visual.highlight}
          strokeOpacity={0.34}
          strokeWidth={4}
          strokeLinecap="round"
        />
        <G rotation={visual.needleRotation} origin="60, 60">
          <Path
            d="M 60 60 L 60 35"
            fill="none"
            stroke={visual.color}
            strokeOpacity={0.25}
            strokeWidth={15}
            strokeLinecap="round"
          />
          <Path
            d="M 60 60 L 60 35"
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={10}
            strokeLinecap="round"
          />
        </G>
        <Circle cx={60} cy={60} r={14} fill={visual.color} opacity={0.24} />
        <Circle cx={60} cy={60} r={10.5} fill={`url(#${gradientId})`} />
        <Circle cx={57} cy={57} r={2.2} fill={visual.highlight} opacity={0.42} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    ...Platform.select({
      web: {},
      default: {
        shadowOpacity: 0.34,
        shadowRadius: 7,
        shadowOffset: { width: 0, height: 0 },
        elevation: 2,
      },
    }),
  },
});
