import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { DistributorError, MeasurementType } from '@/api/datadis';
import { useSession } from '@/context/session';
import { DAY, HOUR } from '@/hooks/use-cached-query';
import type { CompactReading } from '@/lib/consumption';
import { cacheGet } from '@/lib/storage';

import { PRIORITY, consumptionSync, type MonthJob } from './consumption-sync';
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
 * Cuánto tiempo vale lo guardado de un mes antes de volver a preguntar a Datadis:
 *  - mes en curso o recién cerrado (las distribuidoras publican con 1-3 días de retraso): 6 h
 *  - mes reciente sin datos: 6 h (puede que la distribuidora aún no los haya publicado)
 *  - mes antiguo sin datos (antes de que hubiera histórico): 30 días
 *  - mes cerrado con datos: 30 días
 */
function monthTtl(k: MonthKey, rowCount: number): number {
  const end = monthDate(addMonths(k, 1));
  const ageMs = Date.now() - end.getTime();
  if (ageMs < 4 * DAY) return 6 * HOUR;
  if (rowCount === 0) return ageMs < 60 * DAY ? 6 * HOUR : 30 * DAY;
  return 30 * DAY;
}

type MonthEntry = { rows: CompactReading[]; distributorErrors?: DistributorError[] };

type Loaded = {
  key: string; // conjunto de meses al que pertenece
  months: Record<MonthKey, CompactReading[]>;
  distributorErrors: DistributorError[];
  updatedAt: number | null;
  reading: boolean; // leyendo lo guardado en el móvil
};

/**
 * Curva de consumo de un conjunto de meses.
 * 1. Muestra al momento lo que hay guardado en el móvil.
 * 2. Encola en la descarga global (mes a mes) los meses que faltan o están caducados.
 * 3. Se actualiza según van llegando los meses.
 * `priority`: PRIORITY.VIEW para lo que se ve en pantalla, PRIORITY.HISTORY para el histórico.
 */
export function useConsumptionMonths(
  supply: SupplyRef,
  months: MonthKey[],
  measurementType: MeasurementType,
  priority: number = PRIORITY.VIEW,
) {
  const { client, settings, username } = useSession();
  const nif = settings.activeNif ?? undefined;
  const prefix = `consm:${username}:${nif ?? 'me'}:${supply.cups}:${measurementType}:`;
  const monthsKey = `${prefix}|${months.join(',')}`;
  const [loaded, setLoaded] = useState<Loaded>({ key: '', months: {}, distributorErrors: [], updatedAt: null, reading: true });
  const sync = useSyncExternalStore(consumptionSync.subscribe, consumptionSync.getSnapshot);

  const jobFor = useCallback(
    (m: MonthKey): MonthJob => ({
      key: prefix + m,
      month: m,
      cups: supply.cups,
      distributorCode: supply.distributorCode,
      pointType: supply.pointType,
      measurementType,
      authorizedNif: nif,
      priority,
    }),
    [prefix, supply.cups, supply.distributorCode, supply.pointType, measurementType, nif, priority],
  );

  // 1 y 2: leer lo guardado y encolar lo que falta
  useEffect(() => {
    let alive = true;
    const list = monthsKey.split('|')[1] ? monthsKey.split('|')[1].split(',') : [];
    (async () => {
      const found: Record<MonthKey, CompactReading[]> = {};
      const distributorErrors: DistributorError[] = [];
      const toFetch: MonthKey[] = [];
      let oldest: number | null = null;
      for (const m of list) {
        const c = await cacheGet<MonthEntry>(prefix + m);
        if (c) {
          found[m] = c.data.rows;
          distributorErrors.push(...(c.data.distributorErrors ?? []));
          oldest = oldest === null ? c.ts : Math.min(oldest, c.ts);
          if (Date.now() - c.ts > monthTtl(m, c.data.rows.length)) toFetch.push(m);
        } else {
          toFetch.push(m);
        }
      }
      if (!alive) return;
      // Meses que hayan llegado mientras se leía lo guardado
      for (const m of list) {
        const f = consumptionSync.fresh.get(prefix + m);
        if (f) found[m] = f.rows;
      }
      setLoaded({ key: monthsKey, months: found, distributorErrors, updatedAt: oldest, reading: false });
      if (toFetch.length) consumptionSync.enqueue(client, toFetch.map(jobFor));
    })();
    return () => {
      alive = false;
    };
  }, [monthsKey, prefix, client, jobFor]);

  // 3: incorporar los meses según llegan
  useEffect(
    () =>
      consumptionSync.subscribe((key) => {
        if (!key || !key.startsWith(prefix)) return;
        const m = key.slice(prefix.length);
        const entry = consumptionSync.fresh.get(key);
        if (!entry) return;
        if (!monthsKey.split('|')[1].split(',').includes(m)) return;
        setLoaded((s) => (s.key === monthsKey ? { ...s, months: { ...s.months, [m]: entry.rows }, updatedAt: s.updatedAt ?? Date.now() } : s));
      }),
    [prefix, monthsKey],
  );

  const current = loaded.key === monthsKey ? loaded : { key: monthsKey, months: {}, distributorErrors: [], updatedAt: null, reading: true };
  const keys = useMemo(() => months.map((m) => prefix + m), [months, prefix]);
  const pending = keys.filter((k) => sync.pending.has(k)).length;
  const done = months.filter((m) => current.months[m] !== undefined).length;
  const hasData = Object.values(current.months).some((r) => r.length > 0);

  let error: string | null = null;
  if (sync.cooldownUntil && pending) {
    const t = new Date(sync.cooldownUntil);
    error = `Datadis ha limitado las consultas. La descarga se reanudará sola a las ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}.`;
  } else if (sync.pausedUntil && pending) {
    error = 'Datadis no responde ahora mismo. Se volverá a intentar en unos minutos.';
  } else {
    error = keys.map((k) => sync.errors.get(k)).find((e) => !!e) ?? null;
  }
  const loading = current.reading || (pending > 0 && !sync.cooldownUntil && !sync.pausedUntil);

  // Actualizar a mano: solo el mes en curso, el anterior y los que falten (los meses cerrados no cambian)
  const refresh = useCallback(() => {
    const recent = addMonths(monthKey(new Date()), -1);
    consumptionSync.enqueue(
      client,
      months.filter((m) => m >= recent || current.months[m] === undefined).map(jobFor),
      true,
    );
  }, [client, months, jobFor, current.months]);
  /** Vuelve a intentar solo los meses que faltan */
  const retry = useCallback(
    () =>
      consumptionSync.enqueue(
        client,
        months.filter((m) => current.months[m] === undefined).map(jobFor),
        true,
      ),
    [client, months, jobFor, current.months],
  );

  return {
    months: current.months,
    loading,
    error,
    errors: current.distributorErrors,
    updatedAt: current.updatedAt,
    stale: !!error && hasData,
    /** meses pendientes de descargar / ya disponibles / total */
    pending,
    done,
    total: months.length,
    refresh,
    retry,
  };
}
