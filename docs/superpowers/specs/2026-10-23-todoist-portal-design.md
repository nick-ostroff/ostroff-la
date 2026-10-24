# ostroff.la private portal — Todoist-style redesign with Google sign-in

Date: 2026-10-23. Status: draft for Nick's approval.

## Intent

Everything behind sign-in on ostroff.la becomes one coherent app: the look and feel of Todoist (warm paper canvas, ink text, Inter everywhere, one red accent per view, left sidebar), and a sign-in that is just "Continue with Google" restricted to Nick's email. The public home page keeps its newspaper "Masthead" design and is not part of this work.

Why now: the private side grew section by section (Trips, Tickets, Bots briefing, Mail log, Confirms, Projects) and each has its own look, its own nav bar, and its own colors. The login is a username/password system whose accounts live in a pasted Vercel env var. Nick wants one portal, one sign-in, his email only.

Design reference: Todoist's style as captured on Refero (`styles.refero.design/style/729ba7a8-…`). The extracted DESIGN.md is committed at `docs/design/todoist-style-reference.md` for the builder. Mockup Nick approved: sidebar portal with a "Today" home view, plus a centered sign-in card with a Google button.

## Goals

- One shell for every private page: cream sidebar, paper main area, Inter, Todoist tokens.
- Sign-in with Google only. Allowed account: nick@pixelocity.com (allowlist in an env var). No passwords, no account creation, no `ADMIN_USERS_JSON`.
- A "Today" view as the landing page after sign-in that rolls up what needs Nick: pending approvals, mail kept for him, projects needing a decision, plus Tesla and mail-filing tiles.
- Every existing private section survives with its data and behavior intact: Approvals (confirm gate), Mail log, Projects board, Tickets (season table and game pages), Trips.
- Bot integrations keep working unchanged: the bearer-token APIs for Cliff, Cap, Proto, and Otto are not touched.

## Non-goals

- No new data sources or features beyond re-skinning and the Today roll-up.
- No dark mode. Todoist reference is light only; the portal is light only. (The current Projects board has a dark/light toggle; it goes.)
- No multi-user roles. One allowlist, everyone on it is "admin".
- No changes to the public home page beyond repointing its signed-in nav links.
- No subdomain changes. `tickets.ostroff.la`, `trips.ostroff.la`, `grok.ostroff.la` keep 301ing onto paths; do not delete any domain.
- Not fixing `tickets/sales.js` posting to a nonexistent `/api/sales` (it falls back to localStorage today). Out of scope; noted so the builder does not "fix" it in passing.

## Anti-goals (what would make this a failure even if it works)

- Red used as a fill or repeated across a view. Red is one primary action per view, period.
- A build step, framework, or bundler. This repo is plain static HTML plus `api/*.js` on Vercel and must stay that way.
- Any bot's bearer-token request breaking or any API path moving.
- Secrets or real data committed to the public repo.
- A sign-in that can be reached by anyone other than the allowlisted email, including a Google account on another domain, an unverified email, or a replayed OAuth callback.

## Constraints

- Plain static HTML, no framework, no build. Only runtime dependency is `@vercel/blob`. The Google sign-in is implemented with `fetch` against Google's OAuth endpoints, no new npm packages.
- Vercel: `api/*.js` serverless functions (nested folders allowed, e.g. `api/auth/callback.js`), `middleware.js` as routing middleware. `dev-server.js` must keep emulating both locally; it already resolves `api/<path>.js` by path so nested files work.
- Fonts: Todoist uses Graphik (proprietary). The reference's stated substitute is Inter, so the portal uses Inter for everything, loaded from Google Fonts (weights 400, 500, 600, 700).
- Private pages keep `<meta name="robots" content="noindex, nofollow">`. `robots.txt` disallows every private path.
- Node test runner (`node --test`) for `lib/*.test.js`. Existing tests for mail-log, mail-notes, tesla-morning, confirmations, projects must stay green.

## The design

### 1. Sign-in: Google only

