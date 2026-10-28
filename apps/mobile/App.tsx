import React, { useEffect } from 'react';
import { Platform, StatusBar } from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from './src/auth/SessionProvider';
import { configuredClient } from './src/auth/native';
import { AppNavigation } from './src/navigation/AppNavigation';
import { SportosThemeProvider, useSportosTheme } from './src/ui/theme';
import { Action, Body, Card, Screen, StatusPanel } from './src/ui/primitives';

const client = configuredClient();

function AuthGate() {
  const { status, session, message, retry, signIn, signOut } = useSession();
  if (status === 'authenticated' && session) return <AppNavigation />;
  return <Screen eyebrow="SportOS iPhone" title="Your training, native">
    <Card title="Secure access">
      <Body>Sign in using your existing SportOS account in the system browser. SportOS never asks for your password inside the iPhone app.</Body>
      {status === 'locked' ? <StatusPanel kind="loading" message="Private data hidden while SportOS is inactive." /> : null}
      {status === 'restoring' ? <StatusPanel kind="loading" message="Checking your secure session…" /> : null}
      {status === 'unavailable' ? <StatusPanel kind="offline"
        message={message ?? 'Cannot reach SportOS to check your session.'} retry={() => { void retry(); }} /> : null}
      {status === 'unavailable' ? <Action title="Sign out on this phone" secondary
        onPress={() => { void signOut(); }} /> : null}
      {status === 'signedOut' || status === 'signingIn' ? <>
        {message ? <StatusPanel kind="error" message={message} /> : null}
        {status === 'signingIn' ? <StatusPanel kind="loading" message="Complete approval in your browser…" /> : null}
        <Action title={status === 'signingIn' ? 'Signing in…' : 'Sign in to SportOS'}
          disabled={status === 'signingIn'} onPress={() => { void signIn(); }} />
      </> : null}
    </Card>
    <Body subdued>A mobile session is revocable and stored in the device Keychain. Training data is read from SportOS and is not cached on this phone.</Body>
  </Screen>;
}

function Content() {
  const { dark } = useSportosTheme();
  return <>
    <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
    {!client ? <Screen eyebrow="Local setup required" title="Configure SportOS">
      <StatusPanel kind="error" message="Set EXPO_PUBLIC_SPORTOS_API_URL and EXPO_PUBLIC_SPORTOS_WEB_ORIGIN to the HTTPS API and browser-login origins in apps/mobile/.env. This app does not offer a mock sign-in." />
    </Screen> : <SessionProvider client={client}><AuthGate /></SessionProvider>}
  </>;
}

export default function App() {
  useEffect(() => {
    if (Platform.OS === 'ios') {
      void ScreenCapture.enableAppSwitcherProtectionAsync(1).catch(() => {});
      return () => { void ScreenCapture.disableAppSwitcherProtectionAsync().catch(() => {}); };
    }
    void ScreenCapture.preventScreenCaptureAsync('sportos-private').catch(() => {});
    return () => { void ScreenCapture.allowScreenCaptureAsync('sportos-private').catch(() => {}); };
  }, []);
  return <SafeAreaProvider><SportosThemeProvider><Content /></SportosThemeProvider></SafeAreaProvider>;
}
