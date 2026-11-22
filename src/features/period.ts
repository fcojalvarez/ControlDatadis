import { cap, fmtMonthLong, ymd } from '@/lib/format';

import { addMonths, monthKey, monthRange, type MonthKey } from '@/lib/months';
import type { SupplyRef } from './types';

export type Bounds = { min: MonthKey; max: MonthKey };

/** Meses en los que puede haber datos: desde el alta del suministro hasta hoy (o la baja). */
export function supplyBounds(s: SupplyRef): Bounds {
  const now = monthKey(new Date());
  const from = s.validDateFrom?.match(/^(\d{4})[/-](\d{2})/);
  const to = s.validDateTo?.match(/^(\d{4})[/-](\d{2})/);
  let min = from ? `${from[1]}-${from[2]}` : addMonths(now, -24);
  // Datadis no suele ofrecer más de unos años de histórico
  if (min < addMonths(now, -60)) min = addMonths(now, -60);
  let max = to ? `${to[1]}-${to[2]}` : now;
  if (max > now) max = now;
  if (min > max) min = max;
  return { min, max };
}

// ---------------------------------------------------------------------------
// Rango de fechas seleccionado (un día, una semana, un mes, un año o cualquier franja)
// ---------------------------------------------------------------------------

/** Fechas en formato YYYY-MM-DD, ambas incluidas */
export type DateRange = { from: string; to: string };

export type RangeKind = 'day' | 'week' | 'month' | 'year' | 'rolling12' | 'custom';

