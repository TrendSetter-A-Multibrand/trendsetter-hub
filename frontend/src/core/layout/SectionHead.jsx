// Заголовок раздела дизайна V1: [ НАЗВАНИЕ ] + линия 1px на всю ширину + необязательная ссылка или переключатель справа
export default function SectionHead({ title, id, children }) {
  return (
    <div className="sec-head">
      <h2 id={id}>[ {title} ]</h2>
      <span className="sec-line" aria-hidden="true" />
      {children}
    </div>
  )
}
