/**
 * Native feature initialization for the Capacitor mobile app.
 *
 * Call `initNativeFeatures()` once in the root layout after the user
 * is authenticated. This sets up:
 * - Status bar theming
 * - Android back button handling
 * - App lifecycle listeners
 */

import { initAppLifecycle } from './deep-links';
import { isNativePlatform } from './platform';
import { setStatusBarStyle } from './status-bar';

interface NativeInitOptions {
  theme: 'dark' | 'light';
  navigate: (path: string) => void;
}

let initialization: Promise<void> | null = null;

/**
 * Initialize all native Capacitor features.
 * Safe to call multiple times — runs once; a failed attempt can be retried.
 */
export function initNativeFeatures(options: NativeInitOptions): Promise<void> {
  if (!isNativePlatform()) return Promise.resolve();
  if (!initialization) {
    initialization = runNativeInit(options).catch((error: Error) => {
      // Allow a later call to retry instead of suppressing init forever.
      initialization = null;
      throw error;
    });
  }
  return initialization;
}

async function runNativeInit({
  theme,
  navigate,
}: NativeInitOptions): Promise<void> {
  await setStatusBarStyle(theme);
  await initAppLifecycle({ navigate });

  // Keyboard plugin — resize body when keyboard opens
  const { Keyboard } = await import('@capacitor/keyboard');
  Keyboard.addListener('keyboardWillShow', (info) => {
    document.body.style.setProperty(
      '--keyboard-height',
      `${info.keyboardHeight}px`
    );
  });
  Keyboard.addListener('keyboardWillHide', () => {
    document.body.style.setProperty('--keyboard-height', '0px');
  });
}

/**
 * Update status bar when theme changes.
 */
export async function updateTheme(theme: 'dark' | 'light'): Promise<void> {
  if (!isNativePlatform()) return;
  await setStatusBarStyle(theme);
}
