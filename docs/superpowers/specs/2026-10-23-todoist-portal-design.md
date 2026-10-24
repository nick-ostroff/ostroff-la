# ostroff.la private portal — Todoist-style redesign

Date: 2026-10-23. Status: draft for Nick's approval.

## Intent

Everything behind sign-in on ostroff.la becomes one coherent app with the look and feel of Todoist: warm paper canvas, ink text, Inter everywhere, one red accent per view, a left sidebar. The public home page keeps its newspaper "Masthead" design and is not part of this work.

Why now: the private side grew section by section (Trips, Tickets, Bots briefing, Mail log, Confirms, Projects) and each has its own look, its own nav bar, and its own colors. Nick wants one portal with one consistent design.

Sign-in mechanics are **not** changing in this project. The existing username/password login, sessions, and admin accounts stay exactly as they work today; only the login page's appearance changes. Google sign-in restricted to Nick's email was discussed and deferred to a later project.

Design reference: Todoist's style as captured on Refero (`styles.refero.design/style/729ba7a8-…`). The extracted DESIGN.md is committed at `docs/design/todoist-style-reference.md` for the builder. Mockup Nick approved: sidebar portal with a "Today" home view, plus a centered sign-in card.

## Goals

- One shell for every private page: cream sidebar, paper main area, Inter, Todoist tokens.
- A "Today" view as the landing page after sign-in that rolls up what needs Nick: pending approvals, mail kept for him, projects needing a decision, plus Tesla and mail-filing tiles.
- Every existing private section survives with its data and behavior intact: Approvals (confirm gate), Mail log, Projects board, Tickets (season table and game pages), Trips.
- The login page is restyled to match, with the same form fields and the same `/api/login` behind it.
- Bot integrations keep working unchanged: the bearer-token APIs for Cliff, Cap, Proto, and Otto are not touched.

## Non-goals

- No change to authentication: no Google sign-in, no new session format, no env var changes, no removal of the password system or the basic-auth stopgap. `lib/session.js`, `lib/users.js`, `api/login.js`, `api/users.js`, `api/me.js`, `api/logout.js` are untouched except where a path list must be updated.
- No new data sources or features beyond re-skinning and the Today roll-up.
- No dark mode. The Todoist reference is light only; the portal is light only. (The current Projects board has a dark/light toggle; it goes.)
- No changes to the public home page beyond repointing its signed-in nav links.
- No subdomain changes. `tickets.ostroff.la`, `trips.ostroff.la`, `grok.ostroff.la` keep 301ing onto paths; do not delete any domain.
- Not fixing `tickets/sales.js` posting to a nonexistent `/api/sales` (it falls back to localStorage today). Out of scope; noted so the builder does not "fix" it in passing.

## Anti-goals (what would make this a failure even if it works)

- Red used as a fill or repeated across a view. Red is one primary action per view, period.
- A build step, framework, or bundler. This repo is plain static HTML plus `api/*.js` on Vercel and must stay that way.
- Any bot's bearer-token request breaking or any API path moving.
- Secrets or real data committed to the public repo.
- Anyone locked out: the login that works today must work identically after deploy, including existing session cookies.

## Constraints

- Plain static HTML, no framework, no build. Only runtime dependency is `@vercel/blob`. No new npm packages.
- Vercel: `api/*.js` serverless functions, `middleware.js` as routing middleware. `dev-server.js` must keep working locally.
- Fonts: Todoist uses Graphik (proprietary). The reference's stated substitute is Inter, so the portal uses Inter for everything, loaded from Google Fonts (weights 400, 500, 600, 700).
- Private pages keep `<meta name="robots" content="noindex, nofollow">`. `robots.txt` disallows every private path.
- Node test runner (`node --test`) for `lib/*.test.js`. Existing tests must stay green; the ones that assert old paths are updated.

## The design

### 1. The shell

Two shared files, included by every private page:

- `assets/app.css`: Todoist tokens as CSS custom properties on `:root` (colors, type scale, spacing, radii, shadows from the reference), the shell layout, and the component styles every page uses (buttons, badges, rows, tiles, tables, pills, inputs, cards). Change colors and type here, not inline. `assets/site.css` stays for the public home only.
- `assets/app.js`: renders the sidebar into `<aside data-sidebar>` from a nav config, fetches `/api/me` to show the username and initial (401 redirects to `/login/?next=<current path>`), marks the current item active by path prefix, fetches `/api/confirmations?status=pending` for the Approvals count badge, wires the Sign out form (POST `/api/logout`), and toggles the sidebar on phones.

**Layout.** 240px sidebar in Cream `#fff6f0` with a Stone `#d7d6d4` right hairline; main area on Paper `#fefdfc`, 36px/48px padding, content measure capped at about 880px for list views and full width for tables and boards (Mail log, Projects, Tickets table). Below 860px the sidebar collapses behind a top bar with a menu button and the page title.

