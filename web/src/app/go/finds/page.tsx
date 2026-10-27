import type { Metadata } from 'next'
import { GO_LINKS, getFindsTeaser } from '../data'
import { GoHeader, GoPageHead } from '../GoParts'

export const revalidate = 300
export const metadata: Metadata = {
  title: 'FayFort Finds',
  description:
    'Trending products and rare finds for resellers: spotted early, checked in China and priced by quantity. New every Monday.',
  alternates: { canonical: '/go/finds' },
}

// Shown when the API is unreachable, so the page always explains the work behind each find.
const PROCESS = [
  { title: 'We scout every week', body: 'TikTok Shop sales data, social feeds, Amazon best-seller moves, what members ask for, and the wholesale markets of Guangzhou and Yiwu.' },
  { title: 'We check it in China', body: 'In person or with a supplier: the cost, the minimum order and the lead time. Most products don’t make it.' },
  { title: 'We price it for resellers', body: 'Our price per unit at each quantity, and on Pro the landed cost to your country and your margin.' },
  { title: 'We release it on Monday', body: 'A new drop every week. Pro members see it two days early.' },
]

function dayText(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Lagos' })
}

export default async function FindsPage() {
  const teaser = await getFindsTeaser()
  const steps = teaser.process.length ? teaser.process : PROCESS
  const stats = teaser.last_drop?.stats
  return (
    <>
      <GoHeader back />
      <GoPageHead
        kicker="FayFort Finds"
        title="Products worth selling, before everyone sells them"
        lede="Each week our team finds what’s starting to move and the rare things few people stock, checks that we can actually get them in China, and prices them for buying in quantity."
      />
      {stats && stats.made_it > 0 && (
        <section className="go-panel go-finds-effort" aria-label="Last drop">
          <h2>{teaser.last_drop!.title}</h2>
          <dl>
            <div>
              <dt>Products looked at</dt>
              <dd>{stats.scouted}</dd>
            </div>
            <div>
              <dt>Checked in China</dt>
              <dd>{stats.checked}</dd>
            </div>
            <div>
              <dt>Made it</dt>
              <dd>{stats.made_it}</dd>
            </div>
          </dl>
        </section>
      )}
      {teaser.items.length > 0 && (
        <>
          <h2 className="go-section-title">From earlier drops</h2>
          <div className="go-grid">
            {teaser.items.map((item) => (
              <a key={item.image_url} className="go-card" href={GO_LINKS.finds}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.image_url} alt="" loading="lazy" />
                <span>
                  <small>{item.lane === 'rare' ? 'Rare find' : 'Trending'}</small>
                  <strong>{item.name}</strong>
                </span>
              </a>
            ))}
          </div>
        </>
      )}
      <section className="go-panel" aria-labelledby="go-finds-how">
        <h2 id="go-finds-how">How we find them</h2>
        <ol className="go-steps">
          {steps.map((step) => (
            <li key={step.title}>
              <strong>{step.title}</strong>
              <span>{step.body}</span>
            </li>
          ))}
        </ol>
      </section>
      <section className="go-panel" aria-labelledby="go-finds-plans">
        <h2 id="go-finds-plans">What you get</h2>
        <dl className="go-prices">
          <div>
            <dt>Free</dt>
            <dd>
              Each drop a week later
              <small>three finds featured</small>
            </dd>
          </div>
          <div>
            <dt>Standard</dt>
            <dd>
              Every Monday
              <small>research and price per unit by quantity</small>
            </dd>
          </div>
          <div>
            <dt>Pro</dt>
            <dd>
              Two days early
              <small>plus landed cost to your country and margin</small>
            </dd>
          </div>
        </dl>
      </section>
      <a className="go-cta" href={GO_LINKS.finds}>
        See this week’s finds
      </a>
      <p className="go-cta-note">
        {teaser.next_release_at ? `Next drop: ${dayText(teaser.next_release_at)}. ` : ''}Opens the FayFort app. Join free, then pick a plan.
      </p>
    </>
  )
}
