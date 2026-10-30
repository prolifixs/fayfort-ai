import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getJob } from '../careers'
import ApplyForm from './ApplyForm'
import '../careers.css'

export const revalidate = 120

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const job = await getJob((await params).slug)
  if (!job) return { title: 'Role not found | FAYFORT International Trading', robots: { index: false } }
  return {
    title: `${job.title} | Careers at FAYFORT`,
    description: job.summary.slice(0, 160),
    alternates: { canonical: `/careers/${job.slug}` },
  }
}

export default async function RolePage({ params }: { params: Promise<{ slug: string }> }) {
  const job = await getJob((await params).slug)
  if (!job) notFound()
  return (
    <div className="shell role-page">
      <article className="role-copy">
        <Link className="role-back" href="/careers">All open roles</Link>
        <p className="role-desk">{job.department_label}</p>
        <h1>{job.title}</h1>
        <p className="careers-tags">
          <span>{job.job_type_label}</span><span>{job.location_label}</span>{job.pay_range && <span>{job.pay_range}</span>}
        </p>
        <p className="role-summary">{job.summary}</p>
        {job.duties.length > 0 && (<section><h2>What you&apos;ll do</h2><ul>{job.duties.map((line) => <li key={line}>{line}</li>)}</ul></section>)}
        {job.requirements.length > 0 && (<section><h2>What we&apos;re looking for</h2><ul>{job.requirements.map((line) => <li key={line}>{line}</li>)}</ul></section>)}
        {job.trial_task && (
          <section><h2>Trial task</h2><p>This role includes a short trial task after the interview. It is {job.trial_paid ? 'paid' : 'unpaid'}.</p></section>
        )}
      </article>
      <ApplyForm job={job} />
    </div>
  )
}
