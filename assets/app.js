// ostroff.la private portal shell: sidebar, session, approvals badge, mobile toggle.
// Pages include <aside class="side" data-sidebar></aside> and <main class="main" data-page-title="…">.
(function () {
  'use strict';

  const ICON = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    sun: ICON('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    check: ICON('<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>'),
    mail: ICON('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
    grid: ICON('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
    ticket: ICON('<path d="M3 9a2 2 0 0 0 2-2V6a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v1a2 2 0 0 0 0 4v0a2 2 0 0 0 0 4v1a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-1a2 2 0 0 0-2-2z"/><path d="M12 5v14" stroke-dasharray="2 2"/>'),
    plane: ICON('<path d="M10.5 13.5L3 11l1-2 7 1 4.5-6.5a1.5 1.5 0 0 1 2.5 1.5L14 11l2 7-2 1-3.5-5.5-4 1.5-.5 2.5H5l1-3.5z"/>'),
    out: ICON('<path d="M14 4h5v5M19 4l-8 8M19 14v5H5V5h5"/>'),
    menu: ICON('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  };

  const NAV = [
    { href: '/today/', label: 'Today', icon: 'sun' },
    { href: '/approvals/', label: 'Approvals', icon: 'check', badge: 'approvals' },
    { href: '/mail/', label: 'Mail log', icon: 'mail' },
    { group: 'Boards' },
    { href: '/projects/', label: 'Projects', icon: 'grid' },
    { href: '/tickets/', label: 'Tickets', icon: 'ticket' },
    { href: '/trips/', label: 'Trips', icon: 'plane' },
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function isActive(href) {
    const p = location.pathname;
    return p === href || p.startsWith(href);
  }

  function renderSidebar(aside) {
    const items = NAV.map((n) => {
      if (n.group) return `<div class="group">${esc(n.group).toUpperCase()}</div>`;
      const badge = n.badge ? `<span class="count" data-badge="${esc(n.badge)}" hidden></span>` : '';
      return `<a href="${esc(n.href)}"${isActive(n.href) ? ' class="active" aria-current="page"' : ''}><span class="ic">${ICONS[n.icon] || ''}</span>${esc(n.label)}${badge}</a>`;
    }).join('');
    aside.innerHTML = `
      <div class="who">
        <div class="avatar" data-avatar>·</div>
        <div><div class="name" data-username>&nbsp;</div><div class="sub">ostroff.la</div></div>
      </div>
      <nav aria-label="Portal">${items}</nav>
      <div class="foot">
        <a href="/">ostroff.la ↗</a>
        <button type="button" data-signout>Sign out</button>
      </div>`;
  }

  function renderTopbar(main) {
    const bar = document.createElement('div');
    bar.className = 'topbar';
    const title = main ? main.getAttribute('data-page-title') || document.title : document.title;
    bar.innerHTML = `<button type="button" aria-label="Menu" data-menu>${ICONS.menu}</button><span>${esc(title)}</span>`;
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    document.body.prepend(scrim);
    document.body.prepend(bar);
    const toggle = (on) => document.body.classList.toggle('side-open', on);
    bar.querySelector('[data-menu]').addEventListener('click', () => toggle(!document.body.classList.contains('side-open')));
    scrim.addEventListener('click', () => toggle(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });
  }

  async function loadMe(aside) {
    try {
      const r = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
      if (r.status === 401) {
        location.href = '/login/?next=' + encodeURIComponent(location.pathname);
        return;
      }
      if (!r.ok) return;
      const me = await r.json();
      const name = me.username || '';
      aside.querySelector('[data-username]').textContent = name;
      aside.querySelector('[data-avatar]').textContent = (name[0] || '·').toUpperCase();
    } catch { /* leave placeholders */ }
  }

  async function loadBadge(aside) {
    const el = aside.querySelector('[data-badge="approvals"]');
    if (!el) return;
    try {
      const r = await fetch('/api/confirmations?status=pending', { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      const n = (d.confirmations || []).length;
      el.textContent = String(n);
      el.hidden = n === 0;
    } catch { el.hidden = true; }
  }

  function wireSignout(aside) {
    aside.querySelector('[data-signout]').addEventListener('click', async () => {
      try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch { /* fall through */ }
      location.href = '/';
    });
  }

  function boot() {
    const aside = document.querySelector('[data-sidebar]');
    if (!aside) return;
    renderSidebar(aside);
    renderTopbar(document.querySelector('main'));
    wireSignout(aside);
    loadMe(aside);
    loadBadge(aside);
    document.addEventListener('portal:refresh-badge', () => loadBadge(aside));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
