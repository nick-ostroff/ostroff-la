# ostroff.la

Family landing page for Nick & Peter Ostroff plus Nick's private portal. Production: https://ostroff.la, deployed on Vercel. Repo: github.com/nick-ostroff/ostroff-la.

Plain static HTML — no framework, no build step. The only runtime dependency is `@vercel/blob` (private store for mail-log notes, binding confirmations, and the Tesla morning snapshot). Single host: ostroff.la. Existing subdomains 301 onto matching paths; do not delete tickets.ostroff.la without confirmation.

## Commands

```bash
node dev-server.js   # local dev at http://localhost:4173 (PORT env var to override)
npm test             # node --test lib/*.test.js
node scripts/build-mail-json.js   # rebuild mail payload from per-box CSVs (not committed)
```

`dev-server.js` serves static files from the repo root (directories resolve to `index.html`), emulates Vercel serverless for `api/*.js`, and runs `middleware.js` (admin session, subdomain 301s, legacy-path 301s, basic-auth stopgap). For a signed-in local session, start it with `ADMIN_SESSION_SECRET=anything MORNING_BASIC_PASSWORD=setup-code node dev-server.js`, then create a local admin on `/login/` (persists to gitignored `.data/users.json`). Local data for the portal pages lives in `.data/*.json` (gitignored).

## Two designs

- **Public home (`/`)** keeps the "Masthead" editorial system from the Claude Design project "Ostroff domain redesign": Newsreader / Archivo / Libre Franklin, paper white, ink `#1a1815`, red `#a63d2f`. Stylesheet: `assets/site.css`. Nothing else loads it.
- **Private portal (everything behind sign-in)** is the Todoist-style system captured in `docs/design/todoist-style-reference.md` (design spec: `docs/superpowers/specs/2026-10-23-todoist-portal-design.md`). Inter only; Paper `#fefdfc` canvas, Cream `#fff6f0` sidebar, Ink `#25221e`, Ember `#e34432` for exactly one filled primary button per view, Cobalt `#0f66ae` for hyperlinks only, badges as pale wash + chromatic text. 8px radii, hairline shadows, light theme only. Tokens and every shared component live in `assets/app.css`; change colors/type there, not inline.

## Architecture

### Portal shell
- `assets/app.css` — tokens on `:root`, shell layout (`body.app` = 240px sidebar + main), components (`.row`, `.badge`, `.btn`, `.tile`, `.pill`, `.input`, `.table`, `.card`), login page styles, legacy class restyles for Tickets (`body.tickets …`) and Trips (`body.trips …`), and the `≤860px` collapse (sidebar slides in behind a top bar).
- `assets/app.js` — renders the sidebar into `<aside class="side" data-sidebar>` from its `NAV` list, fetches `/api/me` (401 → `/login/?next=<path>`), shows the username/initial, fills the Approvals count from `/api/confirmations?status=pending` (re-fetched on the `portal:refresh-badge` DOM event), wires Sign out, and handles the mobile menu. Every private page follows: `<body class="app"><aside class="side" data-sidebar></aside><main class="main" data-page-title="…">…</main>` and loads `app.js` before its own script. Add `wide` to `main` for tables/boards.

### Pages
- `index.html` — public home: topline, masthead, two profile columns, "Recent Writing". No nav/footer/sitemap links to private sections. Signed-in admins get a "Portal →" link to `/today/` via `/api/me`.
- `login/index.html` — admin username/password card. Same `/api/login` form as before; `?next=` must match the portal paths; defaults to `/today/`. First admin is created here (setup code required); additional admins can be created while signed in. Not linked from the public home.
- `today/index.html` — landing page after sign-in. Tiles: Otto/Tesla (`/api/tesla-morning`), mail filed today in Pacific time (`/api/morning-mail`), pending approvals count. Sections, hidden when empty: Needs you (pending confirmations with inline Approve/Deny → `PATCH /api/confirmations`), Mail kept for you (5 newest `action === "keep"` rows), Projects needing a decision (`needs` + `blocked` columns from `/api/projects`). Live data only; no sample content.
- `approvals/index.html` — the confirm gate (was `/bots/confirm/`). Pending / Approved / All pills; Approve/Deny with the admin session. Not Gmail.
- `mail/index.html` — email log (was `/bots/mail/`): sortable table (date, from, subject, keep/archive, Gmail labels, note), inbox pills (ostroff.la / Pixelocity), keep/archive pills, inline note field per row saving to `/api/mail-notes`; terminal notes show `processed` / `failed` / `deduped`.
- `projects/index.html` — Projects board (Needs you / In progress / Blocked / Quiet) from `/api/projects`. Search, hide-stale, keyboard shortcuts, 5-minute refresh, mobile horizontal snap. Light only (the old theme toggle is gone).
- `tickets/index.html`, `tickets/g/<id>/index.html` — Tickets board (keep-vs-list inventory) and 19 game pages; data in `tickets/data.js`, rendering in `tickets/game.js`, sales in `tickets/sales.js` (localStorage; `/api/sales` does not exist). Status is Sold / Listed / Played or Keep/List/Undecided pills. Game pages share one template; regenerate them all if the shell markup changes.
- `trips/index.html`, `trips/japan/index.html` — Trips (two cards; Japan itinerary with route map).
- `unlock/index.html` and `api/unlock.js` — leftovers that 302 to `/login/`.

