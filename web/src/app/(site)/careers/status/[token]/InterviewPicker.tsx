'use client'

import { useMemo, useState } from 'react'

export type Interview = {
  id: string; status: 'proposed' | 'scheduled' | 'completed' | 'no_show' | 'cancelled'; minutes: number
  starts_at: string | null; ends_at: string | null; candidate_time_zone: string | null; call_link: string | null
  message: string | null; reschedule_count: number; can_change: boolean; slots: { starts_at: string; ends_at: string }[]
}

const CHINA = 'Asia/Shanghai'
export const localZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
}
const fmt = (iso: string, zone: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(undefined, { timeZone: zone, ...options }).format(new Date(iso))
export const dayKey = (iso: string, zone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
const cityOf = (zone: string) => zone.split('/').pop()?.replace(/_/g, ' ') || zone

/** Groups the offered times by day in the candidate's own time zone. */
export function groupSlots(slots: Interview['slots'], zone: string) {
  const days = new Map<string, Interview['slots']>()
  for (const slot of slots) {
    const key = dayKey(slot.starts_at, zone)
    days.set(key, [...(days.get(key) || []), slot])
  }
  return [...days.entries()].map(([key, items]) => ({ key, items }))
}

export default function InterviewPicker({ interview, busy, onPick, onChange }: {
  interview: Interview; busy: boolean; onPick: (startsAt: string, zone: string) => void; onChange: () => void
}) {
  const zone = useMemo(localZone, [])
  const days = useMemo(() => groupSlots(interview.slots, zone), [interview.slots, zone])
  const [day, setDay] = useState(days[0]?.key || '')
  const [time, setTime] = useState('')
  const sameZone = zone === CHINA
  const china = (iso: string) => fmt(iso, CHINA, { hour: 'numeric', minute: '2-digit' })

  if (interview.status === 'scheduled' && interview.starts_at) {
    return (
      <section className="status-card status-interview">
        <h2>Your interview is booked</h2>
        <p className="status-when">
          <strong>{fmt(interview.starts_at, zone, { weekday: 'long', day: 'numeric', month: 'long' })}</strong>
          <span>{fmt(interview.starts_at, zone, { hour: 'numeric', minute: '2-digit' })} your time ({cityOf(zone)})
            {!sameZone && <> · {china(interview.starts_at)} in Guangzhou</>}</span>
          <span>{interview.minutes} minutes on video</span>
        </p>
        {interview.call_link
          ? <a className="apply-button" href={interview.call_link} target="_blank" rel="noreferrer noopener">Join the video call</a>
          : <p>We&apos;ll email you the video link before it starts.</p>}
        {interview.can_change && (
          <button type="button" className="status-text-button" disabled={busy} onClick={onChange}>I can&apos;t make it: pick another time</button>
        )}
      </section>
    )
  }
  if (interview.status !== 'proposed') return null
  const current = days.find((d) => d.key === day) || days[0]
  return (
    <section className="status-card status-interview">
      <h2>Pick your interview time</h2>
      <p>{interview.minutes} minutes on video with the team. Times are in your time zone ({cityOf(zone)}){!sameZone && ', Guangzhou time in brackets'}.</p>
      {interview.message && <p className="status-message">{interview.message}</p>}
      {days.length === 0 ? (
        <p>There are no free times left. We&apos;ll email you new ones shortly.</p>
      ) : (
        <>
          <div className="status-days" role="group" aria-label="Day">
            {days.map((d) => (
              <button key={d.key} type="button" aria-pressed={current?.key === d.key} onClick={() => { setDay(d.key); setTime('') }}>
                <span>{fmt(d.items[0].starts_at, zone, { weekday: 'short' })}</span>
                <strong>{fmt(d.items[0].starts_at, zone, { day: 'numeric', month: 'short' })}</strong>
              </button>
            ))}
          </div>
          <div className="status-times" role="group" aria-label="Time">
            {current?.items.map((slot) => (
              <button key={slot.starts_at} type="button" aria-pressed={time === slot.starts_at} onClick={() => setTime(slot.starts_at)}>
                {fmt(slot.starts_at, zone, { hour: 'numeric', minute: '2-digit' })}
                {!sameZone && <small> ({china(slot.starts_at)})</small>}
              </button>
            ))}
          </div>
          <button type="button" className="apply-button" disabled={!time || busy} onClick={() => onPick(time, zone)}>
            {busy ? 'Booking…' : time ? `Confirm ${fmt(time, zone, { weekday: 'short', day: 'numeric', month: 'short' })}, ${fmt(time, zone, { hour: 'numeric', minute: '2-digit' })}` : 'Choose a time'}
          </button>
        </>
      )}
    </section>
  )
}
