'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { JOIN_URL } from '@/config/contact'
import { priceLine, type GoPick } from '../app/go/data'
import { CONSENT_EVENT, POPUP_COOKIE, VISITS_COOKIE, isMember, readConsent, readCookie, writeCookie } from './consent'
import NewsletterForm, { API_URL } from './NewsletterForm'

// Popups for visitors who aren't members (owner request, 2026-10-25): product cards, or the newsletter.
// At most one per visit; closing one keeps them away for 7 days; never for members, never before the cookie banner
// is answered, never on LANDED, the terms, the cookie policy or the newsletter page.
const QUIET_PATHS = ['/ebook/landed', '/terms', '/terms-ebooks', '/cookies', '/newsletter']
const PRODUCT_DELAY_MS = 25000
const SESSION_KEY = 'ff_popup_session'
const IMAGE_HOSTS = ['https://lirauxdhnknfiqjnulxb.supabase.co/', 'https://cdn.shopify.com/']

type Kind = 'products' | 'newsletter'

function sessionFlag(key: string, set = false): boolean {
  try {
    if (set) window.sessionStorage.setItem(key, '1')
    return window.sessionStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

/** Counts this browser session once and returns the number of visits so far. */
function countVisit(): number {
  const visits = Number(readCookie(VISITS_COOKIE) || '0') || 0
  if (sessionFlag('ff_visit_counted')) return visits
  sessionFlag('ff_visit_counted', true)
  writeCookie(VISITS_COOKIE, String(visits + 1), 365)
  return visits + 1
}

export default function VisitorPopups() {
  const pathname = usePathname() || '/'
  const [ready, setReady] = useState(false)
  const [kind, setKind] = useState<Kind | null>(null)
  const [picks, setPicks] = useState<GoPick[]>([])
  const shown = useRef(false)
  const quiet = QUIET_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))

  useEffect(() => {
    const check = () => setReady(Boolean(readConsent()) && !isMember() && !readCookie(POPUP_COOKIE) && !sessionFlag(SESSION_KEY))
    check()
    window.addEventListener(CONSENT_EVENT, check)
    return () => window.removeEventListener(CONSENT_EVENT, check)
  }, [])

  const show = useCallback((next: Kind) => {
    if (shown.current) return
    shown.current = true
    sessionFlag(SESSION_KEY, true)
    setKind(next)
  }, [])

  useEffect(() => {
    if (!ready || quiet) return
    const visits = countVisit()
    // Second visit onwards: the newsletter. First visit: product cards (not on the shop page itself).
    const wantsProducts = visits < 2 && pathname !== '/go/shop'
    let timer: number | undefined
    const cleanups: (() => void)[] = []
    if (wantsProducts) {
      fetch(`${API_URL}/public/site/go`)
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { picks?: GoPick[] } | null) => {
          const found = (body?.picks || []).filter((p) => p?.name && IMAGE_HOSTS.some((host) => p.image_url?.startsWith(host))).slice(0, 4)
          setPicks(found)
        })
        .catch(() => setPicks([]))
      timer = window.setTimeout(() => show('products'), PRODUCT_DELAY_MS)
      const onScroll = () => {
        const height = document.documentElement.scrollHeight - window.innerHeight
        if (height > 0 && window.scrollY / height >= 0.5) show('products')
      }
      window.addEventListener('scroll', onScroll, { passive: true })
      cleanups.push(() => window.removeEventListener('scroll', onScroll))
    } else {
      timer = window.setTimeout(() => show('newsletter'), 12000)
    }
    // Leaving the page on a computer (pointer out through the top): the newsletter.
    const onLeave = (event: MouseEvent) => {
      if (event.clientY <= 0 && !event.relatedTarget) show('newsletter')
    }
    document.addEventListener('mouseout', onLeave)
    cleanups.push(() => document.removeEventListener('mouseout', onLeave))
    return () => {
      window.clearTimeout(timer)
      cleanups.forEach((fn) => fn())
    }
  }, [ready, quiet, pathname, show])

  const close = useCallback(() => {
    writeCookie(POPUP_COOKIE, '1', 7)
    setKind(null)
  }, [])

  useEffect(() => {
    if (!kind) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [kind, close])

  if (!kind || quiet) return null
  // No product photos to show (API down, empty catalog): offer the newsletter instead.
  const view: Kind = kind === 'products' && picks.length < 2 ? 'newsletter' : kind
  return (
    <aside className="ffp-card" role="dialog" aria-modal="false" aria-labelledby="ffp-title">
      <button type="button" className="ffp-close" aria-label="Close" onClick={close}>
        ×
      </button>
      {view === 'products' ? (
        <>
          <p className="ffp-kicker">Sourced in China</p>
          <h2 id="ffp-title">New this week at FayFort</h2>
          <ul className="ffp-picks">
            {picks.map((pick) => (
              <li key={pick.image_url}>
                <a href="/go/shop" onClick={close}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pick.image_url} alt="" loading="lazy" />
                  <span>{pick.name}</span>
                  <b>{priceLine(pick)}</b>
                </a>
              </li>
            ))}
          </ul>
          <div className="ffp-actions">
            <a className="ffp-primary" href="/go/shop" onClick={close}>
              Shop all products
            </a>
            <a className="ffp-secondary" href={JOIN_URL} onClick={close}>
              Join free
            </a>
          </div>
        </>
      ) : (
        <>
          <p className="ffp-kicker">FayFort newsletter</p>
          <h2 id="ffp-title">New finds from China, every week</h2>
          <p className="ffp-lede">The best products we source, straight to your inbox, plus early access to our giveaways.</p>
          <NewsletterForm source="site_popup" className="is-popup" onDone={() => writeCookie(POPUP_COOKIE, '1', 30)} />
        </>
      )}
    </aside>
  )
}