**Sidebar contents, top to bottom.** Avatar initial in Ember red circle, the signed-in username (from `/api/me`), "ostroff.la" beneath it. Then: Today, Approvals (pending count), Mail log. Group label BOARDS: Projects, Tickets, Trips. Footer: "ostroff.la ↗" and "Sign out". Active item: pale red wash `#fbe7e3` with Deep Ember text. Hover: 5% ink wash.

**Type.** Inter only. Page title 22px/600 with -0.11px tracking; section headings 14px/600; body 14px; captions 12px; large numbers in tiles 21px/600. Letter-spacing per the reference's scale.

**Color rules (from the reference, enforced by the builder).** Ember `#e34432` for exactly one filled primary button per view. Deep Ember `#cf3520` for eyebrows, active nav text, and link hover. Cobalt `#0f66ae` for hyperlinks only. Status badges are always a pale wash with chromatic text: Mint `#f0f6df` + Forest `#446c3d` for good/ostroff.la, Sky `#dceaff` + Cobalt for info/Pixelocity, Cream + Deep Ember with a faint red border for waiting/expiring/blocked. Secondary text Pencil `#6f6c69`, tertiary Graphite `#94928f`. Shadows: cards get only `rgba(37,34,30,.04) 0 1px 0`; the primary button may use the two-layer shadow on hover. Radii: 8px on every control and card; nothing larger except image masks.

**Decorative waves.** Only on the sign-in page: three thin 1.5px SVG strokes (teal, green, red at 40–50% opacity) along the bottom of the canvas. Nowhere inside the app.

### 2. Pages and paths

New path layout, with old paths 301ing to the new ones (vercel.json redirects plus middleware for the subdomain hosts):

| New path | Replaces | What |
|---|---|---|
| `/today/` | `/bots/`, `/morning*`, grok.ostroff.la `/` | Today roll-up (landing after sign-in) |
| `/approvals/` | `/bots/confirm/` | Confirm gate |
| `/mail/` | `/bots/mail/`, `/mail.html`, grok `/mail` | Mail log table |
| `/projects/` | same | Projects board |
| `/tickets/`, `/tickets/g/<id>/` | same | Tickets season table and game pages |
| `/trips/`, `/trips/japan/` | same | Trips |
| `/login/` | same | Sign-in card |

Note the current `/mail` → `/bots/mail/` redirect flips direction. `safeNext` in `lib/session.js` (its allowed-path regex and its default, which becomes `/today/`) and `isPrivatePath` in `middleware.js` are updated to the new list (`today`, `approvals`, `mail`, `projects`, `tickets`, `trips`, plus the existing private API paths). The `morning/` and `bots/` folders are deleted once redirects exist. `robots.txt` disallows the new paths and keeps the old ones. The public home's signed-in nav (index.html, rendered when `/api/me` succeeds) becomes a single "Portal →" link to `/today/`. After a successful login, `/api/login` sends the user to `next` or `/today/`.

**Today (`/today/`).** Title "Today", subline with the weekday/date and "briefing updated <time>" taken from the Tesla snapshot's `as_of_pt` when present. Three tiles: Otto/Tesla (from `/api/tesla-morning`: display name, charge %, range, limit; "No snapshot yet" when empty), Mail filed (from `/api/morning-mail`: rows dated today in Pacific time, kept vs archived counts; falls back to all-time totals with the label "Mail filed" if none today), Needs you (pending count from `/api/confirmations?status=pending`). Then sections, each hidden when empty:

- **Needs you**: every pending confirmation as a row with a red-ringed circle, the summary, a "waiting" badge showing kind and time to expiry, and Deny (ghost) / Approve. Only the first row's Approve is the filled red button; the rest are outlined. Approve/Deny PATCH `/api/confirmations` exactly as the confirm page does today and re-render.
- **Mail · kept for you**: the 5 most recent rows with `action === "keep"`, badge for account (ostroff.la / Pixelocity), labels, and an "add note" link to `/mail/` (the mail log is where notes are written; the builder picks the anchor scheme since rows have no id).
- **Projects · needs a decision**: cards in the `needs` and `blocked` columns from `/api/projects`, one row each with the column badge, reasons, and "open board" link.

The hard-coded sample asks and static FYI copy in today's `bots/index.html` (Aug 29 content marked "Sample") are dropped. Today shows live data only. (My call; flagged for Nick.)

**Approvals (`/approvals/`).** Same behavior as `bots/confirm/index.html`: filters Pending / Approved / All rendered as Todoist-style pills, cards become rows with kind, status badge, summary, requester, expiry, collapsible payload in a monospace block, Approve/Deny. The `alert()` on failure is replaced with an inline error line.

**Mail log (`/mail/`).** Same behavior as `bots/mail/index.html`: inbox filter (ostroff.la / Pixelocity), keep/archive filter, sortable table newest-first, inline note field per row saving to `/api/mail-notes`, terminal note states. Table restyled: hairline rows, sticky header in Cream, Inter 14px, labels as pale badges. Full width.

