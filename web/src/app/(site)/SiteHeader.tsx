'use client'

import { useEffect, useState } from 'react'
import { FayfortLogo } from '@/app/components/brand/FayfortLogo'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { JOIN_URL, MEMBER_HOME_URL, SIGN_IN_URL } from '@/config/contact'

const LINKS: [string, string][] = [
  ['/how-it-works', 'How it works'],
  ['/services', 'Services'],
  ['/go/shop', 'Shop'],
  ['/go/finds', 'Finds'],
  ['/ebook/landed', 'LANDED'],
  ['/about-us', 'About'],
]

// Extra destinations in the phone menu (the same ones as fayfort.com/go).
const MENU_EXTRA: [string, string][] = [
  ['/go/request', 'Find me a product'],
  ['/go/consultation', 'Book a consultation'],
  ['/go/tour-guide', 'Tour guide in China'],
]

export function BrandLockup({ className }: { className: string }) {
  return (
    <Link className={className} href="/" aria-label="FAYFORT home">
      <span className="brand-logo"><FayfortLogo /></span>
      <span><strong>FAYFORT</strong><small>International Trading</small></span>
    </Link>
  )
}

/** Sticky header: links, then Sign in and Join free for visitors or My dashboard for members; on phones a menu sheet. */
export default function SiteHeader() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open])
  return (
    <header className={open ? 'site-header is-open' : 'site-header'}>
      <div className="shell header-inner">
        <BrandLockup className="brand" />
        <nav className="site-nav" aria-label="Main navigation">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}>{label}</Link>
          ))}
        </nav>
        <div className="header-actions">
          <a className="header-signin visitor-only" href={SIGN_IN_URL}>Sign in</a>
          <a className="button button-blue header-join visitor-only" href={JOIN_URL}>Join free</a>
          <a className="button button-blue header-join member-only" href={MEMBER_HOME_URL}>My dashboard</a>
          <button
            type="button"
            className="menu-button"
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>
      <div id="site-menu" className="menu-sheet" hidden={!open}>
        <nav aria-label="Menu">
          {[...LINKS, ...MENU_EXTRA].map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
          <Link href="/#contact">Contact</Link>
        </nav>
        <div className="menu-sheet-actions">
          <a className="button button-blue visitor-only" href={JOIN_URL}>Join free</a>
          <a className="button button-ghost visitor-only" href={SIGN_IN_URL}>Sign in</a>
          <a className="button button-blue member-only" href={MEMBER_HOME_URL}>My dashboard</a>
        </div>
      </div>
    </header>
  )
}
