// Тема antd по дизайн-системе TRENDSETTER v2.0: плоско (углы 0, без теней), Inter Regular/Medium, TS · Motion.
// Остальные стили — в styles.css.
const theme = {
  token: {
    colorPrimary: '#A22325',
    colorPrimaryHover: '#861C1E',
    colorLink: '#A22325',
    colorLinkHover: '#7E1A1C',
    colorTextBase: '#252120',
    colorTextSecondary: '#5B5552',
    colorBgLayout: '#F6F4F2',
    colorBorder: '#D9D3CF',
    colorBorderSecondary: '#E6E1DE',
    colorSuccess: '#005844',
    colorWarning: '#B03C00',
    colorError: '#A22325',
    borderRadius: 0,
    borderRadiusLG: 0,
    borderRadiusSM: 0,
    borderRadiusXS: 0,
    borderRadiusOuter: 0,
    fontFamily: "var(--font-sans)",
    fontSize: 14,
    fontWeightStrong: 500,
    boxShadow: 'none',
    boxShadowSecondary: 'none',
    boxShadowTertiary: 'none',
    colorBgMask: 'rgba(37,33,32,.45)',
    controlHeight: 36,
    // TS · Motion: hover 150 · enter 250 · bracket 350
    motionDurationFast: '0.15s',
    motionDurationMid: '0.25s',
    motionDurationSlow: '0.35s',
    motionEaseOut: 'ease-out',
  },
  components: {
    Button: { primaryShadow: 'none', defaultShadow: 'none', defaultBorderColor: '#252120', defaultColor: '#252120', fontWeight: 500 },
    Drawer: { colorBgMask: 'rgba(37,33,32,.45)' },
    Table: { headerBg: '#fff', headerColor: '#5B5552', rowHoverBg: '#FAF9F8', borderColor: '#EFECEA', headerSplitColor: 'transparent' },
    Tabs: { titleFontSize: 15, inkBarColor: '#A22325', itemSelectedColor: '#A22325', itemHoverColor: '#A22325' },
    Segmented: { itemSelectedBg: '#252120', itemSelectedColor: '#fff', trackBg: '#fff' },
    Skeleton: { gradientFromColor: '#EFECEA', gradientToColor: '#EFECEA' },
    Collapse: { headerBg: '#fff', contentBg: '#fff' },
  },
}

export default theme
