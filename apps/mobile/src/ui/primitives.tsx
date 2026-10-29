import React, { useContext } from 'react';
import { BottomTabBarHeightContext } from 'react-native-bottom-tabs';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSportosTheme } from './theme';
import { SportGlyph } from './identity';
import { formatDistance, formatDuration, formatPace, localToday, shiftCalendarDate } from './format.mjs';

export { formatDistance, formatDuration, formatPace };

export function Screen({ title, eyebrow, children, nested = false }: {
  title: string; eyebrow?: string; children: React.ReactNode; nested?: boolean;
}) {
  const { palette } = useSportosTheme();
  const tabBarHeight = useContext(BottomTabBarHeightContext);
  const bottomPadding = !nested && tabBarHeight !== undefined ? Math.max(tabBarHeight, 80) + 24 : 42;
  return <SafeAreaView edges={nested ? ['left', 'right', 'bottom'] : ['top', 'left', 'right']}
    style={{ flex: 1, backgroundColor: palette.background }}>
    <ScrollView automaticallyAdjustKeyboardInsets contentInsetAdjustmentBehavior="never"
      scrollIndicatorInsets={{ bottom: bottomPadding }}
      contentContainerStyle={[styles.screen, { paddingBottom: bottomPadding }]} keyboardShouldPersistTaps="handled">
      <View style={styles.screenHeader}>
      {eyebrow ? <Text style={[styles.eyebrow, { color: palette.accent }]}>{eyebrow}</Text> : null}
      <Text accessibilityRole="header" style={[styles.heading, { color: palette.text }]}>{title}</Text>
      </View>
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
      backgroundColor: secondary ? palette.soft : palette.accent,
      borderColor: secondary ? palette.soft : palette.accent, opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
      transform: [{ scale: pressed ? 0.985 : 1 }],
    }]}>
    <Text style={[styles.actionText, { color: secondary ? palette.accent : palette.accentText }]}>{title}</Text>
  </Pressable>;
}

/** A navigation row has a distinct visual weight from a submit/fetch action. */
export function NavigationRow({ title, detail, icon = 'arrow', onPress }: {
  title: string; detail?: string; icon?: string; onPress(): void;
}) {
  const { palette } = useSportosTheme();
  return <Pressable accessibilityRole="button" onPress={onPress}
    style={({pressed}) => ({flexDirection:'row',alignItems:'center',gap:14,minHeight:64,paddingVertical:10,opacity:pressed?0.6:1})}>
    <View style={{padding:12,borderRadius:15,backgroundColor:palette.soft}}><SportGlyph sport={icon} color={palette.accent}/></View>
    <View style={{flex:1,gap:4}}><Text style={{color:palette.text,fontSize:16,fontWeight:'700'}}>{title}</Text>
      {detail ? <Text style={{color:palette.muted,fontSize:13,lineHeight:19}}>{detail}</Text> : null}</View>
    <Text style={{color:palette.muted,fontSize:24}} accessible={false}>›</Text>
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
  return <Text style={[styles.badge, { color: palette.accent, borderColor: palette.soft, backgroundColor: palette.soft }]}>
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
  return <View style={[styles.dateRow, {backgroundColor: palette.soft}]}>
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
  screen: { padding: 20, paddingBottom: 42, gap: 18 },
  screenHeader: { gap: 7, paddingTop: 12, paddingBottom: 6 },
  eyebrow: { fontSize: 10, letterSpacing: 2.2, fontWeight: '700', textTransform: 'uppercase' },
  heading: { fontSize: 36, fontWeight: '800', lineHeight: 42, letterSpacing: -1.4 },
  card: { padding: 20, borderWidth: 1, borderRadius: 24, borderCurve: 'continuous', gap: 16 },
  cardTitle: { fontSize: 18, fontWeight: '700', lineHeight: 25, letterSpacing: -0.4 },
  body: { fontSize: 15, lineHeight: 23 },
  action: { minHeight: 48, padding: 12, borderWidth: 1, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  actionText: { fontSize: 16, fontWeight: '700' },
  metric: { gap: 5, minWidth: 112, flexShrink: 1 },
  metricValue: { fontSize: 28, fontWeight: '700', letterSpacing: -0.9, fontVariant: ['tabular-nums'] },
  metricLabel: { fontSize: 14, lineHeight: 20 },
  badge: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7, borderWidth: 1, alignSelf: 'flex-start' },
  dateRow: { borderRadius: 16, padding: 3, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dateButton: { minWidth: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  dateText: { fontSize: 32, fontWeight: '700' },
  chart: { height: 92, flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginTop: 10 },
  bar: { flex: 1, minWidth: 4, borderRadius: 3 },
});
