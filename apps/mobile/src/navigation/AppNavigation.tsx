import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer, type Theme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSportosTheme } from '../ui/theme';
import { Screen, StatusPanel } from '../ui/primitives';
import { HomeScreen, DailyScreen, ActivitiesScreen, RunLabScreen, MoreScreen, AboutScreen } from '../screens/Features';
import type { MainTabs, RootStack } from './routes';

const Tabs = createBottomTabNavigator<MainTabs>();
const Stack = createNativeStackNavigator<RootStack>();
const symbols: Record<keyof MainTabs, string> = {
  Home: '⌂', Daily: '◷', Activities: '≋', RunLab: '↗', More: '•••',
};

function TabScreens() {
  const { palette } = useSportosTheme();
  return <Tabs.Navigator screenOptions={({ route }) => ({
    headerShown: false,
    tabBarActiveTintColor: palette.accent,
    tabBarInactiveTintColor: palette.muted,
    tabBarStyle: { backgroundColor: palette.surface, borderTopColor: palette.border, minHeight: 58 },
    tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
    tabBarButtonTestID: `tab-${route.name}`,
    tabBarIcon: ({ color }) => <Text accessibilityElementsHidden style={{ color, fontSize: 23 }}>
      {symbols[route.name]}
    </Text>,
  })}>
    <Tabs.Screen name="Home" component={HomeScreen} />
    <Tabs.Screen name="Daily" component={DailyScreen} />
    <Tabs.Screen name="Activities" component={ActivitiesScreen} />
    <Tabs.Screen name="RunLab" component={RunLabScreen} options={{ title: 'Run Lab' }} />
    <Tabs.Screen name="More" component={MoreScreen} />
  </Tabs.Navigator>;
}

function ActivityDetailPlaceholder() {
  return <Screen nested title="Activity detail">
    <StatusPanel kind="comingSoon" message="Sport-specific detail will be implemented in #190, using only canonical owner-scoped activity reads." />
  </Screen>;
}

export function AppNavigation() {
  const { palette, dark } = useSportosTheme();
  const navTheme: Theme = {
    dark,
    colors: {
      primary: palette.accent, background: palette.background,
      card: palette.surface, text: palette.text, border: palette.border,
      notification: palette.warning,
    },
    fonts: {
      regular: { fontFamily: 'System', fontWeight: '400' },
      medium: { fontFamily: 'System', fontWeight: '500' },
      bold: { fontFamily: 'System', fontWeight: '700' },
      heavy: { fontFamily: 'System', fontWeight: '800' },
    },
  };
  return <NavigationContainer theme={navTheme}>
    <Stack.Navigator screenOptions={{ headerBackTitle: 'Back' }}>
      <Stack.Screen name="Main" component={TabScreens} options={{ headerShown: false }} />
      <Stack.Screen name="About" component={AboutScreen} />
      <Stack.Screen name="ActivityDetail" component={ActivityDetailPlaceholder} options={{ title: 'Activity' }} />
    </Stack.Navigator>
  </NavigationContainer>;
}
