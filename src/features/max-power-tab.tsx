import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { BarChart } from '@/components/bar-chart';
import { Card, Chips, Empty, ErrorBox, KeyValue, Loading, Notice, Row, Screen, Stat, T, UpdatedAt } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { normalizeMaxPower, type MaxPowerReading } from '@/lib/consumption';
import { fmtDate, fmtKW, fmtMonthLong, fmtMonthShort, fmtNum } from '@/lib/format';

import { useContract, useMaxPower } from './queries';
import { rangeMonths, type RangeKey, type SupplyRef } from './types';

const OPTIONS: { value: RangeKey; label: string }[] = [
  { value: '6m', label: '6 meses' },
  { value: '12m', label: '12 meses' },
  { value: '24m', label: '24 meses' },
];

export function MaxPowerTab({ supply }: { supply: SupplyRef }) {
  const c = useTheme();
  const [range, setRange] = useState<RangeKey>('12m');
  const { start, end } = useMemo(() => rangeMonths(range, supply), [range, supply.validDateFrom, supply.validDateTo]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useMaxPower(supply, start, end);
  const contract = useContract(supply);
  const contracted = contract.data?.contracts[0]?.contractedPowerkW ?? [];
  const p1 = contracted[0] ?? 0;

  const rows = useMemo(() => (q.data ? normalizeMaxPower(q.data.rows) : []), [q.data]);

  // Máximo de cada mes
  const monthly = useMemo(() => {
    const map = new Map<string, MaxPowerReading>();
    for (const r of rows) {
      const cur = map.get(r.key);
      if (!cur || r.kw > cur.kw) map.set(r.key, r);
    }
    return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  }, [rows]);

  const absMax = monthly.reduce<MaxPowerReading | null>((m, r) => (!m || r.kw > m.kw ? r : m), null);
  const avgMax = monthly.length ? monthly.reduce((s, r) => s + r.kw, 0) / monthly.length : 0;
  const over = p1 ? rows.filter((r) => r.kw > p1) : [];
  const usage = p1 && absMax ? (absMax.kw / p1) * 100 : 0;

  return (
    <Screen refreshing={q.loading && !!q.data} onRefresh={q.refresh}>
      <Chips options={OPTIONS} value={range} onChange={setRange} />
      {q.loading && !q.data ? <Loading /> : null}
      {q.error ? <ErrorBox message={q.error} onRetry={q.refresh} /> : null}
      {q.data && rows.length === 0 ? <Empty text="La distribuidora no ha publicado potencias máximas para este periodo." /> : null}

      {rows.length > 0 && (
        <>
          <Row>
            <Stat label="Máxima registrada" value={fmtKW(absMax?.kw)} sub={absMax ? `${fmtDate(absMax.date)} ${absMax.time}` : undefined} />
            <Stat
              label="Contratada"
              value={contracted.length ? `${[...new Set(contracted)].map((k) => fmtNum(k, 2)).join(' / ')} kW` : '—'}
              sub={contracted.length > 1 ? contracted.map((k, i) => `P${i + 1} ${fmtNum(k, 2)}`).join(' · ') : undefined}
            />
            <Stat label="Media de máximas" value={fmtKW(avgMax)} sub="mensual" />
            <Stat
              label="Uso de la potencia"
              value={p1 ? `${fmtNum(usage, 0)} %` : '—'}
              color={usage > 100 ? c.danger : undefined}
              sub="máxima / contratada P1"
            />
          </Row>

          {p1 > 0 && (
            <Notice tone={over.length ? 'warning' : 'info'}>
              <T variant="small">
                {over.length
                  ? `Has superado la potencia contratada (P1) ${over.length} ${over.length === 1 ? 'vez' : 'veces'}. Si tu ICP no salta, puede que te convenga subirla o repartir mejor los consumos.`
                  : usage < 60
                    ? `Tu pico máximo es el ${fmtNum(usage, 0)} % de la potencia contratada: probablemente podrías bajar la potencia y ahorrar en el término fijo.`
                    : 'Tus picos están dentro de la potencia contratada.'}
              </T>
            </Notice>
          )}

          <Card title="Máxima mensual">
            <BarChart
              data={monthly.map((m) => ({
                label: fmtMonthShort(m.key),
                detail: `${fmtMonthLong(m.key)} · ${fmtDate(m.date)} ${m.time} · ${m.period}`,
                segments: [{ value: m.kw, color: p1 && m.kw > p1 ? c.danger : c.tint }],
              }))}
              formatValue={(v) => fmtKW(v, v < 10 ? 1 : 0)}
              referenceLines={p1 ? [{ value: p1, color: c.warning, label: `contratada ${fmtNum(p1, 2)} kW` }] : []}
            />
          </Card>

          <Card title="Todas las lecturas">
            {[...rows].reverse().map((r, i) => (
              <KeyValue
                key={i}
                k={`${fmtDate(r.date)} ${r.time} · ${r.period}`}
                v={
                  <View>
                    <T style={{ fontWeight: '600', color: p1 && r.kw > p1 ? c.danger : c.text }}>{fmtKW(r.kw, 3)}</T>
                  </View>
                }
              />
            ))}
          </Card>
        </>
      )}
      <UpdatedAt ts={q.updatedAt} loading={q.loading} />
    </Screen>
  );
}