### Paths and redirects
Private paths: `/today`, `/approvals`, `/mail`, `/projects`, `/tickets`, `/trips` (and subpaths). Old paths 301 permanently (middleware + `vercel.json`): `/bots/` → `/today/`, `/bots/mail/` → `/mail/`, `/bots/confirm/` → `/approvals/`, `/morning*` → `/today/`, `/mail.html` → `/mail/`; grok.ostroff.la `/` → `/today/`, `/mail` → `/mail/`; tickets.ostroff.la and trips.ostroff.la → matching paths. `safeNext` in `lib/session.js` allows exactly the private paths plus `/login`.

### APIs (unchanged contracts)
- `api/feed.js` — `GET /api/feed?who=nick,peter` fetches and merges RSS feeds (`nick` → nickostroff.com/feed.xml, `peter` → peterostroff.com/feed.xml), regex-parsed, newest-first JSON, edge-cached `s-maxage=60, stale-while-revalidate=300`. Unknown `who` → 400; upstream failure → 502. Adding a source = add to the `PEOPLE` map.
- `api/login.js` / `api/logout.js` / `api/me.js` / `api/users.js` — admin accounts. Passwords are PBKDF2 hashes; sessions are HMAC cookies (`ostroff_admin`). Users seed from `ADMIN_USERS_JSON`. Extra users persist to `.data/users.json` locally (gitignored). On Vercel, copy the returned `envSnippet` into `ADMIN_USERS_JSON` so the account survives a deploy. Never commit hashes with real passwords, mail rows, or the Morning password.
- `api/morning-mail.js` — `GET` returns the mail-log JSON plus per-row `notes`. Each row includes `labels` (Gmail labels) and `rule` (internal filer id). Production: private Blob `mail-log.json` first (last 30 days by Gmail Date, rebuilt from the per-box CSVs read-only by `/home/box/shared/mail-log/run.sh` → `node scripts/build-mail-blob.js`, then `vercel blob put`; override window with `MAIL_LOG_DAYS`; full history is ~3.8MB, too close to the 4.5MB function response cap), then fallback Vercel secret `MORNING_MAIL_JSON` (plain JSON or `gz:` + gzip/base64 when the payload exceeds the 64KB env cap). Local: `.data/morning-mail.json` or a rebuild from `gmail-batch/logs/filing-log-ostroff.csv` + `filing-log-pixelocity.csv` (per-box files are source of truth). Do not commit CSVs or the JSON.
- `api/mail-notes.js` — `GET` (Cap/Cliff/Proto feed), `POST` (save a note; admin session only), and `POST`/`PATCH` ACK. Notes reuse the CORRECTION / `filing-corrections.csv` shape plus lifecycle fields (`id`, `account`, `date`, `from`, `subject`, `action`, `rule`, `labels`, `cliff`, `nick`, `note`, `by`, `at`, `key`, `status`, `processed`, `processed_at`, `processed_by`, `detail`). Status is `open` → `processed` | `failed` | `deduped`. `GET ?status=open` returns only open notes. ACK body `{ id, processed: true }` or `{ id, status, detail? }` is allowed with the admin session **or** `Authorization: Bearer <MAIL_NOTES_FEED_TOKEN>` (timing-safe; empty/unset token does not open the endpoint). Re-ACK of a terminal note is 200 + the same note. Missing id → 404; missing auth → 401. Bearer cannot create notes. Local persist: `.data/filing-corrections.json` + `.data/filing-corrections.csv` (gitignored). Production persist: official `@vercel/blob` `put`/`get` with `access: 'private'`, overwriting one pathname (`MAIL_NOTES_BLOB` or `filing-corrections.json`). If `BLOB_READ_WRITE_TOKEN` is set, a failed write returns an error — never `persisted: 'none'`. Do not dump notes into `MAIL_NOTES_JSON` or `MORNING_MAIL_JSON` (64KB env budget). Optional best-effort `MAIL_NOTES_WEBHOOK_URL` POST after a successful save. Optional AgentMail ping if `AGENTMAIL_API_KEY` + `AGENTMAIL_INBOX_ID` are set (not the store). Curl: `docs/mail-notes.md`.
- `api/confirmations.js` — binding confirm-gate outside Gmail. `GET` list/`?id=`/`?status=pending`; `POST` create pending; `PATCH` approve/deny/consume. Shape: `id`, `status` (`pending` | `approved` | `denied` | `expired` | `consumed`), `kind`/`action`, `summary`, `payload`, `requested_by`, `requested_at`, `expires_at`, `decided_by`, `decided_at`, `consumed_at`. Create/list: admin session **or** the mail-notes feed Bearer. Approve/deny: Nick’s session or Cap’s Bearer — Cliff must never auto-approve. Consume only when `approved` and not expired; re-consume is idempotent 200. Persist: private Blob `CONFIRMATIONS_BLOB` or `bot-confirmations.json`; local `.data/bot-confirmations.json`. Same `BLOB_READ_WRITE_TOKEN` as mail-notes. Curl + Cap/Cliff flow: `docs/confirmations.md`.
- `api/tesla-morning.js` — Tesla charge snapshot for the briefing. Otto's schema: `as_of_pt`, `vin_last4`, `display_name`, `battery_level_pct`, `battery_range_mi`, `charge_limit_soc`, `charging_state`, `locked`, `car_version`, `sentry_mode`, `line`. `GET` returns the latest snapshot or `{ empty: true }`; admin session **or** `Authorization: Bearer <TESLA_MORNING_FEED_TOKEN>`. `POST` upserts the snapshot; bearer token only. Persist: private Blob pathname `tesla-morning.json` (`TESLA_MORNING_BLOB` to override); local `.data/tesla-morning.json`.
- `api/projects.js` + `lib/projects.js` — Projects board snapshot, built read-only on the box (`/home/box/shared/projects-board/run.sh`, every 30 min) and uploaded with the Vercel CLI to the private Blob pathname `projects-snapshot.json` (`PROJECTS_SNAPSHOT_BLOB` override); local `.data/projects-snapshot.json`. No project data or registry is committed (public repo).
- `middleware.js` — private paths require an admin session once `ADMIN_SESSION_SECRET` is set. `GET`/`POST`/`PATCH /api/mail-notes` and `/api/confirmations` are also allowed with a matching mail-notes feed bearer (handler still blocks Bearer note-create). `GET`/`POST /api/tesla-morning` is also allowed with `TESLA_MORNING_FEED_TOKEN`. Until the session secret exists, HTTP basic auth (`nick` / `MORNING_BASIC_PASSWORD`) is the fail-closed stopgap, then it is unused. Also does the subdomain and legacy-path 301s.
- `vercel.json` — host 301s for grok.ostroff.la and tickets.ostroff.la, plus the apex legacy-path 301s listed above.
- Static assets: `favicon.svg`, `images/` (portraits), `tickets/teams/` (marks), `robots.txt` (disallows private paths, login, api), `sitemap.xml` (home only).

