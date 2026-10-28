// Тема antd по дизайн-системе TRENDSETTER v2.0: плоско (углы 0, без теней), Inter Regular/Medium, TS · Motion.
// Две палитры — светлая и тёмная; значения совпадают с переменными в styles.css (:root и [data-theme='dark']).
// antd считает оттенки hover/active сам, поэтому здесь конкретные цвета, а не var(--…).
import { theme as antdTheme } from 'antd'

const PALETTE = {
  light: {
    red: '#A22325', redHover: '#861C1E', redActive: '#7E1A1C',
    ink: '#252120', muted: '#5B5552', page: '#F6F4F2', surface: '#FFFFFF', surface2: '#FAF9F8',
    border: '#D9D3CF', borderSoft: '#E6E1DE', rowBorder: '#EFECEA', forest: '#005844', warn: '#B03C00',
    mask: 'rgba(37,33,32,.45)',
  },
  dark: {
    red: '#D04446', redHover: '#DD5E60', redActive: '#B8393B',
    ink: '#EEEAE7', muted: '#ADA5A1', page: '#141211', surface: '#1E1B1A', surface2: '#272322',
    border: '#4A4442', borderSoft: '#36312F', rowBorder: '#2C2826', forest: '#4FB58A', warn: '#F08A4B',
    mask: 'rgba(0,0,0,.6)',
  },
}

export function getTheme(mode) {
  const c = PALETTE[mode] ?? PALETTE.light
  return {
    algorithm: mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: c.red,
      colorPrimaryHover: c.redHover,
      colorPrimaryActive: c.redActive,
      colorLink: c.red,
      colorLinkHover: c.redHover,
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
      colorError: c.red,
      colorBgMask: c.mask,
      borderRadius: 0,
      borderRadiusLG: 0,
      borderRadiusSM: 0,
      borderRadiusXS: 0,
      borderRadiusOuter: 0,
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
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
      Button: { primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none', defaultBorderColor: c.ink, defaultColor: c.ink, defaultBg: c.surface, fontWeight: 500 },
      Drawer: { colorBgMask: c.mask },
      Table: { headerBg: c.surface, headerColor: c.muted, rowHoverBg: c.surface2, borderColor: c.rowBorder, headerSplitColor: 'transparent' },
      Collapse: { headerBg: c.surface, contentBg: c.surface },
      Tabs: { titleFontSize: 15, inkBarColor: c.red, itemSelectedColor: c.red, itemHoverColor: c.red },
      Segmented: { itemSelectedBg: c.ink, itemSelectedColor: c.surface, trackBg: c.surface },
      Skeleton: { gradientFromColor: c.rowBorder, gradientToColor: c.rowBorder },
    },
  }
}
