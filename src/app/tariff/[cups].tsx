import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { DateRangePicker } from '@/components/date-range-picker';
import { NumField, TextField } from '@/components/num-field';
import { BottomSheet, Select } from '@/components/select';
import { Button, Card, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/context/session';
import { useSupplyTariffs } from '@/features/tariffs';
import { useTheme } from '@/hooks/use-theme';
import { fmtDate, fmtNum, ymd } from '@/lib/format';
import { ALWAYS, defaultTariff, newId, type SupplyTariffs, type Tariff } from '@/lib/tariff';

type ListName = 'history' | 'candidates';
type Editing = { list: ListName; id: string } | null;

const DAY_OPTIONS = Array.from({ length: 28 }, (_, i) => ({
  value: i + 1,
  label: i === 0 ? 'Día 1 (meses naturales)' : `Día ${i + 1}`,
}));

export default function TariffScreen() {
  const c = useTheme();
  const { cups } = useLocalSearchParams<{ cups: string }>();
  const { cfg, current, save } = useSupplyTariffs(cups);
  const { settings } = useSession();
  const [editing, setEditing] = useState<Editing>(null);
  const [datePicker, setDatePicker] = useState(false);

  const update = (patch: Partial<SupplyTariffs>) => save({ ...cfg, ...patch });
  const updateTariff = (list: ListName, id: string, patch: Partial<Tariff>) =>
    update({ [list]: cfg[list].map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  const editingTariff = editing ? cfg[editing.list].find((t) => t.id === editing.id) : undefined;

  const addPriceChange = (from: string) => {
    const t: Tariff = { ...current, energy: { ...current.energy }, id: newId(), validFrom: from };
    update({ history: [...cfg.history, t] });
    setEditing({ list: 'history', id: t.id });
  };

  const addCandidate = () => {
    const t: Tariff = { ...defaultTariff(current, `Oferta ${cfg.candidates.length + 1}`), validFrom: ALWAYS };
    update({ candidates: [...cfg.candidates, t] });
    setEditing({ list: 'candidates', id: t.id });
  };

  const remove = (list: ListName, id: string) => {
    if (list === 'history' && cfg.history.length <= 1) return;
    update({ [list]: cfg[list].filter((t) => t.id !== id) });
    setEditing(null);
  };

  const today = ymd(new Date());

  return (
    <Screen>
      <Card title="Ciclo de facturación" info="Día del mes en que empieza cada factura de tu comercializadora, para que las facturas estimadas se parezcan a las reales.">
        <View style={styles.row}>
          <T style={{ flex: 1 }}>Empieza el</T>
          <Select<number> title="Día de inicio" value={cfg.billingDay} onChange={(d) => update({ billingDay: d })} options={DAY_OPTIONS} />
        </View>
      </Card>

      <Card
        title="Tu tarifa"
        info="Datadis no da los precios de tu comercializadora. Cópialos de tu factura (sin impuestos). Si te cambiaron los precios en una fecha, añade el cambio: cada día se calcula con los precios vigentes entonces."
        right={
          <Pressable onPress={() => setDatePicker(true)} hitSlop={10} accessibilityLabel="Añadir cambio de precios">
            <Ionicons name="add-circle-outline" size={24} color={c.tint} />
          </Pressable>
        }>
        {cfg.history.map((t) => (
          <TariffRow key={t.id} t={t} sub={t.validFrom === ALWAYS ? undefined : `desde ${fmtDate(t.validFrom)}`} active={t.id === current.id} onPress={() => setEditing({ list: 'history', id: t.id })} />
        ))}
      </Card>

      <Card
        title="Ofertas para comparar"
        info="Añade tarifas de otras comercializadoras: en Facturas verás cuánto habrías pagado con cada una con tu consumo real."
        right={
          <Pressable onPress={addCandidate} hitSlop={10} accessibilityLabel="Añadir oferta">
            <Ionicons name="add-circle-outline" size={24} color={c.tint} />
          </Pressable>
        }>
        {cfg.candidates.length === 0 ? <T variant="small">Toca + para añadir una.</T> : null}
        {cfg.candidates.map((t) => (
          <TariffRow key={t.id} t={t} onPress={() => setEditing({ list: 'candidates', id: t.id })} />
        ))}
      </Card>

      <DateRangePicker
        visible={datePicker}
        onClose={() => setDatePicker(false)}
        value={{ from: today, to: today }}
        limits={{ from: '2015-01-01', to: `${new Date().getFullYear() + 1}-12-31` }}
        presets={[]}
        onApply={(r) => addPriceChange(r.from)}
      />

      <BottomSheet visible={!!editingTariff} onClose={() => setEditing(null)} title={editing?.list === 'candidates' ? 'Oferta' : 'Precios de tu tarifa'}>
        {editing && editingTariff ? (
          <TariffForm
            key={editingTariff.id}
            hasSolar={settings.hasSolar}
            t={editingTariff}
            isFirst={editing.list === 'history' && editingTariff.id === cfg.history[0].id}
            list={editing.list}
            onChange={(patch) => updateTariff(editing.list, editingTariff.id, patch)}
            onDelete={
              editing.list === 'candidates' || cfg.history.length > 1
                ? () =>
                    Alert.alert('Eliminar', `¿Eliminar «${editingTariff.name}»?`, [
                      { text: 'Cancelar', style: 'cancel' },
                      { text: 'Eliminar', style: 'destructive', onPress: () => remove(editing.list, editingTariff.id) },
                    ])
                : undefined
            }
            onDone={() => setEditing(null)}
          />
        ) : null}
      </BottomSheet>
    </Screen>
  );
}

function TariffRow({ t, sub, active, onPress }: { t: Tariff; sub?: string; active?: boolean; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tariffRow, { borderTopColor: c.border, opacity: pressed ? 0.7 : 1 }]}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <T style={{ fontWeight: '700' }} numberOfLines={1}>
            {t.name}
          </T>
          {active ? <Ionicons name="checkmark-circle" size={16} color={c.tint} /> : null}
        </View>
        <T variant="small">
          {sub ? `${sub} · ` : ''}
          {t.kind === 'single' ? `${fmtNum(t.energy.P1, 3)} €/kWh` : `${fmtNum(t.energy.P1, 3)} / ${fmtNum(t.energy.P2, 3)} / ${fmtNum(t.energy.P3, 3)} €/kWh`}
        </T>
      </View>
      <Ionicons name="create-outline" size={20} color={c.textSecondary} />
    </Pressable>
  );
}

function TariffForm({
  hasSolar,
  t,
  isFirst,
  list,
  onChange,
  onDelete,
  onDone,
}: {
  hasSolar: boolean;
  t: Tariff;
  isFirst: boolean;
  list: ListName;
  onChange: (patch: Partial<Tariff>) => void;
  onDelete?: () => void;
  onDone: () => void;
}) {
  const c = useTheme();
  const [name, setName] = useState(t.name);
  const [from, setFrom] = useState(t.validFrom === ALWAYS ? '' : t.validFrom);
  return (
    <View style={{ gap: Spacing.two }}>
      <TextField
        label="Nombre"
        value={name}
        onChange={(v) => {
          setName(v);
          onChange({ name: v || 'Tarifa' });
        }}
        placeholder="Comercializadora - Tarifa"
      />
      {list === 'history' && !isFirst ? (
        <TextField
          label="Desde (AAAA-MM-DD)"
          value={from}
          onChange={(v) => {
            setFrom(v);
            if (/^\d{4}-\d{2}-\d{2}$/.test(v)) onChange({ validFrom: v });
          }}
          placeholder="2026-03-01"
        />
      ) : null}
      <View style={styles.row}>
        <T variant="label" style={{ flex: 1 }}>
          Energía
        </T>
        <Select<Tariff['kind']>
          title="Tipo de precio"
          value={t.kind}
          onChange={(kind) => onChange(kind === 'single' ? { kind, energy: { P1: t.energy.P1, P2: t.energy.P1, P3: t.energy.P1 } } : { kind })}
          options={[
            { value: 'single', label: 'Precio único', hint: 'El mismo precio a todas horas' },
            { value: 'periods', label: 'Por periodos', hint: 'Punta, llano y valle' },
          ]}
        />
      </View>
      {t.kind === 'single' ? (
        <NumField label="Precio" unit="€/kWh" value={t.energy.P1} onChange={(n) => onChange({ energy: { P1: n, P2: n, P3: n } })} />
      ) : (
        <>
          <NumField label="Punta" unit="€/kWh" value={t.energy.P1} onChange={(n) => onChange({ energy: { ...t.energy, P1: n } })} />
          <NumField label="Llano" unit="€/kWh" value={t.energy.P2} onChange={(n) => onChange({ energy: { ...t.energy, P2: n } })} />
          <NumField label="Valle" unit="€/kWh" value={t.energy.P3} onChange={(n) => onChange({ energy: { ...t.energy, P3: n } })} />
        </>
      )}
      <T variant="label" style={{ marginTop: Spacing.two }}>
        Potencia
      </T>
      <NumField label="P1" unit="€/kW·día" value={t.powerP1} onChange={(n) => onChange({ powerP1: n })} />
      <NumField label="P2" unit="€/kW·día" value={t.powerP2} onChange={(n) => onChange({ powerP2: n })} />
      <T variant="label" style={{ marginTop: Spacing.two }}>
        Otros
      </T>
      {hasSolar ? <NumField label="Excedentes" unit="€/kWh" value={t.surplus} onChange={(n) => onChange({ surplus: n })} /> : null}
      <NumField label="Descuento" unit="%" value={t.discountPct} onChange={(n) => onChange({ discountPct: n })} />
      <NumField label="Servicios" unit="€/mes" value={t.extrasMonthly} onChange={(n) => onChange({ extrasMonthly: n })} />
      <NumField label="Contador" unit="€/día" value={t.meterRental} onChange={(n) => onChange({ meterRental: n })} />
      <NumField label="Impuesto eléctrico" unit="%" value={t.electricityTax} onChange={(n) => onChange({ electricityTax: n })} />
      <NumField label="IVA" unit="%" value={t.vat} onChange={(n) => onChange({ vat: n })} />
      <Button title="Hecho" onPress={onDone} style={{ marginTop: Spacing.two }} />
      {onDelete ? (
        <T style={{ color: c.danger, textAlign: 'center', fontWeight: '600', paddingVertical: 8 }} onPress={onDelete}>
          Eliminar
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  tariffRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
