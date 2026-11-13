// 28-day line chart for one Trend Watch metric, with the elder's usual range
// shaded. Drawn with react-native-svg so it works the same on web and phones.
//
// Days without enough readings are left as gaps rather than drawn as zeros —
// a missing day must never look like a drop.
import { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { formatDate } from '@/lib/i18n';
import type { DailyPoint } from '@/lib/trends';
import { colors, fonts } from '@/theme/tokens';

const HEIGHT = 132;
const AXIS = 18; // room for the date labels under the plot
const PAD_X = 6;
const PAD_Y = 10;

export function TrendChart({
  points,
  low,
  high,
  median,
  days = 28,
  accessibilityLabel,
}: {
  points: DailyPoint[];
  low: number | null;
  high: number | null;
  median: number | null;
  days?: number;
  accessibilityLabel: string;
}) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  const startIso = start.toISOString().slice(0, 10);
  const usable = points.filter((p) => p.enough && p.day >= startIso);

  const values = usable.map((p) => p.value);
  if (low != null) values.push(low);
  if (high != null) values.push(high);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = max - min || 1;
  const lo = min - span * 0.08;
  const hi = max + span * 0.08;

  const x = (day: string) => {
    const i = (new Date(`${day}T00:00:00Z`).getTime() - start.getTime()) / 86_400_000;
    return PAD_X + (i / (days - 1)) * (width - PAD_X * 2);
  };
  const y = (v: number) => PAD_Y + (1 - (v - lo) / (hi - lo)) * (HEIGHT - PAD_Y * 2);

  // Break the line wherever a day is missing.
  let path = '';
  let prevDay: string | null = null;
  for (const p of usable) {
    const gap = prevDay && (new Date(`${p.day}T00:00:00Z`).getTime() - new Date(`${prevDay}T00:00:00Z`).getTime()) > 86_400_000;
    path += `${!prevDay || gap ? 'M' : 'L'}${x(p.day).toFixed(1)},${y(p.value).toFixed(1)} `;
    prevDay = p.day;
  }
  const last = usable[usable.length - 1];

  // Centre-anchored labels: "start"/"end" anchors follow the text direction,
  // so in Arabic they would hang off the edge. Width is estimated (no
  // measuring API in SVG); 0.55 × font size per character is close enough.
  const startLabel = formatDate(start);
  const endLabel = formatDate(end);
  const half = (label: string) => (label.length * 11 * 0.55) / 2;

  return (
    // Time runs left to right in both languages. The date labels are drawn
    // inside the SVG (whose coordinates never mirror) — as normal Text they
    // flipped in Arabic while the line did not, putting the oldest date above
    // the newest point.
    <View accessible accessibilityLabel={accessibilityLabel}>
      <View style={styles.canvas} onLayout={onLayout}>
        {width > 0 ? (
          <Svg width={width} height={HEIGHT + AXIS}>
            {low != null && high != null ? (
              <Rect
                x={PAD_X}
                y={y(high)}
                width={width - PAD_X * 2}
                height={Math.max(2, y(low) - y(high))}
                fill={colors.accentSoft}
                rx={6}
              />
            ) : null}
            {median != null ? (
              <Line
                x1={PAD_X}
                x2={width - PAD_X}
                y1={y(median)}
                y2={y(median)}
                stroke={colors.accent}
                strokeWidth={1}
                strokeDasharray="4 4"
                opacity={0.7}
              />
            ) : null}
            {path ? <Path d={path} stroke={colors.primary} strokeWidth={2} fill="none" /> : null}
            {usable.map((p) => {
              const outside = low != null && high != null && (p.value < low || p.value > high);
              return (
                <Circle
                  key={p.day}
                  cx={x(p.day)}
                  cy={y(p.value)}
                  r={outside ? 3.5 : 2.5}
                  fill={outside ? colors.alertWarning : colors.primary}
                />
              );
            })}
            {last ? <Circle cx={x(last.day)} cy={y(last.value)} r={5} fill={colors.primary} /> : null}
            <SvgText x={PAD_X + half(startLabel)} y={HEIGHT + 13} fontSize={11} fontFamily={fonts.regular} fill={colors.textMuted} textAnchor="middle">
              {startLabel}
            </SvgText>
            <SvgText x={width - PAD_X - half(endLabel)} y={HEIGHT + 13} fontSize={11} fontFamily={fonts.regular} fill={colors.textMuted} textAnchor="middle">
              {endLabel}
            </SvgText>
          </Svg>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { height: HEIGHT + AXIS, width: '100%' },
});
