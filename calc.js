// Berechnungslogik der Arbeitszeit-App (ohne DOM, testbar mit Node)

export const TYPES = {
  work: 'Arbeit',
  vacation: 'Urlaub',
  sick: 'Krank',
  free: 'Frei',
};

// ---------- Datum ----------
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}
export function isoDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
export function todayIso(now = new Date()) {
  return isoDate(now);
}
// 1 = Montag … 7 = Sonntag
export function weekday(s) {
  const g = parseDate(s).getDay();
  return g === 0 ? 7 : g;
}
export function mondayOf(s) {
  return addDays(s, 1 - weekday(s));
}

// ---------- Zeit ----------
export function toMin(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
export function fmtDur(min) {
  const sign = min < 0 ? '−' : '';
  const a = Math.abs(Math.round(min));
  return `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}
export function fmtDiff(min) {
  if (Math.round(min) === 0) return '±0:00';
  return (min > 0 ? '+' : '') + fmtDur(min);
}
// "7:30", "-1:15", "+2", "7,5" → Minuten
export function parseDur(str) {
  if (str == null) return null;
  let s = String(str).trim().replace('−', '-').replace(/\s/g, '');
  if (!s) return null;
  let sign = 1;
  if (s[0] === '-' || s[0] === '+') {
    if (s[0] === '-') sign = -1;
    s = s.slice(1);
  }
  let m;
  if ((m = s.match(/^(\d+):(\d{1,2})$/))) {
    if (+m[2] > 59) return null;
    return sign * (+m[1] * 60 + +m[2]);
  }
  if ((m = s.match(/^(\d+)(?:[.,](\d+))?$/))) {
    return sign * Math.round(parseFloat(`${m[1]}.${m[2] || 0}`) * 60);
  }
  return null;
}

// Gesetzliche Pause, voller Abzug: > 6 h → 30 min, > 9 h → 45 min
export function autoPause(presence) {
  if (presence > 9 * 60) return 45;
  if (presence > 6 * 60) return 30;
  return 0;
}

// ---------- Feiertage Niedersachsen ----------
export function easterSunday(y) {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(new Date(y, month - 1, day, 12));
}
const holidayCache = new Map();
export function holidays(y) {
  if (holidayCache.has(y)) return holidayCache.get(y);
  const e = easterSunday(y);
  const map = new Map([
    [`${y}-01-01`, 'Neujahr'],
    [addDays(e, -2), 'Karfreitag'],
    [addDays(e, 1), 'Ostermontag'],
    [`${y}-05-01`, 'Tag der Arbeit'],
    [addDays(e, 39), 'Christi Himmelfahrt'],
    [addDays(e, 50), 'Pfingstmontag'],
    [`${y}-10-03`, 'Tag der Deutschen Einheit'],
    [`${y}-10-31`, 'Reformationstag'],
    [`${y}-12-25`, '1. Weihnachtstag'],
    [`${y}-12-26`, '2. Weihnachtstag'],
  ]);
  holidayCache.set(y, map);
  return map;
}
export function holidayName(s) {
  return holidays(+s.slice(0, 4)).get(s) || null;
}

// ---------- Zustand ----------
export function defaultState() {
  return {
    version: 1,
    settings: { weeklyHours: 35, vacationPerYear: 30, theme: 'system' },
    plans: [], // { id, validFrom, days: { 1: {start, end} | null, … 7 } }
    entries: {}, // 'YYYY-MM-DD': { type, start?, end?, pause? (Minuten, Überschreibung) }
    anchors: [], // { date, minutes } = Saldo laut Arbeitgeber am Ende dieses Tages
    vacationYears: {}, // 'YYYY': { carry, taken }
  };
}

export const avgDay = (state) => Math.round((state.settings.weeklyHours * 60) / 5);

export function planFor(state, date) {
  let best = null;
  for (const p of state.plans) {
    if (p.validFrom <= date && (!best || p.validFrom > best.validFrom)) best = p;
  }
  return best;
}

// Geplanter Tag: { start, end, presence, pause, soll } oder null (frei laut Plan)
export function plannedDay(state, date) {
  const p = planFor(state, date);
  const d = p && p.days[weekday(date)];
  if (!d || !d.start || !d.end) return null;
  const presence = toMin(d.end) - toMin(d.start);
  if (presence <= 0) return null;
  const pause = autoPause(presence);
  return { start: d.start, end: d.end, presence, pause, soll: presence - pause };
}

export function planWeekSoll(plan) {
  let sum = 0;
  for (let w = 1; w <= 7; w++) {
    const d = plan.days[w];
    if (d && d.start && d.end) {
      const pr = toMin(d.end) - toMin(d.start);
      if (pr > 0) sum += pr - autoPause(pr);
    }
  }
  return sum;
}

// Ergebnis eines Tages
// status: work | vacation | sick | free | holiday | open | planned | off
// counts: fließt der Tag in Summen/Saldo ein?
export function dayResult(state, date, today) {
  const plan = plannedDay(state, date);
  const holiday = holidayName(date);
  const entry = state.entries[date] || null;
  const avg = avgDay(state);
  const sollPlan = plan ? plan.soll : 0;
  const r = { date, plan, holiday, entry, soll: sollPlan, ist: 0, diff: 0, pause: 0, status: 'off', counts: false };

  if (entry) {
    r.counts = true;
    r.status = entry.type;
    if (entry.type === 'work') {
      const presence = Math.max(0, toMin(entry.end) - toMin(entry.start));
      r.pause = entry.pause != null ? entry.pause : autoPause(presence);
      r.ist = Math.max(0, presence - r.pause);
      if (holiday && plan) r.ist += avg; // Feiertagsgutschrift bleibt bestehen
    } else if (entry.type === 'vacation' || entry.type === 'sick') {
      r.ist = plan ? avg : 0;
    } else if (entry.type === 'free') {
      r.soll = avg;
      r.ist = 0;
    }
    r.diff = r.ist - r.soll;
    return r;
  }

  if (holiday && plan && date <= today) {
    r.status = 'holiday';
    r.ist = avg;
    r.diff = r.ist - r.soll;
    r.counts = true;
    return r;
  }
  if (holiday) {
    r.status = 'holiday';
    return r;
  }
  if (plan) {
    r.status = date <= today ? 'open' : 'planned';
    return r;
  }
  return r;
}

function firstDate(state) {
  const dates = Object.keys(state.entries);
  for (const p of state.plans) dates.push(p.validFrom);
  for (const a of state.anchors) dates.push(a.date);
  return dates.length ? dates.sort()[0] : null;
}

// Saldo am Ende von `date` (berücksichtigt den letzten Abgleich bis dahin)
export function saldoAt(state, date, today) {
  let base = 0;
  let from = firstDate(state);
  if (!from) return 0;
  const anchor = [...state.anchors].filter((a) => a.date <= date).sort((a, b) => (a.date < b.date ? -1 : 1)).pop();
  if (anchor) {
    base = anchor.minutes;
    from = addDays(anchor.date, 1);
  }
  let sum = base;
  for (let d = from; d <= date; d = addDays(d, 1)) {
    const r = dayResult(state, d, today);
    if (r.counts) sum += r.diff;
  }
  return sum;
}

export function periodSummary(state, from, to, today) {
  const s = { ist: 0, soll: 0, diff: 0, work: 0, vacation: 0, sick: 0, free: 0, holiday: 0, open: 0, days: [] };
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const r = dayResult(state, d, today);
    s.days.push(r);
    if (r.counts) {
      s.ist += r.ist;
      s.soll += r.soll;
      s.diff += r.diff;
    }
    if (r.status in s && r.status !== 'days') {
      if (r.status !== 'holiday' || r.plan) s[r.status]++;
    }
  }
  return s;
}

// Urlaubskonto eines Jahres. Resturlaub aus dem Vorjahr verfällt am 31.03.
export function vacationAccount(state, year, today) {
  const y = String(year);
  const vy = state.vacationYears[y] || { carry: 0, taken: 0 };
  const entitlement = state.settings.vacationPerYear;
  const carry = vy.carry || 0;
  const taken = vy.taken || 0;
  let used = 0;
  let usedUntilMarch = 0;
  for (const [d, e] of Object.entries(state.entries)) {
    if (e.type !== 'vacation' || !d.startsWith(y)) continue;
    if (!plannedDay(state, d) || holidayName(d)) continue;
    used++;
    if (d <= `${y}-03-31`) usedUntilMarch++;
  }
  const expired = today > `${y}-03-31`;
  // Der Block "bereits genommen" wird zuerst mit dem Resturlaub verrechnet
  const carryUsed = Math.min(carry, taken + usedUntilMarch);
  const carryEffective = expired ? carryUsed : carry;
  const total = entitlement + carryEffective;
  const remaining = total - taken - used;
  const carryLeft = expired ? 0 : Math.max(0, carry - carryUsed);
  return { entitlement, carry, carryEffective, carryLeft, expired, taken, used, total, remaining };
}
