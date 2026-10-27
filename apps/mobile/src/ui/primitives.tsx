import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSportosTheme } from './theme';
import { formatDistance, formatDuration, formatPace, localToday, shiftCalendarDate } from './format.mjs';

export { formatDistance, formatDuration, formatPace };

export function Screen({ title, eyebrow, children, nested = false }: {
  title: string; eyebrow?: string; children: React.ReactNode; nested?: boolean;
}) {
  const { palette } = useSportosTheme();
  return <SafeAreaView edges={nested ? ['left', 'right', 'bottom'] : ['top', 'left', 'right']}
    style={{ flex: 1, backgroundColor: palette.background }}>
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      {eyebrow ? <Text style={[styles.eyebrow, { color: palette.accent }]}>{eyebrow}</Text> : null}
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.text }]}>{title}</Text>
      {children}
    </ScrollView>
  </SafeAreaView>;
}

export function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  const { palette } = useSportosTheme();
  return <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
    {title ? <Text accessibilityRole="header" style={[styles.cardTitle, { color: palette.text }]}>{title}</Text> : null}
    {children}
  </View>;
}

export function Body({ children, subdued = false }: { children: React.ReactNode; subdued?: boolean }) {
  const { palette } = useSportosTheme();
  return <Text style={[styles.body, { color: subdued ? palette.muted : palette.text }]}>{children}</Text>;
}

export function Action({ title, onPress, secondary = false, disabled = false }: {
  title: string; onPress(): void; secondary?: boolean; disabled?: boolean;
}) {
  const { palette } = useSportosTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={title}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.action, {
      backgroundColor: secondary ? palette.surface : palette.accent,
      borderColor: palette.accent, opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
    }]}>
    <Text style={[styles.actionText, { color: secondary ? palette.accent : palette.accentText }]}>{title}</Text>
  </Pressable>;
}

export function Metric({ label, value, source }: { label: string; value: string; source?: string }) {
  const { palette } = useSportosTheme();
  return <View accessible accessibilityLabel={`${label}: ${value}${source ? ', source ' + source : ''}`} style={styles.metric}>
    <Text style={[styles.metricValue, { color: palette.text }]}>{value}</Text>
    <Text style={[styles.metricLabel, { color: palette.muted }]}>{label}</Text>
    {source ? <SourceBadge label={source} /> : null}
  </View>;
}

export function SourceBadge({ label }: { label: string }) {
  const { palette } = useSportosTheme();
  return <Text style={[styles.badge, { color: palette.accent, borderColor: palette.accent }]}>
    {label}
  </Text>;
}

export function StatusPanel({ kind, message, retry }: {
  kind: 'loading' | 'empty' | 'error' | 'offline' | 'comingSoon';
  message: string; retry?: () => void;
}) {
  const { palette } = useSportosTheme();
  return <Card>
    {kind === 'loading' ? <ActivityIndicator color={palette.accent} accessibilityLabel="Loading SportOS data" /> : null}
    <Text accessibilityRole={kind === 'error' ? 'alert' : 'text'}
      style={[styles.body, { color: palette.muted }]}>{message}</Text>
    {retry ? <Action title="Retry" secondary onPress={retry} /> : null}
  </Card>;
}

export function DateStepper({ date, onChange }: {
  date: string; onChange(value: string): void;
}) {
  const { palette } = useSportosTheme();
  return <View style={styles.dateRow}>
    <Pressable accessibilityRole="button" accessibilityLabel="Previous date"
      onPress={() => onChange(shiftCalendarDate(date, -1))} style={styles.dateButton}>
      <Text style={[styles.dateText, { color: palette.accent }]}>‹</Text>
    </Pressable>
    <Text accessibilityLabel={`Selected date ${date}`} style={[styles.body, { color: palette.text }]}>{date}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Next date"
      disabled={date >= localToday()} accessibilityState={{ disabled: date >= localToday() }}
      onPress={() => onChange(shiftCalendarDate(date, 1))} style={styles.dateButton}>
      <Text style={[styles.dateText, { color: date >= localToday() ? palette.muted : palette.accent }]}>›</Text>
    </Pressable>
  </View>;
}

/** Optional native mini chart, with accessible numeric series; never scores or transforms canonical data. */
export function MiniBars({ label, values }: { label: string; values: number[] }) {
  const { palette } = useSportosTheme();
  const valid = values.filter((n) => Number.isFinite(n) && n >= 0);
  if (!values.length || valid.length !== values.length) return null;
  const maximum = Math.max(1, ...valid);
  return <View accessible accessibilityLabel={`${label}: ${values.join(', ')}`}>
    <Text style={[styles.metricLabel, { color: palette.muted }]}>{label}</Text>
    <View style={styles.chart}>
      {values.map((value, i) => <View key={i} style={[styles.bar, {
        height: Math.max(3, value / maximum * 92),
        backgroundColor: palette.chart,
      }]} />)}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  screen: { padding: 22, paddingBottom: 42, gap: 18 },
  eyebrow: { fontSize: 12, letterSpacing: 1.4, fontWeight: '800', textTransform: 'uppercase' },
  heading: { fontSize: 31, fontWeight: '800', lineHeight: 39 },
  card: { padding: 18, borderWidth: 1, borderRadius: 16, gap: 14 },
  cardTitle: { fontSize: 19, fontWeight: '700', lineHeight: 26 },
  body: { fontSize: 16, lineHeight: 24 },
  action: { minHeight: 48, padding: 12, borderWidth: 1, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  actionText: { fontSize: 16, fontWeight: '700' },
  metric: { gap: 3, minWidth: 120 },
  metricValue: { fontSize: 26, fontWeight: '800' },
  metricLabel: { fontSize: 14, lineHeight: 20 },
  badge: { fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 9, borderWidth: 1, alignSelf: 'flex-start' },
  dateRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dateButton: { minWidth: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  dateText: { fontSize: 32, fontWeight: '700' },
  chart: { height: 92, flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginTop: 10 },
  bar: { flex: 1, minWidth: 4, borderRadius: 3 },
});
