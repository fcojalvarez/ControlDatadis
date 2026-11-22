import { DEFAULT_PRICES, type Prices } from '@/lib/consumption';

/**
 * Tarifa de la comercializadora. Datadis no da los precios, así que los introduce el usuario.
 * `energy` es €/kWh por periodo (en una tarifa de precio único los tres son iguales).
 */
export type Tariff = Prices & {
  id: string;
  name: string;
  kind: 'single' | 'periods';
  validFrom: string; // YYYY-MM-DD (desde cuándo aplica; '0000-01-01' = siempre)
  discountPct: number; // % de descuento sobre la energía
  extrasMonthly: number; // €/mes de servicios adicionales (mantenimiento, etc.)
};

/** Tarifas de un suministro */
export type SupplyTariffs = {
  history: Tariff[]; // tarifa contratada, con sus cambios de precio (ordenada por validFrom)
  billingDay: number; // día del mes en que empieza cada factura (1 = mes natural)
  candidates: Tariff[]; // ofertas para comparar
};

export const ALWAYS = '0000-01-01';

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function defaultTariff(prices: Prices = DEFAULT_PRICES, name = 'Mi tarifa'): Tariff {
  return {
    ...prices,
    energy: { ...prices.energy },
    id: newId(),
    name,
    kind: 'periods',
    validFrom: ALWAYS,
    discountPct: 0,
    extrasMonthly: 0,
  };
}

export function defaultSupplyTariffs(prices?: Prices): SupplyTariffs {
  return { history: [defaultTariff(prices)], billingDay: 1, candidates: [] };
}

/** Completa campos que falten (datos guardados por versiones anteriores) */
export function normalizeTariff(t: Partial<Tariff>): Tariff {
  const base = defaultTariff();
  return {
    ...base,
    ...t,
    energy: { ...base.energy, ...(t.energy ?? {}) },
    id: t.id ?? base.id,
  } as Tariff;
}

export function sortHistory(h: Tariff[]): Tariff[] {
  return [...h].sort((a, b) => (a.validFrom < b.validFrom ? -1 : 1));
}

/** Tarifa vigente un día concreto (YYYY-MM-DD) */
export function tariffOn(history: Tariff[], day: string): Tariff {
  const sorted = sortHistory(history);
  let cur = sorted[0];
  for (const t of sorted) if (t.validFrom <= day) cur = t;
  return cur;
}

/** Tarifa vigente hoy */
export function currentTariff(history: Tariff[]): Tariff {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return tariffOn(history, today);
}
