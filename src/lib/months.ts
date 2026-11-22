/** Utilidades de meses (claves 'YYYY-MM') */

/** 'YYYY-MM' */
export type MonthKey = string;

export function monthKey(d: Date): MonthKey {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthDate(k: MonthKey): Date {
  const [y, m] = k.split('-').map(Number);
  return new Date(y, m - 1, 1);
}

export function addMonths(k: MonthKey, n: number): MonthKey {
  const d = monthDate(k);
  return monthKey(new Date(d.getFullYear(), d.getMonth() + n, 1));
}

export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let k = from; k <= to; k = addMonths(k, 1)) out.push(k);
  return out;
}

export function daysInMonth(k: MonthKey): number {
  const d = monthDate(k);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
