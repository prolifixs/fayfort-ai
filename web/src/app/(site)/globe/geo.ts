// Small sphere maths for the globe: an orthographic view and great-circle arcs. No map library needed.

const RAD = Math.PI / 180

export type View = { lon: number; lat: number } // the point at the centre of the visible disc, in degrees
export type Projected = { x: number; y: number; depth: number; visible: boolean }

/**
 * Projects a point at `altitude` times the globe radius (1 = on the surface) onto the unit disc.
 * x/y are in -1…1 scaled by altitude (multiply by the radius in pixels); depth > 0 faces the viewer.
 * A raised point stays visible just past the edge, and is hidden only when the globe is in front of it.
 */
export function project(lon: number, lat: number, view: View, altitude = 1): Projected {
  const phi = lat * RAD
  const lambda = (lon - view.lon) * RAD
  const phi0 = view.lat * RAD
  const cosPhi = Math.cos(phi)
  const x = cosPhi * Math.sin(lambda) * altitude
  const y = (Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * cosPhi * Math.cos(lambda)) * altitude
  const depth = (Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * cosPhi * Math.cos(lambda)) * altitude
  const visible = depth > 0 || x * x + y * y > 1
  return { x, y, depth, visible }
}

function toVector(lon: number, lat: number): [number, number, number] {
  const phi = lat * RAD
  const lambda = lon * RAD
  return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)]
}

/** Points along the great circle from a to b; each gets an altitude that rises to `height` mid-way. */
export function greatCircle(
  from: { lon: number; lat: number },
  to: { lon: number; lat: number },
  samples: number,
  height: number,
): { lon: number; lat: number; altitude: number }[] {
  const a = toVector(from.lon, from.lat)
  const b = toVector(to.lon, to.lat)
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
  const omega = Math.acos(dot)
  const sinOmega = Math.sin(omega) || 1
  const points = []
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const wa = Math.sin((1 - t) * omega) / sinOmega
    const wb = Math.sin(t * omega) / sinOmega
    const v = [wa * a[0] + wb * b[0], wa * a[1] + wb * b[1], wa * a[2] + wb * b[2]]
    points.push({
      lon: Math.atan2(v[1], v[0]) / RAD,
      lat: Math.asin(Math.max(-1, Math.min(1, v[2]))) / RAD,
      altitude: 1 + height * Math.sin(Math.PI * t),
    })
  }
  return points
}
