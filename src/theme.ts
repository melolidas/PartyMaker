export const colors = {
  background: '#090B0C',
  surface: '#111416',
  surfaceRaised: '#161A1C',
  border: '#23282B',
  borderSoft: '#191D1F',
  text: '#F4F5F2',
  muted: '#969B9E',
  subtle: '#60666A',
  white: '#FFFFFF',
  black: '#090A0A',
  success: '#BFD8C6',
} as const;

export const radius = {
  small: 10,
  medium: 16,
  large: 22,
  pill: 999,
} as const;

export const shadows = {
  soft: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 8,
  },
};
