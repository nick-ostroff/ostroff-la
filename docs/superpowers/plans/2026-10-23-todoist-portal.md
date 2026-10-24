# Todoist-style Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin every private page of ostroff.la into one Todoist-styled portal with a sidebar shell and a new "Today" landing view, moving the Bots pages to `/today/`, `/approvals/`, `/mail/` with permanent redirects, without touching authentication or any bot API.

**Architecture:** Two shared static assets (`assets/app.css` tokens + components, `assets/app.js` sidebar + session + badge count) are included by every private page. Each page keeps its existing data-fetching script and swaps its markup/classes to the shell. Routing changes live in `lib/session.js` (`safeNext`), `middleware.js` (private paths, subdomain targets), and `vercel.json` (301s).

**Tech Stack:** Plain HTML/CSS/JS, Vercel serverless `api/*.js` (unchanged), Vercel routing middleware, `node --test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-23-todoist-portal-design.md`

## Global Constraints

- No framework, no build step, no new npm packages.
- Authentication code is not changed: `lib/users.js`, `api/login.js` (except the default redirect), `api/users.js`, `api/me.js`, `api/logout.js`, the session format, env vars.
- Bearer-token allowances in `middleware.js` for `/api/mail-notes`, `/api/confirmations`, `/api/tesla-morning` are unchanged byte for byte. No `/api/*` path moves.
- Inter only on portal pages, via Google Fonts weights 400;500;600;700. Light theme only.
- One filled Ember `#e34432` button per view. Cobalt `#0f66ae` for hyperlinks only. Badges: pale wash + chromatic text, never a saturated fill.
- Radii 8px on controls and cards. Card shadow only `rgba(37,34,30,.04) 0 1px 0`.
- Every private page has `<meta name="robots" content="noindex, nofollow">`.
- `assets/site.css` is the public home's stylesheet; portal pages do not load it.
- `npm test` green before every commit. Commit and push after each task.

## Review Focus

1. A pending confirmation whose `expires_at` is already past or missing: Today and Approvals must still render the row (badge says "expired" or "no expiry"), never throw. Test: Task 4 step 3 (`expired` / `no expiry` badges).
2. `/api/projects` returning `{ empty: true }` or 401 on Today: sections hide, tile shows "—", page does not redirect in a loop. Covered by Task 5 manual check with no snapshot file.
3. A `next` of `/bots/mail/` arriving from an old bookmark into `/login/?next=…`: `safeNext` must fall back to `/today/` rather than send the user to a 301. Test: Task 2.
4. grok.ostroff.la `/api/mail-notes` with a bearer token must still 301 to the apex API path exactly as today (bots may still be configured with the old host). Test: Task 2 keeps the existing assertion.
5. Game pages at `/tickets/g/<id>/` loading `app.js`: `/api/me` 401 must redirect with `next` set to the game path, and `safeNext` must accept it. Test: Task 2.

---

### Task 1: Shell assets

**Files:**
- Create: `assets/app.css`
- Create: `assets/app.js`

**Interfaces:**
- Produces: CSS tokens on `:root` named exactly as `docs/design/todoist-style-reference.md` Quick Start (`--color-ember-red`, `--color-deep-ember`, `--color-cobalt-link`, `--color-ink`, `--color-paper`, `--color-cream`, `--color-stone`, `--color-pencil`, `--color-graphite`, `--color-charcoal`, `--color-mint-wash`, `--color-sky-wash`, `--color-forest`, `--shadow-subtle`, `--shadow-lg`) plus `--wash-red: #fbe7e3` and `--font: 'Inter', ui-sans-serif, system-ui, sans-serif`.
- Produces shell markup contract every page follows:
  ```html
  <body class="app">
    <aside class="side" data-sidebar></aside>
    <main class="main" data-page-title="Today"> … </main>
  </body>
  ```
