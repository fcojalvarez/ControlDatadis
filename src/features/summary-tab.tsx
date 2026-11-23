import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BarChart, SplitBar } from '@/components/bar-chart';
import { SortableList } from '@/components/sortable';
import { Card, Delta, SavedDataNotice, InlineLoading, Loading, Notice, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/context/session';
import { useTheme } from '@/hooks/use-theme';
import { estimateCost, normalize, pctChange, summarize } from '@/lib/consumption';
import { WEEKDAYS, cap, fmtEur, fmtKWh, fmtMonthLong, fmtMonthShort, fmtNum, pad2 } from '@/lib/format';
import { PERIOD_LABELS, PERIODS, type Period } from '@/lib/periods';
import { currentContract } from '@/lib/contracts';

import { addMonths, monthRange, useConsumptionMonths } from './consumption-data';
import { supplyBounds } from './period';
import { useContract } from './queries';
import { OfflineDataCard } from './offline-data';
import { PeakSummaryCard } from './peak-card';
import { useSupplyTariffs } from './tariffs';
import type { SupplyRef } from './types';

export type SectionId = 'plomos' | 'mes' | 'pasado' | 'anio' | 'consejos' | 'historico';

export const SECTIONS: { id: SectionId; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  // (el id «plomos» se conserva para respetar el orden que ya tuviera guardado el usuario)
  { id: 'plomos', label: 'Pico de potencia', icon: 'flash-outline' },
  { id: 'mes', label: 'Mes en curso', icon: 'today-outline' },
  { id: 'pasado', label: 'Mes pasado', icon: 'calendar-outline' },
  { id: 'anio', label: 'Último año', icon: 'bar-chart-outline' },
  { id: 'consejos', label: 'Consejos', icon: 'bulb-outline' },
  { id: 'historico', label: 'Histórico en el móvil', icon: 'cloud-download-outline' },
];

/** Orden guardado + las tarjetas nuevas que no estuvieran en él */
function fullOrder(saved: string[]): SectionId[] {
  const valid = saved.filter((id): id is SectionId => SECTIONS.some((x) => x.id === id));
  return [...valid, ...SECTIONS.map((x) => x.id).filter((id) => !valid.includes(id))];
}

export function SummaryTab({ supply, onOpen }: { supply: SupplyRef; onOpen: (tab: 'consumo' | 'potencia' | 'contrato') => void }) {
  const [dragging, setDragging] = useState(false);
  const c = useTheme();
  const { current: tariff } = useSupplyTariffs(supply.cups);
  const bounds = useMemo(() => supplyBounds(supply), [supply]);
  const cur = bounds.max;
  const prev = addMonths(cur, -1);
  // 14 meses: mes actual, últimos 12 y el mismo mes del año anterior al mes pasado
  const months = useMemo(() => monthRange(addMonths(cur, -13), cur).filter((k) => k >= bounds.min), [cur, bounds.min]);

  const q = useConsumptionMonths(supply, months, 0);
  const contract = useContract(supply);

  const ct = currentContract(contract.data?.contracts);
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
  const prevCost = estimateCost(prevS.byPeriod, prevS.surplus, prevS.days, contractedKW, tariff);
  const yearCost = estimateCost(yearS.byPeriod, yearS.surplus, yearS.days, contractedKW, tariff);


  const tips = useMemo(() => buildTips({ yearS: yearS.total ? yearS : curS, prices: tariff.energy }), [yearS, curS, tariff.energy]);

  const nothing = !q.loading && !curS.total && !prevS.total && !yearS.total;

  const prevName = fmtMonthLong(prev).split(' ')[0];
  const legendLine = PERIODS.map((p) => `${PERIOD_LABELS[p]} ${fmtNum(prevS.total ? (prevS.byPeriod[p] / prevS.total) * 100 : 0, 0)} %`).join(' · ');

  const { settings, updateSettings } = useSession();
  const hiddenIds = settings.summaryLayout.hidden;
  const orderedIds = fullOrder(settings.summaryLayout.order).filter((id) => !hiddenIds.includes(id));
  // Nuevo orden de las visibles; las ocultas se quedan al final
  const reorder = useCallback(
    (visible: SectionId[]) =>
      updateSettings({ summaryLayout: { order: [...visible, ...fullOrder(settings.summaryLayout.order).filter((id) => hiddenIds.includes(id))], hidden: hiddenIds } }),
    [updateSettings, settings.summaryLayout.order, hiddenIds],
  );

  // Tarjetas del Resumen (el usuario puede reordenarlas u ocultarlas)
  const sections: Record<SectionId, ReactNode> = {
    plomos: <PeakSummaryCard supply={supply} month={cur} onOpen={() => onOpen('potencia')} />,
    mes: curS.total > 0 ? (
        <Card title={cap(fmtMonthLong(cur).split(' ')[0])} right={<T variant="small">hasta el día {Number(curS.lastDay?.slice(8))}</T>} onPress={() => onOpen('consumo')}>
          <View style={styles.split}>
            <View>
              <T variant="hero">{fmtKWh(curS.total, 0)}</T>
              <Delta pct={pctChange(curS.total, prevSameDays)} label={`que ${prevName}`} />
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <T variant="small">Media diaria</T>
              <T variant="value">{fmtKWh(curS.avgPerDay, 1)}</T>
            </View>
          </View>
        </Card>
      ) : null,
    pasado: prevS.total > 0 ? (
        <Card title={cap(prevName)} onPress={() => onOpen('consumo')}>
          <View style={styles.split}>
            <View>
              <T variant="value">{fmtKWh(prevS.total, 0)}</T>
              <Delta
                pct={prevYoyS.days >= prevS.days * 0.9 ? pctChange(prevS.total, prevYoyS.total) : null}
                label={`que hace un año`}
              />
            </View>
            <T variant="value">{fmtEur(prevCost.total)}</T>
          </View>
          <SplitBar parts={PERIODS.map((p) => ({ value: prevS.byPeriod[p], color: periodColors[p] }))} height={12} />
          <T variant="small">{legendLine}</T>
        </Card>
      ) : null,
    anio: yearS.total > 0 ? (
        <Card
          title="Último año"
          right={
            <T variant="small" style={{ fontWeight: '700', color: c.text }}>
              {fmtKWh(yearS.total, 0)} · {fmtEur(yearCost.total)}
            </T>
          }
          onPress={() => onOpen('consumo')}>
          <BarChart
            data={[...yearS.monthly, ...(curS.monthly.length ? curS.monthly : [])].map((m) => ({
              label: fmtMonthShort(m.key).split(' ')[0],
              detail: fmtMonthLong(m.key) + (m.key === cur ? ' (en curso)' : ''),
              segments: PERIODS.map((p) => ({ value: m[p], color: periodColors[p], name: PERIOD_LABELS[p] })),
            }))}
            formatValue={(v) => fmtKWh(v, 0)}
            unit="kWh"
            height={150}
          />
        </Card>
      ) : null,
    consejos: tips.length > 0 ? (
        <Card title="Consejos" info="Recomendaciones automáticas a partir de tus datos del último año. Son orientativas.">
          {tips.map((t, i) => (
            <TipRow key={i} tip={t} />
          ))}
        </Card>
      ) : null,
    historico: <OfflineDataCard supply={supply} />,
  };

  return (
    <Screen scrollEnabled={!dragging} refreshing={q.loading && yearS.total > 0} onRefresh={() => (q.refresh(), contract.refresh())}>
      {q.loading && !yearS.total && !curS.total ? <Loading text="Descargando tu consumo…" /> : null}
      {q.loading && (yearS.total > 0 || curS.total > 0) ? (
        <InlineLoading text={q.pending ? `Descargando: faltan ${q.pending} meses` : 'Actualizando…'} />
      ) : null}
      <SavedDataNotice hasData={yearS.total > 0 || curS.total > 0} error={q.error} stale={q.stale} ts={q.updatedAt} onRetry={q.refresh} />
      {nothing && !q.error ? <Notice tone="warning">Datadis aún no tiene datos de consumo de este suministro.</Notice> : null}

      <SortableList ids={orderedIds} renderItem={(id) => sections[id]} onReorder={reorder} onDragStateChange={setDragging} />
      <T variant="small" style={{ textAlign: 'center' }}>
        Mantén pulsada una tarjeta para moverla
      </T>
    </Screen>
  );
}

function TipRow({ tip }: { tip: Tip }) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  const icon = tip.tone === 'warning' ? 'alert-circle-outline' : tip.tone === 'good' ? 'checkmark-circle-outline' : 'bulb-outline';
  const color = tip.tone === 'warning' ? c.warning : tip.tone === 'good' ? c.p3 : c.tint;
  return (
    <Pressable onPress={() => setOpen((v) => !v)} onLongPress={() => {}} delayLongPress={300} style={[styles.tip, { borderColor: c.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Ionicons name={icon} size={22} color={color} />
        <T style={{ flex: 1, fontWeight: '600' }}>{tip.title}</T>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={c.textSecondary} />
      </View>
      {open ? (
        <T variant="small" style={{ color: c.text, marginTop: 6, marginLeft: 32 }}>
          {tip.text}
        </T>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  split: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: Spacing.two },
  tip: { paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  customize: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
});

type Tip = { title: string; text: string; tone: 'info' | 'warning' | 'good' };

function buildTips({
  yearS,
  prices,
}: {
  yearS: ReturnType<typeof summarize>;
  prices: Record<Period, number>;
}): Tip[] {
  const tips: Tip[] = [];
  if (!yearS.total) return tips;
  const share = (p: Period) => (yearS.byPeriod[p] / yearS.total) * 100;

  if (share('P1') > 30) {
    const move = yearS.byPeriod.P1 * 0.2;
    tips.push({
      tone: 'warning',
      title: `${fmtNum(share('P1'), 0)} % de tu consumo en hora punta`,
      text: `Si pasas una quinta parte (${fmtKWh(move, 0)}) a horas valle ahorrarías unos ${fmtEur(move * (prices.P1 - prices.P3))} al año. Programa lavadora, lavavajillas o termo por la noche o el fin de semana.`,
    });
  } else if (share('P3') > 45) {
    tips.push({ tone: 'good', title: `${fmtNum(share('P3'), 0)} % de tu consumo en valle`, text: '¡Bien! Aprovechas las horas más baratas.' });
  }

  const baseYear = yearS.baseLoadKW * 24 * 365;
  if (yearS.baseLoadKW > 0.15) {
    tips.push({
      tone: 'info',
      title: `${fmtNum(yearS.baseLoadKW * 1000, 0)} W siempre encendidos`,
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
