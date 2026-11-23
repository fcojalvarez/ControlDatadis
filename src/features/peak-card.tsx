import { StyleSheet, View } from 'react-native';

import { Card, KeyValue, T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import type { MaxPowerReading } from '@/lib/consumption';
import { fmtDayMonth, fmtKW, fmtMonthLong, fmtNum } from '@/lib/format';
import { addMonths } from '@/lib/months';

import { useMeasuredPeaks } from './peaks';
import type { SupplyRef } from './types';

/** Tarjeta del Resumen: picos de potencia ya medidos (sin previsiones) */
export function PeakSummaryCard({ supply, month, onOpen }: { supply: SupplyRef; month: string; onOpen: () => void }) {
  const c = useTheme();
  const mp = useMeasuredPeaks(supply);
  const byMonth = new Map(mp.monthly.map((m) => [m.month, m.max]));
  const cur = byMonth.get(month);
  const prev = byMonth.get(addMonths(month, -1));
  const main = cur ?? prev;
  const colorOf = (r: MaxPowerReading) => {
    const l = mp.limitOf(r);
    return !l ? c.text : r.kw > l ? c.danger : r.kw > l * 0.85 ? c.warning : c.text;
  };

  return (
    <Card title="Pico de potencia" onPress={onOpen}>
      {!mp.data ? (
        <T variant="small">{mp.loading ? 'Cargando…' : 'Sin datos todavía.'}</T>
      ) : !main ? (
        <T variant="small">La distribuidora aún no ha publicado picos recientes.</T>
      ) : (
        <>
          <View style={styles.hero}>
            <T style={{ fontSize: 30, fontWeight: '800', color: colorOf(main) }}>{fmtKW(main.kw, 2)}</T>
            <T variant="small">{cur ? 'este mes' : 'mes pasado'}</T>
          </View>
          <T variant="small">
            {fmtDayMonth(main.date)}, a las {main.time}
            {mp.limitOf(main) ? ` · ${fmtNum((main.kw / mp.limitOf(main)) * 100, 0)} % de tus ${fmtNum(mp.limitOf(main), 2)} kW` : ''}
          </T>
          <View style={{ marginTop: 4 }}>
            {cur && prev ? <KeyValue k="Mes pasado" v={<T style={{ fontWeight: '700', color: colorOf(prev) }}>{fmtKW(prev.kw, 2)}</T>} /> : null}
            {mp.absMax ? <KeyValue k={`Más alto en ${mp.monthly.length} meses`} v={<T style={{ fontWeight: '700', color: colorOf(mp.absMax) }}>{fmtKW(mp.absMax.kw, 2)}</T>} hint={fmtMonthLong(mp.absMax.key)} /> : null}
          </View>
        </>
      )}
    </Card>
  );
}


const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
});
