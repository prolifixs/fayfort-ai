// Sample shipping routes for the home page globe (owner decision 4: illustrative, not live orders).

export type City = { id: string; name: string; lon: number; lat: number; quiet?: boolean } // quiet: no label (too close to another)
export type Route = { to: City; mode: 'sea' | 'air'; statuses: string[] }

export const ORIGIN: City = { id: 'gz', name: 'Guangzhou', lon: 113.26, lat: 23.13 }

const city = (id: string, name: string, lon: number, lat: number, quiet = false): City => ({ id, name, lon, lat, quiet })

export const ROUTES: Route[] = [
  { to: city('los', 'Lagos', 3.38, 6.52), mode: 'sea', statuses: ['Container in transit', 'Customs cleared', 'Delivered'] },
  { to: city('acc', 'Accra', -0.19, 5.6, true), mode: 'sea', statuses: ['Consolidated · 3 suppliers', 'Arrived at Tema port', 'Delivered'] },
  { to: city('lon', 'London', -0.13, 51.5), mode: 'air', statuses: ['Air freight · 2 days', 'Delivered'] },
  { to: city('jnb', 'Johannesburg', 28.05, -26.2), mode: 'sea', statuses: ['Inspection passed · 24 photos', 'Arrived at Durban', 'Delivered'] },
  { to: city('nbo', 'Nairobi', 36.82, -1.29), mode: 'air', statuses: ['Air freight', 'Delivered'] },
  { to: city('hre', 'Harare', 31.05, -17.83), mode: 'sea', statuses: ['On the road from Beira', 'Delivered'] },
  { to: city('nyc', 'New York', -74.0, 40.71), mode: 'air', statuses: ['Air freight · 3 days', 'Delivered'] },
]

/** Plain-language description for screen readers. */
export const GLOBE_DESCRIPTION =
  `A turning globe showing shipping routes from ${ORIGIN.name} to ${ROUTES.map((r) => r.to.name).join(', ')}.`
