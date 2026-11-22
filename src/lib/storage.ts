import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// ---------- Credenciales (almacenamiento cifrado del sistema) ----------

const CREDS_KEY = 'datadis_credentials';

export type Credentials = { username: string; password: string };

export async function saveCredentials(c: Credentials) {
  const v = JSON.stringify(c);
  if (Platform.OS === 'web') return AsyncStorage.setItem(CREDS_KEY, v);
  await SecureStore.setItemAsync(CREDS_KEY, v);
}

export async function loadCredentials(): Promise<Credentials | null> {
  try {
    const v = Platform.OS === 'web' ? await AsyncStorage.getItem(CREDS_KEY) : await SecureStore.getItemAsync(CREDS_KEY);
    return v ? (JSON.parse(v) as Credentials) : null;
  } catch {
    return null;
  }
}

export async function clearCredentials() {
  if (Platform.OS === 'web') return AsyncStorage.removeItem(CREDS_KEY);
  await SecureStore.deleteItemAsync(CREDS_KEY);
}

// ---------- Preferencias ----------

export async function getJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const v = await AsyncStorage.getItem(key);
    return v ? ({ ...fallback, ...JSON.parse(v) } as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function setJSON(key: string, value: unknown) {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

// ---------- Caché de respuestas ----------
// Datadis limita las consultas repetidas, así que guardamos las respuestas en el dispositivo.

const CACHE_PREFIX = 'cache:';

type CacheEntry<T> = { ts: number; data: T };

export async function cacheGet<T>(key: string): Promise<CacheEntry<T> | null> {
  try {
    const v = await AsyncStorage.getItem(CACHE_PREFIX + key);
    return v ? (JSON.parse(v) as CacheEntry<T>) : null;
  } catch {
    return null;
  }
}

export async function cacheSet<T>(key: string, data: T) {
  try {
    await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // si no cabe en caché, simplemente no se cachea
  }
}

export async function cacheClear() {
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(CACHE_PREFIX)));
}
