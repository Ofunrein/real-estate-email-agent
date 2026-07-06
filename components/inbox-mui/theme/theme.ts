import { createTheme, type Theme } from '@mui/material/styles';
import { irisPalette, IRIS_FONT_UI, type IrisPalette } from './tokens';

declare module '@mui/material/styles' {
  interface Theme {
    iris: IrisPalette;
  }
  interface ThemeOptions {
    iris?: IrisPalette;
  }
}

// Iris Design System — warm paper light mode, deep charcoal dark mode.
// `primary` (ink) drives structural chrome — buttons, active states.
// `theme.iris.accent` (amber) is reserved for "Iris did this" AI signals —
// avatar rings, draft banners, AI-active badges. Never use it for generic UI.
export function makeIrisTheme(mode: 'light' | 'dark'): Theme {
  const isDark = mode === 'dark';
  const p = irisPalette(mode);
  return createTheme({
    iris: p,
    palette: {
      mode,
      primary: {
        main: p.primary,
        light: isDark ? '#FFFFFF' : '#3A362F',
        dark: isDark ? '#D8D5CE' : '#000000',
        contrastText: p.onPrimary
      },
      secondary: { main: p.accent },
      success: { main: p.success },
      warning: { main: p.warning },
      error: { main: p.danger },
      info: { main: p.info },
      background: {
        default: p.bg,
        paper: p.card
      },
      text: {
        primary: p.text,
        secondary: p.textMuted
      },
      divider: p.cardBorder
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: IRIS_FONT_UI,
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
            backgroundColor: p.bg
          }
        }
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: `1px solid ${p.cardBorder}`,
            backgroundColor: p.card
          }
        }
      },
      MuiButton: { styleOverrides: { root: { borderRadius: 10 } } },
      MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: isDark ? '#1B2430' : '#EFEDE4',
            fontSize: 12,
            border: isDark ? '1px solid rgba(255,255,255,0.09)' : 'none'
          }
        }
      }
    }
  });
}

export const irisTheme = makeIrisTheme('light');