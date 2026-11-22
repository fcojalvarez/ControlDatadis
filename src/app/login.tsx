import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, ErrorBox, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/context/session';
import { useTheme } from '@/hooks/use-theme';

export default function LoginScreen() {
  const c = useTheme();
  const { signIn } = useSession();
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!user.trim() || !password) {
      setError('Introduce tu NIF/NIE y la contraseña de Datadis.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await signIn(user, password, remember);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = [styles.input, { backgroundColor: c.card, borderColor: c.border, color: c.text }];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
        <View style={styles.form}>
          <View style={[styles.logo, { backgroundColor: c.tint }]}>
            <T style={{ fontSize: 34, color: c.tintText }}>⚡</T>
          </View>
          <T variant="title" style={{ textAlign: 'center' }}>
            Control Datadis
          </T>
          <T variant="small" style={{ textAlign: 'center', marginBottom: Spacing.three }}>
            Consulta tu consumo eléctrico, potencias, contrato y autoconsumo con tu cuenta de Datadis.
          </T>

          <T variant="label">NIF / NIE</T>
          <TextInput
            style={inputStyle}
            value={user}
            onChangeText={setUser}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            placeholder="12345678Z"
            placeholderTextColor={c.textSecondary}
          />

          <T variant="label">Contraseña</T>
          <View>
            <TextInput
              style={inputStyle}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoComplete="password"
              textContentType="password"
              placeholder="••••••••"
              placeholderTextColor={c.textSecondary}
              onSubmitEditing={submit}
              returnKeyType="go"
            />
            <Pressable onPress={() => setShowPassword((s) => !s)} style={styles.eye} hitSlop={10}>
              <T variant="small">{showPassword ? 'Ocultar' : 'Mostrar'}</T>
            </Pressable>
          </View>

          <View style={styles.remember}>
            <T style={{ flex: 1 }}>Recordar credenciales en este dispositivo</T>
            <Switch value={remember} onValueChange={setRemember} trackColor={{ true: c.tint }} />
          </View>

          {error ? <ErrorBox message={error} /> : null}

          <Button title="Entrar" onPress={submit} loading={loading} style={{ marginTop: Spacing.two }} />

          <T variant="small" style={{ textAlign: 'center', marginTop: Spacing.three }}>
            La contraseña se guarda cifrada en el dispositivo y solo se envía a datadis.es.{' '}
            <T variant="small" style={{ color: c.tint }} onPress={() => Linking.openURL('https://datadis.es/register')}>
              ¿No tienes cuenta? Regístrate en Datadis
            </T>
          </T>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: Spacing.four },
  form: { width: '100%', maxWidth: 420, alignSelf: 'center', gap: Spacing.two },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: Spacing.two,
  },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  eye: { position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' },
  remember: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.two, gap: Spacing.two },
});
