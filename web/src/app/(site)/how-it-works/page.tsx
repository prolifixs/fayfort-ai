import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Check } from 'lucide-react'
import { CHAT_URL, JOIN_URL } from '@/config/contact'
import { PageHero, revealDelay } from '../components'

export const metadata: Metadata = {
  title: 'How it works | FAYFORT International Trading',
  description: 'Send a sourcing request from your free FayFort dashboard; we find, quote, inspect and ship it, and you follow every step.',
}

// The request journey as the dashboard shows it (docs/KNOWLEDGE_BASE_DRAFT.md section 2). No plan prices (decision 6).
const journey: [string, string, [string, string]][] = [
  ['Join free and send a request', 'Describe what you want, paste a link, or share a screenshot or a product you saved. Add the quantity, colours, sizes and a budget if you have one. Sending a request is free.', ['Request sent', 'Ankara fabric · 40 yards']],
  ['We review it within 24 hours', 'If we need a detail, we ask on your request and you answer there. Before sourcing starts you get an estimated delivery date, and it only changes with a reason you can read.', ['Delivery estimate', '18 November · reason shown if it changes']],
  ['Your deposit (Free and Standard plans)', 'After the review we send a sourcing deposit invoice. It’s part of your product total and comes off your final invoice. Pro members in good standing pay no deposit.', ['Deposit invoice', 'Taken off your final invoice']],
  ['We find options and you choose', 'We send the products we found, with prices and notes. You pick one. Want us to look again? Just say so on the request.', ['3 options found', 'Choose one to continue']],
  ['Invoice and payment', 'We send an invoice for your choice through our secure checkout. Before paying, you pick which of your saved addresses we deliver to. Our commission is built into this invoice; there is no separate fee.', ['Invoice ready', 'Pay securely at checkout']],
  ['We check it at our warehouse', 'Your goods come to our Guangzhou warehouse first. You see photos or video on your request before anything ships.', ['Inspection passed', '24 photos added']],
  ['We ship, you track', 'Sea or air, with a tracking number. Every update appears on your request’s timeline until it’s delivered.', ['Delivered', 'Lagos · signed for']],
]

export default function HowItWorksPage() {
  return (
    <>
      <PageHero kicker="How it works" title={<>From a link or a photo <em>to your door.</em></>} lede="Everything happens in your free FayFort dashboard, so you always know where your order is and what happens next." />
      <div className="shell section-space" style={{ paddingTop: 24 }}>
        <ol className="journey">
          {journey.map(([title, copy, chip], index) => (
            <li key={title} data-reveal style={revealDelay(index % 3)}>
              <span className="journey-number">{index + 1}</span>
              <div><h2>{title}</h2><p>{copy}</p></div>
              <div className="ui-chip" aria-hidden="true"><Check size={14} /><span><strong>{chip[0]}</strong>{chip[1]}</span></div>
            </li>
          ))}
        </ol>
        <section className="cta-panel" data-reveal="zoom">
          <h2>Ready when you are.</h2>
          <p>Join free, send your first request, and we’ll be back within 24 hours. Questions first? Chat with us in your dashboard.</p>
          <div className="cta-actions">
            <a className="button button-pink" href={JOIN_URL}>Join free <ArrowRight size={17} /></a>
            <a className="text-button" href={CHAT_URL}>Chat with us</a>
            <Link className="text-button" href="/services">See all services</Link>
          </div>
        </section>
      </div>
    </>
  )
}
