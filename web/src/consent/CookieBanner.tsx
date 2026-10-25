'use client'

import { useEffect, useState } from 'react'
import { CONSENT_EVENT, OPEN_SETTINGS_EVENT, openCookieSettings, readConsent, saveConsent } from './consent'
import './consent.css'

/** The cookie banner on every fayfort.com page. Nothing beyond necessary cookies loads until the visitor agrees. */
export default function CookieBanner() {
  const [open, setOpen] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [marketing, setMarketing] = useState(false)
  useEffect(() => {
    const current = readConsent()
    if (!current) setOpen(true)
    const reopen = () => {
      setMarketing(readConsent()?.marketing ?? false)
      setChoosing(true)
      setOpen(true)
    }
    window.addEventListener(OPEN_SETTINGS_EVENT, reopen)
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, reopen)
  }, [])
  if (!open) return null
  const choose = (value: boolean) => {
    saveConsent(value)
    setOpen(false)
    setChoosing(false)
  }
  return (
    <section className="ffc-banner" aria-labelledby="ffc-title">
      <h2 id="ffc-title">{choosing ? 'Cookie settings' : 'Cookies on FayFort'}</h2>
      {!choosing ? (
        <p>
          We use necessary cookies to keep the site working. With your OK we also use Meta and TikTok cookies to see which of our
          ads bring people here. <a href="/cookies">Cookie policy</a>
        </p>
      ) : (
        <ul className="ffc-options">
          <li>
            <span>
              <strong>Necessary</strong>
              <small>Signing in, your cart and remembering this choice. Always on.</small>
            </span>
            <span className="ffc-always">On</span>
          </li>
          <li>
            <label htmlFor="ffc-marketing">
              <strong>Marketing</strong>
              <small>Meta (Instagram, Facebook) and TikTok pixels: which ads bring visitors, and showing our ads to people who visited.</small>
            </label>
            <input
              id="ffc-marketing"
              type="checkbox"
              role="switch"
              checked={marketing}
              onChange={(event) => setMarketing(event.target.checked)}
            />
          </li>
        </ul>
      )}
      <div className="ffc-actions">
        {choosing ? (
          <>
            <button type="button" className="ffc-primary" onClick={() => choose(marketing)}>
              Save choices
            </button>
            <button type="button" onClick={() => choose(true)}>
              Accept all
            </button>
          </>
        ) : (
          <>
            <button type="button" className="ffc-primary" onClick={() => choose(true)}>
              Accept all
            </button>
            <button type="button" onClick={() => choose(false)}>
              Necessary only
            </button>
            <button type="button" className="ffc-link" onClick={() => setChoosing(true)}>
              Choose
            </button>
          </>
        )}
      </div>
    </section>
  )
}

/** "Cookie settings" link for footers. */
export function CookieSettingsLink({ className }: { className?: string }) {
  return (
    <button type="button" className={`ffc-settings-link ${className || ''}`} onClick={openCookieSettings}>
      Cookie settings
    </button>
  )
}

export { CONSENT_EVENT }
