import { useMemo } from 'react';

import type { ReactiveRow } from '@/api/datadis';
import { BarChart } from '@/components/bar-chart';
import { Card, DataTable, Disclosure, InlineLoading, SavedDataNotice, T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { fmtMonthLong, fmtMonthShort, fmtNum } from '@/lib/format';

import { useReactive } from './queries';
import type { SupplyRef } from './types';

/** Sección de energía reactiva (se muestra al final de la pestaña Potencia) */
export function ReactiveSection({ supply }: { supply: SupplyRef }) {
  const c = useTheme();
  const q = useReactive(supply);
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

  const total = rows.reduce((a, r) => a + columns.reduce((b, k) => b + num(r[k]), 0), 0);
  return (
    <Card
      title="Energía reactiva"
      info="La energía reactiva (kVArh) la generan motores y equipos con bobinas. Solo se factura en suministros de más de 15 kW cuando supera el 33 % de la activa. En la mayoría de viviendas no se publica o es cero."
      right={rows.length ? <T variant="small" style={{ fontWeight: '700', color: c.text }}>{fmtNum(total, 0)} kVArh</T> : undefined}>
      {q.loading && !q.data ? <InlineLoading text="Cargando…" /> : null}
      <SavedDataNotice hasData={!!q.data} error={q.error} stale={q.stale} ts={q.updatedAt} onRetry={q.refresh} />
      {q.data && rows.length === 0 ? <T variant="small">{q.data.codeDesc ? `Sin datos: ${q.data.codeDesc}` : 'Sin datos (lo normal en una vivienda).'}</T> : null}
      {rows.length > 0 && (
        <Disclosure title="Ver por mes">
          <BarChart
            data={rows.map((r) => ({
              label: fmtMonthShort(String(r.date)).split(' ')[0],
              detail: fmtMonthLong(String(r.date)),
              segments: columns.map((k, i) => ({ value: num(r[k]), color: palette[i % palette.length], name: label(k) })),
            }))}
            formatValue={(v) => `${fmtNum(v, 1)} kVArh`}
            unit="kVArh"
            height={150}
            legend={columns.map((k, i) => ({ color: palette[i % palette.length], label: label(k) }))}
          />
          <DataTable
            columns={[
              { title: 'Mes', render: (r: ReactiveRow) => fmtMonthShort(String(r.date)) },
              ...columns.map((k) => ({ title: label(k), render: (r: ReactiveRow) => (r[k] === null || r[k] === undefined ? '—' : fmtNum(Number(r[k]), 1)) })),
            ]}
            rows={rows}
          />
        </Disclosure>
      )}
    </Card>
  );
}
