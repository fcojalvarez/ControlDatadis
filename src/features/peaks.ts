/**
 * Picos de potencia YA OCURRIDOS. Nada de previsiones: solo lo medido.
 *
 *  - Por mes: Datadis da el pico que mide el contador (potencia media de 15 minutos), uno por mes
 *    y periodo, con su día y hora. Es el dato exacto.
 *  - Por día y por semana: Datadis no da picos, así que salen de la curva de consumo. Con datos
 *    cada 15 minutos es el mismo dato que mide el contador; con datos cada hora es la media de esa
 *    hora (queda por debajo del pico real). Si el contador midió ese día un pico mayor, se usa ese.
 */
import { useEffect, useMemo } from 'react';

import { useSession } from '@/context/session';
import { normalizeMaxPower, normalizeMonth, type CompactReading, type MaxPowerReading, type Reading } from '@/lib/consumption';
import { currentContract } from '@/lib/contracts';
import { maxPowerPeriod, type Period } from '@/lib/periods';
import { setJSON } from '@/lib/storage';

import { useContract, useMaxPower } from './queries';
import type { SupplyRef } from './types';

/** Potencia contratada que aplica a un periodo (P1 en punta y llano, P2 en valle) */
export function limitForPeriod(period: Period | string, contracted: number[]): number {
  const p1 = contracted[0] ?? 0;
  const p2 = contracted[1] ?? p1;
  return maxPowerPeriod(period) === 'P3' ? p2 : p1;
}

export type MonthPeak = { month: string; max: MaxPowerReading; byPeriod: Partial<Record<Period, MaxPowerReading>> };

/** Picos medidos por el contador en los últimos 24 meses */
export function useMeasuredPeaks(supply: SupplyRef) {
  const { username } = useSession();
  const q = useMaxPower(supply);
  const contract = useContract(supply);
  const contracted = useMemo(() => currentContract(contract.data?.contracts)?.contractedPowerkW ?? [], [contract.data]);

  const rows = useMemo(() => (q.data ? normalizeMaxPower(q.data.rows) : []), [q.data]);
  const monthly = useMemo(() => {
    const map = new Map<string, MonthPeak>();
    for (const r of rows) {
      const cur = map.get(r.key) ?? { month: r.key, max: r, byPeriod: {} };
      if (r.kw > cur.max.kw) cur.max = r;
      const p = r.period as Period;
      if (!cur.byPeriod[p] || r.kw > cur.byPeriod[p]!.kw) cur.byPeriod[p] = r;
      map.set(r.key, cur);
    }
    return [...map.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
  }, [rows]);
  const absMax = monthly.reduce<MaxPowerReading | null>((m, x) => (!m || x.max.kw > m.kw ? x.max : m), null);
  const limitOf = (r: MaxPowerReading) => limitForPeriod(r.period, contracted);
  /** Picos medidos por encima de la potencia contratada, del más reciente al más antiguo */
  const exceedances = rows.filter((r) => contracted.length && r.kw > limitOf(r)).reverse();

  // Último pico medido para la tarjeta de la pantalla de inicio
  const last = monthly[monthly.length - 1];
  useEffect(() => {
    if (!last) return;
    const limit = limitForPeriod(last.max.period, contracted);
    setJSON(peakStorageKey(username, supply.cups), { kw: last.max.kw, month: last.month, pct: limit ? last.max.kw / limit : null });
  }, [last, contracted, username, supply.cups]);

  return { ...q, rows, monthly, absMax, contracted, limitOf, exceedances };
}

export function peakStorageKey(username: string | null, cups: string) {
  return `peak:${username}:${cups}`;
}

/** Pico de un día o una semana */
export type CurvePeak = {
  key: string; // día YYYY-MM-DD o lunes de la semana
  day: string; // día en que fue el pico
  kw: number;
  start: number; // inicio del intervalo
  intervalMin: number;
  period: Period;
  measured: boolean; // viene del contador (no de la curva)
  measuredTime?: string;
};

/**
 * Pico de cada día a partir de la curva de consumo (y del pico del contador si ese día fue mayor).
 */
export function dailyPeaks(month: string, rows: CompactReading[], intervalMin: number, measured: MaxPowerReading[]): CurvePeak[] {
  const toKW = 60 / intervalMin;
  const byDay = new Map<string, CurvePeak>();
  const readings: Reading[] = normalizeMonth(month, rows, intervalMin);
  for (const r of readings) {
    const kw = r.kwh * toKW;
    const cur = byDay.get(r.day);
    if (!cur || kw > cur.kw) byDay.set(r.day, { key: r.day, day: r.day, kw, start: r.start, intervalMin, period: r.period, measured: false });
  }
  for (const m of measured) {
    const day = m.date.replace(/\//g, '-').slice(0, 10);
    const cur = byDay.get(day);
    if (cur && m.kw > cur.kw + 0.005) {
      byDay.set(day, { ...cur, kw: m.kw, period: m.period as Period, measured: true, measuredTime: m.time });
    }
  }
  return [...byDay.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** Lunes (YYYY-MM-DD) de la semana de un día */
export function weekStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** Pico de cada semana (lunes a domingo) a partir de los picos diarios */
export function weeklyPeaks(days: CurvePeak[]): (CurvePeak & { from: string; to: string })[] {
  const map = new Map<string, CurvePeak & { from: string; to: string }>();
  for (const d of days) {
    const k = weekStart(d.key);
    const cur = map.get(k);
    if (!cur) map.set(k, { ...d, key: k, from: d.key, to: d.key });
    else {
      cur.to = d.key;
      if (d.kw > cur.kw) Object.assign(cur, { kw: d.kw, day: d.day, start: d.start, period: d.period, measured: d.measured, measuredTime: d.measuredTime });
    }
  }
  return [...map.values()];
}
