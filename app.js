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
  const monthShort = new Intl.DateTimeFormat("de-DE", { month: "short" });
  const dayFmt = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });

  // ---------- State ----------
  let state = load();
  let viewMode = state.viewMode === "week" ? "week" : "month"; // "week" | "month"
  let viewKey = periodKeyFor(viewMode, new Date()); // Monat: "YYYY-MM", Woche: Montag "YYYY-MM-DD"
  let editingId = null;
  let catFilter = "";
  let methodFilter = "";
  let searchTerm = "";
  const METHOD_LABEL = { karte: "💳 Karte", bar: "💶 Bar" };
  function getMethod() { return (document.querySelector('input[name="fMethod"]:checked') || {}).value || "karte"; }
  function setMethod(m) { const r = document.querySelector(`input[name="fMethod"][value="${m}"]`); if (r) r.checked = true; }

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
  function periodShort(mode, key) { return mode === "week" ? "KW " + isoWeek(parseISO(key)) : monthShort.format(keyToDate(key)); }
  const WORDS = {
    week: { in: "in der Woche", prev: "Vorwoche", this: "diese Woche", trend: "Letzte 8 Wochen", count: 8 },
    month: { in: "im Monat", prev: "Vormonat", this: "diesen Monat", trend: "Letzte 6 Monate", count: 6 },
  };
  function parseAmount(str) {
    const clean = String(str).trim().replace(/\s|€/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    const n = Number(clean);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  }
  function catById(id) { return state.categories.find((c) => c.id === id); }
  function catColor(c) { return c ? `var(--s${c.slot})` : "var(--muted)"; }
  function esc(s) { return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])); }
  function expensesIn(mode, key) {
    const { startISO, endISO } = periodRange(mode, key);
    return state.expenses.filter((e) => e.date >= startISO && e.date < endISO);
  }
  const current = () => expensesIn(viewMode, viewKey);
  function sum(list) { return list.reduce((a, e) => a + e.amount, 0); }

  // ---------- Tooltip ----------
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

  // ---------- Render ----------
  function render() {
    const w = WORDS[viewMode];
    $("monthLabel").textContent = periodLabel(viewMode, viewKey);
    $("prevMonth").setAttribute("aria-label", viewMode === "week" ? "Vorherige Woche" : "Vorheriger Monat");
    $("nextMonth").setAttribute("aria-label", viewMode === "week" ? "Nächste Woche" : "Nächster Monat");
    for (const b of document.querySelectorAll("[data-mode]")) b.setAttribute("aria-pressed", String(b.dataset.mode === viewMode));
    $("statTotalLabel").textContent = "Ausgaben " + w.in;
    $("trendTitle").textContent = w.trend;
    $("listTitle").textContent = "Alle Ausgaben " + w.in;
    renderCategorySelects();
    renderStats();
    renderCatBars();
    renderTrend();
    renderList();
    renderRecurring();
    renderBackupBanner();
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
        <div class="item-main"><span class="dot" style="background:${catColor(c)}"></span>
          <div class="item-text"><div class="item-note">${esc(r.note)}</div>
          <div class="item-cat">Jeden Monat am ${r.day}. · ${esc(c ? c.name : "Ohne Kategorie")}${METHOD_LABEL[r.method] ? " · " + METHOD_LABEL[r.method] : ""}</div></div>
        </div>
        <span class="item-amt">${eur.format(r.amount)}</span>
        <button data-stop="${r.id}" aria-label="Wiederholung beenden" title="Wiederholung beenden">✕</button>
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

  function renderCategorySelects() {
    const opts = state.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
    const f = $("fCategory"); const prev = f.value;
    f.innerHTML = opts;
    if (prev && catById(prev)) f.value = prev;
    const fc = $("filterCat");
    fc.innerHTML = `<option value="">Alle Kategorien</option>` + opts;
    if (catFilter && !catById(catFilter)) catFilter = "";
    fc.value = catFilter;
  }

  function renderStats() {
    const w = WORDS[viewMode];
    const cur = current();
    const total = sum(cur);
    const prevTotal = sum(expensesIn(viewMode, shiftPeriod(viewMode, viewKey, -1)));
    $("statTotal").textContent = eur.format(total);

    const delta = $("statDelta");
    if (prevTotal > 0) {
      const pct = ((total - prevTotal) / prevTotal) * 100;
      const up = pct > 0;
      delta.className = "stat-sub " + (Math.abs(pct) < 0.5 ? "" : up ? "delta-up" : "delta-down");
      delta.textContent = `${up ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)} % ggü. ${w.prev} (${eur.format(prevTotal)})`;
    } else {
      delta.className = "stat-sub";
      delta.textContent = "Kein Vergleich zur " + w.prev;
      if (viewMode === "month") delta.textContent = "Kein Vergleich zum Vormonat";
    }

    // Aufteilung Karte / Bar (alte Einträge ohne Angabe werden nicht mitgezählt)
    const karte = sum(cur.filter((e) => e.method === "karte"));
    const bar = sum(cur.filter((e) => e.method === "bar"));
    $("statMethod").textContent = karte || bar ? `💳 ${eur.format(karte)} · 💶 ${eur.format(bar)}` : "";

    // Durchschnitt pro Tag: laufender Zeitraum bis heute, sonst ganzer Zeitraum
    const range = periodRange(viewMode, viewKey);
    const today = todayISO();
    const isCurrent = today >= range.startISO && today < range.endISO;
    const days = isCurrent ? Math.round((parseISO(today) - range.start) / 864e5) + 1 : range.days;
    $("statAvg").textContent = eur.format(days ? total / days : 0);
    $("statCount").textContent = `${cur.length} ${cur.length === 1 ? "Eintrag" : "Einträge"}` + (isCurrent ? ` · ${days} von ${range.days} Tagen` : "");

    // Top-Kategorie
    const byCat = totalsByCat(cur);
    const top = byCat[0];
    if (top && top.total > 0) {
      $("statTop").innerHTML = `<span class="dot" style="display:inline-block;background:${catColor(top.cat)};margin-right:6px"></span>${esc(top.cat ? top.cat.name : "Ohne Kategorie")}`;
      $("statTopSub").textContent = `${eur.format(top.total)} · ${((top.total / total) * 100).toFixed(0)} % der Ausgaben`;
    } else {
      $("statTop").textContent = "–";
      $("statTopSub").textContent = "Noch keine Ausgaben";
    }

    // Budget
    const meter = $("budgetMeter"), fill = $("budgetFill");
    // In der Wochenansicht: Wochenanteil des Monatsbudgets (Monatsbudget × 12 ÷ 52)
    const budget = viewMode === "week" ? Math.round(state.budget * 12 / 52 * 100) / 100 : state.budget;
    $("budgetLabel").textContent = viewMode === "week" ? "Wochenbudget" : "Monatsbudget";
    if (state.budget > 0) {
      const left = budget - total;
      const ratio = total / budget;
      $("statBudget").textContent = eur.format(left);
      meter.hidden = false;
      fill.style.width = Math.min(100, ratio * 100) + "%";
      fill.classList.toggle("over", ratio > 1);
      $("statBudgetSub").textContent = (left >= 0
        ? `übrig von ${eur.format(budget)} (${(ratio * 100).toFixed(0)} % verbraucht)`
        : `⚠ ${eur.format(-left)} über dem Budget von ${eur.format(budget)}`)
        + (viewMode === "week" ? ` · Anteil von ${eur.format(state.budget)} im Monat` : "");
    } else {
      $("statBudget").textContent = "–";
      meter.hidden = true;
      $("statBudgetSub").textContent = "Noch kein Budget festgelegt";
    }
  }

  function totalsByCat(list) {
    const map = new Map();
    for (const e of list) map.set(e.categoryId, (map.get(e.categoryId) || 0) + e.amount);
    return [...map.entries()]
      .map(([id, total]) => ({ cat: catById(id), id, total }))
      .sort((a, b) => b.total - a.total);
  }

  function renderCatBars() {
    const cur = current();
    const total = sum(cur);
    const rows = totalsByCat(cur);
    const box = $("catBars");
    if (!rows.length) { box.innerHTML = `<div class="empty">Für ${WORDS[viewMode].this} gibt es noch keine Ausgaben.</div>`; return; }
    const max = rows[0].total;
    box.innerHTML = rows.map((r) => {
      const name = r.cat ? r.cat.name : "Ohne Kategorie";
      const pct = total ? (r.total / total) * 100 : 0;
      return `<div class="cat-row${catFilter === r.id ? " active" : ""}" data-id="${r.id}" data-name="${esc(name)}" data-total="${r.total}" data-pct="${pct}" title="Klicken zum Filtern">
        <span class="cat-name"><span class="dot" style="background:${catColor(r.cat)}"></span>${esc(name)}</span>
        <span class="cat-track"><span class="cat-bar" style="display:block;width:${(r.total / max) * 100}%;background:${catColor(r.cat)}"></span></span>
        <span class="cat-amt">${eur.format(r.total)}<small>${pct.toFixed(0)} %</small></span>
      </div>`;
    }).join("");
  }

  function renderTrend() {
    const n = WORDS[viewMode].count;
    const months = []; // Zeiträume (Monate oder Wochen)
    for (let i = n - 1; i >= 0; i--) months.push(shiftPeriod(viewMode, viewKey, -i));
    const totals = months.map((k) => sum(expensesIn(viewMode, k)));
    // Breite an den Platz anpassen, damit die Schrift auf dem Handy nicht schrumpft
    const W = Math.max(280, Math.min(640, $("trendChart").clientWidth || 520)), H = 220, padL = 44, padR = 8, padT = 18, padB = 26;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const maxV = niceMax(Math.max(...totals, 1));
    const step = plotW / months.length;
    const barW = Math.min(44, step * 0.56);
    const y = (v) => padT + plotH - (v / maxV) * plotH;

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ausgaben: ${WORDS[viewMode].trend}">`;
    for (let i = 0; i <= 4; i++) {
      const v = (maxV / 4) * i, yy = y(v);
      if (i > 0) svg += `<line class="gridline" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"/>`;
      svg += `<text class="axis-text" x="${padL - 6}" y="${yy + 4}" text-anchor="end">${eurShort.format(v)}</text>`;
    }
    months.forEach((k, i) => {
      const cx = padL + step * i + step / 2;
      const v = totals[i], top = y(v), h = padT + plotH - top;
      const r = Math.min(4, h);
      const x0 = cx - barW / 2;
      // Balken mit 4px abgerundeter Oberkante, flach an der Grundlinie
      const path = h > 0
        ? `M${x0},${padT + plotH} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + barW - r} Q${x0 + barW},${top} ${x0 + barW},${top + r} V${padT + plotH} Z`
        : "";
      const label = periodLabel(viewMode, k);
      svg += `<rect class="hit" data-k="${k}" data-v="${v}" data-label="${esc(label)}" x="${padL + step * i}" y="${padT}" width="${step}" height="${plotH}"/>`;
      if (path) svg += `<path class="bar${k === viewKey ? "" : " dim"}" d="${path}" pointer-events="none"/>`;
      if (k === viewKey && v > 0) svg += `<text class="val-text" x="${cx}" y="${top - 6}" text-anchor="middle">${eurShort.format(v)}</text>`;
      // Wochen: nur die Nummer, "KW" steht einmal vorne – sonst wird es auf dem Handy zu eng
      const axis = viewMode === "week" ? (i === 0 ? "KW " : "") + isoWeek(parseISO(k)) : periodShort(viewMode, k);
      svg += `<text class="axis-text" x="${cx}" y="${H - 8}" text-anchor="middle">${axis}</text>`;
    });
    svg += `<line class="baseline" x1="${padL}" x2="${W - padR}" y1="${padT + plotH}" y2="${padT + plotH}"/></svg>`;
    $("trendChart").innerHTML = svg;
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
      box.innerHTML = `<div class="empty">${catFilter || methodFilter || searchTerm ? "Keine passenden Ausgaben gefunden." : "Noch nichts eingetragen. Füge links deine erste Ausgabe hinzu."}</div>`;
      return;
    }
    const groups = new Map();
    for (const e of list) { if (!groups.has(e.date)) groups.set(e.date, []); groups.get(e.date).push(e); }
    box.innerHTML = [...groups.entries()].map(([date, items]) => {
      const [yy, mm, dd] = date.split("-").map(Number);
      return `<div class="day-group">
        <div class="day-head"><span>${dayFmt.format(new Date(yy, mm - 1, dd))}</span><span>${eur.format(sum(items))}</span></div>
        ${items.map((e) => {
          const c = catById(e.categoryId);
          return `<div class="item">
            <div class="item-main"><span class="dot" style="background:${catColor(c)}"></span>
              <div class="item-text"><div class="item-note">${e.recurringId ? "🔁 " : ""}${esc(e.note)}</div><div class="item-cat">${esc(c ? c.name : "Ohne Kategorie")}${METHOD_LABEL[e.method] ? " · " + METHOD_LABEL[e.method] : ""}</div></div>
            </div>
            <span class="item-amt">${eur.format(e.amount)}</span>
            <span class="item-actions">
              <button data-edit="${e.id}" aria-label="Bearbeiten" title="Bearbeiten">✎</button>
              <button data-del="${e.id}" aria-label="Löschen" title="Löschen">🗑</button>
            </span>
          </div>`;
        }).join("")}
      </div>`;
    }).join("");
  }

  // ---------- Formular ----------
  function resetForm() {
    editingId = null;
    $("expenseForm").reset();
    const r = periodRange(viewMode, viewKey), today = todayISO();
    $("fDate").value = today >= r.startISO && today < r.endISO ? today : r.startISO;
    setMethod(state.lastMethod || "karte"); // zuletzt genutzte Zahlart vorauswählen
    $("fRepeat").checked = false;
    $("repeatRow").classList.remove("hidden");
    $("formTitle").textContent = "Neue Ausgabe";
    $("submitBtn").textContent = "Hinzufügen";
    $("cancelEdit").classList.add("hidden");
    $("formError").textContent = "";
  }

  $("expenseForm").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const amount = parseAmount($("fAmount").value);
    const note = $("fNote").value.trim();
    const date = $("fDate").value;
    const categoryId = $("fCategory").value;
    const method = getMethod();
    if (!(amount > 0)) { $("formError").textContent = "Bitte einen gültigen Betrag größer als 0 eingeben."; $("fAmount").focus(); return; }
    if (!note) { $("formError").textContent = "Bitte kurz beschreiben, wofür das Geld war."; return; }
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
    const keepCat = categoryId;
    resetForm();
    $("fCategory").value = keepCat;
    render();
    $("fAmount").focus();
  });

  $("cancelEdit").addEventListener("click", resetForm);

  $("list").addEventListener("click", (ev) => {
    const edit = ev.target.closest("[data-edit]");
    const del = ev.target.closest("[data-del]");
    if (edit) {
      const e = state.expenses.find((x) => x.id === edit.dataset.edit);
      if (!e) return;
      editingId = e.id;
      $("fAmount").value = String(e.amount).replace(".", ",");
      $("fNote").value = e.note;
      $("fDate").value = e.date;
      $("fCategory").value = e.categoryId;
      setMethod(e.method || "karte");
      $("fRepeat").checked = false;
      $("repeatRow").classList.add("hidden"); // Wiederholung nur beim Neuanlegen
      $("formTitle").textContent = "Ausgabe bearbeiten";
      $("submitBtn").textContent = "Speichern";
      $("cancelEdit").classList.remove("hidden");
      $("formCard").scrollIntoView({ behavior: "smooth", block: "start" });
      $("fAmount").focus();
    } else if (del) {
      const e = state.expenses.find((x) => x.id === del.dataset.del);
      if (e && confirm(`„${e.note}“ (${eur.format(e.amount)}) wirklich löschen?`)) {
        state.expenses = state.expenses.filter((x) => x.id !== e.id);
        if (editingId === e.id) resetForm();
        save(); render();
      }
    }
  });

  // ---------- Navigation & Filter ----------
  $("prevMonth").addEventListener("click", () => { viewKey = shiftPeriod(viewMode, viewKey, -1); if (!editingId) resetForm(); render(); });
  $("nextMonth").addEventListener("click", () => { viewKey = shiftPeriod(viewMode, viewKey, 1); if (!editingId) resetForm(); render(); });
  // Umschalten Woche / Monat: bleibt beim selben Zeitpunkt (heute, falls im Zeitraum, sonst Beginn des Zeitraums)
  $("viewToggle").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-mode]");
    if (!b || b.dataset.mode === viewMode) return;
    const r = periodRange(viewMode, viewKey), today = todayISO();
    const anchor = today >= r.startISO && today < r.endISO ? new Date() : r.start;
    viewMode = b.dataset.mode;
    viewKey = periodKeyFor(viewMode, anchor);
    state.viewMode = viewMode; save();
    if (!editingId) resetForm();
    render();
  });
  $("search").addEventListener("input", (e) => { searchTerm = e.target.value.trim(); renderList(); });
  $("filterCat").addEventListener("change", (e) => { catFilter = e.target.value; renderCatBars(); renderList(); });
  $("filterMethod").addEventListener("change", (e) => { methodFilter = e.target.value; renderList(); });

  $("catBars").addEventListener("click", (ev) => {
    const row = ev.target.closest(".cat-row");
    if (!row) return;
    catFilter = catFilter === row.dataset.id ? "" : row.dataset.id;
    $("filterCat").value = catFilter;
    renderCatBars(); renderList();
  });
  $("catBars").addEventListener("mousemove", (ev) => {
    const row = ev.target.closest(".cat-row");
    if (!row) return hideTip();
    showTip(`${esc(row.dataset.name)}<br><strong>${eur.format(+row.dataset.total)}</strong> · ${(+row.dataset.pct).toFixed(1)} %`, ev);
  });
  $("catBars").addEventListener("mouseleave", hideTip);

  $("trendChart").addEventListener("mousemove", (ev) => {
    const hit = ev.target.closest(".hit");
    if (!hit) return hideTip();
    showTip(`${hit.dataset.label}<br><strong>${eur.format(+hit.dataset.v)}</strong>`, ev);
  });
  $("trendChart").addEventListener("mouseleave", hideTip);
  $("trendChart").addEventListener("click", (ev) => {
    const hit = ev.target.closest(".hit");
    if (hit) { viewKey = hit.dataset.k; if (!editingId) resetForm(); render(); }
  });

  // ---------- Budget ----------
  $("editBudget").addEventListener("click", () => {
    const input = prompt("Wie viel willst du pro Monat höchstens ausgeben? (0 = kein Budget)", state.budget ? String(state.budget).replace(".", ",") : "");
    if (input === null) return;
    const v = input.trim() === "" ? 0 : parseAmount(input);
    if (!(v >= 0)) { alert("Das ist kein gültiger Betrag."); return; }
    state.budget = v; save(); renderStats();
  });

  // ---------- Kategorien verwalten ----------
  const dlg = $("catDialog");
  function renderCatEditor() {
    const used = new Set([...state.expenses, ...state.recurring].map((e) => e.categoryId));
    $("catEditList").innerHTML = state.categories.map((c) => `
      <div class="cat-edit">
        <span class="dot" style="background:${catColor(c)}"></span>
        <input value="${esc(c.name)}" data-rename="${c.id}" maxlength="24" aria-label="Name der Kategorie">
        <button type="button" data-remove="${c.id}" ${used.has(c.id) ? "disabled title=\"Enthält Ausgaben\"" : "title=\"Löschen\""} aria-label="Kategorie löschen">✕</button>
      </div>`).join("");
    const full = state.categories.length >= MAX_CATS;
    $("newCatName").disabled = full; $("addCat").disabled = full;
    $("newCatName").placeholder = full ? "Maximal 8 Kategorien" : "Neue Kategorie";
  }
  $("manageCats").addEventListener("click", () => { renderCatEditor(); dlg.showModal(); });
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
      .map((e) => [e.date, q(e.note), q(catById(e.categoryId)?.name || ""), { karte: "Karte", bar: "Bar" }[e.method] || "", e.amount.toFixed(2).replace(".", ",")].join(";"));
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
      save(); resetForm(); render();
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
  resetForm();
  render();
  // Wenn die App aus dem Hintergrund zurückkommt (z. B. am nächsten Tag): fällige Ausgaben eintragen
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (runRecurring()) render(); else renderBackupBanner();
  });
})();
