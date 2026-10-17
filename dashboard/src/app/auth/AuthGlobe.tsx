import { useEffect, useRef } from "react";

/**
 * Navy globe behind every sign-in screen (docs/AUTH_PAGES_PLAN.md): dotted land, sample routes from Guangzhou and
 * parcels moving along them. It turns slowly and ignores the pointer, pauses in background tabs and shows a still
 * picture with "reduce motion". The land dots load after the card, so sign-in is never slower.
 */

const RAD = Math.PI / 180;
const ORIGIN = { lon: 113.26, lat: 23.13 };
const CITIES: [number, number, "sea" | "air"][] = [
  [3.38, 6.52, "sea"],
  [-0.19, 5.6, "sea"],
  [-0.13, 51.5, "air"],
  [28.05, -26.2, "sea"],
  [36.82, -1.29, "air"],
  [31.05, -17.83, "sea"],
  [-74, 40.71, "air"],
];
const SAMPLES = 72;
type View = { lon: number; lat: number };
type Point = { lon: number; lat: number; alt: number };

function project(lon: number, lat: number, view: View, alt = 1) {
  const phi = lat * RAD;
  const lambda = (lon - view.lon) * RAD;
  const phi0 = view.lat * RAD;
  const cosPhi = Math.cos(phi);
  const x = cosPhi * Math.sin(lambda) * alt;
  const y = (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * cosPhi * Math.cos(lambda)) * alt;
  const depth = (Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * cosPhi * Math.cos(lambda)) * alt;
  return { x, y, depth, visible: depth > 0 || x * x + y * y > 1 };
}

function vector(lon: number, lat: number): [number, number, number] {
  const phi = lat * RAD;
  const lambda = lon * RAD;
  return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
}

export function greatCircle(from: { lon: number; lat: number }, to: { lon: number; lat: number }, height: number): Point[] {
  const a = vector(from.lon, from.lat);
  const b = vector(to.lon, to.lat);
  const omega = Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  const sinOmega = Math.sin(omega) || 1;
  const points: Point[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const wa = Math.sin((1 - t) * omega) / sinOmega;
    const wb = Math.sin(t * omega) / sinOmega;
    const v = [wa * a[0] + wb * b[0], wa * a[1] + wb * b[1], wa * a[2] + wb * b[2]];
    points.push({ lon: Math.atan2(v[1], v[0]) / RAD, lat: Math.asin(Math.max(-1, Math.min(1, v[2]))) / RAD, alt: 1 + height * Math.sin(Math.PI * t) });
  }
  return points;
}

export function AuthGlobe() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tracks = CITIES.map(([lon, lat, mode], index) => ({
      points: greatCircle(ORIGIN, { lon, lat }, mode === "air" ? 0.16 : 0.07),
      to: { lon, lat },
      period: mode === "air" ? 5200 : 7800,
      offset: index * 1300,
    }));
    const view: View = { lon: 40, lat: 12 };
    let dots: number[] = [];
    let width = 0;
    let height = 0;
    let radius = 0;
    let cx = 0;
    let cy = 0;
    let dpr = 1;
    let frame = 0;
    let last = performance.now();
    let alive = true;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      const phone = width < 700;
      radius = phone ? Math.min(width * 0.62, height * 0.36) : Math.max(height * 0.62, width * 0.32);
      cx = phone ? width * 0.5 : width * 0.68;
      cy = phone ? height * 0.3 : height * 0.55;
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      draw(performance.now());
    }
    const screen = (p: { x: number; y: number }) => ({ x: cx + p.x * radius, y: cy - p.y * radius });

    function arc(points: Point[], from: number, to: number, stroke: string, lineWidth: number) {
      ctx!.beginPath();
      let drawing = false;
      for (let i = Math.max(0, Math.floor(from)); i <= Math.min(SAMPLES, Math.ceil(to)); i++) {
        const q = points[i];
        const p = project(q.lon, q.lat, view, q.alt);
        if (!p.visible) {
          drawing = false;
          continue;
        }
        const s = screen(p);
        if (drawing) ctx!.lineTo(s.x, s.y);
        else ctx!.moveTo(s.x, s.y);
        drawing = true;
      }
      ctx!.strokeStyle = stroke;
      ctx!.lineWidth = lineWidth;
      ctx!.stroke();
    }

    function draw(now: number) {
      const c = ctx!;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, width, height);
      const sphere = c.createRadialGradient(cx - radius * 0.35, cy - radius * 0.4, radius * 0.1, cx, cy, radius);
      sphere.addColorStop(0, "rgba(255,255,255,0.06)");
      sphere.addColorStop(1, "rgba(255,255,255,0.01)");
      c.beginPath();
      c.arc(cx, cy, radius, 0, Math.PI * 2);
      c.fillStyle = sphere;
      c.fill();
      c.strokeStyle = "rgba(255,255,255,0.10)";
      c.lineWidth = 1;
      c.stroke();
      const size = Math.max(1.5, radius / 170);
      for (let i = 0; i < dots.length; i += 2) {
        const p = project(dots[i], dots[i + 1], view);
        if (p.depth <= 0) continue;
        const s = screen(p);
        c.fillStyle = `rgba(195,202,227,${(0.12 + 0.5 * p.depth).toFixed(2)})`;
        c.fillRect(s.x - size / 2, s.y - size / 2, size, size);
      }
      c.lineCap = "round";
      for (const track of tracks) {
        arc(track.points, 0, SAMPLES, "rgba(157,184,255,0.28)", 1.2);
        if (reduceMotion) continue;
        const phase = ((now + track.offset) % track.period) / track.period;
        if (phase >= 0.72) continue;
        const t = phase / 0.72;
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const head = eased * SAMPLES;
        arc(track.points, Math.max(0, head - 16), head, "rgba(255,255,255,0.9)", 2);
        const i = Math.min(SAMPLES - 1, Math.floor(head));
        const k = head - i;
        const a = track.points[i];
        const b = track.points[i + 1];
        const p = project(a.lon + (b.lon - a.lon) * k, a.lat + (b.lat - a.lat) * k, view, a.alt + (b.alt - a.alt) * k);
        if (!p.visible) continue;
        const s = screen(p);
        c.beginPath();
        c.arc(s.x, s.y, 3.4, 0, Math.PI * 2);
        c.fillStyle = "rgb(255,140,198)";
        c.shadowColor = "rgba(255,140,198,0.8)";
        c.shadowBlur = 12;
        c.fill();
        c.shadowBlur = 0;
      }
      for (const m of [ORIGIN, ...tracks.map((track) => track.to)]) {
        const p = project(m.lon, m.lat, view);
        if (p.depth <= 0) continue;
        const s = screen(p);
        c.beginPath();
        c.arc(s.x, s.y, m === ORIGIN ? 4.5 : 3, 0, Math.PI * 2);
        c.fillStyle = m === ORIGIN ? "#f20789" : "rgb(157,184,255)";
        c.fill();
      }
    }

    function tick(now: number) {
      view.lon += (now - last) * 0.004;
      last = now;
      draw(now);
      if (alive && !document.hidden) frame = requestAnimationFrame(tick);
    }
    function start() {
      if (reduceMotion || document.hidden) return;
      cancelAnimationFrame(frame);
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }
    const onVisibility = () => (document.hidden ? cancelAnimationFrame(frame) : start());

    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    resize();
    // The land loads after the card has painted.
    void import("./land-dots.json").then((module) => {
      if (!alive) return;
      dots = (module.default as number[]) || [];
      draw(performance.now());
      start();
    });
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className="auth-globe-canvas" aria-hidden="true" />;
}
