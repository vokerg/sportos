import React, { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';

export interface Palette {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  border: string;
  warning: string;
  chart: string;
}

const light: Palette = {
  background: '#F3F7F8', surface: '#FFFFFF', text: '#102B31',
  muted: '#50656D', accent: '#116974', accentText: '#FFFFFF',
  border: '#C9D9DE', warning: '#955100', chart: '#168496',
};
const dark: Palette = {
  background: '#0D1A22', surface: '#182A33', text: '#F2F8FA',
  muted: '#BED0D8', accent: '#81D3D2', accentText: '#102B31',
  border: '#405760', warning: '#F9C36B', chart: '#81D3D2',
};

const Context = createContext<{ palette: Palette; dark: boolean }>({ palette: light, dark: false });

export function SportosThemeProvider({ children }: { children: React.ReactNode }) {
  const isDark = useColorScheme() === 'dark';
  return <Context.Provider value={{ palette: isDark ? dark : light, dark: isDark }}>
    {children}
  </Context.Provider>;
}
export function useSportosTheme() { return useContext(Context); }
