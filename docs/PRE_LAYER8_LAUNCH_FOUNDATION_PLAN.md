# Pre-Layer 8 Launch Foundation (Layer 7.5)

Updated: 2026-10-10  
Status: **Pre-Layer 8 foundation complete; Layer 8 handoff is ready**
Completion: **100% (P8-01 through P8-07 complete)**

This phase holds launch prerequisites that should be built before Layer 8 begins. It is tracked separately from Layer 7's release score and Layer 8's member-facing experience. The existing Layer 7 release gate remains blocked by L7-024; that task is parked at the owner's direction, not closed.

## Objective

Prepare the authentication, account data, staff rating, and product catalog foundations required by the member experience. Keep membership and staff access separate: members can self-register using email/password; Google and Apple sign-in are recorded as launch features but can be deferred. FayFort worker accounts are created by an authorized platform admin only.

## P8-01 — Identity and access design review

### Existing system facts

- Supabase Auth is the current login provider. The Layer 7 control dashboard supports email/password sign-in only; it has no self-signup flow.
- Business access is a separate `business_members` relationship with `owner`, `admin`, or `member` role and `active`/`inactive` status. Business-scoped APIs validate a Supabase user token and then check active membership.
- Platform-admin authorization already relies on server-managed Supabase `app_metadata`; client-editable `user_metadata` is not trusted.
- Human Agents are currently sourced from active business members. There is no separate FayFort workforce identity/provisioning model yet.

### Recommended policy for owner approval

| Identity | Signup/provisioning | Authorization boundary |
|---|---|---|
| Consumer/member | Self-register with email/password; require verified email before member actions. Google/Apple are recorded but deferred. | Has a consumer profile only. Signup does not create business membership or grant staff access. |
| Business user | Existing invitation/administrative membership flow; no public signup should grant a business role automatically. | Existing `business_members` roles and active status remain the source of business access. |
| FayFort worker | Created by an authorized platform admin through a protected server-side operation; no worker self-signup. | Separate worker assignment/status from business membership. Worker permissions must be explicitly granted and revocable; a business `admin` role is not a FayFort platform-admin role. |
| Platform admin | Existing server-managed administrative grant process. | Can provision workers; never infer this authority from an email address, public signup, or client metadata. |

**Recommended account model:** one Supabase Auth identity may hold more than one independently granted persona, but the profile/worker/business relationships stay separate. A consumer profile or member login alone carries no business or worker privilege. P8-02 will settle the exact worker/profile tables and RLS after this policy is approved.

### Live verification capability

On 2026-10-10, the local API health endpoint returned HTTP 200, the dashboard returned HTTP 200, and a single read-only query against the configured Supabase database succeeded. This confirms the current local-to-Supabase path is available for live integration checks.

For each implementation step, acceptance will use the applicable combination of automated checks, local browser/API workflow, and live Supabase persistence/authorization checks. Live account tests will use an isolated test identity, verify both allowed and denied access, inspect the resulting persisted state, and clean up only approved test data. A real email signup check will require an owner-approved test mailbox that can receive verification mail. No live account creation, invitation, outbound message, or destructive cleanup is authorized by the current P8-01 design approval.

### Owner decisions and approval

Owner approved the recommendations on 2026-10-10: separate consumer profiles, business membership, FayFort worker status, and platform-admin authority; no business membership on consumer signup; require verified email; allow multiple personas only through independent grants; use email/password first and defer Google/Apple. FR-007 was approved as a separate fix.

## P8-02 — Account and product schema proposal

This was a review proposal only. Owner approved the schema/RLS design on 2026-10-10. **No migration or live data change has been made.** Supplier, rating eligibility, and saved-action semantics are explicitly logged dependencies; approval of the design does not authorize migration or implementation.

### Existing data to reuse

- Live read-only table checks succeeded for `business_members`, `customers`, `customer_requests`, `directory_categories`, and `directory_service_providers`.
- The current Layer 5 `customers` rows represent a business + channel + external customer identifier. `customer_requests` belongs to a customer and conversation and uses Layer 5 conversation states. Neither table is directly a website member profile or a product fulfillment timeline.
- `business_members` is a business-scoped staff/member relation with `owner`, `admin`, and `member` roles. It must remain separate from consumer profiles and FayFort worker identities.
- `directory_categories.source_ref` is the existing product taxonomy key; `product_type` and category labels can be reused instead of duplicating category records.
- `directory_service_providers` stores services such as freight consolidators, interpreters, money-transfer routes, and other providers. A live read-only sample of its `service` labels does not establish it as a general product-supplier catalog.
- Read-only table checks did not find accessible `products`, `suppliers`, `member_profiles`, or `saved_products` relations. The current schema migrations also define no dedicated supplier table.

### Proposed additive model

| Proposed relation | Purpose and key design | Access rule |
|---|---|---|
| `member_profiles` | One row per Supabase Auth user (`user_id` primary/foreign key). Store only member-specific display profile fields and placeholder `rank_level` and `subrank` integers constrained to 1–5. Do not copy email/password; Auth remains the identity source. Do not add `business_id` by default. | RLS on; member reads/edits only approved profile fields for `auth.uid()`. Rank fields are server-controlled and not client-writable. Backend validates identity for service-role access. |
| `member_points_accounts` | One row per member; `balance` starts at 0 and is nonnegative. This supports display without implementing award/redemption rules. | Member may read own balance; no direct client writes. Server-only changes. |
| `member_points_ledger` | Append-only future accounting of signed point changes, reason/reference, actor, timestamp. Empty until rewards rules are approved. Avoid treating the display balance as an unexplained mutable number. | Member may read own entries; writes only through a future audited server workflow. No points-awarding logic in this phase. |
| `member_saved_products` | Join table keyed by `(member_user_id, product_id)` with `saved_at`; initial meaning is one private saved/bookmarked state per member/product. | RLS limits read/insert/delete to the member's own rows. Product must be active. |
| `fayfort_workers` | Separate worker registry keyed by Auth `user_id`; status and creator/audit timestamps. It does not replace or alter `business_members`. Admin provisioning occurs through a future protected server endpoint. | RLS on; workers can read only their own non-sensitive status; no self-insert; admin changes through an authorized server route. |
| `products` | Global staff-managed catalog; UUID key, name, optional description/brand/model/SKU, optional `category_ref` FK to `directory_categories.source_ref`, listing state, and availability state defaulting to unknown. Use one primary category initially. Do not add a supplier FK until a canonical existing supplier source is identified. | RLS on; no anonymous access or direct client writes. Authenticated members read active catalog through the backend; worker/admin mutations are server-authorized. |
| `fayfort_worker_ratings` | Separate candidate relation for star values 1–5 targeting a `fayfort_workers` identity. Aggregate average/count on read rather than storing mutable aggregates. | Submitter identity and eligible completed work remain unresolved; do not accept or display ratings yet. |

