// Customer reviews published by staff in Control Center → Website (docs/PUBLIC_SITE_REBUILD_PLAN.md, "Customer reviews").

export type SiteReview = {
  id: string
  source: 'member' | 'instagram' | 'whatsapp' | 'facebook' | 'tiktok' | 'email' | 'google' | 'other'
  rating: number | null
  body: string
  name: string | null
  country: string | null
  product: string | null
  date: string | null
  verified_order: boolean
  featured: boolean
}
export type ReviewSummary = { average: number | null; rated_count: number; total: number; stars: Record<string, number> }
export type ReviewFeed = { summary: ReviewSummary; reviews: SiteReview[] }

const API = (process.env.FAYFORT_API_URL || 'https://api.fayfort.com').replace(/\/$/, '')
const EMPTY: ReviewFeed = { summary: { average: null, rated_count: 0, total: 0, stars: {} }, reviews: [] }

export const SOURCE_LABEL: Record<SiteReview['source'], string> = {
  member: 'FayFort dashboard', instagram: 'Instagram', whatsapp: 'WhatsApp', facebook: 'Facebook',
  tiktok: 'TikTok', email: 'Email', google: 'Google', other: 'Message',
}

/** Cached for 5 minutes. An unreachable API shows no reviews section, never an error. */
export async function getReviews(): Promise<ReviewFeed> {
  try {
    const response = await fetch(`${API}/public/site/reviews`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(4000) })
    if (!response.ok) return EMPTY
    const body = (await response.json()) as Partial<ReviewFeed>
    const reviews = (body.reviews || []).filter((review) => typeof review?.body === 'string' && review.body.trim() && review.name)
    return { summary: { ...EMPTY.summary, ...(body.summary || {}) }, reviews }
  } catch {
    return EMPTY
  }
}

/** "Nigeria, Ghana and the UK": the countries reviewers came from, most frequent first. */
export function countryLine(reviews: SiteReview[], limit = 4): string {
  const counts = new Map<string, number>()
  for (const review of reviews) if (review.country) counts.set(review.country, (counts.get(review.country) || 0) + 1)
  const names = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name).slice(0, limit)
  if (names.length < 2) return names[0] || ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
