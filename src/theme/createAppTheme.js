import { createTheme } from '@mui/material/styles';
import { color, font, radius, shadow } from './tokens';

/**
 * Builds the MUI theme for a given mode ('light' | 'dark').
 * All raw values are pulled from theme/tokens.js so the palette
 * only needs to be tuned in one place.
 */
export function createAppTheme(mode) {
  const isDark = mode === 'dark';

  return createTheme({
    palette: {
      mode,
      primary: {
        main: color.amber500,
        light: color.amber400,
        dark: color.amber600,
        contrastText: '#161A22',
      },
      secondary: {
        main: color.teal400,
        dark: color.teal600,
        contrastText: '#0E1116',
      },
      error: { main: color.red400, dark: color.red600 },
      warning: { main: color.amberWarn400 },
      success: { main: color.teal400 },
      background: {
        default: isDark ? color.graphite900 : color.paper50,
        paper: isDark ? color.graphite800 : color.paper0,
      },
      text: {
        primary: isDark ? color.inkOnDark : color.inkOnLight,
        secondary: isDark ? color.inkOnDarkMuted : color.inkOnLightMuted,
      },
      divider: isDark ? 'rgba(231,233,238,0.08)' : color.paper200,
    },
    shape: { borderRadius: radius.md },
    typography: {
      fontFamily: font.body,
      h1: { fontFamily: font.display, fontWeight: 700, letterSpacing: '-0.02em' },
      h2: { fontFamily: font.display, fontWeight: 700, letterSpacing: '-0.02em' },
      h3: { fontFamily: font.display, fontWeight: 600, letterSpacing: '-0.01em' },
      h4: { fontFamily: font.display, fontWeight: 600 },
      h5: { fontFamily: font.display, fontWeight: 600 },
      h6: { fontFamily: font.display, fontWeight: 600 },
      subtitle1: { fontWeight: 500 },
      button: { textTransform: 'none', fontWeight: 600 },
      overline: {
        fontFamily: font.mono,
        letterSpacing: '0.08em',
        fontWeight: 600,
      },
    },
    customTokens: { color, font, radius, shadow },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          '::selection': {
            backgroundColor: color.amber400,
            color: '#161A22',
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: radius.sm, paddingInline: 16 },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: `1px solid ${isDark ? 'rgba(231,233,238,0.08)' : color.paper200}`,
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            boxShadow: isDark ? 'none' : shadow.low,
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            boxShadow: 'none',
            borderBottom: `1px solid ${isDark ? 'rgba(231,233,238,0.08)' : color.paper200}`,
          },
        },
      },
    },
  });
}