## Environment variables (Vercel)

- `ADMIN_SESSION_SECRET` — HMAC key for the admin cookie. Set this to turn on admin login and retire basic auth. Rotate to log everyone out.
- `ADMIN_USERS_JSON` — `[{"username":"nick","hash":"…","salt":"…","iter":100000}]`. Production source of truth for admin accounts. Create users in `/login/`; paste the returned snippet here on Vercel.
- `ADMIN_SETUP_TOKEN` — optional. Required to create the first admin if `MORNING_BASIC_PASSWORD` / `FAMILY_PASSCODE` are unset.
- `MORNING_BASIC_PASSWORD` — stopgap HTTP basic-auth password (`nick`, override user with `MORNING_BASIC_USER`) used only until `ADMIN_SESSION_SECRET` is set. Also accepted as the first-admin setup code. Never commit this value.
- `MORNING_MAIL_JSON` — legacy fallback mail-log payload (stale since Aug 30; Blob `mail-log.json` wins when present) for `/api/morning-mail`. Built from the per-box CSVs (`node scripts/build-mail-json.js`). Must include `labels` on each row. If the JSON is over 64KB (Vercel’s env cap), paste the gzip+base64 value from `.data/morning-mail.env` (`gz:…`); the API decompresses it. Not in git (public repo). Fail closed if unset.
- `BLOB_READ_WRITE_TOKEN` — **required in production** so mail notes, confirmations, and the Tesla snapshot survive deploys. Create a **private** Blob store on the Vercel project `pixelocity/ostroff-la` (Storage → Blob → access Private) and connect it to Production. Vercel adds this token; do not invent or commit it. Without it, `POST /api/mail-notes`, `PATCH` ACK, `POST /api/confirmations`, and `POST /api/tesla-morning` return 503.
- `MAIL_NOTES_FEED_TOKEN` — long random secret Nick/Proto generate and set on Vercel. Proto/Cliff `GET` `/api/mail-notes` (and ACK with `PATCH`) and the confirm-gate with `Authorization: Bearer <token>`. Empty/unset keeps those endpoints session-only. Do not use Nick’s login password. Do not commit this value.
- `CONFIRMATIONS_BLOB` — optional Blob pathname for the confirm-gate. Default `bot-confirmations.json`.
- `TESLA_MORNING_FEED_TOKEN` — long random secret Otto uses to `POST` (and optionally `GET`) `/api/tesla-morning`. Empty/unset keeps GET session-only and rejects POST. Do not reuse Nick’s login password or `MAIL_NOTES_FEED_TOKEN`. Do not commit this value.
- `TESLA_MORNING_BLOB` — optional Blob pathname. Default `tesla-morning.json`.
- `MAIL_NOTES_BLOB` — optional Blob pathname. Default `filing-corrections.json`.
- `MAIL_NOTES_WEBHOOK_URL` — optional. After a successful save, POST the new note JSON here (best-effort; save still succeeds if the hook fails).
- `MAIL_NOTES_JSON` — optional seed only (`{"notes":[…]}`). Not the store. Do not paste the growing notes list here (64KB env budget). Not in git.
- `AGENTMAIL_API_KEY` / `AGENTMAIL_INBOX_ID` / `AGENTMAIL_NOTIFY_TO` — optional notify when a note is saved. Not the persist path. Default recipient is `nick.ostroff@agentmail.to`.
- `FAMILY_PASSCODE` / `FAMILY_TOKEN` — unused for gating now. Passcode may still work as the first-admin setup code if the Morning password is unset.

