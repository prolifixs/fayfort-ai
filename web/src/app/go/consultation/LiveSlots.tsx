'use client'

// The next free consultation times, live from GET /public/bookings/slots (times only, no names), in the visitor's
// own time zone. "Book this time" opens the app with the time chosen; it survives joining or signing in.
import { useEffect, useMemo, useState } from 'react'

type Slot = { starts_at: string }
type Body = { available: boolean; minutes: number; cancel_cutoff_hours: number; slots: Slot[] }

const API = (process.env.NEXT_PUBLIC_FAYFORT_API_URL || 'https://api.fayfort.com').replace(/\/$/, '')

function zoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function LiveSlots({ bookUrl }: { bookUrl: string }) {
  const [body, setBody] = useState<Body | null>(null)
  const [failed, setFailed] = useState(false)
  const [day, setDay] = useState<string | null>(null)
  const zone = useMemo(zoneName, [])

  useEffect(() => {
    let alive = true
    fetch(`${API}/public/bookings/slots`, { signal: AbortSignal.timeout(6000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((found: Body) => alive && setBody(found))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [])

  const days = useMemo(() => {
    const groups = new Map<string, Slot[]>()
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
    for (const slot of body?.slots || []) {
      const k = key.format(new Date(slot.starts_at))
      groups.set(k, [...(groups.get(k) || []), slot])
    }
    return groups
  }, [body, zone])

  if (failed || (body && (!body.available || body.slots.length === 0))) return null
  if (!body) return <p className="go-slots-loading">Loading free times…</p>

  const keys = [...days.keys()].slice(0, 7)
  const shown = day && days.has(day) ? day : keys[0]
  const dayName = (k: string) =>
    new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${k}T12:00:00Z`))
  const time = (iso: string) => new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

  return (
    <section className="go-panel go-slots" aria-labelledby="go-slots-title">
      <h2 id="go-slots-title">Next free times</h2>
      <p>
        {body.minutes}-minute video call. Times in your time zone ({zone.replace(/_/g, ' ')}). Free to move or cancel up to{' '}
        {body.cancel_cutoff_hours} hours before.
      </p>
      <div className="go-slot-days" role="tablist" aria-label="Day">
        {keys.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={k === shown} className={k === shown ? 'is-on' : undefined} onClick={() => setDay(k)}>
            {dayName(k)}
          </button>
        ))}
      </div>
      <div className="go-slot-times">
        {(days.get(shown) || []).slice(0, 12).map((slot) => (
          <a key={slot.starts_at} href={`${bookUrl}&slot=${encodeURIComponent(slot.starts_at)}`}>
            {time(slot.starts_at)}
          </a>
        ))}
      </div>
      <p className="go-slots-note">Pick a time to book it. A free FayFort account is needed for the payment and chat.</p>
    </section>
  )
}
