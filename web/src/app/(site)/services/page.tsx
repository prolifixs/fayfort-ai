import type { Metadata } from 'next'
import Link from 'next/link'
import { SOURCING_ENQUIRY_URL, SUPPORT_EMAIL } from '@/config/contact'
import { PageHero, revealDelay } from '../components'

export const metadata: Metadata = {
  title: 'Services | FAYFORT International Trading',
  description: 'Sourcing, supplier verification, market days, factory inspection, consolidation and shipping from China.',
}

const services: { id: string; title: string; lead: string; intro?: string; label?: string; items: [string | null, string][]; after?: string }[] = [
  {
    id: 'sourcing',
    title: 'Sourcing',
    lead: 'You tell us the product. We find where it’s made.',
    intro: 'Some products we already know — we’ve bought them before and we know which building, which floor, which seller. Others mean walking a category until we find it.',
    label: 'What you get',
    items: [
      [null, 'Suppliers identified and approached directly, not through an agent layer'],
      [null, 'Factory or trading company established before you commit — so you know who you’re dealing with'],
      [null, 'Prices quoted against your actual quantity, not a headline figure'],
      [null, 'Lead times and minimums confirmed in writing before anything is ordered'],
      [null, 'Samples sourced, checked and sent to you'],
    ],
    after: 'When a product is cheaper in another city, we’ll tell you. Guangzhou is where things are traded. It’s frequently not where they’re cheapest.',
  },
  {
    id: 'market-days',
    title: 'Market days — buying with you in China',
    lead: 'For clients who come to China themselves.',
    intro: 'A day spent in the wrong building teaches you nothing about what China costs. We plan the day around one cluster, take you through the buildings that matter, translate, and keep you out of the markets that price for visitors.',
    label: 'What that covers',
    items: [
      [null, 'A planned route through the right cluster, in the right order'],
      [null, 'Translation and negotiation on your behalf'],
      [null, 'Transport between markets, with somewhere to put the samples'],
      [null, 'The floors and sellers worth your time — and the ones that aren’t'],
      [null, 'Samples bought and logged as you go, so you know what came from where'],
    ],
  },
  {
    id: 'inspection',
    title: 'Factory visits and inspection',
    lead: 'Someone standing in the building, before you pay.',
    items: [
      ['Factory visits', 'we go, we look, and we report back on what’s actually there. Some “factories” are an office and a phone.'],
      ['Production inspection', 'checking goods during or after production, against your specification'],
      ['Pre-shipment inspection', 'the last check before your money leaves and the goods do'],
      ['Packing inspection', 'carton counts, labelling, and whether the packing will survive eight weeks at sea'],
    ],
    after: 'You get photographs and a written report. If something’s wrong, you hear about it while it can still be fixed.',
  },
  {
    id: 'shipping',
    title: 'Consolidation and shipping',
    lead: 'Most buyers don’t fill a container. That’s not a problem.',
    items: [
      ['Consolidation', 'goods from several suppliers received, held, checked and shipped together as one load'],
      ['Container sharing', 'if your goods don’t fill a container, they travel in one with other people’s, and you pay for the space you use'],
      ['Sea freight', 'priced by cubic metre. Right for dense, heavy, non-urgent goods'],
      ['Air freight', 'priced by weight. Right for light, bulky or urgent goods, and the only route for some restricted cargo'],
      ['Full container loads', '20ft and 40ft, where your volume justifies it'],
    ],
    after: 'One thing worth knowing: never let a factory arrange your shipping. They aren’t a shipping company — they call a forwarder, add a margin, and pass it to you as a single number. You never see the original quote. That margin is invisible on the invoice, which is exactly why it persists.',
  },
  {
    id: 'private-label',
    title: 'Private label and product development',
    lead: 'For buyers building their own brand rather than reselling someone else’s.',
    items: [
      [null, 'Product developed to your specification, with the factory rather than a reseller'],
      [null, 'Your own branding, packaging and labelling applied'],
      [null, 'Packaging sourced separately from the product — it’s a different trade, and its minimums are frequently higher than the product’s'],
      [null, 'Samples and revisions before production starts'],
    ],
  },
  {
    id: 'consultancy',
    title: 'Consultancy',
    lead: 'For businesses that want to run their own sourcing and need someone who knows the ground.',
    items: [
      [null, 'Which city makes your product, and why that matters'],
      [null, 'Reviewing quotes and supplier claims before you commit'],
      [null, 'Working out your true landed cost — product, freight, duty, clearing, everything'],
      [null, 'Planning a buying trip that’s worth the flight'],
    ],
  },
]

