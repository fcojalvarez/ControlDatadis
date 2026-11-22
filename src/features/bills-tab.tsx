import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { BarChart } from '@/components/bar-chart';
import {
  Button,
  Card,
  Chips,
  Empty,
  InlineLoading,
  KeyValue,
  Loading,
  Notice,
  Row,
  SavedDataNotice,
  Screen,
  Stat,
  T,
  UpdatedAt,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { costWithTariff, computeBills, type Bill } from '@/lib/billing';
import { normalize } from '@/lib/consumption';
import { cap, fmtDate, fmtEur, fmtKWh, fmtMonthLong, fmtMonthShort, fmtNum } from '@/lib/format';
import { PERIOD_LABELS, PERIODS } from '@/lib/periods';
import { contractPeriods } from '@/lib/trip-risk';
import type { Tariff } from '@/lib/tariff';

import { addMonths, monthRange, useConsumptionMonths } from './consumption-data';
import { supplyBounds } from './period';
import { useContract } from './queries';
import { useSupplyTariffs } from './tariffs';
import type { SupplyRef } from './types';

type Range = 12 | 24;

export function BillsTab({ supply }: { supply: SupplyRef }) {
  const c = useTheme();
  const { cfg, current, configured } = useSupplyTariffs(supply.cups);
  const [range, setRange] = useState<Range>(12);
  const bounds = useMemo(() => supplyBounds(supply), [supply]);
  const months = useMemo(
    () => monthRange(addMonths(bounds.max, -range), bounds.max).filter((k) => k >= bounds.min),
    [bounds, range],
  );
  const q = useConsumptionMonths(supply, months, 0);
  const contract = useContract(supply);

  const contractedOn = useMemo(() => {
    const contracts = contract.data?.contracts ?? [];
    const history = contractPeriods(contracts);
    const latest = [...contracts].sort((a, b) => ((a.startDate ?? '') < (b.startDate ?? '') ? 1 : -1))[0]?.contractedPowerkW ?? [];
    return (day: string) => {
      const d = day.replace(/\//g, '-');
      return history.find((h) => h.from <= d && (!h.to || d <= h.to))?.kw ?? latest;
    };
  }, [contract.data]);

  const readings = useMemo(() => normalize(months.flatMap((k) => q.months[k] ?? []), 60), [q.months, months]);

  // Facturas de los últimos `range` meses (se descarta el primer periodo si está cortado)
  const bills = useMemo(() => {
    const all = computeBills(readings, cfg.billingDay, cfg.history, contractedOn);
    return all.filter((b, i) => !(i === 0 && b.incomplete && all.length > 1)).slice(-range);
  }, [readings, cfg.billingDay, cfg.history, contractedOn, range]);

  const closed = useMemo(() => bills.filter((b) => !b.open), [bills]);
  const total = closed.reduce((a, b) => a + b.cost.total, 0);
  const avg = closed.length ? total / closed.length : 0;
  const maxBill = closed.reduce<Bill | null>((m, b) => (!m || b.cost.total > m.cost.total ? b : m), null);
  const noPower = !!contract.data && !contractedOn(bills[bills.length - 1]?.end ?? '').length;

  // Comparación de ofertas con el consumo de los últimos 12 periodos cerrados
  const comparison = useMemo(() => {
    const last12 = closed.slice(-12);
    if (!last12.length || !cfg.candidates.length) return null;
    const from = last12[0].start;
    const to = last12[last12.length - 1].end;
    const sample = readings.filter((r) => r.day >= from && r.day <= to);
    const mine = last12.reduce((a, b) => a + b.cost.total, 0);
    const days = last12.reduce((a, b) => a + b.days, 0);
    const offers = cfg.candidates
      .map((t) => {
        const r = costWithTariff(sample, t, contractedOn);
        return { tariff: t, total: r.cost.total };
      })
      .sort((a, b) => a.total - b.total);
    return { mine, days, from, to, offers, perYear: (v: number) => (v * 365) / Math.max(1, days) };
  }, [closed, cfg.candidates, readings, contractedOn]);

  const openTariff = () => router.push({ pathname: '/tariff/[cups]', params: { cups: supply.cups } });

  return (
    <Screen refreshing={q.loading && readings.length > 0} onRefresh={q.refresh}>
      <Card
        title="Tu tarifa"
        info="Datadis no da los precios de tu comercializadora: las facturas se estiman con los precios que pongas aquí y tu consumo real. Pueden no coincidir al céntimo con las reales (redondeos, bono social, regularizaciones, lecturas estimadas…).">
        {!configured ? (
          <Notice tone="warning">
            Estás usando precios genéricos. Pon los de tu factura para que las estimaciones se parezcan a las reales.
          </Notice>
        ) : null}
        <TariffSummary t={current} />
        <KeyValue k="Ciclo de facturación" v={cfg.billingDay === 1 ? 'Meses naturales' : `Del día ${cfg.billingDay} al ${cfg.billingDay - 1}`} />
        {cfg.history.length > 1 ? <KeyValue k="Cambios de precio" v={`${cfg.history.length - 1}`} hint="Cada día se calcula con los precios vigentes entonces" /> : null}
        <Button title="Editar tarifa, ciclo y ofertas" variant={configured ? 'secondary' : 'primary'} onPress={openTariff} />
      </Card>

      <Chips
        options={[
          { value: 12, label: 'Último año' },
          { value: 24, label: 'Últimos 2 años' },
        ]}
        value={range}
        onChange={setRange}
      />

      {q.loading && readings.length === 0 ? <Loading text="Descargando tu consumo para calcular las facturas…" /> : null}
      {q.loading && readings.length > 0 ? (
        <InlineLoading text={q.pending ? `Descargando de Datadis: faltan ${q.pending} de ${q.total} meses…` : 'Actualizando con Datadis…'} />
      ) : null}
      <SavedDataNotice hasData={readings.length > 0} error={q.error} stale={q.stale} ts={q.updatedAt} onRetry={q.refresh} />
      {noPower ? <Notice tone="warning">No se conoce la potencia contratada: el término de potencia sale a 0 €.</Notice> : null}
      {!q.loading && !bills.length && !q.error ? <Empty text="No hay datos de consumo para calcular facturas." /> : null}

      {bills.length > 0 && (
        <>
          <Card>
            <Row>
              <Stat label={`Total ${closed.length} facturas`} value={fmtEur(total)} sub="cerradas, con impuestos" />
              <Stat label="Media por factura" value={fmtEur(avg)} sub={`${fmtEur(avg * 12)} al año`} />
              {maxBill ? <Stat label="La más alta" value={fmtEur(maxBill.cost.total)} sub={periodLabel(maxBill)} /> : null}
              {bills[bills.length - 1].open ? (
                <Stat
                  label="Factura en curso"
                  value={fmtEur(bills[bills.length - 1].cost.total)}
                  sub={`${bills[bills.length - 1].days} días hasta ahora`}
                />
              ) : null}
            </Row>
          </Card>

          <Card title="Factura a factura" subtitle="Toca una barra para ver su importe">
            <BarChart
              data={bills.map((b) => ({
                label: fmtMonthShort(b.start.slice(0, 7)).split(' ')[0],
                detail: `${periodLabel(b)}${b.open ? ' (en curso)' : ''}`,
                segments: [
                  { value: b.cost.energy - b.cost.surplusCompensation, color: c.tint, name: 'Energía' },
                  { value: b.cost.power, color: c.p2, name: 'Potencia' },
                  { value: b.cost.total - (b.cost.energy - b.cost.surplusCompensation) - b.cost.power, color: c.textSecondary, name: 'Impuestos y otros' },
                ],
              }))}
              formatValue={(v) => fmtEur(v)}
              legend={[
                { color: c.tint, label: 'Energía' },
                { color: c.p2, label: 'Potencia' },
                { color: c.textSecondary, label: 'Impuestos y otros' },
              ]}
            />
          </Card>

          <Card title="Facturas" subtitle="Toca una para ver el desglose">
            {[...bills].reverse().map((b) => (
              <BillRow key={b.start} b={b} />
            ))}
          </Card>

          <Card
            title="¿Qué tarifa me conviene?"
            info="Se calcula cuánto habrías pagado con cada oferta usando tu consumo real hora a hora de las últimas facturas cerradas (hasta 12) y tu potencia contratada.">
            {comparison ? (
              <>
                <T variant="small">
                  Con tu consumo del {fmtDate(comparison.from)} al {fmtDate(comparison.to)}:
                </T>
                <KeyValue k={`${current.name} (la tuya)`} v={<T style={{ fontWeight: '700' }}>{fmtEur(comparison.mine)}</T>} hint={`${fmtEur(comparison.perYear(comparison.mine))} al año`} />
                {comparison.offers.map((o) => {
                  const diff = o.total - comparison.mine;
                  return (
                    <KeyValue
                      key={o.tariff.id}
                      k={o.tariff.name}
                      hint={
                        Math.abs(diff) < 0.5
                          ? 'Mismo coste que la tuya'
                          : diff < 0
                            ? `Ahorrarías ${fmtEur(comparison.perYear(-diff))} al año`
                            : `Pagarías ${fmtEur(comparison.perYear(diff))} más al año`
                      }
                      v={<T style={{ fontWeight: '700', color: Math.abs(diff) < 0.5 ? c.text : diff < 0 ? c.p3 : c.danger }}>{fmtEur(o.total)}</T>}
                    />
                  );
                })}
                {comparison.offers[0].total < comparison.mine ? (
                  <Notice tone="good">{`La más barata para ti es «${comparison.offers[0].tariff.name}».`}</Notice>
                ) : (
                  <Notice tone="good">Tu tarifa actual es la más barata de las que has añadido.</Notice>
                )}
              </>
            ) : (
              <T variant="small">Añade ofertas de otras comercializadoras y verás cuánto habrías pagado con cada una.</T>
            )}
            <Button title="Añadir o editar ofertas" variant="secondary" onPress={openTariff} />
          </Card>
        </>
      )}
      <UpdatedAt ts={q.updatedAt} loading={q.loading} />
    </Screen>
  );
}

function periodLabel(b: Bill): string {
  if (b.start.slice(8) === '01' && b.start.slice(0, 7) === b.end.slice(0, 7) && !b.open) return cap(fmtMonthLong(b.start.slice(0, 7)));
  return `${fmtDate(b.start)} – ${fmtDate(b.end)}`;
}

function TariffSummary({ t }: { t: Tariff }) {
  return (
    <>
      <KeyValue k="Tarifa" v={t.name} />
      <KeyValue
        k="Energía"
        v={
          t.kind === 'single'
            ? `${fmtNum(t.energy.P1, 4)} €/kWh`
            : PERIODS.map((p) => `${PERIOD_LABELS[p]} ${fmtNum(t.energy[p], 4)}`).join('\n') + ' €/kWh'
        }
      />
      <KeyValue k="Potencia" v={`P1 ${fmtNum(t.powerP1, 4)} · P2 ${fmtNum(t.powerP2, 4)} €/kW·día`} />
    </>
  );
}

function BillRow({ b }: { b: Bill }) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: c.border, paddingVertical: 10 }}>
      <Pressable onPress={() => setOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
        <View style={{ flex: 1 }}>
          <T style={{ fontWeight: '600' }}>{periodLabel(b)}</T>
          <T variant="small">
            {b.days} días · {fmtKWh(b.kwh, 0)}
            {b.open ? ' · en curso' : ''}
            {b.incomplete && !b.open ? ' · faltan datos' : ''}
          </T>
        </View>
        <T style={{ fontWeight: '800', fontSize: 18 }}>{fmtEur(b.cost.total)}</T>
        <T style={{ color: c.tint }}>{open ? '▲' : '▼'}</T>
      </Pressable>
      {open ? (
        <View style={{ marginTop: 6 }}>
          {PERIODS.map((p) => (
            <KeyValue key={p} k={`Energía ${PERIOD_LABELS[p].toLowerCase()}`} v={fmtKWh(b.byPeriod[p], 1)} />
          ))}
          <KeyValue k="Término de energía" v={fmtEur(b.cost.energy + b.cost.discount)} />
          {b.cost.discount > 0 ? <KeyValue k="Descuento" v={`−${fmtEur(b.cost.discount)}`} /> : null}
          {b.cost.surplusCompensation > 0 ? <KeyValue k="Compensación excedentes" hint={fmtKWh(b.surplus, 0)} v={`−${fmtEur(b.cost.surplusCompensation)}`} /> : null}
          <KeyValue k="Término de potencia" hint={`${b.contracted.map((k) => fmtNum(k, 2)).join(' / ')} kW × ${b.days} días`} v={fmtEur(b.cost.power)} />
          <KeyValue k="Impuesto eléctrico" v={fmtEur(b.cost.electricityTax)} />
          <KeyValue k="Alquiler del contador" v={fmtEur(b.cost.meterRental)} />
          {b.cost.extras > 0 ? <KeyValue k="Servicios adicionales" v={fmtEur(b.cost.extras)} /> : null}
          <KeyValue k="IVA" v={fmtEur(b.cost.vat)} />
          <KeyValue k="Total" v={<T style={{ fontWeight: '800' }}>{fmtEur(b.cost.total)}</T>} hint={`${fmtNum(b.kwh ? b.cost.total / b.kwh : 0, 3)} €/kWh de media`} />
          {b.tariffNames.length > 1 ? <T variant="small">Con cambio de precios: {b.tariffNames.join(' → ')}</T> : null}
          {b.incomplete && !b.open ? (
            <T variant="small" style={{ color: c.warning }}>
              Faltan {b.days - b.daysWithData} días de datos en Datadis: el importe real será algo mayor.
            </T>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
