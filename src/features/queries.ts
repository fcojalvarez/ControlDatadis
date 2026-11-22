import type { ContractDetail, DistributorError, MaxPowerRaw, MeasurementType, ReactiveRow } from '@/api/datadis';
import { toYearMonth } from '@/api/datadis';
import { useSession } from '@/context/session';
import { DAY, HOUR, useCachedQuery } from '@/hooks/use-cached-query';
import { compact, type CompactReading } from '@/lib/consumption';

import { monthsBetween, type SupplyRef } from './types';

/** TTL según si el rango incluye el mes en curso (datos que aún cambian) o no. */
function ttlFor(end: Date) {
  const now = new Date();
  const includesCurrent = end.getFullYear() === now.getFullYear() && end.getMonth() === now.getMonth();
  return includesCurrent ? 6 * HOUR : 7 * DAY;
}

export function useContract(supply: SupplyRef) {
  const { client, settings, username } = useSession();
  const nif = settings.activeNif ?? undefined;
  return useCachedQuery<{ contracts: ContractDetail[]; errors: DistributorError[] }>(
    `contract:${username}:${nif ?? 'me'}:${supply.cups}`,
    () => client.getContractDetail(supply.cups, supply.distributorCode, nif),
    DAY,
  );
}

/**
 * Pide el rango en bloques de hasta 12 meses. Si un bloque viene vacío o falla
 * (algunas distribuidoras fallan si el rango incluye el primer mes del contrato),
 * se reintenta mes a mes para no perder el resto.
 */
async function fetchRanged<T>(
  start: Date,
  end: Date,
  fetchChunk: (s: string, e: string) => Promise<{ rows: T[]; errors: DistributorError[] }>,
): Promise<{ rows: T[]; errors: DistributorError[] }> {
  const months = monthsBetween(start, end);
  const chunks: Date[][] = [];
  for (let i = 0; i < months.length; i += 12) chunks.push(months.slice(i, i + 12));

  const rows: T[] = [];
  const errors: DistributorError[] = [];
  let lastError: unknown = null;
  for (const chunk of chunks) {
    const s = toYearMonth(chunk[0]);
    const e = toYearMonth(chunk[chunk.length - 1]);
    let ok = false;
    try {
      const r = await fetchChunk(s, e);
      errors.push(...r.errors);
      if (r.rows.length || chunk.length === 1) {
        rows.push(...r.rows);
        ok = true;
      }
    } catch (err) {
      lastError = err;
      if (chunk.length === 1) continue;
    }
    if (!ok && chunk.length > 1) {
      for (const m of chunk) {
        try {
          const r = await fetchChunk(toYearMonth(m), toYearMonth(m));
          rows.push(...r.rows);
          errors.push(...r.errors);
        } catch (err) {
          lastError = err;
        }
      }
    }
  }
  if (!rows.length && lastError) throw lastError;
  return { rows, errors };
}

export function useConsumption(supply: SupplyRef, start: Date, end: Date, measurementType: MeasurementType) {
  const { client, settings, username } = useSession();
  const nif = settings.activeNif ?? undefined;
  const key = `cons:${username}:${nif ?? 'me'}:${supply.cups}:${toYearMonth(start)}:${toYearMonth(end)}:${measurementType}`;
  return useCachedQuery<{ rows: CompactReading[]; errors: DistributorError[] }>(
    key,
    async () => {
      const r = await fetchRanged(start, end, (s, e) =>
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
      return { rows: compact(r.rows), errors: r.errors };
    },
    ttlFor(end),
  );
}

export function useMaxPower(supply: SupplyRef, start: Date, end: Date) {
  const { client, settings, username } = useSession();
  const nif = settings.activeNif ?? undefined;
  return useCachedQuery<{ rows: MaxPowerRaw[]; errors: DistributorError[] }>(
    `maxp:${username}:${nif ?? 'me'}:${supply.cups}:${toYearMonth(start)}:${toYearMonth(end)}`,
    () =>
      fetchRanged(start, end, (s, e) =>
        client.getMaxPower({
          cups: supply.cups,
          distributorCode: supply.distributorCode,
          startDate: s,
          endDate: e,
          authorizedNif: nif,
        }),
      ),
    ttlFor(end),
  );
}

export function useReactive(supply: SupplyRef, start: Date, end: Date) {
  const { client, settings, username } = useSession();
  const nif = settings.activeNif ?? undefined;
  return useCachedQuery<{ rows: ReactiveRow[]; code?: string; codeDesc?: string; errors: DistributorError[] }>(
    `react:${username}:${nif ?? 'me'}:${supply.cups}:${toYearMonth(start)}:${toYearMonth(end)}`,
    () =>
      client.getReactive({
        cups: supply.cups,
        distributorCode: supply.distributorCode,
        startDate: toYearMonth(start),
        endDate: toYearMonth(end),
        authorizedNif: nif,
      }),
    ttlFor(end),
  );
}
