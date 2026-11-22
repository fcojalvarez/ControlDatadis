import type { ContractDetail } from '@/api/datadis';
import { Card, Empty, SavedDataNotice, KeyValue, Loading, Notice, Screen, T, UpdatedAt } from '@/components/ui';
import { fmtDate, fmtNum } from '@/lib/format';

import { useContract } from './queries';
import { POINT_TYPES, type SupplyRef } from './types';

const str = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

export function ContractTab({ supply }: { supply: SupplyRef }) {
  const q = useContract(supply);
  const contracts = [...(q.data?.contracts ?? [])].sort((a, b) => ((a.startDate ?? '') < (b.startDate ?? '') ? 1 : -1));
  const [current, ...previous] = contracts;

  return (
    <Screen refreshing={q.loading && !!q.data} onRefresh={q.refresh}>
      <Card title="Punto de suministro" info="El CUPS es el código único de tu punto de luz. Lo necesitas para cambiar de comercializadora o hacer cualquier gestión.">
        <KeyValue k="CUPS" v={supply.cups} />
        <KeyValue k="Dirección" v={str(supply.address)} />
        <KeyValue k="Distribuidora" hint="Dueña de la red y del contador; no cambia aunque cambies de compañía" v={`${str(supply.distributor)} (código ${supply.distributorCode})`} />
        <KeyValue k="Tipo de punto de medida" v={POINT_TYPES[supply.pointType] ?? String(supply.pointType)} />
        <KeyValue k="Datos en Datadis desde" v={fmtDate(supply.validDateFrom)} />
        {supply.validDateTo ? <KeyValue k="Datos hasta" v={fmtDate(supply.validDateTo)} /> : null}
      </Card>

      {q.loading && !q.data ? <Loading /> : null}
      <SavedDataNotice hasData={!!q.data} error={q.error} stale={q.stale} ts={q.updatedAt} onRetry={q.refresh} />
      {q.data && contracts.length === 0 ? <Empty text="La distribuidora no ha devuelto datos de contrato." /> : null}

      {current && <ContractCards ct={current} title="Contrato actual" />}
      {previous.map((ct, i) => (
        <ContractCards key={i} ct={ct} title={`Contrato anterior (${fmtDate(ct.startDate)} – ${fmtDate(ct.endDate)})`} compact />
      ))}

      {q.data?.errors.length ? (
        <Notice tone="warning">
          {q.data.errors.map((e, i) => (
            <T key={i} variant="small">
              {e.distributorName ?? e.distributorCode}: {e.errorDescription ?? e.errorCode}
            </T>
          ))}
        </Notice>
      ) : null}
      <UpdatedAt ts={q.updatedAt} loading={q.loading} />
    </Screen>
  );
}

function ContractCards({ ct, title, compact }: { ct: ContractDetail; title: string; compact?: boolean }) {
  const hasSelf = !!(ct.selfConsumptionTypeCode || ct.cau);
  const installed = ct.installedCapacityKW ?? ct.installedCapacity;
  return (
    <>
      <Card title={title}>
        <KeyValue k="Comercializadora" hint="La compañía que te factura" v={str(ct.marketer)} />
        <KeyValue k="Inicio del contrato" v={fmtDate(ct.startDate)} />
        <KeyValue k="Fin del contrato" v={ct.endDate ? fmtDate(ct.endDate) : 'Vigente'} />
        <KeyValue k="Último cambio de comercializadora" v={fmtDate(ct.lastMarketerDate)} />
        <KeyValue k="Ubicación" v={[ct.postalCode, ct.municipality, ct.province].filter(Boolean).join(' · ') || '—'} />
      </Card>

      <Card
        title="Potencia y tarifa"
        info="La potencia contratada es lo máximo que puedes tener encendido a la vez. P1 se aplica en punta y llano (L-V de 8 a 24 h) y P2 en valle. La potencia máxima admisible (BIE) es el límite técnico de tu instalación.">
        {ct.contractedPowerkW?.length ? (
          ct.contractedPowerkW.map((p, j) => (
            <KeyValue key={j} k={`Potencia contratada P${j + 1}`} hint={j === 0 ? 'Punta y llano' : j === 1 ? 'Valle' : undefined} v={`${fmtNum(p, 3)} kW`} />
          ))
        ) : (
          <KeyValue k="Potencia contratada" v="—" />
        )}
        <KeyValue k="Potencia máxima admisible (BIE)" v={ct.maxPowerInstall ? `${str(ct.maxPowerInstall)} kW` : '—'} />
        <KeyValue k="Tarifa de acceso" v={`${str(ct.accessFare)}${ct.codeFare ? ` (${ct.codeFare})` : ''}`} />
        <KeyValue k="Discriminación horaria" v={str(ct.timeDiscrimination)} />
        <KeyValue k="Tensión" v={str(ct.tension)} />
        <KeyValue k="Control de potencia" hint="ICP: limitador; maxímetro: se factura el exceso" v={str(ct.modePowerControl)} />
      </Card>

      {!compact && ct.dateOwner?.length ? (
        <Card title="Titularidad" subtitle="Periodos en los que eres titular del suministro">
          {ct.dateOwner.map((o, i) => (
            <KeyValue key={i} k={`Periodo ${i + 1}`} v={`${fmtDate(o.startDate)} → ${o.endDate ? fmtDate(o.endDate) : 'actualidad'}`} />
          ))}
        </Card>
      ) : null}

      {hasSelf && (
        <Card title="Autoconsumo" info="Datos de tu instalación de autoconsumo registrados por la distribuidora. El CAU es el código de la instalación y el coeficiente de reparto indica qué parte de la generación te corresponde en autoconsumos compartidos.">
          <KeyValue k="Modalidad" v={str(ct.selfConsumptionTypeDesc)} hint={ct.selfConsumptionTypeCode ? `Código ${ct.selfConsumptionTypeCode}` : undefined} />
          <KeyValue k="CAU" v={str(ct.cau)} />
          <KeyValue k="Potencia instalada" v={installed !== null && installed !== undefined && installed !== '' ? `${str(installed)} kW` : '—'} />
          <KeyValue k="Sección / subsección" v={`${str(ct.section)} / ${str(ct.subsection)}`} />
          <KeyValue k="Coeficiente de reparto" v={str(ct.partitionCoefficient)} />
        </Card>
      )}
    </>
  );
}
