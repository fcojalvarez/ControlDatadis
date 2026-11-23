import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BarChart, type BarDatum } from '@/components/bar-chart';
import { Select } from '@/components/select';
import { Card, Disclosure, InlineLoading, Notice, SavedDataNotice, Screen, Stepper, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { MaxPowerReading } from '@/lib/consumption';
import { WEEKDAYS, cap, fmtKW, fmtMonthLong, fmtMonthShort, fmtNum, pad2 } from '@/lib/format';
import { addMonths } from '@/lib/months';
import { PERIOD_LABELS, type Period } from '@/lib/periods';

import { useConsumptionMonths } from './consumption-data';
import { dailyPeaks, limitForPeriod, useMeasuredPeaks, weeklyPeaks, type CurvePeak } from './peaks';
import { supplyBounds } from './period';
import { ReactiveSection } from './reactive-section';
import type { SupplyRef } from './types';

type View_ = 'mes' | 'semana' | 'dia';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** «Martes 16 nov 2026» (o sin año) a partir de YYYY/MM/DD o YYYY-MM-DD */
function dateText(date: string, withYear = true): string {
  const m = date.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  if (!m) return date;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${WEEKDAYS[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ''}`;
}

function hhmm(t: number): string {
  const d = new Date(t);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Cuándo fue un pico de la curva: «19:45 – 20:00» o «a las 20:00» si es el del contador */
function peakTime(p: CurvePeak): string {
  return p.measured ? `a las ${p.measuredTime}` : `${hhmm(p.start)} – ${hhmm(p.start + p.intervalMin * 60_000)}`;
}

export function MaxPowerTab({ supply }: { supply: SupplyRef }) {
  const c = useTheme();
  const mp = useMeasuredPeaks(supply);
  const bounds = useMemo(() => supplyBounds(supply), [supply]);
  const [view, setView] = useState<View_>('mes');
  const [month, setMonth] = useState(bounds.max);

  const colorFor = (kw: number, limit: number) => (!limit ? c.tint : kw > limit ? c.danger : kw > limit * 0.85 ? c.warning : c.tint);
  const limitLine = mp.contracted[0] ? [{ value: mp.contracted[0], color: c.danger, label: `contratada ${fmtNum(mp.contracted[0], 2)} kW` }] : [];

  return (
    <Screen
      refreshing={mp.loading && !!mp.data}
      onRefresh={mp.refresh}
      header={
        // En la vista por día o semana, el mes queda fijo arriba al hacer scroll
        view !== 'mes' ? (
          <Stepper
            label={cap(fmtMonthLong(month))}
            canPrev={month > bounds.min}
            canNext={month < bounds.max}
            onPrev={() => setMonth((m) => addMonths(m, -1))}
            onNext={() => setMonth((m) => addMonths(m, 1))}
          />
        ) : undefined
      }>
      <SavedDataNotice hasData={!!mp.data} error={mp.error} stale={mp.stale} ts={mp.updatedAt} onRetry={mp.refresh} />
      {mp.loading && !mp.data ? <InlineLoading text="Cargando los picos medidos…" /> : null}

      {/* ---------- Pico más alto ---------- */}
      {mp.absMax ? <TopPeakCard peak={mp.absMax} limit={mp.limitOf(mp.absMax)} months={mp.monthly.length} /> : null}
      {mp.data && !mp.rows.length ? <Notice>La distribuidora no ha publicado picos de potencia para este suministro.</Notice> : null}

      {/* ---------- Pico de cada mes / semana / día ---------- */}
      <Card
        title="Potencia máxima"
        right={
          <Select<View_>
            title="Ver el pico de cada"
            value={view}
            onChange={setView}
            options={[
              { value: 'mes', label: 'Mes', hint: 'El pico que midió el contador cada mes (dato exacto)' },
              { value: 'semana', label: 'Semana', hint: 'El pico de cada semana del mes que elijas' },
              { value: 'dia', label: 'Día', hint: 'El pico de cada día del mes que elijas' },
            ]}
          />
        }>
        {view === 'mes' ? (
          mp.monthly.length ? (
            <MonthView monthly={mp.monthly} limitOf={mp.limitOf} colorFor={colorFor} refs={limitLine} />
          ) : (
            <T variant="small">Sin picos medidos todavía.</T>
          )
        ) : (
          <>
            <DayWeekView
              supply={supply}
              month={month}
              weekly={view === 'semana'}
              measured={mp.rows.filter((r) => r.key === month)}
              contracted={mp.contracted}
              colorFor={colorFor}
              refs={limitLine}
            />
          </>
        )}
      </Card>

      {/* ---------- Picos por encima de la potencia ---------- */}
      {mp.data && mp.contracted.length ? (
        <Card title="Picos por encima de tu potencia" info="Momentos en que el contador midió una potencia (media de 15 minutos) mayor que la contratada. Si coinciden con un corte que recuerdes, ahí lo tienes.">
          {mp.exceedances.length ? (
            <>
              {mp.exceedances.slice(0, 5).map((r, i) => (
                <ExceedRow key={i} r={r} limit={mp.limitOf(r)} />
              ))}
              {mp.exceedances.length > 5 ? (
                <Disclosure title={`Ver todos (${mp.exceedances.length})`}>
                  {mp.exceedances.slice(5).map((r, i) => (
                    <ExceedRow key={i} r={r} limit={mp.limitOf(r)} />
                  ))}
                </Disclosure>
              ) : null}
            </>
          ) : (
            <T variant="small">Ningún pico medido ha superado tu potencia contratada en estos {mp.monthly.length} meses.</T>
          )}
        </Card>
      ) : null}

      <ReactiveSection supply={supply} />
    </Screen>
  );
}

function ExceedRow({ r, limit }: { r: MaxPowerReading; limit: number }) {
  const c = useTheme();
  return (
    <View style={[styles.row, { borderTopColor: c.border }]}>
      <View style={{ flex: 1 }}>
        <T>{dateText(r.date)}</T>
        <T variant="small">
          a las {r.time} · {PERIOD_LABELS[r.period as Period]} · {fmtNum((r.kw / limit) * 100, 0)} % de tu potencia
        </T>
      </View>
      <T style={{ fontWeight: '800', color: c.danger }}>{fmtKW(r.kw, 2)}</T>
    </View>
  );
}

function TopPeakCard({ peak, limit, months }: { peak: MaxPowerReading; limit: number; months: number }) {
  const c = useTheme();
  const pct = limit ? peak.kw / limit : 0;
  const color = !limit ? c.text : pct > 1 ? c.danger : pct > 0.85 ? c.warning : c.text;
  return (
    <Card>
      <T variant="small" style={styles.kicker}>
        Pico más alto · últimos {months} meses
      </T>
      <T style={{ fontSize: 38, fontWeight: '800', color, lineHeight: 44 }}>{fmtKW(peak.kw, 2)}</T>
      <T style={{ fontWeight: '700' }}>
        {dateText(peak.date)} · a las {peak.time}
      </T>
      <View style={styles.chips}>
        <View style={[styles.chip, { backgroundColor: c.backgroundElement }]}>
          <T style={styles.chipText}>{PERIOD_LABELS[peak.period as Period]}</T>
        </View>
        {limit ? (
          <View style={[styles.chip, { backgroundColor: c.backgroundElement }]}>
            <T style={[styles.chipText, { color }]}>
              {fmtNum(pct * 100, 0)} % de tus {fmtNum(limit, 2)} kW
            </T>
          </View>
        ) : null}
      </View>
      <T variant="small">Medido por el contador: potencia media de 15 minutos.</T>
    </Card>
  );
}

function MonthView({
  monthly,
  limitOf,
  colorFor,
  refs,
}: {
  monthly: ReturnType<typeof useMeasuredPeaks>['monthly'];
  limitOf: (r: MaxPowerReading) => number;
  colorFor: (kw: number, limit: number) => string;
  refs: { value: number; color: string; label: string }[];
}) {
  const c = useTheme();
  const top = monthly.reduce((m, x) => (x.max.kw > m.max.kw ? x : m), monthly[0]);
  const recent = [...monthly].reverse();
  const row = (m: (typeof monthly)[number]) => (
    <View key={m.month} style={[styles.row, { borderTopColor: c.border }]}>
      <View style={{ flex: 1 }}>
        <T>{cap(fmtMonthLong(m.month))}</T>
        <T variant="small">
          {dateText(m.max.date, false)}, a las {m.max.time} · {PERIOD_LABELS[m.max.period as Period]}
        </T>
      </View>
      <T style={{ fontWeight: '800', color: limitOf(m.max) && m.max.kw > limitOf(m.max) ? c.danger : c.text }}>{fmtKW(m.max.kw, 2)}</T>
    </View>
  );
  return (
    <>
      <BarChart
        data={monthly.map((m) => {
          const limit = limitOf(m.max);
          return {
            label: fmtMonthShort(m.month).split(' ')[0],
            detail: `${cap(fmtMonthLong(m.month))} · ${fmtKW(m.max.kw, 2)}`,
            segments: [{ value: m.max.kw, color: colorFor(m.max.kw, limit) }],
            note: `${dateText(m.max.date, false)} a las ${m.max.time} · ${PERIOD_LABELS[m.max.period as Period]}${limit ? ` · ${fmtNum((m.max.kw / limit) * 100, 0)} % de tu potencia` : ''}`,
          };
        })}
        formatValue={(v) => fmtKW(v, 2)}
        unit="kW"
        referenceLines={refs}
        idle={`Más alto: ${fmtKW(top.max.kw, 2)} · ${fmtMonthLong(top.month)}`}
        height={180}
      />
      <View style={{ marginTop: Spacing.two }}>
        {recent.slice(0, 3).map(row)}
        {recent.length > 3 ? <Disclosure title={`Ver los ${recent.length} meses`}>{recent.slice(3).map(row)}</Disclosure> : null}
      </View>
    </>
  );
}

function DayWeekView({
  supply,
  month,
  weekly,
  measured,
  contracted,
  colorFor,
  refs,
}: {
  supply: SupplyRef;
  month: string;
  weekly: boolean;
  measured: MaxPowerReading[];
  contracted: number[];
  colorFor: (kw: number, limit: number) => string;
  refs: { value: number; color: string; label: string }[];
}) {
  const c = useTheme();
  const months = useMemo(() => [month], [month]);
  // Se usa la curva cada 15 min si el contador la da (mismo dato que mide el contador); si no, la horaria
  const q15 = useConsumptionMonths(supply, months, 1);
  const q60 = useConsumptionMonths(supply, months, 0);
  const rows15 = q15.months[month] ?? [];
  const rows60 = q60.months[month] ?? [];
  const use15 = rows15.length > 0;
  const rows = use15 ? rows15 : rows60;
  const interval = use15 ? 15 : 60;
  const days = useMemo(() => dailyPeaks(rows, interval, measured), [rows, interval, measured]);
  const weeks = useMemo(() => weeklyPeaks(days), [days]);
  const limitOf = (p: CurvePeak) => limitForPeriod(p.period, contracted);
  const loading = (q15.loading || q60.loading) && !rows.length;

  if (loading) return <InlineLoading text="Descargando la curva de este mes…" />;
  if (!rows.length) return <T variant="small">Aún no hay datos de consumo para este mes.</T>;

  const top = days.reduce((m, d) => (d.kw > m.kw ? d : m), days[0]);
  const above = days.filter((d) => limitOf(d) && d.kw > limitOf(d)).length;
  const near = days.filter((d) => limitOf(d) && d.kw > limitOf(d) * 0.85).length;
  const hourCount = new Map<number, number>();
  for (const d of days) {
    const h = d.measured ? Number(d.measuredTime?.slice(0, 2)) : new Date(d.start).getHours();
    hourCount.set(h, (hourCount.get(h) ?? 0) + 1);
  }
  const topHour = [...hourCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const data: BarDatum[] = weekly
    ? weeks.map((w) => ({
        label: `${Number(w.from.slice(8))}-${Number(w.to.slice(8))}`,
        detail: `Semana del ${Number(w.from.slice(8))} al ${Number(w.to.slice(8))} · ${fmtKW(w.kw, 2)}`,
        segments: [{ value: w.kw, color: colorFor(w.kw, limitOf(w)) }],
        note: `${dateText(w.day, false)}, ${peakTime(w)} · ${PERIOD_LABELS[w.period]}${w.measured ? ' · medido por el contador' : ''}`,
      }))
    : days.map((d) => ({
        label: String(Number(d.key.slice(8))),
        detail: `${dateText(d.key, false)} · ${fmtKW(d.kw, 2)}`,
        segments: [{ value: d.kw, color: colorFor(d.kw, limitOf(d)) }],
        note: `${peakTime(d)} · ${PERIOD_LABELS[d.period]}${limitOf(d) ? ` · ${fmtNum((d.kw / limitOf(d)) * 100, 0)} % de tu potencia` : ''}${d.measured ? ' · medido por el contador' : ''}`,
      }));

  return (
    <View style={{ gap: Spacing.two }}>
      <BarChart
        key={`${month}-${weekly}`}
        data={data}
        formatValue={(v) => fmtKW(v, 2)}
        unit="kW"
        referenceLines={refs}
        idle={`Más alto: ${fmtKW(top.kw, 2)} · ${dateText(top.day, false)}`}
        idleSub={`${peakTime(top)} · ${PERIOD_LABELS[top.period]}`}
        minBarWidth={weekly ? 24 : 6}
        labelEvery={weekly ? 1 : undefined}
        height={180}
      />
      <T variant="small">
        {use15
          ? 'Pico de cada día según tu curva cada 15 minutos: el mismo dato que mide el contador.'
          : 'Tu contador no da datos cada 15 minutos para este mes: es la media de la hora más alta de cada día, algo por debajo del pico real.'}
      </T>
      <View>
        <Stat label={`Días por encima de tu potencia`} value={String(above)} color={above ? c.danger : undefined} />
        <Stat label="Días por encima del 85 %" value={String(near)} color={near ? c.warning : undefined} />
        {topHour !== undefined ? <Stat label="Hora en la que más picos hay" value={`${pad2(topHour)}:00 – ${pad2((topHour + 1) % 24)}:00`} /> : null}
      </View>
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  const c = useTheme();
  return (
    <View style={[styles.row, { borderTopColor: c.border }]}>
      <T style={{ flex: 1 }}>{label}</T>
      <T style={{ fontWeight: '800', color: color ?? c.text }}>{value}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  kicker: { fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  chipText: { fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth },
});
