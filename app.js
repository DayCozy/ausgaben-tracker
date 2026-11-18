// Ausgaben-Tracker – speichert alles im localStorage dieses Browsers.
(function () {
  "use strict";

  const STORAGE_KEY = "ausgaben-tracker.v1";
  const MAX_CATS = 8; // 8 Farben in fester Reihenfolge
  const DEFAULT_CATS = [
    "Lebensmittel", "Miete & Wohnen", "Mensa & Essen", "Transport",
    "Uni & Bücher", "Freizeit", "Kleidung", "Sonstiges",
  ];

  const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
  const eurShort = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const monthFmt = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
  const monthLong = new Intl.DateTimeFormat("de-DE", { month: "long" });
  const monthShort = new Intl.DateTimeFormat("de-DE", { month: "short" });
  const dayFmt = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });
  const dateFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const wdFmt = new Intl.DateTimeFormat("de-DE", { weekday: "short" });
  const METHOD_LABEL = { karte: "💳 Karte", bar: "💶 Bar" };
  const METHOD_NAME = { karte: "Karte", bar: "Bar" };

  // ---------- State ----------
  let state = load();
  let viewMode = state.viewMode === "week" ? "week" : "month"; // "week" | "month"
  let viewKey = periodKeyFor(viewMode, new Date()); // Monat: "YYYY-MM", Woche: Montag "YYYY-MM-DD"
  let catFilter = "";
  let methodFilter = "";
  let searchTerm = "";

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (Array.isArray(s.expenses) && Array.isArray(s.categories)) {
          if (!Array.isArray(s.recurring)) s.recurring = [];
          return s;
        }
      }
    } catch (e) { /* leer starten */ }
    return {
      expenses: [],
      categories: DEFAULT_CATS.map((name, i) => ({ id: uid() + i, name, slot: i + 1 })),
      budget: 0,
      recurring: [],   // wiederkehrende Ausgaben (Regeln)
      lastBackup: 0,   // Zeitpunkt des letzten Backups
    };
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { alert("Speichern fehlgeschlagen – ist der Speicher des Browsers voll oder blockiert?"); }
  }

  // ---------- Helpers ----------
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => document.querySelectorAll(sel);
  function monthKey(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
  function keyToDate(k) { const [y, m] = k.split("-").map(Number); return new Date(y, m - 1, 1); }
  function isoDate(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function parseISO(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function todayISO() { return isoDate(new Date()); }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function weekStart(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDays(x, -((x.getDay() + 6) % 7)); } // Montag
  function isoWeek(d) { // Kalenderwoche nach ISO 8601
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const firstThu = new Date(t.getFullYear(), 0, 4);
    return 1 + Math.round(((t - firstThu) / 864e5 - 3 + ((firstThu.getDay() + 6) % 7)) / 7);
  }
  function parseAmount(str) {
    const clean = String(str).trim().replace(/\s|€/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    const n = Number(clean);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  }
  function catById(id) { return state.categories.find((c) => c.id === id); }
  function catColor(c) { return c ? `var(--s${c.slot})` : "var(--muted)"; }
  function esc(s) { return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }
  function sum(list) { return list.reduce((a, e) => a + e.amount, 0); }

  // ---------- Zeiträume (Woche / Monat) ----------
  function periodKeyFor(mode, d) { return mode === "week" ? isoDate(weekStart(d)) : monthKey(d); }
  function periodRange(mode, key) {
    const start = mode === "week" ? parseISO(key) : keyToDate(key);
    const end = mode === "week" ? addDays(start, 7) : new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return { start, end, startISO: isoDate(start), endISO: isoDate(end), days: Math.round((end - start) / 864e5) };
  }
  function shiftPeriod(mode, key, n) {
    const { start } = periodRange(mode, key);
    return mode === "week" ? isoDate(addDays(start, 7 * n)) : monthKey(new Date(start.getFullYear(), start.getMonth() + n, 1));
  }
  function periodLabel(mode, key) {
    if (mode === "month") return monthFmt.format(keyToDate(key));
    const { start } = periodRange(mode, key), last = addDays(start, 6);
    const range = start.getMonth() === last.getMonth()
      ? `${start.getDate()}.–${last.getDate()}. ${monthShort.format(last)}`
      : `${start.getDate()}. ${monthShort.format(start)} – ${last.getDate()}. ${monthShort.format(last)}`;
    return `KW ${isoWeek(start)} · ${range}`;
  }
  function periodName(mode, key) { return mode === "week" ? "KW " + isoWeek(parseISO(key)) : monthLong.format(keyToDate(key)); }
  const WORDS = {
    week: { in: "in der Woche", prev: "Vorwoche", prevNone: "Kein Vergleich zur Vorwoche", this: "diese Woche", trend: "Letzte 8 Wochen", count: 8, budget: "Wochenbudget" },
    month: { in: "im Monat", prev: "Vormonat", prevNone: "Kein Vergleich zum Vormonat", this: "diesen Monat", trend: "Letzte 6 Monate", count: 6, budget: "Monatsbudget" },
  };
  function expensesIn(mode, key) {
    const { startISO, endISO } = periodRange(mode, key);
    return state.expenses.filter((e) => e.date >= startISO && e.date < endISO);
  }
  const current = () => expensesIn(viewMode, viewKey);

  // ---------- Tooltip (Diagramm) ----------
  const tip = $("tooltip");
  function showTip(html, ev) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = ev.clientX + 12, y = ev.clientY - r.height - 10;
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 12;
    if (y < 8) y = ev.clientY + 16;
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  function hideTip() { tip.hidden = true; }
  addEventListener("scroll", hideTip, { passive: true });
  let resizeTimer;
  addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => renderTrend(), 150); });

  // ---------- Tabs ----------
  const TABS = { overview: "page-overview", list: "page-list", settings: "page-settings" };
  function setTab(name) {
    if (!TABS[name]) name = "overview";
    document.body.dataset.tab = name;
    for (const [k, id] of Object.entries(TABS)) $(id).hidden = k !== name;
    for (const t of $$(".tab")) { if (t.dataset.tab === name) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current"); }
    hideTip();
    scrollTo(0, 0);
    if (name === "overview") renderTrend(); // Breite erst messbar, wenn sichtbar
  }
  for (const t of $$(".tab")) t.addEventListener("click", () => setTab(t.dataset.tab));

  // ---------- Render ----------
  function render() {
    const w = WORDS[viewMode];
    for (const el of $$("[data-period-label]")) el.textContent = periodLabel(viewMode, viewKey);
    for (const b of $$("[data-mode]")) b.setAttribute("aria-pressed", String(b.dataset.mode === viewMode));
    for (const b of $$("[data-shift]")) b.setAttribute("aria-label", (b.dataset.shift === "-1" ? (viewMode === "week" ? "Vorherige Woche" : "Vorheriger Monat") : (viewMode === "week" ? "Nächste Woche" : "Nächster Monat")));
    $("statTotalLabel").textContent = "Ausgaben " + w.in;
    $("trendTitle").textContent = w.trend;
    $("listTitle").textContent = "Alle Ausgaben " + w.in;
    renderCategorySelects();
    renderBudget();
    renderStats();
    renderCatRows();
    renderTrend();
    renderList();
    renderRecurring();
    renderSettings();
    renderBackupBanner();
  }

  function renderCategorySelects() {
    const opts = state.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
    const fc = $("filterCat");
    fc.innerHTML = `<option value="">Alle Kategorien</option>` + opts;
    if (catFilter && !catById(catFilter)) catFilter = "";
    fc.value = catFilter;
    const f = $("fCategory"); const prev = f.value;
    f.innerHTML = opts;
    if (prev && catById(prev)) f.value = prev;
  }

  function periodBudget() { return viewMode === "week" ? Math.round(state.budget * 12 / 52 * 100) / 100 : state.budget; }

  function renderBudget() {
    const total = sum(current());
    const budget = periodBudget();
    $("budgetLabel").textContent = WORDS[viewMode].budget;
    const val = $("budgetValue"), meter = $("budgetMeter"), fill = $("budgetFill"), warn = $("budgetWarn");
    if (state.budget > 0) {
      const left = budget - total, ratio = total / budget;
      val.textContent = left >= 0 ? `${eur.format(left)} verfügbar` : `${eur.format(-left)} über Budget`;
      val.classList.toggle("over", left < 0);
      meter.hidden = false;
      fill.style.width = Math.min(100, ratio * 100) + "%";
      fill.classList.toggle("over", ratio > 1);
      $("budgetSub").textContent = `${(ratio * 100).toFixed(0)} % verbraucht · ${eur.format(total)} von ${eur.format(budget)}`
        + (viewMode === "week" ? ` (Anteil von ${eur.format(state.budget)} im Monat)` : "");
      warn.hidden = ratio < 0.8;
      warn.textContent = ratio > 1 ? "⚠ Budget überschritten" : "Budget fast ausgeschöpft";
      $("budgetSet").hidden = true;
    } else {
      val.textContent = "Kein Budget"; val.classList.remove("over");
      meter.hidden = true; warn.hidden = true;
      $("budgetSub").textContent = "Lege fest, wie viel du pro Monat höchstens ausgeben willst.";
      $("budgetSet").hidden = false;
    }
  }

  function renderStats() {
    const w = WORDS[viewMode];
    const cur = current();
    const total = sum(cur);
    const prevTotal = sum(expensesIn(viewMode, shiftPeriod(viewMode, viewKey, -1)));
    $("statTotal").textContent = eur.format(total);

    const lines = [];
    if (prevTotal > 0) {
      const pct = ((total - prevTotal) / prevTotal) * 100;
      lines.push(`${pct > 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)} % ggü. ${w.prev}`);
    } else lines.push(w.prevNone);
    // Aufteilung Karte / Bar (alte Einträge ohne Angabe werden nicht mitgezählt)
    const karte = sum(cur.filter((e) => e.method === "karte"));
    const bar = sum(cur.filter((e) => e.method === "bar"));
    if (karte || bar) lines.push(`💳 ${eur.format(karte)}`, `💶 ${eur.format(bar)}`);
    $("statTotalSub").textContent = lines.join("\n");

    // Durchschnitt pro Tag: laufender Zeitraum bis heute, sonst ganzer Zeitraum
    const range = periodRange(viewMode, viewKey);
    const today = todayISO();
    const isCurrent = today >= range.startISO && today < range.endISO;
    const days = isCurrent ? Math.round((parseISO(today) - range.start) / 864e5) + 1 : range.days;
    $("statAvg").textContent = eur.format(days ? total / days : 0);
    $("statCount").textContent = `${cur.length} ${cur.length === 1 ? "Eintrag" : "Einträge"}` + (isCurrent ? ` · ${days} von ${range.days} Tagen` : "");
  }

  function totalsByCat(list) {
    const map = new Map();
    for (const e of list) map.set(e.categoryId, (map.get(e.categoryId) || 0) + e.amount);
    return [...map.entries()]
      .map(([id, total]) => ({ cat: catById(id), id, total }))
      .sort((a, b) => b.total - a.total);
  }

  function renderCatRows() {
    const cur = current();
    const total = sum(cur);
    const rows = totalsByCat(cur);
    const box = $("catRows");
    if (!rows.length) { box.innerHTML = `<div class="empty">Für ${WORDS[viewMode].this} gibt es noch keine Ausgaben.</div>`; return; }
    box.innerHTML = rows.map((r) => {
      const name = r.cat ? r.cat.name : "Ohne Kategorie";
      const pct = total ? (r.total / total) * 100 : 0;
      return `<button type="button" class="cat-row" data-id="${r.id}" aria-label="${esc(name)}: ${eur.format(r.total)}, ${pct.toFixed(0)} Prozent – Buchungen anzeigen">
        <span class="cat-name"><span class="dot" style="background:${catColor(r.cat)}"></span><span>${esc(name)}</span></span>
        <span class="cat-amt"><b>${eur.format(r.total)}</b><small>${pct.toFixed(0)} %</small></span>
      </button>`;
    }).join("");
  }

  function renderTrend() {
    const box = $("trendChart");
    const n = WORDS[viewMode].count;
    const periods = [];
    for (let i = n - 1; i >= 0; i--) periods.push(shiftPeriod(viewMode, viewKey, -i));
    const totals = periods.map((k) => sum(expensesIn(viewMode, k)));
    $("trendSub").textContent = `${periodName(viewMode, viewKey)} · ${eur.format(totals[totals.length - 1])}`;
    if (!box.clientWidth) return; // Tab nicht sichtbar – wird beim Öffnen gezeichnet
    const W = Math.max(280, Math.min(640, box.clientWidth)), H = 190, padL = 40, padR = 0, padT = 8, padB = 32;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const maxV = niceMax(Math.max(...totals, 1));
    const step = plotW / periods.length;
    const barW = Math.min(44, step * 0.56);
    const y = (v) => padT + plotH - (v / maxV) * plotH;

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ausgaben: ${WORDS[viewMode].trend}">`;
    for (let i = 0; i <= 4; i++) {
      const v = (maxV / 4) * i, yy = y(v);
      if (i > 0) svg += `<line class="gridline" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"/>`;
      svg += `<text class="axis-text" x="${padL - 6}" y="${yy + 4}" text-anchor="end">${eurShort.format(v)}</text>`;
    }
    periods.forEach((k, i) => {
      const cx = padL + step * i + step / 2;
      const v = totals[i], top = y(v), h = padT + plotH - top;
      const r = Math.min(4, h);
      const x0 = cx - barW / 2;
      // Balken mit 4px abgerundeter Oberkante, flach an der Grundlinie
      const path = h > 0
        ? `M${x0},${padT + plotH} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + barW - r} Q${x0 + barW},${top} ${x0 + barW},${top + r} V${padT + plotH} Z`
        : "";
      svg += `<rect class="hit" data-k="${k}" data-v="${v}" data-label="${esc(periodLabel(viewMode, k))}" x="${padL + step * i}" y="${padT}" width="${step}" height="${plotH}"/>`;
      if (path) svg += `<path class="bar${k === viewKey ? "" : " dim"}" d="${path}" pointer-events="none"/>`;
      // Wochen: nur die Nummer, "KW" steht einmal vorne – sonst wird es auf dem Handy zu eng
      const axis = viewMode === "week" ? (i === 0 ? "KW " : "") + isoWeek(parseISO(k)) : monthShort.format(keyToDate(k)).replace(".", "");
      svg += `<text class="axis-text" x="${cx}" y="${H - 12}" text-anchor="middle">${axis}</text>`;
    });
    svg += `<line class="baseline" x1="${padL}" x2="${W - padR}" y1="${padT + plotH}" y2="${padT + plotH}"/></svg>`;
    box.innerHTML = svg;
  }
  function niceMax(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  function renderList() {
    let list = current();
    if (catFilter) list = list.filter((e) => e.categoryId === catFilter);
    if (methodFilter) list = list.filter((e) => e.method === methodFilter);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter((e) => e.note.toLowerCase().includes(q) || (catById(e.categoryId)?.name || "").toLowerCase().includes(q));
    }
    list.sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
    const box = $("list");
    if (!list.length) {
      box.innerHTML = `<div class="empty">${catFilter || methodFilter || searchTerm ? "Keine passenden Ausgaben gefunden." : "Noch nichts eingetragen. Tippe auf „+ Neue Ausgabe“."}</div>`;
      return;
    }
    const groups = new Map();
    for (const e of list) { if (!groups.has(e.date)) groups.set(e.date, []); groups.get(e.date).push(e); }
    box.innerHTML = [...groups.entries()].map(([date, items]) => `<div class="day-group">
        <div class="day-head"><span>${dayFmt.format(parseISO(date))}</span><span>${eur.format(sum(items))}</span></div>
        ${items.map((e) => {
          const c = catById(e.categoryId);
          return `<div class="item">
            <span class="dot" style="background:${catColor(c)}"></span>
            <div class="item-text"><div class="item-note">${e.recurringId ? "🔁 " : ""}${esc(e.note)}</div><div class="item-cat">${esc(c ? c.name : "Ohne Kategorie")}${METHOD_LABEL[e.method] ? " · " + METHOD_LABEL[e.method] : ""}</div></div>
            <span class="item-amt">${eur.format(e.amount)}</span>
            <span class="item-actions">
              <button type="button" class="icon-btn" data-edit="${e.id}" aria-label="Bearbeiten" title="Bearbeiten"><span class="mask" style="--icon:url(icons/bearbeiten.svg)"></span></button>
              <button type="button" class="icon-btn" data-del="${e.id}" aria-label="Löschen" title="Löschen"><span class="mask" style="--icon:url(icons/loeschen.svg)"></span></button>
            </span>
          </div>`;
        }).join("")}
      </div>`).join("");
  }

  function renderSettings() {
    $("setMethod").textContent = METHOD_NAME[state.lastMethod] || "Karte";
    $("setBudget").textContent = state.budget > 0 ? eur.format(state.budget) : "Festlegen";
  }

  // ---------- Wiederkehrende Ausgaben ----------
  // Regel: { id, amount, note, categoryId, method, day (1–31), lastMonth "YYYY-MM" (zuletzt eingetragen) }
  function nextMonthKey(k) { const d = keyToDate(k); return monthKey(new Date(d.getFullYear(), d.getMonth() + 1, 1)); }
  function dateForMonth(k, day) { const d = keyToDate(k); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); return k + "-" + String(Math.min(day, last)).padStart(2, "0"); }
  // Trägt alle fälligen Ausgaben ein (auch nachträglich, falls die App länger nicht offen war). Gibt die Anzahl zurück.
  function runRecurring() {
    const today = todayISO(), thisMonth = today.slice(0, 7);
    let added = 0;
    for (const r of state.recurring) {
      let m = nextMonthKey(r.lastMonth);
      while (m <= thisMonth) {
        const date = dateForMonth(m, r.day);
        if (date > today) break; // noch nicht fällig
        state.expenses.push({ id: uid(), amount: r.amount, note: r.note, date, categoryId: r.categoryId, method: r.method, recurringId: r.id, created: Date.now() + added });
        r.lastMonth = m; added++;
        m = nextMonthKey(m);
      }
    }
    if (added) save();
    return added;
  }
  function renderRecurring() {
    const box = $("recList");
    if (!state.recurring.length) { box.innerHTML = `<div class="empty">Noch keine wiederkehrenden Ausgaben.</div>`; return; }
    box.innerHTML = [...state.recurring].sort((a, b) => a.day - b.day).map((r) => {
      const c = catById(r.categoryId);
      return `<div class="rec-item">
        <span class="dot" style="background:${catColor(c)}"></span>
        <div class="item-text"><div class="item-note">${esc(r.note)}</div>
          <div class="item-cat">Jeden Monat am ${r.day}. · ${esc(c ? c.name : "Ohne Kategorie")}${METHOD_LABEL[r.method] ? " · " + METHOD_LABEL[r.method] : ""}</div></div>
        <span class="item-amt">${eur.format(r.amount)}</span>
        <button type="button" class="icon-btn" data-stop="${r.id}" aria-label="Wiederholung beenden" title="Wiederholung beenden"><span class="mask" style="--icon:url(icons/loeschen.svg)"></span></button>
      </div>`;
    }).join("");
  }
  $("recList").addEventListener("click", (ev) => {
    const id = ev.target.closest("[data-stop]")?.dataset.stop; if (!id) return;
    const r = state.recurring.find((x) => x.id === id); if (!r) return;
    if (!confirm(`„${r.note}“ nicht mehr jeden Monat eintragen?\n\nBereits eingetragene Ausgaben bleiben erhalten.`)) return;
    state.recurring = state.recurring.filter((x) => x.id !== id);
    save(); render();
  });

  // ---------- Backup-Erinnerung ----------
  const BACKUP_DAYS = 7;
  function renderBackupBanner() {
    const banner = $("backupBanner");
    const now = Date.now(), day = 864e5;
    const due = state.expenses.length > 0
      && (!state.lastBackup || now - state.lastBackup > BACKUP_DAYS * day)
      && !(state.backupSnooze && now < state.backupSnooze);
    banner.hidden = !due;
    if (!due) return;
    const days = state.lastBackup ? Math.floor((now - state.lastBackup) / day) : null;
    $("backupText").textContent = days === null
      ? "💾 Du hast noch nie ein Backup gemacht. Sichere deine Ausgaben, damit nichts verloren geht."
      : `💾 Dein letztes Backup ist ${days} Tage her. Zeit für ein neues!`;
  }
  $("backupLater").addEventListener("click", () => { state.backupSnooze = Date.now() + 864e5; save(); renderBackupBanner(); }); // morgen wieder fragen
  $("backupNow").addEventListener("click", () => $("exportJson").click());

  // ---------- Eingabe-Sheet ----------
  const sheet = $("sheet");
  let editingId = null;
  let amountStr = "";
  let method = "karte";

  function setAmountActive(on) {
    $("fAmount").classList.toggle("active", on);
    $("keypad").classList.toggle("hidden", !on);
  }
  function updateAmount() {
    const el = $("fAmount");
    el.textContent = amountStr || "0,00";
    el.classList.toggle("empty", !amountStr);
    validate();
  }
  function validate() {
    const ok = parseAmount(amountStr) > 0 && !!catById($("fCategory").value);
    $("submitBtn").disabled = !ok;
    return ok;
  }
  let replaceOnType = false; // beim Bearbeiten ersetzt die erste Ziffer den alten Betrag
  function pressKey(k) {
    if (replaceOnType) { replaceOnType = false; if (k !== "back") amountStr = ""; }
    const [int, dec] = amountStr.split(",");
    if (k === "back") amountStr = amountStr.slice(0, -1);
    else if (k === ",") { if (!amountStr.includes(",")) amountStr = (amountStr || "0") + ","; }
    else if (/^\d$/.test(k)) {
      if (dec !== undefined) { if (dec.length < 2) amountStr += k; }
      else if (int === "0") amountStr = k;
      else if ((int || "").length < 6) amountStr += k;
    }
    updateAmount();
  }
  $("keypad").addEventListener("click", (ev) => { const b = ev.target.closest("[data-key]"); if (b) pressKey(b.dataset.key); });
  $("fAmount").addEventListener("click", () => { $("fNote").blur(); setAmountActive(true); });
  $("fNote").addEventListener("focus", () => setAmountActive(false));
  $("fNote").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("fNote").blur(); } });

  // Kategorien: zuletzt verwendete als Schnellauswahl
  function recentCats() {
    const seen = [];
    for (const e of [...state.expenses].sort((a, b) => (b.created || 0) - (a.created || 0))) {
      if (catById(e.categoryId) && !seen.includes(e.categoryId)) seen.push(e.categoryId);
      if (seen.length >= 3) break;
    }
    for (const c of state.categories) { if (seen.length >= 3) break; if (!seen.includes(c.id)) seen.push(c.id); }
    return seen;
  }
  function selectCategory(id) {
    $("fCategory").value = id;
    const c = catById(id);
    let chips = recentCats();
    if (!chips.includes(id)) chips = [id, ...chips.slice(0, 2)];
    $("catChips").innerHTML = chips.map((cid) => `<button type="button" class="chip" data-cat="${cid}" aria-pressed="${cid === id}">${esc(catById(cid)?.name || "")}</button>`).join("");
    $("catHint").textContent = `Kategorie: ${c ? c.name : "–"} · Tippen zum Ändern`;
    // Beispieltext: letzte Beschreibung in dieser Kategorie
    const last = [...state.expenses].filter((e) => e.categoryId === id).sort((a, b) => (b.created || 0) - (a.created || 0))[0];
    $("fNote").placeholder = last ? last.note : (c ? c.name : "Wofür?");
    $("noteHint").textContent = "Wofür? · Beispieltext antippen";
    validate();
  }
  $("catChips").addEventListener("click", (ev) => { const b = ev.target.closest("[data-cat]"); if (b) selectCategory(b.dataset.cat); });
  $("fCategory").addEventListener("change", (e) => selectCategory(e.target.value));
  $("noteHint").addEventListener("click", () => { $("fNote").value = $("fNote").placeholder; });

  function setPayMethod(m) {
    method = m === "bar" ? "bar" : "karte";
    for (const b of $$("[data-method]")) b.setAttribute("aria-checked", String(b.dataset.method === method));
  }
  for (const b of $$("[data-method]")) b.addEventListener("click", () => setPayMethod(b.dataset.method));

  function updateDateText() {
    const v = $("fDate").value;
    if (!v) { $("dateText").textContent = "Datum wählen"; return; }
    const d = parseISO(v), t = todayISO(), y = isoDate(addDays(new Date(), -1));
    const prefix = v === t ? "Heute" : v === y ? "Gestern" : wdFmt.format(d).replace(".", "");
    $("dateText").textContent = `${prefix} · ${dateFmt.format(d)}`;
  }
  $("fDate").addEventListener("change", updateDateText);
  $("fDate").addEventListener("input", updateDateText);

  function openSheet(expense) {
    editingId = expense ? expense.id : null;
    $("formTitle").textContent = expense ? "Ausgabe bearbeiten" : "Neue Ausgabe";
    $("submitBtn").textContent = expense ? "Speichern" : "Hinzufügen";
    amountStr = expense ? expense.amount.toFixed(2).replace(".", ",") : "";
    replaceOnType = !!expense;
    $("fNote").value = expense ? expense.note : "";
    $("fDate").value = expense ? expense.date : todayISO(); // Standarddatum: heute
    updateDateText();
    renderCategorySelects();
    const firstCat = expense && catById(expense.categoryId) ? expense.categoryId : (recentCats()[0] || state.categories[0]?.id);
    selectCategory(firstCat);
    setPayMethod(expense ? (expense.method || "karte") : (state.lastMethod || "karte"));
    $("methodHint").textContent = `Bezahlt mit · Zuletzt: ${METHOD_NAME[state.lastMethod] || "Karte"}`;
    $("fRepeat").checked = false;
    $("repeatRow").hidden = !!expense; // Wiederholung nur beim Neuanlegen
    $("formError").textContent = "";
    updateAmount();
    sheet.hidden = false;
    document.body.style.overflow = "hidden";
    setAmountActive(true);
    $("fAmount").focus({ preventScroll: true });
  }
  function closeSheet() {
    sheet.hidden = true;
    document.body.style.overflow = "";
    editingId = null;
    $("fNote").blur();
  }
  $("openSheet").addEventListener("click", () => openSheet());
  $("closeSheet").addEventListener("click", closeSheet);
  sheet.addEventListener("click", (ev) => { if (ev.target === sheet) closeSheet(); });
  document.addEventListener("keydown", (ev) => {
    if (sheet.hidden) return;
    if (ev.key === "Escape") { closeSheet(); return; }
    // Tastatur am Computer: Ziffern gehen in den Betrag, solange das Betragsfeld aktiv ist
    if (document.activeElement === $("fNote") || !$("fAmount").classList.contains("active")) return;
    if (/^\d$/.test(ev.key)) { pressKey(ev.key); ev.preventDefault(); }
    else if (ev.key === "," || ev.key === ".") { pressKey(","); ev.preventDefault(); }
    else if (ev.key === "Backspace") { pressKey("back"); ev.preventDefault(); }
    else if (ev.key === "Enter" && validate()) { $("expenseForm").requestSubmit(); ev.preventDefault(); }
  });

  $("expenseForm").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const amount = parseAmount(amountStr);
    const categoryId = $("fCategory").value;
    const note = $("fNote").value.trim() || $("fNote").placeholder || catById(categoryId)?.name || "Ausgabe";
    const date = $("fDate").value;
    if (!(amount > 0)) { $("formError").textContent = "Bitte einen Betrag größer als 0 eingeben."; setAmountActive(true); return; }
    if (!date) { $("formError").textContent = "Bitte ein Datum wählen."; return; }

    if (editingId) {
      const e = state.expenses.find((x) => x.id === editingId);
      if (e) Object.assign(e, { amount, note, date, categoryId, method });
    } else {
      const exp = { id: uid(), amount, note, date, categoryId, method, created: Date.now() };
      if ($("fRepeat").checked) {
        // Diese Ausgabe ist der erste Eintrag; ab dem nächsten Monat trägt die App sie selbst ein
        const rule = { id: uid(), amount, note, categoryId, method, day: Number(date.slice(8, 10)), lastMonth: date.slice(0, 7) };
        state.recurring.push(rule);
        exp.recurringId = rule.id;
      }
      state.expenses.push(exp);
      if (exp.recurringId) runRecurring(); // liegt das Datum in der Vergangenheit: fehlende Monate nachtragen
    }
    state.lastMethod = method;
    save();
    viewKey = periodKeyFor(viewMode, parseISO(date));
    closeSheet();
    render();
  });

  // ---------- Liste: Bearbeiten / Löschen ----------
  $("list").addEventListener("click", (ev) => {
    const edit = ev.target.closest("[data-edit]");
    const del = ev.target.closest("[data-del]");
    if (edit) {
      const e = state.expenses.find((x) => x.id === edit.dataset.edit);
      if (e) openSheet(e);
    } else if (del) {
      const e = state.expenses.find((x) => x.id === del.dataset.del);
      if (e && confirm(`„${e.note}“ (${eur.format(e.amount)}) wirklich löschen?`)) {
        state.expenses = state.expenses.filter((x) => x.id !== e.id);
        save(); render();
      }
    }
  });

  // ---------- Navigation & Filter ----------
  document.addEventListener("click", (ev) => {
    const shift = ev.target.closest("[data-shift]");
    if (shift) { viewKey = shiftPeriod(viewMode, viewKey, Number(shift.dataset.shift)); render(); return; }
    // Umschalten Woche / Monat: bleibt beim selben Zeitpunkt (heute, falls im Zeitraum, sonst Beginn des Zeitraums)
    const mode = ev.target.closest("[data-mode]");
    if (mode && mode.dataset.mode !== viewMode) {
      const r = periodRange(viewMode, viewKey), today = todayISO();
      const anchor = today >= r.startISO && today < r.endISO ? new Date() : r.start;
      viewMode = mode.dataset.mode;
      viewKey = periodKeyFor(viewMode, anchor);
      state.viewMode = viewMode; save();
      render();
    }
  });
  $("search").addEventListener("input", (e) => { searchTerm = e.target.value.trim(); renderList(); });
  $("filterCat").addEventListener("change", (e) => { catFilter = e.target.value; renderList(); });
  $("filterMethod").addEventListener("change", (e) => { methodFilter = e.target.value; renderList(); });

  // Kategorie in der Übersicht antippen → passende Buchungen zeigen
  $("catRows").addEventListener("click", (ev) => {
    const row = ev.target.closest(".cat-row"); if (!row) return;
    catFilter = row.dataset.id; $("filterCat").value = catFilter;
    renderList(); setTab("list");
  });

  $("trendChart").addEventListener("mousemove", (ev) => {
    const hit = ev.target.closest(".hit");
    if (!hit) return hideTip();
    showTip(`${hit.dataset.label}<br><strong>${eur.format(+hit.dataset.v)}</strong>`, ev);
  });
  $("trendChart").addEventListener("mouseleave", hideTip);
  $("trendChart").addEventListener("click", (ev) => {
    const hit = ev.target.closest(".hit");
    if (hit) { viewKey = hit.dataset.k; render(); }
  });

  // ---------- Budget ----------
  function editBudget() {
    const input = prompt("Wie viel willst du pro Monat höchstens ausgeben? (0 = kein Budget)", state.budget ? String(state.budget).replace(".", ",") : "");
    if (input === null) return;
    const v = input.trim() === "" ? 0 : parseAmount(input);
    if (!(v >= 0)) { alert("Das ist kein gültiger Betrag."); return; }
    state.budget = v; save(); render();
  }
  $("editBudget").addEventListener("click", editBudget);
  $("budgetSet").addEventListener("click", editBudget);

  // ---------- Kategorien verwalten ----------
  const dlg = $("catDialog");
  function renderCatEditor() {
    const used = new Set([...state.expenses, ...state.recurring].map((e) => e.categoryId));
    $("catEditList").innerHTML = state.categories.map((c) => `
      <div class="cat-edit">
        <span class="dot" style="background:${catColor(c)}"></span>
        <input class="field" value="${esc(c.name)}" data-rename="${c.id}" maxlength="24" aria-label="Name der Kategorie">
        <button type="button" data-remove="${c.id}" ${used.has(c.id) ? "disabled title=\"Enthält Ausgaben\"" : "title=\"Löschen\""} aria-label="Kategorie löschen">✕</button>
      </div>`).join("");
    const full = state.categories.length >= MAX_CATS;
    $("newCatName").disabled = full; $("addCat").disabled = full;
    $("newCatName").placeholder = full ? "Maximal 8 Kategorien" : "Neue Kategorie";
  }
  for (const b of $$("[data-open-cats]")) b.addEventListener("click", () => { renderCatEditor(); dlg.showModal(); });
  $("catEditList").addEventListener("change", (ev) => {
    const id = ev.target.dataset.rename; if (!id) return;
    const c = catById(id); const name = ev.target.value.trim();
    if (c && name) { c.name = name; save(); render(); } else if (c) ev.target.value = c.name;
  });
  $("catEditList").addEventListener("click", (ev) => {
    const id = ev.target.closest("[data-remove]")?.dataset.remove; if (!id) return;
    state.categories = state.categories.filter((c) => c.id !== id);
    save(); renderCatEditor(); render();
  });
  function addCategory() {
    const name = $("newCatName").value.trim();
    if (!name || state.categories.length >= MAX_CATS) return;
    const usedSlots = new Set(state.categories.map((c) => c.slot));
    let slot = 1; while (usedSlots.has(slot)) slot++;
    state.categories.push({ id: uid(), name, slot });
    $("newCatName").value = "";
    save(); renderCatEditor(); render();
  }
  $("addCat").addEventListener("click", addCategory);
  $("newCatName").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addCategory(); } });

  // ---------- Export / Import ----------
  function download(name, content, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  $("exportCsv").addEventListener("click", () => {
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const rows = [...state.expenses].sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => [e.date, q(e.note), q(catById(e.categoryId)?.name || ""), METHOD_NAME[e.method] || "", e.amount.toFixed(2).replace(".", ",")].join(";"));
    download("ausgaben.csv", "﻿Datum;Beschreibung;Kategorie;Zahlart;Betrag\n" + rows.join("\n"), "text/csv;charset=utf-8");
  });
  $("exportJson").addEventListener("click", () => {
    state.lastBackup = Date.now(); delete state.backupSnooze;
    save();
    download(`ausgaben-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), "application/json");
    renderBackupBanner();
  });
  $("importJson").addEventListener("change", async (ev) => {
    const file = ev.target.files[0]; ev.target.value = "";
    if (!file) return;
    try {
      const s = JSON.parse(await file.text());
      if (!Array.isArray(s.expenses) || !Array.isArray(s.categories)) throw new Error();
      if (!confirm(`Backup mit ${s.expenses.length} Ausgaben laden? Deine aktuellen Daten werden dabei ersetzt.`)) return;
      state = {
        expenses: s.expenses, categories: s.categories, budget: Number(s.budget) || 0, lastMethod: s.lastMethod || "karte", viewMode,
        recurring: Array.isArray(s.recurring) ? s.recurring : [], lastBackup: Date.now(), // geladenes Backup zählt als aktuell
      };
      runRecurring();
      save(); render();
    } catch (e) { alert("Die Datei ist kein gültiges Backup."); }
  });

  // ---------- Start ----------
  // Browser bitten, die Daten dauerhaft zu behalten (hilft v. a. auf dem iPhone)
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { /* egal */ }
  // Offline-Unterstützung: App auf dem Gerät speichern
  if ("serviceWorker" in navigator) {
    addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => { /* ohne Offline-Modus weiter */ }); });
  }
  runRecurring();
  setTab("overview");
  render();
  // Wenn die App aus dem Hintergrund zurückkommt (z. B. am nächsten Tag): fällige Ausgaben eintragen
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (runRecurring()) render(); else renderBackupBanner();
  });
})();
