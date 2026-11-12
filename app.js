import * as C from './calc.js';

const APP_VERSION = '1.0.0';

// ---------- Speicher (IndexedDB, Fallback localStorage) ----------
const DB_NAME = 'arbeitszeit';
const KEY = 'state';

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function loadState() {
  try {
    const db = await idb();
    const v = await new Promise((res, rej) => {
      const t = db.transaction('kv').objectStore('kv').get(KEY);
      t.onsuccess = () => res(t.result);
      t.onerror = () => rej(t.error);
    });
    if (v) return v;
  } catch (e) {
    try {
      const s = localStorage.getItem(DB_NAME);
      if (s) return JSON.parse(s);
    } catch (_) {}
  }
  return null;
}
let persistAsked = false;
async function saveState() {
  const data = JSON.parse(JSON.stringify(state));
  try {
    const db = await idb();
    await new Promise((res, rej) => {
      const t = db.transaction('kv', 'readwrite');
      t.objectStore('kv').put(data, KEY);
      t.oncomplete = res;
      t.onerror = () => rej(t.error);
    });
  } catch (e) {
    try { localStorage.setItem(DB_NAME, JSON.stringify(data)); } catch (_) {}
  }
  if (!persistAsked && navigator.storage && navigator.storage.persist) {
    persistAsked = true;
    try { await navigator.storage.persist(); } catch (_) {}
  }
}

function migrate(s) {
  const d = C.defaultState();
  if (!s || typeof s !== 'object') return d;
  return {
    ...d,
    ...s,
    settings: { ...d.settings, ...(s.settings || {}) },
    plans: Array.isArray(s.plans) ? s.plans : [],
    entries: s.entries && typeof s.entries === 'object' ? s.entries : {},
    anchors: Array.isArray(s.anchors) ? s.anchors : [],
    vacationYears: s.vacationYears && typeof s.vacationYears === 'object' ? s.vacationYears : {},
  };
}

// ---------- App-Zustand ----------
let state = C.defaultState();
const ui = {
  view: 'day',
  date: C.todayIso(),
  draft: null,
  ovTab: 'week',
  ovRef: C.todayIso(),
};
const today = () => C.todayIso();
const $view = document.getElementById('view');
const $title = document.getElementById('title');
const $dialog = document.getElementById('dialog');

// ---------- Hilfen ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const WD_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const WD_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MON_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

