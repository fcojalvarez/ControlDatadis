import { useEffect, useMemo } from 'react';
import { View } from 'react-native';

import { BarChart } from '@/components/bar-chart';
import { Gauge } from '@/components/gauge';
import { Card, DataTable, Disclosure, InlineLoading, KeyValue, Notice, Row, Stat, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/context/session';
import { useTheme } from '@/hooks/use-theme';
import { normalize, normalizeMaxPower } from '@/lib/consumption';
import { setJSON } from '@/lib/storage';
import { fmtDate, fmtEur, fmtKW, fmtMonthLong, fmtMonthShort, fmtNum, fmtPct, pad2, cap } from '@/lib/format';
import { STANDARD_POWERS, analyzeTripRisk, riskLevel, whatIf, type DayRisk, type TripRisk } from '@/lib/trip-risk';

import { addMonths, monthRange, useConsumptionMonths } from './consumption-data';
import { supplyBounds } from './period';
import { useContract, useMaxPower } from './queries';
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
    const ct = contract.data?.contracts?.slice().sort((a, b) => ((a.startDate ?? '') < (b.startDate ?? '') ? 1 : -1))[0];
    return ct?.contractedPowerkW ?? [];
  }, [contract.data]);

  const risk = useMemo(() => {
    // Último año (365 días) de curva horaria
    const keys = months.filter((k) => k >= addMonths(bounds.max, -12));
    const readings = normalize(keys.flatMap((k) => cons.months[k] ?? []), 60);
    const maxRows = maxp.data ? normalizeMaxPower(maxp.data.rows) : [];
    return analyzeTripRisk(readings, 60, maxRows, contracted);
  }, [cons.months, maxp.data, contracted, months, bounds.max]);

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
    return `Tu contador ya ha registrado ${r.exceedances.length} ${r.exceedances.length === 1 ? 'pico' : 'picos'} por encima de tu potencia. Es probable que salte si coinciden varios aparatos potentes.`;
  if (p < 0.05) return 'Es muy improbable que te salten los plomos con tu consumo habitual.';
  if (p < 0.2) return 'Es poco probable que salte, aunque podría ocurrir si enciendes a la vez muchos aparatos potentes.';
  if (p < 0.5) return 'Hay un riesgo real de que salte en momentos de mucho consumo. Evita usar a la vez horno, vitro, lavadora y calefacción.';
  return 'Es muy probable que te salten los plomos. Valora subir la potencia contratada o repartir el uso de los aparatos.';
}

const DISCLAIMER =
  'Es una estimación. Datadis no informa de los cortes: se calcula a partir de tu curva de consumo y de los picos de 15 minutos que mide tu contador. El limitador reacciona a picos de segundos que no se ven en estos datos.';

/** Tarjeta compacta para el Resumen */
export function TripRiskSummaryCard({ supply, onOpen }: { supply: SupplyRef; onOpen: () => void }) {
  const c = useTheme();
  const { risk, loading, noContract } = useTripRisk(supply);
  return (
    <Card title="¿Me saltarán los plomos?" subtitle="Probabilidad de que salte el limitador en los próximos 30 días" info={DISCLAIMER}>
      {risk ? (
        <>
          <Gauge value={risk.pNext30} label={`Riesgo ${riskLevel(risk.pNext30).label.toLowerCase()}`} size={220} />
          <T style={{ textAlign: 'center' }}>{headline(risk)}</T>
          {risk.worstMonth && risk.worstMonth.p > risk.pNext30 + 0.05 ? (
            <T variant="small" style={{ textAlign: 'center' }}>
              En tu peor mes ({fmtMonthLong(risk.worstMonth.month)}) llegó al {fmtPct(risk.worstMonth.p)}.
            </T>
          ) : null}
          <T style={{ color: c.tint, fontWeight: '700', textAlign: 'center' }} onPress={onOpen}>
            Ver análisis completo y qué potencia te conviene ›
          </T>
        </>
      ) : loading ? (
        <InlineLoading text="Calculando el riesgo con tu consumo del último año…" />
      ) : (
        <T variant="small">{noContract ? 'No se puede calcular: la distribuidora no ha devuelto la potencia contratada.' : 'No hay datos suficientes para calcular el riesgo.'}</T>
      )}
    </Card>
  );
}

