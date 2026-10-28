import React from 'react';
import { TabIcon } from '../ui/TabIcon';
import { NavigationContainer, type Theme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSportosTheme } from '../ui/theme';
import { HomeScreen, DailyScreen, ActivitiesScreen, RunLabScreen, MoreScreen, AboutScreen } from '../screens/Features';
import { DailyDetailScreen } from '../daily/screens';
import { ActivityDetailScreen } from '../activities/screens';
import type { MainTabs, RootStack } from './routes';

const Tabs = createBottomTabNavigator<MainTabs>();
const Stack = createNativeStackNavigator<RootStack>();
function TabScreens() {
  const { palette } = useSportosTheme();
  return <Tabs.Navigator screenOptions={({ route }) => ({
    headerShown: false,
    tabBarActiveTintColor: palette.accent,
    tabBarInactiveTintColor: palette.muted,
    tabBarStyle: { backgroundColor: palette.surface, borderTopColor: palette.border, minHeight: 58 },
    tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
    tabBarButtonTestID: `tab-${route.name}`,
    tabBarIcon: ({ color }) => <TabIcon name={route.name} color={color} />,
  })}>
    <Tabs.Screen name="Home" component={HomeScreen} />
    <Tabs.Screen name="Daily" component={DailyScreen} />
    <Tabs.Screen name="Activities" component={ActivitiesScreen} />
    <Tabs.Screen name="RunLab" component={RunLabScreen} options={{ title: 'Run Lab' }} />
    <Tabs.Screen name="More" component={MoreScreen} />
  </Tabs.Navigator>;
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
      <Stack.Screen name="ActivityDetail" component={ActivityDetailScreen} options={{ title: 'Activity' }} />
      <Stack.Screen name="DailyDetail" component={DailyDetailScreen} options={{ title: 'Daily score' }} />
    </Stack.Navigator>
  </NavigationContainer>;
}
