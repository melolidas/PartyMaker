import { ReactNode } from 'react';
import { Platform } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from '../../theme';

export type PartyIconName = 'drinks' | 'gaming' | 'sport' | 'movies' | 'food' | 'outdoors' | 'sparkles' | 'heart' | 'send' | 'search';

// Original 24px line drawings. Shared rounded strokes keep the set consistent
// across iOS, Android and web instead of using platform-dependent emoji glyphs.
const artwork: Record<PartyIconName, ReactNode> = {
  search: (
    <>
      <Circle cx="10.75" cy="10.75" r="6.75" />
      <Path d="m15.7 15.7 4.8 4.8" />
    </>
  ),
  send: (
    <>
      <Path d="m3 10 18-7-7 18-3.2-7.8L3 10Z" />
      <Path d="m10.8 13.2 5.7-5.7" />
    </>
  ),
  drinks: (
    <>
      <Path d="M5 8h11v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8Z" />
      <Path d="M16 10h2a3 3 0 0 1 0 6h-2M8.5 11.5V17M12.5 11.5V17" />
      <Path d="M5 8a2.5 2.5 0 0 1-.3-5 3.2 3.2 0 0 1 5.7.2A2.5 2.5 0 0 1 15 5a1.6 1.6 0 0 1 1 3" />
    </>
  ),
  gaming: (
    <>
      <Path d="M8 6.5h8c2.1 0 3.5 1.5 4 3.5l1.1 6.2c.4 2.3-2.1 3.9-3.9 2.4L14.5 16h-5l-2.7 2.6c-1.8 1.5-4.3-.1-3.9-2.4L4 10c.5-2 1.9-3.5 4-3.5Z" />
      <Path d="M6 11.5h5M8.5 9v5M12 6.5V3" />
      <Circle cx="15.5" cy="10" r=".85" />
      <Circle cx="18" cy="12.5" r=".85" />
    </>
  ),
  sport: (
    <>
      <Circle cx="12" cy="12" r="8.5" />
      <Path d="M3.5 12h17M12 3.5v17M6 6c4.7 3 4.7 9 0 12M18 6c-4.7 3-4.7 9 0 12" />
    </>
  ),
  movies: (
    <>
      <Path d="M3.5 10h17v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-9ZM3.5 10 2.5 6l17-4 1 4-17 4ZM7.5 4.8l2.4 3.4M13.3 3.5l2.4 3.4" />
      <Path d="m10.5 13 4 2.5-4 2.5v-5Z" />
    </>
  ),
  food: (
    <>
      <Path d="M4.5 4c5.7-1.7 11.8.6 15 5.3L6 21 4.5 4Z" />
      <Path d="M4.8 7.5c4.5-1.2 8.9.4 12 4" />
      <Circle cx="9" cy="10.5" r="1.1" />
      <Circle cx="11.8" cy="13.2" r="1.1" />
      <Path d="m7.3 15.7.1.1" />
    </>
  ),
  outdoors: (
    <>
      <Path d="m2.5 20 8-14 8 14h-16ZM15 13l2.5-4 4 11h-3M7.6 11l2.9 2 2.9-2" />
      <Circle cx="17.5" cy="4.5" r="1.5" />
    </>
  ),
  sparkles: (
    <>
      <Path d="m10 5 2.4 5.6L18 13l-5.6 2.4L10 21l-2.4-5.6L2 13l5.6-2.4L10 5ZM18.5 2l.9 2.6L22 5.5l-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6Z" />
      <Path d="M19 17v4M17 19h4" />
    </>
  ),
  heart: (
    <Path d="M12 20.5 4.3 13A5.5 5.5 0 0 1 12 5.2 5.5 5.5 0 0 1 19.7 13L12 20.5ZM5.8 8.5c.3-1.1 1.3-1.7 2.4-1.5" />
  ),
};

export function PartyIcon({ name, size = 18, color = colors.text }: {
  name: PartyIconName;
  size?: number;
  color?: string;
}) {
  const accessibilityProps = Platform.select({
    web: { 'aria-hidden': true as const },
    default: {
      accessible: false,
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants' as const,
    },
  });
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.65}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...accessibilityProps}
      testID={`party-icon-${name}`}
    >
      {artwork[name]}
    </Svg>
  );
}
