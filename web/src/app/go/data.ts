// fayfort.com/go: the link-in-bio pages. Data from GET /public/site/go (app/site/go.py), cached 5 minutes.
// An unreachable API still renders every page: sections that need live data simply hide.
import { APP_URL, BROWSE_URL, CHAT_URL, REQUESTS_URL } from '@/config/contact'

export type GoPick = {
  name: string
  price: number | null
  price_max: number | null
  currency: string | null
  price_guide: boolean
  image_url: string
  category: string
  sourced: boolean
}
export type GoCategory = { key: string; label: string; count: number; image_url: string }
export type GoGiveaway = { title: string; prize_text: string | null; description: string; ends_at: string; entries: number; image_url: string | null }
export type GoData = {
  giveaway: GoGiveaway | null
  picks: GoPick[]
  categories: GoCategory[]
  product_count: number
  consultation: { currency: string; free: number; standard: number; pro_included: number; pro_after: number; pro?: number }
  tour: { cities: string[]; needs: string[] }
}

const API = (process.env.FAYFORT_API_URL || 'https://api.fayfort.com').replace(/\/$/, '')
const FALLBACK: GoData = {
  giveaway: null,
  picks: [],
  categories: [],
  product_count: 0,
  consultation: { currency: 'USD', free: 100, standard: 85, pro_included: 0, pro_after: 50, pro: 50 },
  tour: { cities: ['Guangzhou', 'Yiwu', 'Shenzhen', 'Shanghai'], needs: ['Canton Fair', 'Wholesale markets', 'Factory visits', 'Interpreting', 'Airport pickup'] },
}

// Photos must come from the hosts the site's Content-Security-Policy allows (next.config.js img-src).
const IMAGE_HOSTS = ['https://lirauxdhnknfiqjnulxb.supabase.co/', 'https://cdn.shopify.com/']
function allowedImage(url: string | null | undefined): url is string {
  return typeof url === 'string' && IMAGE_HOSTS.some((host) => url.startsWith(host))
}

export async function getGoData(): Promise<GoData> {
  try {
    const response = await fetch(`${API}/public/site/go`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(4000) })
    if (!response.ok) return FALLBACK
    const body = (await response.json()) as Partial<GoData>
    return {
      ...FALLBACK,
      ...body,
      picks: (body.picks || []).filter((p) => p?.name && allowedImage(p.image_url)),
      categories: (body.categories || []).filter((c) => c?.label && allowedImage(c.image_url)),
      giveaway: body.giveaway ? { ...body.giveaway, image_url: allowedImage(body.giveaway.image_url) ? body.giveaway.image_url : null } : null,
      consultation: { ...FALLBACK.consultation, ...(body.consultation || {}) },
      tour: { ...FALLBACK.tour, ...(body.tour || {}) },
    }
  } catch {
    return FALLBACK
  }
}

// Where each /go page sends people in the member app. Signed-out visitors sign in or join first, then land here.
export const GO_LINKS = {
  giveaway: CHAT_URL,
  shop: BROWSE_URL,
  shopCategory: (key: string) => `${BROWSE_URL}&top=${encodeURIComponent(key)}`,
  consultation: `${APP_URL}/member/chat?panel=tools&tool=consultation`,
  tour: `${APP_URL}/member/chat?panel=tools&tool=tour`,
  request: REQUESTS_URL,
  chat: CHAT_URL,
}

export function money(value: number | null, currency: string | null) {
  if (value === null || value === undefined) return ''
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: value % 1 ? 2 : 0 }).format(value)
  } catch {
    return `${currency || 'USD'} ${value}`
  }
}

export function priceLine(pick: GoPick) {
  if (pick.price === null) return 'Ask for a price'
  return pick.price_guide ? `From ${money(pick.price, pick.currency)}` : money(pick.price, pick.currency)
}
