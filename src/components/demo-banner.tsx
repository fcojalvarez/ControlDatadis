import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/context/session';
import { useTheme } from '@/hooks/use-theme';

/** Aviso fijo mientras se usa el modo demo, con salida directa */
export function DemoBanner() {
  const c = useTheme();
  const { demo, setDemo } = useSession();
  if (!demo) return null;
  return (
    <View style={[styles.bar, { backgroundColor: c.warning }]}>
      <Ionicons name="flask-outline" size={16} color="#fff" />
      <T style={[styles.text, { flex: 1 }]} numberOfLines={1}>
        Modo demo · datos de ejemplo
      </T>
      <Pressable onPress={() => setDemo(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Salir del modo demo">
        <T style={[styles.text, { textDecorationLine: 'underline' }]}>Salir</T>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: 7 },
  text: { color: '#fff', fontWeight: '700', fontSize: 13, flex: 0 },
});
