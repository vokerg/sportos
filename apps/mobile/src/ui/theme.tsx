import React, { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';

export interface Palette {
  background: string; surface: string; text: string; muted: string;
  accent: string; accentText: string; border: string; warning: string; chart: string;
  soft: string; hero: string; heroText: string; heroMuted: string; lime: string;
}

const light: Palette = {
  background: '#F4F5F0', surface: '#FFFFFF', text: '#19251F', muted: '#647068',
  accent: '#285A40', accentText: '#FFFFFF', border: '#E3E7DE', warning: '#945600', chart: '#527C45',
  soft: '#EAF0E5', hero: '#1B3025', heroText: '#F7FAF1', heroMuted: '#BCCBBC', lime: '#D5F477',
};
const darkPalette: Palette = {
  background: '#101713', surface: '#1B251E', text: '#F2F5EC', muted: '#ACB8AC',
  accent: '#D5F477', accentText: '#1B3025', border: '#303D32', warning: '#F0BE71', chart: '#D5F477',
  soft: '#29382A', hero: '#233B2B', heroText: '#F7FAF1', heroMuted: '#C0CEBD', lime: '#D5F477',
};

const Context = createContext<{ palette: Palette; dark: boolean }>({ palette: light, dark: false });
export function SportosThemeProvider({ children }: { children: React.ReactNode }) {
  const dark = useColorScheme() === 'dark';
  return <Context.Provider value={{ palette: dark ? darkPalette : light, dark }}>{children}</Context.Provider>;
}
export function useSportosTheme() { return useContext(Context); }
