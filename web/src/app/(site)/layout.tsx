import Link from 'next/link'
import { CHAT_URL, FAYFORT_INSTAGRAM, JOIN_URL, SIGN_IN_URL, SUPPORT_EMAIL } from '@/config/contact'
import RevealOnScroll, { REVEAL_BOOT_SCRIPT } from './RevealOnScroll'
import SiteHeader, { BrandLockup } from './SiteHeader'
import SiteChat from './chat/SiteChat'
import './site.css'

// Shared header and footer for the public site pages: /, /how-it-works, /services, /about-us, /terms and /terms-ebooks.
// LANDED (/ebook/landed) has its own layout and is deliberately not touched (owner decision 5).
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="site">
      <script dangerouslySetInnerHTML={{ __html: REVEAL_BOOT_SCRIPT }} />
      <RevealOnScroll />
      <a className="skip-link" href="#content">Skip to content</a>
      <SiteHeader />

      <main id="content">{children}</main>

      <footer className="site-footer"><div className="shell footer-main">
        <div><BrandLockup className="brand footer-brand" /><p>Sourcing, inspection and shipping from China,<br />tracked in your FayFort dashboard.<br />Publisher of LANDED, under The Hard Way Press.</p></div>
        <div><span>Explore</span><Link href="/how-it-works">How it works</Link><Link href="/services">Services</Link><Link href="/ebook/landed">LANDED</Link><Link href="/about-us">About</Link></div>
        <div><span>Account</span><a href={JOIN_URL}>Join free</a><a href={SIGN_IN_URL}>Sign in</a><a href={CHAT_URL}>Chat with us</a></div>
        <div><span>Contact</span><a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a><a href={`https://instagram.com/${FAYFORT_INSTAGRAM}`} target="_blank" rel="noreferrer">@{FAYFORT_INSTAGRAM}</a></div>
      </div><div className="shell footer-bottom"><p>© {new Date().getFullYear()} FAYFORT International Trading</p><p><Link href="/terms">Terms</Link> · <Link href="/terms-ebooks">Ebook &amp; Directory Terms</Link></p></div></footer>
      <SiteChat />
    </div>
  )
}
