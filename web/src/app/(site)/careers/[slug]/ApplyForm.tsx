'use client'

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'
import { cvProblem, cvType, PUBLIC_API, type Job } from '../careers'

const TURNSTILE_SITE_KEY = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '0x4AAAAAAFXDNL6ChJqA7UCK').trim()
const HEARD = ['Instagram', 'TikTok', 'A friend or colleague', 'FayFort website', 'Job board', 'Other']

type TurnstileApi = { render: (el: HTMLElement, options: Record<string, unknown>) => string; reset: (id?: string) => void }
declare global { interface Window { turnstile?: TurnstileApi } }

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '')
    reader.onerror = () => reject(new Error('Your CV could not be read. Choose it again.'))
    reader.readAsDataURL(file)
  })
}

/** The robot check, shown only on fayfort.com where the Turnstile key works. */
function RobotCheck({ onToken }: { onToken: (token: string) => void }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = window.location.hostname
    if (!TURNSTILE_SITE_KEY || !(host === 'fayfort.com' || host.endsWith('.fayfort.com'))) return
    let widget = ''
    const render = () => {
      if (box.current && window.turnstile && !widget) {
        widget = window.turnstile.render(box.current, { sitekey: TURNSTILE_SITE_KEY, callback: onToken, 'expired-callback': () => onToken('') })
      }
    }
    if (window.turnstile) render()
    else {
      const script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.onload = render
      document.head.appendChild(script)
    }
  }, [onToken])
  return <div ref={box} className="apply-robot" />
}

export default function ApplyForm({ job }: { job: Job }) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [fields, setFields] = useState({ full_name: '', email: '', phone: '', location: '', languages: '', portfolio_url: '', heard_from: '', website: '' })
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [keep, setKeep] = useState(false)
  const [cv, setCv] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [captcha, setCaptcha] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [statusToken, setStatusToken] = useState('')
  const top = useRef<HTMLFormElement>(null)

  const set = (key: keyof typeof fields) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFields((current) => ({ ...current, [key]: event.target.value }))

  function choose(file: File | null) {
    const problem = cvProblem(file)
    setError(file && problem ? problem : '')
    setCv(file && !problem ? file : null)
  }

  function next(event: FormEvent) {
    event.preventDefault()
    const problem = cvProblem(cv)
    if (problem) return setError(problem)
    setError('')
    setStep(2)
    top.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }

  async function send(event: FormEvent) {
    event.preventDefault()
    if (!cv) return setStep(1)
    if (!keep) return setError('Please agree to us keeping your details so we can consider you.')
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${PUBLIC_API}/public/careers/jobs/${job.slug}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.trim() || null])),
          full_name: fields.full_name.trim(), email: fields.email.trim(), keep_details: keep,
          answers: job.questions.map((q) => ({ id: q.id, answer: answers[q.id] ?? null })),
          cv_name: cv.name, cv_type: cvType(cv), cv_base64: await readBase64(cv), captcha_token: captcha || null,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Your application couldn’t be sent. Please try again.')
      setStatusToken(body.status_token || '')
      setStep(3)
      top.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Your application couldn’t be sent. Please try again.')
      window.turnstile?.reset()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form ref={top} className="apply-card" onSubmit={step === 1 ? next : send} noValidate={false} aria-labelledby="apply-title">
      <div className="apply-head">
        <h2 id="apply-title">{step === 3 ? 'Application sent' : 'Apply'}</h2>
        <div className="apply-progress" role="img" aria-label={`Step ${step} of 3`}>
          {[1, 2, 3].map((n) => <span key={n} className={n <= step ? 'is-done' : ''} />)}
        </div>
        <p className="apply-steps"><span className={step === 1 ? 'is-current' : ''}>Your details</span> · <span className={step === 2 ? 'is-current' : ''}>Questions</span> · <span className={step === 3 ? 'is-current' : ''}>Done</span></p>
      </div>

      {step === 1 && (
        <>
          <div className="apply-grid">
            <label>Full name<input required autoComplete="name" value={fields.full_name} onChange={set('full_name')} maxLength={120} /></label>
            <label>Email<input required type="email" autoComplete="email" value={fields.email} onChange={set('email')} maxLength={320} /></label>
            <label>Phone or WhatsApp<input type="tel" autoComplete="tel" value={fields.phone} onChange={set('phone')} maxLength={40} /></label>
            <label>Country and city<input autoComplete="address-level2" value={fields.location} onChange={set('location')} maxLength={120} /></label>
          </div>
          <label>Languages<input placeholder="English, Mandarin…" value={fields.languages} onChange={set('languages')} maxLength={200} /></label>
          <label
            className={`apply-drop${dragging ? ' is-dragging' : ''}${cv ? ' has-file' : ''}`}
            onDragOver={(event: DragEvent) => { event.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event: DragEvent) => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files?.[0] || null) }}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 16v4h16v-4" /></svg>
            <span>{cv ? cv.name : 'Drop your CV here or choose a file'}</span>
            <small>{cv ? 'Tap to choose a different file' : 'PDF or Word, up to 5 MB'}</small>
            <input type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) => choose(event.target.files?.[0] || null)} />
          </label>
          <label>Portfolio or LinkedIn (optional)<input type="url" inputMode="url" placeholder="https://" value={fields.portfolio_url} onChange={set('portfolio_url')} maxLength={300} /></label>
          {error && <p className="apply-error" role="alert">{error}</p>}
          <button className="apply-button" type="submit">Next: questions</button>
        </>
      )}

      {step === 2 && (
        <>
          {job.questions.map((question) => (
            <fieldset key={question.id} className="apply-question">
              <legend>{question.label}{!question.required && <small> (optional)</small>}</legend>
              {question.kind === 'short' && (
                <textarea rows={3} maxLength={1000} required={question.required} value={answers[question.id] || ''}
                  onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} />
              )}
              {question.kind !== 'short' && (
                <div className="apply-choices">
                  {(question.kind === 'yes_no' ? ['Yes', 'No'] : question.options).map((option) => (
                    <label key={option} className={answers[question.id] === option ? 'is-chosen' : ''}>
                      <input type="radio" name={question.id} value={option} required={question.required} checked={answers[question.id] === option}
                        onChange={() => setAnswers((current) => ({ ...current, [question.id]: option }))} />
                      {option}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          ))}
          <label>How did you hear about FayFort?
            <select value={fields.heard_from} onChange={set('heard_from')}>
              <option value="">Choose one</option>
              {HEARD.map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
          <label className="apply-hidden" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={fields.website} onChange={set('website')} /></label>
          <label className="apply-consent">
            <input type="checkbox" checked={keep} onChange={(event) => setKeep(event.target.checked)} required />
            <span>FayFort may keep my details for 12 months to consider me for this and future roles. After that they are deleted. I can delete them sooner from the link in my email.</span>
          </label>
          <RobotCheck onToken={setCaptcha} />
          {error && <p className="apply-error" role="alert">{error}</p>}
          <div className="apply-actions">
            <button type="button" className="apply-back" onClick={() => setStep(1)}>Back</button>
            <button className="apply-button" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send application'}</button>
          </div>
        </>
      )}

      {step === 3 && (
        <div className="apply-done" role="status">
          <p>Thanks, {fields.full_name.trim().split(' ')[0]}. We&apos;ve got your application for <strong>{job.title}</strong> and emailed you a private link to follow it.</p>
          <p>Our HR team reads every application within 7 days.</p>
          {statusToken && <a className="apply-button" href={`/careers/status/${statusToken}`}>See my application</a>}
        </div>
      )}
    </form>
  )
}
