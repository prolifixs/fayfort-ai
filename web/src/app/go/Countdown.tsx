'use client'

import { useEffect, useState } from 'react'

/** "2d 4h left" for the giveaway; ticks every minute (every second in the last hour). */
export function Countdown({ endsAt }: { endsAt: string }) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(tick)
  }, [])
  const end = new Date(endsAt).getTime()
  if (now === null) return <span suppressHydrationWarning>Ends soon</span>
  const left = Math.max(0, end - now)
  if (!left) return <span>Closed</span>
  const days = Math.floor(left / 86_400_000)
  const hours = Math.floor((left % 86_400_000) / 3_600_000)
  const minutes = Math.floor((left % 3_600_000) / 60_000)
  const seconds = Math.floor((left % 60_000) / 1000)
  const text = days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m ${seconds}s`
  return <span>{text}</span>
}
