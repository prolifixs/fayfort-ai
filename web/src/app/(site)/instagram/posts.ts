// Instagram posts and reels chosen by staff in Control Center → Website (owner decision 7).

export type InstagramPost = { id: string; kind: 'p' | 'reel'; shortcode: string; label: string | null }

const API = (process.env.FAYFORT_API_URL || 'https://api.fayfort.com').replace(/\/$/, '')

/** Reads the curated posts from the API. Cached for 10 minutes; an unreachable API shows no rail, never an error. */
export async function getInstagramPosts(): Promise<InstagramPost[]> {
  try {
    const response = await fetch(`${API}/public/site/instagram`, {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(4000),
    })
    if (!response.ok) return []
    const body = (await response.json()) as { posts?: InstagramPost[] }
    return (body.posts || []).filter((post) => /^[A-Za-z0-9_-]{5,40}$/.test(post.shortcode) && ['p', 'reel'].includes(post.kind))
  } catch {
    return []
  }
}

export const embedUrl = (post: Pick<InstagramPost, 'kind' | 'shortcode'>) =>
  `https://www.instagram.com/${post.kind}/${post.shortcode}/embed/`
export const postUrl = (post: Pick<InstagramPost, 'kind' | 'shortcode'>) =>
  `https://www.instagram.com/${post.kind}/${post.shortcode}/`