- Produces component classes: `.page-title`, `.page-sub`, `.sect` (+ `.sect .n`), `.row` (+ `.chk`, `.chk.p1`, `.t`, `.m`, `.act`), `.badge` (+ `.ok`, `.info`, `.wait`), `.btn` (+ `.primary`, `.ghost`), `.tiles` / `.tile` (+ `.k`, `.v`, `.v small`), `.pills` / `.pill` (+ `.on`), `.input`, `.table` (sticky `thead`, hairline rows), `.card`, `.eyebrow`, `.empty`, `.err`, `.wide` (on `main` to lift the 880px cap).
- `app.js` exports nothing; on `DOMContentLoaded` it: renders the sidebar (nav config constant `NAV` with `{ href, label, icon, group?, badge? }`), fetches `/api/me` (401 → `location.href = '/login/?next=' + encodeURIComponent(location.pathname)`), fills avatar initial + username, fetches `/api/confirmations?status=pending` and sets the Approvals badge to `confirmations.length` (hidden when 0 or on error), marks active by `location.pathname.startsWith(href)`, renders the mobile top bar `<div class="topbar">` with a menu button toggling `body.side-open`, and submits sign-out via `fetch('/api/logout', { method: 'POST' })` then `location.href = '/'`.

- [ ] **Step 1: Write `assets/app.css`** — tokens, base (`body.app` grid `240px 1fr`, Paper background, Inter 14px/1.5, `letter-spacing: .07px`), sidebar styles per spec section 1, the component classes above, legacy-class section left empty with a comment `/* legacy page classes restyled in later tasks */`, and the `@media (max-width: 860px)` collapse (sidebar `position: fixed; transform: translateX(-100%)`, `body.side-open .side { transform: none }`, topbar visible).
- [ ] **Step 2: Write `assets/app.js`** per the Interfaces block. Icons: inline SVG strings, 18px, `stroke="currentColor" stroke-width="1.75" fill="none"`: sun (Today), check-circle (Approvals), mail (Mail log), grid (Projects), ticket (Tickets), plane (Trips).
- [ ] **Step 3: Sanity-check syntax** — Run: `node --check assets/app.js` Expected: no output.
- [ ] **Step 4: Commit** — `git add assets/app.css assets/app.js && git commit -m "Add Todoist-style portal shell assets"`.

### Task 2: Routing and redirects

**Files:**
- Modify: `lib/session.js:110-113` (`safeNext`)
- Modify: `middleware.js` (`isPrivatePath`, `subdomainTarget`, the `/mail` branch)
- Modify: `vercel.json`
- Modify: `robots.txt`
- Modify: `api/login.js:18` (no change needed if `safeNext` default changes; verify)
- Test: `lib/auth.test.js`

**Interfaces:**
- Produces: `safeNext(next, fallback = '/today/')` allowing `^/(today|approvals|mail|projects|tickets|trips|login)(/[A-Za-z0-9._-]+)*/?$`.
- Produces: `isPrivatePath(path)` true for `/today`, `/approvals`, `/mail`, `/projects`, `/tickets`, `/trips` (+ subpaths) and the existing API paths; `/bots*` and `/morning*` are no longer private (they redirect).

- [ ] **Step 1: Update tests in `lib/auth.test.js`**
  - `safeNext` test: `safeNext('/today/') === '/today/'`, `safeNext('/approvals/') === '/approvals/'`, `safeNext('/mail/') === '/mail/'`, `safeNext('/tickets/g/chargers-cardinals/') === '/tickets/g/chargers-cardinals/'`, `safeNext('/bots/mail/') === '/today/'`, `safeNext('/') === '/today/'`, `safeNext('https://evil.test/') === '/today/'`, `safeNext('/api/feed') === '/today/'`.
  - Host test: grok `/mail` → `https://ostroff.la/mail/`; grok `/` → `https://ostroff.la/today/`; grok `/api/mail-notes` → `https://ostroff.la/api/mail-notes` (unchanged); tickets host unchanged.
  - New test `middleware 301s old bots paths onto the new portal paths`: `https://ostroff.la/bots/` → 301 `/today/`; `/bots/mail/` → `/mail/`; `/bots/confirm/` → `/approvals/`; `/morning` → `/today/`; `/mail.html` → `/mail/`. (Locations are path-only via `new URL(..., url.origin)` like the existing `/mail` branch.)
  - Stranger test: `https://ostroff.la/today/` → 302 matching `/login/\?next=%2Ftoday%2F`; `https://ostroff.la/tickets/g/rams-giants/` → 302 with `next=%2Ftickets%2Fg%2Frams-giants%2F`.
