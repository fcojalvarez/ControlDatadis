import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Hoja inferior (modal) reutilizable */
export function BottomSheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Cerrar" />
      <View style={[styles.sheet, { backgroundColor: c.card, paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={[styles.handle, { backgroundColor: c.border }]} />
        <View style={styles.sheetHeader}>
          <T variant="subtitle" style={{ flex: 1 }}>
            {title}
          </T>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Cerrar">
            <Ionicons name="close" size={24} color={c.textSecondary} />
          </Pressable>
        </View>
        <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ paddingBottom: 8 }}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Selector compacto: muestra la opción elegida y al pulsar abre la lista de opciones */
export function Select<V extends string | number>({
  value,
  options,
  onChange,
  title,
  icon,
}: {
  value: V;
  options: { value: V; label: string; hint?: string }[];
  onChange: (v: V) => void;
  title: string;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${current?.label ?? ''}`}
        style={({ pressed }) => [styles.pill, { backgroundColor: c.backgroundElement, opacity: pressed ? 0.8 : 1 }]}>
        {icon ? <Ionicons name={icon} size={16} color={c.textSecondary} /> : null}
        <T style={{ fontWeight: '600', fontSize: 14 }} numberOfLines={1}>
          {current?.label ?? '—'}
        </T>
        <Ionicons name="chevron-down" size={16} color={c.textSecondary} />
      </Pressable>
      <BottomSheet visible={open} onClose={() => setOpen(false)} title={title}>
        {options.map((o) => {
          const sel = o.value === value;
          return (
            <Pressable
              key={String(o.value)}
              onPress={() => {
                onChange(o.value);
                setOpen(false);
              }}
              style={[styles.option, { borderTopColor: c.border }]}>
              <View style={{ flex: 1 }}>
                <T style={{ fontWeight: sel ? '700' : '500', color: sel ? c.tint : c.text }}>{o.label}</T>
                {o.hint ? <T variant="small">{o.hint}</T> : null}
              </View>
              {sel ? <Ionicons name="checkmark" size={22} color={c.tint} /> : null}
            </Pressable>
          );
        })}
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: Spacing.three, paddingTop: 8 },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 8 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  option: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth },
});
