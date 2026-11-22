import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Card, Chips, Empty, ErrorBox, Loading, Notice, Screen, T, UpdatedAt } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { fmtMonthShort, fmtNum } from '@/lib/format';

import { useReactive } from './queries';
import { rangeMonths, type RangeKey, type SupplyRef } from './types';

const OPTIONS: { value: RangeKey; label: string }[] = [
  { value: '6m', label: '6 meses' },
  { value: '12m', label: '12 meses' },
];

export function ReactiveTab({ supply }: { supply: SupplyRef }) {
  const c = useTheme();
  const [range, setRange] = useState<RangeKey>('12m');
  const { start, end } = useMemo(() => rangeMonths(range, supply), [range, supply.validDateFrom, supply.validDateTo]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useReactive(supply, start, end);
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);

  // Columnas numéricas presentes (energy_p1..energy_p6 u otras)
  const columns = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      for (const [k, v] of Object.entries(r)) {
        if (k !== 'date' && (typeof v === 'number' || (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v))))) set.add(k);
      }
    }
    return [...set].sort();
  }, [rows]);

  const label = (k: string) => k.replace(/^energy_?/i, '').toUpperCase();

  return (
    <Screen refreshing={q.loading && !!q.data} onRefresh={q.refresh}>
      <Chips options={OPTIONS} value={range} onChange={setRange} />
      <Notice>
        La energía reactiva (kVArh) solo se factura en suministros de más de 15 kW cuando supera el 33 % de la activa.
        En la mayoría de hogares la distribuidora no la publica.
      </Notice>
      {q.loading && !q.data ? <Loading /> : null}
      {q.error ? <ErrorBox message={q.error} onRetry={q.refresh} /> : null}
      {q.data && rows.length === 0 ? (
        <Empty text={q.data.codeDesc ? `Sin datos: ${q.data.codeDesc}` : 'No hay datos de energía reactiva para este suministro.'} />
      ) : null}

      {rows.length > 0 && (
        <Card title="Energía reactiva (kVArh)">
          <ScrollView horizontal>
            <View>
              <View style={[styles.tr, { borderBottomColor: c.border }]}>
                <T variant="label" style={styles.firstCol}>
                  Mes
                </T>
                {columns.map((k) => (
                  <T key={k} variant="label" style={styles.col}>
                    {label(k)}
                  </T>
                ))}
              </View>
              {rows.map((r, i) => (
                <View key={i} style={[styles.tr, { borderBottomColor: c.border }]}>
                  <T style={styles.firstCol}>{fmtMonthShort(String(r.date))}</T>
                  {columns.map((k) => (
                    <T key={k} style={styles.col}>
                      {r[k] === null || r[k] === undefined ? '—' : fmtNum(Number(r[k]), 1)}
                    </T>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </Card>
      )}
      <UpdatedAt ts={q.updatedAt} loading={q.loading} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  tr: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  firstCol: { width: 70 },
  col: { width: 70, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
