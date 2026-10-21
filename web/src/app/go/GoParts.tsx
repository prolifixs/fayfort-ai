import Link from 'next/link'
import { FAYFORT_INSTAGRAM, WHATSAPP_DISPLAY, WHATSAPP_URL } from '@/config/contact'
import { FayfortLogo } from '../components/brand/FayfortLogo'

/** The route strip: Guangzhou's airport code, a dashed flight path with a plane, and "you". Drawn in once on load. */
export function RouteStrip({ to = 'You', toNote = 'Delivered' }: { to?: string; toNote?: string }) {
  return (
    <div className="go-route" aria-label={`From Guangzhou to ${to.toLowerCase()}`}>
      <span className="go-route-end">
        <b>CAN</b>
        <small>Guangzhou</small>
      </span>
      <svg className="go-route-line" viewBox="0 0 220 40" preserveAspectRatio="none" aria-hidden="true">
        <path className="go-route-path" d="M4 30 C 70 2, 150 2, 216 30" />
        <g className="go-route-plane">
          <path d="M-7 1.5 L7 0 L-7 -1.5 L-4.5 0 Z M-1 0 L-5 -6 L-2.5 -6 L3 0 L-2.5 6 L-5 6 Z" />
        </g>
      </svg>
      <span className="go-route-end is-you">
        <b>{to}</b>
        <small>{toNote}</small>
      </span>
    </div>
  )
}

/** A ticket: perforated stub on the right with one fact (a price, a countdown, a count). The whole ticket is the link. */
export function Ticket({
  href,
  title,
  line,
  stub,
  stubLabel,
  tone = 'paper',
  icon,
  children,
  external = false,
}: {
  href: string
  title: string
  line: string
  stub?: React.ReactNode
  stubLabel?: string
  tone?: 'paper' | 'pink'
  icon: React.ReactNode
  children?: React.ReactNode
  external?: boolean
}) {
  const body = (
    <>
      <span className="go-ticket-main">
        <span className="go-ticket-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="go-ticket-copy">
          <strong>{title}</strong>
          <span>{line}</span>
          {children}
        </span>
      </span>
      {stub !== undefined && (
        <span className="go-ticket-stub">
          {stubLabel && <small>{stubLabel}</small>}
          <b>{stub}</b>
        </span>
      )}
    </>
  )
  const className = `go-ticket is-${tone}${stub !== undefined ? ' has-stub' : ''}`
  return external ? (
    <a className={className} href={href}>
      {body}
    </a>
  ) : (
    <Link className={className} href={href}>
      {body}
    </Link>
  )
}

export function GoHeader({ back = false }: { back?: boolean }) {
  return (
    <header className="go-top">
      <Link href={back ? '/go' : '/'} className="go-brand" aria-label={back ? 'Back to all FayFort links' : 'FAYFORT website'}>
        <span className="go-logo">
          <FayfortLogo variant="on-dark" />
        </span>
        <span>{back ? 'All links' : 'FAYFORT'}</span>
      </Link>
      <a className="go-top-site" href="/">
        fayfort.com
      </a>
    </header>
  )
}

export function GoFooter() {
  return (
    <footer className="go-foot">
      <a href={WHATSAPP_URL} target="_blank" rel="noreferrer">
        WhatsApp {WHATSAPP_DISPLAY}
      </a>
      <a href={`https://instagram.com/${FAYFORT_INSTAGRAM}`} target="_blank" rel="noreferrer">
        Instagram @{FAYFORT_INSTAGRAM}
      </a>
      <p>FAYFORT International Trading, Guangzhou</p>
    </footer>
  )
}

/** Detail pages: the page heading on a short ticket, with the big action below. */
export function GoPageHead({ kicker, title, lede }: { kicker: string; title: string; lede: string }) {
  return (
    <section className="go-head">
      <p className="go-kicker">{kicker}</p>
      <h1>{title}</h1>
      <p className="go-lede">{lede}</p>
    </section>
  )
}

export const ICONS = {
  gift: (
    <svg viewBox="0 0 24 24">
      <path d="M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-1.5-3-5-3.5-5-1.2C7 7 9.5 7 12 7zM12 7c1.5-3 5-3.5 5-1.2C17 7 14.5 7 12 7z" />
    </svg>
  ),
  bag: (
    <svg viewBox="0 0 24 24">
      <path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24">
      <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" />
    </svg>
  ),
  video: (
    <svg viewBox="0 0 24 24">
      <path d="M3 7h12v10H3zM15 11l6-4v10l-6-4" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 24 24">
      <path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
    </svg>
  ),
}
