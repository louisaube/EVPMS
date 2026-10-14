import '@fontsource/fredoka/400.css'
import '@fontsource/fredoka/600.css'
import '@fontsource/wix-madefor-display/400.css'
import '@fontsource/wix-madefor-display/600.css'
import { createTheme } from '@mui/material'
import { frFR } from '@mui/material/locale'

const HEADING_FONT = '"Fredoka", "Nunito", "Varela Round", ui-rounded, system-ui, sans-serif'
const BODY_FONT = '"Wix Madefor Display", system-ui, sans-serif'

/** rule-evp-layout-theme-tokens */
export const COLORS = {
  action: '#3E5FD9',
  title: '#2A43A8',
  light: '#EFF3FF',
  vigilance: '#FFFBE0',
  text: '#262C45',
}

const base = createTheme({ breakpoints: { values: { xs: 0, sm: 480, md: 767, lg: 1200, xl: 1536 } } })

export const theme = createTheme(
  {
    breakpoints: base.breakpoints,
    palette: {
      primary: { main: COLORS.action, dark: COLORS.title },
      text: { primary: COLORS.text },
      background: { default: COLORS.light },
    },
    typography: {
      fontFamily: BODY_FONT,
      fontSize: 16,
      body1: { lineHeight: 1.6 },
      body2: { lineHeight: 1.6 },
      h1: { fontFamily: HEADING_FONT, color: COLORS.title },
      h2: { fontFamily: HEADING_FONT, color: COLORS.title },
      h3: { fontFamily: HEADING_FONT, color: COLORS.title },
      h4: { fontFamily: HEADING_FONT, color: COLORS.title, fontSize: '1.75rem', fontWeight: 600 },
      h5: { fontFamily: HEADING_FONT, color: COLORS.title, fontWeight: 600 },
      h6: { fontFamily: HEADING_FONT, color: COLORS.title, fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    shape: { borderRadius: 12 },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { backgroundColor: COLORS.light, lineHeight: 1.6 },
          '@media (prefers-reduced-motion: reduce)': {
            '*, *::before, *::after': {
              animationDuration: '0.01ms !important',
              animationIterationCount: '1 !important',
              transitionDuration: '0.01ms !important',
            },
          },
          ':focus-visible': { outline: `3px solid ${COLORS.title}`, outlineOffset: '2px' },
        },
      },
      MuiButtonBase: {
        styleOverrides: { root: { '&.Mui-focusVisible': { outline: `3px solid ${COLORS.title}`, outlineOffset: '2px' } } },
      },
      MuiButton: { styleOverrides: { root: { borderRadius: 24, minHeight: 46, paddingLeft: 20, paddingRight: 20 } } },
      MuiIconButton: { styleOverrides: { root: { minWidth: 44, minHeight: 44 } } },
    },
  },
  frFR,
)

/** rule-evp-layout-focus-motion: no transition when the user asks for less motion. */
if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
  theme.transitions.create = () => 'none'
}
