// Тема antd: Soft Minimalism — тёплые поверхности, скругления 8/14, Inter Tight Regular/Medium, TS · Motion.
// Две палитры — светлая и тёмная; значения совпадают с переменными в styles.css (:root и [data-theme='dark']).
// antd считает оттенки hover/active сам, поэтому здесь конкретные цвета, а не var(--…).
import { theme as antdTheme } from 'antd'

const PALETTE = {
  // fill — заливка главной кнопки (белый текст), link — красный текст на фоне темы
  light: {
    fill: '#A22325', fillHover: '#861C1E', fillActive: '#7E1A1C', link: '#A22325', linkHover: '#861C1E',
    ink: '#252120', muted: '#4A4644', page: '#F6F4F1', surface: '#FFFFFF', surface2: '#F6F4F1',
    border: '#D6D0C8', borderSoft: '#E3DED7', rowBorder: '#EEEAE4', forest: '#005844', warn: '#9A5A00',
    mask: 'rgba(37,33,32,.45)', track: '#ECE8E2',
  },
  dark: {
    fill: '#B8302F', fillHover: '#C9403F', fillActive: '#A12827', link: '#E8807E', linkHover: '#F0A09E',
    ink: '#ECE9E6', muted: '#B8B2AE', page: '#1A1817', surface: '#252220', surface2: '#2D2A27',
    border: '#4B4744', borderSoft: '#37332F', rowBorder: '#2F2B28', forest: '#6FC49C', warn: '#E2B04A',
    mask: 'rgba(0,0,0,.6)', track: '#38342F',
  },
}

export function getTheme(mode) {
  const c = PALETTE[mode] ?? PALETTE.light
  return {
    algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
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
      Skeleton: { gradientFromColor: c.rowBorder, gradientToColor: c.rowBorder },
    },
  }
}
