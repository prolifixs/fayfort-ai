import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { FAYFAY_SOCIAL_HANDLE, FAYFORT_INSTAGRAM, SUPPORT_EMAIL, WHATSAPP_DISPLAY, WHATSAPP_URL } from '@/config/contact'
import { PRICE_USD, formatPrice } from '../ebook/landed/config'
import { revealDelay } from './components'

const title = 'FayFay — Founder of FAYFORT International Trading'
const description = 'FayFay has lived and worked in China for eight years, sourcing, inspecting and shipping goods for importers across Africa, the UK and the US. Founder of FAYFORT International Trading and author of LANDED.'

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, url: '/', images: [{ url: '/images/fay/fay-blue-satin.jpg', alt: 'FayFay in a blue satin gown' }] },
}

const milestones = [
  ['2018', 'Moved to China to study international economics, and to learn the market from the ground up.'],
  ['2020', 'First container shipment to Nigeria. It sold out in three days.'],
  ['2021', 'Founded FAYFORT International Trading.'],
  ['2022–24', 'Expanded to Zimbabwe and South Africa, and added full logistics support.'],
  ['2025', 'Graduated from Zhejiang University of Technology. Spoke at the Fourth Global Digital Trade Expo in Hangzhou.'],
  ['2026', 'Published LANDED, the Guangzhou sourcing directory.'],
]

