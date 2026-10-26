import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { fixtureSession, readFixtureActivities } from './src/fixture-api.js';

type FixtureResult = Awaited<ReturnType<typeof readFixtureActivities>>;
type ScreenStatus = 'idle' | 'loading' | 'loaded' | 'denied';

const palette = {
  light: { background: '#f3f5f7', foreground: '#14202b', surface: '#ffffff', muted: '#486077', accent: '#17646a' },
  dark: { background: '#0e151d', foreground: '#ecf3fa', surface: '#1a2631', muted: '#b6c7d3', accent: '#89d6c9' },
};

export default function App() {
  const mode = useColorScheme() === 'dark' ? 'dark' : 'light';
  const colors = palette[mode];
  const [status, setStatus] = useState<ScreenStatus>('idle');
  const [result, setResult] = useState<FixtureResult | null>(null);

  async function performRead(authenticated: boolean) {
    setStatus('loading');
    setResult(null);
    try {
      const read = await readFixtureActivities(authenticated ? fixtureSession : null);
      setResult(read);
      setStatus('loaded');
    } catch {
      setStatus('denied');
    }
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.eyebrow, { color: colors.accent }]}>SPORTOS · iOS SPIKE #186</Text>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
            Native integration fixture
          </Text>
          <Text style={[styles.paragraph, { color: colors.muted }]}>
            Expo + React Native demonstration. No real account, session, API, GPS or health data.
            This is NOT the production SportOS client.
          </Text>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Simulated canonical activity read
            </Text>
            <Text style={[styles.paragraph, { color: colors.muted }]}>
              Test a synthetic owner-scoped read and its anonymous-denial path.
              The fixture never makes a network request.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Load synthetic activities with fixture authorization"
              disabled={status === 'loading'}
              onPress={() => void performRead(true)}
              style={[styles.button, { backgroundColor: colors.accent }]}
            >
              <Text style={[styles.buttonText, { color: colors.background }]}>
                {status === 'loading' ? 'Loading fixture…' : 'Load synthetic activities'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Verify anonymous access is denied by the fixture"
              disabled={status === 'loading'}
              onPress={() => void performRead(false)}
              style={[styles.outlineButton, { borderColor: colors.accent }]}
            >
              <Text style={[styles.buttonText, { color: colors.accent }]}>
                Test anonymous denial
              </Text>
            </Pressable>
            {status === 'denied' && (
              <Text accessibilityRole="alert" style={[styles.paragraph, { color: colors.foreground }]}>
                Fixture access denied. This is expected without a matching mock session.
              </Text>
            )}
            {result && (
              <View accessibilityLabel="Two synthetic activities" style={styles.results}>
                <Text style={[styles.caption, { color: colors.muted }]}>SOURCE: FIXTURE ONLY</Text>
                {result.activities.map((activity) => (
                  <View key={activity.id} style={styles.activity}>
                    <Text style={[styles.activityTitle, { color: colors.foreground }]}>
                      {activity.type === 'run' ? 'Run' : 'Pool swim'} · {activity.distanceM / 1000} km
                    </Text>
                    <Text style={[styles.paragraph, { color: colors.muted }]}>
                      {Math.floor(activity.durationS / 60)} min · synthetic
                    </Text>
                    <View
                      accessible
                      accessibilityLabel={`Synthetic distance ${activity.distanceM} meters`}
                      style={[styles.bar, { backgroundColor: colors.background }]}
                    >
                      <View
                        style={{
                          height: '100%',
                          width: `${Math.round(activity.distanceM / 5000 * 100)}%`,
                          backgroundColor: colors.accent,
                          borderRadius: 4,
                        }}
                      />
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
          <Text style={[styles.footnote, { color: colors.muted }]}>
            Production sign-in and protected API reads belong to #187. Native shell,
            navigation and reusable components belong to #188. Simulator and iPhone
            verification is deferred to local Codex.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 22, paddingTop: 32, gap: 18 },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  title: { fontSize: 29, fontWeight: '700' },
  paragraph: { fontSize: 15, lineHeight: 23 },
  sectionTitle: { fontSize: 18, fontWeight: '700' },
  card: { padding: 18, borderRadius: 16, gap: 14 },
  button: { padding: 15, borderRadius: 10, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  outlineButton: { padding: 15, borderRadius: 10, alignItems: 'center', borderWidth: 1, minHeight: 48, justifyContent: 'center' },
  buttonText: { fontSize: 15, fontWeight: '700' },
  caption: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  results: { gap: 8, marginTop: 10 },
  activity: { paddingVertical: 10, gap: 8 },
  activityTitle: { fontSize: 17, fontWeight: '600' },
  bar: { height: 10, borderRadius: 4, overflow: 'hidden' },
  footnote: { fontSize: 13, lineHeight: 19 },
});
