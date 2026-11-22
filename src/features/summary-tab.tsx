import { useMemo } from 'react';
import { View } from 'react-native';

import { BarChart, ProgressBar, SplitBar } from '@/components/bar-chart';
import { Card, Delta, ErrorBox, InlineLoading, KeyValue, Loading, Notice, Row, Screen, Stat, T, UpdatedAt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/context/session';
import { useTheme } from '@/hooks/use-theme';
import { estimateCost, normalize, normalizeMaxPower, pctChange, summarize } from '@/lib/consumption';
import { WEEKDAYS, fmtDate, fmtEur, fmtKW, fmtKWh, fmtMonthLong, fmtMonthShort, fmtNum, pad2 } from '@/lib/format';
import { PERIOD_LABELS, PERIODS, type Period } from '@/lib/periods';

import { addMonths, daysInMonth, monthRange, useConsumptionMonths } from './consumption-data';
import { supplyBounds } from './period';
import { useContract, useMaxPower } from './queries';
import { rangeMonths, type SupplyRef } from './types';

export function SummaryTab({ supply, onOpen }: { supply: SupplyRef; onOpen: (tab: 'consumo' | 'potencia' | 'contrato') => void }) {
  const c = useTheme();
  const { settings } = useSession();
  const bounds = useMemo(() => supplyBounds(supply), [supply]);
  const cur = bounds.max;
  const prev = addMonths(cur, -1);
  // 14 meses: mes actual, últimos 12 y el mismo mes del año anterior al mes pasado
  const months = useMemo(() => monthRange(addMonths(cur, -13), cur).filter((k) => k >= bounds.min), [cur, bounds.min]);

  const q = useConsumptionMonths(supply, months, 0);
  const contract = useContract(supply);
  const { start, end } = useMemo(() => rangeMonths('12m', supply), [supply]);
  const maxp = useMaxPower(supply, start, end);

  const ct = contract.data?.contracts?.slice().sort((a, b) => ((a.startDate ?? '') < (b.startDate ?? '') ? 1 : -1))[0];
  const contractedKW = useMemo(() => ct?.contractedPowerkW ?? [], [ct]);
  const periodColors: Record<Period, string> = { P1: c.p1, P2: c.p2, P3: c.p3 };

  const data = useMemo(() => {
    const read = (keys: string[]) => normalize(keys.flatMap((k) => q.months[k] ?? []), 60);
    const curR = read([cur]);
    const curS = summarize(curR, 60);
    const prevS = summarize(read([prev]), 60);
    const prevYoyS = summarize(read([addMonths(prev, -12)]), 60);
    const last12Keys = monthRange(addMonths(cur, -12), prev).filter((k) => k >= bounds.min);
    const yearS = summarize(read(last12Keys), 60);
    // comparación del mes en curso con los mismos días del mes anterior
    const lastDay = curR.length ? new Date(curR[curR.length - 1].start).getDate() : 0;
    const prevSameDays = read([prev]).filter((r) => Number(r.day.slice(8)) <= lastDay).reduce((a, r) => a + r.kwh, 0);
    return { curS, prevS, prevYoyS, yearS, prevSameDays, last12Keys };
  }, [q.months, cur, prev, bounds.min]);

  const { curS, prevS, prevYoyS, yearS, prevSameDays } = data;
  const prevCost = estimateCost(prevS.byPeriod, prevS.surplus, prevS.days, contractedKW, settings.prices);
  const yearCost = estimateCost(yearS.byPeriod, yearS.surplus, yearS.days, contractedKW, settings.prices);

  const maxRows = useMemo(() => (maxp.data ? normalizeMaxPower(maxp.data.rows) : []), [maxp.data]);
  const maxPeak = maxRows.reduce<(typeof maxRows)[number] | null>((m, r) => (!m || r.kw > m.kw ? r : m), null);
  const p1 = contractedKW[0] ?? 0;

  const tips = useMemo(() => buildTips({ yearS: yearS.total ? yearS : curS, p1, peakKW: maxPeak?.kw ?? 0, prices: settings.prices.energy }), [yearS, curS, p1, maxPeak, settings.prices.energy]);

  const nothing = !q.loading && !curS.total && !prevS.total && !yearS.total;

  return (
    <Screen refreshing={q.loading && yearS.total > 0} onRefresh={() => (q.refresh(), contract.refresh(), maxp.refresh())}>
      {q.loading && !yearS.total && !curS.total ? (
        <Loading text="Preparando tu resumen… La primera vez se descarga el último año de consumo y puede tardar hasta un minuto." />
      ) : null}
      {q.loading && (yearS.total > 0 || curS.total > 0) ? <InlineLoading text="Actualizando con Datadis…" /> : null}
      {q.error && !yearS.total ? <ErrorBox message={q.error} onRetry={q.refresh} /> : null}
      {nothing && !q.error ? <Notice tone="warning">Datadis todavía no tiene datos de consumo para este suministro.</Notice> : null}

      {/* ---------- Este mes ---------- */}
      {curS.total > 0 && (
        <Card title={`Este mes · ${fmtMonthLong(cur)}`} subtitle={`Hasta el ${fmtDate(curS.lastDay)} (${curS.days} días)`}>
          <T variant="hero">{fmtKWh(curS.total, 0)}</T>
          <Delta pct={pctChange(curS.total, prevSameDays)} label={`que los mismos días de ${fmtMonthLong(prev).split(' ')[0]} (${fmtKWh(prevSameDays, 0)})`} />
          <Row style={{ marginTop: Spacing.two }}>
            <Stat label="Media diaria" value={fmtKWh(curS.avgPerDay, 1)} />
            <Stat label="Previsión del mes" value={fmtKWh(curS.avgPerDay * daysInMonth(cur), 0)} sub="si sigues a este ritmo" />
          </Row>
        </Card>
      )}

      {/* ---------- Mes pasado ---------- */}
      {prevS.total > 0 && (
        <Card title={`Mes pasado · ${fmtMonthLong(prev)}`}>
          <Row>
            <Stat label="Consumo" value={fmtKWh(prevS.total, 0)} delta={{ pct: prevYoyS.days >= prevS.days * 0.9 ? pctChange(prevS.total, prevYoyS.total) : null, label: `que ${fmtMonthLong(addMonths(prev, -12))}` }} />
            <Stat label="Coste estimado" value={fmtEur(prevCost.total)} sub="con impuestos" />
          </Row>
          <SplitBar parts={PERIODS.map((p) => ({ value: prevS.byPeriod[p], color: periodColors[p] }))} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {PERIODS.map((p) => (
              <View key={p} style={{ alignItems: p === 'P1' ? 'flex-start' : p === 'P3' ? 'flex-end' : 'center' }}>
                <T variant="small" style={{ color: periodColors[p], fontWeight: '700' }}>
                  {PERIOD_LABELS[p]}
                </T>
                <T variant="small">
                  {fmtNum(prevS.total ? (prevS.byPeriod[p] / prevS.total) * 100 : 0, 0)} % · {fmtKWh(prevS.byPeriod[p], 0)}
                </T>
              </View>
            ))}
          </View>
        </Card>
      )}

      {/* ---------- Último año ---------- */}
      {yearS.total > 0 && (
        <Card title="Último año" subtitle={`${fmtMonthLong(data.last12Keys[0])} – ${fmtMonthLong(data.last12Keys[data.last12Keys.length - 1])}`}>
          <Row>
            <Stat label="Consumo" value={fmtKWh(yearS.total, 0)} sub={`${fmtKWh(yearS.total / Math.max(1, yearS.monthly.length), 0)} al mes de media`} />
            <Stat label="Coste estimado" value={fmtEur(yearCost.total)} sub={`${fmtEur(yearCost.total / Math.max(1, yearS.monthly.length))} al mes`} />
          </Row>
          <BarChart
            data={[...yearS.monthly, ...(curS.monthly.length ? curS.monthly : [])].map((m) => ({
              label: fmtMonthShort(m.key).split(' ')[0],
              detail: fmtMonthLong(m.key) + (m.key === cur ? ' (en curso)' : ''),
              segments: PERIODS.map((p) => ({ value: m[p], color: periodColors[p], name: p })),
            }))}
            formatValue={(v) => fmtKWh(v, 0)}
            height={180}
            legend={PERIODS.map((p) => ({ color: periodColors[p], label: PERIOD_LABELS[p] }))}
          />
          {yearS.maxDay && (
            <KeyValue k="Mes de mayor consumo" v={fmtMonthLong(yearS.monthly.reduce((a, b) => (b.total > a.total ? b : a)).key)} />
          )}
          {yearS.hasSelfConsumption && (
            <KeyValue k="Excedentes vertidos (autoconsumo)" v={fmtKWh(yearS.surplus, 0)} hint={`Generación ${fmtKWh(yearS.generation, 0)}`} />
          )}
          <T variant="small" style={{ color: c.tint, fontWeight: '700' }} onPress={() => onOpen('consumo')}>
            Ver todo el detalle de consumo ›
          </T>
        </Card>
      )}

      {/* ---------- Potencia ---------- */}
      <Card title="Potencia" subtitle="Últimos 12 meses">
        {maxp.loading && !maxp.data ? <InlineLoading text="Consultando potencias máximas…" /> : null}
        {p1 > 0 && maxPeak ? (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <View>
                <T variant="label">Pico máximo</T>
                <T variant="value" color={maxPeak.kw > p1 ? c.danger : undefined}>
                  {fmtKW(maxPeak.kw, 2)}
                </T>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <T variant="label">Contratada</T>
                <T variant="value">{fmtKW(p1, 2)}</T>
              </View>
            </View>
            <ProgressBar value={maxPeak.kw} max={p1} color={maxPeak.kw > p1 ? c.danger : maxPeak.kw / p1 > 0.85 ? c.warning : c.tint} />
            <T variant="small">
              Usas como máximo el {fmtNum((maxPeak.kw / p1) * 100, 0)} % de tu potencia ({fmtDate(maxPeak.date)} a las {maxPeak.time}).
            </T>
          </>
        ) : !maxp.loading ? (
          <T variant="small">{contractedKW.length ? 'Sin datos de potencia máxima.' : 'Sin datos de contrato.'}</T>
        ) : null}
        <T variant="small" style={{ color: c.tint, fontWeight: '700' }} onPress={() => onOpen('potencia')}>
          Ver potencias ›
        </T>
      </Card>

      {/* ---------- Contrato ---------- */}
      {ct && (
        <Card title="Tu contrato">
          <KeyValue k="Comercializadora" v={ct.marketer || '—'} />
          <KeyValue k="Potencia contratada" v={contractedKW.length ? contractedKW.map((k, i) => `P${i + 1} ${fmtNum(k, 2)} kW`).join('\n') : '—'} />
          <KeyValue k="Tarifa" v={[ct.accessFare, ct.timeDiscrimination].filter(Boolean).join(' · ') || '—'} />
          <KeyValue k="Desde" v={fmtDate(ct.startDate)} />
          {ct.selfConsumptionTypeDesc ? <KeyValue k="Autoconsumo" v={ct.selfConsumptionTypeDesc} /> : null}
          <T variant="small" style={{ color: c.tint, fontWeight: '700' }} onPress={() => onOpen('contrato')}>
            Ver contrato completo ›
          </T>
        </Card>
      )}

      {/* ---------- Consejos ---------- */}
      {tips.length > 0 && (
        <Card title="Consejos para ahorrar" info="Recomendaciones automáticas a partir de tus datos del último año. Son orientativas.">
          {tips.map((t, i) => (
            <Notice key={i} tone={t.tone}>
              <T style={{ fontWeight: '700' }}>{t.title}</T>
              <T variant="small" style={{ color: c.text }}>
                {t.text}
              </T>
            </Notice>
          ))}
        </Card>
      )}

      <UpdatedAt ts={q.updatedAt} loading={q.loading} />
    </Screen>
  );
}

type Tip = { title: string; text: string; tone: 'info' | 'warning' | 'good' };

function buildTips({
  yearS,
  p1,
  peakKW,
  prices,
}: {
  yearS: ReturnType<typeof summarize>;
  p1: number;
  peakKW: number;
  prices: Record<Period, number>;
}): Tip[] {
  const tips: Tip[] = [];
  if (!yearS.total) return tips;
  const share = (p: Period) => (yearS.byPeriod[p] / yearS.total) * 100;

  if (share('P1') > 30) {
    const move = yearS.byPeriod.P1 * 0.2;
    tips.push({
      tone: 'warning',
      title: `El ${fmtNum(share('P1'), 0)} % de tu consumo es en hora punta`,
      text: `Si pasas una quinta parte (${fmtKWh(move, 0)}) a horas valle ahorrarías unos ${fmtEur(move * (prices.P1 - prices.P3))} al año. Programa lavadora, lavavajillas o termo por la noche o el fin de semana.`,
    });
  } else if (share('P3') > 45) {
    tips.push({ tone: 'good', title: `¡Bien! El ${fmtNum(share('P3'), 0)} % de tu consumo es en valle`, text: 'Aprovechas las horas más baratas.' });
  }

  if (p1 > 0 && peakKW > 0) {
    if (peakKW > p1) {
      tips.push({
        tone: 'warning',
        title: 'Has superado tu potencia contratada',
        text: `Tu pico fue de ${fmtKW(peakKW, 2)} con ${fmtKW(p1, 2)} contratados. Si te salta el limitador, valora subir la potencia o no encender a la vez los aparatos que más gastan.`,
      });
    } else if (peakKW / p1 < 0.6 && p1 > 2.3) {
      const suggested = Math.max(2.3, Math.ceil(peakKW * 1.2 * 10) / 10);
      tips.push({
        tone: 'info',
        title: 'Podrías bajar la potencia contratada',
        text: `Tu pico del último año fue ${fmtKW(peakKW, 2)} y tienes ${fmtKW(p1, 2)}. Con unos ${fmtKW(suggested, 1)} ahorrarías aproximadamente ${fmtEur((p1 - suggested) * 0.09 * 365)} al año en el término fijo.`,
      });
    }
  }

  const baseYear = yearS.baseLoadKW * 24 * 365;
  if (yearS.baseLoadKW > 0.15) {
    tips.push({
      tone: 'info',
      title: `Tienes ${fmtNum(yearS.baseLoadKW * 1000, 0)} W siempre encendidos`,
      text: `Son unos ${fmtKWh(baseYear, 0)} al año (${fmtEur(baseYear * prices.P3)}), el ${fmtNum((baseYear / ((yearS.total / Math.max(1, yearS.days)) * 365)) * 100, 0)} % de tu consumo. Revisa aparatos en standby, deshumidificadores o equipos antiguos.`,
    });
  }

  const peakHour = yearS.hourProfile.indexOf(Math.max(...yearS.hourProfile));
  const wd = yearS.weekdayAvg.indexOf(Math.max(...yearS.weekdayAvg));
  tips.push({
    tone: 'info',
    title: 'Tus hábitos',
    text: `Consumes más entre las ${pad2(peakHour)}:00 y las ${pad2(peakHour + 1)}:00, y el día de la semana que más gastas es el ${WEEKDAYS[wd].toLowerCase()}.`,
  });
  return tips;
}
