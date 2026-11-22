import { useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { View } from 'react-native';

import { Segmented } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { ConsumptionTab } from '@/features/consumption-tab';
import { ContractTab } from '@/features/contract-tab';
import { MaxPowerTab } from '@/features/max-power-tab';
import { ReactiveTab } from '@/features/reactive-tab';
import type { SupplyRef } from '@/features/types';
import { useTheme } from '@/hooks/use-theme';

type Tab = 'consumo' | 'potencia' | 'contrato' | 'reactiva';

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
  const [tab, setTab] = useState<Tab>('consumo');

  const supply: SupplyRef = {
    cups: p.cups,
    distributorCode: p.distributorCode,
    pointType: Number(p.pointType) || 5,
    address: p.address ?? '',
    distributor: p.distributor ?? '',
    validDateFrom: p.validDateFrom ?? '',
    validDateTo: p.validDateTo ?? '',
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen options={{ title: supply.address || 'Suministro' }} />
      <View style={{ paddingHorizontal: Spacing.three, paddingTop: Spacing.two, alignItems: 'center' }}>
        <Segmented<Tab>
          style={{ width: '100%', maxWidth: 800 }}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'consumo', label: 'Consumo' },
            { value: 'potencia', label: 'Potencia' },
            { value: 'contrato', label: 'Contrato' },
            { value: 'reactiva', label: 'Reactiva' },
          ]}
        />
      </View>
      {tab === 'consumo' && <ConsumptionTab supply={supply} />}
      {tab === 'potencia' && <MaxPowerTab supply={supply} />}
      {tab === 'contrato' && <ContractTab supply={supply} />}
      {tab === 'reactiva' && <ReactiveTab supply={supply} />}
    </View>
  );
}