/** Análisis completo para la pestaña Potencia */
export function TripRiskSection({ supply }: { supply: SupplyRef }) {
  const c = useTheme();
  const { settings } = useSession();
  const { risk, loading, noContract } = useTripRisk(supply);

  const options = useMemo(() => {
    if (!risk) return [];
    const current = risk.contracted[0];
    const set = new Set([...STANDARD_POWERS.filter((p) => p >= current * 0.55 && p <= current * 2.2), current]);
    return [...set]
      .sort((a, b) => a - b)
      .map((kw) => {
        const w = whatIf(risk, kw);
        return { kw, ...w, annual: kw * 365 * (settings.prices.powerP1 + settings.prices.powerP2), current: kw === current };
      });
  }, [risk, settings.prices.powerP1, settings.prices.powerP2]);

  if (!risk) {
    return (
      <Card title="Riesgo de que salten los plomos" info={DISCLAIMER}>
        {loading ? (
          <InlineLoading text="Calculando el riesgo con tu consumo del último año…" />
        ) : (
          <T variant="small">{noContract ? 'No se puede calcular sin la potencia contratada.' : 'No hay datos de consumo suficientes.'}</T>
        )}
      </Card>
    );
  }

  const current = options.find((o) => o.current);
  // Menor potencia con riesgo < 5 % en el peor mes. Solo se recomienda subir si el riesgo actual es apreciable (≥ 20 %).
  const target = options.find((o) => o.pWorst < 0.05) ?? options[options.length - 1];
  const recommended = current && target && target.kw > current.kw && current.pWorst < 0.2 ? current : target;
  const topDays = [...risk.days].sort((a, b) => b.u - a.u).slice(0, 8);
  const lowData = risk.days.length < 30;

  return (
    <>
      <Card title="Riesgo de que salten los plomos" subtitle="Probabilidad de que salte el limitador al menos una vez en los próximos 30 días" info={DISCLAIMER}>
        <Gauge value={risk.pNext30} label={`Riesgo ${riskLevel(risk.pNext30).label.toLowerCase()}`} sublabel="Según tus últimos 30 días y el mismo periodo del año pasado" />
        <T style={{ textAlign: 'center' }}>{headline(risk)}</T>
        {lowData ? <Notice tone="warning">{`Solo hay ${risk.days.length} días de datos: la estimación es poco fiable.`}</Notice> : null}
        <Row style={{ marginTop: Spacing.two }}>
          <Stat label="Mes típico" value={fmtPct(risk.pTypicalMonth)} color={levelColor(c, risk.pTypicalMonth)} sub="media del último año" />
          <Stat
            label="Peor mes"
            value={risk.worstMonth ? fmtPct(risk.worstMonth.p) : '—'}
            color={risk.worstMonth ? levelColor(c, risk.worstMonth.p) : undefined}
            sub={risk.worstMonth ? cap(fmtMonthLong(risk.worstMonth.month)) : undefined}
          />
          <Stat label="Días al límite" value={String(risk.riskyDays)} sub="pico estimado ≥ 90 % de tu potencia" color={risk.riskyDays ? c.warning : undefined} />
          <Stat
            label="Picos por encima"
            value={String(risk.exceedances.length)}
            sub="medidos por tu contador"
            color={risk.exceedances.length ? c.danger : undefined}
          />
        </Row>
      </Card>

      <Card title="¿Y si cambio la potencia?" info="Riesgo estimado de corte y coste anual del término de potencia (con tus precios de Ajustes, sin impuestos) para cada potencia. Se marca la menor potencia con la que el riesgo en tu peor mes queda por debajo del 5 %.">
        {current && recommended && recommended.kw !== current.kw ? (
          <Notice tone={recommended.kw > current.kw ? 'warning' : 'good'}>
            <T style={{ fontWeight: '700' }}>
              {recommended.kw > current.kw ? `Te convendría subir a ${fmtNum(recommended.kw, 2)} kW` : `Podrías bajar a ${fmtNum(recommended.kw, 2)} kW`}
            </T>
            <T variant="small" style={{ color: c.text }}>
              {recommended.kw > current.kw
                ? `El riesgo en tu peor mes bajaría del ${fmtPct(current.pWorst)} al ${fmtPct(recommended.pWorst)}, por unos ${fmtEur(recommended.annual - current.annual)} más al año.`
                : `Mantendrías un riesgo muy bajo (${fmtPct(recommended.pWorst)} en tu peor mes) y ahorrarías unos ${fmtEur(current.annual - recommended.annual)} al año.`}
            </T>
          </Notice>
        ) : (
          <Notice tone="good">Tu potencia contratada es la adecuada para tu consumo.</Notice>
        )}
        <DataTable
          columns={[
            { title: 'Potencia', render: (o: (typeof options)[number]) => `${fmtNum(o.kw, 2)} kW${o.current ? ' ●' : ''}`, width: 92 },
            { title: 'Mes típico', render: (o) => fmtPct(o.pTypical), color: (o) => levelColor(c, o.pTypical), width: 76 },
            { title: 'Peor mes', render: (o) => fmtPct(o.pWorst), color: (o) => levelColor(c, o.pWorst), width: 70 },
            { title: '€/año', render: (o) => fmtNum(o.annual, 0), width: 56 },
          ]}
          rows={options}
        />
        <T variant="small">● tu potencia actual{recommended ? ` · Recomendada: ${fmtNum(recommended.kw, 2)} kW` : ''}</T>
      </Card>

      <Card title="Riesgo por mes" subtitle="Probabilidad de que salte en cada mes del último año">
        <BarChart
          data={risk.byMonth.map((m) => ({
            label: fmtMonthShort(m.month).split(' ')[0],
            detail: cap(fmtMonthLong(m.month)),
            segments: [{ value: m.p * 100, color: levelColor(c, m.p) }],
            note: `Pico estimado máximo: ${fmtNum(m.maxU * 100, 0)} % de tu potencia · ${m.days} días con datos`,
          }))}
          formatValue={(v) => fmtPct(v / 100)}
          height={170}
        />
      </Card>

      <Card title="Horas de más riesgo" subtitle="En qué hora del día suele producirse el pico peligroso">
        <BarChart
          data={risk.byHour.map((v, h) => ({
            label: String(h),
            detail: `De ${pad2(h)}:00 a ${pad2(h + 1)}:00`,
            segments: [{ value: v * 100, color: levelColor(c, v * 30) }],
          }))}
          formatValue={(v) => `${fmtNum(v, v < 1 ? 2 : 1)} %`}
          labelEvery={3}
          height={150}
        />
        <T variant="small">Probabilidad diaria de corte en cada hora. Evita juntar aparatos potentes en las horas más altas.</T>
      </Card>

      <Card title="Días más cerca del límite">
        {topDays.map((d) => (
          <DayRow key={d.day} d={d} />
        ))}
        <Disclosure title="¿Cómo se calcula?">
          <View style={{ gap: 6 }}>
            <T variant="small" style={{ color: c.text }}>
              1. De tu curva de consumo se toma la hora de más consumo de cada día (potencia media de esa hora).
            </T>
            <T variant="small" style={{ color: c.text }}>
              2. Tu contador mide además el pico de 15 minutos de cada mes. Comparándolo con la media horaria de ese día sale tu factor de pico:{' '}
              <T variant="small" style={{ fontWeight: '700', color: c.text }}>
                ×{fmtNum(risk.factor, 2)}
              </T>
              {risk.factorSamples ? ` (calculado con ${risk.factorSamples} picos medidos).` : ' (valor por defecto: no hay picos medidos con los que calibrar).'}
            </T>
            <T variant="small" style={{ color: c.text }}>
              3. Pico estimado de cada día = media horaria × factor (o el pico medido por el contador ese día, si lo hay). Se compara con tu potencia: P1 ({fmtKW(risk.contracted[0], 2)}) en punta y llano
              {risk.contracted[1] ? ` y P2 (${fmtKW(risk.contracted[1], 2)}) en valle` : ''}.
            </T>
            <T variant="small" style={{ color: c.text }}>
              4. Si el pico estimado llega al 100 % de la potencia, la probabilidad de corte ese día es del 50 %; al 95 %, de un 22 %; al 90 %, de un 8 %; al 85 %, de un 2 %. Ningún día puede superar el pico real que midió el contador ese mes.
            </T>
            <T variant="small" style={{ color: c.text }}>
              5. Con la probabilidad de cada día se calcula la de que salte al menos una vez en 30 días.
            </T>
          </View>
        </Disclosure>
      </Card>
    </>
  );
}

function DayRow({ d }: { d: DayRisk }) {
  const c = useTheme();
  const pct = d.u * 100;
  return (
    <KeyValue
      k={`${fmtDate(d.day)} · ${pad2(d.hour)}:00`}
      hint={`${d.measured ? 'Pico medido por el contador' : d.capped ? 'Estimado, igual al pico medido ese mes' : `Pico estimado (media horaria ${fmtKW(d.avgPeakKW, 2)})`} · límite ${fmtKW(d.limitKW, 2)}`}
      v={
        <View style={{ alignItems: 'flex-end' }}>
          <T style={{ fontWeight: '700', color: pct >= 100 ? c.danger : pct >= 90 ? c.warning : c.text }}>{fmtKW(d.estPeakKW, 2)}</T>
          <T variant="small">{fmtNum(pct, 0)} % de tu potencia</T>
        </View>
      }
    />
  );
}
