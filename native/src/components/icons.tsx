// The design's icons, exported as SVG from the Figma file (Lucide set, plus
// the dose symbols and the care-circle lines). One component per icon; colour
// and size by prop. Icons that point (arrow-left) flip in right-to-left.
import { I18nManager } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '@/theme/tokens';

type P = { size?: number; color?: string; opacity?: number };
const stroke = (color: string, width = 2, opacity = 1) => ({
  stroke: color, strokeWidth: width, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, strokeOpacity: opacity, fill: 'none',
});
const flip = I18nManager.isRTL ? { transform: [{ scaleX: -1 }] } : undefined;

export function HomeIcon({ size = 24, color = colors.textInverse, opacity = 1 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path {...stroke(color, 2, opacity)} d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Svg>
  );
}

export function MapPinIcon({ size = 24, color = colors.textInverse, opacity = 1 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path {...stroke(color, 2, opacity)} d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <Circle {...stroke(color, 2, opacity)} cx="12" cy="10" r="3" />
    </Svg>
  );
}

export function DashboardIcon({ size = 24, color = colors.textInverse, opacity = 1 }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect {...stroke(color, 2, opacity)} x="3" y="3" width="7" height="9" rx="1" />
      <Rect {...stroke(color, 2, opacity)} x="14" y="3" width="7" height="5" rx="1" />
      <Rect {...stroke(color, 2, opacity)} x="14" y="12" width="7" height="9" rx="1" />
      <Rect {...stroke(color, 2, opacity)} x="3" y="16" width="7" height="5" rx="1" />
    </Svg>
  );
}

export function ArrowLeftIcon({ size = 16, color = colors.inkDeep }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" style={flip}>
      <Path {...stroke(color)} d="M8 3.333 3.333 8 8 12.667M3.333 8h9.334" />
    </Svg>
  );
}

/** "Symbol" in a taken dose tile: one long tick (38×38 in a 68×68 mint tile). */
export function DoseTakenIcon({ size = 38, color = colors.mintInk }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 41 42">
      <Path {...stroke(color, 2.436)} d="M1.218 22.253 13.27 39.782 39.782 1.218" />
    </Svg>
  );
}

/** "Symbol" in a pending dose tile: a clock (38×38 in a 68×68 lavender tile). */
export function DoseClockIcon({ size = 38, color = colors.primary }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 38 38">
      <Circle {...stroke(color, 2.4)} cx="19" cy="19" r="17.8" />
      <Path {...stroke(color, 2.4)} d="M19 7.6V19h9.5" />
    </Svg>
  );
}

/** "Symbol" in the "all taken" card: a double tick. */
export function DoubleCheckIcon({ size = 28, color = colors.mintInk }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 30 31">
      <Path {...stroke(color, 1.812)} d="M.906 15l5.37 9.396L18.356.906m-6.712 18.792 5.37 9.396L29.093 5.604" />
    </Svg>
  );
}

export function HeartPulseIcon({ size = 16, color = colors.alertCritical }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      <Path {...stroke(color)} d="M2.16 8.667h4.173l.334-.667L8 11l1.333-4.667 1 2.334h3.507M2.16 8.667c.343.48.758.918 1.173 1.333l3.672 3.555a1.333 1.333 0 0 0 2.001-.013L12.667 10c.415-.414.83-.853 1.173-1.333M2.16 8.667C1.675 7.99 1.333 7.23 1.333 6.333a3.667 3.667 0 0 1 6.394-2.45.367.367 0 0 0 .546 0 3.667 3.667 0 0 1 6.394 2.45c0 .894-.343 1.655-.828 2.334" />
    </Svg>
  );
}

export function ActivityIcon({ size = 16, color = colors.accent }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      <Path {...stroke(color)} d="M14.667 8h-1.653a1.333 1.333 0 0 0-1.287.974l-1.567 5.573a.167.167 0 0 1-.32 0L6.16 1.453a.167.167 0 0 0-.32 0L4.273 7.027A1.333 1.333 0 0 1 2.993 8H1.333" />
    </Svg>
  );
}

export function CircleXIcon({ size = 16, color = colors.success }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      <Circle {...stroke(color)} cx="8" cy="8" r="6.667" />
      <Path {...stroke(color)} d="m10 6-4 4m0-4 4 4" />
    </Svg>
  );
}

export function AlarmClockPlusIcon({ size = 16, color = colors.textInverse }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      <Circle {...stroke(color)} cx="8" cy="8.667" r="5.333" />
      <Path {...stroke(color)} d="M3.333 2 1.333 4m13.334 0-2-2M4.253 12.467 2.667 14m9.094-1.553L13.333 14M8 6.667v4m-2-2h4" />
    </Svg>
  );
}

