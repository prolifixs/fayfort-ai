import type { Metadata } from 'next'
import { Suspense } from 'react'
import { PageHero } from '../components'
import NewsletterStatus from './NewsletterStatus'

export const metadata: Metadata = {
  title: 'Newsletter | FAYFORT International Trading',
  description: 'New finds from China every week and early access to FayFort giveaways.',
  robots: { index: false },
}

export default function NewsletterPage() {
  return (
    <>
      <PageHero kicker="Newsletter" title="New finds from China, every week" lede="The best products we source, plus early access to our giveaways. Unsubscribe any time." />
      <div className="shell prose-page">
        <Suspense fallback={null}>
          <NewsletterStatus />
        </Suspense>
      </div>
    </>
  )
}
