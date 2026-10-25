'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import NewsletterForm, { API_URL } from '../../../consent/NewsletterForm'
import { trackMarketing } from '../../../consent/MarketingPixels'

// fayfort.com/newsletter: confirms a sign-up (?confirm=…, posted by script so link scanners in mail apps don't confirm
// on someone's behalf), asks before unsubscribing (?unsubscribe=…), or shows the sign-up form.
export default function NewsletterStatus() {
  const params = useSearchParams()
  const confirmToken = params.get('confirm')
  const unsubscribeToken = params.get('unsubscribe')
  const [state, setState] = useState<'idle' | 'busy' | 'confirmed' | 'unsubscribed' | 'error'>(confirmToken ? 'busy' : 'idle')
  const [message, setMessage] = useState('')
  const started = useRef(false)

  async function post(path: string, token: string) {
    const response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'That didn’t work. Please try again.')
  }

  useEffect(() => {
    if (!confirmToken || started.current) return
    started.current = true
    post('/public/newsletter/confirm', confirmToken)
      .then(() => {
        setState('confirmed')
        trackMarketing('Subscribe')
      })
      .catch((reason: Error) => {
        setState('error')
        setMessage(reason.message)
      })
  }, [confirmToken])

  async function unsubscribe() {
    if (!unsubscribeToken) return
    setState('busy')
    try {
      await post('/public/newsletter/unsubscribe', unsubscribeToken)
      setState('unsubscribed')
    } catch (reason) {
      setState('error')
      setMessage(reason instanceof Error ? reason.message : 'That didn’t work.')
    }
  }

  return (
    <section className="newsletter-status" aria-live="polite">
      {state === 'busy' && confirmToken && <p>Confirming your email…</p>}
      {state === 'confirmed' && (
        <>
          <h2>You’re subscribed</h2>
          <p>Thanks for confirming. The next FayFort newsletter will land in your inbox.</p>
          <p><a className="text-button" href="/go/shop">See what’s new in the shop</a></p>
        </>
      )}
      {state === 'unsubscribed' && (
        <>
          <h2>You’re unsubscribed</h2>
          <p>You won’t get the FayFort newsletter any more. Changed your mind? Sign up again below.</p>
          <NewsletterForm source="newsletter_page" />
        </>
      )}
      {state === 'error' && (
        <>
          <h2>Something went wrong</h2>
          <p>{message}</p>
          <NewsletterForm source="newsletter_page" />
        </>
      )}
      {state === 'idle' && unsubscribeToken && (
        <>
          <h2>Unsubscribe from the newsletter?</h2>
          <p>You’ll stop getting the weekly FayFort newsletter. Emails about your orders and account aren’t affected.</p>
          <p><button type="button" className="button button-primary" onClick={() => void unsubscribe()}>Unsubscribe</button></p>
        </>
      )}
      {state === 'busy' && unsubscribeToken && <p>Unsubscribing…</p>}
      {state === 'idle' && !unsubscribeToken && <NewsletterForm source="newsletter_page" />}
    </section>
  )
}
