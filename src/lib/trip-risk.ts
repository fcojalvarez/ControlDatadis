/**
 * Estimación del riesgo de que salte el limitador de potencia (ICP / "los plomos").
 *
 * Datadis no informa de los cortes, así que se estima a partir de:
 *  1. La curva de consumo: la potencia media de cada intervalo (kWh / horas del intervalo).
 *  2. Las potencias máximas que registra el contador (máximo de 15 min de cada mes).
 *
 * Como la media horaria "suaviza" los picos (el horno, la vitro o el termo arrancan unos
 * minutos), se calcula un FACTOR DE PICO propio de la vivienda comparando el máximo medido
 * por el contador con la mayor media horaria de ese mismo día. Con ese factor se estima el
 * pico real de cada día y se compara con la potencia contratada (P1 en punta y llano, P2 en
 * valle).
 *
 * CURVA DEL LIMITADOR. El limitador integrado en los contadores inteligentes sigue la curva
 * térmica de la norma UNE 20317 (ICP-M): cuanto mayor es el exceso, antes corta.
 *   - hasta +10 % / +13 % de la potencia contratada: no corta (al menos 1 hora)
 *   - +10 % sostenido: corta antes de 1 hora
 *   - +20 % a +50 %: corta en minutos
 *   - +50 %: entre ~30 segundos y ~3 minutos
 *   - el doble: en segundos
 * Por eso, un pico medio de 15 minutos igual a la potencia contratada casi nunca hace saltar
 * el limitador: hace falta superarla con claridad de forma sostenida (≥ +10-15 % durante
 * muchos minutos) o con picos fuertes (≥ +50 %) de medio minuto o más dentro de esos 15 min.
 * La probabilidad diaria se modela con una curva logística sobre el pico de 15 minutos,
 * centrada en +15 % (50 %), que da ≈5 % al 100 %, ≈27 % al +10 % y ≈88 % al +25 %.
 */

import type { MaxPowerReading, Reading } from '@/lib/consumption';

/** Tabla orientativa de la curva de disparo (UNE 20317) para mostrar al usuario */
export const TRIP_CURVE: { factor: number; label: string; time: string }[] = [
  { factor: 1.1, label: '+10 %', time: 'No salta (o tarda más de 1 hora)' },
  { factor: 1.2, label: '+20 %', time: 'Puede saltar en 10-15 minutos' },
  { factor: 1.5, label: '+50 %', time: 'Salta en 30 segundos - 3 minutos' },
  { factor: 2, label: 'el doble', time: 'Salta en segundos' },
];

/** Pico de 15 min (en tanto por uno de la potencia contratada) con el que la probabilidad diaria es del 50 % */
const CENTER = 1.15;
/** Anchura de la curva: cuanto menor, más brusco el paso de "seguro" a "salta" */
const SCALE = 0.05;
/** Factor de pico por defecto si no hay potencias máximas con las que calibrar */
export const DEFAULT_PEAK_FACTOR = 1.5;

export function dayProbability(u: number): number {
  if (!Number.isFinite(u) || u <= 0) return 0;
  return 1 / (1 + Math.exp(-(u - CENTER) / SCALE));
}

/** Probabilidad de al menos un corte en `days` días, a partir de las probabilidades diarias de la muestra */
export function probabilityOver(pDays: number[], days = 30): number {
  if (!pDays.length) return 0;
  const meanLog = pDays.reduce((s, p) => s + Math.log(1 - Math.min(p, 0.999999)), 0) / pDays.length;
  return 1 - Math.exp(days * meanLog);
}

