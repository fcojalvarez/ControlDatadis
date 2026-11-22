import { useMemo } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
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

/** Estado del histórico guardado en el móvil (compacto) */
export function OfflineDataCard({ supply }: { supply: SupplyRef }) {
  const c = useTheme();
  const h = useHistorySync(supply);
  const months = useMemo(() => historyMonths(supply), [supply]);
  const withData = months.filter((k) => (h.months[k]?.length ?? 0) > 0);
  const finished = h.pending === 0 && !h.loading;
  const info =
    'El histórico se descarga solo, mes a mes y poco a poco, para no superar el límite de consultas de Datadis. ' +
    'Cada mes se guarda en el móvil nada más llegar y se puede consultar aunque Datadis no funcione.' +
    (withData.length ? `\n\nGuardados: ${withData.length} meses con consumo (${fmtMonthLong(withData[0])} – ${fmtMonthLong(withData[withData.length - 1])}).` : '');

  return (
    <Card
      title="Histórico en el móvil"
      info={info}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name={finished ? 'cloud-done-outline' : 'cloud-download-outline'} size={18} color={finished ? c.p3 : c.tint} />
          <T style={{ fontWeight: '700' }}>
            {h.done}/{h.total}
          </T>
        </View>
      }>
      {!finished ? <ProgressBar value={h.done} max={h.total} color={c.tint} /> : null}
      {h.error ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <T variant="small" style={{ color: c.warning, flex: 1 }}>
            {h.error}
          </T>
          {!/limitado/.test(h.error) ? <Button title="Reintentar" variant="secondary" onPress={h.retry} /> : null}
        </View>
      ) : null}
    </Card>
  );
}
