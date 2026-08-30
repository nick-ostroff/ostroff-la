# ostroff.la

Family landing page for Nick & Peter Ostroff. Production: https://ostroff.la, deployed on Vercel. Repo: github.com/nick-ostroff/ostroff-la.

Plain static HTML — no framework, no build step, no dependencies (`package.json` exists only for `"type": "module"`). Single host: ostroff.la. Existing subdomains 301 onto matching paths; do not delete tickets.ostroff.la without confirmation.

## Commands

```bash
node dev-server.js   # local dev at http://localhost:4173 (PORT env var to override)
node --test lib/auth.test.js lib/mail-log.test.js lib/mail-notes.test.js
node scripts/build-mail-json.js   # rebuild mail payload from per-box CSVs (not committed)
```

`dev-server.js` serves static files from the repo root (directories resolve to `index.html`), emulates Vercel serverless for `api/*.js`, and runs `middleware.js` (admin session, subdomain 301s, basic-auth stopgap).

## Architecture

Design is the "Masthead" editorial system from the Claude Design project "Ostroff domain redesign": Newsreader (serif display/body), Archivo (caps labels), Libre Franklin (UI text); paper white, ink `#1a1815`, accents red `#a63d2f` (home), green `#3d6b4f` (Trips), gold `#8a6d2f` (Tickets). Light theme only. Bots keeps the existing dark Morning sample UI.

- `assets/site.css` — the shared stylesheet for every masthead page. Design tokens live in `:root`; `.page.section-trips` / `.page.section-tickets` swap `--accent` and add the colored top rule. Change colors/type here, not inline.
- `index.html` — public home: topline, masthead, two profile columns, "Recent Writing". No nav/footer/sitemap links to private sections. Signed-in admins get a Home / Trips / Tickets / Bots nav via `/api/me`.
- `trips/index.html`, `trips/japan/index.html` — admin Trips pages.
- `tickets/index.html`, `tickets/g/*/index.html` — admin Tickets board (keep-vs-list inventory). Same content as before; served on ostroff.la, not a required subdomain.
- `bots/index.html` — daily briefing (folded from `/morning`).
- `bots/mail/index.html` — email log as a sortable table (date, from, subject, keep/archive, rule, note). Inbox-first: ostroff.la vs Pixelocity, then keep/archive. Default sort is newest Gmail Date first; click a header to sort. Fetches `/api/morning-mail`. Each row has an inline note field; saves go to `/api/mail-notes`.
- `login/index.html` — admin username/password. First admin is created here (setup code required). Additional admins can be created while signed in. Not linked from the public home.
- `unlock/index.html` and `api/unlock.js` — leftovers that 302 to `/login/`.
- `morning/index.html`, `morning/mail.html` — 301/refresh to `/bots/` and `/bots/mail/`.
- `api/feed.js` — `GET /api/feed?who=nick,peter` fetches and merges RSS feeds (`nick` → nickostroff.com/feed.xml, `peter` → peterostroff.com/feed.xml), regex-parsed, newest-first JSON, edge-cached `s-maxage=60, stale-while-revalidate=300`. Unknown `who` → 400; upstream failure → 502. Adding a source = add to the `PEOPLE` map.
- `api/login.js` / `api/logout.js` / `api/me.js` / `api/users.js` — admin accounts. Passwords are PBKDF2 hashes; sessions are HMAC cookies (`ostroff_admin`). Users seed from `ADMIN_USERS_JSON`. Extra users persist to `.data/users.json` locally (gitignored). On Vercel, copy the returned `envSnippet` into `ADMIN_USERS_JSON` so the account survives a deploy. Never commit hashes with real passwords, mail rows, or the Morning password.
- `api/morning-mail.js` — `GET` returns the mail-log JSON plus per-row `notes`. Production: Vercel secret `MORNING_MAIL_JSON`. Local: `.data/morning-mail.json` or a rebuild from `gmail-batch/logs/filing-log-ostroff.csv` + `filing-log-pixelocity.csv` (103 + 65 rows; per-box files are source of truth). Combined `filing-log.csv` is a rebuild, same columns including `rule`, sorted by Gmail Date oldest first. Do not commit CSVs or the JSON.
- `api/mail-notes.js` — admin `GET` (Cap/Cliff feed) and `POST` (save a note). Notes reuse the CORRECTION / `filing-corrections.csv` shape (`from`, `subject`, `cliff`, `nick`, `note` plus row identity). Local persist: `.data/filing-corrections.json` + `.data/filing-corrections.csv` (gitignored). Also reads `gmail-batch/logs/filing-corrections.csv` if present and `MAIL_NOTES_JSON`. On Vercel, writes to Blob when `BLOB_READ_WRITE_TOKEN` is set; otherwise copy the returned `envSnippet` into `MAIL_NOTES_JSON`. Optional AgentMail ping if `AGENTMAIL_API_KEY` + `AGENTMAIL_INBOX_ID` are set (default to `nick.ostroff@agentmail.to`).
- `middleware.js` — private paths (`/trips`, `/tickets`, `/bots`, `/morning`, `/api/morning-mail`, `/api/mail-notes`) require an admin session once `ADMIN_SESSION_SECRET` is set. Until that secret exists, HTTP basic auth (`nick` / `MORNING_BASIC_PASSWORD`) is the fail-closed stopgap, then it is unused. `grok.ostroff.la`, `tickets.ostroff.la`, and `trips.ostroff.la` 301 to the matching ostroff.la path.
- `vercel.json` — host 301s for grok.ostroff.la and tickets.ostroff.la, plus `/morning` → `/bots`.
- Static assets: `favicon.svg`, `images/` (portraits), `robots.txt` (disallows private paths, login, api), `sitemap.xml` (home only).

