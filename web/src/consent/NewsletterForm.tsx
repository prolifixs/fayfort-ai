'use client'

import { useState, type FormEvent } from 'react'
import { trackMarketing } from './MarketingPixels'

export const API_URL = (process.env.NEXT_PUBLIC_FAYFORT_API_URL || 'https://api.fayfort.com').replace(/\/$/, '')
export type NewsletterSource = 'site_footer' | 'site_popup' | 'go' | 'newsletter_page'

/** Email sign-up for the FayFort newsletter (visitors). The address is confirmed by email before anything is sent. */
export default function NewsletterForm({ source, className, onDone }: { source: NewsletterSource; className?: string; onDone?: () => void }) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    setState('busy')
    setMessage('')
    try {
      const response = await fetch(`${API_URL}/public/newsletter/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'We couldn’t sign you up just now.')
      setState('done')
      setMessage('Almost there: check your inbox and tap the link to confirm.')
      trackMarketing('Lead')
      onDone?.()
    } catch (reason) {
      setState('error')
      setMessage(reason instanceof Error ? reason.message : 'We couldn’t sign you up just now.')
    }
  }
  if (state === 'done') {
    return (
      <p className={`ffn-done ${className || ''}`} role="status">
        {message}
      </p>
    )
  }
  return (
    <form className={`ffn-form ${className || ''}`} onSubmit={(event) => void submit(event)}>
      <label className="ffn-label" htmlFor={`ffn-email-${source}`}>
        Email address
      </label>
      <div className="ffn-row">
        <input
          id={`ffn-email-${source}`}
          type="email"
          required
          maxLength={320}
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button type="submit" disabled={state === 'busy'}>
          {state === 'busy' ? 'Signing up…' : 'Subscribe'}
        </button>
      </div>
      {state === 'error' && (
        <p className="ffn-error" role="alert">
          {message}
        </p>
      )}
      <p className="ffn-fine">Weekly finds and early access to giveaways. Unsubscribe any time.</p>
    </form>
  )
}
