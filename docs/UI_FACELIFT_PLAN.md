# UI/UX Facelift Plan (27 Oct 2026)

Method: ui-ux-pro-max priorities (accessibility, touch targets, performance, consistency, layout, type/colour, motion, forms, navigation). Preview canvas: "FayFort facelift directions" (Design artifact).

## Owner decisions (27 Oct 2026)
- Fonts: **Fraunces + Inter** (pairing 1).
- Glass: **Option A (Navy Glass frame) for everyday screens, plus Option C (Full Glass) for showcase moments**: website hero, pricing, sign-in, panel welcome and upgrade. Professional and standard where needed (no glass behind data).
- Member menu order: **approved**.
- Website: needs a visible way into the member panel (only "Join free" showed, Sign in was hidden on phones), and links to the /go destinations.

## Direction: Option A, "Navy Glass shell" (+ C for showcase)
- Navy frame (#02144E → #042770) with frosted chrome: sidebar, top bar, bottom nav, sheets, modals, chat composer.
- Content on solid paper (#F4F5FA) and white cards. No glass behind invoices, tables, chat text or product photos.
- Ink blue #0540F2 = every action. Pink #F20789 = highlights, badges, dots only (4.06:1, never text). Magenta #B10362 = pink as text.
- Automatic fallback to solid (Option B) for `prefers-reduced-transparency` and low-end devices.

## Fonts
- Base: Fraunces (headings, big numbers, empty states) + Inter (all UI, tables, prices, chat).
- Self-hosted (web/public/fonts, dashboard/public/fonts; Fontsource 5.3.0 variable files, OFL). Google Fonts would be blocked by the website CSP (font-src 'self').
- Website: applied to the (site) pages and /go only. LANDED keeps its own type.
- Scale 12/14/16/18/22/28/36/56; body 16px in the member panel (was 14–15). Tabular numbers for money.
- Theme font pairs (phase 6): Girl Boss = Playfair + Poppins; Koko Water = Montserrat + Inter; +234 Hustler = Space Grotesk + DM Sans.

## Navigation order (member panel, approved)
- Sidebar: Ask FayFort (primary button), Home, Chats, Shop, Finds, Orders & requests, Saved, Consultations & tours. Account group: Membership, Settings, Notifications, Help.
- Phone bottom nav (5): Home, Chats, Shop, Orders, More.
- New Home page: Needs you (payments, choices), Ask FayFort entry, In progress with step bar, This week's Finds.
- Real routes: /member/home, /member/shop, /member/finds, /member/orders, /member/saved, /member/tools. Old ?panel= links redirect.
- Settings, Membership, Notifications move inside the shell.
- Fix: unknown /member/* paths show sign-in to signed-in members; should show the shell with a not-found state.

## Website navigation
- Header: How it works, Services, Shop (/go/shop), Finds (/go/finds), LANDED, About.
- Visitors: Sign in + Join free (phones: Sign in pill in the header, Join free in hero and menu).
- Members (ff_member cookie on .fayfort.com, read before first paint): "My dashboard" in header, menu, footer and hero ("Go to my dashboard"). Goes to MEMBER_HOME_URL (member chat until /member/home exists).
- Phone menu adds Find me a product, Book a consultation, Tour guide in China. Footer Explore lists them too.
- /go header: fayfort.com + Sign in / My dashboard.

## Motion
- Tokens (dashboard tokens.css): --duration-fast 120ms, --duration 200ms, --duration-slow 320ms, --ease-out, --stagger 40ms. transform/opacity only; exits ~30% faster.
- Page change: crossfade + 8px rise. Lists: 40ms stagger, first 8 items. Drawers/sheets slide. Chat bubbles: fade + 4px rise. Skeletons replace "Loading…".
- Sign-in → panel: navy stays, paper sheet rises in.
- Website: keep globe and scroll reveals; header glass firms up on scroll; shimmer on Instagram tiles.
- Respect prefers-reduced-motion everywhere.

## Assets
- F monogram mark used consistently (sidebar, favicon, app icon, OG images).
- One line icon family, 1.75 stroke, 20/24px. No emoji in UI chrome.
- Empty-state line illustrations in navy + pink.
- Product images: 1:1 or 4:5, object-fit cover, blurred placeholder.
- Avatar initials on mist; real Guangzhou/market photography on the website.

## Themes
- A theme = frame colour + accent + font pair + frame style (glass/solid) + pattern. Layout and content cards are fixed.
- Base theme is now "FayFort Navy" (palette_preset fayfort-navy): bg #FFFFFF, surface #F4F5FA, text #02144E, muted #4A5578, accent #0540F2, border #7A84A6 (3.4:1), focus #0540F2. "ocean-blue" stays as a Theme Studio starting palette.
- Accent must pass 4.5:1 on white for buttons; brighter brand colours stay for icons. Koko Water #4FA3FF (2.6:1) → buttons #1F6FD1; Hustler #2FBF71 (2.4:1) → #1A7F4B; Girl Boss #D6247A passes (4.8:1).
- Theme editor blocks saving a failing colour.

## Phases
1. **Done (b949292):** fonts self-hosted on web and dashboard; base theme on the FayFort palette; Fraunces headings in the member panel (zero-specificity rule); 16px body; motion tokens; website member link and /go destinations; proxy serves /fonts/.
2. **Done:** panel shell. Navy frame from the theme (text colour for light themes, deepened page colour for dark ones), light content sheet, Ask FayFort button, approved menu with an Account group (Membership, Settings, Notifications), frosted phone tab bar (Chats, Shop, Finds, Orders, More) and frosted phone menu drawer. Every section has its own address (memberRoutes.ts): /member/shop, /member/finds, /member/orders, /member/saved, /member/tools, /member/product?product=, /member/settings, /member/membership, /member/notifications. Old /member/chat?panel= and /member/products links still work and are tidied. Unknown /member/ paths show a friendly not-found page inside the shell; signed-out visitors are sent back to the page they wanted after signing in. The retired standalone products, settings, membership and notifications pages are gone. Emails and the website now link to the new addresses (the LANDED claim link is unchanged). "Tools" is labelled "Bookings & tools" because it also holds the supplier directory.
3. **Done:** member Home at /member/home, now where members land after signing in (also the bare /member address and the website's My dashboard button). Needs you (invoices to pay, questions to answer, options to choose, each linking into Orders & requests), Ask FayFort (starts a new chat with the question ready to send), On its way (requests and store orders with a step bar), FayFort Finds (three 4:5 tiles and the next drop). Loading placeholders instead of "Loading". Home is first in the menu and in the phone bar (Home, Chats, Shop, Orders, More). Each page now has one title: the top bar names the section and the repeated heading inside is kept for screen readers only.
4. **Consistency restructure (owner feedback, 27 Oct 2026). Release A done (4A, 4B, 4E, Home restructure). Release B done (4C, 4D). C next (4F, 4G).**
   - 4A Navigation that never disappears. Phones and tablets: the tab bar stays on every section; in a chat and on a product it folds into a small handle and opens with a tap (it also folds while typing). Laptop: the menu can fold to an icon rail and back. The chat beside a product or section opens and closes with one toggle at every width (side panel on wide screens, sheet on phones). One rule for every section.
   - 4B Shop steadiness. Measured layout shift while scrolling the shop: 0.67 on a phone, 0.49 on a laptop (good is under 0.1). Causes: the ad banner, rails and the product grid arrive late and push content. Fix: reserve space for each block before it loads (skeletons of the same size), fixed image ratios, no snap-scrolling that fights vertical scrolling, and one scroll container.
   - 4C Account restructure (owner decision: no new page). Plan, name and profile photo move from Settings into the existing Account details. Settings keeps sign-in and security, addresses, notifications, theme and sounds.
   - 4D Old-format pop-ups moved onto the new design: member tier, points, cart, notifications, account details, settings, theme picker and plan table. Fraunces titles, the new cards and sheets, one icon family, tabular money.
   - Release B as built: Account details shows the member's photo or initials, name, email, plan, member since and ships-to, then the profile checklist, profile photo, name and Plan (with billing and a button to the full comparison on Membership). Settings keeps privacy, sign-in, security, emails, addresses, theme and sounds. "Plan and billing" in the tier pop-up and every "See plans" link open Account details at Plan. The account menu has one icon per item, points as a bright pill, and no duplicate tour item. Points shows a navy balance card and a progress bar per reward. The plan table becomes one card per row with the three plans on phones (no sideways scroll). Dialogs, cart and notifications use the new titles, radii and a blurred frame-colour backdrop.
   - 4E Icons: Finds keeps the star; Membership gets its own crown icon.
   - 4F Chats kept with a request: a lock mark and a bright dot, with a short glow when the list first shows, plus a plain note on hover or tap.
   - 4G Points in the menu footer as a bright pill, counting up when they change.
   - 4H Home restructured (owner feedback): date line shows the member's place and time (from the device time zone) next to Guangzhou time and the hour gap; Ask FayFort first and full width; Needs you and On its way as one-line folds that open on tap; For you carousel (the shop's product rails, New in Finds, Group buys) behind chips; FayFort Finds and the open giveaway side by side with one action each.
   - Measured after 4B: shop layout shift 0.001 on a phone and 0.000 on a laptop, also with a slow network. An e2e test keeps it under 0.1.
   - Phone and tablet menu: in a chat and on a product it starts folded to a Menu handle (owner choice) and folds while typing; elsewhere it is open with a fold tab on its top edge. Laptop menu folds to an icon rail, remembered on that browser.
5. Chat restyle and motion (sheets, chat bubbles), then website refinements (header glass on scroll, glass hero card, pricing glass, shimmer).
6. Themes migrated to the new model + contrast validation.
7. Assets pass (empty states, OG images, favicon, photography).