**Projects (`/projects/`).** Same logic as today (four columns, search, hide stale, keyboard shortcuts, 5-minute refresh, mobile horizontal snap). Visuals move to the portal tokens: column headers with a colored dot, cards in Paper with hairline border and the 4px left color bar kept, status dots, tags as pale badges. The theme toggle and dark palette are removed. The "Attention" callout becomes a Cream band with a Deep Ember eyebrow. Its 401 handling redirects to `/login/?next=/projects/` as today.

**Tickets (`/tickets/` and the 19 game pages).** Same markup and scripts (`data.js`, `game.js`, `sales.js`); the pages swap `site.css` for the shell and the builder restyles the existing class names (`.season`, `.tally-card`, `.tbl`, `.tr`, `.pill`, `.status`, `.opp`, and the game-page classes `game.js` emits) in `app.css`. Team marks stay. "Sold" uses the Mint badge, "Listed" the Sky badge, Keep/List/Undecided pills become small outlined pills with the active one in the pale red wash. Game pages' "Record a sale" form uses the shell's input style and one red Save button.

**Trips (`/trips/`, `/trips/japan/`).** Same content. The two-column people layout becomes two cards; rows become list rows with a chevron. Portraits stay.

**Login (`/login/`).** Centered 380px card: red check-square mark + "Ostroff.la", one line "Private pages. Sign in with your admin account.", Username and Password inputs in the shell's input style, one red "Sign in" button, a "← Back to ostroff.la" link, waves along the bottom as in the mockup. Exactly the same form (`POST /api/login` with `next`), the same error states (`err=1`, `err=locked`), and the same hidden create-admin and signed-in sections as the current page, restyled. The page's existing script is kept, with the `next` allowlist regex updated to the new paths and the signed-in nav pointing at the new paths.

### 3. Middleware and routing

- `isPrivatePath`: `/today`, `/approvals`, `/mail`, `/projects`, `/tickets`, `/trips` (and subpaths) plus the existing private API paths. The old `/bots` and `/morning` entries can go once they redirect.
- Session check, basic-auth stopgap, fail-closed behavior, and the bearer allowances for `/api/mail-notes`, `/api/confirmations`, `/api/tesla-morning` are unchanged, byte for byte.
- Subdomain targets: grok `/` and `/morning*` → `/today/`; grok `/mail*` → `/mail/`; `/bots/mail*` → `/mail/`; `/bots/confirm*` → `/approvals/`; `/bots*` → `/today/`; tickets and trips hosts unchanged.
- `vercel.json`: add 301s `/bots` → `/today/`, `/bots/mail` → `/mail/`, `/bots/confirm` → `/approvals/`, `/morning*` → `/today/`, `/mail.html` → `/mail/`; remove the `/mail` → `/bots/mail/` rule. The grok-host redirects point at the new paths.

### 4. Testing

- `lib/auth.test.js`: `safeNext` allows the new paths and defaults to `/today/`, rejects `/bots/`, `/api/...`, external URLs; middleware 301s for every old path and host above; strangers 302 to login; APIs 401; bearer allowances still pass. Session, username, and password tests unchanged.
- All other `lib/*.test.js` stay green. Run `npm test` before every commit.
- Manual check the builder performs on the dev server (local admin in `.data/users.json`): every page renders in the shell, sidebar active state is right, Approvals count shows, Today sections hide when empty, mobile width collapses the sidebar, login round-trips to `/today/`.

### 5. Documentation

The builder updates `CLAUDE.md`: architecture list (new paths, shell files, removed folders), the conventions ("one red button per view", "no dark mode", "change tokens in app.css", "site.css is the public home only"), and the gotchas list. The env var section does not change. `docs/design/todoist-style-reference.md` holds the Refero DESIGN.md verbatim.

## Decisions Nick made

- Todoist look for the whole private side (approved on the mockup).
- Landing view after sign-in: "Today" (he did not object to the default shown in the mockup).
- Google sign-in is deferred; the password login stays for now.

## Calls I made (Nick can overrule)

1. Paths move (`/bots/` → `/today/`, `/bots/mail/` → `/mail/`, `/bots/confirm/` → `/approvals/`) with permanent redirects. Bot APIs do not move.
2. The hard-coded sample asks and static FYI items on the old briefing page are dropped; Today is live data only.
3. Inter for everything (Graphik is not available).
4. Light theme only; Projects loses its dark/light toggle.
5. The login page keeps its hidden create-admin flow, restyled, rather than removing it.

## Left to the builder

- Exact CSS for restyling Tickets and Projects class names, within the token and color rules above.
- Sidebar icon set (inline SVG, monochrome line icons, 18px).
- How `app.js` is structured, as long as it is one file with no dependencies.
- Anchor scheme for linking from Today into a mail row.
- Order of implementation, suggested: tokens and shell → login → Today → Approvals → Mail → Projects → Tickets → Trips → redirects and cleanup → docs.

## Later (not this project)

- Google sign-in restricted to an email allowlist, replacing the password system. The earlier draft of this document (git history) has a worked design for it.
