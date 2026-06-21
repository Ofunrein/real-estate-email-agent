"use client";
import React, { useEffect, useMemo, useState, createContext, useContext } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { makeIrisTheme } from './theme';

type Mode = 'light' | 'dark';

interface ColorModeContextValue {
  mode: Mode;
  toggle: () => void;
}

const ColorModeContext = createContext<ColorModeContextValue>({
  mode: 'light',
  toggle: () => undefined,
});

export function useColorMode(): ColorModeContextValue {
  return useContext(ColorModeContext);
}

export function ColorModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>('light');

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const saved = window.localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') {
      setMode(saved);
      return;
    }
    setMode(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const el = document.documentElement;
    if (mode === 'dark') el.classList.add('dark');
    else el.classList.remove('dark');
    el.style.colorScheme = mode;
    window.localStorage.setItem('theme', mode);
  }, [mode]);

  const theme = useMemo(() => makeIrisTheme(mode), [mode]);
  const value = useMemo(
    () => ({
      mode,
      toggle: () => setMode((m) => (m === 'dark' ? 'light' : 'dark')),
    }),
    [mode],
  );

  return (
    <ColorModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}
