import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BarChart } from '@/components/bar-chart';
import { Select } from '@/components/select';
import {
  Card,
  Empty,
  InlineLoading,
  KeyValue,
  Loading,
  Notice,
  SavedDataNotice,
  Screen,
  T,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { costWithTariff, computeBills, type Bill } from '@/lib/billing';
import { normalize } from '@/lib/consumption';
import { cap, fmtDate, fmtEur, fmtKWh, fmtMonthLong, fmtMonthShort, fmtNum } from '@/lib/format';
import { PERIOD_LABELS, PERIODS } from '@/lib/periods';
import { contractPeriods } from '@/lib/trip-risk';

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

  const openBill = bills.length && bills[bills.length - 1].open ? bills[bills.length - 1] : null;
  const priceLine =
    current.kind === 'single'
      ? `${fmtNum(current.energy.P1, 3)} €/kWh`
      : PERIODS.map((p) => `${PERIOD_LABELS[p]} ${fmtNum(current.energy[p], 3)}`).join(' · ') + ' €/kWh';

  return (
    <Screen refreshing={q.loading && readings.length > 0} onRefresh={q.refresh}>
      {/* ---------- Tarifa (toca para editar) ---------- */}
      <Card
        title={current.name}
        onPress={openTariff}
        info="Datadis no da los precios de tu comercializadora: las facturas se estiman con los precios de tu tarifa y tu consumo real. Pueden no coincidir al céntimo (redondeos, bono social, regularizaciones, lecturas estimadas…).">
        <T variant="small">{priceLine}</T>
        <T variant="small">
          {cfg.billingDay === 1 ? 'Meses naturales' : `Facturas del día ${cfg.billingDay} al ${cfg.billingDay - 1}`}
          {cfg.history.length > 1 ? ` · ${cfg.history.length - 1} cambio${cfg.history.length > 2 ? 's' : ''} de precio` : ''}
        </T>
        {!configured ? (
          <View style={[styles.warn, { backgroundColor: c.backgroundElement }]}>
            <Ionicons name="alert-circle-outline" size={18} color={c.warning} />
            <T variant="small" style={{ color: c.text, flex: 1 }}>
              Precios genéricos. Toca para poner los de tu factura.
            </T>
          </View>
        ) : null}
      </Card>

      {q.loading && readings.length === 0 ? <Loading text="Descargando tu consumo…" /> : null}
      {q.loading && readings.length > 0 ? <InlineLoading text={q.pending ? `Descargando: faltan ${q.pending} meses` : 'Actualizando…'} /> : null}
      <SavedDataNotice hasData={readings.length > 0} error={q.error} stale={q.stale} ts={q.updatedAt} onRetry={q.refresh} />
      {noPower ? <Notice tone="warning">Sin potencia contratada: el término de potencia sale a 0 €.</Notice> : null}
      {!q.loading && !bills.length && !q.error ? <Empty text="Aún no hay consumo para calcular facturas." /> : null}

      {bills.length > 0 && (
        <>
          {/* ---------- Totales ---------- */}
          <Card>
            <View style={styles.split}>
              <View style={{ flex: 1 }}>
                <T variant="hero">{fmtEur(total)}</T>
                <T variant="small">
                  {closed.length} facturas · {fmtEur(avg)} de media
                </T>
              </View>
              <Select<Range>
                title="Periodo"
                value={range}
                onChange={setRange}
                options={[
                  { value: 12, label: '1 año' },
                  { value: 24, label: '2 años' },
                ]}
              />
            </View>
            <View style={styles.miniRow}>
              {openBill ? <Mini label="En curso" value={fmtEur(openBill.cost.total)} sub={`${openBill.days} días`} /> : null}
              {maxBill ? <Mini label="La más alta" value={fmtEur(maxBill.cost.total)} sub={periodLabel(maxBill)} /> : null}
            </View>
          </Card>

          {/* ---------- Gráfica ---------- */}
          <Card>
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
              height={170}
              legend={[
                { color: c.tint, label: 'Energía' },
                { color: c.p2, label: 'Potencia' },
                { color: c.textSecondary, label: 'Impuestos y otros' },
              ]}
            />
          </Card>

          {/* ---------- Lista de facturas ---------- */}
          <Card title="Facturas">
            {[...bills].reverse().map((b) => (
              <BillRow key={b.start} b={b} />
            ))}
          </Card>

          {/* ---------- Comparador ---------- */}
          <Card
            title="¿Qué tarifa me conviene?"
            info={
              comparison
                ? `Cuánto habrías pagado con cada oferta usando tu consumo real hora a hora del ${fmtDate(comparison.from)} al ${fmtDate(comparison.to)} y tu potencia contratada.`
                : 'Añade ofertas de otras comercializadoras y verás cuánto habrías pagado con cada una con tu consumo real.'
            }
            right={
              <Pressable onPress={openTariff} hitSlop={10} accessibilityLabel="Añadir oferta">
                <Ionicons name="add-circle-outline" size={24} color={c.tint} />
              </Pressable>
            }>
            {comparison ? (
              <>
                <OfferRow name={`${current.name} (la tuya)`} total={comparison.mine} perYear={comparison.perYear(comparison.mine)} />
                {comparison.offers.map((o) => (
                  <OfferRow key={o.tariff.id} name={o.tariff.name} total={o.total} perYear={comparison.perYear(o.total)} diffYear={comparison.perYear(o.total - comparison.mine)} />
                ))}
              </>
            ) : (
              <T variant="small">Toca + para añadir una oferta.</T>
            )}
          </Card>
        </>
      )}
    </Screen>
  );
}

