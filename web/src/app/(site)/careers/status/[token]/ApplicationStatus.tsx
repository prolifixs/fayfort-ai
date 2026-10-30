'use client'

import { useEffect, useState } from 'react'
import { PUBLIC_API } from '../../careers'

type Step = { key: string; label: string; state: 'done' | 'current' | 'todo' }
type Status = {
  first_name: string; job_title: string; applied_at: string; stage: string; stage_label: string; closed: boolean
  steps: Step[]; next: string; kept_until: string | null
}

const day = (value: string | null) =>
  value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''

/** The candidate's private page: where the application is, what happens next, withdraw or delete. */
export default function ApplicationStatus({ token }: { token: string }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'deleted'>('loading')
  const [confirm, setConfirm] = useState<'' | 'withdraw' | 'delete'>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${PUBLIC_API}/public/careers/status/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error()
        setStatus(((await response.json()) as { application: Status }).application)
        setState('ready')
      })
      .catch(() => setState('missing'))
  }, [token])

  async function act(kind: 'withdraw' | 'delete') {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${PUBLIC_API}/public/careers/status/${encodeURIComponent(token)}/${kind}`, { method: 'POST' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'That didn’t work. Please try again.')
      if (kind === 'delete') setState('deleted')
      else setStatus(body.application)
      setConfirm('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That didn’t work. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="status-page">
      <div className="status-head shell">
        <p className="overline"><span /> FayFort careers</p>
        <h1>{state === 'ready' && status ? `Hi ${status.first_name}, here’s where you are` : 'Your application'}</h1>
      </div>
      <div className="status-body shell" aria-live="polite">
        {state === 'loading' && <p className="status-card">Loading your application…</p>}
        {state === 'missing' && (
          <section className="status-card">
            <h2>We can’t find this application</h2>
            <p>The link may be mistyped, or the details were deleted. If you think this is wrong, email support@fayfort.com.</p>
            <a className="apply-button" href="/careers">See open roles</a>
          </section>
        )}
        {state === 'deleted' && (
          <section className="status-card">
            <h2>Your details are deleted</h2>
            <p>We’ve removed your details and CV. Thank you for your interest in FayFort.</p>
          </section>
        )}
        {state === 'ready' && status && (
          <>
            <section className="status-card">
              <div className="status-title"><strong>{status.job_title}</strong><span>Applied {day(status.applied_at)}</span></div>
              {status.closed ? (
                <p className="status-closed">{status.stage_label}</p>
              ) : (
                <ol className="status-steps" aria-label="Application progress">
                  {status.steps.map((step) => (
                    <li key={step.key} className={`is-${step.state}`} aria-current={step.state === 'current' ? 'step' : undefined}>
                      <span aria-hidden="true">{step.state === 'done' ? '✓' : ''}</span>{step.label}
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <section className="status-card">
              <h2>What happens next</h2>
              <p>{status.next}</p>
              {status.kept_until && <p className="status-small">We keep your details until {day(status.kept_until)}, then delete them.</p>}
            </section>
            <div className="status-actions">
              {!status.closed && status.stage !== 'hired' && <button type="button" onClick={() => setConfirm('withdraw')}>Withdraw my application</button>}
              <button type="button" onClick={() => setConfirm('delete')}>Delete my details</button>
            </div>
            {confirm && (
              <section className="status-card status-confirm" role="alertdialog" aria-labelledby="confirm-title">
                <h2 id="confirm-title">{confirm === 'withdraw' ? 'Withdraw this application?' : 'Delete your details?'}</h2>
                <p>{confirm === 'withdraw'
                  ? 'We’ll stop considering you for this role. You can apply again for other roles.'
                  : 'This deletes your name, contact details, answers and CV from FayFort, for every role you applied to. It can’t be undone.'}</p>
                {error && <p className="apply-error" role="alert">{error}</p>}
                <div className="apply-actions">
                  <button type="button" className="apply-back" onClick={() => setConfirm('')}>Keep it</button>
                  <button type="button" className="apply-button" disabled={busy} onClick={() => void act(confirm)}>
                    {busy ? 'Working…' : confirm === 'withdraw' ? 'Withdraw' : 'Delete my details'}
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
