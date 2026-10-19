import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, Camera, Check, Compass, MessageCircle, Package, Search, ShoppingBag, Truck, Users } from 'lucide-react'
import { CHAT_URL, BROWSE_URL, DIRECTORY_URL, FAYFORT_INSTAGRAM, JOIN_URL, REQUESTS_URL, SUPPORT_EMAIL, SUPPORT_HOURS, WHATSAPP_DISPLAY, WHATSAPP_URL } from '@/config/contact'
import { revealDelay } from './components'
import { FAQ } from './faq'
import HeroGlobe from './globe/HeroGlobe'
import InstagramRail from './instagram/InstagramRail'
import ReviewsBand from './reviews/ReviewsBand'

const title = 'FAYFORT · From China’s factories to your door'
const description = 'We source, inspect and ship from China for importers in Africa, the UK and the US, and you follow every step in your free FayFort dashboard.'

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, url: '/', images: [{ url: '/images/fay/fay-digital-trade-expo.jpg', alt: 'FayFay speaking at the Global Digital Trade Expo in Hangzhou' }] },
}

const steps = [
  { icon: Search, title: 'Tell us what you need', copy: 'Send a link, a photo or a description from your dashboard, with the quantity and your budget if you have one.', chip: ['New request', 'Lace front wig · 20 pcs'] },
  { icon: Compass, title: 'We find it and quote it', copy: 'We review it within 24 hours, give you a delivery estimate, then send the options we found. You choose one.', chip: ['3 options found', 'Choose one to get your invoice'] },
  { icon: Camera, title: 'We check it in Guangzhou', copy: 'Your goods come to our warehouse first. You see photos or video before anything ships.', chip: ['Inspection passed', '24 photos added'] },
  { icon: Truck, title: 'We ship, you track', copy: 'Sea or air, with a tracking number. Every step shows on your request’s timeline.', chip: ['In transit', 'Estimated delivery 18 Nov'] },
]

const features = [
  { icon: Package, title: 'Sourcing requests', copy: 'Tell us what you want and follow it from first quote to your door.', href: REQUESTS_URL, cta: 'Send a request' },
  { icon: ShoppingBag, title: 'Shop and group buys', copy: 'Buy in-stock products, or join the pool on trending items for a group price.', href: BROWSE_URL, cta: 'Browse' },
  { icon: Users, title: 'Supplier directory', copy: 'Markets, factories and service providers in China, with addresses in English and Chinese.', href: DIRECTORY_URL, cta: 'Open the directory' },
  { icon: MessageCircle, title: 'Chat and consultations', copy: 'Ask anything in the chat, or book time with the FayFort team for a bigger project.', href: CHAT_URL, cta: 'Start a chat' },
]

const plans: [string, string, string[]][] = [
  ['Free', 'Everything you need to start.', ['Send sourcing requests', 'Shop, group buys and giveaways', 'Supplier directory', 'Chat with the FayFort team']],
  ['Standard', 'For regular buyers.', ['Lower sourcing deposits', 'Cheaper consultations', 'No ads', 'Premium themes']],
  ['Pro', 'For businesses buying every month.', ['No deposit while you keep buying', 'A consultation every month', 'Supplier contacts every month', 'Everything in Standard']],
]

