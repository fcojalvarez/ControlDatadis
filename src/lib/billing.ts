/**
 * Facturas estimadas por periodo de facturación.
 *
 * Cada periodo empieza el día `billingDay` de cada mes (1 = mes natural). Para cada día se
 * aplica la tarifa vigente ese día y la potencia contratada que había entonces, así que los
 * cambios de precio o de potencia a mitad de periodo se reparten correctamente.
 */
import { ZERO_COST, addCosts, estimateCost, type CostBreakdown, type Reading } from '@/lib/consumption';
import { ymd } from '@/lib/format';
import { PERIODS, type Period } from '@/lib/periods';
import { tariffOn, type Tariff } from '@/lib/tariff';

export type Bill = {
  start: string; // YYYY-MM-DD (incluido)
  end: string; // YYYY-MM-DD (incluido)
  days: number; // días facturados (hasta el último dato si el periodo está abierto)
  daysWithData: number;
  open: boolean; // periodo en curso (aún no ha terminado)
  incomplete: boolean; // faltan días de datos
  kwh: number;
  byPeriod: Record<Period, number>;
  surplus: number;
  cost: CostBreakdown;
  tariffNames: string[];
  contracted: number[]; // potencia del último día del periodo
};

function parseDay(k: string): Date {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Inicio del periodo de facturación que contiene el día `d` */
export function periodStart(d: Date, billingDay: number): Date {
  const dayIn = (y: number, m: number) => Math.min(billingDay, new Date(y, m + 1, 0).getDate());
  let y = d.getFullYear();
  let m = d.getMonth();
  if (d.getDate() < dayIn(y, m)) {
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
  }
  return new Date(y, m, dayIn(y, m));
}

function nextPeriodStart(start: Date, billingDay: number): Date {
  const y = start.getFullYear();
  const m = start.getMonth() + 1;
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(billingDay, last));
}

type DayAgg = { kwh: number; byPeriod: Record<Period, number>; surplus: number };

export function computeBills(
  readings: Reading[],
  billingDay: number,
  history: Tariff[],
  contractedOn: (day: string) => number[],
  today = new Date(),
  /** Limitar los días facturados a estas fechas (YYYY-MM-DD, ambas incluidas) */
  clip?: { from: string; to: string },
): Bill[] {
  if (!readings.length || !history.length) return [];
  // Consumo por día
  const byDay = new Map<string, DayAgg>();
  for (const r of readings) {
    let d = byDay.get(r.day);
    if (!d) {
      d = { kwh: 0, byPeriod: { P1: 0, P2: 0, P3: 0 }, surplus: 0 };
      byDay.set(r.day, d);
    }
    d.kwh += r.kwh;
    d.byPeriod[r.period] += r.kwh;
    d.surplus += r.surplus;
  }
  const days = [...byDay.keys()].sort();
  const firstData = parseDay(days[0]);
  const lastData = parseDay(days[days.length - 1]);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const bills: Bill[] = [];
  for (let start = periodStart(firstData, billingDay); start <= lastData; start = nextPeriodStart(start, billingDay)) {
    const next = nextPeriodStart(start, billingDay);
    const periodEnd = addDays(next, -1);
    const open = periodEnd >= todayStart;
    // En un periodo abierto se factura hasta el último día con datos
    let end = open && lastData < periodEnd ? lastData : periodEnd;
    let realStart = start < firstData ? firstData : start;
    if (clip) {
      if (ymd(realStart) < clip.from) realStart = parseDay(clip.from);
      if (ymd(end) > clip.to) end = parseDay(clip.to);
      if (realStart > end) continue;
    }

    // Agrupar los días por (tarifa, potencia) y calcular cada tramo
    const groups = new Map<string, { tariff: Tariff; kw: number[]; days: number; agg: DayAgg }>();
    let daysWithData = 0;
    for (let d = realStart; d <= end; d = addDays(d, 1)) {
      const key = ymd(d);
      const tariff = tariffOn(history, key);
      const kw = contractedOn(key);
      const gk = `${tariff.id}|${kw.join('/')}`;
      let g = groups.get(gk);
      if (!g) {
        g = { tariff, kw, days: 0, agg: { kwh: 0, byPeriod: { P1: 0, P2: 0, P3: 0 }, surplus: 0 } };
        groups.set(gk, g);
      }
      g.days += 1;
      const day = byDay.get(key);
      if (day) {
        daysWithData += 1;
        g.agg.kwh += day.kwh;
        g.agg.surplus += day.surplus;
        for (const p of PERIODS) g.agg.byPeriod[p] += day.byPeriod[p];
      }
    }

    let cost = ZERO_COST;
    const byPeriod: Record<Period, number> = { P1: 0, P2: 0, P3: 0 };
    let kwh = 0;
    let surplus = 0;
    let billDays = 0;
    for (const g of groups.values()) {
      cost = addCosts(cost, estimateCost(g.agg.byPeriod, g.agg.surplus, g.days, g.kw, g.tariff));
      kwh += g.agg.kwh;
      surplus += g.agg.surplus;
      billDays += g.days;
      for (const p of PERIODS) byPeriod[p] += g.agg.byPeriod[p];
    }
    if (!billDays) continue;
    bills.push({
      start: ymd(realStart),
      end: ymd(end),
      days: billDays,
      daysWithData,
      open,
      incomplete: daysWithData < billDays || realStart > start,
      kwh,
      byPeriod,
      surplus,
      cost,
      tariffNames: [...new Set([...groups.values()].map((g) => g.tariff.name))],
      contracted: contractedOn(ymd(end)),
    });
  }
  return bills;
}

/**
 * Coste de unas fechas cualesquiera (sin cortar en facturas), aplicando en cada día la tarifa y la
 * potencia que había entonces. Se factura desde el primer día con datos hasta el último (sin pasar
 * de `to`). Es el mismo cálculo que la pestaña Facturas, para que los importes cuadren.
 */
export function costOfRange(
  readings: Reading[],
  history: Tariff[],
  contractedOn: (day: string) => number[],
  from: string,
  to: string,
): { cost: CostBreakdown; days: number; tariffNames: string[] } {
  if (!readings.length || !history.length) return { cost: ZERO_COST, days: 0, tariffNames: [] };
  const lastData = readings[readings.length - 1].day;
  const bills = computeBills(readings, 1, history, contractedOn, new Date(), { from, to: to < lastData ? to : lastData });
  return {
    cost: bills.reduce((a, b) => addCosts(a, b.cost), ZERO_COST),
    days: bills.reduce((a, b) => a + b.days, 0),
    tariffNames: [...new Set(bills.flatMap((b) => b.tariffNames))],
  };
}

/** Coste total de un conjunto de lecturas con una tarifa fija (para comparar ofertas) */
export function costWithTariff(readings: Reading[], tariff: Tariff, contractedOn: (day: string) => number[]): { cost: CostBreakdown; days: number } {
  const bills = computeBills(readings, 1, [{ ...tariff, validFrom: '0000-01-01' }], contractedOn);
  return {
    cost: bills.reduce((a, b) => addCosts(a, b.cost), ZERO_COST),
    days: bills.reduce((a, b) => a + b.days, 0),
  };
}
