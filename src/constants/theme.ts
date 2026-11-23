import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#11181C',
    textSecondary: '#5F6670',
    background: '#F4F6F8',
    card: '#FFFFFF',
    border: '#E2E6EA',
    backgroundElement: '#EEF1F4',
    backgroundSelected: '#DDE3E9',
    tint: '#0A7C5A',
    tintText: '#FFFFFF',
    danger: '#C62828',
    warning: '#B26A00',
    p1: '#D64545',
    p2: '#E3A21A',
    p3: '#2E9E6A',
    surplus: '#2F7DD1',
    generation: '#8E5BD6',
    grid: '#E5E8EB',
    reference: '#1E4FD8',
  },
  dark: {
    text: '#ECEDEE',
    textSecondary: '#9BA1A6',
    background: '#0E1113',
    card: '#181C1F',
    border: '#2A2F33',
    backgroundElement: '#20252A',
    backgroundSelected: '#2E3439',
    tint: '#3CC48F',
    tintText: '#0E1113',
    danger: '#EF6B6B',
    warning: '#F0B43C',
    p1: '#EF6B6B',
    p2: '#F0B43C',
    p3: '#47C389',
    surplus: '#5BA4F0',
    generation: '#B18AF0',
    grid: '#262B2F',
    reference: '#8AB4FF',
  },
} as const;

export type ThemeColors = { [K in keyof typeof Colors.light]: string };

export const Fonts = Platform.select({
  ios: { sans: 'system-ui', rounded: 'ui-rounded', mono: 'ui-monospace' },
  default: { sans: 'normal', rounded: 'normal', mono: 'monospace' },
  web: { sans: 'var(--font-display)', rounded: 'var(--font-rounded)', mono: 'var(--font-mono)' },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
} as const;

export const MaxContentWidth = 800;
