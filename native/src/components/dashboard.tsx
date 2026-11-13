// Building blocks shared by the Figma "Salem UI UX" dashboard screens:
// the indigo brand header, the white stat cards, the outlined summary
// card, the icon+text row, and the bottom tab bar.
//
// Geometry and colour come straight from the Figma frames; values live in
// theme/tokens.ts so the rest of the app stays in step.
import { ReactNode } from 'react';
import {
  Image,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from '@/navigation/router';
import { Feather } from '@react-native-vector-icons/feather';
import { Ionicons } from '@react-native-vector-icons/ionicons';
import { SosButton } from '@/components/SosButton';
import { bucketForRole, useAuthStore } from '@/stores/authStore';
import { colors, radius, shadow, space, type } from '@/theme/tokens';
import { DashboardIcon, HomeIcon, MapPinIcon } from '@/components/icons';
import { t as tr } from '@/lib/i18n';

/** Indigo top bar: salem wordmark, SOS pill, notification bell. */
export function BrandHeader({
  onBellPress,
  unread,
}: {
  onBellPress?: () => void;
  unread?: number;
}) {
  const isElder = bucketForRole(useAuthStore((s) => s.role)) === 'elder';
  return (
    <View style={styles.header}>
      <Image
        source={require('@/assets/brand/wordmark-white.png')}
        style={styles.wordmark}
        resizeMode="contain"
        accessibilityLabel="Salem"
      />
      <View style={styles.headerRight}>
        {/* SOS is the elder's own button: raise_sos() with no elder raises it for the
            caller, so on a caregiver's or doctor's phone it would alert nobody useful. */}
        {isElder ? <SosButton variant="pill" /> : null}
        <Pressable
          onPress={onBellPress}
          style={styles.bell}
          accessibilityRole="button"
          accessibilityLabel="Notifications"
        >
          <Ionicons name="notifications" size={20} color={colors.textInverse} />
          {unread ? <View style={styles.bellDot} /> : null}
        </Pressable>
      </View>
    </View>
  );
}

/** Small white metric card — "HEART RATE / 78 bpm" and friends. */
export function StatCard({
  label,
  value,
  icon,
  iconColor = colors.accent,
  children,
}: {
  label: string;
  value: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  iconColor?: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statTop}>
        <Text style={styles.statLabel} numberOfLines={1}>
          {label}
        </Text>
        <Feather name={icon} size={16} color={iconColor} />
      </View>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      {children}
    </View>
  );
}

/** Green "Normal" style chip used under a stat value. */
export function Chip({
  label,
  tone = 'success',
}: {
  label: string;
  tone?: 'success' | 'accent';
}) {
  const success = tone === 'success';
  return (
    <View style={[styles.chip, success ? styles.chipSuccess : styles.chipAccent]}>
      <Text style={[styles.chipText, { color: success ? colors.success : colors.accent }]}>
        {label}
      </Text>
    </View>
  );
}

