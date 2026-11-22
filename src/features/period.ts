import { cap, fmtMonthLong } from '@/lib/format';

import { addMonths, monthKey, monthRange, type MonthKey } from './consumption-data';
import type { SupplyRef } from './types';

export type PeriodMode = 'month' | 'year' | 'rolling';

export const MODE_OPTIONS: { value: PeriodMode; label: string }[] = [
  { value: 'month', label: 'Mes' },
  { value: 'year', label: 'Año' },
  { value: 'rolling', label: '12 meses' },
];

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

function clamp(keys: MonthKey[], b: Bounds) {
  return keys.filter((k) => k >= b.min && k <= b.max);
}

export type PeriodSel = { mode: PeriodMode; month: MonthKey; year: number };

export function initialPeriod(b: Bounds): PeriodSel {
  return { mode: 'month', month: b.max, year: Number(b.max.slice(0, 4)) };
}

/** Meses que se muestran */
export function windowMonths(p: PeriodSel, b: Bounds): MonthKey[] {
  switch (p.mode) {
    case 'month':
      return [p.month];
    case 'year':
      return clamp(monthRange(`${p.year}-01`, `${p.year}-12`), b);
    case 'rolling':
      return clamp(monthRange(addMonths(b.max, -11), b.max), b);
  }
}

/** Meses con los que se compara (y cuántos meses hay que desplazar las fechas) */
export function comparisons(p: PeriodSel, b: Bounds): { label: string; months: MonthKey[]; shift: number }[] {
  const out: { label: string; months: MonthKey[]; shift: number }[] = [];
  if (p.mode === 'month') {
    const prev = addMonths(p.month, -1);
    if (prev >= b.min) out.push({ label: `que ${fmtMonthLong(prev).split(' ')[0]}`, months: [prev], shift: 1 });
    const yoy = addMonths(p.month, -12);
    if (yoy >= b.min) out.push({ label: `que ${fmtMonthLong(yoy)}`, months: [yoy], shift: 12 });
  } else {
    const prev = windowMonths(p, b).map((k) => addMonths(k, -12)).filter((k) => k >= b.min);
    if (prev.length) out.push({ label: p.mode === 'year' ? `que ${p.year - 1}` : 'que los 12 meses anteriores', months: prev, shift: 12 });
  }
  return out;
}

export function periodLabel(p: PeriodSel, b: Bounds): string {
  if (p.mode === 'month') return cap(fmtMonthLong(p.month));
  if (p.mode === 'year') return String(p.year);
  const w = windowMonths(p, b);
  return `${cap(fmtMonthLong(w[0]))} – ${fmtMonthLong(w[w.length - 1])}`;
}

export function canStep(p: PeriodSel, b: Bounds, dir: -1 | 1): boolean {
  if (p.mode === 'month') return dir < 0 ? p.month > b.min : p.month < b.max;
  if (p.mode === 'year') return dir < 0 ? p.year > Number(b.min.slice(0, 4)) : p.year < Number(b.max.slice(0, 4));
  return false;
}

export function step(p: PeriodSel, dir: -1 | 1): PeriodSel {
  if (p.mode === 'month') return { ...p, month: addMonths(p.month, dir), year: Number(addMonths(p.month, dir).slice(0, 4)) };
  if (p.mode === 'year') return { ...p, year: p.year + dir, month: `${p.year + dir}-${p.month.slice(5)}` };
  return p;
}
