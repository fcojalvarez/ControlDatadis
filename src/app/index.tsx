import { Link, router, useFocusEffect } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { DistributorError, Supply } from '@/api/datadis';
import { Card, Chips, Empty, ErrorBox, Loading, Notice, SectionTitle, T, UpdatedAt, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/context/session';
import { useContract } from '@/features/queries';
import { POINT_TYPES } from '@/features/types';
import { DAY, useCachedQuery } from '@/hooks/use-cached-query';
import { useTheme } from '@/hooks/use-theme';
import { fmtDate, fmtNum, fmtPct } from '@/lib/format';
import { getJSON } from '@/lib/storage';
import { riskLevel } from '@/lib/trip-risk';
import { riskStorageKey } from '@/features/trip-risk';

function isActive(s: Supply) {
  if (!s.validDateTo) return true;
  const [y, m, d] = s.validDateTo.split('/').map(Number);
  return new Date(y, m - 1, d) >= new Date();
}

export default function SuppliesScreen() {
  const c = useTheme();
  const { client, settings, updateSettings, username } = useSession();
  const nif = settings.activeNif ?? undefined;

  const q = useCachedQuery<{ supplies: Supply[]; errors: DistributorError[] }>(
    `supplies:${username}:${nif ?? 'me'}`,
    () => client.getSupplies(nif),
    DAY,
  );

  const nifOptions = [{ value: '', label: 'Mis suministros' }, ...settings.authorizedNifs.map((n) => ({ value: n, label: n }))];

  const supplies = q.data?.supplies ?? [];
  const active = supplies.filter(isActive);
  const inactive = supplies.filter((s) => !isActive(s));

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable hitSlop={10} accessibilityLabel="Ajustes">
                <T style={{ color: c.tint, fontWeight: '700' }}>Ajustes</T>
              </Pressable>
            </Link>
          ),
        }}
      />
      <Screen refreshing={q.loading && !!q.data} onRefresh={q.refresh}>
        <View>
          <T variant="small">Sesión iniciada como {username}</T>
          {settings.activeNif ? <T variant="small">Viendo los suministros autorizados por {settings.activeNif}</T> : null}
        </View>
        {settings.authorizedNifs.length > 0 && (
          <Chips options={nifOptions} value={settings.activeNif ?? ''} onChange={(v) => updateSettings({ activeNif: v || null })} />
        )}

        {q.loading && !q.data ? <Loading text="Buscando tus suministros en Datadis…" /> : null}
        {q.error ? <ErrorBox message={q.error} onRetry={q.refresh} /> : null}

        {q.data && supplies.length === 0 ? (
          <Empty text="No hay suministros asociados a esta cuenta en Datadis. Si acabas de registrarte, las distribuidoras pueden tardar unos días en asociarlos." />
        ) : null}

        {active.length > 0 && <SectionTitle>{active.length === 1 ? 'Suministro activo' : `${active.length} suministros activos`}</SectionTitle>}
        {active.map((s) => (
          <SupplyCard key={`${s.cups}-${s.validDateFrom}`} s={s} active />
        ))}
        {inactive.length > 0 && <SectionTitle>{`Suministros anteriores (${inactive.length})`}</SectionTitle>}
        {inactive.map((s) => (
          <SupplyCard key={`${s.cups}-${s.validDateFrom}`} s={s} active={false} />
        ))}

        {q.data?.errors.length ? (
          <Notice tone="warning">
            <T style={{ fontWeight: '700' }}>Algunas distribuidoras no respondieron</T>
            {q.data.errors.map((e, i) => (
              <T key={i} variant="small" style={{ color: c.text }}>
                • {e.distributorName ?? e.distributorCode}: {e.errorDescription ?? e.errorCode}
              </T>
            ))}
            <T variant="small">Puede que falte algún suministro. Prueba a actualizar más tarde.</T>
          </Notice>
        ) : null}

        <UpdatedAt ts={q.updatedAt} loading={q.loading} />
      </Screen>
    </>
  );
}

