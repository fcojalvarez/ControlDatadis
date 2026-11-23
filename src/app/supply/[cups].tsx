import { useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { DemoBanner } from '@/components/demo-banner';
import { BottomTabs } from '@/components/ui';
import { BillsTab } from '@/features/bills-tab';
import { ConsumptionTab } from '@/features/consumption-tab';
import { ContractTab } from '@/features/contract-tab';
import { MaxPowerTab } from '@/features/max-power-tab';
import { useHistorySync } from '@/features/offline-data';
import { SummaryTab } from '@/features/summary-tab';
import type { SupplyRef } from '@/features/types';
import { useTheme } from '@/hooks/use-theme';

type Tab = 'resumen' | 'consumo' | 'facturas' | 'potencia' | 'contrato';

const TABS = [
  { value: 'resumen', label: 'Resumen', icon: 'home-outline', iconActive: 'home' },
  { value: 'consumo', label: 'Consumo', icon: 'bar-chart-outline', iconActive: 'bar-chart' },
  { value: 'facturas', label: 'Facturas', icon: 'receipt-outline', iconActive: 'receipt' },
  { value: 'potencia', label: 'Potencia', icon: 'flash-outline', iconActive: 'flash' },
  { value: 'contrato', label: 'Contrato', icon: 'document-text-outline', iconActive: 'document-text' },
] as const satisfies { value: Tab; label: string; icon: string; iconActive: string }[];

export default function SupplyScreen() {
  const c = useTheme();
  const p = useLocalSearchParams<{
    cups: string;
    distributorCode: string;
    pointType: string;
    address?: string;
    distributor?: string;
    validDateFrom?: string;
    validDateTo?: string;
  }>();
  const [tab, setTab] = useState<Tab>('resumen');

  const supply: SupplyRef = useMemo(
    () => ({
      cups: p.cups,
      distributorCode: p.distributorCode,
      pointType: Number(p.pointType) || 5,
      address: p.address ?? '',
      distributor: p.distributor ?? '',
      validDateFrom: p.validDateFrom ?? '',
      validDateTo: p.validDateTo ?? '',
    }),
    [p.cups, p.distributorCode, p.pointType, p.address, p.distributor, p.validDateFrom, p.validDateTo],
  );

  // El histórico se va descargando en segundo plano mientras se usa el suministro
  useHistorySync(supply);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen options={{ title: supply.address || supply.cups }} />
      <DemoBanner />
      {tab === 'resumen' && <SummaryTab supply={supply} onOpen={setTab} />}
      {tab === 'consumo' && <ConsumptionTab supply={supply} />}
      {tab === 'facturas' && <BillsTab supply={supply} />}
      {tab === 'potencia' && <MaxPowerTab supply={supply} />}
      {tab === 'contrato' && <ContractTab supply={supply} />}
      <BottomTabs options={[...TABS]} value={tab} onChange={setTab} />
    </View>
  );
}
