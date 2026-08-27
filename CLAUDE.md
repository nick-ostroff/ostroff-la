# ostroff.la

Family landing page for Nick & Peter Ostroff. Production: https://ostroff.la, deployed on Vercel. Repo: github.com/nick-ostroff/ostroff-la.

Plain static HTML — no framework, no build step, no dependencies (`package.json` exists only for `"type": "module"`).

## Commands

```bash
node dev-server.js   # local dev at http://localhost:4173 (PORT env var to override)
```

`dev-server.js` serves static files from the repo root (directories resolve to `index.html`) and emulates Vercel's serverless runtime for `api/*.js` (mocks `res.status()`/`res.json()` and populates `req.query`). `middleware.js` does NOT run locally, so `/trips/` and `/tickets/` are open on the dev server.

## Architecture

Design is the "Masthead" editorial system from the Claude Design project "Ostroff domain redesign": Newsreader (serif display/body), Archivo (caps labels), Libre Franklin (UI text); paper white, ink `#1a1815`, accents red `#a63d2f` (home), green `#3d6b4f` (Trips), gold `#8a6d2f` (Tickets). Light theme only.

- `assets/site.css` — the shared stylesheet for every page. Design tokens live in `:root`; `.page.section-trips` / `.page.section-tickets` swap `--accent` and add the colored top rule. Change colors/type here, not inline.
- `index.html` — home: topline, masthead, nav, two profile columns, "Recent Writing" (feed-driven: 2 featured posts with images + thumb briefs, "More writing" paginates 4 at a time), and the two passcode cards for the family sections.
- `trips/index.html`, `trips/japan/index.html` — family Trips section (static content drafted from the design; "Soon" rows are placeholders).
- `tickets/index.html`, `tickets/cardinals/index.html` — family Tickets section (static data as of 2026-08-26; the Keep/List pills and "Record a sale" form are visual only, not wired up).
- `unlock/index.html` — passcode prompt; reads `?next=` and `?err=`.
- `api/feed.js` — `GET /api/feed?who=nick,peter` fetches and merges RSS feeds (`nick` → nickostroff.com/feed.xml, `peter` → peterostroff.com/feed.xml), regex-parsed, newest-first JSON, edge-cached `s-maxage=60, stale-while-revalidate=300`. Unknown `who` → 400; upstream failure → 502. Adding a source = add to the `PEOPLE` map.
- `api/unlock.js` — `POST` with `code` + `next`; on match sets the `ostroff_family` cookie (1 year, HttpOnly) and 302s to `next` (only `/trips…` or `/tickets…` allowed); otherwise 302s back to `/unlock/?err=1`.
- `middleware.js` — Vercel Routing Middleware on `/trips/*` and `/tickets/*`; redirects to `/unlock/` unless the cookie matches `FAMILY_TOKEN`.
- Static assets: `favicon.svg`, `images/` (portraits), `robots.txt` (disallows the family sections, unlock, api), `sitemap.xml` (home only).

## Environment variables (Vercel)

- `FAMILY_PASSCODE` — what the family types to unlock Trips/Tickets.
- `FAMILY_TOKEN` — random secret stored in the cookie. Rotate to log everyone out.

Both must be set or the family sections stay locked (unlock always fails).

## Conventions & gotchas

- **GTM is installed** on the home page (container `GTM-W48S46Z3`) — head snippet plus `<noscript>` iframe right after `<body>`. Preserve both when editing `index.html`.
- Family pages carry `<meta name="robots" content="noindex, nofollow">`; keep it on anything new under `/trips` or `/tickets`.
- The design mocks reference `trips.ostroff.la` / `tickets.ostroff.la`; the site serves them as `/trips/` and `/tickets/` paths (labels kept for flavor). Subdomains would need Vercel domain config plus path rewrites.
- **Sitemap:** update `<lastmod>` in `sitemap.xml` on meaningful home-page changes. Do not add the family pages.
- This page intentionally uses a centered `max-width: 1080px` wrap — it's a landing page, not an app; the global full-width rule doesn't apply here.

## Deployment

Vercel, zero config — static files served from the root, `api/*.js` auto-deployed as serverless functions, `middleware.js` as routing middleware. Push to `main` to deploy production.
