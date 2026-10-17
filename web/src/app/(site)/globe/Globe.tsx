'use client'

import { useEffect, useRef, useState } from 'react'
import landDots from './land-dots.json'
import { greatCircle, project, type View } from './geo'
import { GLOBE_DESCRIPTION, ORIGIN, ROUTES, type City } from './routes'

/**
 * Home page globe (docs/PUBLIC_SITE_REBUILD_PLAN.md section 5): dotted land, sample shipping routes from Guangzhou,
 * parcels moving along them and a small card when one lands. Canvas 2D, no map library. Pauses off screen and in
 * background tabs; with "reduce motion" it draws one still frame.
 */

const DOTS = landDots as number[]
const SAMPLES = 72
const TRAVEL = 0.72 // share of each cycle spent travelling; the rest is a pause before the next parcel
const NAVY = '2, 20, 78'
const BLUE = '5, 64, 242'
const PINK = '242, 7, 137'

type Track = {
  route: (typeof ROUTES)[number]
  points: ReturnType<typeof greatCircle>
  period: number
  offset: number
  cycle: number
  status: number
}

type Card = { city: City; text: string; mode: string; until: number }

function makeTracks(): Track[] {
  return ROUTES.map((route, index) => ({
    route,
    points: greatCircle(ORIGIN, route.to, SAMPLES, route.mode === 'air' ? 0.16 : 0.07),
    period: route.mode === 'air' ? 5200 : 7800,
    offset: index * 1300,
    cycle: -1,
    status: 0,
  }))
}

