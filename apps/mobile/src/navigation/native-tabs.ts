import { Platform } from 'react-native';
import type { NativeBottomTabNavigationOptions } from '@bottom-tabs/react-navigation';
import type { AppleIcon } from 'react-native-bottom-tabs';
import type { MainTabs } from './routes';

const symbols: Record<keyof MainTabs, [AppleIcon['sfSymbol'], AppleIcon['sfSymbol']]> = {
  Home: ['house', 'house.fill'],
  Daily: ['calendar', 'calendar'],
  Activities: ['waveform.path.ecg', 'waveform.path.ecg'],
  RunLab: ['chart.xyaxis.line', 'chart.xyaxis.line'],
  More: ['ellipsis', 'ellipsis'],
};
const images = {
  Home: require('../../assets/tabs/Home.png'),
  Daily: require('../../assets/tabs/Daily.png'),
  Activities: require('../../assets/tabs/Activities.png'),
  RunLab: require('../../assets/tabs/RunLab.png'),
  More: require('../../assets/tabs/More.png'),
};
/** The system owns glass, selection, labels and accessibility appearance. */
export function nativeTabOptions(name: keyof MainTabs): NativeBottomTabNavigationOptions {
  return {
    tabBarButtonTestID: `tab-${name}`,
    tabBarIcon: ({ focused }) => Platform.OS === 'ios'
      ? { sfSymbol: symbols[name][focused ? 1 : 0] }
      : images[name],
  };
}
