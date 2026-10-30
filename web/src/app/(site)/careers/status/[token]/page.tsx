import type { Metadata } from 'next'
import ApplicationStatus from './ApplicationStatus'
import '../../careers.css'

export const metadata: Metadata = {
  title: 'Your application | FAYFORT International Trading',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function StatusPage({ params }: { params: Promise<{ token: string }> }) {
  return <ApplicationStatus token={(await params).token} />
}
