import { useMemo, useState, type ReactNode } from 'react';
import { Animated, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

/** Separación vertical entre elementos (la misma que el `gap` de la pantalla) */
const GAP = 16;
/** Tiempo que hay que mantener pulsado para empezar a arrastrar */
const LONG_PRESS_MS = 350;

type Drag = { id: string; from: number; target: number; h: number };

/** Estado mutable del arrastre (alturas medidas y destino actual), fuera del render */
class DragTracker {
  private heights = new Map<string, number>();
  target = -1;
  h = 0;
  setHeight(id: string, h: number) {
    this.heights.set(id, h);
  }
  height(id: string) {
    return this.heights.get(id) ?? 0;
  }
  begin(index: number, h: number) {
    this.target = index;
    this.h = h;
  }
  setTarget(t: number) {
    this.target = t;
  }
}

/**
 * Lista de tarjetas que se reordena manteniendo pulsada una tarjeta y arrastrándola.
 * El arrastre solo empieza tras una pulsación larga, así que el scroll normal y los toques
 * sobre las tarjetas siguen funcionando.
 */
export function SortableList<K extends string>({
  ids,
  renderItem,
  onReorder,
  onDragStateChange,
}: {
  ids: K[];
  renderItem: (id: K) => ReactNode;
  onReorder: (next: K[]) => void;
  onDragStateChange?: (dragging: boolean) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dragY] = useState(() => new Animated.Value(0));
  /** Altura de cada elemento (se mide al pintarlo) */
  const [tracker] = useState(() => new DragTracker());

  const onLayout = (id: string) => (e: LayoutChangeEvent) => {
    tracker.setHeight(id, e.nativeEvent.layout.height);
  };

  const gestures = useMemo(
    () =>
      ids.map((id, index) =>
        Gesture.Pan()
          .activateAfterLongPress(LONG_PRESS_MS)
          .runOnJS(true)
          .onStart(() => {
            dragY.setValue(0);
            const h = tracker.height(id) + GAP;
            tracker.begin(index, h);
            setDrag({ id, from: index, target: index, h });
            onDragStateChange?.(true);
          })
          .onUpdate((e) => {
            dragY.setValue(e.translationY);
            // Destino: se recorren los elementos vecinos sumando sus alturas
            let target = index;
            let dy = e.translationY;
            if (dy > 0) {
              for (let j = index + 1; j < ids.length; j++) {
                const h = tracker.height(ids[j]) + GAP;
                if (dy > h / 2) {
                  target = j;
                  dy -= h;
                } else break;
              }
            } else {
              for (let j = index - 1; j >= 0; j--) {
                const h = tracker.height(ids[j]) + GAP;
                if (-dy > h / 2) {
                  target = j;
                  dy += h;
                } else break;
              }
            }
            if (target !== tracker.target) {
              tracker.setTarget(target);
              setDrag({ id, from: index, target, h: tracker.h });
            }
          })
          .onFinalize(() => {
            const target = tracker.target;
            tracker.setTarget(-1);
            if (target >= 0 && target !== index) {
              const next = [...ids];
              const [moved] = next.splice(index, 1);
              next.splice(target, 0, moved);
              onReorder(next);
            }
            setDrag(null);
            dragY.setValue(0);
            onDragStateChange?.(false);
          }),
      ),
    [ids, onReorder, onDragStateChange, dragY, tracker],
  );

  const draggedH = drag?.h ?? 0;

  return (
    <>
      {ids.map((id, i) => {
        let offset = 0;
        if (drag && i !== drag.from) {
          if (drag.from < i && i <= drag.target) offset = -draggedH;
          else if (drag.target <= i && i < drag.from) offset = draggedH;
        }
        const active = drag?.id === id;
        return (
          <GestureDetector key={id} gesture={gestures[i]}>
            <Animated.View
              onLayout={onLayout(id)}
              style={[
                { zIndex: active ? 10 : 0 },
                active
                  ? { transform: [{ translateY: dragY }, { scale: 1.02 }], shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, elevation: 8 }
                  : { transform: [{ translateY: offset }] },
              ]}>
              <View pointerEvents={drag ? 'none' : 'auto'}>{renderItem(id)}</View>
            </Animated.View>
          </GestureDetector>
        );
      })}
    </>
  );
}
