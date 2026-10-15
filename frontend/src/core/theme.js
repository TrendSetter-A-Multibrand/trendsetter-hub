// Тема antd по брендбуку Trendsetter. Остальные стили — в styles.css.
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
    borderRadius: 4,
    borderRadiusLG: 4,
    borderRadiusSM: 2,
    fontFamily: "'Inter Tight', Arial, sans-serif",
    fontSize: 14,
    boxShadow: 'none',
    boxShadowSecondary: '-12px 0 40px rgba(37,33,32,.18)',
  },
  components: {
    Button: { primaryShadow: 'none', defaultShadow: 'none', defaultBorderColor: '#252120', defaultColor: '#252120', fontWeight: 500 },
    Drawer: { colorBgMask: 'rgba(37,33,32,.45)' },
    Table: { headerBg: '#fff', headerColor: '#5B5552', rowHoverBg: '#FAF9F8', borderColor: '#EFECEA' },
    Collapse: { headerBg: '#fff', contentBg: '#fff' },
  },
}

export default theme
