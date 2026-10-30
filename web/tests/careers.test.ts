import { afterEach, describe, expect, it, vi } from 'vitest'
import { cvProblem, getJob, getJobs } from '../src/app/(site)/careers/careers'
import { isPublicSitePath } from '../src/proxy'

afterEach(() => vi.unstubAllGlobals())

describe('careers (HR and hiring H1)', () => {
  it('serves the careers pages and nothing else under /careers', () => {
    expect(isPublicSitePath('/careers')).toBe(true)
    expect(isPublicSitePath('/careers/sourcing-agent')).toBe(true)
    expect(isPublicSitePath('/careers/status/AbC_123-xyzAbC_123-xyz0')).toBe(true)
    expect(isPublicSitePath('/careers/../admin')).toBe(false)
    expect(isPublicSitePath('/careers/a/b')).toBe(false)
  })

  it('checks the CV before upload', () => {
    expect(cvProblem(null)).toMatch(/Choose your CV/)
    expect(cvProblem({ type: 'image/png', size: 10, name: 'me.png' })).toMatch(/PDF or Word/)
    expect(cvProblem({ type: 'application/pdf', size: 6 * 1024 * 1024, name: 'cv.pdf' })).toMatch(/5 MB/)
    expect(cvProblem({ type: '', size: 1000, name: 'cv.docx' })).toBe('')
    expect(cvProblem({ type: 'application/pdf', size: 1000, name: 'cv.pdf' })).toBe('')
  })

  it('lists open roles and survives a broken API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ jobs: [{ id: '1', slug: 'sourcing-agent', title: 'Sourcing agent' }, { id: '2', slug: '', title: 'x' }] }) })))
    expect((await getJobs()).map((job) => job.slug)).toEqual(['sourcing-agent'])
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    expect(await getJobs()).toEqual([])
    expect(await getJob('../etc')).toBeNull()
  })
})

import { groupSlots } from '../src/app/(site)/careers/status/[token]/InterviewPicker'

describe('interview time picker', () => {
  it('groups offered times by day in the candidate’s own time zone', () => {
    const slots = [
      { starts_at: '2026-11-03T08:00:00Z', ends_at: '2026-11-03T08:45:00Z' }, // 16:00 China, 09:00 Lagos
      { starts_at: '2026-11-03T23:30:00Z', ends_at: '2026-11-04T00:15:00Z' }, // 07:30 China on the 4th, 00:30 Lagos on the 4th
    ]
    expect(groupSlots(slots, 'Africa/Lagos').map((d) => [d.key, d.items.length])).toEqual([['2026-11-03', 1], ['2026-11-04', 1]])
    expect(groupSlots(slots, 'America/Los_Angeles').map((d) => d.key)).toEqual(['2026-11-03'])
  })
})
