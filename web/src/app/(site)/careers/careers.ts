// Open roles at FayFort (docs/HR_AND_HIRING_PLAN.md, H1). HR staff post them in Control Center -> People -> Hiring.

export type JobQuestion = { id: string; label: string; kind: 'short' | 'yes_no' | 'choice'; options: string[]; required: boolean }
export type Job = {
  id: string
  slug: string
  title: string
  department: string
  department_label: string
  job_type_label: string
  location_label: string
  pay_range: string | null
  summary: string
  duties: string[]
  requirements: string[]
  questions: JobQuestion[]
  trial_task: boolean
  trial_paid: boolean
  opened_at: string | null
}

const API = (process.env.FAYFORT_API_URL || 'https://api.fayfort.com').replace(/\/$/, '')
export const PUBLIC_API = (process.env.NEXT_PUBLIC_FAYFORT_API_URL || 'https://api.fayfort.com').replace(/\/$/, '')

/** Cached for 2 minutes. An unreachable API shows "no open roles", never an error. */
export async function getJobs(): Promise<Job[]> {
  try {
    const response = await fetch(`${API}/public/careers/jobs`, { next: { revalidate: 120 }, signal: AbortSignal.timeout(4000) })
    if (!response.ok) return []
    const body = (await response.json()) as { jobs?: Job[] }
    return (body.jobs || []).filter((job) => job && job.slug && job.title)
  } catch {
    return []
  }
}

export async function getJob(slug: string): Promise<Job | null> {
  if (!/^[a-z0-9-]{3,80}$/.test(slug)) return null
  try {
    const response = await fetch(`${API}/public/careers/jobs/${slug}`, { next: { revalidate: 120 }, signal: AbortSignal.timeout(4000) })
    if (!response.ok) return null
    return ((await response.json()) as { job?: Job }).job || null
  } catch {
    return null
  }
}

export const HIRING_STEPS = [
  ['Apply', 'Send your details and CV. It takes about five minutes.'],
  ['We read it', 'Our HR team reads every application within 7 days.'],
  ['Interview', 'A video call with the team at a time that suits you.'],
  ['Trial task', 'Some roles have a short task, paid or unpaid as the role says.'],
  ['Offer', 'Accept online and get your FayFort staff invitation.'],
] as const

export const CV_TYPES: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/msword': 'Word',
}
export const MAX_CV_BYTES = 5 * 1024 * 1024

/** Checks a chosen CV before upload: PDF or Word, 5 MB at most. Returns an error message, or '' when fine. */
export function cvProblem(file: { type: string; size: number; name: string } | null): string {
  if (!file) return 'Choose your CV to upload.'
  const type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : /\.docx$/i.test(file.name) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : '')
  if (!CV_TYPES[type]) return 'Upload your CV as a PDF or Word file.'
  if (file.size > MAX_CV_BYTES) return 'Your CV must be 5 MB or smaller.'
  if (file.size === 0) return 'That file is empty. Choose your CV again.'
  return ''
}

export function cvType(file: { type: string; name: string }): string {
  return file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
}
