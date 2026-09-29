# FayFort project status and carry-forward notes

Updated: 2026-09-29

## Current position

- Layer 4 provides validated intent classification and proposed actions; proposed actions do not execute external operations.
- Layer 5 persists a customer profile and structured requests, carries conversation intent into request records, and tracks continuations, related requests, cancellations, and missing information.
- Layer 6 (`app/directory`) imports the directory workbooks, searches curated Supabase data through an allowlisted gateway, checks verification and entitlement rules, records access decisions, and formats deterministic replies from permitted fields.
- The Supabase migration and workbook import were applied by the project owner. Manual API checks covered an allowed verified lookup, missing identity, unverified hotel record, and missing entitlement.

## Layer 6 items to close

- Confirm the latest `ALLOW` audit event records `verification_state = verified` when all returned records are verified. The gateway now derives this status from accepted records rather than excluded search matches.
- Confirm non-verified allowed results use neutral response wording. The response formatter now says “Verified directory information” only when the gateway marks the returned records verified.
- Complete one positive authenticated API lookup with a real trusted business identity and active entitlement. Current test business returned `UPGRADE_REQUIRED`; no subscription plans or billing model have been designed yet.
- Rotate credentials exposed in a project screenshot, update local `.env`, and ensure replacement secrets are not committed or pasted into chat.

## Carry-forward dashboard requirement

In the final dashboard stage, provide a manual control for reviewing unverified fields. An authorized reviewer must be able to approve an unverified field, and that action must persist the approval/status change in Supabase. Keep field-level verification history and reviewer attribution in the dashboard design; this is not implemented in Layer 6.

## Layer 7 direction (proposal, not an approved specification)

Make Layer 7 a secure operations and review dashboard foundation: conversation/request visibility, human review queues, directory verification review, and business-level administration. Keep billing as an entitlement integration point until subscription plans are designed. Before building, map these screens and API permissions against the existing RLS and business membership model, then agree the exact scope and acceptance checks.

## Migration reconciliation note

The active local migration chain was baselined from the live Supabase schema. Older numbered migrations were moved to `supabase/migrations_legacy/`; do not restore or delete them without reconciling the Supabase migration history first. The owner previously confirmed active migration versions through `20260929120000` on both local and remote lists.
