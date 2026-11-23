import type { ContractDetail } from '@/api/datadis';

/**
 * Contrato vigente en una fecha (hoy por defecto).
 * Datadis puede devolver varios contratos, en cualquier orden y a veces solapados (p. ej. uno sin
 * fecha de inicio ni potencia que abarca a los reales). Se elige, entre los que cubren la fecha, el
 * que empezó más tarde y tiene potencia; si ninguno la cubre, el más reciente con potencia.
 */
export function currentContract(contracts: ContractDetail[] | undefined | null, date = new Date()): ContractDetail | null {
  if (!contracts?.length) return null;
  const day = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
  const norm = (s?: string | null) => (s ?? '').replace(/-/g, '/');
  const hasPower = (c: ContractDetail) => (c.contractedPowerkW ?? []).some((k) => Number(k) > 0);
  const byStartDesc = [...contracts].sort((a, b) => (norm(a.startDate) < norm(b.startDate) ? 1 : -1));
  const covering = byStartDesc.filter((c) => norm(c.startDate) <= day && (!c.endDate || norm(c.endDate) >= day));
  return covering.find(hasPower) ?? byStartDesc.find(hasPower) ?? covering[0] ?? byStartDesc[0];
}

/** Tramo de contrato con su potencia, para aplicar en cada día la potencia que había entonces */
export type ContractPeriod = { from: string; to: string | null; kw: number[] }; // fechas YYYY-MM-DD

export function normDate(s: string | null | undefined): string | null {
  const m = s?.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function contractPeriods(contracts: { startDate?: string | null; endDate?: string | null; contractedPowerkW?: number[] | null }[]): ContractPeriod[] {
  return contracts
    .filter((c) => c.contractedPowerkW?.length && (c.contractedPowerkW[0] ?? 0) > 0)
    .map((c) => ({ from: normDate(c.startDate) ?? '0000-00-00', to: normDate(c.endDate), kw: c.contractedPowerkW as number[] }))
    .sort((a, b) => (a.from < b.from ? -1 : 1));
}