**Flow.** `/login/` shows one button, "Continue with Google". It links to `GET /api/auth/google?next=/today/`. That handler generates a random `state`, stores `state` plus the sanitized `next` in a short-lived (10 min) HttpOnly cookie `ostroff_oauth`, and 302s to Google's authorization endpoint with `scope=openid email profile`, `response_type=code`, `prompt=select_account`, and `redirect_uri=<origin>/api/auth/callback`. Google sends the browser back to `GET /api/auth/callback?code=…&state=…`. The handler:

1. Rejects if the `state` query does not match the cookie (timing-safe) or the cookie is missing/expired. Clears the cookie either way.
2. Exchanges `code` for tokens by POSTing to Google's token endpoint with the client id and secret (server-side, over TLS). Google returns an `id_token`.
3. Decodes the `id_token` payload (base64url JSON). Because it came straight from Google's token endpoint over TLS, signature verification is not required by the OpenID Connect spec; the builder still checks `iss` is `https://accounts.google.com` or `accounts.google.com`, `aud` equals our client id, `exp` is in the future, and `email_verified` is `true`.
4. Lowercases `email` and checks it against the allowlist. If not allowed: 302 to `/login/?err=denied` with no session cookie.
5. If allowed: signs a session for that email and 302s to `next`.

**Allowlist.** `ALLOWED_EMAILS` env var, comma-separated, case-insensitive. Default when unset: `nick@pixelocity.com`. Adding a family member later is one env edit.

**Session.** Keep `lib/session.js` and the `ostroff_admin` HMAC cookie, bumped to a `v2` payload that carries both a short handle and the email: `v2.<handle>.<email>.<exp>.<sig>`. The handle is the part of the email before `@`, lowercased, and must match the existing username regex (`^[a-z][a-z0-9_-]{1,31}$`); for nick@pixelocity.com that is `nick`, exactly what the bots receive today. Every write path that stamps an identity (`requested_by` / `decided_by` in `api/confirmations.js`, `by` / `processed_by` in `api/mail-notes.js`, the webhook and AgentMail text) keeps using `session.username`, which is the handle. So the data contract Cap, Cliff, Proto, and Otto read does not change. Email validated with a conservative regex (lowercase, one `@`, dot in the domain). `v1` cookies are no longer accepted, which logs everyone out once at deploy. 30-day sessions, `HttpOnly; SameSite=Lax; Secure` on Vercel, as today. `/api/me` returns `{ username, email }`. `/api/logout` unchanged. The existing assertion in `lib/confirmations.test.js` that `decided_by === 'nick'` stays as is.

**Fail closed.** If `ADMIN_SESSION_SECRET`, `GOOGLE_CLIENT_ID`, or `GOOGLE_CLIENT_SECRET` is unset: middleware answers private paths with 503 "Portal is locked until Google sign-in is configured", `/login/` shows the same message instead of the button. The old HTTP basic-auth stopgap is removed entirely.