export default function HomePage() {
  return (
    <div className="hub">
      {/* Who she is, and the two main doors. The hero starts .is-visible so its entrance
          plays from first paint instead of waiting for RevealOnScroll to load. */}
      <section className="hub-hero"><div className="shell hub-hero-grid">
        <div className="hub-hero-copy">
          <p className="hub-name is-visible" data-reveal><Image className="hub-butterfly" src="/images/fay/butterfly.png" alt="" width={34} height={30} priority /> FayFay</p>
          <h1 className="is-visible" data-reveal style={revealDelay(1)}>Between China’s factories and <em>Africa’s businesses.</em></h1>
          <p className="page-lede is-visible" data-reveal style={revealDelay(2)}>I’ve lived in China for eight years. I source, inspect and ship for importers in Nigeria, Zimbabwe, South Africa, the UK and the US, and I wrote the directory I wish I’d had when I started.</p>
          <div className="hub-actions is-visible" data-reveal style={revealDelay(3)}>
            <Link className="button button-blue" href="/services">Work with FAYFORT <ArrowRight size={17} /></Link>
            <Link className="text-button" href="/ebook/landed">Get LANDED, the directory</Link>
          </div>
          <p className="hub-role is-visible" data-reveal style={revealDelay(4)}>Founder, FAYFORT International Trading · Author, LANDED</p>
        </div>
        <div className="hub-portrait is-visible" data-reveal="zoom" style={revealDelay(2)}>
          <Image src="/images/fay/fay-blue-satin.jpg" alt="FayFay in a blue satin gown" fill priority sizes="(max-width: 900px) 100vw, 42vw" style={{ objectFit: 'cover', objectPosition: '50% 30%' }} />
        </div>
      </div></section>

      {/* The three ways people work with her */}
      <section className="shell section-space">
        <div className="section-kicker" data-reveal><p>Three ways in</p></div>
        <div className="doors">
          <Link className="door" data-reveal href="/services">
            <span className="door-label">FAYFORT International Trading</span>
            <h2>Sourcing and shipping</h2>
            <p>Sourcing, factory visits, inspection, consolidation and freight. One part of the job, or all of it.</p>
            <span className="door-link">See services <ArrowRight size={15} /></span>
          </Link>
          <Link className="door door-landed" data-reveal style={revealDelay(1)} href="/ebook/landed">
            <span className="door-label">LANDED · {formatPrice(PRICE_USD)}</span>
            <h2>The book and live directory</h2>
            <p>Markets, factories, hotels, restaurants and services in Guangzhou, with addresses in English and Chinese.</p>
            <span className="door-link">Get the directory <ArrowRight size={15} /></span>
          </Link>
          <a className="door" data-reveal style={revealDelay(2)} href="#contact">
            <span className="door-label">Talks, media and collaborations</span>
            <h2>Book FayFay</h2>
            <p>Panels, university talks, press, and brand or editorial work.</p>
            <span className="door-link">Get in touch <ArrowRight size={15} /></span>
          </a>
        </div>
      </section>

      {/* Proof: the rooms she has actually stood in */}
      <section className="dark-section"><div className="shell section-space">
        <div className="section-kicker light" data-reveal><p>On the record</p></div>
        <div className="record-grid">
          <figure className="record-card" data-reveal>
            <div className="record-image"><Image src="/images/fay/fay-digital-trade-expo.jpg" alt="FayFay speaking at a podium at the Fourth Global Digital Trade Expo" fill sizes="(max-width: 900px) 100vw, 50vw" style={{ objectFit: 'cover', objectPosition: '50% 20%' }} /></div>
            <figcaption><strong>On stage in Hangzhou.</strong> Speaking at the Fourth Global Digital Trade Expo, for the China–Africa Bridge and the Hangzhou E-commerce Research Institute.</figcaption>
          </figure>
          <figure className="record-card" data-reveal style={revealDelay(1)}>
            <div className="record-image"><Image src="/images/fay/fay-graduation-2025.jpg" alt="FayFay in graduation robes holding her diploma and flowers" fill sizes="(max-width: 900px) 100vw, 50vw" style={{ objectFit: 'cover', objectPosition: '50% 25%' }} /></div>
            <figcaption><strong>Class of 2025.</strong> Graduating from Zhejiang University of Technology at the international students’ ceremony.</figcaption>
          </figure>
        </div>
      </div></section>

      {/* A real sequence, so it gets years */}
      <section className="shell section-space hub-story">
        <div data-reveal>
          <div className="section-kicker"><p>The road here</p></div>
          <h2>From an economics classroom to <em>a container yard.</em></h2>
          <p className="page-lede">Most people buying from China are buying from someone who bought from someone who bought from the factory. My work is removing those layers.</p>
          <Link className="text-button" href="/about-us">More about FAYFORT</Link>
        </div>
        <ol className="milestones">
          {milestones.map(([year, text], index) => <li key={year} data-reveal="left" style={revealDelay(index, 70)}><span>{year}</span><p>{text}</p></li>)}
        </ol>
      </section>

      {/* The other side of her work */}
      <section className="contents-section"><div className="shell section-space">
        <div className="editorial-head" data-reveal>
          <h2>In front of the camera</h2>
          <p>Alongside the business, I model and shoot editorial work.</p>
        </div>
        <div className="editorial-row">
          {[
            ['fay-editorial-drape.jpg', 'FayFay posed on a pedestal against cream drapery'],
            ['fay-editorial-sculpture.jpg', 'FayFay in a sculptural silver garment'],
            ['fay-night-street.jpg', 'FayFay in a black leather coat on a lantern-lit street at night'],
          ].map(([file, alt], index) => <div className="editorial-image" key={file} data-reveal style={revealDelay(index)}><Image src={`/images/fay/${file}`} alt={alt} fill sizes="(max-width: 700px) 100vw, 33vw" style={{ objectFit: 'cover' }} /></div>)}
        </div>
      </div></section>

      {/* Direct lines only */}
      <section className="shell section-space hub-contact" id="contact">
        <div data-reveal>
          <h2>Talk to me directly.</h2>
          <p className="page-lede">For sourcing, tell me the product, the quantity and where it’s going. For talks and collaborations, tell me the date and the room.</p>
          <a className="button button-blue" href={WHATSAPP_URL} target="_blank" rel="noreferrer">Message on WhatsApp <ArrowRight size={17} /></a>
        </div>
        <dl className="contact-list" data-reveal style={revealDelay(1)}>
          <div><dt>WhatsApp</dt><dd><a href={WHATSAPP_URL} target="_blank" rel="noreferrer">{WHATSAPP_DISPLAY}</a></dd></div>
          <div><dt>Email</dt><dd><a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></dd></div>
          <div><dt>Instagram</dt><dd><a href={`https://instagram.com/${FAYFAY_SOCIAL_HANDLE}`} target="_blank" rel="noreferrer">@{FAYFAY_SOCIAL_HANDLE}</a></dd></div>
          <div><dt>TikTok</dt><dd><a href={`https://tiktok.com/@${FAYFAY_SOCIAL_HANDLE}`} target="_blank" rel="noreferrer">@{FAYFAY_SOCIAL_HANDLE}</a></dd></div>
          <div><dt>FAYFORT</dt><dd><a href={`https://instagram.com/${FAYFORT_INSTAGRAM}`} target="_blank" rel="noreferrer">@{FAYFORT_INSTAGRAM}</a></dd></div>
        </dl>
      </section>
    </div>
  )
}
