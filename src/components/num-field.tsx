import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Campo numérico con coma decimal y unidad */
export function NumField({
  label,
  hint,
  unit,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  unit: string;
  value: number;
  onChange: (n: number) => void;
}) {
  const c = useTheme();
  const [text, setText] = useState(String(value).replace('.', ','));
  return (
    <View style={[styles.field, { borderBottomColor: c.border }]}>
      <View style={{ flex: 1 }}>
        <T>{label}</T>
        {hint ? <T variant="small">{hint}</T> : null}
      </View>
      <TextInput
        value={text}
        onChangeText={(t) => {
          setText(t);
          const n = Number(t.replace(',', '.'));
          if (t.trim() !== '' && !Number.isNaN(n)) onChange(n);
        }}
        keyboardType="decimal-pad"
        selectTextOnFocus
        style={[styles.numInput, { color: c.text, backgroundColor: c.backgroundElement }]}
      />
      <T variant="small" style={{ width: 66 }}>
        {unit}
      </T>
    </View>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  const c = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <T variant="label">{label}</T>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.textSecondary}
        style={[styles.text, { color: c.text, borderColor: c.border, backgroundColor: c.backgroundElement }]}
      />
    </View>
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
  numInput: { width: 92, textAlign: 'right', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8, fontSize: 16 },
  text: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
});
