import Image from 'next/image'
import Link from 'next/link'
import { FAYFORT_INSTAGRAM, SUPPORT_EMAIL } from '@/config/contact'
import RevealOnScroll, { REVEAL_BOOT_SCRIPT } from './RevealOnScroll'

// The FAYFORT mark sits beside the wordmark, so it is decorative (empty alt).
function BrandLockup({ className }: { className: string }) {
  return (
    <Link className={className} href="/" aria-label="FAYFORT home">
      <span className="brand-logo"><Image src="/images/brand/fayfort-logo.png" alt="" width={229} height={240} priority /></span>
      <span><strong>FAYFORT</strong><small>International Trading</small></span>
    </Link>
  )
}

// Shared header and footer for the public site pages: /, /services, /about-us, /terms and /terms-ebooks.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="site">
      <script dangerouslySetInnerHTML={{ __html: REVEAL_BOOT_SCRIPT }} />
      <RevealOnScroll />
      <a className="skip-link" href="#content">Skip to content</a>
      <header className="site-header"><div className="shell header-inner">
        <BrandLockup className="brand" />
        <nav className="site-nav" aria-label="Main navigation">
          <Link href="/services">Services</Link>
          <Link href="/about-us">About</Link>
          <Link href="/ebook/landed">LANDED</Link>
          <Link href="/#contact">Contact</Link>
        </nav>
      </div></header>

      <main id="content">{children}</main>

      <footer className="site-footer"><div className="shell footer-main">
        <div><BrandLockup className="brand footer-brand" /><p>Sourcing, inspection and shipping from China.<br />Publisher of LANDED, under The Hard Way Press.</p></div>
        <div><span>Explore</span><Link href="/services">Services</Link><Link href="/about-us">About</Link><Link href="/ebook/landed">LANDED</Link></div>
        <div><span>Contact</span><a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a><a href={`https://instagram.com/${FAYFORT_INSTAGRAM}`} target="_blank" rel="noreferrer">@{FAYFORT_INSTAGRAM}</a></div>
      </div><div className="shell footer-bottom"><p>© 2026 FAYFORT International Trading</p><p><Link href="/terms">Terms</Link> · <Link href="/terms-ebooks">Ebook &amp; Directory Terms</Link></p></div></footer>
    </div>
  )
}
