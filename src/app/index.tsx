import { Link, router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { Pressable, StyleSheet, View } from 'react-native';

import type { DistributorError, Supply } from '@/api/datadis';
import { Card, Chips, Empty, ErrorBox, Loading, Notice, T, UpdatedAt, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/context/session';
import { DAY, useCachedQuery } from '@/hooks/use-cached-query';
import { useTheme } from '@/hooks/use-theme';
import { POINT_TYPES } from '@/features/types';
import { fmtDate } from '@/lib/format';

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

  const nifOptions = [
    { value: '', label: 'Mis suministros' },
    ...settings.authorizedNifs.map((n) => ({ value: n, label: n })),
  ];

  const supplies = q.data?.supplies ?? [];
  const sorted = [...supplies].sort((a, b) => Number(isActive(b)) - Number(isActive(a)));

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable hitSlop={10}>
                <T style={{ color: c.tint, fontWeight: '600' }}>Ajustes</T>
              </Pressable>
            </Link>
          ),
        }}
      />
      <Screen refreshing={q.loading && !!q.data} onRefresh={q.refresh}>
        {settings.authorizedNifs.length > 0 && (
          <Chips
            options={nifOptions}
            value={settings.activeNif ?? ''}
            onChange={(v) => updateSettings({ activeNif: v || null })}
          />
        )}

        {q.loading && !q.data ? <Loading /> : null}
        {q.error ? <ErrorBox message={q.error} onRetry={q.refresh} /> : null}

        {q.data && supplies.length === 0 ? (
          <Empty text="No hay suministros asociados a esta cuenta en Datadis. Si acabas de registrarte, las distribuidoras pueden tardar unos días en asociarlos." />
        ) : null}

        {sorted.map((s) => {
          const active = isActive(s);
          return (
            <Pressable
              key={`${s.cups}-${s.validDateFrom}`}
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
              style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
              <Card>
                <View style={styles.headerRow}>
                  <T variant="subtitle" style={{ flex: 1 }} numberOfLines={2}>
                    {s.address || s.cups}
                  </T>
                  <View style={[styles.badge, { backgroundColor: active ? c.tint : c.backgroundSelected }]}>
                    <T variant="small" style={{ color: active ? c.tintText : c.textSecondary, fontWeight: '700' }}>
                      {active ? 'Activo' : 'Baja'}
                    </T>
                  </View>
                </View>
                <T variant="small">
                  {[s.postalCode, s.municipality, s.province].filter(Boolean).join(' · ')}
                </T>
                <T variant="mono" style={{ color: c.text }} selectable>
                  {s.cups}
                </T>
                <T variant="small">
                  {s.distributor} · {POINT_TYPES[s.pointType] ?? `Tipo ${s.pointType}`}
                </T>
                <T variant="small">
                  Desde {fmtDate(s.validDateFrom)}
                  {s.validDateTo ? ` hasta ${fmtDate(s.validDateTo)}` : ''}
                </T>
              </Card>
            </Pressable>
          );
        })}

        {q.data?.errors.length ? (
          <Notice tone="warning">
            <T variant="small" style={{ fontWeight: '700', marginBottom: Spacing.one }}>
              Algunas distribuidoras no respondieron:
            </T>
            {q.data.errors.map((e, i) => (
              <T key={i} variant="small">
                • {e.distributorName ?? e.distributorCode}: {e.errorDescription ?? e.errorCode}
              </T>
            ))}
          </Notice>
        ) : null}

        <UpdatedAt ts={q.updatedAt} loading={q.loading} />
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
});