const business: [string, string, string][] = [
  ['Market days', 'We walk the right markets with you, translate and negotiate.', '/services#market-days'],
  ['Factory visits and inspection', 'Someone in the building, with photos and a written report.', '/services#inspection'],
  ['Consolidation and freight', 'Goods from several suppliers, checked and shipped as one load.', '/services#shipping'],
  ['Private label', 'Your own product, branding and packaging, made with the factory.', '/services#private-label'],
]

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ.map(([question, answer]) => ({ '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer } })),
}
const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'FAYFORT International Trading',
  url: 'https://www.fayfort.com',
  logo: 'https://www.fayfort.com/images/brand/fayfort-logo.png',
  email: SUPPORT_EMAIL,
  sameAs: [`https://instagram.com/${FAYFORT_INSTAGRAM}`],
}

export default function HomePage() {
  return (
    <div className="home">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify([organizationJsonLd, faqJsonLd]) }} />

      {/* 1. Hero. Copy starts .is-visible so it paints at once; the globe loads after. */}
      <section className="home-hero"><div className="shell home-hero-grid">
        <div className="home-hero-copy">
          <p className="overline is-visible" data-reveal><span /> FAYFORT International Trading · Guangzhou</p>
          <h1 className="is-visible" data-reveal style={revealDelay(1)}>From China’s factories <em>to your door.</em></h1>
          <p className="page-lede is-visible" data-reveal style={revealDelay(2)}>We source, inspect and ship for importers in Africa, the UK and the US, and you follow every step in your free FayFort dashboard.</p>
          <div className="home-actions is-visible" data-reveal style={revealDelay(3)}>
            <a className="button button-blue button-large" href={JOIN_URL}>Join free <ArrowRight size={18} /></a>
            <Link className="button button-ghost button-large" href="/how-it-works">See how it works</Link>
          </div>
          <p className="home-proof is-visible" data-reveal style={revealDelay(4)}>Nigeria · Ghana · Zimbabwe · South Africa · Kenya · UK · US</p>
        </div>
        <div className="home-globe is-visible" data-reveal="fade" style={revealDelay(2)}><HeroGlobe /></div>
      </div></section>

      {/* 2. Proof strip */}
      <section className="proof-strip" aria-label="Why FAYFORT"><div className="shell proof-grid">
        {[
          ['8 years in China', 'We live here, speak the language and know the markets.'],
          ['Checked in Guangzhou', 'Your goods come to our warehouse before they ship.'],
          ['Tracked step by step', 'A timeline and a delivery estimate on every request.'],
          ['On stage in Hangzhou', 'Speaker at the Fourth Global Digital Trade Expo.'],
        ].map(([head, copy], index) => <div key={head} data-reveal style={revealDelay(index)}><strong>{head}</strong><span>{copy}</span></div>)}
      </div></section>

      {/* 3. Instagram */}
      <InstagramRail />

      {/* 4. How it works */}
      <section className="home-steps" aria-labelledby="steps-title"><div className="shell section-space">
        <div className="section-head" data-reveal>
          <p className="overline"><span /> How it works</p>
          <h2 id="steps-title">Four steps, <em>all in one place.</em></h2>
        </div>
        <ol className="step-cards">
          {steps.map((step, index) => (
            <li key={step.title} data-reveal style={revealDelay(index)}>
              <span className="step-number">{index + 1}</span>
              <step.icon size={22} aria-hidden="true" />
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
              <div className="ui-chip" aria-hidden="true"><Check size={14} /><span><strong>{step.chip[0]}</strong>{step.chip[1]}</span></div>
            </li>
          ))}
        </ol>
        <Link className="text-button" href="/how-it-works">More on how it works <ArrowRight size={15} /></Link>
      </div></section>

      {/* 4b. Customer reviews (hidden until staff publish one) */}
      <ReviewsBand />

      {/* 5. What a free account gives you */}
      <section className="dark-section" aria-labelledby="account-title"><div className="shell section-space">
        <div className="section-head light" data-reveal>
          <p className="overline"><span /> Your FayFort dashboard</p>
          <h2 id="account-title">One free account. <em>Everything you buy from China.</em></h2>
        </div>
        <div className="feature-grid">
          {features.map((feature, index) => (
            <a key={feature.title} className="feature-card" href={feature.href} data-reveal style={revealDelay(index)}>
              <feature.icon size={24} aria-hidden="true" />
              <h3>{feature.title}</h3>
              <p>{feature.copy}</p>
              <span>{feature.cta} <ArrowRight size={15} /></span>
            </a>
          ))}
        </div>
        <a className="button button-pink button-large" href={JOIN_URL} data-reveal>Join free <ArrowRight size={18} /></a>
      </div></section>

      {/* 6. Plans, without prices (owner decision 6) */}
      <section className="shell section-space" aria-labelledby="plans-title">
        <div className="section-head" data-reveal>
          <p className="overline"><span /> Plans</p>
          <h2 id="plans-title">Free to join. <em>More with a plan.</em></h2>
          <p className="section-lede">Start free. Paid plans lower your sourcing deposits and add perks; you’ll see the prices in your dashboard.</p>
        </div>
        <div className="plan-grid">
          {plans.map(([name, lead, perks], index) => (
            <article key={name} className={index === 2 ? 'plan-card is-featured' : 'plan-card'} data-reveal style={revealDelay(index)}>
              <h3>{name}</h3>
              <p>{lead}</p>
              <ul>{perks.map((perk) => <li key={perk}><Check size={15} aria-hidden="true" /> {perk}</li>)}</ul>
            </article>
          ))}
        </div>
      </section>

      {/* 7. LANDED (its page and checkout are unchanged) */}
      <section className="landed-band" aria-labelledby="landed-title"><div className="shell landed-band-grid">
        <div className="landed-band-cover" data-reveal="zoom"><Image src="/images/landed/landed-front.jpg" alt="The cover of LANDED, the Guangzhou sourcing directory" fill sizes="(max-width: 900px) 60vw, 26vw" style={{ objectFit: 'cover' }} /></div>
        <div data-reveal style={revealDelay(1)}>
          <p className="overline"><span /> Prefer to go yourself?</p>
          <h2 id="landed-title">LANDED, <em>the Guangzhou directory.</em></h2>
          <p className="section-lede">Markets, factories, hotels, restaurants and services in Guangzhou, with addresses in English and Chinese and the working knowledge that makes them useful.</p>
          <Link className="button button-pink" href="/ebook/landed">Get LANDED <ArrowRight size={17} /></Link>
        </div>
      </div></section>

      {/* 8. Meet FayFay */}
      <section className="shell section-space founder" aria-labelledby="founder-title">
        <div className="founder-photo" data-reveal="zoom"><Image src="/images/fay/fay-digital-trade-expo.jpg" alt="FayFay speaking at the Fourth Global Digital Trade Expo in Hangzhou" fill sizes="(max-width: 900px) 100vw, 44vw" style={{ objectFit: 'cover' }} /></div>
        <div data-reveal style={revealDelay(1)}>
          <p className="overline"><span /> Meet the founder</p>
          <h2 id="founder-title">FayFay, <em>on the ground since 2018.</em></h2>
          <p className="section-lede">FayFay moved to China to study international economics, shipped her first container to Nigeria in 2020 and founded FAYFORT in 2021. She still walks the markets herself.</p>
          <ol className="mini-timeline">
            <li><b>2018</b> Moved to China</li>
            <li><b>2021</b> Founded FAYFORT International Trading</li>
            <li><b>2026</b> Published LANDED</li>
          </ol>
          <Link className="text-button" href="/about-us">Our story <ArrowRight size={15} /></Link>
        </div>
      </section>

      {/* 9. For businesses */}
      <section className="business-band" aria-labelledby="business-title"><div className="shell section-space">
        <div className="section-head" data-reveal>
          <p className="overline"><span /> For businesses</p>
          <h2 id="business-title">Coming to China, <em>or building a brand?</em></h2>
        </div>
        <div className="business-grid">
          {business.map(([name, copy, href], index) => (
            <Link key={name} className="business-card" href={href} data-reveal style={revealDelay(index)}><h3>{name}</h3><p>{copy}</p><ArrowRight size={16} aria-hidden="true" /></Link>
          ))}
        </div>
      </div></section>

      {/* 10. Questions */}
      <section className="shell section-space faq" aria-labelledby="faq-title">
        <div className="section-head" data-reveal>
          <p className="overline"><span /> Questions</p>
          <h2 id="faq-title">Straight answers.</h2>
        </div>
        <div className="faq-list">
          {FAQ.map(([question, answer]) => (
            <details key={question} data-reveal><summary>{question}</summary><p>{answer}</p></details>
          ))}
        </div>
      </section>

      {/* 11. Contact: the dashboard chat first, then WhatsApp (owner decision 8) */}
      <section id="contact" className="contact-band" aria-labelledby="contact-title"><div className="shell section-space contact-grid">
        <div data-reveal>
          <p className="overline"><span /> Talk to the team</p>
          <h2 id="contact-title">Questions before you start? <em>Ask us.</em></h2>
          <p className="section-lede">Chat with us in your dashboard: the FayFort assistant answers straight away and a person joins during working hours ({SUPPORT_HOURS}).</p>
          <div className="home-actions">
            <a className="button button-blue button-large" href={CHAT_URL}>Chat with us <MessageCircle size={18} /></a>
          </div>
        </div>
        <ul className="contact-list" data-reveal style={revealDelay(1)}>
          <li><span>WhatsApp</span><a href={WHATSAPP_URL} target="_blank" rel="noreferrer">{WHATSAPP_DISPLAY}</a></li>
          <li><span>Email</span><a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></li>
          <li><span>Instagram</span><a href={`https://instagram.com/${FAYFORT_INSTAGRAM}`} target="_blank" rel="noreferrer">@{FAYFORT_INSTAGRAM}</a></li>
          <li><span>Hours</span><p>{SUPPORT_HOURS}</p></li>
        </ul>
      </div></section>
    </div>
  )
}
