import Avatar from './Avatar.jsx'
import AwayTag from './AwayTag.jsx'
import strings from '../strings.js'
import { chainOf } from '../lib/tree.js'
import { useFullPhoto } from '../lib/useTeamMap.js'

const s = strings.drawer
const safeLink = (url) => /^https?:\/\//i.test(url)

function Section({ label, children }) {
  return (
    <div className="tm-sec">
      <span className="mono tm-sec-label">{label}</span>
      {children}
    </div>
  )
}

// Ответ на дополнительное поле анкеты (PersonPub.extra) по типу поля
function ExtraValue({ item }) {
  if (item.kind === 'chips') {
    return (
      <div className="tm-hobbies">
        {item.value.map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>
    )
  }
  if (item.kind === 'links') {
    const links = item.value.filter((l) => safeLink(l.url))
    return (
      <div className="tm-contacts">
        {links.map((l) => (
          <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">
            {l.label || l.url}
          </a>
        ))}
      </div>
    )
  }
  return <p className="tm-text">{String(item.value)}</p>
}

export default function ProfileDrawer({ person, by, limited, away, onSelect, onClose, onEditOwn }) {
  const fullPhoto = useFullPhoto(person.id, !limited && Boolean(person.thumb))
  const chain = chainOf(by, person.id)
  const facts = [
    [s.facts.team, person.team],
    [s.facts.location, person.location],
    [s.facts.workFormat, person.workFormat],
  ].filter(([, v]) => v)
  const hobbies = person.hobbies ?? []
  const socials = (person.socials ?? []).filter((l) => safeLink(l.url))
  const extra = limited ? [] : (person.extra ?? []).filter((e) => (e.kind !== 'links' || e.value.some((l) => safeLink(l.url))))
  const hasContacts = Boolean(person.telegram || person.email)
  const incomplete =
    !limited && facts.length === 0 && !person.responsibility && !person.askMeAbout && hobbies.length === 0 && !hasContacts && socials.length === 0 && extra.length === 0

  return (
    <aside className="tm-drawer" aria-label={person.name}>
      <div className="tm-drawer-head">
        <span className="mono tm-drawer-eyebrow">{s.profile(person.dir?.shortName ?? strings.header.all)}</span>
        <button type="button" className="tm-close" onClick={onClose} aria-label={s.close}>
          ×
        </button>
      </div>
      <div className="tm-drawer-body">
        <div className="tm-drawer-person">
          <Avatar person={person} size={72} font={22} src={fullPhoto ?? undefined} />
          <div className="tm-drawer-name">
            <span className="tm-drawer-title">{person.name}</span>
            <span className="tm-drawer-sub">{person.title}</span>
            <AwayTag away={away} />
          </div>
        </div>

        {facts.length > 0 && (
          <div className="tm-facts">
            {facts.map(([k, v]) => (
              <div className="tm-fact" key={k}>
                <span className="mono tm-fact-k">{k}</span>
                <span>{v}</span>
              </div>
            ))}
          </div>
        )}

        {chain.length > 1 && (
          <Section label={s.chain}>
            <div className="tm-chain">
              {chain.map((id, i) => {
                const c = by[id]
                const self = id === person.id
                return (
                  <div key={id}>
                    {i > 0 && <div className="tm-chain-line" />}
                    <div
                      className={`tm-chain-item${self ? ' self' : ''}`}
                      role={self ? undefined : 'button'}
                      tabIndex={self ? undefined : 0}
                      onClick={self ? undefined : () => onSelect(id)}
                      onKeyDown={self ? undefined : (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(id))}
                    >
                      <span className="tm-chain-av">
                        <Avatar person={c} size={24} font={9} />
                      </span>
                      <span className="tm-chain-name">{c.name}</span>
                      <span className="tm-chain-title">{c.title}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </Section>
        )}

        {person.responsibility && (
          <Section label={s.responsibility}>
            <p className="tm-text">{person.responsibility}</p>
          </Section>
        )}
        {person.askMeAbout && (
          <Section label={s.askMeAbout}>
            <p className="tm-text">{person.askMeAbout}</p>
          </Section>
        )}
        {hobbies.length > 0 && (
          <Section label={s.hobbies}>
            <div className="tm-hobbies">
              {hobbies.map((h) => (
                <span key={h}>{h}</span>
              ))}
            </div>
          </Section>
        )}
        {(hasContacts || socials.length > 0) && (
          <Section label={s.contacts}>
            <div className="tm-contacts">
              {person.telegram && (
                <a href={`https://t.me/${encodeURIComponent(person.telegram)}`} target="_blank" rel="noopener noreferrer">
                  <span className="mono tm-contact-k">{s.telegram}</span>@{person.telegram}
                </a>
              )}
              {person.email && (
                <a href={`mailto:${person.email}`}>
                  <span className="mono tm-contact-k">{s.email}</span>
                  {person.email}
                </a>
              )}
              {socials.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">
                  <span className="mono tm-contact-k">{s.socials}</span>
                  {l.label || l.url}
                </a>
              ))}
            </div>
          </Section>
        )}
        {extra.map((e) => (
          <Section key={e.key} label={e.label}>
            <ExtraValue item={e} />
          </Section>
        ))}
        {onEditOwn && (
          <div>
            <button type="button" className="tm-btn tm-btn-primary" onClick={onEditOwn}>
              {incomplete ? s.fillOwn : s.editOwn}
            </button>
          </div>
        )}
        {incomplete && <p className="tm-incomplete">{s.incomplete}</p>}
        {limited && <p className="tm-incomplete">{s.limited}</p>}

        {person.kids.length > 0 && (
          <div className="tm-sec">
            <div className="tm-sec-split">
              <span className="mono tm-sec-label">{s.reports}</span>
              <span className="mono tm-reports-count">{s.reportsLabel(person.kids.length, person.total)}</span>
            </div>
            <div className="tm-reports">
              {person.kids.map((id) => {
                const r = by[id]
                return (
                  <div
                    key={id}
                    className="tm-report"
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect(id)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(id))}
                  >
                    <Avatar person={r} size={28} font={10.5} />
                    <div className="tm-report-text">
                      <span className="tm-report-name">{r.name}</span>
                      <span className="tm-report-title">{r.title}</span>
                    </div>
                    {r.total > 0 && <span className="mono tm-report-sub">+{r.total}</span>}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
