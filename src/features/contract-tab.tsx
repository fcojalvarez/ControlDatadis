import { StyleSheet, View } from 'react-native';

import type { ContractDetail } from '@/api/datadis';
import { Card, Disclosure, Empty, KeyValue, Loading, Notice, SavedDataNotice, Screen, T } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/context/session';
import { useTheme } from '@/hooks/use-theme';
import { currentContract } from '@/lib/contracts';
import { fmtDate, fmtNum, titleCase } from '@/lib/format';

import { useContract } from './queries';
import { POINT_TYPES, type SupplyRef } from './types';

/** Número de Datadis (a veces texto con punto) con coma decimal */
const kwText = (v: unknown) => (Number.isFinite(Number(v)) ? fmtNum(Number(v), 2) : String(v));
const str = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

export function ContractTab({ supply }: { supply: SupplyRef }) {
  const c = useTheme();
  const { settings } = useSession();
  const q = useContract(supply);
  const contracts = [...(q.data?.contracts ?? [])].sort((a, b) => ((a.startDate ?? '') < (b.startDate ?? '') ? 1 : -1));
  // El vigente se elige igual que en el resto de la app; los demás van a «Contratos anteriores»
  const ct = currentContract(contracts);
  const previous = contracts.filter((x) => x !== ct);
  const kw = ct?.contractedPowerkW ?? [];
  const hasSelf = !!ct && settings.hasSolar && !!(ct.selfConsumptionTypeCode || ct.cau);
  const installed = ct?.installedCapacityKW ?? ct?.installedCapacity;

  return (
    <Screen refreshing={q.loading && !!q.data} onRefresh={q.refresh}>
      {q.loading && !q.data ? <Loading /> : null}
      <SavedDataNotice hasData={!!q.data} error={q.error} stale={q.stale} ts={q.updatedAt} onRetry={q.refresh} />
      {q.data && contracts.length === 0 ? <Empty text="La distribuidora no ha devuelto datos de contrato." /> : null}

      {/* ---------- Cabecera del contrato ---------- */}
      {ct ? (
        <Card>
          <T variant="label">Comercializadora</T>
          <T variant="subtitle">{titleCase(str(ct.marketer), 'company')}</T>
          <T variant="small">Desde {fmtDate(ct.startDate)}{ct.endDate ? ` hasta ${fmtDate(ct.endDate)}` : ''}</T>
          <View style={styles.chips}>
            {kw.length ? <Chip text={`${[...new Set(kw)].map((k) => fmtNum(k, 2)).join(' / ')} kW`} strong /> : null}
            {ct.accessFare ? <Chip text={String(ct.accessFare)} /> : null}
            {ct.modePowerControl ? <Chip text={String(ct.modePowerControl)} /> : null}
          </View>
        </Card>
      ) : null}

      {/* ---------- Potencia y tarifa ---------- */}
      {ct ? (
        <Card
          title="Potencia y tarifa"
          info="Potencia contratada: lo máximo que puedes tener encendido a la vez. P1 se aplica de lunes a viernes de 8 a 24 h y P2 en valle.\n\nBIE: potencia máxima admisible de tu instalación (el límite técnico).\n\nControl de potencia: ICP es el limitador que corta; con maxímetro se factura el exceso.">
          <KeyValue k="Potencia P1 / P2" v={kw.length ? kw.map((k) => fmtNum(k, 2)).join(' / ') + ' kW' : '—'} />
          <KeyValue k="Máxima admisible (BIE)" v={ct.maxPowerInstall ? `${kwText(ct.maxPowerInstall)} kW` : '—'} />
          <KeyValue k="Tarifa de acceso" v={`${str(ct.accessFare)}${ct.codeFare ? ` (${ct.codeFare})` : ''}`} />
          <KeyValue k="Discriminación" v={titleCase(str(ct.timeDiscrimination), 'sentence')} />
          <KeyValue k="Tensión" v={titleCase(str(ct.tension), 'sentence')} />
          <KeyValue k="Control de potencia" v={str(ct.modePowerControl)} />
        </Card>
      ) : null}

      {/* ---------- Punto de suministro ---------- */}
      <Card
        title="Punto de suministro"
        info="El CUPS es el código único de tu punto de luz: lo necesitas para cambiar de comercializadora o hacer cualquier gestión.\n\nLa distribuidora es la dueña de la red y del contador; no cambia aunque cambies de compañía.">
        <KeyValue k="CUPS" v={supply.cups} />
        <KeyValue k="Dirección" v={str(supply.address)} />
        {ct ? <KeyValue k="Ubicación" v={[ct.postalCode, ct.municipality].filter(Boolean).map((x) => titleCase(String(x))).join(' · ') || '—'} /> : null}
        <KeyValue k="Distribuidora" v={titleCase(str(supply.distributor), 'company')} />
        <KeyValue k="Contador" v={POINT_TYPES[supply.pointType] ?? String(supply.pointType)} />
      </Card>

      {/* ---------- Autoconsumo ---------- */}
      {hasSelf && ct ? (
        <Card
          title="Autoconsumo"
          info="Datos de tu instalación registrados por la distribuidora. El CAU es el código de la instalación y el coeficiente de reparto, la parte de la generación que te corresponde en autoconsumos compartidos.">
          <KeyValue k="Modalidad" v={titleCase(str(ct.selfConsumptionTypeDesc), 'sentence')} />
          <KeyValue k="Potencia instalada" v={installed !== null && installed !== undefined && installed !== '' ? `${kwText(installed)} kW` : '—'} />
          <KeyValue k="CAU" v={str(ct.cau)} />
          <KeyValue k="Coeficiente de reparto" v={str(ct.partitionCoefficient)} />
        </Card>
      ) : null}

      {/* ---------- Historial ---------- */}
      {ct ? (
        <Card title="Historial">
          <KeyValue k="Último cambio de comercializadora" v={fmtDate(ct.lastMarketerDate)} />
          <KeyValue k="Datos en Datadis desde" v={fmtDate(supply.validDateFrom)} />
          {ct.dateOwner?.length ? (
            <KeyValue k="Titular" v={ct.dateOwner.map((o) => `${fmtDate(o.startDate)} → ${o.endDate ? fmtDate(o.endDate) : 'hoy'}`).join('\n')} />
          ) : null}
          {previous.length ? (
            <Disclosure title={`Contratos anteriores (${previous.length})`}>
              {previous.map((p, i) => (
                <PreviousContract key={i} ct={p} />
              ))}
            </Disclosure>
          ) : null}
        </Card>
      ) : null}

      {q.data?.errors.length ? (
        <Notice tone="warning">
          {q.data.errors.map((e, i) => (
            <T key={i} variant="small" style={{ color: c.text }}>
              {e.distributorName ?? e.distributorCode}: {e.errorDescription ?? e.errorCode}
            </T>
          ))}
        </Notice>
      ) : null}
    </Screen>
  );
}

function Chip({ text, strong }: { text: string; strong?: boolean }) {
  const c = useTheme();
  return (
    <View style={[styles.chip, { backgroundColor: strong ? c.tint : c.backgroundElement }]}>
      <T variant="small" style={{ fontWeight: '700', color: strong ? c.tintText : c.text }}>
        {text}
      </T>
    </View>
  );
}

function PreviousContract({ ct }: { ct: ContractDetail }) {
  return (
    <KeyValue
      k={`${fmtDate(ct.startDate)} → ${fmtDate(ct.endDate)}`}
      hint={titleCase(str(ct.marketer), 'company')}
      v={ct.contractedPowerkW?.length ? `${ct.contractedPowerkW.map((k) => fmtNum(k, 2)).join(' / ')} kW` : '—'}
    />
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two },
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
});
