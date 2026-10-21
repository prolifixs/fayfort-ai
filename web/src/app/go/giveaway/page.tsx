import type { Metadata } from 'next'
import { FAYFORT_INSTAGRAM } from '@/config/contact'
import { Countdown } from '../Countdown'
import { GO_LINKS, getGoData } from '../data'
import { GoHeader, GoPageHead } from '../GoParts'

export const revalidate = 300
export const metadata: Metadata = {
  title: 'Giveaway',
  description: 'Enter the FayFort giveaway for free with your FayFort account.',
  alternates: { canonical: '/go/giveaway' },
}

export default async function GiveawayPage() {
  const { giveaway } = await getGoData()
  return (
    <>
      <GoHeader back />
      {giveaway ? (
        <>
          <GoPageHead kicker="Live giveaway" title={giveaway.title} lede="Free to enter with your FayFort account. Winners are drawn when the timer ends and told in the app." />
          <article className="go-prize">
            {giveaway.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={giveaway.image_url} alt={giveaway.prize_text || giveaway.title} />
            )}
            <div className="go-prize-body">
              <h2>{giveaway.prize_text ? `Win ${giveaway.prize_text}` : giveaway.title}</h2>
              {giveaway.description && <p>{giveaway.description}</p>}
              <div className="go-prize-facts">
                <span>
                  <small>Ends in</small>
                  <b>
                    <Countdown endsAt={giveaway.ends_at} />
                  </b>
                </span>
                <span>
                  <small>Entries so far</small>
                  <b>{giveaway.entries.toLocaleString('en-US')}</b>
                </span>
              </div>
            </div>
          </article>
          <a className="go-cta" href={GO_LINKS.giveaway}>
            Enter the giveaway
          </a>
          <p className="go-cta-note">Opens the FayFort app. Join free or sign in, then tap Enter.</p>
        </>
      ) : (
        <>
          <GoPageHead kicker="Giveaway" title="No giveaway is running right now" lede="We run them often. Follow us on Instagram to hear about the next one first." />
          <a className="go-cta" href={`https://instagram.com/${FAYFORT_INSTAGRAM}`} target="_blank" rel="noreferrer">
            Follow @{FAYFORT_INSTAGRAM}
          </a>
          <a className="go-cta is-quiet" href="/go/shop">
            Shop products instead
          </a>
        </>
      )}
    </>
  )
}
