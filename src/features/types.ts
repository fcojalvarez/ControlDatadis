export type SupplyRef = {
  cups: string;
  distributorCode: string;
  pointType: number;
  address: string;
  distributor: string;
  validDateFrom: string; // YYYY/MM/DD
  validDateTo: string;
};

export const POINT_TYPES: Record<number, string> = {
  1: 'Tipo 1 (> 10 MW)',
  2: 'Tipo 2 (> 450 kW)',
  3: 'Tipo 3 (> 15 kW)',
  4: 'Tipo 4 (≤ 15 kW, telegestión)',
  5: 'Tipo 5 (≤ 15 kW)',
};

export type RangeKey = 'thisMonth' | 'lastMonth' | '3m' | '6m' | '12m' | '24m';

/** Devuelve el primer y último mes (Date día 1) del rango, recortado a la vigencia del suministro. */
export function rangeMonths(range: RangeKey, supply?: SupplyRef): { start: Date; end: Date } {
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const back = (n: number) => new Date(thisMonth.getFullYear(), thisMonth.getMonth() - n, 1);
  let start: Date;
  let end: Date = thisMonth;
  switch (range) {
    case 'thisMonth':
      start = thisMonth;
      break;
    case 'lastMonth':
      start = back(1);
      end = back(1);
      break;
    case '3m':
      start = back(2);
      break;
    case '6m':
      start = back(5);
      break;
    case '12m':
      start = back(11);
      break;
    case '24m':
      start = back(23);
      break;
  }
  if (supply) {
    const from = parseYmd(supply.validDateFrom);
    const to = parseYmd(supply.validDateTo);
    if (from) {
      const fm = new Date(from.getFullYear(), from.getMonth(), 1);
      if (fm > start) start = fm;
    }
    if (to) {
      const tm = new Date(to.getFullYear(), to.getMonth(), 1);
      if (tm < end) end = tm;
    }
    if (start > end) start = end;
  }
  return { start, end };
}

function parseYmd(s: string): Date | null {
  const m = s?.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export function monthsBetween(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const d = new Date(start);
  while (d <= end) {
    out.push(new Date(d));
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}
