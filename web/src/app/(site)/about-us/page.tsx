import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { FAYFORT_INSTAGRAM, SUPPORT_EMAIL } from '@/config/contact'
import { PageHero, revealDelay } from '../components'

export const metadata: Metadata = {
  title: 'About | FAYFORT International Trading',
  description: 'FAYFORT International Trading — sourcing, inspection and shipping from China, run by someone who lives here.',
}

export default function AboutPage() {
  return (
    <>
      <PageHero kicker="About" title={<>Run by someone <em>who lives here.</em></>} lede="FAYFORT International Trading is a sourcing, logistics and consultancy company based in China." />

      <div className="shell about-grid">
        <div className="about-portrait" data-reveal="zoom"><Image src="/images/landed/fayfay.jpg" alt="FayFay, founder of FAYFORT International Trading" fill sizes="(max-width: 900px) 100vw, 40vw" style={{ objectFit: 'cover', objectPosition: '50% 25%' }} /></div>
        <div className="prose" data-reveal style={revealDelay(1)}>
          <h2>Who we are</h2>
          <p>I’m FayFay. I’ve been here eight years. I speak the language, I know how the markets work, and — more usefully — I know which of them are worth your time.</p>
          <p>What my company does is close the gap between the people who make things in China and the people who want to buy them, without the layer of middlemen that sits between the two by default.</p>

          <h2>Why that gap exists</h2>
          <p>Most people buying from China are not buying from the factory.</p>
          <p>They are buying from someone who bought from someone who bought from the factory, and every one of those people took a margin. By the time a price reaches a first-time importer, it has been marked up two or three times — and nobody along the way has any reason to explain that.</p>
          <p>Our work is going directly to the source. Finding the factory. Walking the market. Checking the goods before they’re paid for. Packing them properly, and getting them home.</p>
        </div>
      </div>

      <section className="contents-section"><div className="shell section-space prose-page">
        <div className="prose" data-reveal>
          <h2>Who we work with</h2>
          <p>Clients come to us from Nigeria, the United Kingdom, the United States and elsewhere — usually with a product in mind and no idea where it’s made.</p>
          <p>Sometimes we already know the factory and it’s a phone call. Sometimes it means walking every market in a category until we find it. Either way, what a client is buying is the eight years, not the errand.</p>
        </div>
        <div className="audience-grid">
          {[
            ['First-time importers', 'testing a product before committing to volume'],
            ['Established businesses', 'who want to cut out the agent layer they’ve been paying for years'],
            ['Retailers and brand owners', 'developing their own product rather than reselling someone else’s'],
            ['Buyers coming to China in person', 'who need someone on the ground who knows where to go'],
          ].map(([title, copy], index) => <article className="inside-card" key={title} data-reveal style={revealDelay(index)}><h3>{title}</h3><p>{copy}</p></article>)}
        </div>
      </div></section>

      <div className="shell prose-page">
        <section className="prose" data-reveal>
          <h2>How we work</h2>
          <p><strong>We go to the source.</strong> We look for factories directly. We don’t work through middlemen, because that’s the cost we exist to remove.</p>
          <p><strong>We tell you what we find.</strong> If a product is cheaper in another city, we’ll say so. If a supplier is a trading company rather than a factory, you’ll know before you order. If something can’t be done at your quantity, you’ll hear that too — before you’ve spent money finding out.</p>
          <p><strong>We don’t touch counterfeits.</strong> We don’t source branded lookalikes, and we don’t point clients toward them. Seizure at your destination port attaches to your importer record, not just to the goods, and no margin is worth that.</p>

          <h2>The other side of the business</h2>
          <p>Alongside the sourcing work, we publish.</p>
          <p><strong><Link href="/ebook/landed">LANDED — The Guangzhou Sourcing Directory</Link></strong> is our book: market and factory addresses, in English and Chinese, with the working knowledge that makes them useful. It’s published under our imprint, The Hard Way Press.</p>
          <p><strong>FaySource</strong> is the directory behind it — continuously updated, because markets move, stalls change hands and buildings get redeveloped. A printed list starts dying the day it ships. A maintained one doesn’t.</p>
          <p>Both exist for the same reason the sourcing business does: the information that makes importing work isn’t secret, it’s just hard to find, and the people who know it rarely write it down.</p>
        </section>

        <section className="cta-panel" data-reveal="zoom">
          <h2>Get in touch</h2>
          <p>If you’re coming to China and want someone on the ground, or you have a product and no idea where to start — that’s the conversation to have.</p>
          <div className="cta-actions">
            <a className="button button-primary" href={`mailto:${SUPPORT_EMAIL}`}>Email {SUPPORT_EMAIL}</a>
            <a className="text-button" href={`https://instagram.com/${FAYFORT_INSTAGRAM}`} target="_blank" rel="noreferrer">Instagram @{FAYFORT_INSTAGRAM}</a>
          </div>
        </section>
      </div>
    </>
  )
}
