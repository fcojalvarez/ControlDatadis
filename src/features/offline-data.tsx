import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { ProgressBar } from '@/components/bar-chart';
import { Button, Card, T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { fmtMonthLong } from '@/lib/format';

import { addMonths, monthRange, useConsumptionMonths } from './consumption-data';
import { supplyBounds } from './period';
import { useMaxPower } from './queries';
import { rangeMonths, type SupplyRef } from './types';

/** Meses de histórico que se intentan descargar como máximo */
const MAX_HISTORY_MONTHS = 36;

/**
 * Descarga y guarda en el móvil todo el histórico disponible del suministro (consumo horario
 * y potencias máximas), para poder consultarlo aunque Datadis no responda.
 */
export function OfflineDataCard({ supply }: { supply: SupplyRef }) {
  const [started, setStarted] = useState(false);
  return (
    <Card
      title="Guardar todo en el móvil"
      info="Datadis suele ir lento o fallar. La app guarda en el móvil todo lo que descarga y nunca lo borra solo, así que siempre podrás ver tus datos aunque Datadis no responda. Con este botón se descarga de una vez todo el histórico disponible (hasta 3 años)."
      subtitle="Para consultar tus datos aunque Datadis no funcione">
      {started ? (
        <DownloadAll supply={supply} />
      ) : (
        <>
          <T variant="small">
            Lo que ya has consultado está guardado. Si quieres tener también el resto del histórico (hasta {MAX_HISTORY_MONTHS / 12} años), descárgalo ahora. Puede tardar varios minutos.
          </T>
          <Button title="Descargar todo el histórico" variant="secondary" onPress={() => setStarted(true)} />
        </>
      )}
    </Card>
  );
}

function DownloadAll({ supply }: { supply: SupplyRef }) {
  const c = useTheme();
  const bounds = useMemo(() => supplyBounds(supply), [supply]);
  const months = useMemo(() => {
    const from = addMonths(bounds.max, -(MAX_HISTORY_MONTHS - 1));
    return monthRange(from > bounds.min ? from : bounds.min, bounds.max);
  }, [bounds]);
  const cons = useConsumptionMonths(supply, months, 0);
  const { start, end } = useMemo(() => rangeMonths('24m', supply), [supply]);
  const maxp = useMaxPower(supply, start, end);

  const done = months.filter((k) => cons.months[k] !== undefined).length;
  const withData = months.filter((k) => (cons.months[k]?.length ?? 0) > 0);
  const finished = !cons.loading && !maxp.loading;

  return (
    <View style={{ gap: 8 }}>
      <ProgressBar value={done} max={months.length} color={finished ? c.p3 : c.tint} />
      <T variant="small">
        {finished ? 'Descarga terminada' : 'Descargando…'} · {done} de {months.length} meses revisados
      </T>
      {finished ? (
        <T variant="small" style={{ color: c.text }}>
          {withData.length
            ? `Tienes guardados ${withData.length} meses de consumo (${fmtMonthLong(withData[0])} – ${fmtMonthLong(withData[withData.length - 1])}).`
            : 'Datadis no ha devuelto datos de consumo.'}
          {cons.error ? ` Algunos meses fallaron (${cons.error}); se reintentarán la próxima vez.` : ''}
        </T>
      ) : null}
      {finished && cons.error ? <Button title="Reintentar los que fallaron" variant="secondary" onPress={cons.retry} /> : null}
    </View>
  );
}
