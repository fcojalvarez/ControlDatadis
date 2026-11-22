import { Card, Empty, ErrorBox, KeyValue, Loading, Notice, Screen, T, UpdatedAt } from '@/components/ui';
import { fmtDate, fmtNum } from '@/lib/format';

import { useContract } from './queries';
import { POINT_TYPES, type SupplyRef } from './types';

const str = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

export function ContractTab({ supply }: { supply: SupplyRef }) {
  const q = useContract(supply);
  const contracts = [...(q.data?.contracts ?? [])].sort((a, b) => ((a.startDate ?? '') < (b.startDate ?? '') ? 1 : -1));

  return (
    <Screen refreshing={q.loading && !!q.data} onRefresh={q.refresh}>
      <Card title="Suministro">
        <KeyValue k="CUPS" v={supply.cups} />
        <KeyValue k="Dirección" v={str(supply.address)} />
        <KeyValue k="Distribuidora" v={`${str(supply.distributor)} (${supply.distributorCode})`} />
        <KeyValue k="Tipo de punto" v={POINT_TYPES[supply.pointType] ?? String(supply.pointType)} />
        <KeyValue k="Alta en Datadis" v={fmtDate(supply.validDateFrom)} />
        {supply.validDateTo ? <KeyValue k="Baja" v={fmtDate(supply.validDateTo)} /> : null}
      </Card>

      {q.loading && !q.data ? <Loading /> : null}
      {q.error ? <ErrorBox message={q.error} onRetry={q.refresh} /> : null}
      {q.data && contracts.length === 0 ? <Empty text="La distribuidora no ha devuelto datos de contrato." /> : null}

      {contracts.map((ct, i) => {
        const hasSelf = !!(ct.selfConsumptionTypeCode || ct.cau);
        return (
          <Card key={i} title={i === 0 ? 'Contrato actual' : `Contrato anterior`}>
            <KeyValue k="Comercializadora" v={str(ct.marketer)} />
            <KeyValue
              k="Potencia contratada"
              v={ct.contractedPowerkW?.length ? ct.contractedPowerkW.map((p, j) => `P${j + 1}: ${fmtNum(p, 3)} kW`).join('\n') : '—'}
            />
            <KeyValue k="Potencia máx. instalación (BIE)" v={ct.maxPowerInstall ? `${str(ct.maxPowerInstall)} kW` : '—'} />
            <KeyValue k="Tarifa de acceso" v={`${str(ct.accessFare)}${ct.codeFare ? ` (${ct.codeFare})` : ''}`} />
            <KeyValue k="Discriminación horaria" v={str(ct.timeDiscrimination)} />
            <KeyValue k="Tensión" v={str(ct.tension)} />
            <KeyValue k="Control de potencia" v={str(ct.modePowerControl)} />
            <KeyValue k="Inicio" v={fmtDate(ct.startDate)} />
            <KeyValue k="Fin" v={ct.endDate ? fmtDate(ct.endDate) : 'Vigente'} />
            <KeyValue k="Último cambio de comercializadora" v={fmtDate(ct.lastMarketerDate)} />
            <KeyValue
              k="Ubicación"
              v={[ct.postalCode, ct.municipality, ct.province].filter(Boolean).join(' · ') || '—'}
            />
            {ct.dateOwner?.length ? (
              <KeyValue
                k="Titularidad"
                v={ct.dateOwner.map((o) => `${fmtDate(o.startDate)} → ${o.endDate ? fmtDate(o.endDate) : 'hoy'}`).join('\n')}
              />
            ) : null}
            {hasSelf && (
              <>
                <T variant="label" style={{ marginTop: 8 }}>
                  Autoconsumo
                </T>
                <KeyValue k="Tipo" v={`${str(ct.selfConsumptionTypeDesc)} (${str(ct.selfConsumptionTypeCode)})`} />
                <KeyValue k="CAU" v={str(ct.cau)} />
                <KeyValue k="Sección / subsección" v={`${str(ct.section)} / ${str(ct.subsection)}`} />
                <KeyValue k="Coef. de reparto" v={str(ct.partitionCoefficient)} />
                <KeyValue
                  k="Potencia instalada"
                  v={ct.installedCapacityKW ?? ct.installedCapacity ? `${str(ct.installedCapacityKW ?? ct.installedCapacity)} kW` : '—'}
                />
              </>
            )}
          </Card>
        );
      })}

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
