# FayFort UX layout plan (responsive shell, design tokens, themes)

Status: built 2026-10-15 (all stages, see section 4). Target: fluid on phone (≤639px), tablet/iPad (640–1023px) and
desktop (≥1024px), ChatGPT-like structure, themes that only swap tokens.

## 1. Current state before the work (measured)

| Area | Finding | Effect |
| --- | --- | --- |
| Stylesheets | `member-chat.css` (448 lines, 66 KB, minified one-liners) + `app.css` (220 lines, 54 KB) | Hard to change safely |
| Repeated rules | 26 member selectors defined 3+ times (`.member-chat-layout` ×8, `.member-chat-conversation` ×8, `.member-chat-messages` ×8, `.member-chat-list` ×7, `.member-chat-shell` ×6, `.member-chat-composer` ×6) | Later rules silently override earlier ones; placements shift |
| Breakpoints | 13 different widths (420, 430, 520, 560, 640, 650, 700, 720, 760, 850, 900…) | No consistent phone / tablet / desktop behaviour |
| Colours | ~170 unique hex colours per file; only 60 uses of theme variables | Themes can't reach most of the UI |
| Type | Mostly 9–12px text in px | Cramped, hard to read on phones (ChatGPT uses 16px body) |
| Global element rules | `header`, `article`, `main`, `body` styled globally in `app.css` | Leak into member components (already hit twice) |
| Themes | `MemberThemeRuntime` overrides a hand-picked list of classes with 25 `!important`s; the base theme's border colour is a dark grey | Heavy dark outlines on cards/dialogs; untouched parts stay white; themes fight responsive rules |
| Layout | One padded card (`.member-chat-shell`, max 1080px) holding header, chat list, nav and content. On phones the chat list becomes a row of truncated chips and the nav wraps into two uneven rows | Cramped top of screen, little room for the conversation |
| Composer | Pinned composer includes the always-visible "Chat information" box | Takes ~25% of a phone screen |
| Assistant messages | Boxed with a heavy border | Busy compared with ChatGPT's plain text |
| Bugs seen | "Ships now" label hidden in Browse filters (cascade conflict); cart button overlaps New chat | Symptoms of the above |
| Dismiss behaviour | Account menu is a `<details>`, notifications popover, cart drawer and chat "⋯" menu only close with their own button; no outside-click or Escape | You have to press the same button again |
| Component size | `MemberChatPage.tsx` is 1,700 lines (shell, list, chat, composer, dialogs, panels in one file) | Layout changes are risky |

## 2. Pages and elements affected

Member app: `/member/chat` (header, chat list, navigation, conversation, composer, Find It/product cards, Browse,
Saved products, Orders & requests, Supplier directory, product panel, cart drawer, notifications, account menu and its
four pop-ups, request/photo/link dialogs), `/member/account` (sign in/up), `/member/settings`, `/member/membership`,
`/member/notifications`, `/member/share`, theme picker and theme preview.
Staff: Control Center shell and pages, Operations Center, Theme Studio.

Files: `member-chat.css`, `app.css`, `MemberThemeRuntime.tsx`, `MemberChatPage.tsx`, `ShopPanels.tsx`,
`ShopComponents.tsx`, `MemberNotifications.tsx`, `MemberAccountDialogs.tsx`, `MemberPerks.tsx`, `PlanBilling.tsx`,
`MemberRequestsPanel.tsx`, `MemberSettingsPanel.tsx`, `MemberAccountPages.tsx`, `MemberThemePicker.tsx`,
theme preview/studio.

## 3. Fixes in stages (the plan)