**Local dev.** Google OAuth needs a registered redirect URI; `http://localhost:4173/api/auth/callback` is registered alongside production so real sign-in works locally when `.env` has the Google vars. In addition, a dev-only escape hatch: `GET /api/auth/dev` signs in as `DEV_LOGIN_EMAIL` when `process.env.VERCEL` is not set and that var is set. It returns 404 on Vercel no matter what. (Builder's note: this keeps the dev server usable without Google credentials.)

**Removed, in two deploys.** Google sign-in cannot be exercised on a Vercel preview URL (Google does not accept wildcard redirect URIs), so the old login is not deleted in the same deploy that introduces the new one.

- *Deploy 1 (this project's main work):* new portal, new paths, Google sign-in, `v2` sessions. The old password login stays reachable only at `/login/?legacy=1` (hidden; the Google card is what `/login/` shows) and `api/login.js` still issues a `v2` session for a matching user. The basic-auth stopgap is removed now. Nick signs in with Google on production to confirm it works.
- *Deploy 2 (a small follow-up once Nick confirms):* delete `api/login.js`, `api/users.js`, `api/unlock.js`, `lib/users.js`, `unlock/`, the legacy form, and env vars `ADMIN_USERS_JSON`, `ADMIN_SETUP_TOKEN`, `MORNING_BASIC_PASSWORD`, `MORNING_BASIC_USER`, `FAMILY_PASSCODE`, `FAMILY_TOKEN`. Their tests go with them.

Previews show the locked (503) state unless the Google vars are set for the Preview environment; that is expected.

**New env vars (Vercel, Production + Preview + Development).**

| Var | What |
|---|---|
| `GOOGLE_CLIENT_ID` | From the OAuth client Nick creates in Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Same |
| `ALLOWED_EMAILS` | `nick@pixelocity.com` (optional; that is the default) |
| `ADMIN_SESSION_SECRET` | Already exists; keep |
| `DEV_LOGIN_EMAIL` | Local `.env` only, never on Vercel |

**Setup Nick does once, before the build starts** (documented in CLAUDE.md by the builder): Google Cloud Console, a project under the Pixelocity Workspace, OAuth consent screen with user type **Internal** (restricts sign-in to the pixelocity.com Workspace before our allowlist even runs), then an OAuth client of type Web application with authorized redirect URIs `https://ostroff.la/api/auth/callback` and `http://localhost:4173/api/auth/callback`. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on Vercel (Production, and Development so `vercel env pull` brings them into the local `.env`). The builder runs the dev server with `node --env-file=.env dev-server.js` and tests the real Google round trip locally before deploy 1. The secret never goes in chat or git.

### 2. The shell

Two shared files, included by every private page:

- `assets/app.css`: Todoist tokens as CSS custom properties on `:root` (colors, type scale, spacing, radii, shadows from the reference), the shell layout, and the component styles every page uses (buttons, badges, rows, tiles, tables, pills, inputs, cards). Change colors and type here, not inline.
- `assets/app.js`: renders the sidebar into `<aside data-sidebar>` from a nav config, fetches `/api/me` to show the email and initial (401 redirects to `/login/?next=<current path>`), marks the current item active by path prefix, fetches `/api/confirmations?status=pending` for the Approvals count badge, wires the Sign out form, and toggles the sidebar on phones.

**Layout.** 240px sidebar in Cream `#fff6f0` with a Stone `#d7d6d4` right hairline; main area on Paper `#fefdfc`, 36px/48px padding, content measure capped at about 880px for list views and full width for tables and boards (Mail log, Projects, Tickets table). Below 860px the sidebar collapses behind a top bar with a menu button and the page title.

**Sidebar contents, top to bottom.** Avatar initial in Ember red circle, name "Nick Ostroff", email. Then: Today, Approvals (pending count), Mail log. Group label BOARDS: Projects, Tickets, Trips. Footer: "ostroff.la ↗" and "Sign out". Active item: pale red wash `#fbe7e3` with Deep Ember text. Hover: 5% ink wash.

**Type.** Inter only. Page title 22px/600 with -0.11px tracking; section headings 14px/600; body 14px; captions 12px; large numbers in tiles 21px/600. Letter-spacing per the reference's scale.

**Color rules (from the reference, enforced by the builder).** Ember `#e34432` for exactly one filled primary button per view. Deep Ember `#cf3520` for eyebrows, active nav text, and link hover. Cobalt `#0f66ae` for hyperlinks only. Status badges are always a pale wash with chromatic text: Mint `#f0f6df` + Forest `#446c3d` for good/ostroff.la, Sky `#dceaff` + Cobalt for info/Pixelocity, Cream + Deep Ember with a faint red border for waiting/expiring/blocked. Secondary text Pencil `#6f6c69`, tertiary Graphite `#94928f`. Shadows: cards get only `rgba(37,34,30,.04) 0 1px 0`; the primary button may use the two-layer shadow on hover. Radii: 8px on every control and card; nothing larger except image masks.

**Decorative waves.** Only on the sign-in page: three thin 1.5px SVG strokes (teal, green, red at 40–50% opacity) along the bottom of the canvas. Nowhere inside the app.

### 3. Pages and paths

New path layout, with old paths 301ing to the new ones (vercel.json redirects plus middleware for the subdomain hosts):

| New path | Replaces | What |
|---|---|---|
| `/today/` | `/bots/`, `/morning*`, grok.ostroff.la `/` | Today roll-up (landing after sign-in) |
| `/approvals/` | `/bots/confirm/` | Confirm gate |
| `/mail/` | `/bots/mail/`, `/mail.html`, grok `/mail` | Mail log table |
| `/projects/` | same | Projects board |
| `/tickets/`, `/tickets/g/<id>/` | same | Tickets season table and game pages |
| `/trips/`, `/trips/japan/` | same | Trips |
| `/login/` | same | Google sign-in card |

Note the current `/mail` → `/bots/mail/` redirect flips direction. `safeNext` in `lib/session.js` and `isPrivatePath` in `middleware.js` are updated to the new list (`today`, `approvals`, `mail`, `projects`, `tickets`, `trips`, plus the API paths). The `morning/` folder and `bots/` folder are deleted once redirects exist. `robots.txt` disallows the new paths and keeps the old ones. The public home's signed-in nav (index.html, rendered when `/api/me` succeeds) becomes a single "Portal →" link to `/today/`.

**Today (`/today/`).** Title "Today", subline with the weekday/date and "briefing updated <time>" taken from the newest `as_of_pt`/generated_at the page sees. Three tiles: Otto/Tesla (from `/api/tesla-morning`: display name, charge %, range, limit; "No snapshot yet" when empty), Mail filed overnight (from `/api/morning-mail`: rows dated today in Pacific time, kept vs archived counts; falls back to totals if none today), Needs you (pending count from `/api/confirmations?status=pending`). Then sections, each hidden when empty:

- **Needs you**: every pending confirmation as a row with a red-ringed circle, the summary, a "waiting" badge showing kind and time to expiry, and Deny (ghost) / Approve (the one red button; only the first row's Approve is filled red, the rest are outlined). Approve/Deny PATCH `/api/confirmations` exactly as the confirm page does today and re-render.
- **Mail · kept for you**: the 5 most recent rows with `action === "keep"`, badge for account (ostroff.la / Pixelocity), labels, and a "note" link to `/mail/#<row id>`.
- **Projects · needs a decision**: cards in the `needs` and `blocked` columns from `/api/projects`, one row each with the column badge, reasons, and "open board" link.

The hard-coded sample asks and static FYI copy in today's `bots/index.html` (Aug 29 content marked "Sample") are dropped. Today shows live data only. (My call; flagged for Nick.)

**Approvals (`/approvals/`).** Same behavior as `bots/confirm/index.html`: filters Pending / Approved / All rendered as Todoist-style pills, cards become rows with kind, status badge, summary, requester, expiry, collapsible payload in a monospace block, Approve/Deny. Keep the `alert()` on failure replaced with an inline error line.

**Mail log (`/mail/`).** Same behavior as `bots/mail/index.html`: inbox filter (ostroff.la / Pixelocity), keep/archive filter, sortable table newest-first, inline note field per row saving to `/api/mail-notes`, terminal note states. Table restyled: hairline rows, sticky header in Cream, Inter 14px, labels as pale badges. Full width.

**Projects (`/projects/`).** Same logic as today (four columns, search, hide stale, keyboard shortcuts, 5-minute refresh, mobile horizontal snap). Visuals move to the portal tokens: column headers with a colored dot, cards in Paper with hairline border and the 4px left color bar kept, status dots, tags as pale badges. The theme toggle and dark palette are removed. The "Attention" callout becomes a Cream band with a Deep Ember eyebrow.

**Tickets (`/tickets/` and game pages).** Same markup and scripts (`data.js`, `game.js`, `sales.js`); the page swaps `site.css` for the shell and the builder restyles the existing class names (`.season`, `.tally-card`, `.tbl`, `.tr`, `.pill`, `.status`, `.opp`, and the game-page classes `game.js` emits) in `app.css`. Team marks stay. "Sold" uses the Mint badge, "Listed" the Sky badge, Keep/List/Undecided pills become small outlined pills with the active one in the pale red wash. Game pages' "Record a sale" form uses the shell's input style and one red Save button.

**Trips (`/trips/`, `/trips/japan/`).** Same content. The two-column people layout becomes two cards; rows become list rows with a chevron. Portraits stay.

**Login (`/login/`).** Centered 380px card: red check-square mark + "Ostroff.la", one line "Private pages for Nick. Sign in with your Google account.", the Google button with the Google "G" mark, a 12px note "Only allowed accounts can sign in." and a "← Back to ostroff.la" link. Error states from the query string: `err=denied` → "That Google account isn't allowed here."; `err=state` → "Sign-in expired, try again."; `err=google` → "Google didn't complete sign-in. Try again."; `locked` → the fail-closed message. If `/api/me` already succeeds, the card shows "Signed in as <email>" with "Open portal" and "Sign out" instead of the button. Waves along the bottom as in the mockup.

### 4. Middleware and routing

- `isPrivatePath`: `/today`, `/approvals`, `/mail`, `/projects`, `/tickets`, `/trips` (and subpaths) plus the existing private API paths. `/api/auth/*`, `/api/me`, `/api/logout`, `/login/` are public.
- Session check as today; bearer allowances for `/api/mail-notes`, `/api/confirmations`, `/api/tesla-morning` unchanged, byte for byte.
- No session: pages 302 to `/login/?next=<path>`; APIs 401 JSON. Fail closed with 503 if the Google env or session secret is unset.
- Subdomain targets: grok `/` and `/morning*` → `/today/`; grok `/mail*` → `/mail/`; `/bots/mail*` → `/mail/`; `/bots/confirm*` → `/approvals/`; `/bots*` → `/today/`; tickets and trips hosts unchanged.
- `vercel.json`: add 301s `/bots` → `/today/`, `/bots/mail` → `/mail/`, `/bots/confirm` → `/approvals/`, `/morning*` → `/today/`, `/mail.html` → `/mail/`; remove the `/mail` → `/bots/mail/` rule.

### 5. Testing

- `lib/auth.test.js` rewritten: session v2 round-trip and rejection of v1; `safeNext` allows the new paths and rejects `/bots/`, `/api/...`, external URLs; middleware 301s for every old path and host above; strangers 302 to login; APIs 401; bearer allowances still pass; fail-closed 503 when Google env is unset.
- New `lib/google-auth.test.js` for pure helpers in `lib/google-auth.js`: `allowedEmail` (case-insensitive, default list, whitespace), `buildAuthUrl` (correct endpoint, scope, state, redirect), `parseIdToken` (base64url decode, iss/aud/exp/email_verified checks), `oauthStateCookie` round-trip and expiry.
- Run `npm test` before every commit; it must be green.
- Manual check the builder performs on the dev server with `DEV_LOGIN_EMAIL`: every page renders in the shell, sidebar active state is right, Approvals count shows, Today sections hide when empty, mobile width collapses the sidebar.

### 6. Documentation

The builder updates `CLAUDE.md`: architecture list (new paths, shell files, auth files), the env var table (added and removed vars), the Google Cloud setup steps, and the conventions ("one red button per view", "no dark mode", "change tokens in app.css"). `docs/design/todoist-style-reference.md` holds the Refero DESIGN.md verbatim.

## Decisions Nick made

- Todoist look for the whole private side (approved on the mockup).
- Sign-in only for his email.
- Landing view after sign-in: "Today" (he did not object to the default shown in the mockup).

## Calls I made (Nick can overrule)

1. Google sign-in rather than an emailed magic link.
2. Paths move (`/bots/` → `/today/`, `/bots/mail/` → `/mail/`, `/bots/confirm/` → `/approvals/`) with permanent redirects. Bot APIs do not move.
3. The hard-coded sample asks and static FYI items on the old briefing page are dropped; Today is live data only.
4. Inter for everything (Graphik is not available).
5. Light theme only; Projects loses its dark/light toggle.
6. Old `v1` session cookies stop working at deploy (one forced re-login).
7. Dev-only sign-in escape hatch (`/api/auth/dev`) that is dead on Vercel.
8. The old basic-auth stopgap is removed in deploy 1; the password login is removed in deploy 2, after Google sign-in is confirmed on production.
9. The session keeps a short handle (`nick`) next to the email so the bots' `decided_by` / `by` fields do not change.

## Left to the builder

- Exact CSS for restyling Tickets and Projects class names, within the token and color rules above.
- Sidebar icon set (inline SVG, monochrome line icons, 18px).
- How `app.js` is structured, as long as it is one file with no dependencies.
- Order of implementation, suggested: tokens and shell → login and auth → Today → Approvals → Mail → Projects → Tickets → Trips → redirects and cleanup → docs.