- [ ] **Step 2: Run tests, expect failures** — Run: `node --test lib/auth.test.js` Expected: the updated assertions FAIL.
- [ ] **Step 3: Implement** — `safeNext` regex + default; `isPrivatePath` new list; in `middleware()` replace the `/mail` branch with a `legacyRedirect(path)` helper returning the new path for `/bots`, `/bots/`, `/bots/mail*`, `/bots/confirm*`, `/morning*`, `/mail`, `/mail.html` (301 to `new URL(dest, url.origin)`); update `subdomainTarget` grok branch to `/today/` and `/mail/`. Add `'/approvals/:path*'`-style entries are not needed: the matcher already catches everything except assets.
- [ ] **Step 4: Run tests** — Run: `npm test` Expected: all pass.
- [ ] **Step 5: `vercel.json`** — grok redirects point at `https://ostroff.la/today/` and `/mail/`; replace apex rules `/mail`→`/bots/mail/`, `/mail.html`→`/bots/mail/`, `/morning`→`/bots/`, `/morning/mail.html`→`/bots/mail/` with `/bots`→`/today/`, `/bots/mail`→`/mail/`, `/bots/confirm`→`/approvals/`, `/morning`→`/today/`, `/morning/:path*`→`/today/`, `/mail.html`→`/mail/`. Validate: `node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'))"`.
- [ ] **Step 6: `robots.txt`** — add `Disallow: /today/`, `/approvals/`, `/mail/`; keep existing lines.
- [ ] **Step 7: Commit** — `git commit -am "Route the portal at /today, /approvals, /mail with 301s from the Bots paths"`.

### Task 3: Login page

**Files:**
- Modify: `login/index.html`

- [ ] **Step 1: Rewrite markup** — `<body class="login">` (no sidebar), fonts link for Inter, `app.css`, the wave SVG from the approved mockup, a `.card` with: mark (`<span class="sq">` red square with white check SVG) + "Ostroff.la", `<p data-lead>`, the existing `form[data-login]` with inputs now `class="input"` and the submit `class="btn primary"`, the existing `p.err[data-err]` / `[data-locked]`, the existing hidden `form[data-create]` and `[data-signed-in]` blocks restyled (signed-in nav links: Today `/today/`, Approvals, Mail log, Projects, Tickets, Trips; "Open portal" primary link to `/today/`), the back link. Keep the inline script; change the `next` regex to `/^\/(today|approvals|mail|projects|tickets|trips)(\/|$)/` and the default `data-next` value and the post-create `location.assign` fallback to `/today/`.
- [ ] **Step 2: Add login styles to `app.css`** — `.login` canvas, `.wave`, `.card.auth` 380px, `.mark`, `.sq`, `.fine`.
- [ ] **Step 3: Verify on dev server** — Run: `node dev-server.js &` then `curl -s localhost:4173/login/ | grep -c 'app.css'` Expected: `1`. Open `http://localhost:4173/login/` in the browser, confirm the card renders and `?err=1` shows the error line.
- [ ] **Step 4: Commit** — `git commit -am "Restyle the admin login as a Todoist-style card"`.

### Task 4: Today page

**Files:**
- Create: `today/index.html`
- Modify: `assets/app.css` (only if a new component is needed)

**Interfaces:**
- Consumes: `/api/tesla-morning` (`display_name`, `battery_level_pct`, `battery_range_mi`, `charge_limit_soc`, `as_of_pt`, `line`, `empty`), `/api/morning-mail` (`rows[]` with `date`, `account`, `action`, `from`, `subject`, `labels`), `/api/confirmations?status=pending` (`confirmations[]` with `id`, `kind`/`action`, `summary`, `expires_at`, `requested_by`), `/api/projects` (`projects[]` with `column`, `name`, `reasons`, `slug`; or `{ empty: true }`).

