import type { Metadata } from 'next'
import { GO_LINKS, getGoData } from '../data'
import { GoHeader, GoPageHead, RouteStrip } from '../GoParts'

export const revalidate = 300
export const metadata: Metadata = {
  title: 'Tour guide in China',
  description: 'A FayFort team member meets you in China: markets, factories, the Canton Fair, interpreting and airport pickup.',
  alternates: { canonical: '/go/tour-guide' },
}

export default async function TourGuidePage() {
  const { tour } = await getGoData()
  return (
    <>
      <GoHeader back />
      <GoPageHead
        kicker="Tour guide in China"
        title="Land in China with someone who knows the way"
        lede="A FayFort team member meets you, takes you to the right markets and factories, and speaks for you."
      />
      <RouteStrip to="You" toNote="Met on arrival" />
      <section className="go-panel" aria-labelledby="go-tour-where">
        <h2 id="go-tour-where">Where we guide</h2>
        <ul className="go-chips">
          {tour.cities.map((city) => (
            <li key={city}>{city}</li>
          ))}
          <li>Other cities on request</li>
        </ul>
        <h2>What we help with</h2>
        <ul className="go-chips">
          {tour.needs.map((need) => (
            <li key={need}>{need}</li>
          ))}
        </ul>
      </section>
      <section className="go-panel" aria-labelledby="go-tour-how">
        <h2 id="go-tour-how">How it works</h2>
        <ol className="go-steps">
          <li>
            <strong>Send your trip details</strong>
            <span>City, your arrival day picked on our guide calendar, how many days and how many people.</span>
          </li>
          <li>
            <strong>Get your quote</strong>
            <span>Every trip is different, so our team quotes yours in the chat and holds your dates while the quote is open.</span>
          </li>
          <li>
            <strong>Pay to confirm</strong>
            <span>Once it's paid we confirm the dates and tell you who your guide is.</span>
          </li>
        </ol>
      </section>
      <a className="go-cta" href={GO_LINKS.tour}>
        Request a guide
      </a>
      <p className="go-cta-note">Opens Tools in the FayFort app. Join free or sign in first.</p>
    </>
  )
}
