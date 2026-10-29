import React from 'react';
import { ActivitiesScreen } from '../activities/screens';
import type { NativeBottomTabScreenProps } from '@bottom-tabs/react-navigation';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Body, Action, Card, NavigationRow, Screen, SourceBadge, StatusPanel } from '../ui/primitives';
import { useSession } from '../auth/SessionProvider';
import type { MainTabs, RootStack } from '../navigation/routes';

export { HomeScreen, DailyScreen } from '../daily/screens';

export { ActivitiesScreen };

export { RunLabScreen } from '../performance/screens';

export function MoreScreen({ navigation }: NativeBottomTabScreenProps<MainTabs, 'More'>) {
  const { session, signOut } = useSession();
  return <Screen eyebrow="SPORTOS" title="More">
    <Card title="Explore">
      <NavigationRow title="Providers" detail="Strava sync and job status" icon="arrow" onPress={() => navigation.getParent<NativeStackNavigationProp<RootStack>>()?.navigate('Providers')} />
      <NavigationRow title="Training trends" detail="Dynamics & monthly stats" icon="chart" onPress={() => navigation.getParent<NativeStackNavigationProp<RootStack>>()?.navigate('Analytics')} />
      <NavigationRow title="Your map" detail="A heatmap of the ground you covered" icon="map" onPress={() => navigation.getParent<NativeStackNavigationProp<RootStack>>()?.navigate('Heatmap')} />
      <NavigationRow title="About SportOS" detail="Your data, privacy and coverage" icon="info" onPress={() => navigation.getParent<NativeStackNavigationProp<RootStack>>()?.navigate('About')} />
    </Card>
    <Card title={session?.account.displayName ?? 'SportOS account'}>
      <SourceBadge label="Private account" />
      <Body subdued>Session expires: {session?.absoluteExpiresAt ?? '—'}</Body>
      <Action title="Sign out of this phone" secondary onPress={() => { void signOut(); }} />
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
      <Body>Browse canonical scores, activities, routes, running achievements and training trends. Source coverage and recorded timing remain visible throughout.</Body>
    </Card>
  </Screen>;
}