export type DayRisk = {
  day: string; // YYYY-MM-DD
  month: string; // YYYY-MM
  avgPeakKW: number; // mayor potencia media de un intervalo de la curva
  estPeakKW: number; // pico estimado (media × factor, o el medido por el contador)
  measured: boolean; // el pico viene del contador (máximo mensual)
  capped: boolean; // la estimación se ha limitado al máximo medido ese mes
  limitKW: number; // potencia contratada aplicable a ese pico
  u: number; // estPeakKW / limitKW (potencia contratada ese día)
  p: number; // probabilidad de corte ese día con la potencia que había entonces
  uNow: number; // mismo pico respecto a la potencia contratada actual
  pNow: number; // probabilidad con la potencia actual (para las previsiones)
  hour: number; // hora de inicio del pico
  period: string;
};

export type TripRisk = {
  factor: number;
  factorSamples: number;
  intervalMin: number;
  days: DayRisk[];
  pNext30: number;
  pTypicalMonth: number;
  byMonth: { month: string; p: number; maxU: number; days: number; expected: number }[];
  expectedTrips: number; // veces estimadas que ha saltado (suma de probabilidades diarias)
  likelyTripDays: DayRisk[]; // días en los que es muy probable que saltara (p ≥ 50 %)
  possibleTripDays: DayRisk[]; // días en los que pudo saltar (p ≥ 20 %)
  firstDay: string | null;
  lastDay: string | null;
  powerChanged: boolean; // la potencia contratada cambió dentro del periodo analizado
  worstMonth: { month: string; p: number } | null;
  byHour: number[]; // probabilidad media diaria de que el pico peligroso sea a esa hora (0..1)
  riskyDays: number; // días con pico estimado por encima de la potencia actual
  exceedances: MaxPowerReading[]; // veces que el contador midió más que lo contratado
  maxMeasured: MaxPowerReading | null;
  contracted: number[];
};

export type RiskLevel = { key: 'muy-bajo' | 'bajo' | 'moderado' | 'alto' | 'muy-alto'; label: string };

