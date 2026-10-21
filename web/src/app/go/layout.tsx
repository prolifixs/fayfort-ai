import type { Metadata, Viewport } from 'next'
import { GoFooter } from './GoParts'
import './go.css'

// fayfort.com/go: link-in-bio pages for Instagram and TikTok. Standalone (no site header, footer or chat) so they load
// fast on a phone and every tap goes straight to an action.
export const metadata: Metadata = {
  title: { default: 'FAYFORT: shop, source and book from China', template: '%s | FAYFORT' },
  description: 'Shop sourced products, send a sourcing request, book a consultation or a tour guide in China, and enter the FayFort giveaway.',
  alternates: { canonical: '/go' },
  openGraph: {
    title: 'FAYFORT: shop, source and book from China',
    description: 'Products, sourcing requests, consultations and tour guides in China, from FayFay and the FayFort team in Guangzhou.',
    url: '/go',
    images: [{ url: '/images/landed/fayfay.jpg', width: 900, height: 900, alt: 'FayFay, founder of FAYFORT' }],
  },
  twitter: { card: 'summary_large_image' },
}

export const viewport: Viewport = { themeColor: '#02144E' }

export default function GoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="go">
      <svg className="go-field" viewBox="0 0 400 900" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
        <path d="M-40 140 C 120 40, 300 60, 440 190" />
        <path d="M-40 520 C 140 420, 260 470, 440 600" />
        <path d="M-40 860 C 100 760, 300 800, 440 900" />
      </svg>
      <div className="go-column">
        {children}
        <GoFooter />
      </div>
    </div>
  )
}
