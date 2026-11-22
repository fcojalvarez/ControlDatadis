import { useMemo } from 'react';
import { View } from 'react-native';

import { ProgressBar } from '@/components/bar-chart';
import { Button, Card, T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { fmtMonthLong } from '@/lib/format';

import { addMonths, monthRange, useConsumptionMonths } from './consumption-data';
import { PRIORITY } from './consumption-sync';
import { supplyBounds } from './period';
import type { SupplyRef } from './types';

/** Meses de histórico que se intentan guardar como máximo */
const MAX_HISTORY_MONTHS = 36;

function historyMonths(supply: SupplyRef) {
  const bounds = supplyBounds(supply);
  const from = addMonths(bounds.max, -(MAX_HISTORY_MONTHS - 1));
  return monthRange(from > bounds.min ? from : bounds.min, bounds.max);
}

/**
 * Descarga en segundo plano todo el histórico disponible (mes a mes, con prioridad baja: lo que
 * se ve en pantalla siempre va antes). Se usa en la pantalla del suministro.
 */
export function useHistorySync(supply: SupplyRef) {
  const months = useMemo(() => historyMonths(supply), [supply]);
  return useConsumptionMonths(supply, months, 0, PRIORITY.HISTORY);
}

/** Estado del histórico guardado en el móvil */
export function OfflineDataCard({ supply }: { supply: SupplyRef }) {
  const c = useTheme();
  const h = useHistorySync(supply);
  const months = useMemo(() => historyMonths(supply), [supply]);
  const withData = months.filter((k) => (h.months[k]?.length ?? 0) > 0);
  const finished = h.pending === 0 && !h.loading;

  return (
    <Card
      title="Histórico guardado en el móvil"
      info="Para no superar el límite de consultas de Datadis, el histórico se descarga solo, mes a mes y poco a poco, empezando por los meses más recientes. Cada mes se guarda nada más llegar, así que aunque cierres la app no se pierde nada y continúa la próxima vez. Lo guardado se puede consultar aunque Datadis no funcione.">
      <ProgressBar value={h.done} max={h.total} color={finished ? c.p3 : c.tint} />
      <T variant="small">
        {h.done} de {h.total} meses revisados
        {h.pending ? ` · faltan ${h.pending}` : ''}
      </T>
      {withData.length ? (
        <T variant="small" style={{ color: c.text }}>
          Tienes guardados {withData.length} meses con consumo ({fmtMonthLong(withData[0])} – {fmtMonthLong(withData[withData.length - 1])}).
        </T>
      ) : null}
      {h.error ? (
        <View style={{ gap: 6 }}>
          <T variant="small" style={{ color: c.warning }}>
            {h.error}
          </T>
          {!/limitado/.test(h.error) ? <Button title="Reintentar ahora" variant="secondary" onPress={h.retry} /> : null}
        </View>
      ) : !finished ? (
        <T variant="small">Descargando poco a poco en segundo plano…</T>
      ) : (
        <T variant="small" style={{ color: c.p3, fontWeight: '600' }}>
          Histórico completo.
        </T>
      )}
    </Card>
  );
}
