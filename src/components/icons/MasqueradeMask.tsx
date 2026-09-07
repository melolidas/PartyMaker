import Svg, { Path } from 'react-native-svg';

/** One symmetric half-mask silhouette, with transparent almond eye cutouts. */
export function MasqueradeMask({ size = 28 }: { size?: number }) {
  return <Svg testID="masquerade-mask" width={size} height={size} viewBox="0 0 32 32" aria-hidden accessible={false}>
    <Path fill="#FFFFFF" fillRule="evenodd" clipRule="evenodd"
      d="M2 8.5C5.8 11.4 10.1 7.2 16 11.8C21.9 7.2 26.2 11.4 30 8.5C30 14.8 27.3 22.7 21.8 22.7C18.5 22.7 17.8 19.8 16 18.4C14.2 19.8 13.5 22.7 10.2 22.7C4.7 22.7 2 14.8 2 8.5ZM6.1 14.1C8.5 12.6 11.9 13.2 13.9 16.3C10.7 18.3 7.8 17.5 6.1 14.1ZM25.9 14.1C23.5 12.6 20.1 13.2 18.1 16.3C21.3 18.3 24.2 17.5 25.9 14.1Z" />
  </Svg>;
}
