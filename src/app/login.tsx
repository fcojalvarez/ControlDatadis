import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, ErrorBox, InfoToggle, T } from '@/components/ui';
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

  const field = [styles.field, { backgroundColor: c.card, borderColor: c.border }];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
        <View style={styles.form}>
          <View style={[styles.logo, { backgroundColor: c.tint }]}>
            <Ionicons name="flash" size={38} color={c.tintText} />
          </View>
          <T variant="title" style={{ textAlign: 'center', marginBottom: Spacing.four }}>
            Control Datadis
          </T>

          <View style={field}>
            <Ionicons name="person-outline" size={20} color={c.textSecondary} />
            <TextInput
              style={[styles.input, { color: c.text }]}
              value={user}
              onChangeText={setUser}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              placeholder="NIF / NIE"
              placeholderTextColor={c.textSecondary}
              accessibilityLabel="NIF o NIE"
            />
          </View>

          <View style={field}>
            <Ionicons name="lock-closed-outline" size={20} color={c.textSecondary} />
            <TextInput
              style={[styles.input, { color: c.text }]}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoComplete="password"
              textContentType="password"
              placeholder="Contraseña de Datadis"
              placeholderTextColor={c.textSecondary}
              onSubmitEditing={submit}
              returnKeyType="go"
              accessibilityLabel="Contraseña"
            />
            <Pressable
              onPress={() => setShowPassword((s) => !s)}
              hitSlop={10}
              accessibilityLabel={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={22} color={c.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.remember}>
            <T style={{ flex: 1 }}>Recordarme</T>
            <Switch value={remember} onValueChange={setRemember} trackColor={{ true: c.tint }} />
          </View>

          {error ? <ErrorBox message={error} /> : null}

          <Button title="Entrar" onPress={submit} loading={loading} style={{ marginTop: Spacing.two }} />

          <View style={styles.footer}>
            <T variant="small" style={{ color: c.tint, fontWeight: '600' }} onPress={() => Linking.openURL('https://datadis.es/register')}>
              Crear cuenta en Datadis
            </T>
          </View>
          <InfoToggle text="Tu contraseña se guarda cifrada en el móvil y solo se envía a datadis.es. Es una app no oficial." />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: Spacing.four },
  form: { width: '100%', maxWidth: 420, alignSelf: 'center', gap: Spacing.three },
  logo: {
    width: 76,
    height: 76,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: Spacing.two,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  input: { flex: 1, paddingVertical: 15, fontSize: 16 },
  remember: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: 4 },
  footer: { alignItems: 'center', marginTop: Spacing.two },
});