function OfferRow({ name, total, perYear, diffYear }: { name: string; total: number; perYear: number; diffYear?: number }) {
  const c = useTheme();
  const same = diffYear === undefined || Math.abs(diffYear) < 1;
  const color = diffYear === undefined || same ? c.text : diffYear < 0 ? c.p3 : c.danger;
  return (
    <View style={[styles.offer, { borderTopColor: c.border }]}>
      <View style={{ flex: 1 }}>
        <T style={{ fontWeight: diffYear === undefined ? '700' : '500' }} numberOfLines={1}>
          {name}
        </T>
        <T variant="small">{fmtEur(perYear)}/año</T>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <T style={{ fontWeight: '800', color }}>{fmtEur(total)}</T>
        {diffYear !== undefined && !same ? (
          <T variant="small" style={{ color, fontWeight: '600' }}>
            {diffYear < 0 ? `ahorras ${fmtEur(-diffYear)}/año` : `+${fmtEur(diffYear)}/año`}
          </T>
        ) : null}
      </View>
    </View>
  );
}

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const c = useTheme();
  return (
    <View style={[styles.mini, { backgroundColor: c.backgroundElement }]}>
      <T variant="small">{label}</T>
      <T style={{ fontWeight: '800', fontSize: 16 }}>{value}</T>
      {sub ? (
        <T variant="small" numberOfLines={1}>
          {sub}
        </T>
      ) : null}
    </View>
  );
}

function periodLabel(b: Bill): string {
  if (b.start.slice(8) === '01' && b.start.slice(0, 7) === b.end.slice(0, 7) && !b.open) return cap(fmtMonthLong(b.start.slice(0, 7)));
  return `${fmtDate(b.start)} – ${fmtDate(b.end)}`;
}

function BillRow({ b }: { b: Bill }) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, paddingVertical: 10 }}>
      <Pressable onPress={() => setOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
        <View style={{ flex: 1 }}>
          <T style={{ fontWeight: '600' }}>{periodLabel(b)}</T>
          <T variant="small">
            {fmtKWh(b.kwh, 0)}
            {b.open ? ' · en curso' : ''}
            {b.incomplete && !b.open ? ' · faltan datos' : ''}
          </T>
        </View>
        <T style={{ fontWeight: '800', fontSize: 18 }}>{fmtEur(b.cost.total)}</T>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={c.textSecondary} />
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

const styles = StyleSheet.create({
  split: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  miniRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  mini: { flex: 1, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10, gap: 2 },
  warn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, padding: 10, marginTop: 4 },
  offer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
});
