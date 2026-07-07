# ostroff.la

Family landing page for Nick & Peter Ostroff. Production: https://ostroff.la, deployed on Vercel. Repo: github.com/nick-ostroff/ostroff-la.

Plain static HTML — no framework, no build step, no dependencies (`package.json` exists only for `"type": "module"`).

## Commands

```bash
node dev-server.js   # local dev at http://localhost:4173 (PORT env var to override)
```

`dev-server.js` serves static files from the repo root and emulates Vercel's serverless runtime for `api/*.js` (mocks `res.status()`/`res.json()` and populates `req.query`), so the feed works locally without the Vercel CLI.

## Architecture

- `index.html` — the entire site: markup, all CSS (inline `<style>`), and the feed-rendering JS (inline `<script>`). Two profile cards (Nick, Peter) plus a "Recent writing" section.
- `api/feed.js` — the only serverless function. `GET /api/feed?who=nick,peter` fetches and merges RSS feeds:
  - `nick` → https://nickostroff.com/feed.xml
  - `peter` → https://www.peterostroff.com/feed.xml

  Parses RSS with regex (no XML library), extracts title/link/date/summary/thumbnail, merges and sorts newest-first, returns JSON. Cached at the edge via `Cache-Control: s-maxage=60, stale-while-revalidate=300`. Unknown `who` keys return 400; upstream failures return 502.
- Front-end fetches `/api/feed?who=nick,peter` on load and paginates client-side, 6 posts per "See more" click.
- Static assets: `favicon.svg`, `images/` (portraits), `robots.txt`, `sitemap.xml`.

## Conventions & gotchas

- **Design system lives in `:root` CSS variables** at the top of `index.html` (`--bg`, `--ink`, `--rule`, etc.) with a `prefers-color-scheme: dark` override block — change colors there, not inline. Fonts are Geist / Geist Mono from Google Fonts.
- **Edit `index.html` directly** — there is no templating, bundling, or shared partials. Keep everything self-contained in that one file.
- **Sitemap:** update `<lastmod>` in `sitemap.xml` when making meaningful content changes; add `<url>` entries if new pages are ever added.
- **GTM is installed** (container `GTM-W48S46Z3`) — head snippet plus `<noscript>` iframe right after `<body>`. Preserve both when editing the head/body.
- Adding a feed source = add an entry to the `PEOPLE` map in `api/feed.js` (RSS 2.0 `<item>` format expected).
- This page intentionally uses a centered `max-width: 960px` wrap — it's a landing page, not an app; the global full-width rule doesn't apply here.

## Deployment

Vercel, zero config — static files served from the root, `api/feed.js` auto-deployed as a serverless function. Push to the default branch to deploy production.