function fmtDateLong(s) {
  const d = C.parseDate(s);
  return `${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtDateShort(s) {
  const d = C.parseDate(s);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}
function fmtDM(s) {
  const d = C.parseDate(s);
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}
function isoWeek(s) {
  const d = C.parseDate(C.addDays(s, 4 - C.weekday(s)));
  const y = d.getFullYear();
  const jan1 = new Date(y, 0, 1, 12);
  return Math.floor((d - jan1) / 864e5 / 7) + 1;
}
function signClass(m) {
  return Math.round(m) > 0 ? 'pos' : Math.round(m) < 0 ? 'neg' : '';
}
function daysLabel(n) {
  return `${n} ${Math.abs(n) === 1 ? 'Tag' : 'Tage'}`;
}
const STATUS_LABEL = {
  work: 'Arbeit', vacation: 'Urlaub', sick: 'Krank', free: 'Frei (Überstundenabbau)',
  holiday: 'Feiertag', open: 'Offen', planned: 'Geplant', off: 'Frei laut Plan',
};

const ICON = {
  prev: '<svg viewBox="0 0 24 24"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"/></svg>',
  info: '<svg viewBox="0 0 24 24" width="18" height="18" style="flex:none;fill:currentColor"><path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z"/></svg>',
};

let snackTimer;
function snack(msg) {
  const el = document.getElementById('snackbar');
  el.textContent = msg;
  el.style.pointerEvents = '';
  el.classList.add('show');
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  requestAnimationFrame(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    document.querySelector('meta[name="theme-color"]').setAttribute('content', bg);
  });
}

function currentSaldo() {
  return C.saldoAt(state, today(), today());
}
function latestAnchor() {
  return [...state.anchors].sort((a, b) => (a.date < b.date ? -1 : 1)).pop() || null;
}

// ---------- Navigation ----------
function go(view) {
  ui.view = view;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.nav === view));
  render();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => go(b.dataset.nav)));

function render() {
  if (ui.view === 'day') renderDay();
  else if (ui.view === 'overview') renderOverview();
  else renderSettings();
}

// =====================================================
// Tag
// =====================================================
function draftFor(date) {
  const e = state.entries[date];
  if (e) return { ...e };
  const p = C.plannedDay(state, date);
  return { type: 'work', start: p ? p.start : '', end: p ? p.end : '', pause: null };
}
function setDate(date) {
  ui.date = date;
  ui.draft = draftFor(date);
  renderDay();
}
function draftEqualsEntry() {
  const e = state.entries[ui.date];
  if (!e) return false;
  const d = ui.draft;
  if (d.type !== e.type) return false;
  if (d.type !== 'work') return true;
  return d.start === e.start && d.end === e.end && (d.pause ?? null) === (e.pause ?? null);
}
function draftValid() {
  const d = ui.draft;
  if (d.type !== 'work') return true;
  return d.start && d.end && C.toMin(d.end) > C.toMin(d.start);
}
function draftResult() {
  const d = ui.draft;
  const tmp = { ...state, entries: { ...state.entries } };
  if (d.type !== 'work' || draftValid()) {
    tmp.entries[ui.date] = cleanEntry(d);
  } else {
    delete tmp.entries[ui.date];
  }
  return C.dayResult(tmp, ui.date, today());
}
function cleanEntry(d) {
  if (d.type !== 'work') return { type: d.type };
  const e = { type: 'work', start: d.start, end: d.end };
  if (d.pause != null) e.pause = d.pause;
  return e;
}

function renderDay() {
  $title.textContent = 'Arbeitszeit';
  if (!ui.draft) ui.draft = draftFor(ui.date);
  const date = ui.date;
  const d = ui.draft;
  const isToday = date === today();
  const stored = C.dayResult(state, date, today());
  const plan = stored.plan;
  const r = draftResult();
  const entry = state.entries[date];
  const anchor = latestAnchor();

  let chips = '';
  if (!isToday) chips += `<button class="chip" data-act="today">Heute</button>`;
  if (stored.holiday) chips += `<span class="chip tint s-holiday">${esc(stored.holiday)}</span>`;
  if (entry) chips += `<span class="chip tint s-${entry.type}">Erfasst</span>`;
  else if (stored.status === 'open') chips += `<span class="chip tint s-open">Noch offen</span>`;
  else if (!plan && !stored.holiday) chips += `<span class="chip">Frei laut Plan</span>`;

  const seg = Object.entries(C.TYPES)
    .map(([k, v]) => `<button data-type="${k}" class="${d.type === k ? 'on' : ''}">${v}</button>`)
    .join('');

  let body = '';
  if (d.type === 'work') {
    const presence = d.start && d.end ? C.toMin(d.end) - C.toMin(d.start) : 0;
    const auto = C.autoPause(Math.max(0, presence));
    const opts = [`<option value="auto"${d.pause == null ? ' selected' : ''}>Automatisch (${auto} min)</option>`]
      .concat([0, 15, 30, 45, 60, 90].map((m) => `<option value="${m}"${d.pause === m ? ' selected' : ''}>${m} min</option>`))
      .join('');
    const planTxt = plan ? `Plan: ${plan.start}–${plan.end} Uhr` : state.plans.length ? 'Kein Arbeitstag laut Plan' : 'Noch kein Arbeitsplan hinterlegt';
    const resetBtn = plan && (d.start !== plan.start || d.end !== plan.end)
      ? ` · <button class="btn text small" data-act="useplan" style="height:28px;padding:0 6px">Planzeit übernehmen</button>` : '';
    body = `
      <div class="card">
        <div class="times">
          <div class="field"><label for="t-start">Beginn</label><input id="t-start" type="time" value="${esc(d.start)}"></div>
          <div class="field"><label for="t-end">Ende</label><input id="t-end" type="time" value="${esc(d.end)}"></div>
        </div>
        <div class="pause-row">
          <span class="muted">Pause</span>
          <select id="t-pause" aria-label="Pause">${opts}</select>
        </div>
        <div class="muted small planhint">${planTxt}${resetBtn}</div>
      </div>`;
  } else {
    const avg = C.fmtDur(C.avgDay(state));
    const txt = {
      vacation: plan ? `Urlaubstag: ${avg} werden gutgeschrieben.` : 'An Tagen ohne Plan zählt kein Urlaubstag.',
      sick: plan ? `Krankheitstag: ${avg} werden gutgeschrieben.` : 'An Tagen ohne Plan hat Krankheit keine Auswirkung.',
      free: `Freier Tag: pauschal ${avg} werden vom Saldo abgezogen.`,
    }[d.type];
    body = `<div class="card"><p style="margin:0">${txt}</p></div>`;
  }

  let btnLabel = 'Bestätigen';
  let btnClass = 'filled';
  let disabled = !draftValid();
  if (entry && draftEqualsEntry()) { btnLabel = '✓ Gespeichert'; btnClass = 'done'; disabled = true; }
  else if (entry) btnLabel = 'Änderung speichern';

  const vac = C.vacationAccount(state, +today().slice(0, 4), today());
  const saldo = currentSaldo();
  const notes = [];
  let onboarding = '';
  if (!state.plans.length) {
    onboarding = (`<div class="card filled empty"><p>Hinterlege zuerst deinen Arbeitsplan. Dann sind Beginn und Ende jeden Tag schon vorausgefüllt.</p><button class="btn filled" data-act="toplan">Arbeitsplan anlegen</button></div>`);
  }
  if (anchor && date <= anchor.date) {
    notes.push(`<div class="note">${ICON.info}<span>Dieser Tag liegt vor dem Saldo-Abgleich vom ${fmtDateShort(anchor.date)}. Änderungen wirken sich nicht auf das Saldo aus.</span></div>`);
  }
  if (date > today() && d.type === 'work') {
    notes.push(`<div class="note">${ICON.info}<span>Dieser Tag liegt in der Zukunft.</span></div>`);
  }

  $view.innerHTML = `
    <section class="dayhead">
      <button class="icon-btn" data-act="prev" aria-label="Vorheriger Tag">${ICON.prev}</button>
      <button class="datebtn" aria-label="Datum wählen">
        <span class="wd">${WD_LONG[C.weekday(date) - 1]}${isToday ? ' · Heute' : ''}</span>
        <span class="dt">${fmtDateLong(date)}</span>
        <input type="date" id="pick" value="${date}" tabindex="-1">
      </button>
      <button class="icon-btn" data-act="next" aria-label="Nächster Tag">${ICON.next}</button>
    </section>
    <div class="chips">${chips}</div>
    ${onboarding}
    <div class="segmented" role="group" aria-label="Art des Tages">${seg}</div>
    ${body}
    <div class="stats">
      <div class="stat"><div class="k">Ist</div><div class="v">${C.fmtDur(r.counts ? r.ist : 0)}</div></div>
      <div class="stat"><div class="k">Soll</div><div class="v">${C.fmtDur(r.soll)}</div></div>
      <div class="stat"><div class="k">Differenz</div><div class="v ${signClass(r.counts ? r.diff : 0)}">${r.counts ? C.fmtDiff(r.diff) : '–'}</div></div>
    </div>
    <button class="btn big ${btnClass}" data-act="save" ${disabled ? 'disabled' : ''}>${btnLabel}</button>
    ${entry ? `<div class="btn-row end" style="margin-top:4px"><button class="btn text danger" data-act="delete">Eintrag löschen</button></div>` : ''}
    ${notes.join('')}
    <div class="summary">
      <button class="tile" data-act="toov">
        <div class="k">Saldo heute</div>
        <div class="v">${C.fmtDiff(saldo)}</div>
        <div class="s">${anchor ? `seit Abgleich ${fmtDM(anchor.date)}` : 'ohne Abgleich'}</div>
      </button>
      <button class="tile alt" data-act="tovac">
        <div class="k">Resturlaub ${today().slice(0, 4)}</div>
        <div class="v">${vac.remaining}</div>
        <div class="s">${vac.carryLeft ? `davon ${daysLabel(vac.carryLeft)} bis 31.3.` : `von ${daysLabel(vac.total)}`}</div>
      </button>
    </div>`;

  bindDay();
}

function bindDay() {
  $view.querySelector('[data-act="prev"]').onclick = () => setDate(C.addDays(ui.date, -1));
  $view.querySelector('[data-act="next"]').onclick = () => setDate(C.addDays(ui.date, 1));
  const pick = $view.querySelector('#pick');
  pick.onchange = () => pick.value && setDate(pick.value);
  $view.querySelector('.datebtn').onclick = (e) => {
    if (e.target === pick) return;
    try { pick.showPicker(); } catch (_) { pick.focus(); pick.click(); }
  };
  const t = $view.querySelector('[data-act="today"]');
  if (t) t.onclick = () => setDate(today());
  $view.querySelectorAll('[data-type]').forEach((b) => (b.onclick = () => {
    const type = b.dataset.type;
    if (type === 'work' && ui.draft.type !== 'work') {
      const base = state.entries[ui.date]?.type === 'work' ? state.entries[ui.date] : {};
      const p = C.plannedDay(state, ui.date);
      ui.draft = { type: 'work', start: base.start || (p ? p.start : ''), end: base.end || (p ? p.end : ''), pause: base.pause ?? null };
    } else {
      ui.draft = { ...ui.draft, type };
    }
    renderDay();
  }));
  const s = $view.querySelector('#t-start');
  const e = $view.querySelector('#t-end');
  const p = $view.querySelector('#t-pause');
  if (s) s.onchange = () => { ui.draft.start = s.value; renderDay(); };
  if (e) e.onchange = () => { ui.draft.end = e.value; renderDay(); };
  if (p) p.onchange = () => { ui.draft.pause = p.value === 'auto' ? null : +p.value; renderDay(); };
  const up = $view.querySelector('[data-act="useplan"]');
  if (up) up.onclick = () => {
    const pl = C.plannedDay(state, ui.date);
    ui.draft.start = pl.start; ui.draft.end = pl.end;
    renderDay();
  };
  $view.querySelector('[data-act="save"]').onclick = async () => {
    if (!draftValid()) return;
    state.entries[ui.date] = cleanEntry(ui.draft);
    await saveState();
    snack(`${fmtDM(ui.date)} gespeichert`);
    renderDay();
  };
  const del = $view.querySelector('[data-act="delete"]');
  if (del) del.onclick = async () => {
    const old = state.entries[ui.date];
    const date = ui.date;
    delete state.entries[date];
    await saveState();
    ui.draft = draftFor(date);
    renderDay();
    snackUndo('Eintrag gelöscht', async () => {
      state.entries[date] = old;
      await saveState();
      if (ui.view === 'day' && ui.date === date) ui.draft = draftFor(date);
      render();
    });
  };
  $view.querySelector('[data-act="toov"]').onclick = () => go('overview');
  $view.querySelector('[data-act="tovac"]').onclick = () => { go('settings'); scrollToId('sec-vac'); };
  const tp = $view.querySelector('[data-act="toplan"]');
  if (tp) tp.onclick = () => openPlanEditor(null);
}

function snackUndo(msg, undo) {
  const el = document.getElementById('snackbar');
  el.innerHTML = `${esc(msg)} <button class="btn text" style="height:24px;color:var(--primary-container);pointer-events:auto">Rückgängig</button>`;
  el.style.pointerEvents = 'auto';
  el.classList.add('show');
  el.querySelector('button').onclick = () => { el.classList.remove('show'); undo(); };
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => { el.classList.remove('show'); el.style.pointerEvents = ''; }, 5000);
}
function scrollToId(id) {
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

// Wischen zwischen Tagen
let touch = null;
$view.addEventListener('touchstart', (e) => {
  if (ui.view !== 'day' || e.touches.length !== 1) return;
  if (e.target.closest('input, select, .segmented')) return;
  touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
$view.addEventListener('touchend', (e) => {
  if (!touch) return;
  const dx = e.changedTouches[0].clientX - touch.x;
  const dy = e.changedTouches[0].clientY - touch.y;
  touch = null;
  if (Math.abs(dx) > 70 && Math.abs(dy) < 50) setDate(C.addDays(ui.date, dx < 0 ? 1 : -1));
});

// =====================================================
// Übersicht
// =====================================================
function periodRange() {
  const ref = ui.ovRef;
  if (ui.ovTab === 'week') {
    const from = C.mondayOf(ref);
    return { from, to: C.addDays(from, 6) };
  }
  const d = C.parseDate(ref);
  if (ui.ovTab === 'month') {
    const from = C.isoDate(new Date(d.getFullYear(), d.getMonth(), 1, 12));
    const to = C.isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
    return { from, to };
  }
  return { from: `${d.getFullYear()}-01-01`, to: `${d.getFullYear()}-12-31` };
}
function shiftPeriod(n) {
  const d = C.parseDate(ui.ovRef);
  if (ui.ovTab === 'week') ui.ovRef = C.addDays(ui.ovRef, 7 * n);
  else if (ui.ovTab === 'month') ui.ovRef = C.isoDate(new Date(d.getFullYear(), d.getMonth() + n, 1, 12));
  else ui.ovRef = `${d.getFullYear() + n}-01-01`;
  renderOverview();
}
function periodLabel(from, to) {
  const d = C.parseDate(from);
  if (ui.ovTab === 'week') return { main: `KW ${isoWeek(from)}`, sub: `${fmtDM(from)} – ${fmtDateShort(to)}` };
  if (ui.ovTab === 'month') return { main: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, sub: '' };
  return { main: String(d.getFullYear()), sub: '' };
}

function renderOverview() {
  $title.textContent = 'Übersicht';
  const { from, to } = periodRange();
  const T = today();
  const sum = C.periodSummary(state, from, to, T);
  const lbl = periodLabel(from, to);
  const endForSaldo = to < T ? to : T;
  const saldoEnd = from <= T ? C.saldoAt(state, endForSaldo, T) : null;

  const tabs = [['week', 'Woche'], ['month', 'Monat'], ['year', 'Jahr']]
    .map(([k, v]) => `<button data-tab="${k}" class="${ui.ovTab === k ? 'on' : ''}">${v}</button>`).join('');

  let content = '';
  if (ui.ovTab === 'week') content = weekList(sum.days);
  else if (ui.ovTab === 'month') content = monthGrid(from, sum.days);
  else content = yearView(from.slice(0, 4), T);

  const counts = [];
  if (sum.vacation) counts.push(`Urlaub ${sum.vacation}`);
  if (sum.sick) counts.push(`Krank ${sum.sick}`);
  if (sum.free) counts.push(`Frei ${sum.free}`);
  if (sum.holiday) counts.push(`Feiertage ${sum.holiday}`);
  if (sum.open) counts.push(`<span class="neg">Offen ${sum.open}</span>`);

  $view.innerHTML = `
    <div class="segmented" style="margin-top:4px">${tabs}</div>
    <div class="periodnav">
      <button class="icon-btn" data-p="-1" aria-label="Zurück">${ICON.prev}</button>
      <div class="lbl"><b>${lbl.main}</b>${lbl.sub ? `<span>${lbl.sub}</span>` : ''}</div>
      <button class="icon-btn" data-p="1" aria-label="Weiter">${ICON.next}</button>
    </div>
    <div class="card filled">
      <div class="kpis">
        <div><div class="k">Ist</div><div class="v">${C.fmtDur(sum.ist)}</div></div>
        <div><div class="k">Soll</div><div class="v">${C.fmtDur(sum.soll)}</div></div>
        <div><div class="k">Differenz</div><div class="v ${signClass(sum.diff)}">${C.fmtDiff(sum.diff)}</div></div>
        <div><div class="k">Saldo ${to < T ? 'Ende' : 'heute'}</div><div class="v">${saldoEnd == null ? '–' : C.fmtDiff(saldoEnd)}</div></div>
      </div>
      ${counts.length ? `<div class="muted small" style="text-align:center;margin-top:10px">${counts.join(' · ')}</div>` : ''}
    </div>
    ${content}
    ${sum.open ? `<p class="muted small">Offene Tage sind noch nicht erfasst und zählen nicht ins Saldo.</p>` : ''}`;

  $view.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { ui.ovTab = b.dataset.tab; renderOverview(); }));
  $view.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => shiftPeriod(+b.dataset.p)));
  $view.querySelectorAll('[data-day]').forEach((b) => (b.onclick = () => { ui.date = b.dataset.day; ui.draft = null; go('day'); }));
  $view.querySelectorAll('[data-month]').forEach((b) => (b.onclick = () => { ui.ovTab = 'month'; ui.ovRef = b.dataset.month; renderOverview(); }));
}

function dayLine(r) {
  const e = r.entry;
  if (e && e.type === 'work') return `${e.start}–${e.end}${r.pause ? ` · ${r.pause} min Pause` : ''}`;
  if (r.status === 'holiday') return r.holiday;
  if (r.status === 'open') return 'Noch nicht erfasst';
  if (r.status === 'planned') return `Geplant ${r.plan.start}–${r.plan.end}`;
  return STATUS_LABEL[r.status];
}
function weekList(days) {
  const T = today();
  const rows = days.map((r) => {
    const wd = C.weekday(r.date);
    const right = r.counts
      ? `${C.fmtDur(r.ist)}<small class="${signClass(r.diff)}">${C.fmtDiff(r.diff)}</small>`
      : `<span class="muted">${r.soll ? C.fmtDur(r.soll) : '–'}</span>`;
    return `<li class="row${r.date === T ? ' today' : ''}" data-day="${r.date}">
      <div class="d">${WD_SHORT[wd - 1]}<small>${fmtDM(r.date)}</small></div>
      <div class="m"><span class="dot s-${r.status}"></span><span>${esc(dayLine(r))}</span></div>
      <div class="r">${right}</div>
    </li>`;
  }).join('');
  return `<div class="card"><ul class="list">${rows}</ul></div>`;
}
function monthGrid(from, days) {
  const T = today();
  const lead = C.weekday(from) - 1;
  let cells = WD_SHORT.map((w) => `<div class="h">${w}</div>`).join('');
  for (let i = 0; i < lead; i++) cells += '<div></div>';
  for (const r of days) {
    const n = C.parseDate(r.date).getDate();
    const x = r.counts && r.entry && r.entry.type === 'work' ? C.fmtDur(r.ist) : r.counts ? '' : '';
    cells += `<button data-day="${r.date}" class="s-${r.status}${r.date === T ? ' today' : ''}" aria-label="${fmtDateShort(r.date)}: ${STATUS_LABEL[r.status]}">
      <span>${n}</span>${x ? `<span class="x">${x}</span>` : ''}</button>`;
  }
  const legend = ['work', 'vacation', 'sick', 'free', 'holiday', 'open']
    .map((s) => `<span><span class="dot s-${s}"></span>${STATUS_LABEL[s].replace(' (Überstundenabbau)', '')}</span>`).join('');
  return `<div class="card"><div class="cal">${cells}</div><div class="legend">${legend}</div></div>`;
}
function yearView(y, T) {
  const months = [];
  for (let m = 0; m < 12; m++) {
    const from = C.isoDate(new Date(+y, m, 1, 12));
    const to = C.isoDate(new Date(+y, m + 1, 0, 12));
    const s = C.periodSummary(state, from, to, T);
    months.push({ m, from, diff: s.diff, any: s.days.some((d) => d.counts), sick: s.sick });
  }
  const maxAbs = Math.max(60, ...months.map((x) => Math.abs(x.diff)));
  const W = 336, H = 160, mid = H / 2, bw = 18, gap = (W - 12 * bw) / 12;
  let bars = `<line x1="0" x2="${W}" y1="${mid}" y2="${mid}" stroke="var(--outline-variant)"/>`;
  months.forEach((x, i) => {
    const h = Math.round((Math.abs(x.diff) / maxAbs) * (mid - 18));
    const xpos = gap / 2 + i * (bw + gap);
    const y0 = x.diff >= 0 ? mid - h : mid;
    const col = x.diff >= 0 ? 'var(--pos)' : 'var(--neg)';
    if (x.any && h > 0) bars += `<rect x="${xpos}" y="${y0}" width="${bw}" height="${Math.max(h, 2)}" rx="4" fill="${col}"/>`;
    bars += `<text x="${xpos + bw / 2}" y="${H - 2}" text-anchor="middle">${MON_SHORT[i][0]}</text>`;
  });
  const rows = months.filter((x) => x.any).map((x) => `
    <li class="row" data-month="${x.from}">
      <div class="d">${MON_SHORT[x.m]}</div>
      <div class="m"></div>
      <div class="r ${signClass(x.diff)}">${C.fmtDiff(x.diff)}</div>
    </li>`).join('');
  const vac = C.vacationAccount(state, +y, T);
  const sick = months.reduce((a, x) => a + x.sick, 0);
  return `
    <div class="card">
      <h2>Differenz je Monat</h2>
      <svg class="bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="Differenz je Monat">${bars}</svg>
      ${rows ? `<ul class="list" style="margin-top:8px">${rows}</ul>` : '<p class="muted">Noch keine Einträge in diesem Jahr.</p>'}
    </div>
    <div class="card">
      <h2>Urlaub ${y}</h2>
      <div class="kv"><span>Anspruch</span><b>${vac.entitlement}</b></div>
      ${vac.carry ? `<div class="kv"><span>Resturlaub Vorjahr${vac.expired ? ' (genutzt bis 31.3.)' : ''}</span><b>${vac.carryEffective}</b></div>` : ''}
      ${vac.taken ? `<div class="kv"><span>Bereits genommen (ohne Datum)</span><b>${vac.taken}</b></div>` : ''}
      <div class="kv"><span>Eingetragene Urlaubstage</span><b>${vac.used}</b></div>
      <div class="kv"><span>Resturlaub</span><b>${vac.remaining}</b></div>
    </div>
    <div class="card"><div class="kv"><span>Krankheitstage ${y}</span><b>${sick}</b></div></div>`;
}

// =====================================================
// Einstellungen
// =====================================================
function renderSettings() {
  $title.textContent = 'Einstellungen';
  const T = today();
  const year = T.slice(0, 4);
  const cur = C.planFor(state, T) || [...state.plans].sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1))[0];
  const others = state.plans.filter((p) => p !== cur).sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));
  const vy = state.vacationYears[year] || { carry: 0, taken: 0 };
  const vac = C.vacationAccount(state, +year, T);
  const anchors = [...state.anchors].sort((a, b) => (a.date < b.date ? 1 : -1));

  let planHtml;
  if (cur) {
    const rows = WD_LONG.map((w, i) => {
      const d = cur.days[i + 1];
      const val = d && d.start && d.end ? `${d.start}–${d.end}` : '<span class="muted">frei</span>';
      const pd = d && d.start && d.end ? C.toMin(d.end) - C.toMin(d.start) : 0;
      return `<tr><td>${w}</td><td>${val}</td><td>${pd > 0 ? C.fmtDur(pd - C.autoPause(pd)) : ''}</td></tr>`;
    }).join('');
    const weekSoll = C.planWeekSoll(cur);
    planHtml = `
      <p class="muted small">Gültig ab ${fmtDateShort(cur.validFrom)}${cur.validFrom > T ? ' (in Zukunft)' : ''} · Soll pro Woche ${C.fmtDur(weekSoll)}</p>
      <table class="plantable">${rows}</table>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn tonal" data-edit="${cur.id}">Bearbeiten</button>
        <button class="btn outlined" data-act="newplan">Neuer Plan ab …</button>
      </div>
      ${others.length ? `<p class="muted small" style="margin:14px 0 0">Weitere Pläne</p><ul class="list oldplans">${others.map((p) => `
        <li><span>ab ${fmtDateShort(p.validFrom)} · ${C.fmtDur(C.planWeekSoll(p))}/Woche</span>
        <span><button class="btn text" data-edit="${p.id}">Bearbeiten</button></span></li>`).join('')}</ul>` : ''}`;
  } else {
    planHtml = `<p class="muted">Noch kein Arbeitsplan hinterlegt.</p><button class="btn filled" data-act="newplan">Arbeitsplan anlegen</button>`;
  }

  $view.innerHTML = `
    <section class="card" id="sec-plan">
      <h2>Arbeitsplan</h2>
      ${planHtml}
    </section>

    <section class="card">
      <h2>Arbeitszeit</h2>
      <div class="field compact"><label for="s-weekly">Wochenstunden laut Vertrag</label>
        <input id="s-weekly" type="text" inputmode="decimal" value="${String(state.settings.weeklyHours).replace('.', ',')}"></div>
      <p class="muted small" style="margin-top:8px">Gutschrift für Urlaub, Krankheit und Feiertage sowie Abzug für freie Tage: ${C.fmtDur(C.avgDay(state))} pro Tag. Pause: über 6 h 30 min, über 9 h 45 min.</p>
    </section>

    <section class="card" id="sec-vac">
      <h2>Urlaub ${year}</h2>
      <div class="set-grid">
        <div class="field compact"><label for="s-vacyear">Anspruch pro Jahr</label><input id="s-vacyear" type="number" inputmode="numeric" min="0" value="${state.settings.vacationPerYear}"></div>
        <div class="field compact"><label for="s-carry">Resturlaub ${+year - 1}</label><input id="s-carry" type="number" inputmode="numeric" min="0" value="${vy.carry || 0}"></div>
        <div class="field compact" style="grid-column:1/-1"><label for="s-taken">Bereits genommen ${year} (ohne Datum)</label><input id="s-taken" type="number" inputmode="numeric" min="0" value="${vy.taken || 0}"></div>
      </div>
      <div class="kv" style="margin-top:8px"><span>Eingetragene Urlaubstage</span><b>${vac.used}</b></div>
      <div class="kv"><span>Resturlaub</span><b>${daysLabel(vac.remaining)}</b></div>
      <p class="muted small" style="margin:4px 0 0">Resturlaub aus dem Vorjahr verfällt am 31. März.</p>
    </section>

    <section class="card" id="sec-anchor">
      <h2>Saldo-Abgleich</h2>
      <p class="muted small">Trage den Stand aus der Zeiterfassung deiner Arbeit ein. Die App rechnet ab diesem Tag mit diesem Wert weiter.</p>
      <div class="set-grid">
        <div class="field compact"><label for="a-date">Stand am Ende von</label><input id="a-date" type="date" value="${T}" max="${T}"></div>
        <div class="field compact"><label for="a-val">Saldo laut Arbeit</label><input id="a-val" type="text" inputmode="text" placeholder="+12:30"></div>
      </div>
      <p id="a-cmp" class="small" style="margin:10px 0"></p>
      <button class="btn filled" data-act="anchor" disabled>Abgleichen</button>
      ${anchors.length ? `<p class="muted small" style="margin:14px 0 0">Bisherige Abgleiche</p><ul class="list oldplans">${anchors.map((a) => `
        <li><span>${fmtDateShort(a.date)}: <b>${C.fmtDiff(a.minutes)}</b></span><button class="btn text danger" data-delanchor="${a.date}">Entfernen</button></li>`).join('')}</ul>` : ''}
    </section>

    <section class="card">
      <h2>Darstellung</h2>
      <div class="segmented" style="margin:0">
        ${[['system', 'System'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([k, v]) => `<button data-theme="${k}" class="${state.settings.theme === k ? 'on' : ''}">${v}</button>`).join('')}
      </div>
    </section>

    <section class="card">
      <h2>Daten</h2>
      <p class="muted small" id="storage-info">Alle Daten liegen nur auf diesem Gerät.</p>
      <div class="btn-row">
        <button class="btn tonal" data-act="export">Exportieren</button>
        <button class="btn outlined" data-act="import">Importieren</button>
        <input type="file" id="importfile" accept="application/json,.json" hidden>
      </div>
      <div class="btn-row" style="margin-top:8px"><button class="btn text danger" data-act="wipe">Alle Daten löschen</button></div>
    </section>
    <p class="muted small" style="text-align:center">Arbeitszeit ${APP_VERSION}</p>`;

  bindSettings();
}

function bindSettings() {
  const T = today();
  $view.querySelectorAll('[data-act="newplan"]').forEach((b) => (b.onclick = () => openPlanEditor(null)));
  $view.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => openPlanEditor(state.plans.find((p) => p.id === b.dataset.edit))));

  const weekly = $view.querySelector('#s-weekly');
  weekly.onchange = async () => {
    const v = parseFloat(weekly.value.replace(',', '.'));
    if (!(v > 0 && v <= 80)) { snack('Bitte gültige Wochenstunden eingeben'); weekly.value = String(state.settings.weeklyHours).replace('.', ','); return; }
    state.settings.weeklyHours = v;
    await saveState();
    renderSettings();
    snack('Wochenstunden gespeichert');
  };
  const year = T.slice(0, 4);
  const numField = (id, apply) => {
    const el = $view.querySelector(id);
    el.onchange = async () => {
      const v = Math.max(0, Math.round(+el.value || 0));
      apply(v);
      await saveState();
      renderSettings();
      scrollToId('sec-vac');
    };
  };
  const vyGet = () => (state.vacationYears[year] ||= { carry: 0, taken: 0 });
  numField('#s-vacyear', (v) => (state.settings.vacationPerYear = v));
  numField('#s-carry', (v) => (vyGet().carry = v));
  numField('#s-taken', (v) => (vyGet().taken = v));

  // Abgleich
  const aDate = $view.querySelector('#a-date');
  const aVal = $view.querySelector('#a-val');
  const aCmp = $view.querySelector('#a-cmp');
  const aBtn = $view.querySelector('[data-act="anchor"]');
  const upd = () => {
    const date = aDate.value;
    const val = C.parseDur(aVal.value);
    if (!date) { aCmp.textContent = ''; aBtn.disabled = true; return; }
    const without = { ...state, anchors: state.anchors.filter((a) => a.date !== date) };
    const app = C.saldoAt(without, date, T);
    if (val == null) {
      aCmp.innerHTML = `<span class="muted">App-Stand am ${fmtDateShort(date)}: <b>${C.fmtDiff(app)}</b></span>`;
      aBtn.disabled = true;
      return;
    }
    const diff = val - app;
    aCmp.innerHTML = `App: <b>${C.fmtDiff(app)}</b> · Arbeit: <b>${C.fmtDiff(val)}</b> · Abweichung: <b class="${signClass(diff)}">${C.fmtDiff(diff)}</b>`;
    aBtn.disabled = false;
  };
  aDate.oninput = upd;
  aVal.oninput = upd;
  upd();
  aBtn.onclick = async () => {
    const val = C.parseDur(aVal.value);
    if (val == null || !aDate.value) return;
    state.anchors = state.anchors.filter((a) => a.date !== aDate.value);
    state.anchors.push({ date: aDate.value, minutes: val });
    await saveState();
    renderSettings();
    scrollToId('sec-anchor');
    snack(`Saldo auf ${C.fmtDiff(val)} gesetzt`);
  };
  $view.querySelectorAll('[data-delanchor]').forEach((b) => (b.onclick = async () => {
    const old = state.anchors.find((a) => a.date === b.dataset.delanchor);
    state.anchors = state.anchors.filter((a) => a !== old);
    await saveState();
    renderSettings();
    scrollToId('sec-anchor');
    snackUndo('Abgleich entfernt', async () => { state.anchors.push(old); await saveState(); render(); });
  }));

  $view.querySelectorAll('[data-theme]').forEach((b) => (b.onclick = async () => {
    state.settings.theme = b.dataset.theme;
    applyTheme();
    await saveState();
    renderSettings();
  }));

  $view.querySelector('[data-act="export"]').onclick = exportData;
  const file = $view.querySelector('#importfile');
  $view.querySelector('[data-act="import"]').onclick = () => file.click();
  file.onchange = () => importData(file.files[0]);
  $view.querySelector('[data-act="wipe"]').onclick = () => confirmDialog(
    'Alle Daten löschen?',
    'Arbeitsplan, Einträge, Abgleiche und Urlaubsangaben werden von diesem Gerät entfernt. Exportiere vorher eine Sicherung, wenn du sie behalten willst.',
    'Löschen',
    async () => {
      state = C.defaultState();
      await saveState();
      applyTheme();
      ui.draft = null;
      renderSettings();
      snack('Alle Daten gelöscht');
    },
  );

  if (navigator.storage && navigator.storage.persisted) {
    navigator.storage.persisted().then((p) => {
      const el = document.getElementById('storage-info');
      if (el) el.textContent = `Alle Daten liegen nur auf diesem Gerät${p ? ' und sind vor automatischem Löschen geschützt' : ''}. Exportiere ab und zu eine Sicherung.`;
    }).catch(() => {});
  }
}

function exportData() {
  const blob = new Blob([JSON.stringify({ app: 'arbeitszeit', exported: new Date().toISOString(), state }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `arbeitszeit-sicherung-${today()}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  snack('Sicherung exportiert');
}
async function importData(f) {
  if (!f) return;
  try {
    const json = JSON.parse(await f.text());
    const s = json.state || json;
    if (!s || !Array.isArray(s.plans) || typeof s.entries !== 'object') throw new Error('format');
    const n = Object.keys(s.entries).length;
    confirmDialog('Sicherung importieren?', `Die Datei enthält ${n} Einträge und ${s.plans.length} Arbeitspläne. Die aktuellen Daten auf diesem Gerät werden ersetzt.`, 'Importieren', async () => {
      state = migrate(s);
      await saveState();
      applyTheme();
      ui.draft = null;
      renderSettings();
      snack('Sicherung importiert');
    });
  } catch (e) {
    snack('Die Datei ist keine gültige Sicherung');
  }
}

function confirmDialog(title, text, okLabel, onOk) {
  $dialog.innerHTML = `<div class="dlg"><h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
    <div class="btn-row end" style="margin-top:20px"><button class="btn text" data-x="cancel">Abbrechen</button><button class="btn text danger" data-x="ok">${esc(okLabel)}</button></div></div>`;
  $dialog.querySelector('[data-x="cancel"]').onclick = () => $dialog.close();
  $dialog.querySelector('[data-x="ok"]').onclick = async () => { $dialog.close(); await onOk(); };
  $dialog.showModal();
}

// ---------- Plan-Editor ----------
function openPlanEditor(plan) {
  const T = today();
  const isNew = !plan;
  const base = plan || C.planFor(state, T) || null;
  const days = {};
  for (let i = 1; i <= 7; i++) {
    const d = base && base.days[i];
    days[i] = d && d.start && d.end ? { ...d } : null;
  }
  if (!base) for (let i = 1; i <= 5; i++) days[i] = { start: '08:00', end: '16:00' };
  const validFrom = plan ? plan.validFrom : (state.plans.length ? T : `${T.slice(0, 4)}-01-01`);

  const rows = WD_SHORT.map((w, i) => {
    const d = days[i + 1];
    return `<div class="wdrow" data-wd="${i + 1}">
      <span>${w}</span>
      <label class="switch" aria-label="${WD_LONG[i]} Arbeitstag"><input type="checkbox" ${d ? 'checked' : ''}><span></span></label>
      <input type="time" data-k="start" value="${d ? d.start : '08:00'}" ${d ? '' : 'disabled'} aria-label="${WD_LONG[i]} Beginn">
      <input type="time" data-k="end" value="${d ? d.end : '16:00'}" ${d ? '' : 'disabled'} aria-label="${WD_LONG[i]} Ende">
    </div>`;
  }).join('');

  $dialog.innerHTML = `<div class="dlg">
    <h2>${isNew ? 'Neuer Arbeitsplan' : 'Arbeitsplan bearbeiten'}</h2>
    <div class="field compact"><label for="p-from">Gültig ab</label><input id="p-from" type="date" value="${validFrom}"></div>
    <p class="muted small" style="margin:12px 0 4px">Arbeitszeiten je Wochentag (Anwesenheit inkl. Pause)</p>
    ${rows}
    <p id="p-sum" class="small" style="margin:12px 0 0"></p>
    <div class="btn-row end" style="margin-top:16px">
      ${!isNew && state.plans.length > 1 ? '<button class="btn text danger" data-x="del" style="margin-right:auto">Löschen</button>' : ''}
      <button class="btn text" data-x="cancel">Abbrechen</button>
      <button class="btn filled" data-x="save">Speichern</button>
    </div></div>`;

  const read = () => {
    const out = {};
    $dialog.querySelectorAll('.wdrow').forEach((r) => {
      const on = r.querySelector('input[type="checkbox"]').checked;
      const s = r.querySelector('[data-k="start"]').value;
      const e = r.querySelector('[data-k="end"]').value;
      out[r.dataset.wd] = on && s && e ? { start: s, end: e } : null;
    });
    return out;
  };
  const sumEl = $dialog.querySelector('#p-sum');
  const refresh = () => {
    const d = read();
    let bad = false;
    for (const k in d) if (d[k] && C.toMin(d[k].end) <= C.toMin(d[k].start)) bad = true;
    const ws = C.planWeekSoll({ days: d });
    const target = Math.round(state.settings.weeklyHours * 60);
    sumEl.innerHTML = bad
      ? '<span class="neg">Ende muss nach dem Beginn liegen.</span>'
      : `Soll pro Woche: <b>${C.fmtDur(ws)}</b> <span class="muted">(Vertrag ${C.fmtDur(target)}${ws !== target ? `, Differenz ${C.fmtDiff(ws - target)}` : ''})</span>`;
    $dialog.querySelector('[data-x="save"]').disabled = bad;
  };
  $dialog.querySelectorAll('.wdrow').forEach((r) => {
    const cb = r.querySelector('input[type="checkbox"]');
    cb.onchange = () => { r.querySelectorAll('input[type="time"]').forEach((t) => (t.disabled = !cb.checked)); refresh(); };
    r.querySelectorAll('input[type="time"]').forEach((t) => (t.oninput = refresh));
  });
  refresh();

  $dialog.querySelector('[data-x="cancel"]').onclick = () => $dialog.close();
  const del = $dialog.querySelector('[data-x="del"]');
  if (del) del.onclick = async () => {
    state.plans = state.plans.filter((p) => p !== plan);
    await saveState();
    $dialog.close();
    ui.draft = null;
    render();
    snack('Arbeitsplan gelöscht');
  };
  $dialog.querySelector('[data-x="save"]').onclick = async () => {
    const from = $dialog.querySelector('#p-from').value;
    if (!from) { snack('Bitte ein Datum wählen'); return; }
    const clash = state.plans.find((p) => p.validFrom === from && p !== plan);
    if (clash) state.plans = state.plans.filter((p) => p !== clash);
    if (plan) {
      plan.validFrom = from;
      plan.days = read();
    } else {
      state.plans.push({ id: Math.random().toString(36).slice(2, 10), validFrom: from, days: read() });
    }
    await saveState();
    $dialog.close();
    ui.draft = null;
    render();
    snack('Arbeitsplan gespeichert');
  };
  $dialog.showModal();
}

// ---------- Start ----------
async function init() {
  state = migrate(await loadState());
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  go('day');
  // Tageswechsel, wenn die App über Nacht offen bleibt
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ui.view === 'day') render();
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
init();
