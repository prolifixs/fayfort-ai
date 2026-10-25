// Cookie consent shared by fayfort.com and app.fayfort.com (owner request, 2026-10-25). The choice lives in one
// cookie on .fayfort.com so visitors answer once for both. Keep in step with dashboard/src/lib/consent.ts.
//
//   ff_consent   m1.t<ms>  marketing on (m1) or off (m0), and when it was chosen. Necessary cookies need no consent.
//   ff_member    1         set by app.fayfort.com when a member signs in: no visitor popups for members
//   ff_popup     1         a visitor popup was closed: none for 7 days
//   ff_visits    <n>       visits counted once per browser session (the newsletter popup shows from the 2nd)

export const CONSENT_COOKIE = 'ff_consent'
export const MEMBER_COOKIE = 'ff_member'
export const POPUP_COOKIE = 'ff_popup'
export const VISITS_COOKIE = 'ff_visits'
export const CONSENT_DAYS = 180
export const CONSENT_EVENT = 'ff-consent-change'
export const OPEN_SETTINGS_EVENT = 'ff-open-cookie-settings'
// Cookies set by the marketing pixels; removed when marketing is switched off.
const MARKETING_COOKIES = ['_fbp', '_fbc', '_ttp', 'ttcsid', '_tt_enable_cookie']

export type Consent = { marketing: boolean; at: number }

function domainPart(): string {
  if (typeof window === 'undefined') return ''
  const host = window.location.hostname
  return host === 'fayfort.com' || host.endsWith('.fayfort.com') ? '; domain=.fayfort.com' : ''
}

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const found = document.cookie.split('; ').find((part) => part.startsWith(`${name}=`))
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null
}

export function writeCookie(name: string, value: string, days: number) {
  if (typeof document === 'undefined') return
  const secure = window.location.protocol === 'https:' ? '; secure' : ''
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${Math.round(days * 86400)}; samesite=lax${domainPart()}${secure}`
}

export function deleteCookie(name: string) {
  if (typeof document === 'undefined') return
  for (const domain of [domainPart(), '']) document.cookie = `${name}=; path=/; max-age=0${domain}`
}

export function readConsent(): Consent | null {
  const raw = readCookie(CONSENT_COOKIE)
  const match = raw?.match(/^m([01])\.t(\d+)$/)
  if (!match) return null
  const at = Number(match[2])
  if (Date.now() - at > CONSENT_DAYS * 86400000) return null
  return { marketing: match[1] === '1', at }
}

export function saveConsent(marketing: boolean) {
  const before = readConsent()
  writeCookie(CONSENT_COOKIE, `m${marketing ? 1 : 0}.t${Date.now()}`, CONSENT_DAYS)
  if (!marketing) {
    for (const name of MARKETING_COOKIES) deleteCookie(name)
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: { marketing } }))
  // Pixels can't be unloaded from a running page: reload once so they're gone.
  if (before?.marketing && !marketing) window.location.reload()
}

export function openCookieSettings() {
  window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT))
}

export const isMember = () => readCookie(MEMBER_COOKIE) === '1'