- [ ] **Step 1: Write `today/index.html`** — shell markup; `<h1 class="page-title">Today</h1>`, `<p class="page-sub" data-sub>`; `.tiles` with three `.tile`s (`data-tile="tesla|mail|needs"`); sections `<section data-sect="needs|mail|projects" hidden>` each with `.sect` heading and a `<div data-list>`. Inline script with functions: `fmtToday()` (Intl weekday/month/day in `America/Los_Angeles`), `expiryLabel(iso)` → `"expires in 2h"` / `"expires in 35m"` / `"expired"` / `"no expiry"`, `isTodayPT(dateStr)`, `esc()`, and four loaders that each `try/catch` and hide their section on error or empty. Approve/Deny PATCH `/api/confirmations` with `{ id, status }` then reload the needs section and the badge (`document.dispatchEvent(new Event('portal:refresh-badge'))`, which `app.js` listens for).
- [ ] **Step 2: Add the `portal:refresh-badge` listener to `app.js`.**
- [ ] **Step 3: Verify** — with no `.data/*.json`, open `http://localhost:4173/today/` signed in: tiles show "No snapshot yet" / "—", all three sections hidden, no console errors. Then create `.data/bot-confirmations.json` with one pending item (expires_at in the past) and one with no expiry; reload: both rows render with "expired" and "no expiry" badges; Approve works.
- [ ] **Step 4: Commit** — `git commit -am "Add the Today roll-up as the portal landing page"`.

### Task 5: Approvals page

**Files:**
- Create: `approvals/index.html` (from `bots/confirm/index.html`)

- [ ] **Step 1: Port** — shell markup, `.pills` filter buttons, rows (`.row`) instead of cards with `.badge` for status (`pending` → `.wait`, `approved` → `.ok`, `denied`/`expired` → plain Pencil text), `<details class="payload">` for the JSON, Approve (`.btn.primary` only on the first pending row, `.btn` on the rest) / Deny (`.btn.ghost`). Replace `alert()` with an inline `<p class="err" data-err>`. Keep `load()`, `render()`, PATCH logic verbatim otherwise.
- [ ] **Step 2: Verify** — filters work, approve/deny updates list and sidebar badge.
- [ ] **Step 3: Commit** — `git commit -am "Move the confirm gate to /approvals in the portal shell"`.

### Task 6: Mail log page

**Files:**
- Create: `mail/index.html` (from `bots/mail/index.html`)

- [ ] **Step 1: Port** — `<main class="main wide">`; keep all script logic (`bootMail`, sorting, inbox/action pills, note form, ACK states). Restyle: pills → `.pills .pill`, table → `.table` (sticky `th` Cream background, Archivo-free: Inter 12px/600 uppercase-less headers, Graphite), `.act.keep` → `.badge.ok`, `.act.archive` → `.badge` plain, Gmail labels → `.badge.info`, note input `.input`, Save `.btn` (not primary; the page has no single dominant action), note-state captions in Graphite. Remove the `Sample/Live` kicker pill; keep the subtitle text.
- [ ] **Step 2: Verify** — sort toggles, filters, save a note locally (`.data/filing-corrections.json` is written).
- [ ] **Step 3: Commit** — `git commit -am "Move the mail log to /mail in the portal shell"`.

### Task 7: Projects board

**Files:**
- Modify: `projects/index.html`

- [ ] **Step 1: Restyle** — shell markup with `main.wide`; delete the `<style>` block's dark palette and the theme chip + its JS (`#theme`, `projects-theme`); keep search, hide-stale, tabs, board, keyboard handling. Page-specific CSS moves into a small `<style>` using tokens: `.board` grid, `.col` on Cream with 8px radius, `.card` Paper + hairline + 4px left bar via `--pc`, `.tag` → badge look, `.attn` → Cream band with Deep Ember eyebrow, column dot colors: needs `#cf3520`, active `#0f66ae`, blocked `#e34432`, quiet `#94928f`. Remove the `.needs` pulse animation (whisper elevation rule).
- [ ] **Step 2: Verify** — board renders with a sample `.data/projects-snapshot.json` (any `projects[]` with `column` values) and without one (shows "No snapshot yet").
- [ ] **Step 3: Commit** — `git commit -am "Restyle the Projects board in the portal shell"`.

### Task 8: Tickets

**Files:**
- Modify: `tickets/index.html`, `tickets/g/*/index.html` (19 files), `tickets/game.js` (class names only if needed)
- Modify: `assets/app.css` (legacy-class section)

