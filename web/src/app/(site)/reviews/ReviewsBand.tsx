import { BadgeCheck } from 'lucide-react'
import { JOIN_URL } from '@/config/contact'
import { revealDelay } from '../components'
import ReviewWall from './ReviewWall'
import { countryLine, getReviews } from './reviews'

/** "What customers say": reviews staff published in Control Center → Website. Hidden until there is at least one. */
export default async function ReviewsBand() {
  const { summary, reviews } = await getReviews()
  if (!reviews.length) return null
  const countries = countryLine(reviews)
  const average = summary.average
  return (
    <section className="reviews-band" aria-labelledby="reviews-title"><div className="shell section-space reviews-layout">
      <div className="reviews-intro" data-reveal>
        <p className="overline"><span /> What customers say</p>
        <h2 id="reviews-title">Real buyers, <em>in their own words.</em></h2>
        {average !== null && summary.rated_count > 0 ? (
          <div className="reviews-score" aria-label={`Rated ${average} out of 5 from ${summary.rated_count} ratings`}>
            <strong>{average.toFixed(1)}</strong>
            <div>
              <span className="review-stars-lg" aria-hidden="true">{[1, 2, 3, 4, 5].map((n) => <i key={n} style={{ ['--fill' as string]: `${Math.max(0, Math.min(1, average - n + 1)) * 100}%` }}>★</i>)}</span>
              <small>from {summary.rated_count} customer rating{summary.rated_count === 1 ? '' : 's'}</small>
            </div>
          </div>
        ) : null}
        <p className="section-lede">
          {summary.total} review{summary.total === 1 ? '' : 's'}{countries ? ` from buyers in ${countries}` : ''}. Every one comes from a real customer, from their FayFort dashboard or a message they sent us.
        </p>
        <p className="reviews-verified-note"><BadgeCheck size={16} aria-hidden="true" /> <span><b>Verified order</b> means the customer reviewed an order from their FayFort dashboard.</span></p>
        <a className="text-button" href={JOIN_URL} style={revealDelay(1)}>Start your first order <span aria-hidden="true">→</span></a>
      </div>
      <ReviewWall reviews={reviews} />
    </div></section>
  )
}