export function parseDay(k: string): Date {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(k: string, n: number): string {
  const d = parseDay(k);
  return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

function lastDayOfMonth(y: number, m: number): Date {
  return new Date(y, m + 1, 0);
}

export function daysBetween(r: DateRange): number {
  return Math.round((parseDay(r.to).getTime() - parseDay(r.from).getTime()) / 86_400_000) + 1;
}

/** Primer y último día con posibles datos */
export function dayBounds(b: Bounds): DateRange {
  const today = ymd(new Date());
  const [y, m] = b.max.split('-').map(Number);
  const maxEnd = ymd(lastDayOfMonth(y, m - 1));
  return { from: `${b.min}-01`, to: maxEnd < today ? maxEnd : today };
}

export function monthRangeOf(k: MonthKey, b: Bounds): DateRange {
  const [y, m] = k.split('-').map(Number);
  return clampRange({ from: `${k}-01`, to: ymd(lastDayOfMonth(y, m - 1)) }, b);
}

export function yearRangeOf(y: number, b: Bounds): DateRange {
  return clampRange({ from: `${y}-01-01`, to: `${y}-12-31` }, b);
}

function clampRange(r: DateRange, b: Bounds): DateRange {
  const db = dayBounds(b);
  return { from: r.from < db.from ? db.from : r.from, to: r.to > db.to ? db.to : r.to };
}

/** Rango inicial: el mes en curso */
export function initialRange(b: Bounds): DateRange {
  return monthRangeOf(b.max, b);
}

/** Qué tipo de periodo es (para el título, las flechas y las comparativas) */
export function rangeKind(r: DateRange): RangeKind {
  if (r.from === r.to) return 'day';
  const f = parseDay(r.from);
  const t = parseDay(r.to);
  const today = ymd(new Date());
  const monthEnd = ymd(lastDayOfMonth(f.getFullYear(), f.getMonth()));
  if (f.getDate() === 1 && f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear() && (r.to === monthEnd || r.to === today))
    return 'month';
  if (r.from.endsWith('-01-01') && r.from.slice(0, 4) === r.to.slice(0, 4) && (r.to.endsWith('-12-31') || r.to === today)) return 'year';
  if (f.getDate() === 1 && monthRange(r.from.slice(0, 7), r.to.slice(0, 7)).length === 12) return 'rolling12';
  if (daysBetween(r) === 7) return 'week';
  return 'custom';
}

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const WEEKDAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

function shortDay(k: string, withYear: boolean): string {
  const d = parseDay(k);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ''}`;
}

export function rangeLabel(r: DateRange): string {
  const kind = rangeKind(r);
  if (kind === 'day') {
    const d = parseDay(r.from);
    return `${cap(WEEKDAYS_SHORT[d.getDay()])} ${shortDay(r.from, true)}`;
  }
  if (kind === 'month') return cap(fmtMonthLong(r.from.slice(0, 7)));
  if (kind === 'year') return r.from.slice(0, 4);
  if (kind === 'rolling12') return `${cap(MONTHS_SHORT[parseDay(r.from).getMonth()])} ${r.from.slice(2, 4)} – ${MONTHS_SHORT[parseDay(r.to).getMonth()]} ${r.to.slice(2, 4)}`;
  const sameYear = r.from.slice(0, 4) === r.to.slice(0, 4);
  const sameMonth = sameYear && r.from.slice(5, 7) === r.to.slice(5, 7);
  if (sameMonth) return `${parseDay(r.from).getDate()} – ${shortDay(r.to, true)}`;
  return `${shortDay(r.from, !sameYear)} – ${shortDay(r.to, true)}`;
}

/**
 * Mueve el periodo hacia delante o hacia atrás según su tipo: un día, una semana, un mes,
 * un año o la misma duración en franjas personalizadas.
 */
export function stepRange(r: DateRange, dir: -1 | 1, b: Bounds): DateRange {
  const kind = rangeKind(r);
  if (kind === 'month') return monthRangeOf(addMonths(r.from.slice(0, 7), dir), b);
  if (kind === 'year') return yearRangeOf(Number(r.from.slice(0, 4)) + dir, b);
  if (kind === 'rolling12') {
    const from = addMonths(r.from.slice(0, 7), dir);
    const toM = addMonths(from, 11);
    const [y, m] = toM.split('-').map(Number);
    return clampRange({ from: `${from}-01`, to: ymd(lastDayOfMonth(y, m - 1)) }, b);
  }
  const n = daysBetween(r) * dir;
  return { from: addDays(r.from, n), to: addDays(r.to, n) };
}

export function canStepRange(r: DateRange, dir: -1 | 1, b: Bounds): boolean {
  const db = dayBounds(b);
  return dir < 0 ? r.from > db.from : r.to < db.to;
}

/** Meses que hay que cargar para un rango */
export function rangeMonths(r: DateRange): MonthKey[] {
  return monthRange(r.from.slice(0, 7), r.to.slice(0, 7));
}

/** Periodos con los que se compara (el anterior equivalente y el mismo del año pasado) */
export function rangeComparisons(r: DateRange, b: Bounds): { label: string; range: DateRange }[] {
  const kind = rangeKind(r);
  const db = dayBounds(b);
  const out: { label: string; range: DateRange }[] = [];
  const shiftMonths = (k: string, n: number) => {
    const d = parseDay(k);
    const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const last = lastDayOfMonth(t.getFullYear(), t.getMonth()).getDate();
    return ymd(new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), last)));
  };
  if (kind === 'month') {
    const prev = { from: shiftMonths(r.from, -1), to: shiftMonths(r.to, -1) };
    out.push({ label: `que ${fmtMonthLong(prev.from.slice(0, 7)).split(' ')[0]}`, range: prev });
    out.push({ label: `que ${fmtMonthLong(r.from.slice(0, 7)).split(' ')[0]} ${Number(r.from.slice(0, 4)) - 1}`, range: { from: shiftMonths(r.from, -12), to: shiftMonths(r.to, -12) } });
  } else if (kind === 'year' || kind === 'rolling12') {
    out.push({ label: kind === 'year' ? `que ${Number(r.from.slice(0, 4)) - 1}` : 'que los 12 meses anteriores', range: { from: shiftMonths(r.from, -12), to: shiftMonths(r.to, -12) } });
  } else if (kind === 'day') {
    out.push({ label: 'que el mismo día de la semana anterior', range: { from: addDays(r.from, -7), to: addDays(r.to, -7) } });
  } else {
    const n = daysBetween(r);
    out.push({ label: n === 7 ? 'que la semana anterior' : `que los ${n} días anteriores`, range: { from: addDays(r.from, -n), to: addDays(r.to, -n) } });
  }
  return out.filter((x) => x.range.to >= db.from);
}

/** Atajos del calendario */
export function rangePresets(b: Bounds): { label: string; range: DateRange }[] {
  const db = dayBounds(b);
  const last = db.to;
  const thisMonth = b.max;
  const y = Number(thisMonth.slice(0, 4));
  return [
    { label: 'Ayer', range: { from: addDays(ymd(new Date()), -1), to: addDays(ymd(new Date()), -1) } },
    { label: 'Últimos 7 días', range: { from: addDays(last, -6), to: last } },
    { label: 'Este mes', range: monthRangeOf(thisMonth, b) },
    { label: 'Mes pasado', range: monthRangeOf(addMonths(thisMonth, -1), b) },
    { label: 'Últimos 12 meses', range: clampRange({ from: `${addMonths(thisMonth, -11)}-01`, to: last }, b) },
    { label: `Año ${y}`, range: yearRangeOf(y, b) },
    { label: `Año ${y - 1}`, range: yearRangeOf(y - 1, b) },
  ].filter((p) => p.range.from <= p.range.to && p.range.to >= db.from);
}
