'use client'

import { useState } from 'react'
import { BadgeCheck, Quote } from 'lucide-react'
import { SOURCE_LABEL, type SiteReview } from './reviews'

const FIRST = 6

function when(date: string | null) {
  if (!date) return null
  const value = new Date(`${date.slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(value.getTime()) ? null : value.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

/** The review cards: six first, the rest on "Show more". */
export default function ReviewWall({ reviews }: { reviews: SiteReview[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? reviews : reviews.slice(0, FIRST)
  return (
    <div className="review-wall-wrap">
      <ul className="review-wall">
        {shown.map((review) => (
          <li key={review.id} className={review.featured ? 'review-card is-featured' : 'review-card'}>
            <div className="review-card-top">
              {review.rating ? (
                <span className="review-stars" role="img" aria-label={`${review.rating} out of 5 stars`}>
                  {[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= (review.rating || 0) ? 'is-on' : ''}>★</i>)}
                </span>
              ) : <Quote size={20} aria-hidden="true" className="review-quote-mark" />}
              {review.verified_order
                ? <span className="review-badge"><BadgeCheck size={14} aria-hidden="true" /> Verified order</span>
                : <span className="review-source">via {SOURCE_LABEL[review.source]}</span>}
            </div>
            <blockquote>{review.body}</blockquote>
            <footer>
              <span className="review-avatar" aria-hidden="true">{(review.name || '?').replace('@', '').slice(0, 1).toUpperCase()}</span>
              <span className="review-who">
                <strong>{review.name}</strong>
                <small>{[review.country, review.product, when(review.date)].filter(Boolean).join(' · ')}</small>
              </span>
            </footer>
          </li>
        ))}
      </ul>
      {reviews.length > FIRST && (
        <button type="button" className="button button-ghost review-more" onClick={() => setAll((value) => !value)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show all ${reviews.length} reviews`}
        </button>
      )}
    </div>
  )
}