export default function Globe({ className }: { className?: string }) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [card, setCard] = useState<Card | null>(null)
  const [ready, setReady] = useState(false)
  const cardState = useRef<Card | null>(null)
  cardState.current = card

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const tracks = makeTracks()
    const view: View = { lon: 52, lat: 14 }
    let size = 0
    let dpr = 1
    let radius = 0
    let running = false
    let onScreen = true
    let frame = 0
    let last = performance.now()
    let spin = 5 // degrees per second
    let dragging: { x: number; y: number; lon: number; lat: number; t: number } | null = null
    let velocity = 0
    let resumeAt = 0
    let hovered: City | null = null
    let pulses: { city: City; start: number }[] = []
    let compact = false

    function resize() {
      const rect = wrap!.getBoundingClientRect()
      size = Math.max(160, Math.min(rect.width, rect.height || rect.width))
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas!.width = Math.round(size * dpr)
      canvas!.height = Math.round(size * dpr)
      canvas!.style.width = `${size}px`
      canvas!.style.height = `${size}px`
      radius = (size / 2) * 0.8
      compact = size < 360
      draw(performance.now())
    }

    const toScreen = (p: { x: number; y: number }) => ({ x: size / 2 + p.x * radius, y: size / 2 - p.y * radius })

    function drawArc(points: Track['points'], from: number, to: number, stroke: string, width: number) {
      ctx!.beginPath()
      let drawing = false
      for (let i = Math.max(0, Math.floor(from)); i <= Math.min(SAMPLES, Math.ceil(to)); i++) {
        const point = points[i]
        const p = project(point.lon, point.lat, view, point.altitude)
        if (!p.visible) {
          drawing = false
          continue
        }
        const s = toScreen(p)
        if (drawing) ctx!.lineTo(s.x, s.y)
        else ctx!.moveTo(s.x, s.y)
        drawing = true
      }
      ctx!.strokeStyle = stroke
      ctx!.lineWidth = width
      ctx!.stroke()
    }

    function pointAt(points: Track['points'], t: number) {
      const f = t * SAMPLES
      const i = Math.min(SAMPLES - 1, Math.floor(f))
      const k = f - i
      const a = points[i]
      const b = points[i + 1]
      return { lon: a.lon + (b.lon - a.lon) * k, lat: a.lat + (b.lat - a.lat) * k, altitude: a.altitude + (b.altitude - a.altitude) * k }
    }

    function draw(now: number) {
      const c = ctx!
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
      c.clearRect(0, 0, size, size)
      const cx = size / 2
      const cy = size / 2

      // Halo and sphere.
      const halo = c.createRadialGradient(cx, cy, radius * 0.9, cx, cy, radius * 1.22)
      halo.addColorStop(0, `rgba(${BLUE}, 0.10)`)
      halo.addColorStop(1, `rgba(${BLUE}, 0)`)
      c.fillStyle = halo
      c.fillRect(0, 0, size, size)
      const sphere = c.createRadialGradient(cx - radius * 0.35, cy - radius * 0.4, radius * 0.1, cx, cy, radius)
      sphere.addColorStop(0, '#ffffff')
      sphere.addColorStop(1, '#e4e8f4')
      c.beginPath()
      c.arc(cx, cy, radius, 0, Math.PI * 2)
      c.fillStyle = sphere
      c.fill()
      c.strokeStyle = `rgba(${NAVY}, 0.12)`
      c.lineWidth = 1
      c.stroke()

      // Land, as dots that fade towards the edge.
      const dot = Math.max(1.5, radius / 165)
      const buckets: number[][] = [[], [], [], []]
      for (let i = 0; i < DOTS.length; i += 2) {
        const p = project(DOTS[i], DOTS[i + 1], view)
        if (p.depth <= 0) continue
        const b = p.depth > 0.75 ? 3 : p.depth > 0.5 ? 2 : p.depth > 0.25 ? 1 : 0
        buckets[b].push(cx + p.x * radius, cy - p.y * radius)
      }
      const alphas = [0.2, 0.38, 0.56, 0.74]
      buckets.forEach((list, b) => {
        c.fillStyle = `rgba(${NAVY}, ${alphas[b]})`
        const s = dot * (0.75 + b * 0.1)
        for (let i = 0; i < list.length; i += 2) c.fillRect(list[i] - s / 2, list[i + 1] - s / 2, s, s)
      })

      // Routes, parcels and arrivals.
      c.lineCap = 'round'
      for (const track of tracks) {
        const route = track.route
        if (compact && route.to.id === 'nyc') continue // fewer routes on small screens
        drawArc(track.points, 0, SAMPLES, `rgba(${BLUE}, ${route.mode === 'air' ? 0.22 : 0.3})`, route.mode === 'air' ? 1 : 1.4)
        if (reduceMotion) {
          drawArc(track.points, 0, SAMPLES, `rgba(${BLUE}, 0.55)`, 1.6)
          continue
        }
        const elapsed = now + track.offset
        const cycle = Math.floor(elapsed / track.period)
        const phase = (elapsed % track.period) / track.period
        if (phase < TRAVEL) {
          const t = phase / TRAVEL
          const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
          const head = eased * SAMPLES
          const tail = Math.max(0, head - SAMPLES * 0.22)
          drawArc(track.points, tail, head, `rgba(${BLUE}, 0.85)`, 2)
          const pos = pointAt(track.points, eased)
          const p = project(pos.lon, pos.lat, view, pos.altitude)
          if (p.visible) {
            const s = toScreen(p)
            c.beginPath()
            c.arc(s.x, s.y, 3.2, 0, Math.PI * 2)
            c.fillStyle = `rgb(${PINK})`
            c.shadowColor = `rgba(${PINK}, 0.7)`
            c.shadowBlur = 10
            c.fill()
            c.shadowBlur = 0
          }
        } else if (track.cycle !== cycle) {
          track.cycle = cycle
          pulses.push({ city: route.to, start: now })
          const text = route.statuses[track.status % route.statuses.length]
          track.status += 1
          if (!hovered && project(route.to.lon, route.to.lat, view).visible) {
            setCard({ city: route.to, text, mode: route.mode === 'air' ? 'Air' : 'Sea', until: now + 2600 })
          }
        }
      }

      // City markers, pulses and the origin.
      pulses = pulses.filter((pulse) => now - pulse.start < 1400)
      const markers: City[] = [ORIGIN, ...ROUTES.map((r) => r.to)]
      c.font = `600 ${compact ? 10 : 11}px Inter, ui-sans-serif, system-ui, sans-serif`
      for (const m of markers) {
        const p = project(m.lon, m.lat, view)
        if (p.depth <= 0.02) continue
        const s = toScreen(p)
        const origin = m.id === ORIGIN.id
        c.beginPath()
        c.arc(s.x, s.y, origin ? 4.5 : 3, 0, Math.PI * 2)
        c.fillStyle = origin ? `rgb(${PINK})` : `rgb(${BLUE})`
        c.fill()
        if (origin && !reduceMotion) {
          const k = (now % 2200) / 2200
          c.beginPath()
          c.arc(s.x, s.y, 4.5 + k * 14, 0, Math.PI * 2)
          c.strokeStyle = `rgba(${PINK}, ${0.5 * (1 - k)})`
          c.lineWidth = 1.5
          c.stroke()
        }
        for (const pulse of pulses) {
          if (pulse.city.id !== m.id) continue
          const k = (now - pulse.start) / 1400
          c.beginPath()
          c.arc(s.x, s.y, 3 + k * 16, 0, Math.PI * 2)
          c.strokeStyle = `rgba(${BLUE}, ${0.6 * (1 - k)})`
          c.lineWidth = 1.5
          c.stroke()
        }
        if ((!compact || origin) && !m.quiet) {
          c.fillStyle = `rgba(${NAVY}, ${Math.min(0.85, 0.35 + p.depth)})`
          c.fillText(m.name, s.x + 7, s.y - 6)
        }
      }

      // Keep the card pinned to its city.
      const active = hovered ? { city: hovered } : cardState.current
      const el = cardRef.current
      if (el && active) {
        const p = project(active.city.lon, active.city.lat, view)
        if (p.depth > 0.05) {
          const s = toScreen(p)
          el.style.opacity = '1'
          el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px)`
        } else {
          el.style.opacity = '0'
        }
      }
      if (!hovered && cardState.current && now > cardState.current.until) setCard(null)
    }

    function tick(now: number) {
      const dt = Math.min(64, now - last)
      last = now
      if (!dragging) {
        if (Math.abs(velocity) > 0.01) {
          view.lon += velocity * dt
          velocity *= 0.94
        } else if (!hovered && now > resumeAt) {
          view.lon += (spin * dt) / 1000
        }
      }
      draw(now)
      if (running) frame = requestAnimationFrame(tick)
    }

    function start() {
      if (running || reduceMotion || !onScreen || document.hidden) return
      running = true
      last = performance.now()
      frame = requestAnimationFrame(tick)
    }
    function stop() {
      running = false
      cancelAnimationFrame(frame)
    }

    function nearestCity(clientX: number, clientY: number): City | null {
      const rect = canvas!.getBoundingClientRect()
      const x = clientX - rect.left
      const y = clientY - rect.top
      let best: City | null = null
      let bestDistance = 18
      for (const m of ROUTES.map((r) => r.to).concat(ORIGIN)) {
        const p = project(m.lon, m.lat, view)
        if (p.depth <= 0.05) continue
        const s = toScreen(p)
        const d = Math.hypot(s.x - x, s.y - y)
        if (d < bestDistance) {
          best = m
          bestDistance = d
        }
      }
      return best
    }

    function onPointerDown(event: PointerEvent) {
      dragging = { x: event.clientX, y: event.clientY, lon: view.lon, lat: view.lat, t: performance.now() }
      velocity = 0
      canvas!.setPointerCapture(event.pointerId)
    }
    function onPointerMove(event: PointerEvent) {
      if (dragging) {
        const scale = 90 / radius
        const lon = dragging.lon - (event.clientX - dragging.x) * scale
        const now = performance.now()
        velocity = (lon - view.lon) / Math.max(1, now - dragging.t) // degrees per ms
        dragging.t = now
        view.lon = lon
        view.lat = Math.max(-20, Math.min(45, dragging.lat + (event.clientY - dragging.y) * scale))
        if (reduceMotion) draw(now)
        return
      }
      if (event.pointerType === 'mouse') {
        const city = nearestCity(event.clientX, event.clientY)
        if (city?.id !== hovered?.id) {
          hovered = city
          canvas!.style.cursor = city ? 'pointer' : 'grab'
          if (city) {
            const route = ROUTES.find((r) => r.to.id === city.id)
            setCard({
              city,
              text: route ? route.statuses[0] : 'Sourcing and inspection',
              mode: route ? (route.mode === 'air' ? 'Air' : 'Sea') : 'Origin',
              until: Number.POSITIVE_INFINITY,
            })
          } else {
            setCard(null)
          }
          if (reduceMotion) draw(performance.now())
        }
      }
    }
    function onPointerUp(event: PointerEvent) {
      if (!dragging) return
      dragging = null
      resumeAt = performance.now() + 1800
      canvas!.releasePointerCapture(event.pointerId)
    }
    function onPointerLeave() {
      if (hovered) {
        hovered = null
        setCard(null)
      }
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('pointerleave', onPointerLeave)

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(wrap)
    const visibility = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting
      if (onScreen) start()
      else stop()
    })
    visibility.observe(wrap)
    const onVisibility = () => (document.hidden ? stop() : start())
    document.addEventListener('visibilitychange', onVisibility)

    resize()
    setReady(true)
    start()
    return () => {
      stop()
      resizeObserver.disconnect()
      visibility.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      spin = 0
    }
  }, [])

  return (
    <div ref={wrapRef} className={['globe', ready ? 'is-ready' : '', className].filter(Boolean).join(' ')} role="img" aria-label={GLOBE_DESCRIPTION}>
      <canvas ref={canvasRef} className="globe-canvas" aria-hidden="true" />
      <div ref={cardRef} className={card ? 'globe-card is-shown' : 'globe-card'} aria-hidden="true">
        {card && (
          <>
            <small>{card.mode === 'Origin' ? `Our warehouse · ${ORIGIN.name}` : `${card.mode} · ${ORIGIN.name} → ${card.city.name}`}</small>
            <strong>{card.text}</strong>
          </>
        )}
      </div>
    </div>
  )
}
