'use client'

import { useState } from 'react'

export type Offer = {
  status: 'sent' | 'accepted' | 'declined' | 'expired'; job_title: string; letter: string; start_date: string
  expires_on: string; expired: boolean; signature_name: string | null; responded_at: string | null
}

const longDate = (value: string) =>
  new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })

/** The offer letter, and accepting it by typing your full name (or declining). */
export default function OfferCard({ offer, name, busy, onAccept, onDecline }: {
  offer: Offer; name: string; busy: boolean; onAccept: (signature: string) => void; onDecline: (reason: string) => void
}) {
  const [signature, setSignature] = useState('')
  const [agree, setAgree] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const open = offer.status === 'sent' && !offer.expired
  return (
    <section className="status-card status-offer" aria-labelledby="offer-title">
      <div className="status-title">
        <h2 id="offer-title">{offer.status === 'accepted' ? 'Your accepted offer' : 'Your offer'}</h2>
        <span>{open ? `Open until ${longDate(offer.expires_on)}` : offer.status === 'accepted'
          ? `Accepted${offer.signature_name ? ` by ${offer.signature_name}` : ''}` : offer.expired || offer.status === 'expired' ? 'Expired' : 'Declined'}</span>
      </div>
      <div className="offer-letter" tabIndex={0} aria-label="Offer letter">{offer.letter}</div>
      {open && !declining && (
        <form className="offer-accept" onSubmit={(event) => { event.preventDefault(); onAccept(signature) }}>
          <label className="apply-consent">
            <input type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} />
            <span>I have read this offer and I accept it.</span>
          </label>
          <label>Type your full name to sign<input autoComplete="name" placeholder={name} value={signature} onChange={(event) => setSignature(event.target.value)} maxLength={120} /></label>
          <div className="apply-actions">
            <button type="button" className="apply-back" onClick={() => setDeclining(true)}>Decline</button>
            <button type="submit" className="apply-button" disabled={busy || !agree || !signature.trim()}>{busy ? 'Accepting…' : 'Accept the offer'}</button>
          </div>
          <p className="status-small">Your name, the time and your internet address are saved with the offer as your signature.</p>
        </form>
      )}
      {open && declining && (
        <form className="offer-accept" onSubmit={(event) => { event.preventDefault(); onDecline(reason) }}>
          <label>Would you tell us why? (optional)<textarea rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <div className="apply-actions">
            <button type="button" className="apply-back" onClick={() => setDeclining(false)}>Back</button>
            <button type="submit" className="apply-button" disabled={busy}>Decline the offer</button>
          </div>
        </form>
      )}
    </section>
  )
}