const steps = [
  ['Tell us what you need.', 'The product, the quantity, where it’s going. If you’re not sure of the quantity, say so — it changes the price, and we’d rather know now.'],
  ['We come back with a plan and a quote.', 'What we’ll do, what it costs, and how long it takes.'],
  ['We work.', 'You get updates as we go — photographs, quotes, samples, inspection reports.'],
  ['Your goods ship.', 'Consolidated, checked, packed and documented.'],
]

export default function ServicesPage() {
  return (
    <>
      <PageHero kicker="Services" title={<>From first enquiry to <em>delivered container.</em></>} lede="Everything below can be taken on its own, or as one job from first enquiry to delivered container." />

      <nav className="shell service-index" aria-label="Services on this page" data-reveal="fade" style={revealDelay(3)}>
        {services.map((service) => <a key={service.id} href={`#${service.id}`}>{service.title.split(' — ')[0]}</a>)}
      </nav>

      <div className="shell service-list">
        {services.map((service, index) => (
          <section className="service-block" id={service.id} key={service.id}>
            <div className="service-head" data-reveal>
              <span className="service-number">{String(index + 1).padStart(2, '0')}</span>
              <h2>{service.title}</h2>
              <p className="service-lead">{service.lead}</p>
            </div>
            <div className="service-body prose" data-reveal style={revealDelay(1)}>
              {service.intro && <p>{service.intro}</p>}
              {service.label && <p className="mini-label">{service.label}</p>}
              <ul>{service.items.map(([term, text]) => <li key={text}>{term && <strong>{term} — </strong>}{text}</li>)}</ul>
              {service.after && <p className="service-after">{service.after}</p>}
            </div>
          </section>
        ))}
      </div>

      <section className="dark-section"><div className="shell section-space">
        <div className="section-kicker light" data-reveal><p>How it works</p></div>
        <ol className="steps">{steps.map(([title, copy], index) => <li key={title} data-reveal style={revealDelay(index)}><span>{index + 1}</span><strong>{title}</strong><p>{copy}</p></li>)}</ol>
      </div></section>

      <div className="shell prose-page">
        <section className="prose" data-reveal>
          <h2>Pricing</h2>
          <p><strong>Every quote is broken out.</strong> Goods here, freight there, inspection separately. Anyone who’ll only give you one bundled number is telling you where their margin is.</p>

          <h2>What we don’t do</h2>
          <p>Being straight about this saves everyone time.</p>
          <ul>
            <li><strong>Counterfeit or branded lookalike goods.</strong> Not sourced, not shipped, not advised on.</li>
            <li><strong>Restricted and regulated goods</strong> we can’t legally handle or that your market won’t admit.</li>
            <li><strong>Guaranteeing customs clearance or duty costs</strong> at your destination. We prepare documentation and work with clearing agents, but duties, clearing fees and import licences are yours.</li>
            <li><strong>Acting as your legal or customs advisor.</strong> We’ll tell you what we know and what to ask. The answers come from the authorities in your country.</li>
          </ul>
        </section>

        <section className="cta-panel" data-reveal="zoom">
          <h2>Start a job</h2>
          <p>Tell us the product, the quantity and the destination. That’s enough for a first answer.</p>
          <div className="cta-actions">
            <a className="button button-primary" href={SOURCING_ENQUIRY_URL}>Email {SUPPORT_EMAIL}</a>
            <Link className="text-button" href="/ebook/landed">Prefer to go yourself? See LANDED</Link>
          </div>
        </section>
      </div>
    </>
  )
}
