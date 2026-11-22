import { useCallback, useMemo } from 'react';

import { useSession } from '@/context/session';
import { currentTariff, defaultSupplyTariffs, normalizeTariff, sortHistory, type SupplyTariffs } from '@/lib/tariff';

/** Tarifa (precios) configurada para un suministro, con su histórico y ofertas a comparar */
export function useSupplyTariffs(cups: string) {
  const { settings, updateSettings } = useSession();
  const configured = !!settings.tariffs[cups];
  const cfg: SupplyTariffs = useMemo(() => {
    const saved = settings.tariffs[cups];
    if (!saved) return defaultSupplyTariffs(settings.prices);
    return {
      billingDay: saved.billingDay || 1,
      history: sortHistory((saved.history?.length ? saved.history : defaultSupplyTariffs(settings.prices).history).map(normalizeTariff)),
      candidates: (saved.candidates ?? []).map(normalizeTariff),
    };
  }, [settings.tariffs, settings.prices, cups]);

  const save = useCallback(
    (next: SupplyTariffs) => updateSettings({ tariffs: { ...settings.tariffs, [cups]: { ...next, history: sortHistory(next.history) } } }),
    [settings.tariffs, cups, updateSettings],
  );

  return { cfg, current: useMemo(() => currentTariff(cfg.history), [cfg.history]), configured, save };
}