Do not put mail rows or passwords in the public GitHub repo.

## Conventions & gotchas

- **GTM is installed** on the home page (container `GTM-W48S46Z3`) — head snippet plus `<noscript>` iframe right after `<body>`. Preserve both when editing `index.html`.
- Private pages carry `<meta name="robots" content="noindex, nofollow">`; keep it on anything new behind sign-in, and add new private paths to `robots.txt`, `isPrivatePath` in `middleware.js`, `safeNext` in `lib/session.js`, the `next` regex in `login/index.html`, and `NAV` in `assets/app.js`.
- **Portal color discipline:** one filled red button per view (`.btn.primary`); everything else is `.btn` or `.btn.ghost`. Links are Cobalt. Badges are pale washes (`.badge.ok` / `.info` / `.wait`), never saturated fills. No dark mode.
- **Sitemap:** update `<lastmod>` in `sitemap.xml` on meaningful home-page changes. Do not add private pages.
- The public home intentionally uses a centered `max-width: 1080px` wrap — it's a landing page, not an app; the global full-width rule doesn't apply there. Portal list views cap their measure at ~880px; tables and boards use `main.wide`.
- Sections are only Home (public) and the portal (Today, Approvals, Mail log, Projects, Tickets, Trips). Do not invent extra sections.
- tickets.ostroff.la may 301 to `/tickets/`. Do not delete that subdomain without confirmation.
- `lib/confirmations.test.js` has two tests with hard-coded September 2026 expiry dates that fail once the calendar passes them; they are not caused by portal changes.

## Deployment

Vercel, zero config — static files served from the root, `api/*.js` auto-deployed as serverless functions, `middleware.js` as routing middleware. Push to `main` to deploy production.
