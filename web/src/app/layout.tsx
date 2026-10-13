import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

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
      </body>
    </html>
  )
}
