// Тема antd: Soft Minimalism + TRENDSETTER — нейтралка из палитры Claude.ai (тёплый stone/cream), белые поверхности,
// скругления 8/14, Inter Tight Regular/Medium, TS · Motion, фирменный Red как акцент.
// Две палитры — светлая и тёмная; значения совпадают с переменными в styles.css (:root и [data-theme='dark']).
// antd считает оттенки hover/active сам, поэтому здесь конкретные цвета, а не var(--…).
import { theme as antdTheme } from 'antd'

const PALETTE = {
  // fill — заливка главной кнопки (белый текст), link — красный текст на фоне темы
  light: {
    fill: '#A22325', fillHover: '#861C1E', fillActive: '#7E1A1C', link: '#A22325', linkHover: '#861C1E',
    ink: '#141413', muted: '#3D3D3A', page: '#FAF9F6', surface: '#FFFFFF', surface2: '#F5F4ED',
    border: '#BCBCBB', borderSoft: '#DDDDDD', rowBorder: '#DDDDDD', forest: '#265B19', warn: '#5A4815',
    mask: 'rgba(20,20,19,.45)', track: '#E7E7E0',
  },
  dark: {
    fill: '#B8302F', fillHover: '#C9403F', fillActive: '#A12827', link: '#E8807E', linkHover: '#F0A09E',
    ink: '#FAF9F5', muted: '#C2C0B6', page: '#141413', surface: '#30302E', surface2: '#262624',
    border: '#64645F', borderSoft: '#4A4A46', rowBorder: '#4A4A46', forest: '#7AB948', warn: '#D1A041',
    mask: 'rgba(0,0,0,.6)', track: '#3B3B39',
  },
}

// Приглушённые базовые цвета antd: из них строятся пресеты Tag (color="blue", "green", …) и индикаторы.
// Те же тона, что --data-* в styles.css, — бейджи, диаграммы и проценты в одной палитре, без кислотных оттенков.
const SEEDS = {
  blue: '#4A6B9A', geekblue: '#55649A', cyan: '#3F7F7A', green: '#3F7A5F', lime: '#7A8F45',
  gold: '#B48A2E', yellow: '#C9A443', orange: '#A85F33', volcano: '#A85A3A', red: '#A22325',
  magenta: '#A0628F', pink: '#B57AA6', purple: '#76649C',
}

export function getTheme(mode) {
  const c = PALETTE[mode] ?? PALETTE.light
  return {
    algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      ...SEEDS,
      colorInfo: SEEDS.blue,
      colorPrimary: c.fill,
      colorPrimaryHover: c.fillHover,
      colorPrimaryActive: c.fillActive,
      colorLink: c.link,
      colorLinkHover: c.linkHover,
      colorTextBase: c.ink,
      colorTextSecondary: c.muted,
      colorBgBase: c.surface,
      colorBgLayout: c.page,
      colorBgContainer: c.surface,
      colorBgElevated: c.surface,
      colorBorder: c.border,
      colorBorderSecondary: c.borderSoft,
      colorSuccess: c.forest,
      colorWarning: c.warn,
      colorError: c.link,
      colorBgMask: c.mask,
      // Скругления: кнопки и поля 8 · карточки и окна 14 · мелкие 6 (как --radius-* в styles.css)
      borderRadius: 8,
      borderRadiusLG: 14,
      borderRadiusSM: 6,
      borderRadiusXS: 4,
      borderRadiusOuter: 6,
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      fontSizeSM: 12,
      fontWeightStrong: 500,
      boxShadow: 'none',
      boxShadowSecondary: 'none',
      boxShadowTertiary: 'none',
      controlHeight: 36,
      // TS · Motion: hover 150 · enter 250 · bracket 350
      motionDurationFast: '0.15s',
      motionDurationMid: '0.25s',
      motionDurationSlow: '0.35s',
      motionEaseOut: 'ease-out',
    },
    components: {
      Button: {
        primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none', fontWeight: 500,
        defaultBorderColor: c.border, defaultColor: c.ink, defaultBg: c.surface, defaultHoverBorderColor: c.ink, defaultHoverColor: c.ink,
      },
      Drawer: { colorBgMask: c.mask },
      Table: { headerBg: c.surface, headerColor: c.muted, rowHoverBg: c.surface2, borderColor: c.rowBorder, headerSplitColor: 'transparent' },
      Collapse: { headerBg: c.surface, contentBg: c.surface },
      Tabs: { titleFontSize: 15, inkBarColor: c.fill, itemSelectedColor: c.link, itemHoverColor: c.link },
      Menu: { itemSelectedColor: c.link },
      Badge: { colorError: c.fill },
      Segmented: { itemSelectedBg: c.surface, itemSelectedColor: c.link, trackBg: c.track, trackPadding: 4 },
      Progress: { defaultColor: mode === 'dark' ? '#6FAE90' : SEEDS.green, remainingColor: c.track },
      Skeleton: { gradientFromColor: c.rowBorder, gradientToColor: c.rowBorder },
    },
  }
}
