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
1. **Done:** fonts self-hosted on web and dashboard; base theme on the FayFort palette; Fraunces headings in the member panel (zero-specificity rule); 16px body; motion tokens; website member link and /go destinations; proxy serves /fonts/.
2. Panel shell: navy glass sidebar, top bar, bottom nav, routes, account pages inside shell, dead-link fix.
3. Member Home + Orders + Shop/Finds cards.
4. Chat and panels restyle, skeletons, motion.
5. Website refinements (header glass on scroll, glass hero card, pricing glass, shimmer).
6. Themes migrated to the new model + contrast validation.
7. Assets pass (empty states, OG images, favicon, photography).
