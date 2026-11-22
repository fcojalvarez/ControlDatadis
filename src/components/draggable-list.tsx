import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState, type ReactNode } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

const ROW_H = 56;

/**
 * Lista que se reordena arrastrando cada fila por su asa (≡).
 * Mientras se arrastra, las demás filas se desplazan para hacer hueco.
 */
export function DraggableList<K extends string>({
  items,
  renderRow,
  onReorder,
  onDragStateChange,
}: {
  items: K[];
  renderRow: (key: K) => ReactNode;
  onReorder: (next: K[]) => void;
  /** Para bloquear el scroll de la pantalla mientras se arrastra */
  onDragStateChange?: (dragging: boolean) => void;
}) {
  const c = useTheme();
  const [drag, setDrag] = useState<{ from: number; dy: number } | null>(null);
  const target = drag ? Math.max(0, Math.min(items.length - 1, drag.from + Math.round(drag.dy / ROW_H))) : -1;

  // Un manejador de arrastre por fila (se recrean si cambia el orden)
  const responders = useMemo(
    () =>
      items.map((_, index) =>
        PanResponder.create({
          onStartShouldSetPanResponder: () => true,
          onMoveShouldSetPanResponder: () => true,
          onPanResponderTerminationRequest: () => false,
          onPanResponderGrant: () => {
            onDragStateChange?.(true);
            setDrag({ from: index, dy: 0 });
          },
          onPanResponderMove: (_e, g) => setDrag({ from: index, dy: g.dy }),
          onPanResponderRelease: (_e, g) => {
            const to = Math.max(0, Math.min(items.length - 1, index + Math.round(g.dy / ROW_H)));
            if (to !== index) {
              const next = [...items];
              const [moved] = next.splice(index, 1);
              next.splice(to, 0, moved);
              onReorder(next);
            }
            setDrag(null);
            onDragStateChange?.(false);
          },
          onPanResponderTerminate: () => {
            setDrag(null);
            onDragStateChange?.(false);
          },
        }),
      ),
    [items, onReorder, onDragStateChange],
  );

  return (
    <View>
      {items.map((key, i) => {
        let offset = 0;
        if (drag) {
          if (i === drag.from) offset = drag.dy;
          else if (drag.from < i && i <= target) offset = -ROW_H;
          else if (target <= i && i < drag.from) offset = ROW_H;
        }
        const active = drag?.from === i;
        return (
          <View
            key={key}
            style={[
              styles.row,
              { borderTopColor: c.border, transform: [{ translateY: offset }], zIndex: active ? 10 : 0 },
              active && { backgroundColor: c.backgroundElement, borderRadius: 12, elevation: 4, shadowOpacity: 0.15, shadowRadius: 8 },
            ]}>
            <View {...responders[i].panHandlers} style={styles.handle} accessibilityLabel="Arrastrar para reordenar" hitSlop={8}>
              <Ionicons name="reorder-three" size={26} color={active ? c.tint : c.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>{renderRow(key)}</View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { height: ROW_H, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth },
  handle: { width: 44, height: ROW_H, alignItems: 'center', justifyContent: 'center' },
});
