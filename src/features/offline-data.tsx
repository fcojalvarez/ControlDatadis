import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ProgressBar } from '@/components/bar-chart';
import { BottomSheet } from '@/components/select';
import { Card, KeyValue, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { MONTHS_SHORT, cap, fmtMonthLong, pad2 } from '@/lib/format';

import { addMonths, monthRange, useConsumptionMonths, type MonthState } from './consumption-data';
import { PRIORITY } from './consumption-sync';
import { supplyBounds } from './period';
import type { SupplyRef } from './types';

/** Meses de histórico que se intentan guardar como máximo */
const MAX_HISTORY_MONTHS = 24; // Datadis no deja consultar más de 2 años atrás

function historyMonths(supply: SupplyRef) {
  const bounds = supplyBounds(supply);
  const from = addMonths(bounds.max, -(MAX_HISTORY_MONTHS - 1));
  return monthRange(from > bounds.min ? from : bounds.min, bounds.max);
}

/**
 * Descarga en segundo plano todo el histórico disponible (mes a mes, con prioridad baja: lo que
 * se ve en pantalla siempre va antes). Se usa en la pantalla del suministro.
 */
export function useHistorySync(supply: SupplyRef) {
  const months = useMemo(() => historyMonths(supply), [supply]);
  return useConsumptionMonths(supply, months, 0, PRIORITY.HISTORY);
}

/** Cuándo: «a las 10:45», «mañana a las 10:45» o «el 25 nov a las 10:45» */
function whenText(t: number): string {
  const d = new Date(t);
  const hm = `a las ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return hm;
  if (d.toDateString() === tomorrow.toDateString()) return `mañana ${hm}`;
  return `el ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${hm}`;
}


function minutesLeft(t: number): string {
  const m = Math.max(1, Math.round((t - Date.now()) / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${pad2(m % 60)} min`;
}

/** Estado del histórico guardado en el móvil, con el detalle de qué falta */
export function OfflineDataCard({ supply }: { supply: SupplyRef }) {
  const c = useTheme();
  const h = useHistorySync(supply);
  const [open, setOpen] = useState(false);
  const missing = h.total - h.done;
  const waiting = h.status.filter((x) => x.state === 'blocked' || x.state === 'error');
  const finished = missing === 0;
  const info =
    'El histórico se descarga solo, mes a mes, mientras tienes abierto un suministro. Cada mes se guarda en el móvil nada más llegar y se puede consultar aunque Datadis no funcione.\n\n' +
    'Datadis no deja repetir la misma consulta en 24 horas: si rechaza un mes, ese mes espera a su hora y los demás siguen descargándose.';

  return (
    <Card
      title="Histórico en el móvil"
      info={info}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name={finished ? 'cloud-done-outline' : 'cloud-download-outline'} size={18} color={finished ? c.p3 : c.tint} />
          <T style={{ fontWeight: '700' }}>
            {h.done}/{h.total}
          </T>
        </View>
      }>
      {!finished ? (
        <>
          <ProgressBar value={h.done} max={h.total} color={c.tint} />
          <T variant="small">
            Faltan {missing} {missing === 1 ? 'mes' : 'meses'}
            {h.next ? (
              <>
                {' · siguiente: '}
                <T variant="small" style={{ color: c.text, fontWeight: '700' }}>
                  {fmtMonthLong(h.next)}
                </T>
              </>
            ) : null}
            {waiting.length ? ` · ${waiting.length} a la espera` : ''}
          </T>
        </>
      ) : null}
      <PauseBox pause={h.pause} />
      <Pressable onPress={() => setOpen(true)} hitSlop={6} accessibilityRole="button">
        <T style={{ color: c.tint, fontWeight: '700' }}>{finished ? 'Ver meses guardados ›' : 'Ver qué falta ›'}</T>
      </Pressable>

      <BottomSheet visible={open} onClose={() => setOpen(false)} title="Descarga de datos">
        <View style={{ gap: Spacing.two }}>
          <PauseBox pause={h.pause} long />
          <View>
            <KeyValueColored label="Guardados" value={`${h.done} de ${h.total} meses`} />
            {h.status.some((x) => x.state === 'running') ? (
              <KeyValueColored label="Descargando" value={h.next ? fmtMonthLong(h.next) : '—'} />
            ) : (
              <KeyValueColored label="Siguiente" value={h.next ? fmtMonthLong(h.next) : '—'} />
            )}
            {waiting.length ? (
              <KeyValueColored
                label="A la espera"
                value={`${waiting.length} · la primera ${whenText(Math.min(...waiting.map((x) => ('at' in x ? x.at : 0))))}`}
                color={c.warning}
              />
            ) : null}
          </View>
          <MonthGrid status={h.status} />
          {waiting.length ? (
            <View style={{ gap: 4 }}>
              {waiting.map((x) =>
                'at' in x ? (
                  <T key={x.month} variant="small">
                    <T variant="small" style={{ fontWeight: '700', color: c.text }}>
                      {cap(fmtMonthLong(x.month))}:
                    </T>{' '}
                    {x.state === 'blocked' ? 'Datadis no deja repetir la consulta todavía' : (x.message ?? 'falló la descarga').replace(/\.$/, '')}. Se reintenta {whenText(x.at)}.
                  </T>
                ) : null,
              )}
            </View>
          ) : null}
        </View>
      </BottomSheet>
    </Card>
  );
}

