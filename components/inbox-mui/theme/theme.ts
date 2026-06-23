import { createTheme, type Theme } from '@mui/material/styles';

// Restrained neutral light + dark palettes for Agent Inbox (ElevenLabs-inspired).
// Dark mode uses charcoal surfaces (#18181D paper, #111115 bg) not navy.
export function makeIrisTheme(mode: 'light' | 'dark'): Theme {
  const isDark = mode === 'dark';
  return createTheme({
    palette: {
      mode,
      primary: {
        main: '#7C6AF5',
        light: '#9B8FFF',
        dark: '#6356D4',
        contrastText: '#ffffff'
      },
      secondary: { main: '#22d3ee' },
      success: { main: isDark ? '#34C678' : '#16A34A' },
      warning: { main: isDark ? '#D97706' : '#b45309' },
      error: { main: isDark ? '#f87171' : '#b91c1c' },
      info: { main: isDark ? '#60A5FA' : '#38bdf8' },
      background: {
        default: isDark ? '#111115' : '#F4F4F7',
        paper: isDark ? '#18181D' : '#ffffff'
      },
      text: {
        primary: isDark ? '#EDEDF5' : '#0a0e1a',
        secondary: isDark ? '#D0D0E8' : '#1A1A2E'
      },
      divider: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.10)'
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
      h4: { fontWeight: 700, letterSpacing: '-0.02em' },
      h5: { fontWeight: 700, letterSpacing: '-0.02em' },
      h6: { fontWeight: 700, letterSpacing: '-0.01em' },
      subtitle1: { fontWeight: 600 },
      subtitle2: { fontWeight: 600 },
      button: { fontWeight: 600, textTransform: 'none' },
      overline: { fontWeight: 700, letterSpacing: '0.12em' }
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: 'var(--s-bg)'
          }
        }
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: isDark ?
            '1px solid rgba(255,255,255,0.07)' :
            '1px solid rgba(15,23,42,0.10)',
            backgroundColor: isDark ? '#18181D' : '#ffffff'
          }
        }
      },
      MuiButton: { styleOverrides: { root: { borderRadius: 10 } } },
      MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: isDark ? '#242429' : '#E8E8EF',
            fontSize: 12,
            border: isDark ? '1px solid rgba(255,255,255,0.06)' : 'none'
          }
        }
      }
    }
  });
}

export const irisTheme = makeIrisTheme('light');