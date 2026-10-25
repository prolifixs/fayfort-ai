'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { CONSENT_EVENT, readConsent } from './consent'

// Meta Pixel and TikTok Pixel, loaded only after the visitor accepts marketing cookies. The IDs are set by the owner in
// Vercel (NEXT_PUBLIC_META_PIXEL_ID, NEXT_PUBLIC_TIKTOK_PIXEL_ID); a pixel with no ID stays off.
const META_ID = (process.env.NEXT_PUBLIC_META_PIXEL_ID || '').replace(/\D/g, '')
const TIKTOK_ID = (process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID || '').replace(/[^A-Z0-9]/gi, '')

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...a: unknown[]) => void; queue: unknown[]; loaded?: boolean; version?: string; push?: unknown }
type Ttq = unknown[] & { load?: (id: string) => void; page?: () => void; methods?: string[]; [key: string]: unknown }
declare global {
  interface Window {
    fbq?: Fbq
    _fbq?: Fbq
    ttq?: Ttq
    TiktokAnalyticsObject?: string
  }
}

function addScript(src: string) {
  const script = document.createElement('script')
  script.async = true
  script.src = src
  document.head.appendChild(script)
}

function loadMeta(id: string) {
  if (window.fbq) return
  const fbq = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args)
    else fbq.queue.push(args)
  } as Fbq
  fbq.queue = []
  fbq.loaded = true
  fbq.version = '2.0'
  fbq.push = fbq
  window.fbq = fbq
  window._fbq = fbq
  addScript('https://connect.facebook.net/en_US/fbevents.js')
  fbq('init', id)
}

function loadTikTok(id: string) {
  if (window.ttq) return
  // TikTok's standard loader: queue calls until events.js arrives.
  window.TiktokAnalyticsObject = 'ttq'
  const ttq = [] as unknown as Ttq
  ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie', 'holdConsent', 'revokeConsent', 'grantConsent']
  for (const method of ttq.methods) {
    ttq[method] = (...args: unknown[]) => {
      ;(ttq as unknown[]).push([method, ...args])
    }
  }
  ttq.load = (pixel: string) => {
    ;(ttq as unknown as Record<string, unknown>)._i = { [pixel]: [] }
    ;(ttq as unknown as Record<string, unknown>)._t = { [pixel]: Date.now() }
    addScript(`https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(pixel)}&lib=ttq`)
  }
  window.ttq = ttq
  ttq.load(id)
}

export default function MarketingPixels() {
  const pathname = usePathname()
  const [allowed, setAllowed] = useState(false)
  const lastPath = useRef<string | null>(null)
  useEffect(() => {
    const sync = () => setAllowed(Boolean(readConsent()?.marketing))
    sync()
    window.addEventListener(CONSENT_EVENT, sync)
    return () => window.removeEventListener(CONSENT_EVENT, sync)
  }, [])
  useEffect(() => {
    if (!allowed || (!META_ID && !TIKTOK_ID)) return
    if (META_ID) loadMeta(META_ID)
    if (TIKTOK_ID) loadTikTok(TIKTOK_ID)
    if (lastPath.current === pathname) return
    lastPath.current = pathname
    window.fbq?.('track', 'PageView')
    ;(window.ttq?.page as (() => void) | undefined)?.()
  }, [allowed, pathname])
  return null
}

/** Conversion events (Lead, CompleteRegistration …) for the pixels that are loaded; a no-op without consent. */
export function trackMarketing(event: 'Lead' | 'Subscribe' | 'ViewContent') {
  window.fbq?.('track', event)
  const ttq = window.ttq as unknown as { track?: (name: string) => void } | undefined
  ttq?.track?.(event === 'Lead' ? 'SubmitForm' : event === 'Subscribe' ? 'Subscribe' : 'ViewContent')
}
