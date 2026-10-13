'use client'

import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { BedDouble, ChevronLeft, ChevronRight, MapPin, SearchCheck, Store, Truck, UtensilsCrossed, type LucideIcon } from 'lucide-react'

type SampleEntry = {
  kind: string
  icon: LucideIcon
  name: string
  nameZh?: string
  addressZh?: string
  address: string
  details: [string, string][]
  note?: string
  verified?: boolean
}

// One real entry from each directory table. Personal phone numbers and contact names stay behind the paywall.
const sampleEntries: SampleEntry[] = [
  {
    kind: 'Market',
    icon: Store,
    name: 'Guangda Leather Clothing City',
    addressZh: '广州白云区石井街道庆槎路901号',
    address: 'No. 901 Qingcha Road, Shijing, Baiyun District, Guangzhou',
    details: [['Category', 'Stocklot & Factory Clearance'], ['Type', 'Market, traders'], ['MOQ note', 'As low as 10 pieces'], ['Compiled', '15 Aug 2026']],
    verified: true,
  },
  {
    kind: 'Hotel',
    icon: BedDouble,
    name: 'Estay Residence',
    address: 'No. 1020 Xingang Dong Rd, Haizhu, behind Poly World Trade Centre, Block D',
    details: [['Area', 'Pazhou / Canton Fair'], ['Price', 'Budget'], ['Style', 'Apartment-style, walkable to the fair']],
    note: 'Reviews warn the map pin is wrong and taxi drivers drop at the wrong spot. Show Block D, Poly World Trade Centre.',
  },
  {
    kind: 'Restaurant',
    icon: UtensilsCrossed,
    name: 'Sadda Restaurant',
    nameZh: '萨德餐厅',
    address: 'Jinying Building 1F, 316 Huanshi Zhong Rd, Yuexiu',
    details: [['Area', 'Xiaobei'], ['Cuisine', 'Halal / Middle Eastern (Yemeni)'], ['Halal', 'Yes'], ['Hours', '10:00–22:00 daily']],
    note: 'Mandi and haneeth are the dishes reviewers name. Shisha at the entrance; one reviewer found the room chaotic.',
  },
  {
    kind: 'Service',
    icon: Truck,
    name: 'MCO KOKO Cargo',
    address: 'Guangzhou',
    details: [['Type', 'Cargo consolidator (air, Ethiopian)'], ['Hours', '15:00–23:00'], ['Contact', 'Manager on WhatsApp, reachable from Africa']],
    note: 'Opens at 3pm and works to 11pm, evening hours to match African time zones. Do not go in the morning.',
  },
]

const SLIDE_GAP = 16 // keep in sync with .carousel-track gap

export default function DirectoryCarousel() {
  const trackRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const reduceMotion = useReducedMotion()

  const goTo = (index: number) => {
    const track = trackRef.current
    if (!track) return
    const clamped = Math.max(0, Math.min(sampleEntries.length - 1, index))
    const width = (track.children[0] as HTMLElement | undefined)?.offsetWidth ?? 0
    track.scrollTo({ left: clamped * (width + SLIDE_GAP), behavior: reduceMotion ? 'auto' : 'smooth' })
  }

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const width = (track.children[0] as HTMLElement | undefined)?.offsetWidth || 1
        setActive(Math.round(track.scrollLeft / (width + SLIDE_GAP)))
      })
    }
    track.addEventListener('scroll', onScroll, { passive: true })
    return () => { track.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame) }
  }, [])

  return (
    <div className="directory-carousel" role="region" aria-roledescription="carousel" aria-label="Sample directory entries">
      <div className="carousel-head">
        <div className="carousel-tabs" role="group" aria-label="Jump to directory">
          {sampleEntries.map(({ kind, icon: Icon }, index) => (
            <button key={kind} type="button" aria-pressed={active === index} onClick={() => goTo(index)}><Icon size={13} aria-hidden="true" />{kind}</button>
          ))}
        </div>
        <div className="carousel-arrows">
          <button type="button" aria-label="Previous entry" onClick={() => goTo(active - 1)} disabled={active === 0}><ChevronLeft size={16} /></button>
          <button type="button" aria-label="Next entry" onClick={() => goTo(active + 1)} disabled={active === sampleEntries.length - 1}><ChevronRight size={16} /></button>
        </div>
      </div>
      <div className="carousel-track" ref={trackRef}>
        {sampleEntries.map((entry, index) => (
          <article className="directory-card carousel-slide" key={entry.name} role="group" aria-roledescription="slide" aria-label={`${index + 1} of ${sampleEntries.length}: ${entry.kind}`}>
            <div className="directory-card-bar">
              <span><SearchCheck size={14} /> FaySource · {entry.kind} directory</span>
              {entry.verified ? <span className="entry-status"><i /> Verified</span> : <span className="entry-kind"><entry.icon size={12} aria-hidden="true" /> {entry.kind}</span>}
            </div>
            <div className="directory-card-body">
              <h3>{entry.name}{entry.nameZh && <span lang="zh-CN">{entry.nameZh}</span>}</h3>
              {entry.addressZh && <p className="entry-zh" lang="zh-CN">{entry.addressZh}</p>}
              <p className="entry-en"><MapPin size={13} aria-hidden="true" /> {entry.address}</p>
              <dl>{entry.details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
              {entry.note && <p className="entry-note"><strong>Field note</strong>{entry.note}</p>}
            </div>
          </article>
        ))}
      </div>
      <div className="carousel-dots" aria-hidden="true">{sampleEntries.map(({ kind }, index) => <i key={kind} className={active === index ? 'is-active' : undefined} />)}</div>
    </div>
  )
}
