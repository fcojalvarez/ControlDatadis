import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, KeyValue, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/context/session';
import { useTheme } from '@/hooks/use-theme';
import { DEFAULT_PRICES, type Prices } from '@/lib/consumption';
import { fmtNum } from '@/lib/format';
import { cacheClear, cacheStats } from '@/lib/storage';

function NumField({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (n: number) => void;
}) {
  const c = useTheme();
  const [text, setText] = useState(String(value).replace('.', ','));
  return (
    <View style={[styles.field, { borderBottomColor: c.border }]}>
      <T style={{ flex: 1 }}>{label}</T>
      <TextInput
        value={text}
        onChangeText={(t) => {
          setText(t);
          const n = Number(t.replace(',', '.'));
          if (!Number.isNaN(n)) onChange(n);
        }}
        keyboardType="decimal-pad"
        style={[styles.numInput, { color: c.text, backgroundColor: c.backgroundElement }]}
      />
      <T variant="small" style={{ width: 62 }}>
        {unit}
      </T>
    </View>
  );
}

export default function SettingsScreen() {
  const c = useTheme();
  const { settings, updateSettings, signOut, username } = useSession();
  const [prices, setPrices] = useState<Prices>(settings.prices);
  const [newNif, setNewNif] = useState('');
  const [formKey, setFormKey] = useState(0);
  const [stats, setStats] = useState(() => cacheStats());

  const setP = (patch: Partial<Prices>) => {
    const next = { ...prices, ...patch };
    setPrices(next);
    updateSettings({ prices: next });
  };

  const addNif = () => {
    const n = newNif.trim().toUpperCase();
    if (!n) return;
    if (!settings.authorizedNifs.includes(n)) updateSettings({ authorizedNifs: [...settings.authorizedNifs, n] });
    setNewNif('');
  };

  const removeNif = (n: string) =>
    updateSettings({
      authorizedNifs: settings.authorizedNifs.filter((x) => x !== n),
      activeNif: settings.activeNif === n ? null : settings.activeNif,
    });

  return (
    <Screen>
      <Card title="Cuenta">
        <KeyValue k="Usuario Datadis" v={username ?? '—'} />
        <Button
          title="Cerrar sesión"
          variant="danger"
          onPress={() =>
            Alert.alert('Cerrar sesión', 'Se borrará tu contraseña de este dispositivo. Los datos descargados se conservan; puedes borrarlos abajo en «Datos guardados».', [
              { text: 'Cancelar', style: 'cancel' },
              { text: 'Cerrar sesión', style: 'destructive', onPress: signOut },
            ])
          }
        />
      </Card>

      <Card title="NIF autorizados">
        <T variant="small">
          Si otra persona te ha autorizado en Datadis a consultar sus suministros, añade aquí su NIF para cambiar entre
          cuentas desde la pantalla principal.
        </T>
        {settings.authorizedNifs.map((n) => (
          <KeyValue
            key={n}
            k={n}
            v={
              <Pressable onPress={() => removeNif(n)} hitSlop={8}>
                <T style={{ color: c.danger }}>Quitar</T>
              </Pressable>
            }
          />
        ))}
        <View style={{ flexDirection: 'row', gap: Spacing.two }}>
          <TextInput
            value={newNif}
            onChangeText={setNewNif}
            placeholder="NIF autorizado"
            placeholderTextColor={c.textSecondary}
            autoCapitalize="characters"
            autoCorrect={false}
            style={[styles.textInput, { color: c.text, borderColor: c.border, backgroundColor: c.backgroundElement }]}
            onSubmitEditing={addNif}
          />
          <Button title="Añadir" onPress={addNif} />
        </View>
      </Card>

      <Card title="Precios para estimar el coste" key={formKey}>
        <T variant="small">Pon los precios de tu factura (sin impuestos). Se usan para calcular el coste estimado.</T>
        <T variant="label" style={{ marginTop: Spacing.two }}>
          Energía
        </T>
        <NumField label="P1 Punta" unit="€/kWh" value={prices.energy.P1} onChange={(n) => setP({ energy: { ...prices.energy, P1: n } })} />
        <NumField label="P2 Llano" unit="€/kWh" value={prices.energy.P2} onChange={(n) => setP({ energy: { ...prices.energy, P2: n } })} />
        <NumField label="P3 Valle" unit="€/kWh" value={prices.energy.P3} onChange={(n) => setP({ energy: { ...prices.energy, P3: n } })} />
        <T variant="label" style={{ marginTop: Spacing.two }}>
          Potencia
        </T>
        <NumField label="P1 Punta" unit="€/kW·día" value={prices.powerP1} onChange={(n) => setP({ powerP1: n })} />
        <NumField label="P2 Valle" unit="€/kW·día" value={prices.powerP2} onChange={(n) => setP({ powerP2: n })} />
        <T variant="label" style={{ marginTop: Spacing.two }}>
          Otros
        </T>
        <NumField label="Compensación excedentes" unit="€/kWh" value={prices.surplus} onChange={(n) => setP({ surplus: n })} />
        <NumField label="Impuesto eléctrico" unit="%" value={prices.electricityTax} onChange={(n) => setP({ electricityTax: n })} />
        <NumField label="IVA" unit="%" value={prices.vat} onChange={(n) => setP({ vat: n })} />
        <NumField label="Alquiler contador" unit="€/día" value={prices.meterRental} onChange={(n) => setP({ meterRental: n })} />
        <Button
          title="Restablecer valores por defecto"
          variant="secondary"
          onPress={() => {
            setPrices(DEFAULT_PRICES);
            updateSettings({ prices: DEFAULT_PRICES });
            setFormKey((k) => k + 1);
          }}
        />
      </Card>

      <Card title="Datos guardados">
        <T variant="small">
          Todo lo que se descarga de Datadis se guarda en el móvil y no se borra nunca automáticamente: si Datadis falla o va
          lento, la app sigue mostrando los datos guardados. Los meses cerrados se vuelven a consultar como mucho una vez al
          mes y el mes en curso cada 6 horas. Desliza hacia abajo en cualquier pantalla para forzar una actualización.
        </T>
        <KeyValue k="Datos guardados" v={stats.files ? `${stats.files} archivos · ${fmtNum(stats.bytes / 1024 / 1024, 1)} MB` : 'Ninguno todavía'} />
        <Button
          title="Borrar datos guardados"
          variant="danger"
          onPress={() =>
            Alert.alert('Borrar datos guardados', 'Se borrará todo lo descargado de Datadis. Tendrás que volver a descargarlo, y si Datadis no responde no verás datos.', [
              { text: 'Cancelar', style: 'cancel' },
              {
                text: 'Borrar',
                style: 'destructive',
                onPress: async () => {
                  await cacheClear();
                  setStats(cacheStats());
                },
              },
            ])
          }
        />
      </Card>

      <Card title="Acerca de">
        <T variant="small">
          App no oficial. Usa la API privada gratuita de Datadis (datadis.es), la plataforma de las distribuidoras
          eléctricas españolas. Los datos provienen de tu distribuidora y pueden tardar 1-2 días en aparecer.
        </T>
        <Pressable onPress={() => Linking.openURL('https://datadis.es')}>
          <T style={{ color: c.tint }}>datadis.es</T>
        </Pressable>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  numInput: { width: 90, textAlign: 'right', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, fontSize: 15 },
  textInput: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 15 },
});
