import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { NumField, TextField } from '@/components/num-field';
import { Button, Card, Notice, Screen, Segmented, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useSupplyTariffs } from '@/features/tariffs';
import { useTheme } from '@/hooks/use-theme';
import { fmtDate, fmtNum } from '@/lib/format';
import { ALWAYS, defaultTariff, newId, type SupplyTariffs, type Tariff } from '@/lib/tariff';

type Editing = { list: 'history' | 'candidates'; id: string } | null;

export default function TariffScreen() {
  const c = useTheme();
  const { cups } = useLocalSearchParams<{ cups: string }>();
  const { cfg, current, save } = useSupplyTariffs(cups);
  const [editing, setEditing] = useState<Editing>({ list: 'history', id: current.id });
  const [newDate, setNewDate] = useState('');

  const update = (patch: Partial<SupplyTariffs>) => save({ ...cfg, ...patch });

  const updateTariff = (list: 'history' | 'candidates', id: string, patch: Partial<Tariff>) =>
    update({ [list]: cfg[list].map((t) => (t.id === id ? { ...t, ...patch } : t)) });

  const editingTariff = editing ? cfg[editing.list].find((t) => t.id === editing.id) : undefined;

  const addPriceChange = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      Alert.alert('Fecha no válida', 'Escribe la fecha en formato AAAA-MM-DD, por ejemplo 2026-03-01.');
      return;
    }
    const base = current;
    const t: Tariff = { ...base, energy: { ...base.energy }, id: newId(), validFrom: newDate, name: base.name };
    update({ history: [...cfg.history, t] });
    setEditing({ list: 'history', id: t.id });
    setNewDate('');
  };

  const addCandidate = () => {
    const t: Tariff = { ...defaultTariff(current, `Oferta ${cfg.candidates.length + 1}`), validFrom: ALWAYS };
    update({ candidates: [...cfg.candidates, t] });
    setEditing({ list: 'candidates', id: t.id });
  };

  const remove = (list: 'history' | 'candidates', id: string) => {
    if (list === 'history' && cfg.history.length <= 1) return;
    update({ [list]: cfg[list].filter((t) => t.id !== id) });
    setEditing({ list: 'history', id: current.id === id ? cfg.history[0].id : current.id });
  };

  const TariffRow = ({ t, list }: { t: Tariff; list: 'history' | 'candidates' }) => {
    const active = editing?.id === t.id;
    return (
      <Pressable
        onPress={() => setEditing({ list, id: t.id })}
        style={{
          padding: 12,
          borderRadius: 12,
          borderWidth: active ? 2 : 1,
          borderColor: active ? c.tint : c.border,
          backgroundColor: active ? c.backgroundElement : 'transparent',
        }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <T style={{ fontWeight: '700', flex: 1 }}>{t.name}</T>
          {list === 'history' && t.id === current.id ? (
            <T variant="small" style={{ color: c.tint, fontWeight: '700' }}>
              Vigente
            </T>
          ) : null}
        </View>
        <T variant="small">
          {list === 'history' ? (t.validFrom === ALWAYS ? 'Desde el principio · ' : `Desde el ${fmtDate(t.validFrom)} · `) : ''}
          {t.kind === 'single'
            ? `${fmtNum(t.energy.P1, 4)} €/kWh`
            : `P1 ${fmtNum(t.energy.P1, 3)} · P2 ${fmtNum(t.energy.P2, 3)} · P3 ${fmtNum(t.energy.P3, 3)} €/kWh`}
        </T>
      </Pressable>
    );
  };

  return (
    <Screen>
      <Notice>
        Datadis no informa de los precios de tu comercializadora. Cópialos de tu factura o contrato (sin impuestos) para
        calcular tus facturas y comparar ofertas.
      </Notice>

      <Card
        title="Ciclo de facturación"
        info="Las facturas de tu comercializadora no siempre van del día 1 al último del mes. Indica el día del mes en que empieza el periodo de tus facturas para que las estimaciones se parezcan a las reales.">
        <NumField
          key={`bd-${cfg.billingDay}`}
          label="Día en que empieza cada factura"
          hint="1 = meses naturales"
          unit="del mes"
          value={cfg.billingDay}
          onChange={(n) => {
            const d = Math.round(n);
            if (d >= 1 && d <= 31) update({ billingDay: d });
          }}
        />
      </Card>

      <Card title="Tu tarifa" subtitle="Si te cambiaron los precios, añade el cambio con su fecha">
        {cfg.history.map((t) => (
          <TariffRow key={t.id} t={t} list="history" />
        ))}
        <View style={{ flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <TextField label="Cambio de precios desde" value={newDate} onChange={setNewDate} placeholder="AAAA-MM-DD" />
          </View>
          <Button title="Añadir" variant="secondary" onPress={addPriceChange} />
        </View>
      </Card>

      <Card title="Ofertas para comparar" subtitle="Añade tarifas de otras comercializadoras y mira cuánto habrías pagado">
        {cfg.candidates.length === 0 ? <T variant="small">Todavía no has añadido ninguna oferta.</T> : null}
        {cfg.candidates.map((t) => (
          <TariffRow key={t.id} t={t} list="candidates" />
        ))}
        <Button title="Añadir oferta" variant="secondary" onPress={addCandidate} />
      </Card>

      {editing && editingTariff ? (
        <TariffForm
          key={editingTariff.id}
          t={editingTariff}
          isFirst={editing.list === 'history' && editingTariff.validFrom === cfg.history[0].validFrom && editingTariff.id === cfg.history[0].id}
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
        />
      ) : null}
    </Screen>
  );
}

function TariffForm({
  t,
  isFirst,
  list,
  onChange,
  onDelete,
}: {
  t: Tariff;
  isFirst: boolean;
  list: 'history' | 'candidates';
  onChange: (patch: Partial<Tariff>) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(t.name);
  const [from, setFrom] = useState(t.validFrom === ALWAYS ? '' : t.validFrom);
  return (
    <Card title={list === 'history' ? 'Precios de tu tarifa' : 'Precios de la oferta'} subtitle="Sin impuestos, tal como aparecen en la factura">
      <TextField
        label="Nombre"
        value={name}
        onChange={(v) => {
          setName(v);
          onChange({ name: v || 'Tarifa' });
        }}
        placeholder="Ej.: Comercializadora - Tarifa"
      />
      {list === 'history' && !isFirst ? (
        <TextField
          label="Aplica desde (AAAA-MM-DD)"
          value={from}
          onChange={(v) => {
            setFrom(v);
            if (/^\d{4}-\d{2}-\d{2}$/.test(v)) onChange({ validFrom: v });
          }}
          placeholder="2026-03-01"
        />
      ) : null}
      <Segmented<Tariff['kind']>
        value={t.kind}
        onChange={(kind) => onChange(kind === 'single' ? { kind, energy: { P1: t.energy.P1, P2: t.energy.P1, P3: t.energy.P1 } } : { kind })}
        options={[
          { value: 'single', label: 'Precio único' },
          { value: 'periods', label: 'Por periodos' },
        ]}
      />
      <T variant="label" style={{ marginTop: Spacing.two }}>
        Energía
      </T>
      {t.kind === 'single' ? (
        <NumField label="Precio de la energía" unit="€/kWh" value={t.energy.P1} onChange={(n) => onChange({ energy: { P1: n, P2: n, P3: n } })} />
      ) : (
        <>
          <NumField label="P1 Punta" hint="L-V 10-14 y 18-22 h" unit="€/kWh" value={t.energy.P1} onChange={(n) => onChange({ energy: { ...t.energy, P1: n } })} />
          <NumField label="P2 Llano" hint="L-V 8-10, 14-18 y 22-24 h" unit="€/kWh" value={t.energy.P2} onChange={(n) => onChange({ energy: { ...t.energy, P2: n } })} />
          <NumField label="P3 Valle" hint="Noches, fines de semana y festivos" unit="€/kWh" value={t.energy.P3} onChange={(n) => onChange({ energy: { ...t.energy, P3: n } })} />
        </>
      )}
      <T variant="label" style={{ marginTop: Spacing.two }}>
        Potencia
      </T>
      <NumField label="P1 Punta-llano" unit="€/kW·día" value={t.powerP1} onChange={(n) => onChange({ powerP1: n })} />
      <NumField label="P2 Valle" unit="€/kW·día" value={t.powerP2} onChange={(n) => onChange({ powerP2: n })} />
      <T variant="label" style={{ marginTop: Spacing.two }}>
        Otros
      </T>
      <NumField label="Compensación de excedentes" hint="Si tienes placas" unit="€/kWh" value={t.surplus} onChange={(n) => onChange({ surplus: n })} />
      <NumField label="Descuento en energía" unit="%" value={t.discountPct} onChange={(n) => onChange({ discountPct: n })} />
      <NumField label="Servicios adicionales" hint="Mantenimiento, seguros…" unit="€/mes" value={t.extrasMonthly} onChange={(n) => onChange({ extrasMonthly: n })} />
      <NumField label="Alquiler del contador" unit="€/día" value={t.meterRental} onChange={(n) => onChange({ meterRental: n })} />
      <NumField label="Impuesto eléctrico" unit="%" value={t.electricityTax} onChange={(n) => onChange({ electricityTax: n })} />
      <NumField label="IVA" unit="%" value={t.vat} onChange={(n) => onChange({ vat: n })} />
      <T variant="small">Los cambios se guardan automáticamente.</T>
      {onDelete ? <Button title={list === 'history' ? 'Eliminar este cambio de precios' : 'Eliminar esta oferta'} variant="danger" onPress={onDelete} /> : null}
    </Card>
  );
}