export function riskLevel(p: number): RiskLevel {
  if (p < 0.05) return { key: 'muy-bajo', label: 'Muy bajo' };
  if (p < 0.2) return { key: 'bajo', label: 'Bajo' };
  if (p < 0.5) return { key: 'moderado', label: 'Moderado' };
  if (p < 0.8) return { key: 'alto', label: 'Alto' };
  return { key: 'muy-alto', label: 'Muy alto' };
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Potencia contratada que aplica a un intervalo: P2 (valle) para P3 en la 2.0TD, P1 en el resto */
function limitFor(period: string, contracted: number[]): number {
  const p1 = contracted[0] ?? 0;
  const p2 = contracted[1] ?? p1;
  return /^(P3|VALLE)$/i.test(period) ? p2 : p1;
}

/** Tramo de contrato con su potencia, para aplicar en cada día la potencia que había entonces */
export type ContractPeriod = { from: string; to: string | null; kw: number[] }; // fechas YYYY-MM-DD

function normDate(s: string | null | undefined): string | null {
  const m = s?.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function contractPeriods(contracts: { startDate?: string | null; endDate?: string | null; contractedPowerkW?: number[] | null }[]): ContractPeriod[] {
  return contracts
    .filter((c) => c.contractedPowerkW?.length && (c.contractedPowerkW[0] ?? 0) > 0)
    .map((c) => ({ from: normDate(c.startDate) ?? '0000-00-00', to: normDate(c.endDate), kw: c.contractedPowerkW as number[] }))
    .sort((a, b) => (a.from < b.from ? -1 : 1));
}

function maxKey(r: MaxPowerReading): string {
  const m = r.date.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : r.date;
}

/**
 * @param readings   curva de consumo normalizada (horaria o cuartohoraria)
 * @param maxRows    potencias máximas del contador
 * @param contracted potencias contratadas [P1, P2] en kW
 * @param today      fecha de referencia (para la ventana de los próximos 30 días)
 * @param history    histórico de contratos: en cada día se aplica la potencia vigente entonces
 */
export function analyzeTripRisk(
  readings: Reading[],
  intervalMin: number,
  maxRows: MaxPowerReading[],
  contracted: number[],
  today = new Date(),
  history: ContractPeriod[] = [],
): TripRisk | null {
  if (!contracted.length || !(contracted[0] > 0) || !readings.length) return null;
  const toKW = 60 / intervalMin;
  const kwCache = new Map<string, number[]>();
  /** Potencia contratada vigente un día concreto (la actual si no hay histórico) */
  const contractedOn = (day: string): number[] => {
    let v = kwCache.get(day);
    if (!v) {
      v = history.find((h) => h.from <= day && (!h.to || day <= h.to))?.kw ?? contracted;
      kwCache.set(day, v);
    }
    return v;
  };

  // 1. Pico (por uso relativo a lo contratado) de cada día en la curva
  type Peak = { kw: number; u: number; hour: number; period: string; limit: number; month: string };
  const dayPeaks = new Map<string, Peak>();
  const dayMaxKW = new Map<string, number>();
  for (const r of readings) {
    const kw = r.kwh * toKW;
    const limit = limitFor(r.period, contractedOn(r.day));
    const u = limit > 0 ? kw / limit : 0;
    const cur = dayPeaks.get(r.day);
    if (!cur || u > cur.u) dayPeaks.set(r.day, { kw, u, hour: r.hour, period: r.period, limit, month: r.month });
    dayMaxKW.set(r.day, Math.max(dayMaxKW.get(r.day) ?? 0, kw));
  }

  // 2. Factor de pico: máximo medido por el contador / mayor media de intervalo ese día
  const ratios: number[] = [];
  for (const m of maxRows) {
    const avg = dayMaxKW.get(maxKey(m));
    if (avg && avg > 0.2) {
      const ratio = m.kw / avg;
      if (ratio >= 0.8 && ratio <= 5) ratios.push(ratio);
    }
  }
  const factor = ratios.length ? Math.min(3, Math.max(1, median(ratios))) : intervalMin <= 15 ? 1.15 : DEFAULT_PEAK_FACTOR;

  // Máximos medidos indexados por día (sustituyen a la estimación ese día)
  const measuredByDay = new Map<string, MaxPowerReading>();
  for (const m of maxRows) {
    const k = maxKey(m);
    const prev = measuredByDay.get(k);
    const kw = contractedOn(k);
    if (!prev || m.kw / limitFor(m.period, kw) > prev.kw / limitFor(prev.period, kw)) measuredByDay.set(k, m);
  }
  // El contador mide el máximo real de 15 min de cada mes: ningún día de ese mes puede superarlo
  const monthMaxKW = new Map<string, number>();
  for (const m of maxRows) monthMaxKW.set(m.key, Math.max(monthMaxKW.get(m.key) ?? 0, m.kw));

  // 3. Riesgo diario
  const days: DayRisk[] = [];
  const hourAcc = new Array(24).fill(0);
  for (const [day, pk] of [...dayPeaks.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    let est = pk.kw * factor;
    const cap = monthMaxKW.get(pk.month);
    let capped = false;
    if (cap !== undefined && est > cap) {
      est = cap;
      capped = true;
    }
    let limit = pk.limit;
    let measured = false;
    let hour = pk.hour;
    let period = pk.period;
    const m = measuredByDay.get(day);
    if (m) {
      const mLimit = limitFor(m.period, contractedOn(day));
      if (m.kw / mLimit >= est / limit) {
        est = m.kw;
        limit = mLimit;
        measured = true;
        hour = Number(m.time.slice(0, 2)) % 24;
        period = m.period;
      }
    }
    const u = est / limit;
    const p = dayProbability(u);
    const uNow = est / limitFor(period, contracted);
    const pNow = dayProbability(uNow);
    hourAcc[hour] += pNow;
    days.push({ day, month: pk.month, avgPeakKW: pk.kw, estPeakKW: est, measured, capped: capped && !measured, limitKW: limit, u, p, uNow, pNow, hour, period });
  }

  // 4. Agregados
  const byMonthMap = new Map<string, DayRisk[]>();
  for (const d of days) byMonthMap.set(d.month, [...(byMonthMap.get(d.month) ?? []), d]);
  const byMonth = [...byMonthMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, ds]) => ({
      month,
      p: probabilityOver(ds.map((d) => d.pNow)),
      maxU: Math.max(...ds.map((d) => d.uNow)),
      days: ds.length,
      expected: ds.reduce((a, d) => a + d.p, 0),
    }));
  const fullMonths = byMonth.filter((m) => m.days >= 20);
  const worstMonth = (fullMonths.length ? fullMonths : byMonth).reduce<{ month: string; p: number } | null>(
    (w, m) => (!w || m.p > w.p ? { month: m.month, p: m.p } : w),
    null,
  );

  // Próximos 30 días: últimos 30 días + la misma ventana del año pasado (estacionalidad)
  const dayMs = 86_400_000;
  const t = today.getTime();
  const inWindow = (day: string) => {
    const [y, mo, d] = day.split('-').map(Number);
    const ts = new Date(y, mo - 1, d).getTime();
    return (ts > t - 31 * dayMs && ts <= t) || (ts >= t - 365 * dayMs && ts <= t - 335 * dayMs);
  };
  const windowDays = days.filter((d) => inWindow(d.day));
  // Las previsiones usan siempre la potencia contratada actual
  const pNext30 = probabilityOver((windowDays.length >= 7 ? windowDays : days.slice(-30)).map((d) => d.pNow));

  const exceedances = maxRows.filter((m) => m.kw > limitFor(m.period, contractedOn(maxKey(m))));
  const kwSet = new Set(days.map((d) => contractedOn(d.day).join('/')));
  const maxMeasured = maxRows.reduce<MaxPowerReading | null>((a, m) => (!a || m.kw > a.kw ? m : a), null);

  return {
    factor,
    factorSamples: ratios.length,
    intervalMin,
    days,
    pNext30,
    pTypicalMonth: probabilityOver(days.map((d) => d.pNow)),
    byMonth,
    worstMonth,
    byHour: hourAcc.map((v) => (days.length ? v / days.length : 0)),
    riskyDays: days.filter((d) => d.uNow >= 1).length,
    expectedTrips: days.reduce((a, d) => a + d.p, 0),
    likelyTripDays: days.filter((d) => d.p >= 0.5),
    possibleTripDays: days.filter((d) => d.p >= 0.2),
    firstDay: days[0]?.day ?? null,
    lastDay: days[days.length - 1]?.day ?? null,
    powerChanged: kwSet.size > 1,
    exceedances,
    maxMeasured,
    contracted,
  };
}

/** Potencias normalizadas habituales en baja tensión (kW) */
export const STANDARD_POWERS = [2.3, 3.45, 4.6, 5.75, 6.9, 8.05, 9.2, 10.35, 11.5, 13.86, 14.49];

/** Riesgo si se contratase otra potencia (misma potencia en P1 y P2) */
export function whatIf(
  risk: TripRisk,
  powerKW: number,
): { pTypical: number; pWorst: number; expectedTrips: number; likelyDays: number } {
  const ps = risk.days.map((d) => dayProbability(d.estPeakKW / powerKW));
  const byMonth = new Map<string, number[]>();
  risk.days.forEach((d, i) => byMonth.set(d.month, [...(byMonth.get(d.month) ?? []), ps[i]]));
  let pWorst = 0;
  for (const arr of byMonth.values()) if (arr.length >= 20 || byMonth.size === 1) pWorst = Math.max(pWorst, probabilityOver(arr));
  return {
    pTypical: probabilityOver(ps),
    pWorst,
    expectedTrips: ps.reduce((a, p) => a + p, 0),
    likelyDays: ps.filter((p) => p >= 0.5).length,
  };
}
