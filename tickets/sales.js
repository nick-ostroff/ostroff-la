window.TicketSales = {
  KEY: "tickets.ostroff.la:sales",
  API: "/api/sales",
  today() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  },
  formatDate(soldOn) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(soldOn || "")) return "";
    const [y, m, d] = soldOn.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  },
  methodLabel(method) {
    if (method === "venmo") return "Venmo";
    if (method === "zelle") return "Zelle";
    if (method === "cash") return "Cash";
    return "Other";
  },
  usd(n) { return "$" + Number(n).toLocaleString("en-US"); },
  line(sale) {
    const parts = [this.usd(sale.amount), this.methodLabel(sale.method)];
    if (sale.who) parts.push(sale.who);
    const d = this.formatDate(sale.soldOn || (sale.at ? this.todayFromAt(sale.at) : ""));
    if (d) parts.push(d);
    return parts.join(" · ");
  },
  todayFromAt(at) {
    const dt = new Date(at);
    if (Number.isNaN(dt.getTime())) return "";
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(dt);
  },
  loadCache() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return (parsed && parsed.items) || parsed || {};
    } catch { return {}; }
  },
  saveCache(items) {
    localStorage.setItem(this.KEY, JSON.stringify({ items }));
  },
  async pull() {
    const cached = this.loadCache();
    try {
      const res = await fetch(this.API, { cache: "no-store" });
      if (!res.ok) return cached;
      const data = await res.json();
      const items = data.items && typeof data.items === "object" ? data.items : {};
      const merged = { ...cached, ...items };
      this.saveCache(merged);
      return merged;
    } catch {
      return cached;
    }
  },
  async save(id, draft) {
    const items = this.loadCache();
    const sale = {
      amount: draft.amount,
      who: draft.who,
      method: draft.method,
      at: new Date().toISOString(),
      soldOn: draft.soldOn,
    };
    items[id] = sale;
    this.saveCache(items);
    try {
      await fetch(this.API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...draft }),
      });
    } catch {}
    return sale;
  },
  async clear(id) {
    const items = this.loadCache();
    delete items[id];
    this.saveCache(items);
    try {
      await fetch(this.API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, clear: true }),
      });
    } catch {}
  },
};
