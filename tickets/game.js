window.TicketGame = {
  usd(n) { return "$" + Number(n).toLocaleString("en-US"); },
  slug(name) { return String(name || "").trim().toLowerCase(); },
  mark(name) {
    const s = this.slug(name);
    return s ? `<img class="mark" src="/tickets/teams/${s}.svg" alt="" />` : "";
  },
  find(id) {
    for (const team of window.TICKET_TEAMS || []) {
      for (const game of team.games) {
        if (game.id === id) return { team, game };
      }
    }
    return null;
  },
  when(game) { return [game.dateLabel, game.timeLabel, game.note].filter(Boolean).join(" · "); },
  listingLine(listing) {
    if (!listing) return "";
    return this.usd(listing.askEach) + "/ea \u00b7 TM #" + listing.tm + " \u00b7 payout " + this.usd(listing.payoutEach) + " ea";
  },
  kind(game) {
    if (game.kind === "preseason") return "Preseason";
    if (game.kind === "regular") return "Regular";
    return null;
  },
  async render(id) {
    const found = this.find(id);
    const root = document.getElementById("game-root");
    if (!found) {
      document.title = "Not found — Tickets — Ostroff.LA";
      root.innerHTML = `<div class="crumbs"><a href="/tickets/">\u2190 Tickets</a></div>
        <header class="hero"><div><h1>Not found</h1><p class="lede">That game is not in the season list.</p></div></header>`;
      return;
    }
    const sales = window.TicketSales ? await window.TicketSales.pull() : {};
    const { team, game } = found;
    const live = sales[game.id] || game.sold || null;
    const title = team.name + " vs " + game.opponent;
    document.title = title + " \u2014 Tickets \u2014 Ostroff.LA";
    const kicker = [this.kind(game), this.when(game), "SoFi Stadium"].filter(Boolean).join(" \u00b7 ");
    const seats = "Section " + team.section + " \u00b7 Row " + team.row + " \u00b7 Seats " + team.seats + " \u00b7 Qty " + team.qty;
    const m = game.market;
    const opp = m ? m.pairLow - game.pairPrice : null;
    const oppClass = opp == null ? "" : opp >= 0 ? "up" : "down";
    const oppText = opp == null ? "\u2014" : (opp >= 0 ? "+" : "\u2212") + this.usd(Math.abs(opp));
    const saleLine = live ? window.TicketSales.line(live) : "";
    const listing = !live && game.listing ? game.listing : null;
    const status = live
      ? `<span class="status up">Sold</span><div class="fine">${saleLine}</div>`
      : listing
        ? `<span class="status">Listed</span><div class="fine">${this.listingLine(listing)}</div>`
        : game.played
          ? `<span class="status">Played</span>`
          : `<div class="pills"><span class="pill on">Undecided</span><span class="pill">Keep</span><span class="pill">List</span></div>`;
    const askBig = m ? this.usd(m.pairLow) : "\u2014";
    const askFine = m ? "Median " + this.usd(m.pairMedian) + " \u00b7 fees extra" : "No section ask yet";
    const seatFine = m ? m.cheapestLine : "No listing pulled";
    const research = m
      ? `<div class="label" style="margin-bottom:16px">${team.section} \u00b7 ${m.listings} listings \u00b7 as of ${m.asOf}</div>
         <div class="listings">
           <div class="lh"><span>Cheapest in section</span><span></span><span></span><span style="text-align:right">Pair</span></div>
           <div class="best"><span>${m.cheapestLine}</span><span></span><span></span><span style="text-align:right; font-weight:700">${this.usd(m.pairLow)}</span></div>
         </div>
         <p class="fineprint">Research, not checkout. Only the cheapest listing we pulled.
           ${m.url ? `<a href="${m.url}" target="_blank" rel="noopener">StubHub event</a>.` : ""}</p>`
      : `<div class="label" style="margin-bottom:16px">Section ${team.section}</div>
         <p class="fineprint">${game.played ? "Played. No market." : "No section ask pulled for this game."}</p>`;
    const today = window.TicketSales.today();
    let form;
    if (live) {
      form = `<div class="label" style="margin-bottom:16px">Sale</div>
         <div class="card-form"><div class="label">Recorded</div>
         <p class="prose" style="margin:0">${saleLine}</p>
         <button type="button" class="btn" data-clear-sale>Clear sale</button></div>`;
    } else if (game.played) {
      form = `<div class="label" style="margin-bottom:16px">Sale</div><p class="fineprint">Played. Nothing to record.</p>`;
    } else {
      form = `<div class="label" style="margin-bottom:16px">Record a sale</div>
           <form class="card-form" data-sale-form>
             <div><div class="label">Sold for (pair)</div><input name="amount" type="text" inputmode="decimal" placeholder="$ \u2014" required /></div>
             <div><div class="label">Method</div>
               <div class="pills" data-methods>
                 <button type="button" class="pill md ink" data-method="venmo">Venmo</button>
                 <button type="button" class="pill md" data-method="zelle">Zelle</button>
                 <button type="button" class="pill md" data-method="cash">Cash</button>
               </div></div>
             <div><div class="label">Buyer</div><input name="who" type="text" placeholder="Name" /></div>
             <div><div class="label">Sale date</div><input name="soldOn" type="date" value="${today}" required /></div>
             <button type="submit" class="btn solid">Record sale</button>
             <p class="fineprint" data-sale-err hidden></p>
           </form>`;
    }
    root.innerHTML = `
      <div class="crumbs">
        <a href="/tickets/">\u2190 ${team.name} ${team.season}</a><span>/</span><span class="here">vs ${game.opponent}</span>
      </div>
      <header class="hero">
        <div>
          <div class="hero-marks">${this.mark(team.name)}${this.mark(game.opponent)}</div>
          <h1 style="font-size:clamp(36px, 6vw, 56px)">${title}</h1>
          <div class="kicker">${kicker}</div>
          <div class="note">${seats}</div>
        </div>
        <div>${status}</div>
      </header>
      <div class="stats">
        <div class="stat"><div class="label">Paid</div><div class="big">${this.usd(game.pairPrice)}</div><div class="fine">Invoice pair \u00b7 handling ${this.usd(team.handling)}</div></div>
        <div class="stat"><div class="label">Ask \u00b7 Section ${team.section} \u00d7 2</div><div class="big">${askBig}</div><div class="fine">${askFine}</div></div>
        <div class="stat"><div class="label">Opportunity</div><div class="big ${oppClass}">${oppText}</div><div class="fine">Ask \u2212 paid \u00b7 before fees</div></div>
        <div class="stat"><div class="label">Seat line</div><div class="big">${m ? this.usd(m.pairLow) : "\u2014"}</div><div class="fine">${seatFine}</div></div>
      </div>
      <div class="game"><section>${research}</section><aside>${form}</aside></div>`;
    this.bind(id, root);
  },
  bind(id, root) {
    const form = root.querySelector("[data-sale-form]");
    if (form) {
      let method = "venmo";
      form.querySelectorAll("[data-method]").forEach((btn) => {
        btn.addEventListener("click", () => {
          method = btn.dataset.method;
          form.querySelectorAll("[data-method]").forEach((b) => b.classList.toggle("ink", b === btn));
        });
      });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const err = form.querySelector("[data-sale-err]");
        const amount = Number(String(form.amount.value || "").replace(/[$,]/g, ""));
        const soldOn = form.soldOn.value;
        if (!Number.isFinite(amount) || amount < 0) {
          err.hidden = false;
          err.textContent = "Enter a pair amount.";
          return;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(soldOn)) {
          err.hidden = false;
          err.textContent = "Pick a sale date.";
          return;
        }
        err.hidden = true;
        await window.TicketSales.save(id, {
          amount,
          who: form.who.value.trim(),
          method,
          soldOn,
        });
        this.render(id);
      });
    }
    const clear = root.querySelector("[data-clear-sale]");
    if (clear) {
      clear.addEventListener("click", async () => {
        await window.TicketSales.clear(id);
        this.render(id);
      });
    }
  },
};
