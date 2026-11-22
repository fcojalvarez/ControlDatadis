import type { ConsumptionRaw, MaxPowerRaw } from '@/api/datadis';
import { ym, ymd } from '@/lib/format';
import { periodFor, type Period } from '@/lib/periods';

/** Lectura normalizada: el intervalo empieza en `start`. */
export type Reading = {
  start: number; // epoch ms (hora local)
  day: string; // YYYY-MM-DD (del inicio del intervalo)
  month: string; // YYYY-MM
  hour: number; // 0..23
  weekday: number; // 0 = lunes ... 6 = domingo
  period: Period;
  kwh: number;
  real: boolean;
  surplus: number;
  generation: number;
  selfConsumption: number;
};

/** Formato compacto para guardar en caché */
export type CompactReading = [string, string, number, 0 | 1, number, number, number];

export function compact(rows: ConsumptionRaw[]): CompactReading[] {
  return rows.map((r) => [
    r.date,
    r.time,
    r.consumptionKWh ?? 0,
    /real/i.test(r.obtainMethod ?? '') ? 1 : 0,
    r.surplusEnergyKWh ?? 0,
    r.generationEnergyKWh ?? 0,
    r.selfConsumptionEnergyKWh ?? 0,
  ]);
}

function parseDateTime(date: string, time: string): Date | null {
  const dm = date.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  const tm = time.match(/^(\d{1,2}):(\d{2})/);
  if (!dm || !tm) return null;
  return new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]));
}

/**
 * Datadis indica la hora de FIN del intervalo (01:00 = consumo de 00:00 a 01:00).
 * `intervalMin` es 60 para datos horarios y 15 para cuartohorarios.
 */
