import type { Metadata } from 'next'
import Link from 'next/link'
import { SUPPORT_EMAIL } from '@/config/contact'
import { CookieSettingsLink } from '../../../consent/CookieBanner'
import { PageHero, revealDelay } from '../components'

export const metadata: Metadata = {
  title: 'Cookie Policy | FAYFORT International Trading',
  description: 'The cookies fayfort.com and app.fayfort.com use, what each one is for, and how to change your choice.',
}

// Keep in step with web/src/consent/consent.ts and dashboard/src/lib/consent.ts.
const necessary: [string, string, string][] = [
  ['ff_consent', 'Remembers your cookie choice for fayfort.com and app.fayfort.com', '6 months'],
  ['ff_member', 'Notes that this browser has signed in to a FayFort account, so members don’t see visitor pop-ups', '1 year'],
  ['ff_popup', 'Remembers that you closed a pop-up, so it stays away', '7 to 30 days'],
  ['ff_visits', 'Counts visits so the newsletter pop-up only appears from your second visit', '1 year'],
  ['Sign-in session', 'Keeps you signed in to app.fayfort.com (stored in your browser’s local storage)', 'Until you sign out'],
  ['Shopify cookies', 'Your cart and checkout when you buy LANDED or a FayFort product', 'Set by Shopify'],
]
const marketing: [string, string, string][] = [
  ['_fbp, _fbc', 'Meta Pixel (Instagram and Facebook): which ads bring visitors, and showing our ads to people who visited', 'Up to 3 months'],
  ['_ttp, ttcsid', 'TikTok Pixel: which TikTok ads bring visitors, and showing our ads to people who visited', 'Up to 13 months'],
  ['Google advertising cookies', 'Ads shown inside the FayFort app (app.fayfort.com), personalised only with your OK', 'Set by Google'],
]

function CookieTable({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="terms-table-wrap">
      <table className="terms-table">
        <thead><tr><th>Cookie</th><th>What it does</th><th>How long</th></tr></thead>
        <tbody>{rows.map(([name, purpose, life]) => <tr key={name}><td><strong>{name}</strong></td><td>{purpose}</td><td>{life}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

export default function CookiePolicyPage() {
  return (
    <>
      <PageHero kicker="Legal" title="Cookie Policy" lede="Last updated: 25 October 2026" />
      <div className="shell prose-page legal">
        <article className="prose" data-reveal="fade" style={revealDelay(3)}>
          <p>Cookies are small files a website keeps in your browser so it can recognise you on your next page or visit. This page lists the ones <strong>fayfort.com</strong> and the FayFort app at <strong>app.fayfort.com</strong> use.</p>
          <p>You choose once, in the banner, and the choice applies to both. <strong>Marketing cookies are off until you agree.</strong> You can change your mind at any time: <CookieSettingsLink className="text-button" />.</p>

          <h2 id="necessary">1. Necessary cookies</h2>
          <p>These make the site work and are always on. They don’t track you across other websites.</p>
          <CookieTable rows={necessary} />

          <h2 id="marketing">2. Marketing cookies (only with your OK)</h2>
          <p>We advertise on Instagram, Facebook and TikTok. These cookies tell us which ads bring people to FayFort and let us show our ads to people who have visited. They are set by Meta, TikTok and Google, who handle the data under their own privacy policies.</p>
          <CookieTable rows={marketing} />

          <h2 id="measurement">3. Visitor counts</h2>
          <p>We count page visits with Vercel Analytics, which doesn’t use cookies or identify you.</p>

          <h2 id="choices">4. Your choices</h2>
          <ul>
            <li>Use <CookieSettingsLink className="text-button" /> (also at the bottom of every page) to switch marketing cookies on or off</li>
            <li>Switching them off removes the Meta and TikTok cookies from this site</li>
            <li>You can also block or delete cookies in your browser’s settings; the site still works without marketing cookies</li>
          </ul>

          <h2 id="contact">5. Contact</h2>
          <p>Questions about cookies or your data: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. See also our <Link href="/terms">Terms and Conditions</Link>.</p>
        </article>
      </div>
    </>
  )
}
