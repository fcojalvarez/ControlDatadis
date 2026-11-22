import { useCallback, useEffect, useRef, useState } from 'react';

import type { DistributorError, MeasurementType } from '@/api/datadis';
import { useSession } from '@/context/session';
import { DAY, HOUR } from '@/hooks/use-cached-query';
import { compact, type CompactReading } from '@/lib/consumption';
import { cacheGet, cacheSet } from '@/lib/storage';

import { fetchRanged } from './queries';
import type { SupplyRef } from './types';

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

/**
 * Cuánto tiempo vale la caché de un mes:
 *  - mes en curso o recién cerrado (las distribuidoras publican con 1-3 días de retraso): 6 h
 *  - mes sin datos: 6 h (puede que la distribuidora aún no los haya publicado)
 *  - mes cerrado con datos: 30 días
 */
function monthTtl(k: MonthKey, rowCount: number): number {
  const end = monthDate(addMonths(k, 1));
  const ageMs = Date.now() - end.getTime();
  if (ageMs < 4 * DAY || rowCount === 0) return 6 * HOUR;
  return 30 * DAY;
}

type MonthEntry = { rows: CompactReading[] };

type State = {
  months: Record<MonthKey, CompactReading[]>;
  loading: boolean;
  error: string | null;
  errors: DistributorError[];
  updatedAt: number | null;
  stale: boolean; // se muestran datos guardados porque la actualización falló o vino vacía
};

/** Agrupa meses en tramos consecutivos */
function contiguousRuns(keys: MonthKey[]): MonthKey[][] {
  const sorted = [...keys].sort();
  const runs: MonthKey[][] = [];
  for (const k of sorted) {
    const last = runs[runs.length - 1];
    if (last && addMonths(last[last.length - 1], 1) === k) last.push(k);
    else runs.push([k]);
  }
  return runs;
}

/**
 * Curva de consumo de un conjunto de meses. Cada mes se guarda por separado en la caché,
 * de modo que navegar entre periodos reutiliza lo ya descargado y solo se pide a Datadis
 * lo que falta (agrupando meses consecutivos en una sola petición).
 */
export function useConsumptionMonths(supply: SupplyRef, months: MonthKey[], measurementType: MeasurementType) {
  const { client, settings, username } = useSession();
  const nif = settings.activeNif ?? undefined;
  const prefix = `consm:${username}:${nif ?? 'me'}:${supply.cups}:${measurementType}:`;
  const monthsKey = months.join(',');
  const [state, setState] = useState<State>({ months: {}, loading: true, error: null, errors: [], updatedAt: null, stale: false });
  const runId = useRef(0);

  const load = useCallback(
    async (force: boolean) => {
      const id = ++runId.current;
      const keys = monthsKey ? monthsKey.split(',') : [];
      const found: Record<MonthKey, CompactReading[]> = {};
      const missing: MonthKey[] = [];
      let oldest: number | null = null;

      for (const k of keys) {
        const c = force ? null : await cacheGet<MonthEntry>(prefix + k);
        if (c) {
          found[k] = c.data.rows;
          oldest = oldest === null ? c.ts : Math.min(oldest, c.ts);
          if (Date.now() - c.ts > monthTtl(k, c.data.rows.length)) missing.push(k);
        } else {
          missing.push(k);
        }
      }
      if (id !== runId.current) return;
      setState({ months: found, loading: missing.length > 0, error: null, errors: [], updatedAt: oldest, stale: false });
      if (!missing.length) return;

      const errors: DistributorError[] = [];
      let error: string | null = null;
      let keptSaved = false;
      for (const run of contiguousRuns(missing)) {
        try {
          const r = await fetchRanged(monthDate(run[0]), monthDate(run[run.length - 1]), (s, e) =>
            client.getConsumption({
              cups: supply.cups,
              distributorCode: supply.distributorCode,
              startDate: s,
              endDate: e,
              measurementType,
              pointType: supply.pointType,
              authorizedNif: nif,
            }),
          );
          errors.push(...r.errors);
          const byMonth: Record<MonthKey, CompactReading[]> = Object.fromEntries(run.map((k) => [k, []]));
          for (const row of compact(r.rows)) {
            const k = row[0].slice(0, 7).replace('/', '-');
            (byMonth[k] ??= []).push(row);
          }
          let partial = false;
          for (const k of run) {
            // Meses que Datadis no llegó a devolver: no se guardan (se reintentarán)
            if (!r.okMonths.has(k.replace('-', '/'))) {
              partial = true;
              continue;
            }
            // Si Datadis devuelve un mes vacío pero ya lo teníamos guardado con datos, se conserva
            if (!byMonth[k].length && found[k]?.length) {
              keptSaved = true;
              continue;
            }
            await cacheSet<MonthEntry>(prefix + k, { rows: byMonth[k] });
            found[k] = byMonth[k];
          }
          if (partial) error = 'Datadis no devolvió algunos meses. Se reintentarán más tarde.';
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
          // Datadis no responde: no se insiste con el resto de meses (se reintentará más tarde)
          break;
        }
        if (id !== runId.current) return;
        setState((s) => ({ ...s, months: { ...found } }));
      }
      if (id !== runId.current) return;
      setState({
        months: { ...found },
        loading: false,
        error,
        errors,
        updatedAt: error ? oldest : Date.now(),
        stale: keptSaved || (!!error && Object.values(found).some((rows) => rows.length > 0)),
      });
    },
    [monthsKey, prefix, client, supply.cups, supply.distributorCode, supply.pointType, measurementType, nif],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);
  /** Vuelve a intentar solo los meses que faltan o están caducados */
  const retry = useCallback(() => load(false), [load]);
  return { ...state, refresh, retry };
}
