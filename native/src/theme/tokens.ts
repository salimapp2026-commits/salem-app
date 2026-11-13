// Salem design tokens — the ONE place colours, type, radii and spacing live.
// Values are read from the Figma file "Salem UI&UX" (vnxTmpCv5PGenEhx6QP6Qy)
// through the Figma REST API, 2026-10-31; where a value comes from is noted.
// Screens never hard-code a colour or a font size.
//
// Fonts: the design sets Latin in Inter and Arabic in Noto Sans Arabic at the
// same sizes. English uses Inter, Arabic uses Noto Sans Arabic (fontFor()), so
// one style works in both languages (docs/DESIGN_DIFFERENCES.md).
import { getLocale } from '@/lib/i18n';

export const colors = {
  // ---- the indigo field and its accents
  primary: '#261cc1',            // every screen's background; primary buttons
  primaryStrong: '#1b1490',
  primarySoft: '#4a3fe0',
  accent: '#3a9aff',             // heart-rate bars, care-circle lines
  accentSoft: '#eef5ff',
  // ---- surfaces
  surface: '#ffffff',            // cards
  surfaceMuted: '#f5f5f5',
  lavender: '#eeedfc',           // secondary buttons ("remind me", "Call your Dr"), pending dose tile
  lavenderAlt: '#eeedff',
  sky: '#eaf4ff',                // caregiver avatar, care-circle centre
  mint: '#eaf5f0',               // taken dose tile, "all taken" card, band badge
  mintInk: '#176b56',            // text and icons on mint
  cream: '#f5f5fb',
  // ---- text
  ink: '#20243c',                // titles on white cards (elder home)
  inkDeep: '#1e1b4b',            // back-arrow stroke
  inkMuted: '#62677c',           // dose time, secondary lines on cards
  textPrimary: '#1a1a1d',        // stat values ("78 bpm")
  textSecondary: '#666666',
  textMuted: '#888888',          // stat labels ("HEART RATE")
  textInverse: '#ffffff',
  onPrimary: '#ddeeff',
  onPrimaryMuted: '#b9d5ff',
  // ---- status
  alertCritical: '#ef4444',      // SOS pill, heart icon
  alertWarning: '#b8860b',
  alertInfo: '#3a9aff',
  success: '#10b981',            // activity icon
  successSoft: '#ebf9f3',
  // ---- chrome
  tabInactive: 'rgba(255,255,255,0.5)',   // Tab Bar icons not selected
  homeIndicator: '#112e4c',
  divider: '#e0e0e0',
  shadow: 'rgba(30, 24, 120, 0.14)',
} as const;

export const space = {
  xs: 4,
  s: 8,
  m: 16,
  l: 24,
  xl: 32,
  xxl: 48,
} as const;

/** Corner radii used by the design. */
export const radius = {
  s: 8,
  m: 16,
  xl: 24,
  pill: 999,
  button: 16,      // "Action" buttons (took it / remind me / Call …)
  stat: 18,        // stat cards, dose icon tiles, "all taken" card
  doseCard: 22,    // "Medication dose" cards
  panel: 24,       // "Information card", care-circle card
  back: 20,        // 40×40 back button
} as const;

// Touch targets. Elder UI never goes below 64 (brand spec); the design's elder
// buttons are 60–72 high, raised to 64 where the design has 60.
export const touch = {
  elderMin: 64,
  default: 48,
} as const;

// Font files in native/assets/fonts, named after their PostScript names.
export const fonts = {
  regular: 'Inter-Regular',
  medium: 'Inter-Medium',
  semibold: 'Inter-SemiBold',
  bold: 'Inter-Bold',
  extrabold: 'Inter-ExtraBold',
  black: 'Inter-Black',
  latinBold: 'Inter-Bold',
  latinExtraBold: 'Inter-ExtraBold',
  latinBlack: 'Inter-Black',
  arabicBody: 'NotoSansArabic-Regular',
  arabicMedium: 'NotoSansArabic-SemiBold',
  arabicSemibold: 'NotoSansArabic-SemiBold',
  arabicBold: 'NotoSansArabic-Bold',
  arabicBlack: 'NotoSansArabic-Black',
} as const;

