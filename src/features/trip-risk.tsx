import { useEffect, useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';

import { BarChart } from '@/components/bar-chart';
import { Gauge } from '@/components/gauge';
import { Card, DataTable, Disclosure, InlineLoading, KeyValue, Segmented, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/context/session';
import { useTheme } from '@/hooks/use-theme';
import { normalize, normalizeMaxPower } from '@/lib/consumption';
import { setJSON } from '@/lib/storage';
import { fmtDate, fmtEur, fmtKW, fmtMonthLong, fmtMonthShort, fmtNum, fmtPct, pad2, cap } from '@/lib/format';
import { STANDARD_POWERS, TRIP_CURVE, analyzeTripRisk, contractPeriods, riskLevel, whatIf, type DayRisk, type TripRisk } from '@/lib/trip-risk';
import { currentContract } from '@/lib/contracts';

import { addMonths, monthRange, useConsumptionMonths } from './consumption-data';
import { supplyBounds } from './period';
import { useContract, useMaxPower } from './queries';
import { useSupplyTariffs } from './tariffs';
import { rangeMonths, type SupplyRef } from './types';

export function riskStorageKey(username: string | null, cups: string) {
  return `tripRisk:${username}:${cups}`;
}

/** Reúne curva del último año + potencias máximas + contrato y calcula el riesgo de corte. */
export function useTripRisk(supply: SupplyRef) {
  const bounds = useMemo(() => supplyBounds(supply), [supply]);
  // Mismos meses que el Resumen: se reutiliza la caché y no se hacen consultas extra
  const months = useMemo(() => monthRange(addMonths(bounds.max, -13), bounds.max).filter((k) => k >= bounds.min), [bounds]);
  const cons = useConsumptionMonths(supply, months, 0);
  const { start, end } = useMemo(() => rangeMonths('12m', supply), [supply]);
  const maxp = useMaxPower(supply, start, end);
  const contract = useContract(supply);

  const contracted = useMemo(() => {
    const ct = currentContract(contract.data?.contracts);
    return ct?.contractedPowerkW ?? [];
  }, [contract.data]);

  const risk = useMemo(() => {
    // Último año (365 días) de curva horaria
    const keys = months.filter((k) => k >= addMonths(bounds.max, -12));
    const all = normalize(keys.flatMap((k) => cons.months[k] ?? []), 60);
    // Exactamente el último año: 365 días hasta el último dato disponible
    const yearAgo = all.length ? all[all.length - 1].start - 365 * 86_400_000 : 0;
    const readings = all.filter((x) => x.start > yearAgo);
    const maxRows = maxp.data ? normalizeMaxPower(maxp.data.rows) : [];
    const history = contractPeriods(contract.data?.contracts ?? []);
    return analyzeTripRisk(readings, 60, maxRows, contracted, new Date(), history);
  }, [cons.months, maxp.data, contracted, months, bounds.max, contract.data]);

  const loading = cons.loading || maxp.loading || contract.loading;
  const { username } = useSession();
  // Se guarda el último resultado para mostrarlo en la pantalla de inicio
  useEffect(() => {
    if (risk && !loading) setJSON(riskStorageKey(username, supply.cups), { p: risk.pNext30, ts: Date.now() });
  }, [risk, loading, username, supply.cups]);

  return {
    risk,
    loading,
    noContract: !contract.loading && !!contract.data && !contracted.length,
    refresh: () => {
      cons.refresh();
      maxp.refresh();
      contract.refresh();
    },
  };
}

function levelColor(c: ReturnType<typeof useTheme>, p: number) {
  return p < 0.05 ? c.p3 : p < 0.2 ? '#7CB342' : p < 0.5 ? c.p2 : p < 0.8 ? '#EF7D2F' : c.danger;
}

function headline(r: TripRisk): string {
  const p = r.pNext30;
  if (r.exceedances.length && p >= 0.2)
    return `Tu contador ya ha registrado ${r.exceedances.length} ${r.exceedances.length === 1 ? 'pico' : 'picos'} de 15 minutos por encima de tu potencia. El limitador tolera excesos pequeños, pero si coinciden varios aparatos potentes es probable que salte.`;
  if (p < 0.05) return 'Es muy improbable que te salten los plomos con tu consumo habitual.';
  if (p < 0.2) return 'Es poco probable que salte, aunque podría ocurrir si enciendes a la vez muchos aparatos potentes.';
  if (p < 0.5) return 'Hay un riesgo real de que salte en momentos de mucho consumo. Evita usar a la vez horno, vitro, lavadora y calefacción.';
  return 'Es muy probable que te salten los plomos. Valora subir la potencia contratada o repartir el uso de los aparatos.';
}

const DISCLAIMER =
  'Es una estimación. Datadis no informa de los cortes: se calcula con tu curva de consumo, los picos de 15 minutos que mide tu contador y la curva de disparo del limitador (norma UNE 20317): por debajo de +10 % de tu potencia no salta, y cuanto mayor es el exceso, antes corta.';

/** Tarjeta compacta para el Resumen */
export function TripRiskSummaryCard({ supply, onOpen }: { supply: SupplyRef; onOpen: () => void }) {
  const c = useTheme();
  const { risk, loading, noContract } = useTripRisk(supply);
  const p = risk?.pNext30 ?? 0;
  const color = levelColor(c, p);
  return (
    <Card title="¿Saltarán los plomos?" info={risk ? `${headline(risk)}\n\n${DISCLAIMER}` : DISCLAIMER} onPress={onOpen}>
      {risk ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three }}>
          <Gauge value={p} size={120} />
          <View style={{ flex: 1 }}>
            <T style={{ fontSize: 34, lineHeight: 40, fontWeight: '800', color }}>{fmtPct(p)}</T>
            <T style={{ fontWeight: '700', color }}>Riesgo {riskLevel(p).label.toLowerCase()}</T>
            <T variant="small">próximos 30 días</T>
          </View>
        </View>
      ) : loading ? (
        <InlineLoading text="Calculando…" />
      ) : (
        <T variant="small">{noContract ? 'Falta la potencia contratada para calcularlo.' : 'Aún no hay datos suficientes.'}</T>
      )}
      {risk ? (
        <View style={[styles.pill, { backgroundColor: c.backgroundElement }]}>
          <Ionicons name="time-outline" size={16} color={c.textSecondary} />
          <T variant="small" style={{ flex: 1 }}>
            Último año
          </T>
          <T style={{ fontWeight: '700', color: tripsColor(c, risk.expectedTrips) }}>
            {risk.expectedTrips < 0.5 ? 'No ha saltado' : `${fmtTrips(risk.expectedTrips)}`}
          </T>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  minis: { flexDirection: 'row', gap: Spacing.two },
  mini: { flex: 1, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10, gap: 1 },
  marginRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
});

/** Análisis completo para la pestaña Potencia */
const HOW_IT_WORKS = (risk: TripRisk) =>
  `${DISCLAIMER}\n\n` +
  `Cómo se calcula:\n` +
  `1. De tu curva de consumo se toma la hora de más consumo de cada día.\n` +
  `2. Comparándola con el pico de 15 min que mide tu contador sale tu factor de pico: ×${fmtNum(risk.factor, 2)}` +
  (risk.factorSamples ? ` (con ${risk.factorSamples} picos medidos).\n` : ' (valor por defecto).\n') +
  `3. Pico estimado de cada día = media horaria × factor (sin superar el pico medido ese mes).\n` +
  `4. Probabilidad de corte en un día: 5 % si iguala tu potencia, 27 % a +10 %, 50 % a +15 %, 88 % a +25 %.\n` +
  `5. Con la de cada día se calcula la de al menos un corte en 30 días.`;

/** Análisis completo para la pestaña Potencia */
export function TripRiskSection({ supply }: { supply: SupplyRef }) {
  const c = useTheme();
  const { current: tariff } = useSupplyTariffs(supply.cups);
  const { risk, loading, noContract } = useTripRisk(supply);
  const [riskView, setRiskView] = useState<'mes' | 'hora'>('mes');

  const options = useMemo(() => {
    if (!risk) return [];
    const current = risk.contracted[0];
    const set = new Set([...STANDARD_POWERS.filter((p) => p >= current * 0.55 && p <= current * 2.2), current]);
    return [...set]
      .sort((a, b) => a - b)
      .map((kw) => {
        const w = whatIf(risk, kw);
        return { kw, ...w, annual: kw * 365 * (tariff.powerP1 + tariff.powerP2), current: kw === current };
      });
  }, [risk, tariff.powerP1, tariff.powerP2]);

  if (!risk) {
    return (
      <Card title="¿Saltarán los plomos?" info={DISCLAIMER}>
        {loading ? (
          <InlineLoading text="Calculando…" />
        ) : (
          <T variant="small">{noContract ? 'Falta la potencia contratada para calcularlo.' : 'Aún no hay datos suficientes.'}</T>
        )}
      </Card>
    );
  }

  const current = options.find((o) => o.current);
  // Menor potencia con riesgo < 5 % en el peor mes. Solo se recomienda subir si el riesgo actual es apreciable (≥ 20 %).
  const target = options.find((o) => o.pWorst < 0.05) ?? options[options.length - 1];
  const recommended = current && target && target.kw > current.kw && current.pWorst < 0.2 ? current : target;
  const topDays = [...risk.days].sort((a, b) => b.uNow - a.uNow).slice(0, 8);
  const events = [...risk.possibleTripDays].sort((a, b) => b.p - a.p);
  const p = risk.pNext30;

  return (
    <>
      {/* ---------- Riesgo ---------- */}
      <Card title="¿Saltarán los plomos?" info={`${headline(risk)}\n\n${HOW_IT_WORKS(risk)}`}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three }}>
          <Gauge value={p} size={130} />
          <View style={{ flex: 1 }}>
            <T style={{ fontSize: 34, lineHeight: 40, fontWeight: '800', color: levelColor(c, p) }}>{fmtPct(p)}</T>
            <T style={{ fontWeight: '700', color: levelColor(c, p) }}>Riesgo {riskLevel(p).label.toLowerCase()}</T>
            <T variant="small">próximos 30 días</T>
          </View>
        </View>
        {risk.days.length < 30 ? <T variant="small" style={{ color: c.warning }}>{`Solo ${risk.days.length} días de datos: poco fiable.`}</T> : null}
        <View style={styles.minis}>
          <Mini label="Mes típico" value={fmtPct(risk.pTypicalMonth)} color={levelColor(c, risk.pTypicalMonth)} />
          <Mini label="Peor mes" value={risk.worstMonth ? fmtPct(risk.worstMonth.p) : '—'} color={risk.worstMonth ? levelColor(c, risk.worstMonth.p) : undefined} sub={risk.worstMonth ? fmtMonthShort(risk.worstMonth.month) : undefined} />
          <Mini label="Último año" value={fmtTrips(risk.expectedTrips, true)} color={tripsColor(c, risk.expectedTrips)} sub="veces" />
        </View>
        <Segmented<'mes' | 'hora'>
          value={riskView}
          onChange={setRiskView}
          options={[
            { value: 'mes', label: 'Por mes' },
            { value: 'hora', label: 'Por hora' },
          ]}
        />
        {riskView === 'mes' ? (
          <BarChart
            data={risk.byMonth.map((m) => ({
              label: fmtMonthShort(m.month).split(' ')[0],
              detail: cap(fmtMonthLong(m.month)),
              segments: [{ value: m.p * 100, color: levelColor(c, m.p) }],
              note: `≈ ${fmtNum(m.expected, 1)} cortes estimados · pico ${fmtNum(m.maxU * 100, 0)} % de tu potencia`,
            }))}
            formatValue={(v) => fmtPct(v / 100)}
            unit="%"
            height={150}
          />
        ) : (
          <BarChart
            data={risk.byHour.map((v, h) => ({
              label: String(h),
              detail: `De ${pad2(h)}:00 a ${pad2(h + 1)}:00`,
              segments: [{ value: v * 100, color: levelColor(c, v * 30) }],
            }))}
            formatValue={(v) => `${fmtNum(v, v < 1 ? 2 : 1)} %`}
            unit="%"
            labelEvery={3}
            height={150}
          />
        )}
        {events.length ? (
          <Disclosure title={`Días en que pudo saltar (${events.length})`}>
            {events.map((d) => (
              <KeyValue
                key={d.day}
                k={`${fmtDate(d.day)} · ${pad2(d.hour)}:00`}
                hint={`${fmtKW(d.estPeakKW, 2)} con ${fmtKW(d.limitKW, 2)} (${fmtNum(d.u * 100, 0)} %)`}
                v={<T style={{ fontWeight: '700', color: levelColor(c, d.p) }}>{fmtPct(d.p)}</T>}
              />
            ))}
          </Disclosure>
        ) : null}
        <Disclosure title="Días más cerca del límite">
          {topDays.map((d) => (
            <DayRow key={d.day} d={d} />
          ))}
        </Disclosure>
        {risk.powerChanged ? <T variant="small">Cambiaste de potencia en este año: cada día se calcula con la que tenías.</T> : null}
      </Card>

      {/* ---------- Margen ---------- */}
      <MarginCard risk={risk} />

      {/* ---------- ¿Y si cambio la potencia? ---------- */}
      <Card
        title="¿Y si cambio la potencia?"
        info="Para cada potencia: cuántas veces habría saltado en el último año con tu consumo, la probabilidad de que salte en tu peor mes y el coste anual del término de potencia (sin impuestos). Se recomienda la menor potencia con menos de un 5 % de riesgo en tu peor mes.">
        {current && recommended && recommended.kw !== current.kw ? (
          <View style={[styles.pill, { backgroundColor: c.backgroundElement }]}>
            <Ionicons name={recommended.kw > current.kw ? 'arrow-up-circle' : 'arrow-down-circle'} size={22} color={recommended.kw > current.kw ? c.warning : c.p3} />
            <T style={{ flex: 1, fontWeight: '600' }}>
              {recommended.kw > current.kw ? 'Sube' : 'Baja'} a {fmtNum(recommended.kw, 2)} kW
            </T>
            <T variant="small" style={{ fontWeight: '700', color: c.text }}>
              {recommended.kw > current.kw ? `+${fmtEur(recommended.annual - current.annual)}/año` : `−${fmtEur(current.annual - recommended.annual)}/año`}
            </T>
          </View>
        ) : (
          <View style={[styles.pill, { backgroundColor: c.backgroundElement }]}>
            <Ionicons name="checkmark-circle" size={22} color={c.p3} />
            <T style={{ flex: 1, fontWeight: '600' }}>Tu potencia es la adecuada</T>
          </View>
        )}
        <DataTable
          columns={[
            { title: 'kW', render: (o: (typeof options)[number]) => `${fmtNum(o.kw, 2)}${o.current ? ' ●' : ''}`, width: 70 },
            { title: 'Cortes', render: (o) => fmtTrips(o.expectedTrips, true), color: (o) => tripsColor(c, o.expectedTrips), width: 76 },
            { title: 'Peor mes', render: (o) => fmtPct(o.pWorst), color: (o) => levelColor(c, o.pWorst), width: 68 },
            { title: '€/año', render: (o) => fmtNum(o.annual, 0), width: 56 },
          ]}
          rows={options}
        />
      </Card>
    </>
  );
}