export function normalize(rows: CompactReading[], intervalMin: number): Reading[] {
  const out: Reading[] = [];
  for (const [date, time, kwh, real, surplus, generation, selfConsumption] of rows) {
    const end = parseDateTime(date, time);
    if (!end) continue;
    const start = new Date(end.getTime() - intervalMin * 60_000);
    out.push({
      start: start.getTime(),
      day: ymd(start),
      month: ym(start),
      hour: start.getHours(),
      weekday: (start.getDay() + 6) % 7,
      period: periodFor(start),
      kwh: Number(kwh) || 0,
      real: real === 1,
      surplus: Number(surplus) || 0,
      generation: Number(generation) || 0,
      selfConsumption: Number(selfConsumption) || 0,
    });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

export type Bucket = {
  key: string;
  total: number;
  P1: number;
  P2: number;
  P3: number;
  surplus: number;
  generation: number;
  selfConsumption: number;
  count: number;
};

function emptyBucket(key: string): Bucket {
  return { key, total: 0, P1: 0, P2: 0, P3: 0, surplus: 0, generation: 0, selfConsumption: 0, count: 0 };
}

function addTo(b: Bucket, r: Reading) {
  b.total += r.kwh;
  b[r.period] += r.kwh;
  b.surplus += r.surplus;
  b.generation += r.generation;
  b.selfConsumption += r.selfConsumption;
  b.count += 1;
}

export function groupBy(readings: Reading[], keyOf: (r: Reading) => string): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const r of readings) {
    const k = keyOf(r);
    let b = map.get(k);
    if (!b) {
      b = emptyBucket(k);
      map.set(k, b);
    }
    addTo(b, r);
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export type Summary = {
  total: number;
  byPeriod: Record<Period, number>;
  surplus: number;
  generation: number;
  selfConsumption: number;
  days: number;
  avgPerDay: number;
  realCount: number;
  estimatedCount: number;
  peak: Reading | null;
  maxDay: Bucket | null;
  minDay: Bucket | null;
  baseLoadKW: number; // consumo base estimado (percentil 10 horario)
  hourProfile: number[]; // media kWh por hora del día (24)
  hourProfileByPeriod: Record<Period, number[]>; // misma media desglosada por periodo
  heat: number[][]; // [díaSemana 0=lunes][hora] media kWh
  weekdayAvg: number[]; // media kWh diaria por día de la semana (7)
  daily: Bucket[];
  monthly: Bucket[];
  firstDay: string | null;
  lastDay: string | null;
  hasSelfConsumption: boolean;
};

export function summarize(readings: Reading[], intervalMin: number): Summary {
  const byPeriod: Record<Period, number> = { P1: 0, P2: 0, P3: 0 };
  let total = 0;
  let surplus = 0;
  let generation = 0;
  let selfConsumption = 0;
  let realCount = 0;
  let peak: Reading | null = null;
  const hourSum = new Array(24).fill(0);
  const hourByPeriod: Record<Period, number[]> = {
    P1: new Array(24).fill(0),
    P2: new Array(24).fill(0),
    P3: new Array(24).fill(0),
  };
  const heatSum = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const heatDays = Array.from({ length: 7 }, () => new Set<string>());

  for (const r of readings) {
    total += r.kwh;
    byPeriod[r.period] += r.kwh;
    surplus += r.surplus;
    generation += r.generation;
    selfConsumption += r.selfConsumption;
    if (r.real) realCount++;
    if (!peak || r.kwh > peak.kwh) peak = r;
    hourSum[r.hour] += r.kwh;
    hourByPeriod[r.period][r.hour] += r.kwh;
    heatSum[r.weekday][r.hour] += r.kwh;
    heatDays[r.weekday].add(r.day);
  }

  const daily = groupBy(readings, (r) => r.day);
  const monthly = groupBy(readings, (r) => r.month);
  const days = daily.length;

  // Para los días incompletos (p. ej. hoy) no penalizamos la media diaria
  const fullDays = daily.filter((d) => d.count >= (24 * 60) / intervalMin - 1);
  let maxDay: Bucket | null = null;
  let minDay: Bucket | null = null;
  for (const d of fullDays) {
    if (!maxDay || d.total > maxDay.total) maxDay = d;
    if (!minDay || d.total < minDay.total) minDay = d;
  }

  const weekdaySum = new Array(7).fill(0);
  const weekdayCount = new Array(7).fill(0);
  for (const d of fullDays) {
    const [y, m, dd] = d.key.split('-').map(Number);
    const wd = (new Date(y, m - 1, dd).getDay() + 6) % 7;
    weekdaySum[wd] += d.total;
    weekdayCount[wd] += 1;
  }

  // Consumo base: percentil 10 de las lecturas, convertido a potencia media (kW)
  let baseLoadKW = 0;
  if (readings.length) {
    const sorted = readings.map((r) => r.kwh).sort((a, b) => a - b);
    const p10 = sorted[Math.floor(sorted.length * 0.1)];
    baseLoadKW = p10 * (60 / intervalMin);
  }

  return {
    total,
    byPeriod,
    surplus,
    generation,
    selfConsumption,
    days,
    avgPerDay: fullDays.length ? fullDays.reduce((s, d) => s + d.total, 0) / fullDays.length : days ? total / days : 0,
    realCount,
    estimatedCount: readings.length - realCount,
    peak,
    maxDay,
    minDay,
    baseLoadKW,
    hourProfile: hourSum.map((s) => (days ? s / days : 0)),
    hourProfileByPeriod: {
      P1: hourByPeriod.P1.map((s) => (days ? s / days : 0)),
      P2: hourByPeriod.P2.map((s) => (days ? s / days : 0)),
      P3: hourByPeriod.P3.map((s) => (days ? s / days : 0)),
    },
    heat: heatSum.map((row, wd) => row.map((v) => (heatDays[wd].size ? v / heatDays[wd].size : 0))),
    weekdayAvg: weekdaySum.map((s, i) => (weekdayCount[i] ? s / weekdayCount[i] : 0)),
    daily,
    monthly,
    firstDay: daily[0]?.key ?? null,
    lastDay: daily[daily.length - 1]?.key ?? null,
    hasSelfConsumption: surplus > 0 || generation > 0 || selfConsumption > 0,
  };
}

// ---------- Coste estimado ----------

export type Prices = {
  energy: Record<Period, number>; // €/kWh
  powerP1: number; // €/kW·día
  powerP2: number; // €/kW·día
  surplus: number; // €/kWh compensación de excedentes
  electricityTax: number; // % impuesto eléctrico
  vat: number; // % IVA
  meterRental: number; // €/día alquiler contador
};

export const DEFAULT_PRICES: Prices = {
  energy: { P1: 0.2, P2: 0.13, P3: 0.09 },
  powerP1: 0.0863,
  powerP2: 0.0042,
  surplus: 0.05,
  electricityTax: 5.11,
  vat: 21,
  meterRental: 0.0266,
};

export type CostBreakdown = {
  energy: number;
  power: number;
  surplusCompensation: number;
  electricityTax: number;
  meterRental: number;
  vat: number;
  total: number;
};

export function estimateCost(
  byPeriod: Record<Period, number>,
  surplusKWh: number,
  days: number,
  contractedKW: number[],
  prices: Prices,
): CostBreakdown {
  const energy = byPeriod.P1 * prices.energy.P1 + byPeriod.P2 * prices.energy.P2 + byPeriod.P3 * prices.energy.P3;
  const p1 = contractedKW[0] ?? 0;
  const p2 = contractedKW[1] ?? p1;
  const power = days * (p1 * prices.powerP1 + p2 * prices.powerP2);
  // La compensación simplificada no puede superar el término de energía
  const surplusCompensation = Math.min(surplusKWh * prices.surplus, energy);
  const base = energy - surplusCompensation + power;
  const electricityTax = (base * prices.electricityTax) / 100;
  const meterRental = days * prices.meterRental;
  const vat = ((base + electricityTax + meterRental) * prices.vat) / 100;
  return {
    energy,
    power,
    surplusCompensation,
    electricityTax,
    meterRental,
    vat,
    total: base + electricityTax + meterRental + vat,
  };
}

// ---------- Potencias máximas ----------

export type MaxPowerReading = {
  key: string; // YYYY-MM
  date: string;
  time: string;
  kw: number;
  period: string;
};

export function normalizeMaxPower(rows: MaxPowerRaw[]): MaxPowerReading[] {
  return rows
    .map((r) => {
      const m = r.date.match(/^(\d{4})[/-](\d{2})/);
      return {
        key: m ? `${m[1]}-${m[2]}` : r.date,
        date: r.date,
        time: r.time,
        // Datadis devuelve W
        kw: Number(r.maxPower) / 1000,
        period: r.period,
      };
    })
    .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
}

// ---------- CSV ----------

export function readingsToCsv(cups: string, readings: Reading[]): string {
  const lines = ['cups;fecha;hora_inicio;periodo;consumo_kwh;excedentes_kwh;generacion_kwh;autoconsumo_kwh;metodo'];
  for (const r of readings) {
    const d = new Date(r.start);
    const hh = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    lines.push(
      [
        cups,
        r.day,
        hh,
        r.period,
        r.kwh.toFixed(3).replace('.', ','),
        r.surplus.toFixed(3).replace('.', ','),
        r.generation.toFixed(3).replace('.', ','),
        r.selfConsumption.toFixed(3).replace('.', ','),
        r.real ? 'Real' : 'Estimada',
      ].join(';'),
    );
  }
  return lines.join('\n');
}

/** % de variación de a respecto a b (null si no se puede calcular) */
export function pctChange(a: number, b: number): number | null {
  if (!b || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  return ((a - b) / b) * 100;
}
