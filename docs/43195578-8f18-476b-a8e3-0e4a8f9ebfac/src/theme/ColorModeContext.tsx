import React, { useMemo, useState, createContext, useContext } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { makeIrisTheme } from './theme';
type Mode = 'light' | 'dark';
interface ColorModeContextValue {
  mode: Mode;
  toggle: () => void;
}
const ColorModeContext = createContext<ColorModeContextValue>({
  mode: 'light',
  toggle: () => undefined
});
export function useColorMode(): ColorModeContextValue {
  return useContext(ColorModeContext);
}
export function ColorModeProvider({ children }: {children: React.ReactNode;}) {
  const [mode, setMode] = useState<Mode>('light');
  const theme = useMemo(() => makeIrisTheme(mode), [mode]);
  const value = useMemo(
    () => ({
      mode,
      toggle: () => setMode((m) => m === 'dark' ? 'light' : 'dark')
    }),
    [mode]
  );
  return (
    <ColorModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>);

}