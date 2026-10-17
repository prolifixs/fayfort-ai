'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { JOIN_URL, SIGN_IN_URL } from '@/config/contact'

const LINKS: [string, string][] = [
  ['/how-it-works', 'How it works'],
  ['/services', 'Services'],
  ['/ebook/landed', 'LANDED'],
  ['/about-us', 'About'],
]

export function BrandLockup({ className }: { className: string }) {
  return (
    <Link className={className} href="/" aria-label="FAYFORT home">
      <span className="brand-logo"><Image src="/images/brand/fayfort-logo.png" alt="" width={229} height={240} priority /></span>
      <span><strong>FAYFORT</strong><small>International Trading</small></span>
    </Link>
  )
}

/** Sticky header: links, Sign in and Join free; on phones a menu sheet. */
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
          <a className="header-signin" href={SIGN_IN_URL}>Sign in</a>
          <a className="button button-blue header-join" href={JOIN_URL}>Join free</a>
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
          {LINKS.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
          <Link href="/#contact">Contact</Link>
        </nav>
        <div className="menu-sheet-actions">
          <a className="button button-blue" href={JOIN_URL}>Join free</a>
          <a className="button button-ghost" href={SIGN_IN_URL}>Sign in</a>
        </div>
      </div>
    </header>
  )
}
