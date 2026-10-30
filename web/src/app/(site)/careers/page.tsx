import type { Metadata } from 'next'
import Link from 'next/link'
import { revealDelay } from '../components'
import { getJobs, HIRING_STEPS } from './careers'
import './careers.css'

export const metadata: Metadata = {
  title: 'Careers | FAYFORT International Trading',
  description: 'Join the FayFort team in Guangzhou or remotely: sourcing, member support, fulfillment and more.',
  alternates: { canonical: '/careers' },
}
export const revalidate = 120

export default async function CareersPage() {
  const jobs = await getJobs()
  return (
    <>
      <section className="careers-hero"><div className="shell">
        <p className="overline is-visible" data-reveal><span /> Careers</p>
        <h1 className="is-visible" data-reveal style={revealDelay(1)}>Build FayFort with us</h1>
        <p className="careers-lede is-visible" data-reveal style={revealDelay(2)}>
          We find, check and ship products from China for buyers around the world. Our team works from Guangzhou, and some roles are remote.
        </p>
        <a className="button button-primary is-visible" data-reveal style={revealDelay(3)} href="#roles">See open roles <span aria-hidden="true">↓</span></a>
      </div></section>

      <section className="shell careers-roles" id="roles" aria-labelledby="roles-title">
        <div className="careers-roles-head">
          <h2 id="roles-title">Open roles</h2>
          <span>{jobs.length === 1 ? '1 role' : `${jobs.length} roles`}</span>
        </div>
        {jobs.length === 0 ? (
          <div className="careers-empty">
            <h3>No open roles right now</h3>
            <p>New roles appear here first. Follow us on Instagram or join the newsletter below to hear when we&apos;re hiring.</p>
          </div>
        ) : (
          <ul className="careers-list">
            {jobs.map((job, index) => (
              <li key={job.id} data-reveal style={revealDelay(index)}>
                <Link href={`/careers/${job.slug}`} className="careers-card">
                  <span className="careers-card-desk">{job.department_label}</span>
                  <strong>{job.title}</strong>
                  <span className="careers-tags">
                    <span>{job.job_type_label}</span><span>{job.location_label}</span>{job.pay_range && <span>{job.pay_range}</span>}
                  </span>
                  <span className="careers-card-cta">Apply <span aria-hidden="true">→</span></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="careers-steps" aria-labelledby="steps-title"><div className="shell">
        <h2 id="steps-title">How hiring works</h2>
        <ol>
          {HIRING_STEPS.map(([title, text], index) => (
            <li key={title} data-reveal style={revealDelay(index)}><b>{index + 1}</b><strong>{title}</strong><p>{text}</p></li>
          ))}
        </ol>
      </div></section>
    </>
  )
}
