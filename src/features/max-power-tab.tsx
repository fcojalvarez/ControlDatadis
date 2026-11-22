import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BarChart } from '@/components/bar-chart';
import { Select } from '@/components/select';
import { Card, DataTable, Disclosure, InlineLoading, KeyValue, SavedDataNotice, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { normalizeMaxPower, type MaxPowerReading } from '@/lib/consumption';
import { fmtDate, fmtKW, fmtMonthLong, fmtMonthShort, fmtNum } from '@/lib/format';

import { useContract, useMaxPower } from './queries';
import { ReactiveSection } from './reactive-section';
import { TripRiskSection } from './trip-risk';
import { rangeMonths, type RangeKey, type SupplyRef } from './types';

const OPTIONS: { value: RangeKey; label: string }[] = [
  { value: '6m', label: '6 m' },
  { value: '12m', label: '12 m' },
  { value: '24m', label: '24 m' },
];

type MonthRow = { key: string; max: MaxPowerReading; byPeriod: Record<string, MaxPowerReading> };

export function MaxPowerTab({ supply }: { supply: SupplyRef }) {
  const c = useTheme();
  const [range, setRange] = useState<RangeKey>('12m');
  const { start, end } = useMemo(() => rangeMonths(range, supply), [range, supply]);
  const q = useMaxPower(supply, start, end);
  const contract = useContract(supply);
  const contracted = contract.data?.contracts[0]?.contractedPowerkW ?? [];
  const p1 = contracted[0] ?? 0;

  const rows = useMemo(() => (q.data ? normalizeMaxPower(q.data.rows) : []), [q.data]);
  const periods = useMemo(() => [...new Set(rows.map((r) => r.period))].sort(), [rows]);

  const monthly = useMemo(() => {
    const map = new Map<string, MonthRow>();
    for (const r of rows) {
      const cur = map.get(r.key) ?? { key: r.key, max: r, byPeriod: {} };
      if (r.kw > cur.max.kw) cur.max = r;
      const bp = cur.byPeriod[r.period];
      if (!bp || r.kw > bp.kw) cur.byPeriod[r.period] = r;
      map.set(r.key, cur);
    }
    return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  }, [rows]);

  const absMax = monthly.reduce<MaxPowerReading | null>((m, r) => (!m || r.max.kw > m.kw ? r.max : m), null);
  const avgMax = monthly.length ? monthly.reduce((s, r) => s + r.max.kw, 0) / monthly.length : 0;
  const usage = p1 && absMax ? (absMax.kw / p1) * 100 : 0;
  const hourCount = new Map<string, number>();
  for (const r of rows) hourCount.set(r.time.slice(0, 2), (hourCount.get(r.time.slice(0, 2)) ?? 0) + 1);
  const typicalHour = [...hourCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  return (
    <Screen refreshing={q.loading && !!q.data} onRefresh={q.refresh}>
      <TripRiskSection supply={supply} />

      {/* ---------- Picos medidos por el contador ---------- */}
      <Card
        title="Picos medidos"
        info="La potencia más alta (media de 15 minutos) que ha medido tu contador en cada mes y periodo. Si se acerca o supera la contratada, puede saltar el limitador; si siempre queda muy por debajo, pagas potencia que no usas."
        right={<Select<RangeKey> title="Periodo" value={range} onChange={setRange} options={OPTIONS} />}>
        {q.loading && !q.data ? <InlineLoading text="Cargando…" /> : null}
        <SavedDataNotice hasData={!!q.data} error={q.error} stale={q.stale} ts={q.updatedAt} onRetry={q.refresh} />
        {q.data && rows.length === 0 ? <T variant="small">La distribuidora no ha publicado picos para este periodo.</T> : null}
        {rows.length > 0 && (
          <>
            <View style={styles.minis}>
              <Mini
                label="Máximo"
                value={fmtKW(absMax?.kw, 2)}
                sub={absMax ? `${fmtDate(absMax.date)} ${absMax.time}` : undefined}
                color={p1 && absMax && absMax.kw > p1 ? c.danger : undefined}
              />
              <Mini label="Uso" value={p1 ? `${fmtNum(usage, 0)} %` : '—'} sub={p1 ? `de ${fmtNum(p1, 2)} kW` : undefined} color={usage > 100 ? c.danger : usage > 85 ? c.warning : undefined} />
              <Mini label="Hora típica" value={typicalHour ? `${typicalHour}:00` : '—'} sub={`media ${fmtKW(avgMax, 1)}`} />
            </View>
            <BarChart
              data={monthly.map((m) => ({
                label: fmtMonthShort(m.key).split(' ')[0],
                detail: fmtMonthLong(m.key),
                segments: [{ value: m.max.kw, color: p1 && m.max.kw > p1 ? c.danger : c.tint }],
                note: `${fmtDate(m.max.date)} a las ${m.max.time} · ${m.max.period}`,
              }))}
              formatValue={(v) => fmtKW(v, 2)}
              referenceLines={p1 ? [{ value: p1, color: c.danger, label: `contratada ${fmtNum(p1, 2)} kW` }] : []}
              height={170}
            />
            <Disclosure title="Ver datos">
              <DataTable
                columns={[
                  { title: 'Mes', render: (m: MonthRow) => fmtMonthShort(m.key) },
                  ...periods.map((p) => ({
                    title: p,
                    render: (m: MonthRow) => (m.byPeriod[p] ? `${fmtNum(m.byPeriod[p].kw, 2)}` : '—'),
                    color: (m: MonthRow) => (p1 && m.byPeriod[p] && m.byPeriod[p].kw > p1 ? c.danger : undefined),
                  })),
                ]}
                rows={[...monthly].reverse()}
              />
              {[...rows].reverse().map((r, i) => (
                <KeyValue
                  key={i}
                  k={`${fmtDate(r.date)} · ${r.time}`}
                  hint={r.period}
                  v={<T style={{ fontWeight: '700', color: p1 && r.kw > p1 ? c.danger : c.text }}>{fmtKW(r.kw, 2)}</T>}
                />
              ))}
            </Disclosure>
          </>
        )}
      </Card>

      <ReactiveSection supply={supply} />
    </Screen>
  );
}

function Mini({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  const c = useTheme();
  return (
    <View style={[styles.mini, { backgroundColor: c.backgroundElement }]}>
      <T variant="small" numberOfLines={1}>
        {label}
      </T>
      <T style={{ fontWeight: '800', fontSize: 16, color: color ?? c.text }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </T>
      {sub ? (
        <T variant="small" numberOfLines={1}>
          {sub}
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  minis: { flexDirection: 'row', gap: Spacing.two },
  mini: { flex: 1, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10, gap: 1 },
});
