import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BarChart, type BarDatum } from '@/components/bar-chart';
import { Select } from '@/components/select';
import { Card, Disclosure, InlineLoading, KeyValue, Notice, SavedDataNotice, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { MaxPowerReading } from '@/lib/consumption';
import { cap, fmtKW, fmtMonthLong, fmtMonthShort, fmtNum, fmtTime, fmtWeekdayDate, pad2 } from '@/lib/format';
import { addMonths } from '@/lib/months';
import { PERIOD_LABELS, type Period } from '@/lib/periods';

import { useConsumptionMonths } from './consumption-data';
import { dailyPeaks, limitForPeriod, useMeasuredPeaks, weeklyPeaks, type CurvePeak } from './peaks';
import { supplyBounds } from './period';
import { ReactiveSection } from './reactive-section';
import type { SupplyRef } from './types';

type View_ = 'mes' | 'semana' | 'dia';

/** Cuándo fue un pico de la curva: «19:45 – 20:00» o «a las 20:00» si es el del contador */
function peakTime(p: CurvePeak): string {
  return p.measured ? `a las ${p.measuredTime}` : `${fmtTime(p.start)} – ${fmtTime(p.start + p.intervalMin * 60_000)}`;
}

/**
 * Picos de cada día de un mes, a partir de la curva cada 15 min si el contador la da (es el mismo
 * dato que mide el contador) o de la horaria si no. `enabled` = false no descarga nada.
 */
function useMonthPeaks(supply: SupplyRef, month: string, measured: MaxPowerReading[], enabled: boolean) {
  const months = useMemo(() => (enabled ? [month] : []), [month, enabled]);
  const q15 = useConsumptionMonths(supply, months, 1);
  const q60 = useConsumptionMonths(supply, months, 0);
  const rows15 = q15.months[month] ?? [];
  const rows60 = q60.months[month] ?? [];
  const use15 = rows15.length > 0;
  const rows = use15 ? rows15 : rows60;
  const interval = use15 ? 15 : 60;
  const days = useMemo(() => dailyPeaks(month, rows, interval, measured), [month, rows, interval, measured]);
  const weeks = useMemo(() => weeklyPeaks(days), [days]);
  return { days, weeks, use15, hasData: rows.length > 0, loading: (q15.loading || q60.loading) && !rows.length };
}

export function MaxPowerTab({ supply }: { supply: SupplyRef }) {
  const c = useTheme();
  const mp = useMeasuredPeaks(supply);
  const bounds = useMemo(() => supplyBounds(supply), [supply]);
  const [view, setView] = useState<View_>('mes');
  const [month, setMonth] = useState(bounds.max);
  const byMonth = view !== 'mes';
  const measuredMonth = useMemo(() => mp.rows.filter((r) => r.key === month), [mp.rows, month]);
  const mpk = useMonthPeaks(supply, month, measuredMonth, byMonth);
  const limitOfDay = (p: CurvePeak) => limitForPeriod(p.period, mp.contractedOn(p.day));

  const colorFor = (kw: number, limit: number) => (!limit ? c.tint : kw > limit ? c.danger : kw > limit * 0.85 ? c.warning : c.tint);
  const limitLine = mp.contracted[0] ? [{ value: mp.contracted[0], color: c.danger, label: `contratada ${fmtNum(mp.contracted[0], 2)} kW` }] : [];

  // Todo lo de la pantalla se refiere al periodo elegido arriba
  const monthName = fmtMonthLong(month);
  const topDay = mpk.days.length ? mpk.days.reduce((m, d) => (d.kw > m.kw ? d : m), mpk.days[0]) : null;
  const exceedDays = mpk.days.filter((d) => limitOfDay(d) && d.kw > limitOfDay(d)).reverse();

  return (
    <Screen
      refreshing={mp.loading && !!mp.data}
      onRefresh={mp.refresh}
      header={
        // Selector y periodo fijos arriba
        <View style={styles.header}>
          <Select<View_>
            title="Ver el pico de cada"
            value={view}
            onChange={setView}
            options={[
              { value: 'mes', label: 'Por mes', hint: 'El pico que midió el contador cada mes (dato exacto)' },
              { value: 'semana', label: 'Por semana', hint: 'El pico de cada semana del mes que elijas' },
              { value: 'dia', label: 'Por día', hint: 'El pico de cada día del mes que elijas' },
            ]}
          />
          <View style={{ flex: 1 }} />
          {byMonth ? (
            <>
              <Arrow dir={-1} enabled={month > bounds.min} onPress={() => setMonth((m) => addMonths(m, -1))} />
              <T style={{ fontWeight: '800', minWidth: 92, textAlign: 'center' }}>{cap(fmtMonthShort(month).replace(' ', ' 20'))}</T>
              <Arrow dir={1} enabled={month < bounds.max} onPress={() => setMonth((m) => addMonths(m, 1))} />
            </>
          ) : (
            <T style={{ fontWeight: '700' }}>Últimos {mp.monthly.length || 24} meses</T>
          )}
        </View>
      }>
      <SavedDataNotice hasData={!!mp.data} error={mp.error} stale={mp.stale} ts={mp.updatedAt} onRetry={mp.refresh} />
      {mp.loading && !mp.data ? <InlineLoading text="Cargando los picos medidos…" /> : null}
      {mp.data && !mp.rows.length && !byMonth ? <Notice>La distribuidora no ha publicado picos de potencia para este suministro.</Notice> : null}

      {/* ---------- Pico más alto del periodo elegido ---------- */}
      {!byMonth && mp.absMax ? (
        <TopPeakCard
          title={`Pico más alto · últimos ${mp.monthly.length} meses`}
          kw={mp.absMax.kw}
          when={`${fmtWeekdayDate(mp.absMax.date)} · a las ${mp.absMax.time}`}
          period={mp.absMax.period}
          limit={mp.limitOf(mp.absMax)}
          note="Medido por el contador: potencia media de 15 minutos."
        />
      ) : null}
      {byMonth && topDay ? (
        <TopPeakCard
          title={`Pico más alto · ${monthName}`}
          kw={topDay.kw}
          when={`${fmtWeekdayDate(topDay.day)} · ${peakTime(topDay)}`}
          period={topDay.period}
          limit={limitOfDay(topDay)}
          note={
            topDay.measured
              ? 'Medido por el contador: potencia media de 15 minutos.'
              : mpk.use15
                ? 'Según tu curva cada 15 minutos (el mismo dato que mide el contador).'
                : 'Media de la hora más alta: algo por debajo del pico real (tu contador no da datos cada 15 minutos este mes).'
          }
        />
      ) : null}

      {/* ---------- Gráfica ---------- */}
      <Card title={view === 'mes' ? 'Potencia máxima por mes' : view === 'semana' ? 'Potencia máxima por semana' : 'Potencia máxima por día'} subtitle={byMonth ? `de ${monthName}` : undefined}>
        {!byMonth ? (
          mp.monthly.length ? (
            <MonthView monthly={mp.monthly} limitOf={mp.limitOf} colorFor={colorFor} refs={limitLine} />
          ) : (
            <T variant="small">Sin picos medidos todavía.</T>
          )
        ) : mpk.loading ? (
          <InlineLoading text="Descargando la curva de este mes…" />
        ) : !mpk.hasData ? (
          <T variant="small">Aún no hay datos de consumo para este mes.</T>
        ) : (
          <DayWeekView month={month} weekly={view === 'semana'} days={mpk.days} weeks={mpk.weeks} use15={mpk.use15} limitOf={limitOfDay} colorFor={colorFor} refs={limitLine} />
        )}
      </Card>

      {/* ---------- Picos por encima de la potencia (del mismo periodo) ---------- */}
      {mp.data && mp.contracted.length ? (
        <Card
          title="Picos por encima de tu potencia"
          subtitle={byMonth ? `en ${monthName}` : `en los últimos ${mp.monthly.length} meses`}
          info="Momentos en que la potencia superó la contratada. Si coinciden con un corte que recuerdes, ahí lo tienes.">
          {!byMonth ? (
            mp.exceedances.length ? (
              <>
                {mp.exceedances.slice(0, 5).map((r, i) => (
                  <ExceedRow key={i} date={r.date} time={`a las ${r.time}`} period={r.period} kw={r.kw} limit={mp.limitOf(r)} />
                ))}
                {mp.exceedances.length > 5 ? (
                  <Disclosure title={`Ver todos (${mp.exceedances.length})`}>
                    {mp.exceedances.slice(5).map((r, i) => (
                      <ExceedRow key={i} date={r.date} time={`a las ${r.time}`} period={r.period} kw={r.kw} limit={mp.limitOf(r)} />
                    ))}
                  </Disclosure>
                ) : null}
              </>
            ) : (
              <T variant="small">Ningún pico medido ha superado tu potencia contratada en estos {mp.monthly.length} meses.</T>
            )
          ) : exceedDays.length ? (
            exceedDays.map((d) => <ExceedRow key={d.day} date={d.day} time={peakTime(d)} period={d.period} kw={d.kw} limit={limitOfDay(d)} />)
          ) : (
            <T variant="small">Ningún día de {monthName} superó tu potencia contratada.</T>
          )}
        </Card>
      ) : null}

      <ReactiveSection supply={supply} />
    </Screen>
  );
}

function Arrow({ dir, enabled, onPress }: { dir: -1 | 1; enabled: boolean; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      hitSlop={8}
      accessibilityLabel={dir < 0 ? 'Mes anterior' : 'Mes siguiente'}
      style={[styles.arrow, { backgroundColor: c.backgroundElement, opacity: enabled ? 1 : 0.35 }]}>
      <Ionicons name={dir < 0 ? 'chevron-back' : 'chevron-forward'} size={18} color={c.tint} />
    </Pressable>
  );
}

function ExceedRow({ date, time, period, kw, limit }: { date: string; time: string; period: string; kw: number; limit: number }) {
  const c = useTheme();
  return (
    <View style={[styles.row, { borderTopColor: c.border }]}>
      <View style={{ flex: 1 }}>
        <T>{fmtWeekdayDate(date)}</T>
        <T variant="small">
          {time} · {PERIOD_LABELS[period as Period] ?? period} · {fmtNum((kw / limit) * 100, 0)} % de tu potencia
        </T>
      </View>
      <T style={{ fontWeight: '800', color: c.danger }}>{fmtKW(kw, 2)}</T>
    </View>
  );
}

function TopPeakCard({ title, kw, when, period, limit, note }: { title: string; kw: number; when: string; period: string; limit: number; note: string }) {
  const c = useTheme();
  const pct = limit ? kw / limit : 0;
  const color = !limit ? c.text : pct > 1 ? c.danger : pct > 0.85 ? c.warning : c.text;
  return (
    <Card>
      <T variant="small" style={styles.kicker}>
        {title}
      </T>
      <T style={{ fontSize: 38, fontWeight: '800', color, lineHeight: 44 }}>{fmtKW(kw, 2)}</T>
      <T style={{ fontWeight: '700' }}>{when}</T>
      <View style={styles.chips}>
        <View style={[styles.chip, { backgroundColor: c.backgroundElement }]}>
          <T style={styles.chipText}>{PERIOD_LABELS[period as Period] ?? period}</T>
        </View>
        {limit ? (
          <View style={[styles.chip, { backgroundColor: c.backgroundElement }]}>
            <T style={[styles.chipText, { color }]}>
              {fmtNum(pct * 100, 0)} % de tus {fmtNum(limit, 2)} kW
            </T>
          </View>
        ) : null}
      </View>
      <T variant="small">{note}</T>
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
          {fmtWeekdayDate(m.max.date, false)}, a las {m.max.time} · {PERIOD_LABELS[m.max.period as Period]}
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
            note: `${fmtWeekdayDate(m.max.date, false)} a las ${m.max.time} · ${PERIOD_LABELS[m.max.period as Period]}${limit ? ` · ${fmtNum((m.max.kw / limit) * 100, 0)} % de tu potencia` : ''}`,
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
  month,
  weekly,
  days,
  weeks,
  use15,
  limitOf,
  colorFor,
  refs,
}: {
  month: string;
  weekly: boolean;
  days: CurvePeak[];
  weeks: (CurvePeak & { from: string; to: string })[];
  use15: boolean;
  limitOf: (p: CurvePeak) => number;
  colorFor: (kw: number, limit: number) => string;
  refs: { value: number; color: string; label: string }[];
}) {
  const c = useTheme();
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
        note: `${fmtWeekdayDate(w.day, false)}, ${peakTime(w)} · ${PERIOD_LABELS[w.period]}${w.measured ? ' · medido por el contador' : ''}`,
      }))
    : days.map((d) => ({
        label: String(Number(d.key.slice(8))),
        detail: `${fmtWeekdayDate(d.key, false)} · ${fmtKW(d.kw, 2)}`,
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
        idle={`Más alto: ${fmtKW(top.kw, 2)} · ${fmtWeekdayDate(top.day, false)}`}
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
        <KeyValue k="Días por encima de tu potencia" v={<T style={{ fontWeight: '800', color: above ? c.danger : c.text }}>{above}</T>} />
        <KeyValue k="Días por encima del 85 %" v={<T style={{ fontWeight: '800', color: near ? c.warning : c.text }}>{near}</T>} />
        {topHour !== undefined ? <KeyValue k="Hora en la que más picos hay" v={`${pad2(topHour)}:00 – ${pad2((topHour + 1) % 24)}:00`} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  arrow: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  chipText: { fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth },
});
