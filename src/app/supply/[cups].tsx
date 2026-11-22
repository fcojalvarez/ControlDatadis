import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { TabBar } from '@/components/ui';
import { BillsTab } from '@/features/bills-tab';
import { ConsumptionTab } from '@/features/consumption-tab';
import { ContractTab } from '@/features/contract-tab';
import { MaxPowerTab } from '@/features/max-power-tab';
import { useHistorySync } from '@/features/offline-data';
import { SummaryTab } from '@/features/summary-tab';
import type { SupplyRef } from '@/features/types';
import { useTheme } from '@/hooks/use-theme';

type Tab = 'resumen' | 'consumo' | 'facturas' | 'potencia' | 'contrato';

const TABS: { value: Tab; label: string }[] = [
  { value: 'resumen', label: 'Resumen' },
  { value: 'consumo', label: 'Consumo' },
  { value: 'facturas', label: 'Facturas' },
  { value: 'potencia', label: 'Potencia' },
  { value: 'contrato', label: 'Contrato' },
];

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
  const [editing, setEditing] = useState(false);

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
      <Stack.Screen
        options={{
          title: supply.address || supply.cups,
          headerRight:
            tab === 'resumen'
              ? () => (
                  <Pressable onPress={() => setEditing((v) => !v)} hitSlop={12} accessibilityLabel="Ordenar tarjetas">
                    <Ionicons name={editing ? 'checkmark' : 'reorder-four-outline'} size={24} color={editing ? c.tint : c.text} />
                  </Pressable>
                )
              : undefined,
        }}
      />
      <TabBar options={TABS} value={tab} onChange={setTab} />
      {tab === 'resumen' && <SummaryTab supply={supply} onOpen={setTab} editing={editing} onDoneEditing={() => setEditing(false)} />}
      {tab === 'consumo' && <ConsumptionTab supply={supply} />}
      {tab === 'facturas' && <BillsTab supply={supply} />}
      {tab === 'potencia' && <MaxPowerTab supply={supply} />}
      {tab === 'contrato' && <ContractTab supply={supply} />}
    </View>
  );
}
