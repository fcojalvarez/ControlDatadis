import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { UpdateCard } from '@/components/update';
import { Button, Card, KeyValue, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/context/session';
import { useTheme } from '@/hooks/use-theme';
import { fmtNum } from '@/lib/format';
import { cacheClear, cacheStats } from '@/lib/storage';

export default function SettingsScreen() {
  const c = useTheme();
  const { settings, updateSettings, signOut, username } = useSession();
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

      <Card title="Mi instalación">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
          <T style={{ flex: 1 }}>Tengo placas solares</T>
          <Switch value={settings.hasSolar} onValueChange={(v) => updateSettings({ hasSolar: v })} trackColor={{ true: c.tint }} />
        </View>
      </Card>

      <Card title="Precios y tarifas">
        <T variant="small">
          Los precios de tu comercializadora se configuran en cada suministro: abre el suministro → pestaña Facturas →
          «Editar tarifa». Allí puedes poner tus precios, el día en que empiezan tus facturas y ofertas para comparar.
        </T>
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

      <UpdateCard />

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