/** The mini bar chart under the heart-rate value. */
export function MiniBars({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  return (
    <View style={styles.bars}>
      {values.map((v, i) => (
        <View key={i} style={[styles.bar, { height: Math.max(4, (v / max) * 28) }]} />
      ))}
    </View>
  );
}

/** White card outlined in indigo, for a short summary. */
export function SummaryCard({
  title,
  icon = 'message-circle',
  children,
}: {
  title: string;
  icon?: React.ComponentProps<typeof Feather>['name'];
  children: ReactNode;
}) {
  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryTitleRow}>
        <Feather name={icon} size={18} color={colors.primary} />
        <Text style={styles.summaryTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

/** White row: tinted icon square, title + subtitle, optional trailing chip. */
export function InfoRow({
  icon,
  title,
  subtitle,
  trailing,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  onPress?: () => void;
}) {
  const Wrapper: typeof View | typeof Pressable = onPress ? Pressable : View;
  return (
    <Wrapper
      onPress={onPress}
      style={styles.infoRow}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <View style={styles.infoIcon}>
        <Feather name={icon} size={24} color={colors.accent} />
      </View>
      <View style={styles.infoText}>
        <Text style={styles.infoTitle}>{title}</Text>
        {subtitle ? (
          <Text style={styles.infoSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Wrapper>
  );
}

/** Labelled progress bar — the medication adherence module. */
export function ProgressCard({
  title,
  percent,
  caption,
}: {
  title: string;
  percent: number;
  caption: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <View style={styles.progressCard}>
      <View style={styles.progressHeader}>
        <Text style={styles.progressTitle}>{title}</Text>
        <Text style={styles.progressPercent}>{clamped}%</Text>
      </View>
      <View
        style={styles.progressTrack}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: clamped }}
      >
        <View style={[styles.progressFill, { width: `${clamped}%` }]} />
      </View>
      <Text style={styles.progressCaption}>{caption}</Text>
    </View>
  );
}

/** White pill search field from the Figma list screens. */
export function SearchField({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.search}>
      <Feather name="search" size={18} color={colors.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.searchInput}
        autoCorrect={false}
      />
    </View>
  );
}

/** Outlined chips row (Favorites / History / Following in the design). */
export function FilterChips<T extends string>({
  items,
  active,
  onSelect,
}: {
  items: { key: T; label: string; icon: React.ComponentProps<typeof Feather>['name'] }[];
  active: T;
  onSelect: (key: T) => void;
}) {
  return (
    <View style={styles.chipsRow}>
      {items.map((it) => {
        const on = it.key === active;
        return (
          <Pressable
            key={it.key}
            onPress={() => onSelect(it.key)}
            style={[styles.filterChip, on && styles.filterChipOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Feather
              name={it.icon}
              size={14}
              color={on ? colors.primary : colors.textInverse}
            />
            <Text style={[styles.filterChipText, on && styles.filterChipTextOn]}>
              {it.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export type TabKey = 'home' | 'rafiq' | 'map' | 'more';

/** Tabs per role (founder, 2026-10-31): caregivers keep Location; elders and
 *  doctors have no Location tab (doctors never see location). */
export const TABS_FOR: Record<'elder' | 'family' | 'doctor', TabKey[]> = {
  elder: ['home', 'rafiq', 'more'],
  family: ['home', 'rafiq', 'map', 'more'],
  doctor: ['home', 'rafiq', 'more'],
};

/** Bottom tab bar on the indigo field (Figma "Tab Bar": 8/24 padding, 64×44 items,
 *  white icons, unselected at 50 %, the flame for Rafiq, hairline shadow above). */
export function TabBar({
  active,
  onSelect,
  tabs = TABS_FOR.family,
}: {
  active: TabKey;
  onSelect: (key: TabKey) => void;
  tabs?: TabKey[];
}) {
  const label: Record<TabKey, string> = { home: tr('tab.home'), rafiq: tr('tab.rafiq'), map: tr('tab.location'), more: tr('tab.more') };
  return (
    <SafeAreaView edges={['bottom']} style={[styles.tabBar, shadow.tabBar]}>
      <View style={styles.tabRow}>
        {tabs.map((key) => {
          const on = key === active;
          const op = on ? 1 : 0.5;
          return (
            <Pressable
              key={key}
              onPress={() => onSelect(key)}
              style={styles.tab}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={label[key]}
            >
              {key === 'home' ? <HomeIcon opacity={op} /> : null}
              {key === 'map' ? <MapPinIcon opacity={op} /> : null}
              {key === 'more' ? <DashboardIcon opacity={op} /> : null}
              {key === 'rafiq' ? (
                <Image source={require('@/assets/brand/tab-rafiq.png')} style={[styles.tabFlame, { opacity: op }]} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

/** Indigo field every Figma screen sits on. Wrap a whole route in this. */
export function FieldScreen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={styles.field} edges={['top']}>
      {children}
    </SafeAreaView>
  );
}

/**
 * Header for a pushed screen: back chevron, title, optional trailing slot.
 * Same indigo bar and metrics as BrandHeader so a pushed screen reads as part
 * of the same surface rather than a different app.
 */
export function SubHeader({
  title,
  right,
  onBack,
}: {
  title: string;
  right?: ReactNode;
  onBack?: () => void;
}) {
  const router = useRouter();
  const goBack =
    onBack ??
    (() => {
      // router.back() is a no-op when this screen was opened by a direct
      // reload (empty history) — fall through to the role-home funnel.
      if (router.canGoBack()) router.back();
      else router.replace('/');
    });

  return (
    <View style={styles.subHeader}>
      <Pressable
        onPress={goBack}
        hitSlop={16}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
      >
        <Feather name="chevron-left" size={26} color={colors.textInverse} />
      </Pressable>
      <Text style={styles.subTitle} numberOfLines={1}>
        {title}
      </Text>
      {right ?? null}
    </View>
  );
}

/** White rounded card used for every list row on the indigo field. */
export function FieldCard({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.fieldCard, style]}>{children}</View>;
}

/** Centred empty / error state on the indigo field. */
export function FieldEmpty({ text }: { text: string }) {
  return (
    <View style={styles.fieldEmpty}>
      <Text style={styles.fieldEmptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flex: 1, backgroundColor: colors.primary },

  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    paddingLeft: space.s,
    paddingRight: space.m,
    paddingTop: space.s,
    paddingBottom: space.m,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subTitle: { ...type.title, color: colors.textInverse, flex: 1 },

  fieldCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: space.m,
    gap: space.s,
  },
  fieldEmpty: { paddingVertical: space.xxl, paddingHorizontal: space.l, alignItems: 'center' },
  fieldEmptyText: { ...type.body, color: colors.onPrimary, textAlign: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.m,
    paddingTop: space.s,
    paddingBottom: space.m,
  },
  wordmark: { width: 132, height: 48 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  bell: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellDot: {
    position: 'absolute',
    top: 7,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.alertCritical,
  },

  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 14,
    gap: space.s,
  },
  statTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statLabel: { ...type.statLabel, color: colors.textMuted },
  statValue: { ...type.statValue, color: colors.textPrimary },

  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.s,
    paddingVertical: 4,
    borderRadius: 6,
  },
  chipSuccess: { backgroundColor: colors.successSoft },
  chipAccent: { backgroundColor: colors.accentSoft },
  chipText: { fontFamily: type.cardTitle.fontFamily, fontSize: 10 },

  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 28 },
  bar: { width: 3, borderRadius: 1.5, backgroundColor: colors.accent },

  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.primary,
    padding: 18,
    gap: 12,
  },
  summaryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  summaryTitle: { ...type.cardTitle, color: colors.primary },

  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: space.m,
  },
  infoIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoText: { flex: 1, gap: 2 },
  infoTitle: { ...type.cardTitle, color: colors.textPrimary },
  infoSubtitle: { fontFamily: type.cardBody.fontFamily, fontSize: 13, color: colors.textSecondary },

  progressCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 18,
    gap: 12,
  },
  progressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressTitle: { ...type.cardTitle, color: colors.textPrimary },
  progressPercent: { fontFamily: type.cardTitle.fontFamily, fontSize: 14, color: colors.accent },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: colors.accent },
  progressCaption: { fontFamily: type.micro.fontFamily, fontSize: 12, color: colors.textSecondary },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    paddingHorizontal: space.m,
    height: 44,
  },
  searchInput: {
    flex: 1,
    fontFamily: type.body.fontFamily,
    fontSize: 15,
    color: colors.textPrimary,
  },

  chipsRow: { flexDirection: 'row', gap: space.s, flexWrap: 'wrap' },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.s,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.45)',
  },
  filterChipOn: { backgroundColor: colors.surface, borderColor: colors.surface },
  filterChipText: { fontFamily: type.cardBody.fontFamily, fontSize: 13, color: colors.textInverse },
  filterChipTextOn: { color: colors.primary },

  tabBar: { backgroundColor: colors.primary },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.l,
    paddingVertical: space.s,
  },
  tab: { width: 64, height: 44, alignItems: 'center', justifyContent: 'center' },
  tabFlame: { width: 34, height: 30, resizeMode: 'contain' },
});