export type Weight = 400 | 500 | 600 | 700 | 800 | 900;

const LATIN: Record<Weight, string> = {
  400: fonts.regular, 500: fonts.medium, 600: fonts.semibold, 700: fonts.bold, 800: fonts.extrabold, 900: fonts.black,
};
const ARABIC: Record<Weight, string> = {
  400: fonts.arabicBody, 500: fonts.arabicSemibold, 600: fonts.arabicSemibold,
  700: fonts.arabicBold, 800: fonts.arabicBlack, 900: fonts.arabicBlack,
};

/** The family for a weight in the current language. Numbers ("78 bpm", "120/80")
 *  stay in Inter in both languages, as in the design (latin: true). */
export function fontFor(weight: Weight, opts: { latin?: boolean } = {}): string {
  return getLocale() === 'ar' && !opts.latin ? ARABIC[weight] : LATIN[weight];
}

/** A text style from the design: size / line height / weight. */
export type TextToken = { size: number; line: number; weight: Weight; latin?: boolean };

/** Elder frames ("Elder home , medication checklist& care circle"). These sizes are the
 *  minimum: elders may scale text up in Android settings. */
export const elderType = {
  sectionTitle: { size: 36, line: 58, weight: 700 },   // "Your medication"
  pageTitle: { size: 28, line: 45, weight: 700 },      // "your care circle"
  doseTitle: { size: 21, line: 35, weight: 600 },      // "medicine (1)"
  actionLarge: { size: 21, line: 34, weight: 600 },    // "✓ took it", "Call your care giver"
  question: { size: 19, line: 31, weight: 700 },       // "Did you take m3 dose?"
  you: { size: 18, line: 30, weight: 700 },            // "You"
  body: { size: 17, line: 28, weight: 400 },           // "you have taken all your medications"
  memberName: { size: 17, line: 28, weight: 700 },     // "doctor name"
  action: { size: 17, line: 27, weight: 600 },         // "remind me"
  caption: { size: 14, line: 23, weight: 400 },        // "after breakfast", circle subtitle
  badge: { size: 12, line: 19, weight: 600 },          // "● band is connected"
  avatarInitial: { size: 26, line: 34, weight: 700 },  // "Cg", "Dr."
  centre: { size: 16, line: 24, weight: 700 },         // "Salem" in the circle
} satisfies Record<string, TextToken>;

/** Stat cards and the SOS pill: Inter in the design. Labels follow the language;
 *  values and "SOS" stay Latin. */
export const statType = {
  label: { size: 12, line: 15, weight: 600 },              // "HEART RATE"
  value: { size: 20, line: 24, weight: 800, latin: true }, // "78 bpm"
  hint: { size: 11, line: 13, weight: 400 },               // "Goal: 4k steps"
  pill: { size: 10, line: 12, weight: 700 },               // "Normal"
  sos: { size: 14, line: 17, weight: 800, latin: true },   // "SOS"
} satisfies Record<string, TextToken>;

/** A React Native text style for a token, in the current language. */
export function textStyle(tk: TextToken) {
  return { fontFamily: fontFor(tk.weight, { latin: tk.latin }), fontSize: tk.size, lineHeight: tk.line };
}

// Styles of the screens not rebuilt yet (replaced screen by screen).
export const type = {
  display: { fontFamily: fonts.extrabold, fontSize: 26, lineHeight: 34 },
  title: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 24 },
  subtitle: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  bodyLarge: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24 },
  caption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  statLabel: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  statValue: { fontFamily: fonts.extrabold, fontSize: 20, lineHeight: 26 },
  cardTitle: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 19 },
  cardBody: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  micro: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15 },
} as const;

export const shadow = {
  ambient: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 16,
    elevation: 4,
  },
  // back-button: drop shadow #000 3 %, y 4, blur 12
  back: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 12,
    elevation: 1,
  },
  // Tab Bar: hairline shadow #000 10 % above it (y −0.5)
  tabBar: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -0.5 },
    shadowOpacity: 0.1,
    shadowRadius: 0,
    elevation: 2,
  },
} as const;
