import React from 'react';
import { ActivitiesScreen } from '../activities/screens';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Body, Action, Card, Screen, SourceBadge, StatusPanel } from '../ui/primitives';
import { useSession } from '../auth/SessionProvider';
import type { MainTabs, RootStack } from '../navigation/routes';

export { HomeScreen, DailyScreen } from '../daily/screens';

export { ActivitiesScreen };

export { RunLabScreen } from '../performance/screens';

export function MoreScreen({ navigation }: BottomTabScreenProps<MainTabs, 'More'>) {
  const { session, signOut } = useSession();
  return <Screen eyebrow="Account and preferences" title="More">
    <Card title="Signed in">
      <Body>{session?.account.displayName ?? 'SportOS account'}</Body>
      <Body subdued>Session expires: {session?.absoluteExpiresAt ?? '—'}</Body>
      <Action title="Sign out of this phone" secondary onPress={() => { void signOut(); }} />
    </Card>
    <Card title="Explore your training">
      <Action title="Private route heatmap" onPress={() => navigation.getParent<NativeStackNavigationProp<RootStack>>()?.navigate('Heatmap')} />
    </Card>
    <Card title="About the mobile app">
      <Body>Privacy, coverage and the mobile roadmap.</Body>
      <Action title="About SportOS" onPress={() => navigation.getParent<NativeStackNavigationProp<RootStack>>()?.navigate('About')} />
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