function SupplyCard({ s, active }: { s: Supply; active: boolean }) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Abrir suministro ${s.address}`}
      onPress={() =>
        router.push({
          pathname: '/supply/[cups]',
          params: {
            cups: s.cups,
            distributorCode: s.distributorCode,
            pointType: String(s.pointType),
            address: s.address,
            distributor: s.distributor,
            validDateFrom: s.validDateFrom,
            validDateTo: s.validDateTo,
          },
        })
      }
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <Card style={!active && { opacity: 0.85 }}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <T variant="subtitle" numberOfLines={2}>
              {s.address || s.cups}
            </T>
            <T variant="small">{[s.postalCode, s.municipality, s.province].filter(Boolean).join(' · ')}</T>
          </View>
          <View style={[styles.badge, { backgroundColor: active ? c.tint : c.backgroundSelected }]}>
            <T variant="small" style={{ color: active ? c.tintText : c.textSecondary, fontWeight: '700' }}>
              {active ? 'Activo' : 'De baja'}
            </T>
          </View>
        </View>

        {active && <ContractLine s={s} />}
        {active && <RiskLine cups={s.cups} />}

        <View style={[styles.meta, { borderTopColor: c.border }]}>
          <Meta label="CUPS" value={s.cups} mono />
          <Meta label="Distribuidora" value={s.distributor} />
          <Meta label="Contador" value={POINT_TYPES[s.pointType] ?? `Tipo ${s.pointType}`} />
          <Meta label="Periodo" value={`${fmtDate(s.validDateFrom)} → ${s.validDateTo ? fmtDate(s.validDateTo) : 'hoy'}`} />
        </View>
        <T style={{ color: c.tint, fontWeight: '700', textAlign: 'right' }}>Ver consumo y detalles ›</T>
      </Card>
    </Pressable>
  );
}

/** Resumen del contrato (comercializadora y potencia) en la tarjeta del suministro */
function ContractLine({ s }: { s: Supply }) {
  const c = useTheme();
  const q = useContract(s);
  const ct = q.data?.contracts?.slice().sort((a, b) => ((a.startDate ?? '') < (b.startDate ?? '') ? 1 : -1))[0];
  if (!ct) return null;
  const kw = ct.contractedPowerkW ?? [];
  return (
    <View style={[styles.contract, { backgroundColor: c.backgroundElement }]}>
      <View style={{ flex: 1 }}>
        <T variant="label">Comercializadora</T>
        <T style={{ fontWeight: '600' }} numberOfLines={2}>
          {ct.marketer || '—'}
        </T>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <T variant="label">Potencia</T>
        <T style={{ fontWeight: '600' }}>{kw.length ? `${[...new Set(kw)].map((k) => fmtNum(k, 2)).join(' / ')} kW` : '—'}</T>
        {ct.accessFare ? <T variant="small">{ct.accessFare}</T> : null}
      </View>
    </View>
  );
}

/** Último riesgo de corte calculado (se calcula al abrir el suministro) */
function RiskLine({ cups }: { cups: string }) {
  const c = useTheme();
  const { username } = useSession();
  const [p, setP] = useState<number | null>(null);
  // Se relee al volver a esta pantalla (el riesgo se calcula al abrir el suministro)
  useFocusEffect(
    useCallback(() => {
      getJSON<{ p: number | null }>(riskStorageKey(username, cups), { p: null }).then((v) => setP(v.p));
    }, [username, cups]),
  );
  if (p === null) return null;
  const color = p < 0.05 ? c.p3 : p < 0.2 ? '#7CB342' : p < 0.5 ? c.p2 : p < 0.8 ? '#EF7D2F' : c.danger;
  return (
    <View style={[styles.contract, { backgroundColor: c.backgroundElement, alignItems: 'center' }]}>
      <T style={{ flex: 1, fontWeight: '600' }}>Riesgo de que salten los plomos (30 días)</T>
      <T style={{ fontWeight: '800', color, fontSize: 18 }}>
        {fmtPct(p)} · {riskLevel(p).label.toLowerCase()}
      </T>
    </View>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.metaRow}>
      <T variant="small" style={{ width: 98 }}>
        {label}
      </T>
      <T variant={mono ? 'mono' : 'small'} style={{ flex: 1, fontWeight: mono ? '400' : '500' }} selectable color={undefined}>
        {value}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  contract: { flexDirection: 'row', borderRadius: 12, padding: 12, gap: Spacing.two },
  meta: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two, gap: 4 },
  metaRow: { flexDirection: 'row', gap: Spacing.two },
});
