import React, { useState } from 'react';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Body, Action, Card, DateStepper, Screen, SourceBadge, StatusPanel } from '../ui/primitives';
import { useSession } from '../auth/SessionProvider';
import { localToday } from '../ui/format.mjs';
import type { MainTabs, RootStack } from '../navigation/routes';

export function HomeScreen({ navigation }: BottomTabScreenProps<MainTabs, 'Home'>) {
  return <Screen eyebrow="Your training cockpit" title="SportOS">
    <Card title="Welcome back">
      <Body>SportOS on iPhone reads the same canonical training data as the web app. Official scores and activity facts are always calculated by the server.</Body>
      <SourceBadge label="API is authoritative" />
    </Card>
    <Card title="Today's training">
      <StatusPanel kind="comingSoon" message="Home score, coverage and recent training will be connected in issue #189. No placeholder numbers are shown as real results." />
      <Action title="Open Daily" onPress={() => navigation.navigate('Daily')} />
    </Card>
    <Card title="Your activities">
      <Body subdued>Runs, swims, rides, walks and training history will arrive in #190.</Body>
      <Action title="Open Activities" secondary onPress={() => navigation.navigate('Activities')} />
    </Card>
  </Screen>;
}

export function DailyScreen() {
  const [date, setDate] = useState(localToday());
  return <Screen eyebrow="Daily history" title="Daily">
    <Card title="Choose day">
      <DateStepper date={date} onChange={setDate} />
      <StatusPanel kind="comingSoon" message="Daily scores and provenance are not yet connected. This screen will read the canonical daily API in #189." />
    </Card>
  </Screen>;
}

export function ActivitiesScreen() {
  return <Screen eyebrow="Canonical training" title="Activities">
    <StatusPanel kind="comingSoon" message="The activity feed, filters and sport-specific detail screens are scheduled for #190. There is no automatic provider rich-data download on entry." />
  </Screen>;
}

export function RunLabScreen() {
  return <Screen eyebrow="Your running performances" title="Run Lab">
    <StatusPanel kind="comingSoon" message="Measured best efforts, historical distance leaderboards, estimates and provenance will be wired to the server in #192. No times are inferred in the shell." />
  </Screen>;
}

export function MoreScreen({ navigation }: BottomTabScreenProps<MainTabs, 'More'>) {
  const { session, signOut } = useSession();
  return <Screen eyebrow="Account and preferences" title="More">
    <Card title="Signed in">
      <Body>{session?.account.displayName ?? 'SportOS account'}</Body>
      <Body subdued>Session expires: {session?.absoluteExpiresAt ?? '—'}</Body>
      <Action title="Sign out of this phone" secondary onPress={() => { void signOut(); }} />
    </Card>
    <Card title="About the mobile app">
      <Body>Privacy, coverage and the mobile roadmap.</Body>
      <Action title="About SportOS" onPress={() => navigation.getParent()?.navigate('About')} />
    </Card>
  </Screen>;
}

export function AboutScreen(_: NativeStackScreenProps<RootStack, 'About'>) {
  return <Screen nested title="About SportOS">
    <Card title="Data ownership">
      <Body>All canonical activity, daily scoring and running calculations are served by the SportOS API. The phone stores only a revocable session in Keychain.</Body>
      <SourceBadge label="No direct provider access" />
    </Card>
    <Card title="Scope">
      <Body>Mobile views are being added across epic #185. Apple Health, widgets and notifications are out of scope until explicitly approved.</Body>
    </Card>
  </Screen>;
}
