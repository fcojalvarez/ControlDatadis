import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, router, useFocusEffect } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { DistributorError, Supply } from '@/api/datadis';
import { Card, Chips, Empty, InfoToggle, Loading, SavedDataNotice, T, Screen } from '@/components/ui';
import { UpdateBanner } from '@/components/update';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/context/session';
import { useContract } from '@/features/queries';
import { riskStorageKey } from '@/features/trip-risk';
import { DAY, useCachedQuery } from '@/hooks/use-cached-query';
import { useTheme } from '@/hooks/use-theme';
import type { CompactReading } from '@/lib/consumption';
import { fmtDate, fmtNum, fmtPct, ym } from '@/lib/format';
import { cacheGet, getJSON } from '@/lib/storage';

function isActive(s: Supply) {
  if (!s.validDateTo) return true;
  const [y, m, d] = s.validDateTo.split('/').map(Number);
  return new Date(y, m - 1, d) >= new Date();
}

function openSupply(s: Supply) {
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
  });
}

export default function SuppliesScreen() {
  const c = useTheme();
  const { client, settings, updateSettings, username } = useSession();
  const nif = settings.activeNif ?? undefined;
  const [showOld, setShowOld] = useState(false);

  const q = useCachedQuery<{ supplies: Supply[]; errors: DistributorError[] }>(
    `supplies:${username}:${nif ?? 'me'}`,
    () => client.getSupplies(nif),
    DAY,
    { isEmpty: (d) => !d.supplies.length },
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
              <Pressable hitSlop={12} accessibilityLabel="Ajustes">
                <Ionicons name="settings-outline" size={24} color={c.text} />
              </Pressable>
            </Link>
          ),
        }}
      />
      <Screen refreshing={q.loading && !!q.data} onRefresh={q.refresh}>
        <UpdateBanner />
        {settings.authorizedNifs.length > 0 && (
          <Chips options={nifOptions} value={settings.activeNif ?? ''} onChange={(v) => updateSettings({ activeNif: v || null })} />
        )}

        {q.loading && !q.data ? <Loading text="Buscando tus suministros…" /> : null}
        <SavedDataNotice hasData={!!q.data} error={q.error} stale={q.stale} ts={q.updatedAt} onRetry={q.refresh} />

        {q.data && supplies.length === 0 ? (
          <Empty text="No hay suministros en tu cuenta de Datadis. Si acabas de registrarte, pueden tardar unos días en aparecer." />
        ) : null}

        {active.map((s) => (
          <SupplyCard key={`${s.cups}-${s.validDateFrom}`} s={s} />
        ))}

        {inactive.length > 0 && (
          <View>
            <Pressable onPress={() => setShowOld((v) => !v)} style={styles.oldHeader} hitSlop={6}>
              <T variant="label">Anteriores ({inactive.length})</T>
              <Ionicons name={showOld ? 'chevron-up' : 'chevron-down'} size={16} color={c.textSecondary} />
            </Pressable>
            {showOld
              ? inactive.map((s) => (
                  <Pressable key={`${s.cups}-${s.validDateFrom}`} onPress={() => openSupply(s)} style={[styles.oldRow, { borderColor: c.border, backgroundColor: c.card }]}>
                    <Ionicons name="home-outline" size={18} color={c.textSecondary} />
                    <View style={{ flex: 1 }}>
                      <T style={{ fontWeight: '600' }} numberOfLines={1}>
                        {s.address || s.cups}
                      </T>
                      <T variant="small">Hasta {fmtDate(s.validDateTo)}</T>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={c.textSecondary} />
                  </Pressable>
                ))
              : null}
          </View>
        )}

        {q.data?.errors.length ? (
          <View style={styles.warnRow}>
            <Ionicons name="warning-outline" size={18} color={c.warning} />
            <T variant="small" style={{ flex: 1 }}>
              Algunas distribuidoras no respondieron
            </T>
            <InfoToggle
              text={q.data.errors.map((e) => `${e.distributorName ?? e.distributorCode}: ${e.errorDescription ?? e.errorCode}`).join('\n') + '\n\nPuede que falte algún suministro. Prueba a actualizar más tarde.'}
            />
          </View>
        ) : null}
      </Screen>
    </>
  );
}

function SupplyCard({ s }: { s: Supply }) {
  const c = useTheme();
  const contract = useContract(s);
  const ct = contract.data?.contracts?.slice().sort((a, b) => ((a.startDate ?? '') < (b.startDate ?? '') ? 1 : -1))[0];
  const kw = ct?.contractedPowerkW ?? [];
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Abrir ${s.address}`} onPress={() => openSupply(s)} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <Card>
        <View style={styles.headerRow}>
          <View style={[styles.homeIcon, { backgroundColor: c.backgroundElement }]}>
            <Ionicons name="home" size={20} color={c.tint} />
          </View>
          <View style={{ flex: 1 }}>
            <T variant="subtitle" numberOfLines={1}>
              {s.address || s.cups}
            </T>
            <T variant="small" numberOfLines={1}>
              {[s.municipality, ct?.marketer].filter(Boolean).join(' · ')}
            </T>
          </View>
          <Ionicons name="chevron-forward" size={22} color={c.textSecondary} />
        </View>
        <View style={styles.tiles}>
          <MonthTile cups={s.cups} />
          <Tile icon="flash-outline" label="Potencia" value={kw.length ? `${fmtNum(Math.max(...kw), 2)} kW` : '—'} />
          <RiskTile cups={s.cups} />
        </View>
      </Card>
    </Pressable>
  );
}

function Tile({ icon, label, value, color }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; color?: string }) {
  const c = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: c.backgroundElement }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Ionicons name={icon} size={14} color={c.textSecondary} />
        <T variant="small" numberOfLines={1}>
          {label}
        </T>
      </View>
      <T style={{ fontSize: 17, fontWeight: '800', color: color ?? c.text }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </T>
    </View>
  );
}

/** Consumo del mes en curso (de lo guardado en el móvil) */
function MonthTile({ cups }: { cups: string }) {
  const { username, settings } = useSession();
  const [kwh, setKwh] = useState<number | null>(null);
  useFocusEffect(
    useCallback(() => {
      const key = `consm:${username}:${settings.activeNif ?? 'me'}:${cups}:0:${ym(new Date())}`;
      cacheGet<{ rows: CompactReading[] }>(key).then((e) => setKwh(e ? e.data.rows.reduce((a, r) => a + (Number(r[2]) || 0), 0) : null));
    }, [username, settings.activeNif, cups]),
  );
  return <Tile icon="speedometer-outline" label="Este mes" value={kwh === null ? '—' : `${fmtNum(kwh, 0)} kWh`} />;
}

/** Último riesgo de corte calculado (se calcula al abrir el suministro) */
function RiskTile({ cups }: { cups: string }) {
  const c = useTheme();
  const { username } = useSession();
  const [p, setP] = useState<number | null>(null);
  useFocusEffect(
    useCallback(() => {
      getJSON<{ p: number | null }>(riskStorageKey(username, cups), { p: null }).then((v) => setP(v.p));
    }, [username, cups]),
  );
  const color = p === null ? undefined : p < 0.05 ? c.p3 : p < 0.2 ? '#7CB342' : p < 0.5 ? c.p2 : p < 0.8 ? '#EF7D2F' : c.danger;
  return <Tile icon="warning-outline" label="Plomos" value={p === null ? '—' : fmtPct(p)} color={color} />;
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 4 },
  homeIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tiles: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  tile: { flex: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 10, gap: 2 },
  oldHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 4 },
  oldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 14,
    marginTop: Spacing.two,
  },
  warnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
});