### RLS and API boundary

Use additive migrations. Enable RLS and revoke anonymous access for member, worker, points, save, rating, and product tables. Keep the existing service-role backend access pattern, but require authenticated user identity plus explicit self/worker/platform-admin or member checks before using the service role. Never trust client-supplied user IDs to select another member's rows. Do not give clients write access to point balances, rank fields, worker status, product records, or rating aggregates. Grant self-scoped reads/writes only where needed; ensure database-side policies match the API checks.

### Decisions and dependencies recorded at P8-02 approval

1. **Supplier source — deferred by owner:** The repository/live schema has no `suppliers` relation. Identify the canonical source or approve a minimal source in a later scoped step. Products link to category taxonomy only; do not mislabel service providers as suppliers.
2. **Ratings — target approved:** Ratings apply only to FayFort workers. Business Human Agents are excluded. Who may rate and what completed work qualifies remain unresolved under FR-009. Do not accept or display ratings until eligibility is defined.
3. **Saved action — semantics deferred:** Decide whether Like and Bookmark are separate actions. Current proposal is one private saved/bookmark relation with no public like count; semantics remain logged under FR-002.
4. **Request reuse:** Layer 5 requests are conversation/customer records, not consumer-owned fulfillment records. Layer 8's purchasing/sourcing-to-delivery timeline may need its own member request/order model. Do not force website requests into `customer_requests` until a mapping and state lifecycle are designed.
5. **Member image search:** Member-captured search image storage and retention remain under FR-005's Layer 8 privacy/storage decisions. Staff-managed catalog media is handled separately in the P8-05 media extension below.

### P8-02 acceptance boundary

P8-02 is **complete as a design step**: the owner approved the schema and RLS proposal, supplier source is explicitly deferred, rating targets are separately identified, and remaining rating eligibility/save semantics are logged. Migration implementation/application is not part of this approval; any schema change will be reviewed and approved separately.

## Ordered work plan and completion weights

Weights total 100% for this phase. Each step earns its weight only when its stated acceptance criteria are complete; for P8-02 those criteria explicitly cover an owner-approved design, while implementation and live schema changes remain separate steps.

| Step | Weight | Scope | Acceptance evidence | Status |
|---|---:|---|---|---|
| P8-01 — Identity and access design | 10% | Define member, worker, business-admin and platform-admin identity boundaries; signup, invitation/admin creation, account recovery and launch provider policy. Email/password member signup is the initial implementation. Record Google and Apple as planned sign-in options. | Owner-approved role/flow matrix and API/data access rules; policy explicitly prohibits worker self-signup and privilege inheritance; business access stays tenant-scoped. | **Complete** |
| P8-02 — Account and product data foundation | 20% | Design additive migrations and RLS for member profiles, saved products, points balance/ledger, five ranks with five placeholder subranks each, separate worker identity, worker-only rating candidate, and a global product catalog linked to existing categories where possible. | Owner-approved model and RLS rules; no duplicate category taxonomy or assumed supplier table; points/ranks are display-ready placeholders, not a rewards algorithm. | **Complete (design only; approved 2026-10-10)** |
| P8-03 — Signup and worker provisioning | 20% | Implement member email/password signup and profile creation; support admin-only creation/provisioning of FayFort worker accounts. Keep Google/Apple as explicit backlog items until separately prioritized. | Member signup and verification UI; profile/session endpoint rejects unverified email; platform-admin-only worker invitation records a separate worker identity; local tests, browser workflow, live schema/persistence and allowed/denied API checks accepted. | **Complete (20%); verified member signup and active worker session accepted 2026-10-10.** |
| P8-04 — Member points and tier placeholders | 10% | Persist a virtual member points balance and display it with the existing placeholder rank/subrank. Do not add points awarding or spending. Worker-only star ratings remain separately logged under FR-009 until rating eligibility is approved. | Member API returns a nonnegative placeholder balance; account displays points and rank/subrank; clients cannot alter balance/rank; focused tests pass and additive migration is applied and verified. | **Complete (10%); live migration applied and verified 2026-10-10.** |
| P8-05 — Products as Directory/Tools item six | 22% | Add Products as the sixth Directory/Tools list. Keep product creation simple and backend/admin-controlled. Reuse the current directory category lookup; supplier linking is deferred until a canonical supplier source is identified. Include basic product identity and availability/status for later member discovery. | Business members can view active products; platform admins can create/update/hide products; category references are validated; actor and timestamp metadata are recorded; dashboard shows the sixth item. | **Complete (22%); live migration and admin CRUD verified 2026-10-10.** |
| P8-06 — Giveaways backend section placeholder | 3% | Add a clearly labeled Giveaways section to the staff/backend workspace and leave it empty. Do not add upload, campaign, entry, winner-selection or messaging behavior in this placeholder step. | Staff can see the empty section; it contains no seeded giveaway or implied active campaign; future behavior is tracked in FR-006. | **Complete (3%); empty platform staff section verified locally 2026-10-10.** |
| P8-07 — Foundation acceptance and handoff | 15% | Apply/reconcile migrations, complete focused tests, confirm existing Layer 7 workflows still work, update release/feature logs, and prepare Layer 8 implementation tickets against the settled data contracts. | Clean migration history, passing focused checks, documented API/schema contracts, and no unresolved P8 foundation blocker hidden from the log. | **Complete (15%); cross-layer checks and Layer 8 handoff recorded 2026-10-10.** |

