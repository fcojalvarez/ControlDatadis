import Svg, { Path, Rect } from 'react-native-svg';

/** Logo de la app: el «pulso» verde sobre fondo oscuro (el mismo que el icono) */
export function AppLogo({ size = 76 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Rect width="100" height="100" rx="22" fill="#14181C" />
      <Path
        d="M14 54 H34 L42 34 L54 70 L62 46 L68 54 H86"
        fill="none"
        stroke="#3CC48F"
        strokeWidth={7}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(50 50) scale(0.92) translate(-50 -52)"
      />
    </Svg>
  );
}
