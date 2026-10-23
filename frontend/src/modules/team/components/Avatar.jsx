// Круглый аватар: фото (если есть) или инициалы на цвете направления. src — полное фото вместо превью.
export default function Avatar({ person, size, font, src }) {
  const url = src ?? person.thumb
  const style = { width: size, height: size, fontSize: font }
  if (url) return <img className="tm-av" src={url} alt="" style={style} />
  return (
    <div className="tm-av" style={{ ...style, background: person.av.bg, color: person.av.ink }}>
      {person.initials}
    </div>
  )
}