### P8-04 implementation checkpoint

- Added an additive migration for `member_profiles.points_balance` with a nonnegative constraint and a default of zero. Existing column grants keep the value and rank fields server-managed.
- Updated `/members/me` to return the balance and the member account to display points, rank, and subrank as placeholders; no points-award or redemption behavior was added.
- Verification: 10 focused backend account tests and 28 dashboard tests pass; production dashboard build succeeds. Live schema confirms `points_balance` is `bigint NOT NULL DEFAULT 0`; all 3 existing profiles have zero points and none are negative. Remote migration history matches local through `20261010170000`.
- Applied migration: `20261010170000_pre_layer8_member_points_placeholder.sql`. Points awarding/redemption remains out of scope.
- Worker rating eligibility remains unresolved and tracked in FR-009; this approved P8-04 implementation excludes rating behavior.

### P8-05 implementation checkpoint

- Added `directory_products` as a global catalog linked to the existing `directory_categories` lookup. Supplier linkage, member saved products, image matching, and sourcing workflow are deferred to their planned steps.
- Added authenticated product listing for active business members and platform-admin-only create, edit, activate, and hide operations. Writes validate category references and record creator/updater IDs; the database maintains `created_at`/`updated_at`. Anonymous/authenticated direct table privileges are revoked and RLS is enabled.
- Added the Products list to Directory & Tools with catalog display and admin form. The catalog was empty after initial implementation; subsequent approved temporary test records were removed.
- Verification: 7 focused backend API tests pass; 29 dashboard tests pass; production dashboard build succeeds.
- Applied migration: `20261010180000_pre_layer8_directory_products.sql`. Live schema confirms RLS is enabled, anon/authenticated have no direct SELECT privilege, service_role can access the catalog, all 968 categories are available, and migration history matches. The signed-in FayFort Test Business platform admin loaded the catalog (GET 200), created a temporary product (POST 201), edited it (PATCH 200), hid it (PATCH 200), and saw the hidden state in the admin UI. The exact test row was deleted after approval; a final read-only count confirms the catalog is empty. Unauthenticated GET/POST probes return 401; local API tests cover active-only business-member listing and denied member product creation. The full-page browser check confirms the Products section and empty-state layout.
- Verification: 7 focused backend API tests and 29 dashboard tests pass; production dashboard build succeeds. Browser testing exposed and fixed a product-category select overflow; the final form fits the panel.

### P8-05 media extension checkpoint

