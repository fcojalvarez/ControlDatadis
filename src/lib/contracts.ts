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