## Environment variables (Vercel)

- `ADMIN_SESSION_SECRET` — HMAC key for the admin cookie. Set this to turn on admin login and retire basic auth. Rotate to log everyone out.
- `ADMIN_USERS_JSON` — `[{"username":"nick","hash":"…","salt":"…","iter":100000}]`. Production source of truth for admin accounts. Create users in `/login/`; paste the returned snippet here on Vercel.
- `ADMIN_SETUP_TOKEN` — optional. Required to create the first admin if `MORNING_BASIC_PASSWORD` / `FAMILY_PASSCODE` are unset.
- `MORNING_BASIC_PASSWORD` — stopgap HTTP basic-auth password (`nick`, override user with `MORNING_BASIC_USER`) used only until `ADMIN_SESSION_SECRET` is set. Also accepted as the first-admin setup code. Never commit this value.
- `MORNING_MAIL_JSON` — mail-log payload for `/api/morning-mail`. Built from the per-box CSVs (`node scripts/build-mail-json.js`). Not in git (public repo). Fail closed if unset.
- `MAIL_NOTES_JSON` — seed/source for filing notes (`{"notes":[…]}`). Not in git. Local file wins for the same id after a save.
- `BLOB_READ_WRITE_TOKEN` — optional. Lets `/api/mail-notes` persist across Vercel cold starts without pasting `envSnippet`.
- `AGENTMAIL_API_KEY` / `AGENTMAIL_INBOX_ID` / `AGENTMAIL_NOTIFY_TO` — optional notify when a note is saved. Default recipient is `nick.ostroff@agentmail.to`.
- `FAMILY_PASSCODE` / `FAMILY_TOKEN` — unused for gating now. Passcode may still work as the first-admin setup code if the Morning password is unset.

Do not put mail rows or passwords in the public GitHub repo.

## Conventions & gotchas

- **GTM is installed** on the home page (container `GTM-W48S46Z3`) — head snippet plus `<noscript>` iframe right after `<body>`. Preserve both when editing `index.html`.
- Private pages carry `<meta name="robots" content="noindex, nofollow">`; keep it on anything new under `/trips`, `/tickets`, or `/bots`.
- **Sitemap:** update `<lastmod>` in `sitemap.xml` on meaningful home-page changes. Do not add private pages.
- This page intentionally uses a centered `max-width: 1080px` wrap — it's a landing page, not an app; the global full-width rule doesn't apply here.
- Sections are only Home (public), Trips/Tickets (admin), and Bots briefing + mail log (admin). Do not invent extra sections.
- tickets.ostroff.la may 301 to `/tickets/`. Do not delete that subdomain without confirmation.

## Deployment

Vercel, zero config — static files served from the root, `api/*.js` auto-deployed as serverless functions, `middleware.js` as routing middleware. Push to `main` to deploy production.