- [ ] **Step 1: Season page** — shell markup with `main.wide`; replace the `.page.section-tickets` wrapper, topline, masthead, and nav with `page-title` "Tickets" + `page-sub` (the former tagline); keep `.season`, `.pills`, `.tally`, `.tbl` markup and both scripts untouched.
- [ ] **Step 2: Game pages** — a script-free, one-line-per-file edit: each `tickets/g/<id>/index.html` swaps the `<head>` font/css links for Inter + `app.css`, and the body for shell markup with `<main class="main wide"><div id="game-root"></div><footer class="foot">…</footer></main>` plus the three scripts and the render call. Do this with the Edit tool per file or by writing the 19 files from one template with a small Node script run once (not committed).
- [ ] **Step 3: Legacy styles in `app.css`** — restyle `.season`, `.kicker`, `.tally`, `.tally-card`, `.tally-head`, `.tally-nums` (`.label`, `.num`, `.fine`, `.down`, `.up`), `.tbl`, `.thead`, `.tr`, `.matchup`, `.mark` (+ `.lg`), `.match`, `.when`, `.r`, `.num`, `.opp`, `.status` (→ badge look: plain `.status` = Sky/info, `.status.up` = Mint/ok), `.actions .pills .pill.sm`, `.foot`; and the game page classes emitted by `game.js`: `.crumbs`, `.hero`, `.lede`, `.stats`/`.stat`, `.listings`, `.card-form`, `.label`, `.fine`, `.btn`. Use `grep -o 'class="[^"]*"' tickets/game.js | sort -u` to get the exact list before writing.
- [ ] **Step 4: Verify** — `/tickets/` filters by team, tallies hide/show; `/tickets/g/chargers-raiders/` renders, "Record a sale" saves to localStorage and the row shows Sold on return to the season page.
- [ ] **Step 5: Commit** — `git commit -am "Restyle Tickets and game pages in the portal shell"`.

### Task 9: Trips

**Files:**
- Modify: `trips/index.html`, `trips/japan/index.html`
- Modify: `assets/app.css` (legacy-class section)

- [ ] **Step 1: Trips index** — shell markup; two `.card`s in a 2-column grid (`.cards-2`), each with portrait (`.portrait.sm` 56px round), name, kicker, prose, and `.rows` list rows with chevron.
- [ ] **Step 2: Japan page** — read it, keep content, swap wrapper/head for the shell; restyle its classes (`.hero`, `.itin`, `.leg`, `.mapbox`, `.mapcap`, `.linkrows`, `.callout`, `.tags`) in `app.css`.
- [ ] **Step 3: Verify both render; commit** — `git commit -am "Restyle Trips in the portal shell"`.

### Task 10: Cleanup, home nav, docs

**Files:**
- Delete: `bots/`, `morning/`
- Modify: `index.html:99-110` (signed-in nav), `CLAUDE.md`, `package.json` (no change expected)

- [ ] **Step 1: Delete `bots/` and `morning/`** — redirects from Task 2 cover them. Run `npm test`.
- [ ] **Step 2: Home nav** — the `/api/me`-gated nav in `index.html` becomes one link "Portal →" to `/today/`, same styling.
- [ ] **Step 3: Full manual pass** — on the dev server, visit `/`, `/login/`, `/today/`, `/approvals/`, `/mail/`, `/projects/`, `/tickets/`, `/tickets/g/rams-giants/`, `/trips/`, `/trips/japan/`, `/bots/` (→ 301), `/bots/mail/` (→ 301), `/morning` (→ 301); check the sidebar active state on each and the phone layout at 390px wide.
- [ ] **Step 4: CLAUDE.md** — rewrite the Architecture list for the new paths and shell files, remove `bots/` and `morning/` entries, update the conventions ("one red button per view", "no dark mode", "tokens in app.css", "site.css is public home only"), update the Sections gotcha line, and the dev-server note. Env var section unchanged.
- [ ] **Step 5: Commit and push** — `git add -A && git commit -m "Finish the Todoist-style portal: remove Bots pages, update home nav and docs" && git push`.
