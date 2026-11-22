import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { BarChart, ProgressBar } from '@/components/bar-chart';
import { Card, Chips, DataTable, Disclosure, Empty, ErrorBox, KeyValue, Loading, Notice, Row, Screen, Stat, T, UpdatedAt } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { normalizeMaxPower, type MaxPowerReading } from '@/lib/consumption';
import { fmtDate, fmtKW, fmtMonthLong, fmtMonthShort, fmtNum } from '@/lib/format';

import { useContract, useMaxPower } from './queries';
import { ReactiveSection } from './reactive-section';
import { rangeMonths, type RangeKey, type SupplyRef } from './types';

const OPTIONS: { value: RangeKey; label: string }[] = [
  { value: '6m', label: '6 meses' },
  { value: '12m', label: '12 meses' },
  { value: '24m', label: '24 meses' },
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
  const over = p1 ? rows.filter((r) => r.kw > p1) : [];
  const usage = p1 && absMax ? (absMax.kw / p1) * 100 : 0;
  const hourCount = new Map<string, number>();
  for (const r of rows) hourCount.set(r.time.slice(0, 2), (hourCount.get(r.time.slice(0, 2)) ?? 0) + 1);
  const typicalHour = [...hourCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  return (
    <Screen refreshing={q.loading && !!q.data} onRefresh={q.refresh}>
      <Card
        title="Potencia máxima"
        info="Es la potencia más alta que has demandado en cada mes (en kW), registrada por tu contador. Si se acerca o supera la contratada, puede saltar el limitador. Si siempre queda muy por debajo, estás pagando potencia que no usas.">
        <Chips options={OPTIONS} value={range} onChange={setRange} />
      </Card>
      {q.loading && !q.data ? <Loading /> : null}
      {q.error ? <ErrorBox message={q.error} onRetry={q.refresh} /> : null}
      {q.data && rows.length === 0 ? <Empty text="La distribuidora no ha publicado potencias máximas para este periodo." /> : null}

      {rows.length > 0 && (
        <>
          <Card>
            <Row>
              <Stat
                label="Pico máximo"
                value={fmtKW(absMax?.kw)}
                color={p1 && absMax && absMax.kw > p1 ? c.danger : undefined}
                sub={absMax ? `${fmtDate(absMax.date)} a las ${absMax.time}` : undefined}
              />
              <Stat
                label="Contratada"
                value={contracted.length ? `${fmtNum(p1, 2)} kW` : '—'}
                sub={contracted.length > 1 ? contracted.map((k, i) => `P${i + 1} ${fmtNum(k, 2)} kW`).join(' · ') : undefined}
              />
              <Stat label="Media de los picos" value={fmtKW(avgMax)} sub="de cada mes" />
              <Stat label="Hora habitual del pico" value={typicalHour ? `${typicalHour}:00` : '—'} />
            </Row>
            {p1 > 0 && absMax && (
              <View style={{ gap: 6 }}>
                <ProgressBar value={absMax.kw} max={p1} color={usage > 100 ? c.danger : usage > 85 ? c.warning : c.tint} />
                <T variant="small">Tu pico es el {fmtNum(usage, 0)} % de la potencia contratada.</T>
              </View>
            )}
          </Card>

          {p1 > 0 && (
            <Notice tone={over.length ? 'warning' : usage < 60 ? 'info' : 'good'}>
              <T style={{ fontWeight: '700' }}>
                {over.length ? 'Has superado la potencia contratada' : usage < 60 ? 'Podrías bajar la potencia' : 'Tu potencia está bien ajustada'}
              </T>
              <T variant="small" style={{ color: c.text }}>
                {over.length
                  ? `Ha ocurrido ${over.length} ${over.length === 1 ? 'vez' : 'veces'} en el periodo. Si el limitador salta a menudo, valora subirla o no encender a la vez los aparatos de más consumo (horno, vitro, lavadora, aire acondicionado).`
                  : usage < 60
                    ? `Tu pico es solo el ${fmtNum(usage, 0)} % de lo contratado: bajar la potencia reduciría el término fijo de tu factura.`
                    : 'Tus picos están dentro de lo contratado con un margen razonable.'}
              </T>
            </Notice>
          )}

          <Card title="Pico de cada mes" subtitle="En rojo, los meses en los que superaste la potencia contratada">
            <BarChart
              data={monthly.map((m) => ({
                label: fmtMonthShort(m.key).split(' ')[0],
                detail: fmtMonthLong(m.key),
                segments: [{ value: m.max.kw, color: p1 && m.max.kw > p1 ? c.danger : c.tint }],
                note: `${fmtDate(m.max.date)} a las ${m.max.time} · periodo ${m.max.period}`,
              }))}
              formatValue={(v) => fmtKW(v, 2)}
              referenceLines={p1 ? [{ value: p1, color: c.warning, label: `contratada ${fmtNum(p1, 2)} kW` }] : []}
            />
            <Disclosure title="Ver tabla por mes y periodo">
              <DataTable
                columns={[
                  { title: 'Mes', render: (m: MonthRow) => fmtMonthShort(m.key) },
                  ...periods.map((p) => ({
                    title: p,
                    render: (m: MonthRow) => (m.byPeriod[p] ? fmtNum(m.byPeriod[p].kw, 2) : '—'),
                    color: (m: MonthRow) => (p1 && m.byPeriod[p] && m.byPeriod[p].kw > p1 ? c.danger : undefined),
                  })),
                ]}
                rows={[...monthly].reverse()}
              />
              <T variant="small">Valores en kW</T>
            </Disclosure>
          </Card>

          <Card title="Todas las lecturas" subtitle={`${rows.length} registros de la distribuidora`}>
            <Disclosure title="Ver todas las lecturas">
              {[...rows].reverse().map((r, i) => (
                <KeyValue
                  key={i}
                  k={`${fmtDate(r.date)} · ${r.time}`}
                  hint={`Periodo ${r.period}`}
                  v={<T style={{ fontWeight: '700', color: p1 && r.kw > p1 ? c.danger : c.text }}>{fmtKW(r.kw, 3)}</T>}
                />
              ))}
            </Disclosure>
          </Card>
        </>
      )}
      <ReactiveSection supply={supply} />
      <UpdatedAt ts={q.updatedAt} loading={q.loading} />
    </Screen>
  );
}