- Owner requested URL-backed product images/videos, Instagram posts/Reels, and staff uploads for catalog display.
- Local implementation adds HTTPS direct-media links, official Instagram post embeds with a post-link fallback, and staff-only upload of public catalog assets to a dedicated `product-media` bucket. Accepted uploads are JPEG/PNG/WebP/GIF (15 MB max) and MP4/WebM (100 MB max); Storage policies restrict writes/replacements/deletes to the server-managed platform-admin claim. Catalog asset URLs are public by design for future member display. This does not store member-captured search photos.
- Migration: `20261010190000_pre_layer8_product_media.sql` applied 2026-10-10. Live migration history matches; the four media columns exist; `directory_products` RLS remains enabled; the public `product-media` bucket is restricted to the stated media types and 100 MB limit. Storage policies expose upload/replace/delete only to the server-managed platform-admin claim.
- Instagram source links are rendered through Instagram's official embed script when available, with an accessible link fallback. Public posts/Reels that permit embedding are required; no scraping or media downloading is implemented. Meta's oEmbed documentation describes Instagram post embedding and its support for public post types: [Instagram Platform oEmbed](https://developers.facebook.com/docs/instagram-platform/oembed/).
- Live acceptance: with the signed-in platform-admin dashboard, created a temporary product and uploaded the approved 1×1 PNG. The image loaded from the public bucket (`naturalWidth=1`, `naturalHeight=1`). An unauthenticated storage upload was rejected. Removed the exact temporary product and object; a live SQL check confirms zero remaining test rows/files and an empty product catalog. The browser refresh shows the empty catalog again. Local test asset was also removed.
- Verification: 9 focused backend product tests pass; 29 dashboard tests pass; production build succeeds. The member catalog is not built, so member-facing product display remains a Layer 8 task. Instagram embed rendering depends on a public post that permits embedding.
- **Next major objective:** start Layer 8 at L8-01, member account and tier. P8-03 is accepted: the worker signed in, `/workers/me` returned an active worker, and the callback displayed “Invitation accepted.” Layer 7's separate Messenger release gate remains parked and visible; this handoff does not close it.

### P8-06 implementation checkpoint

- Added a Giveaways section under Platform in the staff workspace. It is visible to platform admins and active FayFort workers, with worker visibility based on the authenticated `/workers/me` status.
- The section is a static empty state only. No giveaways, uploads, campaigns, entries, winner selection, or messaging controls/data were added. FR-006 retains the ManyChat research and future design decisions.
- Verification: all 31 focused dashboard tests pass; production TypeScript/Vite build passes; the signed-in local browser confirms the platform admin can open the empty state. An additional test confirms an active worker can open it without a business workspace. No Supabase migration or live data change was needed.
- **Next:** L8-01 member account and tier (15%).

### P8-03 live account acceptance checkpoint

- The owner retried the approved recovery email after the Supabase Auth rate limit cleared; Supabase accepted the request. The owner completed recovery and signed in as `avantiwire@gmail.com`.
- Live local browser evidence: the worker dashboard sign-in has no business workspace (expected for a worker-only identity); `/worker/accept` returned **“Invitation accepted”** and **“Your FayFort worker account is verified and active.”** The dashboard showed the worker-specific Giveaways navigation, confirming active `/workers/me` authorization.
- P8-03 is complete. No second invitation, identity, role grant, or database change was made for this acceptance.
- **Next:** L8-01 member account and tier (15%).

### P8-07 foundation acceptance and Layer 8 handoff

- The complete backend suite passes: **226 tests and 11 subtests**. The complete dashboard suite passes: **31 tests**. The production TypeScript/Vite build passes.
- Live acceptance includes verified member profile access; active worker callback and `/workers/me`; approved product create/edit/hide and media upload/display/cleanup; and prior signed-in Layer 7 browser/API checks. Approved temporary product and media test data were removed.
- The last approved live migration-history check confirmed local/remote agreement through `20261010190000_pre_layer8_product_media.sql`; this remains the final local migration. P8-07 added no migrations. The Supabase CLI is not installed in the current shell, so the migration list was not freshly queried during this close-out.
- Layer 8 data/API contracts and five weighted implementation tickets are recorded below. Open supplier, rating, save-action, request identity/status, photo matching/privacy, and social-provider decisions remain explicit logged dependencies.
- Layer 7's L7-024 Messenger acceptance remains parked and release-blocking as directed. P8 foundation completion does not mark Layer 7 complete.
- **Pre-Layer 8 foundation: 100% complete. Layer 8 progress: 35% (L8-01 and L8-02 complete). Next major objective: owner review/modification of the Layer 8 member experience blueprint and architecture. L8-03 has a local, unverified prototype draft, but implementation is paused until the owner supplies the architecture. No migration or live data changes were made.**

## Layer 8 work to start after Layer 7.5

Layer 8 starts after the above foundation is accepted, as the owner requested. Layer 7's parked Messenger release gate remains a separate release issue and is not silently closed or treated as a prerequisite to this work. The member-facing scope is currently planned as:

1. **Member account and tier view:** profile, virtual points, rank and subrank display.
2. **Saved products:** browse/search products and save, like, or bookmark them; the preferred interaction model will be decided during product UX design.
3. **Requests and fulfillment timeline:** show purchasing/sourcing request progress through product delivery, using existing request records where suitable.
4. **Product image assistance:** let a member upload or take a product photo; FayFort checks whether the item is available and returns an available product, an alternative, or a contact-support path. Exact matching, confidence, privacy/retention, and escalation behavior remain design decisions.
5. **Launch sign-in providers:** add Google and Apple only when prioritized; email/password is the first member signup route.

These items are planned scope, not claims of implementation. Layer 8 gets its own weighted completion score when it is started.

## Layer 8 member dashboard experience blueprint — draft for owner modifications

This section describes the intended member-facing experience, based on control-panel features already built and Layer 8 items already logged. It is a product/UX plan, not a final database architecture or a commitment to build all screens at once. The owner will modify it before section-by-section implementation. The Control Center remains the staff/business operations product; Layer 8 is the personal consumer/member experience. The owner has clarified that this is a mobile-first product, with an AI conversation as the central member experience.

### Product principles

- Keep the member experience distinct from business workspaces, worker tools, and platform-admin controls. A member identity alone does not grant any of those other roles.
- Make the next useful action clear: discover a product, return to a saved item, or follow a request.
- Show only catalog information staff have made active and member-visible.
- Present only persisted, factual request milestones. Never imply a purchase, shipment, or delivery based on elapsed time or inference.
- Make future features join the same navigation without displaying unfinished controls as if they work.
- Use clear, responsive layouts: desktop can use a slim navigation rail; mobile should use a compact bottom navigation with the same destinations.
- Design for phone screens first: keep primary actions thumb-reachable, avoid dense tables, use readable cards and timelines, and make upload, notification, and chat controls work well with touch and mobile keyboards. Scale the same information architecture up for tablets and desktop.
- Make AI visible and easy to start from the first screen. The AI should be the main way a member asks FayFort to find a product, explore alternatives, or get help with a request; structured catalog and account areas complement that conversation.

### Proposed member navigation

1. **Chat** — the primary AI experience and likely default landing screen, with a new-chat action and the member's conversation history.
2. **Products** — active catalog, search, categories, media, and product details.
3. **Requests** — custom or catalog-linked request submission and private progress timelines.
4. **Saved** — the member's saved products, with remove and request actions.
5. **Account** — identity, points balance, rank/subrank placeholders, theme selection, notification preferences, and sign-out.

Notifications should be available from a bell in the top app bar across the member experience, with an unread badge. A dedicated **Notifications** screen can be reached from the bell and account area. On mobile, use a five-item bottom bar with Chat as the first, visually primary destination; expose notifications through the persistent top-bar bell so the primary navigation remains uncluttered. The exact tab order and whether Chat is the app's first-run landing screen remain subject to the owner's plan.

“Saved” is the provisional action label. The current implementation has a single save state; like/favorite/bookmark distinctions remain a product decision and should not be implied in the UI until approved.

### Screen concepts

#### Chat — the AI-centered member experience

The central experience should feel conversational, with a familiar message composer and chat history, while retaining FayFort-specific ways to complete tasks. A member can ask for a product, describe what they need sourced, ask about alternatives, or ask for the current state of a request. The assistant can return structured product cards with image, availability wording, save, and request actions, so useful results do not get buried in prose. When it cannot confidently help, it should offer a clear next step such as a support handoff. It should distinguish catalog facts from suggestions and should not invent request status or purchasing commitments.

The chat composer should include an attachment control for member media. A member could attach or capture relevant media as part of the conversation, such as a product image. Media uploads need their own contract for accepted media types and size limits, private storage, access control, retention/deletion, upload failures, and whether the AI can process each type. Member chat uploads must remain separate from public product catalog media. Until those decisions and backend capabilities are approved, the UI should not present unsupported upload formats as available.

On a phone, chat should use the full available screen, keep the composer above the keyboard and safe area, provide a reachable attachment button, and render product results as horizontally compact or vertically stacked cards. Conversation history can open from a menu/drawer rather than consuming the active chat screen. The member can also navigate to Products or Requests without losing the conversation context.

#### Home / activity overview

If the member dashboard has a separate Home screen, use it as a mobile-friendly activity overview that links into Chat: welcome the member and provide direct actions for **Ask FayFort**, **Browse products**, **View saved**, and **Start a request**. Include a compact member status card with rank, subrank, and points balance; a recent request preview with its latest actual milestone; and a limited preview of saved products. A dismissible activity banner can surface an important new event, such as a request milestone, and link to its source. Keep the page focused rather than filling it with future controls. With no catalog or requests, show helpful empty states instead of blank modules or errors. If Chat is chosen as the default landing screen, this overview can instead be a compact top section or an activity panel reachable from Chat.

#### Notifications and activity banner

Provide an in-app Notifications screen with read/unread states and links back to the related request or product. The persistent bell should show an unread count or dot and open a concise preview. A contextual activity banner can call attention to a meaningful recent update—especially a request milestone—and take the member to the relevant detail. A banner and a notification should refer to the same underlying event rather than create separate activity records. Define notification types, delivery timing, read/dismiss behavior, and whether email or push notifications are in scope before implementation; the initial UX proposal does not assume push or email delivery.

#### Products and product details

Use the staff-managed `directory_products` catalog, its existing categories, and catalog media. Product cards should show available product imagery/video, product name, category, approved availability wording, and a clear save action. Product detail can add the description and remaining approved media. A **Request this product** action should carry the selected catalog item into the request form so the member does not need to retype it. Hidden products must not appear in the member catalog or be newly saved. If no products are active, explain that the catalog is being prepared.

#### Saved

Show only products saved by the signed-in member, with product media and a way to remove each item. Allow a member to start a request directly from a saved item. If the list is empty, invite the member to browse products. A removed or later-hidden item should not be presented as currently available; preserve or hide its saved relationship according to the approved product behavior.

#### Requests and progress

Support requests started from a catalog item and custom requests that begin with a title and optional details such as quantity or specifications. Confirm submission and show the resulting private request detail page. Proposed milestone sequence:

`Submitted → Under review → Sourcing → Needs your input or Options sent → Purchase confirmed → In transit → Delivered`

Cancellation is a terminal route only where server-validated transitions permit it. Each timeline entry should show its actual recorded time and a concise member-safe staff update when provided. The member can see only their own requests. Worker updates are limited to an active worker assigned to that request; platform admins assign requests. Purchase confirmation requires a worker to confirm that the purchase actually occurred.

Member replies, quote selection/approval, payments, tracking links, attachments, and shipment integrations are not assumed in this first experience. Decide those separately before adding controls or workflow stages. L8-03's schema and API draft remains local and unverified; the owner will supply the desired architecture before implementation continues.

#### Account, points, and rank

Show member identity and existing rank/subrank and zero-default points placeholders. Add links to notification preferences and theme selection when those contracts are ready. Make clear that points earning/redemption and rank benefits are not active until their rules are defined. Do not invent rank names, benefits, progression targets, or reward claims. Keep the member's account separate from business membership and FayFort worker/platform roles.

#### Themes and paid-member presentation

Offer a theme selector in Account or Appearance settings. The base theme is available to everyone; additional approved visual themes are available only to paid members. Theme gating should use an explicit paid-plan entitlement, separately from points, rank, or subrank. A locked theme may be previewed with a clear eligibility explanation, but it must not be represented as active without the entitlement. The theme should cover the member-facing interface consistently, including chat, catalog cards, notifications, and request timelines, while preserving contrast, legibility, accessible focus states, and system-level reduced-motion preferences. Theme names, visuals, paid entitlement source, upgrade journey, and available plans need owner/product approval before building.

### Later additions in the same experience

- **Photo product search:** add an entry point in Chat or Products for taking/uploading a photo. Return one of three honest outcomes: likely catalog match, alternatives, or no confident match with a contact-support path. Before implementation, approve confidence behavior, image privacy, storage and deletion, and escalation. Keep member query images separate from public catalog media.
- **Google and Apple sign-in:** add these providers to the member entry flow when prioritized. Preserve the member's profile, saved products, and requests across the approved account-linking behavior. Email/password remains the first planned route.

### Suggested build sequence

Build and accept the member experience one weighted Layer 8 section at a time: account/tier (L8-01), product discovery/saved items (L8-02), request/timeline (L8-03), photo assistance (L8-04), and social sign-in (L8-05). Chat, media uploads, notifications/activity, paid themes, and mobile-first requirements are newly recorded experience scope and need to be reconciled into the weighted plan before implementation; do not silently expand the 100% total or claim completion for them. This UX blueprint does not increase the score or authorize a migration by itself. After the owner modifies this draft, finalize each section's interaction and data contract before implementing that section. For L8-03 specifically, wait for the owner's architecture before proceeding with the current local draft.

### Layer 8 implementation handoff tickets

These tickets structure the requested member-side work and total 100%. They are planning weights only; no Layer 8 implementation is included in P8-07. Start Layer 8 after this foundation is accepted.

| Ticket | Weight | Scope and contract | Acceptance criteria / dependency |
|---|---:|---|---|
| L8-01 — Member account and tier | 15% | Extend the current verified-email member account page; display profile identity, points, rank, and subrank using `/members/me`, the Supabase Auth session, and `member_profiles`. Keep points and rank server-managed; no earning/redemption rules or profile editing in this slice. | Verified member can view their profile name/email and points/rank placeholders; no client ability to alter profile, points, or rank. Google/Apple are separate and deferred to L8-05. |
| L8-02 — Product discovery and saved products | 20% | Add a member-safe active catalog/search API over `directory_products` and a member-scoped saved/bookmarked relationship. Reuse product categories and media; defer suppliers under FR-008. Do not expose the business-admin product route as a consumer API because it requires business membership. | A verified member can browse only active product fields and save/remove an item for their own account; one saved state per member/product; hidden products cannot newly be saved; no cross-member access. Requires an implementation migration for saved products and a member API/RLS review. |
| L8-03 — Request and delivery timeline | 25% | Show each member's purchasing/sourcing request from creation through delivery. Layer 5 `customer_requests` has no safe member mapping or persisted fulfillment history; a separate member-owned request and milestone model is the approved design direction. | A member sees only their own request timeline; each displayed stage maps to a persisted event; no client-side stage mutation or invented fulfillment state. The owner approved assignment-only active-worker access and the proposed stages. Await the owner's full architecture before implementation. |
| L8-04 — Product photo assistance | 30% | Allow photo upload/capture and return one of: available match, alternative, or support path. Keep catalog media separate from member query images. | Approved image types/size, private storage and retention/deletion, consent, matching confidence, alternative ranking, no-match/support routing and abuse limits are decided before implementation; user sees explicit uncertainty and a support path. These policy decisions are an approval gate. |
| L8-05 — Google and Apple sign-in | 10% | Add social providers only when prioritized, using the existing independent member identity model. | Provider configuration, callback allowlists, verified-email behavior, account linking, and recovery are approved and tested. Email/password remains the supported first route until then. |

### Layer 8 progress checkpoints

- **L8-01 — Member account and tier (15%, complete locally):** the verified member account view now displays the profile name, Auth email, zero-default virtual points, and rank/subrank placeholders. Points and rank remain server-managed; this slice adds no profile editing or earning/redemption behavior. The focused dashboard suite (31 tests) and production TypeScript/Vite build pass; `git diff --check` passes. A browser visit to `/member/account` in the current worker session correctly shows the sign-in page, so authenticated member rendering was verified with the local component test rather than a live member session. No live schema or member data was changed.
- **L8-02 implementation and live acceptance (20% weight; complete):** added a verified-member-only active catalog/search API, category filtering, member-owned save/remove endpoints, and a browse/search/saved-items page. The approved migration is live and schema/RLS checks pass. The first live Save surfaced the Python Supabase `maybe_single()` empty-result behavior; the endpoint now handles `None` and performs the first insert. The fresh live retry confirmed Save → Remove saved product → Save product through the verified member browser session. The temporary product was deleted after action-time confirmation, and final live counts showed zero product and saved-item rows. Focused backend tests pass (17). **Next: L8-03 request and delivery timeline. Start with a read-only audit of member-to-request identity and persisted status semantics; present a mapping proposal before implementation.** Layer 8 progress is 35%. Supplier linkage and like/bookmark semantics remain logged.
- **L8-03 read-only contract audit (proposal stage; no implementation or live writes):** inspected the Layer 5 schema, request API/state code, business event usage, and live aggregates. `customer_requests` has no `member_id`/`user_id`; each row belongs to a `customers` record and a `conversation`. Customers are keyed by `(business_id, channel, external_customer_id)`, and the conversation linkage is consistent for all 5 current live requests. The current 5 requests span 4 customers: 4 Instagram requests and 1 `manual_test`; statuses are 2 `active` and 3 `awaiting_customer`; types include product sourcing, shipping, supplier search, and Canton Fair; one request references a related request. Customer profile JSON has no populated keys. These chat-facing statuses represent intake/clarification/closure, not purchase, shipment, or delivery milestones. The table stores only `created_at` and `updated_at`; live `business_events` has no `customer_request` events for these rows. No schema or data was changed during this audit.
- **L8-03 schema/RLS/API design direction (owner-approved basis; implementation now paused for architecture):** the owner approved a distinct member-owned request and append-only milestone model, assignment-only active-worker access, and proposed stages `submitted`, `under_review`, `sourcing`, `needs_member_input`, `options_sent`, `purchase_confirmed`, `in_transit`, `delivered`, and `cancelled`. A worker must confirm an actual purchase before `purchase_confirmed`. The model does not reuse chat external IDs. The owner has not yet supplied the full Layer 8 architecture, so this approval is not permission to finalize implementation against assumed architecture. Current local draft files are an unverified prototype only; no migration/live changes have occurred. Attachments, shipment tracking integration, supplier links, ratings, member replies, quote approval, and payment remain outside this draft unless the owner's architecture includes them. Layer 8 remains 35% until L8-03 implementation and acceptance.
- **2026-10-10 L8-03 local prototype pause:** a local migration/API/dashboard draft was started after the design-basis approval. The initial backend focus passed (13 tests), and the dashboard suite (32 tests) and production build passed before the latest dashboard assignment UI edits. Those latest edits are unverified. Do not apply the migration, continue implementation, or count L8-03 progress until the owner supplies and approves the architecture. No live data changed.

### Layer 8 API/data handoff contracts

- **Identity:** `/members/me` requires a valid, email-verified Supabase user and returns that user's `member_profiles` row. Signup does not create a business membership. `points_balance`, `rank_level`, and `subrank` remain server-controlled. `/workers/me` is a separate confirmed-email worker-status check; worker access does not imply business membership or platform-admin authority.
- **Catalog:** `/directory/products?business_id=...` is currently a business-scoped control-plane route. Business members receive active products; platform admins manage catalog records and media. Layer 8 must add a separate member-safe route that does not require business membership and returns only active, member-displayable fields.
- **Persistence:** `member_profiles`, `directory_products`, and `member_saved_products` are live; points are placeholders. The member catalog and saved-item routes are implemented locally and read-only live access is verified. Request/member identity mapping and private photo-search storage are not built yet. Media files in `product-media` are public catalog assets, not a place for member query photos.
- **Dependencies to keep visible:** supplier master source (FR-008), worker-rating eligibility (FR-009), photo matching/privacy policy (FR-005), saved action meaning, and Layer 5 request-to-member identity/status mapping. Resolve each in its ticket before dependent writes or live migrations.

## Deferred Layer 7 task log

### LOG-L7-024 — Messenger live provider acceptance

- **Status:** Parked at owner direction; still open and release-blocking for Layer 7.
- **Already implemented:** Page credential-vault flow, verification/subscription, signed webhook validation, normalized/idempotent inbound processing, opt-in reply generation, outbound adapter, response-window handling and delivery ledger behavior.
- **Remaining:** configure the Meta App/Page with `pages_messaging`; save credentials in the dashboard vault; expose a public HTTPS callback subscribed to `messages`; verify the Page token; send a live/test inbound message and duplicate callback; confirm a provider-backed reply. Keep auto-reply disabled until explicitly enabled.
- **Resume gate:** owner returns to Layer 7 review and provides/configures the external Meta Page and public callback prerequisites. Do not mark closed based only on local tests or local webhook challenge.

## Feature request log

New requests are recorded here before implementation. Each log entry keeps the requested behavior, status, dependencies/decisions, and acceptance criteria so work can resume without relying on chat history.

### FR-001 — Member and FayFort worker accounts

- **Status:** P8-03 complete. Member email verification and the worker's active callback/sign-in are accepted. Google and Apple remain deferred.
- **Requested:** Members can sign up with email/password; Google and Apple are desired launch options but need not be implemented immediately. FayFort worker accounts are created by admins only.
- **Acceptance:** Member self-registration follows an explicit email verification/recovery policy; worker self-registration is unavailable; platform admin creation is audited and role boundaries are enforced. Focused local tests and browser routes pass. Member verification, worker activation, recovery, and callback acceptance are complete in P8-03.

### FR-002 — Member saved products, points and ranks

- **Status:** Points and rank placeholders are live through P8-04; saved products remain planned for L8-02.
- **Requested:** Let members save/like/bookmark products, show virtual reward points, and represent five ranks with five placeholder subranks each. Rewards logic and gamification rules will be designed later.
- **Acceptance:** Saved items are member-scoped; points/rank/subrank persist and display as placeholders; no undocumented reward-awarding rules are introduced.

### FR-003 — Worker star ratings

- **Status:** Worker-only target is settled; eligibility and submitter policy remain open before any rating implementation.
- **Requested:** Workers have star ratings visible to humans/staff.
- **Open decisions:** Who can submit a rating, eligible completed work, edit/dispute rules, aggregation and privacy visibility.
- **Acceptance:** Store attributable ratings under an approved policy and show a correctly scoped aggregate in the staff experience.

### FR-004 — Products directory/tool

- **Status:** Staff product catalog and media are live through P8-05; member discovery remains planned for L8-02.
- **Requested:** Add Products as the sixth Directory/Tools item; products are entered from the backend by staff/admin initially and reuse existing categories, suppliers and other lookups.
- **Acceptance:** Staff can manage simple product records; existing lookup systems are reused; member discovery can build on the same product identity later.

### FR-005 — Layer 8 member experience and photo search

- **Status:** Planned for Layer 8, after P8 foundation acceptance.
- **Requested:** Show member account/tier, saved products, and purchasing/sourcing-to-delivery request timelines. Allow image upload/capture to identify availability, suggest an alternative, or route the member to support.
- **Open decisions:** Member photo-search matching thresholds, supported capture formats, private storage/retention, consent/privacy, no-match behavior, and how the resulting request is created/tracked. Staff catalog media is addressed in P8-05.

### FR-006 — Staff-managed giveaways

- **Status:** Empty backend section complete in P8-06; giveaway operations remain a future feature request.
- **Requested:** Add a Giveaways section in the staff/backend workspace. Workers will eventually upload/manage giveaways. Keep it empty for now; do not create sample campaigns or imply that a giveaway is active.
- **Research requested:** Review ManyChat's giveaway method and identify useful patterns to adapt before designing upload, eligibility, entry, campaign messaging, winner selection, and audit behavior. Treat ManyChat as a reference, not a specification to copy wholesale.
- **Open decisions:** Who may create/publish a giveaway, supported media and fields, campaign dates, eligibility and entry rules, winner selection/approval, member notifications, privacy/retention, and whether this belongs in the member experience or staff tools only.
- **Acceptance for the placeholder:** Staff navigation includes an empty Giveaways section with a clear no-giveaways state. Upload and campaign functionality remains unimplemented until its own scope and acceptance criteria are approved.

### FR-007 — Secure legacy business API endpoints

- **Status:** Fixed and verified on 2026-10-10; remains separately logged from the Layer 7.5 weighted feature score.
- **Observed:** `GET /businesses` exposed a global business listing; `GET /businesses/{business_id}/members` returned full membership rows; adjacent `POST /conversations` could create or find a conversation for a caller-supplied business without checking membership. No dashboard caller was found for the legacy POST; supported inbound/manual routes have their own authorization path.
- **Bounded fix:** Require a verified user for the business list and return only that user's active business memberships; require active membership for a member roster and return only user ID, role, status and joined date; require active membership before legacy conversation creation. Keep the existing `/dashboard/businesses` and provider/webhook APIs unchanged.
- **Out of scope:** global authentication refactor, OAuth/social sign-in, worker provisioning, business-role redesign, hardening unrelated health/knowledge/message routes already guarded, and database/RLS redesign.
- **Acceptance:** missing/invalid identity and cross-business access cause no database read/write; allowed members see only their business-scoped workspace/roster; member roster output contains no unapproved columns; authenticated conversation creation retains its prior result. Focused API tests pass (12 tests across the new legacy-route module and existing message/conversation modules). An isolated API instance on 127.0.0.1:8001 returned HTTP 401 for no-auth business listing, fake-business roster, and conversation-create probes; the create probe was rejected before any database write.
- **Scope rule:** This remains a separate security fix and is not added to the Layer 7.5 weighted feature score.

### FR-008 — Locate canonical product supplier source

- **Status:** Deferred by owner; open dependency for any future supplier-linked product experience; not added to phase weights.
- **Observed:** No `suppliers` table is present in the current migrations or accessible live schema. `directory_service_providers` contains logistics and other service categories, not a confirmed product supplier master.
- **Needed:** Identify the existing source/table for supplier records, or explicitly approve adding a small canonical supplier source in a future step. Until then, Products can reuse categories but should not create a duplicate supplier catalog or an incorrect foreign key.

### FR-009 — Define worker rating eligibility and policy

- **Status:** Target resolved as FayFort workers only; submission/eligibility policy remains open for any future rating implementation. Business Human Agents are excluded.
- **Observed:** Layer 7 Human Agents are sourced from business-scoped `business_members`; FayFort worker identities are planned as a separate registry. Rating workers does not imply a Layer 7 Human Agents rating display change.
- **Owner decision:** Ratings apply only to FayFort workers.
- **Needed:** Identify who can submit ratings and the completed work/request that makes a rating eligible. Until decided, do not publish an aggregate or accept ratings.

### FR-010 — Confirm Auth email verification and redirect configuration

- **Status:** Verified; worker redirect allowlist, member verification, and worker callback acceptance are confirmed.
- **Observed:** The member profile API requires Supabase to report a verified email. Member signup returns to `/member/account`; worker provisioning uses Supabase's email invitation flow. Supabase displayed “Successfully added 1 URL” and the allowlist now contains `http://127.0.0.1:5173/worker/accept`. Site URL and email verification policy were left unchanged.
- **Accepted:** The member identity is verified; with the API healthy and the owner signed into the worker identity, `/worker/accept` returned active status. No invitation was resent.

### FR-011 — Complete worker invitation activation and callback

- **Status:** Complete; activation migration and redirect allowlist are live, the worker is active, and the signed-in callback displayed “Invitation accepted.” Read-only pre-change impact check found one confirmed `invited` worker row, zero unverified invited rows, and zero existing active/inactive rows.
- **Initial observed issue:** Before the activation repair, the verified test worker row remained `invited`; the first callback expired at `localhost:3000` while Vite was running at port 5173. The repair and successful callback acceptance are recorded below.
- **Implemented:** Added confirmation-driven activation with a scoped backfill; configured worker invites to redirect to the running dashboard callback. Migration, allowlist, active worker status, and `/workers/me` callback acceptance are verified. No invitation was resent during repair.

### FR-012 — Worker callback status lookup recovery

- **Status:** Direct blocker fix completed locally; focused dashboard tests pass (23), production build succeeds, and backend regression tests pass (10).
- **Initial observed issue:** When `/workers/me` could not respond, the callback kept the heading “Checking your invitation” after showing the API timeout and offered no retry. Once the API was restarted, an unrelated browser identity without a worker row returned 404; the endpoint now handles that as an unprovisioned identity.
- **Change:** The callback now shows “Unable to confirm worker account” for lookup errors and provides a retry button. `/workers/me` also handles a `None` result from Supabase's maybe-single query as an unprovisioned identity (404) rather than an internal error (503). No authentication policy or worker status behavior changed.

### FR-013 — Complete live callback with the provisioned worker identity

- **Status:** Complete 2026-10-10; owner signed in with the provisioned worker identity and `/worker/accept` verified active status.
- **Initial observed test condition:** An unrelated browser identity without a `fayfort_workers` row received the expected 404. The provisioned owner worker session was later verified active as recorded in the acceptance evidence below.
- **Acceptance evidence:** Dashboard session identifies `avantiwire@gmail.com`; the callback reports active status and the worker dashboard shows worker-only navigation without a business workspace. No second account or role grant was created.

### FR-014 — Worker password recovery

- **Status:** Complete 2026-10-10; Supabase accepted the owner-approved retry, the owner completed recovery, and the worker signed in successfully.
- **Initial observed gap:** The callback verified worker status but did not let an invited worker set or reset a password. The approved recovery-form change and successful password recovery are recorded below.
- **Scope:** Detect Supabase's `PASSWORD_RECOVERY` callback and allow the signed-in recipient to set and confirm a new password through Supabase Auth. Reuse the existing `/worker/accept` allowlist URL. No account creation, privilege changes, or worker-role changes.
- **Acceptance:** Focused tests cover password update, mismatch, and error handling. Supabase later accepted the approved recovery request; the owner completed recovery and signed in. No auth link was generated or exposed.

## Working rule

Before each step, explain its objective, scope, weight, outputs, acceptance evidence, and any decisions needed, then ask the owner to approve starting that step. Do not begin an unapproved step. After the step, report what changed and the evidence before asking to proceed to the next step.

For each new feature request or issue, append a log entry before implementation. A logged issue does not enter the phase's core scope automatically. Add it to core only when the owner approves a scope change, or when it is a direct blocker for the current approved step; in the blocker case, explain why, propose the smallest necessary change, and ask before expanding scope. Do not ignore issues or silently add them to core. Update completion only against acceptance evidence. Every progress report should state the current phase, its percentage, the next major objective, and the most important open blocker.
