// Тема antd: дизайн V1 TRENDSETTER — белый фон, прямые углы, линии 1px, Inter Tight + Geist Mono, TS · Motion.
// Две палитры — светлая и тёмная; значения совпадают с переменными в styles.css (:root и [data-theme='dark']).
// antd считает оттенки hover/active сам, поэтому здесь конкретные цвета, а не var(--…).
import { theme as antdTheme } from 'antd'

const PALETTE = {
  // fill — заливка главной кнопки (белый текст), link — красный текст на фоне темы
  light: {
    fill: '#A22325', fillHover: '#861C1E', fillActive: '#7E1A1C', link: '#A22325', linkHover: '#861C1E',
    ink: '#252120', muted: '#4A4644', page: '#FFFFFF', surface: '#FFFFFF', surface2: '#F3F3F3', elevated: '#FFFFFF',
    border: '#D9D9D9', borderSoft: '#D9D9D9', rowBorder: '#D9D9D9', forest: '#2F6B4F', warn: '#7A5D00',
    mask: 'rgba(37,33,32,.45)', track: '#ECECEC',
  },
  dark: {
    fill: '#A22325', fillHover: '#B8302F', fillActive: '#8E1E20', link: '#F06A6C', linkHover: '#F48A8B',
    ink: '#F2EFEC', muted: '#B9B3AF', page: '#141211', surface: '#141211', surface2: '#211E1D', elevated: '#211E1D',
    border: '#353332', borderSoft: '#353332', rowBorder: '#353332', forest: '#7CCB9C', warn: '#F4CF3A',
    mask: 'rgba(0,0,0,.6)', track: '#2E2B29',
  },
}

// Приглушённые базовые цвета antd: из них строятся пресеты Tag (color="blue", "green", …) и индикаторы.
// Те же тона, что --data-* в styles.css, — бейджи, диаграммы и проценты в одной палитре, без кислотных оттенков.
const SEEDS = {
  blue: '#1E3F8C', geekblue: '#1E3F8C', cyan: '#2F6B6B', green: '#2F6B4F', lime: '#5E7A2E',
  gold: '#A88412', yellow: '#C9A227', orange: '#B05A1E', volcano: '#A8451E', red: '#A22325',
  magenta: '#9A3F7E', pink: '#C26AA3', purple: '#5A4A8C',
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
      colorBgElevated: c.elevated,
      colorBorder: c.border,
      colorBorderSecondary: c.borderSoft,
      colorSuccess: c.forest,
      colorWarning: c.warn,
      colorError: c.link,
      colorBgMask: c.mask,
      // Углы везде прямые (как --radius-* в styles.css)
      borderRadius: 0,
      borderRadiusLG: 0,
      borderRadiusSM: 0,
      borderRadiusXS: 0,
      borderRadiusOuter: 0,
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      fontSizeSM: 12,
      fontWeightStrong: 500,
      lineWidthFocus: 2,
      boxShadow: 'none',
      boxShadowSecondary: 'none',
      boxShadowTertiary: 'none',
      controlHeight: 44,
      controlHeightSM: 32,
      controlHeightLG: 52,
      // TS · Motion: hover 150 · enter 250 · bracket 350
      motionDurationFast: '0.15s',
      motionDurationMid: '0.25s',
      motionDurationSlow: '0.35s',
      motionEaseOut: 'ease-out',
    },
    components: {
      Button: {
        primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none', fontWeight: 400, paddingInline: 18,
        defaultBorderColor: c.ink, defaultColor: c.ink, defaultBg: 'transparent', defaultHoverBorderColor: c.link, defaultHoverColor: c.link,
        defaultHoverBg: 'transparent', defaultActiveBg: 'transparent',
      },
      Drawer: { colorBgMask: c.mask },
      Table: { headerBg: c.surface, headerColor: c.muted, rowHoverBg: c.surface2, borderColor: c.rowBorder, headerSplitColor: 'transparent' },
      Collapse: { headerBg: c.surface, contentBg: c.surface },
      Tabs: { titleFontSize: 15, inkBarColor: c.fill, itemSelectedColor: c.link, itemHoverColor: c.link },
      Menu: { itemSelectedColor: c.link },
      Badge: { colorError: c.fill },
      Segmented: { itemSelectedBg: c.ink, itemSelectedColor: c.page, trackBg: 'transparent', trackPadding: 0 },
      Switch: { colorPrimary: c.ink, colorPrimaryHover: c.ink, handleBg: c.page },
      Progress: { defaultColor: c.forest, remainingColor: c.track },
      Skeleton: { gradientFromColor: c.rowBorder, gradientToColor: c.rowBorder },
    },
  }
}
