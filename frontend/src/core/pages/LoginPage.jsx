import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Alert } from 'antd'
import { api } from '../api/index.js'
import { DEMO_MODE } from '../config.js'
import { isValidEmail } from '../admin/validation.js'
import { useAuth } from '../auth/useAuth.js'
import strings from '../strings.js'
import ThemeToggle from '../layout/ThemeToggle.jsx'
import logoWhite from '../layout/logo-white.svg'
import mascot from '../layout/mascot.svg'

const s = strings.login
const YEAR = new Date().getFullYear()

export default function LoginPage() {
  const { me, expired, login, demoLogin } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState(null)
  const [fieldError, setFieldError] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [demoUsers, setDemoUsers] = useState([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  // После входа всегда открывается «Главная» (возврат на прежнюю страницу не используется)
  const target = '/'

  useEffect(() => {
    if (!DEMO_MODE) return
    api.get('/auth/demo-users').then(setDemoUsers).catch(() => setDemoUsers([]))
  }, [])

  if (me) return <Navigate to={target} replace />

  const run = async (action) => {
    setError(null)
    setSubmitting(true)
    try {
      await action()
      navigate(target, { replace: true })
    } catch (e) {
      setError(e.message)
      setSubmitting(false)
    }
  }

  const submit = (e) => {
    e.preventDefault()
    // TODO(Q-D): ограничение корпоративного домена не решено — проверяется только формат.
    const errs = {
      email: !email ? s.required : !isValidEmail(email) ? s.emailInvalid : null,
      password: !password ? s.required : null,
    }
    setFieldError(errs)
    if (errs.email || errs.password) return
    run(() => login(email, password))
  }

  return (
    <div className="login">
      <section className="login-hero" aria-label={strings.brand}>
        <div className="login-hero-top">
          <img className="login-hero-logo" src={logoWhite} alt="TRENDSETTER" />
          <span className="login-hero-sub">[ {strings.brandSub} ]</span>
        </div>
        <p className="login-hero-title">
          {s.heroLine1}
          <br />
          {s.heroLine2}
          <span className="hero-name">{s.heroMarker}</span>.
        </p>
        <span className="login-hero-sub">© {YEAR} TRENDSETTER</span>
        <img className="login-hero-mascot" src={mascot} alt="" aria-hidden="true" />
      </section>

      <main className="login-main">
        <div className="login-top">
          {DEMO_MODE ? <span className="demo-flag">{strings.layout.demoData}</span> : <span />}
          <ThemeToggle />
        </div>

        <form className="login-form" onSubmit={submit} noValidate>
          <div className="login-head">
            <span className="page-eyebrow">[ {s.eyebrow} ]</span>
            <h1 className="login-title">{s.title}</h1>
            <p className="login-lead">{s.lead}</p>
          </div>
          {expired && !error && <Alert type="warning" showIcon title={s.sessionExpired} />}
          {error && <Alert type="error" showIcon title={error} />}

          <div className="login-field">
            <label htmlFor="lg-email" className="login-label">
              {s.email}
            </label>
            <input
              id="lg-email"
              className="login-input"
              type="email"
              autoComplete="username"
              placeholder={s.emailPlaceholder}
              value={email}
              aria-invalid={Boolean(fieldError.email)}
              aria-describedby={fieldError.email ? 'lg-email-err' : undefined}
              onChange={(e) => setEmail(e.target.value)}
            />
            {fieldError.email && (
              <span id="lg-email-err" className="login-error">
                {fieldError.email}
              </span>
            )}
          </div>

          <div className="login-field">
            <span className="login-label-row">
              <label htmlFor="lg-pass" className="login-label">
                {s.password}
              </label>
              <span className="login-note">{s.resetNote}</span>
            </span>
            <span className="login-pass">
              <input
                id="lg-pass"
                className="login-input"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                aria-invalid={Boolean(fieldError.password)}
                aria-describedby={fieldError.password ? 'lg-pass-err' : undefined}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="login-show"
                aria-pressed={show}
                aria-label={show ? s.hidePassword : s.showPassword}
                onClick={() => setShow((v) => !v)}
              >
                {show ? s.hide : s.show}
              </button>
            </span>
            {fieldError.password && (
              <span id="lg-pass-err" className="login-error">
                {fieldError.password}
              </span>
            )}
          </div>

          <button type="submit" className="login-submit" disabled={submitting}>
            {s.submit}
          </button>

          {DEMO_MODE && demoUsers.length > 0 && (
            <div className="login-demo">
              <span className="login-label">{s.demoTitle}</span>
              <div className="login-demo-list">
                {demoUsers.map((u) => (
                  <button key={u.id} type="button" className="seg-btn" disabled={submitting} onClick={() => run(() => demoLogin(u.id))}>
                    {u.full_name}
                  </button>
                ))}
              </div>
              <span className="login-note">{s.demoHint}</span>
              <span className="login-note">{s.demoOnboardingHint}</span>
            </div>
          )}

          <p className="login-foot">{s.noAccess}</p>
        </form>
      </main>
    </div>
  )
}
