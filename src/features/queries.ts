import type { ContractDetail, DistributorError, MaxPowerRaw, ReactiveRow } from '@/api/datadis';
import { toYearMonth } from '@/api/datadis';
import { useSession } from '@/context/session';
import { DAY, HOUR, useCachedQuery } from '@/hooks/use-cached-query';

import { monthsBetween, type SupplyRef } from './types';

/** TTL según si el rango incluye el mes en curso (datos que aún cambian) o no. */
function ttlFor(end: Date) {
  const now = new Date();
  const includesCurrent = end.getFullYear() === now.getFullYear() && end.getMonth() === now.getMonth();
  return includesCurrent ? 6 * HOUR : 7 * DAY;
}

export function useContract(supply: Pick<SupplyRef, 'cups' | 'distributorCode'>) {
  const { client, settings, username } = useSession();
  const nif = settings.activeNif ?? undefined;
  return useCachedQuery<{ contracts: ContractDetail[]; errors: DistributorError[] }>(
    `contract:${username}:${nif ?? 'me'}:${supply.cups}`,
    () => client.getContractDetail(supply.cups, supply.distributorCode, nif),
    DAY,
    { isEmpty: (d) => !d.contracts.length },
  );
}

/**
 * Pide el rango en bloques de hasta 12 meses. Si un bloque viene vacío o falla
 * (algunas distribuidoras fallan si el rango incluye el primer mes del contrato),
 * se reintenta mes a mes para no perder el resto.
 */
export async function fetchRanged<T>(
  start: Date,
  end: Date,
  fetchChunk: (s: string, e: string) => Promise<{ rows: T[]; errors: DistributorError[] }>,
): Promise<{ rows: T[]; errors: DistributorError[]; okMonths: Set<string> }> {
  const months = monthsBetween(start, end);
  const okMonths = new Set<string>(); // meses (YYYY/MM) que Datadis respondió correctamente
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
        chunk.forEach((m) => okMonths.add(toYearMonth(m)));
      }
    } catch (err) {
      lastError = err;
      if (chunk.length === 1) continue;
    }
    if (!ok && chunk.length > 1) {
      // Mes a mes; si fallan dos seguidos, Datadis está caído: se deja para más tarde
      let consecutiveFailures = 0;
      for (const m of chunk) {
        try {
          const r = await fetchChunk(toYearMonth(m), toYearMonth(m));
          rows.push(...r.rows);
          errors.push(...r.errors);
          okMonths.add(toYearMonth(m));
          consecutiveFailures = 0;
        } catch (err) {
          lastError = err;
          if (++consecutiveFailures >= 2) break;
        }
      }
      if (consecutiveFailures >= 2) break;
    }
  }
  if (!rows.length && lastError) throw lastError;
  return { rows, errors, okMonths };
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
    { isEmpty: (d) => !d.rows.length },
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
    { isEmpty: (d) => !d.rows.length },
  );
}