/** The phone in the "Call …" buttons. */
export function PhoneIcon({ size = 24, color = colors.primary }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path {...stroke(color, 1.8)} d="M3.67 1 .9 3.77C-.1 12.8 11.2 24.1 20.23 23.1L23 20.33l-5.6-5.6-3 3c-4.6-2.3-6.9-4.6-8.1-8.1l3-3z" />
    </Svg>
  );
}

/** "Care connections": the three lines of the care-circle triangle. */
export function CareTriangle({ width = 181, height = 120, color = colors.accent }: { width?: number; height?: number; color?: string }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 184 123">
      <Path stroke={color} strokeWidth={3.013} fill="none" d="M70.508.894 1.212 94.796M113.492.894l69.296 93.902M14.67 121.41h154.66" />
    </Svg>
  );
}

/** message-circle (Rafiq report title, caregiver home). */
export function MessageCircleIcon({ size = 18, color = colors.primary }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18">
      <Path {...stroke(color)} d="M2.243 12.257c.11.278.135.583.07.875l-.798 2.468a.75.75 0 0 0 .927.876l2.56-.749a1.5 1.5 0 0 1 .824.07 7.5 7.5 0 1 0-3.583-3.54" />
    </Svg>
  );
}

/** bell / bell-dot (caregiver header). The dot shows only when something is unread. */
export function BellIcon({ size = 20, color = colors.textInverse, dot = false }: P & { dot?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20">
      <Path {...stroke(color)} d="M8.556 17.5a1.667 1.667 0 0 0 2.887 0" />
      {dot ? (
        <>
          <Path {...stroke(color)} d="M9.733 1.673A5 5 0 0 0 5 6.667c0 3.749-1.176 4.963-2.282 6.105a.833.833 0 0 0 .615 1.395h13.334a.833.833 0 0 0 .616-1.395c-.687-.708-1.399-1.442-1.842-2.79" />
          <Circle {...stroke(color)} cx="15" cy="4.167" r="2.5" />
        </>
      ) : (
        <Path {...stroke(color)} d="M2.718 12.772A.833.833 0 0 0 3.333 14.167h13.334a.833.833 0 0 0 .616-1.395C16.176 11.63 15 10.416 15 6.667a5 5 0 0 0-10 0c0 3.749-1.176 4.963-2.282 6.105" />
      )}
    </Svg>
  );
}

/** Rafiq "chat" mode (Figma 05): a keyboard. */
export function KeyboardIcon({ size = 24, color = colors.textInverse }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect {...stroke(color, 1.8)} x="1" y="1" width="22" height="22" rx="1" />
      <Path {...stroke(color, 1.8)} d="M4 6.86h1.33M10.67 6.86H12M17.33 6.86h1.34M4 12h1.33M10.67 12H12M17.33 12h1.34M5.33 18.86h13.34" />
    </Svg>
  );
}

/** Read aloud (Rafiq "talk" mode and the button on every Rafiq message): a speaker.
 *  The frame's microphone is not used — there is no voice input (founder, Q4). */
export function SpeakerIcon({ size = 24, color = colors.primary }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path {...stroke(color, 1.8)} d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5zM16 9a5 5 0 0 1 0 6M19.4 18.4a9 9 0 0 0 0-12.8" />
    </Svg>
  );
}

/** Send a chat message. Flips in right-to-left. */
export function SendIcon({ size = 20, color = colors.textInverse }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={flip}>
      <Path {...stroke(color, 2)} d="M14.5 21.7a.5.5 0 0 0 .9 0L22 2.6a.5.5 0 0 0-.6-.6L2.3 8.6a.5.5 0 0 0 0 .9l8 3.2a2 2 0 0 1 1.1 1.1zM21.9 2.1 10.9 13.1" />
    </Svg>
  );
}

/** phone-off (Figma 04 "End Conversation"; here: stop reading aloud). */
export function PhoneOffIcon({ size = 20, color = colors.textInverse }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20">
      <Path {...stroke(color, 2)} d="M8.42 11.58a12.5 12.5 0 0 0 3.1 2.23.83.83 0 0 0 1.01-.25l.3-.39a1.67 1.67 0 0 1 1.33-.67h2.5a1.67 1.67 0 0 1 1.67 1.67v2.5a1.67 1.67 0 0 1-1.67 1.67 15 15 0 0 1-10.6-4.39M18.33 1.67 1.67 18.33M3.97 11.32a14.9 14.9 0 0 1-2.3-7.99 1.67 1.67 0 0 1 1.66-1.66h2.5A1.67 1.67 0 0 1 7.5 3.33v2.5a1.67 1.67 0 0 1-.67 1.34l-.39.29a.83.83 0 0 0-.24 1.03l.2.39" />
    </Svg>
  );
}

/** chevron-left (Rafiq header). Flips in right-to-left. */
export function ChevronLeftIcon({ size = 24, color = colors.textPrimary }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={flip}>
      <Path {...stroke(color, 2)} d="M15 18l-6-6 6-6" />
    </Svg>
  );
}
