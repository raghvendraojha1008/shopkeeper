import { useState, useEffect } from 'react';

/**
 * Returns true when the app is in dark mode.
 * Reads from the document root's data-theme-mode attribute
 * (set by applyThemeToDocument in theme.ts) and updates reactively.
 */
export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState<boolean>(
    () => document.documentElement.dataset.themeMode !== 'light'
  );

  useEffect(() => {
    const obs = new MutationObserver(() => {
      setIsDark(document.documentElement.dataset.themeMode !== 'light');
    });
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme-mode'],
    });
    return () => obs.disconnect();
  }, []);

  return isDark;
}
