import { StyleSheet, View } from 'react-native';

import { Card, T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import type { MaxPowerReading } from '@/lib/consumption';
import { fmtKW, fmtMonthLong, fmtNum } from '@/lib/format';
import { addMonths } from '@/lib/months';

import { useMeasuredPeaks } from './peaks';
import type { SupplyRef } from './types';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function dayMonth(date: string): string {
  const m = date.match(/^\d{4}[/-](\d{2})[/-](\d{2})/);
  return m ? `${Number(m[2])} ${MONTHS[Number(m[1]) - 1]}` : date;
}

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
            {dayMonth(main.date)}, a las {main.time}
            {mp.limitOf(main) ? ` · ${fmtNum((main.kw / mp.limitOf(main)) * 100, 0)} % de tus ${fmtNum(mp.limitOf(main), 2)} kW` : ''}
          </T>
          <View style={{ marginTop: 4 }}>
            {cur && prev ? <Line label="Mes pasado" value={fmtKW(prev.kw, 2)} color={colorOf(prev)} /> : null}
            {mp.absMax ? <Line label={`Más alto en ${mp.monthly.length} meses`} value={`${fmtKW(mp.absMax.kw, 2)} · ${fmtMonthLong(mp.absMax.key)}`} color={colorOf(mp.absMax)} /> : null}
          </View>
        </>
      )}
    </Card>
  );
}

function Line({ label, value, color }: { label: string; value: string; color: string }) {
  const c = useTheme();
  return (
    <View style={[styles.line, { borderTopColor: c.border }]}>
      <T style={{ flex: 1 }}>{label}</T>
      <T style={{ fontWeight: '700', color }}>{value}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
});