| Stage | What | Result |
| --- | --- | --- |
| 0. Dismiss anywhere | One shared `useDismiss` (tap/click outside + Escape + panel change) for account menu, notifications, cart, chat "⋯" menus, staff menus | Any open menu or popover closes when you tap elsewhere |
| 1. Foundation | `tokens.css`: colour roles, spacing, radius, type scale in rem, shadows, z-index layers, safe-area; 3 breakpoints (640 / 1024); base reset; global element rules scoped to staff | One source for sizes and colours |
| 2. App shell | ChatGPT-style: desktop left sidebar + slim top bar + centred content; tablet: collapsible sidebar; phone: top bar with menu button and a slide-in drawer | Calm, uncramped layout on every size |
| 3. Chat surface | User bubbles right, assistant as plain text, consistent cards, auto-growing composer, "Chat information" moved out of the composer, keyboard-safe | Conversation gets most of the screen |
| 4. Panels and dialogs | Browse, product grid, product panel, cart, orders, directory; dialogs become bottom sheets on phones with subtle borders | Consistent screens |
| 5. Themes | Themes only set tokens (no `!important` lists); wrapper styles map to radius/shadow tokens | Themes apply everywhere, smoothly |
| 6. Staff side | Control Center and Operations on the same tokens | One system |
| 7. QA | Automated screenshots at phone, iPad, laptop and desktop for key screens | Regressions caught before release |

Rules for every stage: no feature changes, existing tests keep passing.

## 4. What was built (2026-10-15, all stages)

| Stage | Built |
| --- | --- |
| 0. Dismiss anywhere | `src/app/ui/useDismiss.ts` (tap/click outside + Escape). Used by the account menu, chat "⋯" menu, chat information popover, notifications, cart, phone drawer and the staff notifications popover |
| 1. Foundation | `src/styles/tokens.css` loaded first in `main.tsx`: type scale in rem, 4px spacing, radii, layout sizes, z-layers, safe areas, eight base colours plus derived colours (`color-mix`), base reset, `.sr-only`. Breakpoints 640 / 1024 only. Viewport meta has `viewport-fit=cover, interactive-widget=resizes-content` |
| 2. App shell | `MemberChatPage` renders `.mapp`: left sidebar (brand, New chat, Browse, Saved products, Orders & requests, Supplier directory, chats, account button at the bottom with its menu) + top bar (menu button below 1024px, page or chat title, chat information, bell, cart) + content. Below 1024px the sidebar is a slide-in drawer with a scrim (closes on scrim, Escape or navigation). Sign-in states use a simple centred gate |
| 3. Chat surface | 768px reading column, member messages as soft bubbles on the right, assistant as plain text, staff replies with an accent rule, composer that grows to ~8 lines (Enter sends on desktop, Shift+Enter new line), chat information moved to a top-bar popover, one-line fine print under the composer, auto-scroll to the newest message, safe-area padding |
| 4. Panels and dialogs | Panels share one scroll container and gutter (max 1120px). Product view opens beside the chat on desktop and full screen with a "Back to chat" button on smaller screens. Directory is a full-width panel. Notifications, cart and chat information are popovers on larger screens and bottom sheets on phones. Every dialog is centred on larger screens and a bottom sheet on phones. Latest activity is a toast under the top bar that hides after 8 seconds (still listed under the bell) |
| 5. Themes | `MemberThemeRuntime` sets the eight `--color-*` base tokens (and keeps the `--member-*` aliases). The 25 `!important` overrides are gone. Wrapper styles only change shape tokens (clean: small radius, no shadow; framed: strong borders) |
| 6. Staff side | `app.css` now holds staff styles only: neutral colours and type sizes use tokens (11px minimum), the staff green is `--staff-accent`, and the global `header`/`article` rules no longer reach member pages |
| 7. QA | `tests/e2e/member-layout.spec.ts` + `member-fixtures.ts`: chat, Browse and Directory at 390 / 820 / 1280 / 1536 with a no-sideways-scroll check, dismiss behaviour, phone drawer, and screenshots of the product split, account menu, tier dialog, notifications, cart sheet and points sheet (saved to `test-results/ux/`) |

Files: `member-chat.css` was replaced by `src/app/member/member.css` (shell and chat written fresh; panel and card
rules ported to tokens with 3 breakpoints). Member photo review styles moved to the end of `app.css`.