function PauseBox({ pause, long }: { pause: { until: number; kind: 'limit' | 'down' } | null; long?: boolean }) {
  const c = useTheme();
  if (!pause) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 8, backgroundColor: `${c.warning}22`, borderRadius: 10, padding: 10 }}>
      <Ionicons name="pause-circle-outline" size={18} color={c.warning} />
      <T variant="small" style={{ flex: 1, color: c.text }}>
        {pause.kind === 'limit' ? 'Datadis ha pedido una pausa' : 'Datadis no responde'}. Sigue solo{' '}
        <T variant="small" style={{ fontWeight: '700', color: c.text }}>
          {whenText(pause.until)}
        </T>{' '}
        (en {minutesLeft(pause.until)}).
        {long && pause.kind === 'limit' ? ' Lo descargado ya está guardado y no se pierde.' : ''}
      </T>
    </View>
  );
}


/** Rejilla de meses por año con colores según su estado */
function MonthGrid({ status }: { status: MonthState[] }) {
  const c = useTheme();
  const byMonth = new Map(status.map((x) => [x.month, x]));
  const years = [...new Set(status.map((x) => x.month.slice(0, 4)))].sort().reverse();
  const look = (st?: MonthState['state']) => {
    switch (st) {
      case 'saved':
        return { bg: `${c.p3}26`, fg: c.p3, border: 'transparent' };
      case 'empty':
        return { bg: 'transparent', fg: c.textSecondary, border: c.border };
      case 'running':
        return { bg: `${c.surplus}26`, fg: c.surplus, border: c.surplus };
      case 'blocked':
        return { bg: `${c.warning}26`, fg: c.warning, border: 'transparent' };
      case 'error':
        return { bg: `${c.danger}22`, fg: c.danger, border: 'transparent' };
      case 'pending':
        return { bg: c.backgroundElement, fg: c.textSecondary, border: 'transparent' };
      default:
        return { bg: 'transparent', fg: c.border, border: 'transparent' };
    }
  };
  const legend: { st: MonthState['state']; label: string }[] = [
    { st: 'saved', label: 'Guardado' },
    { st: 'running', label: 'Descargando' },
    { st: 'pending', label: 'Pendiente' },
    { st: 'blocked', label: 'Espera a Datadis' },
    { st: 'error', label: 'Error' },
    { st: 'empty', label: 'Sin consumo' },
  ];
  const present = new Set(status.map((x) => x.state));
  return (
    <View style={{ gap: 6 }}>
      {years.map((y) => (
        <View key={y} style={{ gap: 6 }}>
          <T variant="small" style={{ fontWeight: '700' }}>
            {y}
          </T>
          <View style={styles.grid}>
            {MONTHS_SHORT.map((name, i) => {
              const x = byMonth.get(`${y}-${pad2(i + 1)}`);
              const l = look(x?.state);
              return (
                <View key={name} style={[styles.cell, { backgroundColor: l.bg, borderColor: l.border, borderStyle: x?.state === 'empty' ? 'dashed' : 'solid' }]}>
                  <T style={{ fontSize: 12, fontWeight: '600', color: l.fg }}>{name}</T>
                </View>
              );
            })}
          </View>
        </View>
      ))}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4, marginTop: 4 }}>
        {legend
          .filter((g) => present.has(g.st))
          .map((g) => {
            const l = look(g.st);
            return (
              <View key={g.st} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: g.st === 'empty' ? 'transparent' : l.fg, borderWidth: g.st === 'empty' ? 1 : 0, borderColor: c.textSecondary }} />
                <T variant="small">{g.label}</T>
              </View>
            );
          })}
      </View>
    </View>
  );
}

/** Fila de dato con el valor en color opcional */
function KeyValueColored({ label, value, color }: { label: string; value: string; color?: string }) {
  return <KeyValue k={label} v={<T style={{ fontWeight: '700', color }}>{value}</T>} />;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cell: { width: '14.6%', flexGrow: 1, borderRadius: 8, paddingVertical: 6, alignItems: 'center', borderWidth: 1 },
});
