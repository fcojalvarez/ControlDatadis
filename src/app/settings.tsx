import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ReactNode } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { Card, Screen, T } from '@/components/ui';
import { UpdateCard } from '@/components/update';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/context/session';
import { SECTIONS } from '@/features/summary-tab';
import { useTheme } from '@/hooks/use-theme';
import { fmtNum } from '@/lib/format';
import { cacheClear, cacheStats } from '@/lib/storage';

export default function SettingsScreen() {
  const c = useTheme();
  const { settings, updateSettings, signOut, username, demo, setDemo } = useSession();
  const [newNif, setNewNif] = useState('');
  const [stats, setStats] = useState(() => cacheStats());

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
      {/* ---------- Modo demo ---------- */}
      <Card info="Enseña la app con datos simulados de dos viviendas (una con placas solares). Tus datos reales no se tocan: siguen guardados y se siguen descargando aparte.">
        <Item
          icon="flask-outline"
          label="Modo demo"
          sub="Ver la app con datos de ejemplo"
          right={<Switch value={demo} onValueChange={setDemo} trackColor={{ true: c.tint }} />}
        />
      </Card>

      {/* ---------- Cuenta ---------- */}
      {!demo ? (
      <Card>
        <Item icon="person-circle-outline" label={username ?? '—'} sub="Usuario de Datadis" />
        <Item
          icon="log-out-outline"
          label="Cerrar sesión"
          danger
          onPress={() =>
            Alert.alert('Cerrar sesión', 'Se borrará tu contraseña de este móvil. Los datos descargados se conservan.', [
              { text: 'Cancelar', style: 'cancel' },
              { text: 'Cerrar sesión', style: 'destructive', onPress: signOut },
            ])
          }
        />
      </Card>
      ) : null}

      {/* ---------- Instalación ---------- */}
      <Card>
        <Item
          icon="sunny-outline"
          label="Tengo placas solares"
          right={<Switch value={settings.hasSolar} onValueChange={(v) => updateSettings({ hasSolar: v })} trackColor={{ true: c.tint }} />}
        />
      </Card>

      {/* ---------- Tarjetas del Resumen ---------- */}
      <Card title="Tarjetas del Resumen" info="Elige qué tarjetas se ven en el Resumen. Para cambiar su orden, mantén pulsada una tarjeta en el Resumen y arrástrala.">
        {SECTIONS.map((sec) => {
          const visible = !settings.summaryLayout.hidden.includes(sec.id);
          return (
            <Item
              key={sec.id}
              icon={sec.icon}
              label={sec.label}
              right={
                <Switch
                  value={visible}
                  onValueChange={(v) =>
                    updateSettings({
                      summaryLayout: {
                        order: settings.summaryLayout.order,
                        hidden: v ? settings.summaryLayout.hidden.filter((x) => x !== sec.id) : [...settings.summaryLayout.hidden, sec.id],
                      },
                    })
                  }
                  trackColor={{ true: c.tint }}
                />
              }
            />
          );
        })}
      </Card>

      {/* ---------- NIF autorizados ---------- */}
      <Card title="NIF autorizados" info="Si otra persona te ha autorizado en Datadis a ver sus suministros, añade su NIF para cambiar entre cuentas desde la pantalla de inicio.">
        {settings.authorizedNifs.map((n) => (
          <Item
            key={n}
            icon="id-card-outline"
            label={n}
            right={
              <Pressable onPress={() => removeNif(n)} hitSlop={8} accessibilityLabel={`Quitar ${n}`}>
                <Ionicons name="close-circle-outline" size={22} color={c.danger} />
              </Pressable>
            }
          />
        ))}
        <View style={[styles.addRow, { borderColor: c.border, backgroundColor: c.backgroundElement }]}>
          <TextInput
            value={newNif}
            onChangeText={setNewNif}
            placeholder="Añadir NIF"
            placeholderTextColor={c.textSecondary}
            autoCapitalize="characters"
            autoCorrect={false}
            style={[styles.input, { color: c.text }]}
            onSubmitEditing={addNif}
          />
          <Pressable onPress={addNif} hitSlop={8} accessibilityLabel="Añadir NIF">
            <Ionicons name="add-circle" size={26} color={c.tint} />
          </Pressable>
        </View>
      </Card>

      {/* ---------- Datos guardados ---------- */}
      <Card
        title="Datos guardados"
        info="Todo lo que se descarga de Datadis se guarda en el móvil y no se borra solo: si Datadis falla o va lento, la app sigue mostrando lo guardado. Los meses cerrados se vuelven a consultar como mucho una vez al mes y el mes en curso una vez al día (Datadis no deja repetir la misma consulta antes de 24 h).">
        <Item icon="folder-outline" label={stats.files ? `${fmtNum(stats.bytes / 1024 / 1024, 1)} MB` : 'Ninguno todavía'} sub={stats.files ? `${stats.files} archivos` : undefined} />
        <Item
          icon="trash-outline"
          label="Borrar datos guardados"
          danger
          onPress={() =>
            Alert.alert('Borrar datos guardados', 'Se borrará todo lo descargado de Datadis y habrá que volver a descargarlo.', [
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

      <UpdateCard />

      <Pressable onPress={() => Linking.openURL('https://datadis.es')} style={styles.about}>
        <T variant="small">App no oficial · datos de datadis.es</T>
      </Pressable>
    </Screen>
  );
}

/** Fila de ajustes: icono, texto y un control o flecha a la derecha */
function Item({
  icon,
  label,
  sub,
  right,
  danger,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub?: string;
  right?: ReactNode;
  danger?: boolean;
  onPress?: () => void;
}) {
  const c = useTheme();
  const color = danger ? c.danger : c.text;
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.item, { opacity: pressed ? 0.7 : 1 }]}>
      <Ionicons name={icon} size={22} color={danger ? c.danger : c.tint} />
      <View style={{ flex: 1 }}>
        <T style={{ color, fontWeight: '600' }}>{label}</T>
        {sub ? <T variant="small">{sub}</T> : null}
      </View>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, marginTop: 4 },
  input: { flex: 1, minWidth: 0, paddingVertical: 10, fontSize: 15 },
  about: { alignItems: 'center', paddingVertical: Spacing.two },
});
