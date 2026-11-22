import { useMemo, useState } from 'react';

import type { ReactiveRow } from '@/api/datadis';
import { BarChart } from '@/components/bar-chart';
import { Card, Chips, DataTable, ErrorBox, InlineLoading, Notice } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { fmtMonthLong, fmtMonthShort, fmtNum } from '@/lib/format';

import { useReactive } from './queries';
import { rangeMonths, type RangeKey, type SupplyRef } from './types';

const OPTIONS: { value: RangeKey; label: string }[] = [
  { value: '6m', label: '6 meses' },
  { value: '12m', label: '12 meses' },
];

/** Sección de energía reactiva (se muestra al final de la pestaña Potencia) */
export function ReactiveSection({ supply }: { supply: SupplyRef }) {
  const c = useTheme();
  const [range, setRange] = useState<RangeKey>('12m');
  const { start, end } = useMemo(() => rangeMonths(range, supply), [range, supply]);
  const q = useReactive(supply, start, end);
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const palette = [c.p1, c.p2, c.p3, c.surplus, c.generation, c.textSecondary];

  // Columnas numéricas presentes (energy_p1..energy_p6 u otras)
  const columns = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      for (const [k, v] of Object.entries(r)) {
        if (k !== 'date' && v !== null && v !== '' && !Number.isNaN(Number(v))) set.add(k);
      }
    }
    return [...set].sort();
  }, [rows]);

  const label = (k: string) => k.replace(/^energy_?/i, '').toUpperCase();
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));

  return (
    <>
      <Card
        title="Energía reactiva"
        subtitle="kVArh por mes y periodo"
        info="La energía reactiva (kVArh) la generan motores y equipos con bobinas. Solo se factura en suministros de más de 15 kW cuando supera el 33 % de la energía activa. En la mayoría de viviendas la distribuidora no la publica o es cero.">
        <Chips options={OPTIONS} value={range} onChange={setRange} />
      </Card>
      {q.loading && !q.data ? <InlineLoading text="Consultando energía reactiva…" /> : null}
      {q.error ? <ErrorBox message={q.error} onRetry={q.refresh} /> : null}
      {q.data && rows.length === 0 ? (
        <Notice>{q.data.codeDesc ? `Sin datos de energía reactiva: ${q.data.codeDesc}` : 'La distribuidora no publica energía reactiva para este suministro. Es lo normal en una vivienda.'}</Notice>
      ) : null}

      {rows.length > 0 && (
        <Card title="Energía reactiva por mes">
          <BarChart
            data={rows.map((r) => ({
              label: fmtMonthShort(String(r.date)).split(' ')[0],
              detail: fmtMonthLong(String(r.date)),
              segments: columns.map((k, i) => ({ value: num(r[k]), color: palette[i % palette.length], name: label(k) })),
            }))}
            formatValue={(v) => `${fmtNum(v, 1)} kVArh`}
            legend={columns.map((k, i) => ({ color: palette[i % palette.length], label: label(k) }))}
          />
          <DataTable
            columns={[
              { title: 'Mes', render: (r: ReactiveRow) => fmtMonthShort(String(r.date)) },
              ...columns.map((k) => ({ title: label(k), render: (r: ReactiveRow) => (r[k] === null || r[k] === undefined ? '—' : fmtNum(Number(r[k]), 1)) })),
            ]}
            rows={rows}
          />
        </Card>
      )}
    </>
  );
}