function Mini({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  const c = useTheme();
  return (
    <View style={[styles.mini, { backgroundColor: c.backgroundElement }]}>
      <T variant="small" numberOfLines={1}>
        {label}
      </T>
      <T style={{ fontWeight: '800', fontSize: 17, color: color ?? c.text }} numberOfLines={1}>
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

function DayRow({ d }: { d: DayRisk }) {
  const c = useTheme();
  const pct = d.uNow * 100;
  return (
    <KeyValue
      k={`${fmtDate(d.day)} · ${pad2(d.hour)}:00`}
      hint={d.measured ? 'medido por el contador' : 'estimado'}
      v={
        <View style={{ alignItems: 'flex-end' }}>
          <T style={{ fontWeight: '700', color: pct >= 100 ? c.danger : pct >= 90 ? c.warning : c.text }}>{fmtKW(d.estPeakKW, 2)}</T>
          <T variant="small">{fmtNum(pct, 0)} %</T>
        </View>
      }
    />
  );
}

/** Margen del limitador con la potencia contratada del usuario (curva UNE 20317) */
function MarginCard({ risk }: { risk: TripRisk }) {
  const c = useTheme();
  const p1 = risk.contracted[0];
  const maxM = risk.maxMeasured;
  const colors = [c.p3, c.p2, '#EF7D2F', c.danger];
  const short = ['no salta', '10-15 min', '30 s - 3 min', 'segundos'];
  return (
    <Card
      title="Tu margen"
      right={<T variant="small">con {fmtKW(p1, 2)}</T>}
      info={
        'El limitador no corta nada más pasar de tu potencia: sigue la curva de la norma UNE 20317, que tolera excesos pequeños y corta antes cuanto mayor es el exceso. Los tiempos son orientativos.\n\n' +
        'Los aparatos que más picos provocan: horno, vitro o inducción, termo, lavadora y lavavajillas al calentar agua, secadora, aire acondicionado y la carga del coche eléctrico.'
      }>
      {TRIP_CURVE.map((t, i) => (
        <View key={t.factor} style={styles.marginRow}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors[i] }} />
          <T style={{ fontWeight: '700', width: 92 }}>
            {i === 0 ? '≤ ' : ''}
            {fmtKW(p1 * t.factor, 2)}
          </T>
          <T variant="small" style={{ flex: 1 }}>
            {t.label}
          </T>
          <T variant="small" style={{ color: c.text, fontWeight: '600' }}>
            {short[i]}
          </T>
        </View>
      ))}
      {maxM ? (
        <View style={[styles.pill, { backgroundColor: c.backgroundElement }]}>
          <Ionicons name="pulse" size={20} color={maxM.kw > p1 * 1.1 ? c.danger : maxM.kw > p1 ? c.warning : c.p3} />
          <T variant="small" style={{ flex: 1, color: c.text }}>
            Tu mayor pico: <T variant="small" style={{ fontWeight: '800', color: c.text }}>{fmtKW(maxM.kw, 2)}</T> ({fmtNum((maxM.kw / p1) * 100, 0)} %) · {fmtDate(maxM.date)} {maxM.time}
          </T>
        </View>
      ) : null}
    </Card>
  );
}

/** Número estimado de cortes, redondeado de forma legible */
function fmtTrips(n: number, short = false): string {
  if (n < 0.5) return short ? '0' : 'Ninguna vez (probablemente)';
  const v = n < 10 ? Math.round(n * 2) / 2 : Math.round(n);
  const txt = `≈ ${fmtNum(v, Number.isInteger(v) ? 0 : 1)}`;
  return short ? txt : `${txt} ${v === 1 ? 'vez' : 'veces'}`;
}

function tripsColor(c: ReturnType<typeof useTheme>, n: number) {
  return n < 0.5 ? c.p3 : n < 2 ? '#7CB342' : n < 6 ? c.p2 : n < 12 ? '#EF7D2F' : c.danger;
}
