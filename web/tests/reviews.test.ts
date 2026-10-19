import { afterEach, describe, expect, it, vi } from 'vitest'
import { countryLine, getReviews, type SiteReview } from '../src/app/(site)/reviews/reviews'

const review = (extra: Partial<SiteReview>): SiteReview => ({
  id: 'r', source: 'member', rating: 5, body: 'Arrived as described.', name: 'Amaka O.', country: null, product: null,
  date: null, verified_order: true, featured: false, ...extra,
})

afterEach(() => vi.unstubAllGlobals())

describe('customer reviews feed', () => {
  it('names reviewer countries, most frequent first', () => {
    expect(countryLine([review({ country: 'Ghana' }), review({ country: 'Nigeria' }), review({ country: 'Nigeria' }), review({ country: 'UK' })]))
      .toBe('Nigeria, Ghana and UK')
    expect(countryLine([review({ country: 'Kenya' })])).toBe('Kenya')
    expect(countryLine([review({})])).toBe('')
  })

  it('drops reviews without words or a name, and survives a broken API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
      summary: { average: 4.5, rated_count: 2, total: 3 },
      reviews: [review({ id: 'a' }), review({ id: 'b', body: '  ' }), review({ id: 'c', name: null })],
    }) })))
    const feed = await getReviews()
    expect(feed.reviews.map((r) => r.id)).toEqual(['a'])
    expect(feed.summary.average).toBe(4.5)

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    expect((await getReviews()).reviews).toEqual([])
  })
})
