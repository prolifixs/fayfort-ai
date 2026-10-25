import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'
import CookieBanner from '../consent/CookieBanner'
import MarketingPixels from '../consent/MarketingPixels'
import VisitorPopups from '../consent/VisitorPopups'

// Public FAYFORT site (fayfort.com). The member and staff app lives in ../dashboard (app.fayfort.com);
// the old enterprise providers (auth, Stripe, toasts) were not carried over — see web/README.md.
export const metadata: Metadata = {
  metadataBase: new URL('https://www.fayfort.com'),
  title: 'FAYFORT International Trading',
  description: 'Sourcing, inspection, consolidation and shipping from China, run by someone who lives here. Publisher of LANDED, the Guangzhou sourcing directory.',
  openGraph: { siteName: 'FAYFORT International Trading', type: 'website', locale: 'en_GB' },
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: the site pages' reveal boot script adds a class to <html> before hydration.
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
        <Analytics />
        {/* Cookie choice first; marketing pixels only after consent; visitor popups only once the choice is made. */}
        <CookieBanner />
        <MarketingPixels />
        <VisitorPopups />
      </body>
    </html>
  )
}
