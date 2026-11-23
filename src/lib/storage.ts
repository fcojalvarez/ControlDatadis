import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
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

// ---------- Datos guardados (respuestas de Datadis) ----------
// Datadis es lento, falla a menudo y limita las consultas, así que TODO lo que se descarga se guarda
// en el móvil y nunca se borra automáticamente: si una consulta falla, se siguen mostrando los datos
// guardados. Cada respuesta va en su propio fichero dentro del almacenamiento interno de la app
// (no tiene el límite de 6 MB de AsyncStorage en Android y el sistema no lo limpia).

const CACHE_PREFIX = 'cache:';
const DATA_DIR = 'datadis-data';

export type CacheEntry<T> = { ts: number; data: T };

const useFiles = Platform.OS !== 'web';

function dataDir(): Directory {
  const dir = new Directory(Paths.document, DATA_DIR);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Nombre de fichero seguro y único para una clave */
function fileFor(key: string): File {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  const safe = key.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80);
  return new File(dataDir(), `${safe}_${h.toString(16)}.json`);
}

/**
 * Copia en memoria de lo último leído o guardado: al cambiar de pestaña no hace falta volver a
 * leer y a interpretar el fichero. Se guarda el mismo objeto, así que las conversiones que se
 * hagan sobre él (p. ej. normalizar un mes) también se reaprovechan.
 */
const MEMORY_MAX = 160;
const memory = new Map<string, CacheEntry<unknown>>();

function remember(key: string, entry: CacheEntry<unknown>) {
  memory.delete(key);
  memory.set(key, entry);
  if (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value as string);
}

export async function cacheGet<T>(key: string): Promise<CacheEntry<T> | null> {
  const mem = memory.get(key);
  if (mem) {
    remember(key, mem); // lo más usado se queda
    return mem as CacheEntry<T>;
  }
  const entry = await readEntry<T>(key);
  if (entry) remember(key, entry);
  return entry;
}

async function readEntry<T>(key: string): Promise<CacheEntry<T> | null> {
  try {
    if (useFiles) {
      const f = fileFor(key);
      if (f.exists) return JSON.parse(await f.text()) as CacheEntry<T>;
      // Migración desde versiones anteriores que guardaban en AsyncStorage
      const old = await AsyncStorage.getItem(CACHE_PREFIX + key);
      if (old) {
        const entry = JSON.parse(old) as CacheEntry<T>;
        await writeEntry(key, entry);
        await AsyncStorage.removeItem(CACHE_PREFIX + key);
        return entry;
      }
      return null;
    }
    const v = await AsyncStorage.getItem(CACHE_PREFIX + key);
    return v ? (JSON.parse(v) as CacheEntry<T>) : null;
  } catch {
    return null;
  }
}

async function writeEntry<T>(key: string, entry: CacheEntry<T>) {
  const text = JSON.stringify(entry);
  if (!useFiles) {
    await AsyncStorage.setItem(CACHE_PREFIX + key, text);
    return;
  }
  // Escritura segura: primero a un temporal y luego se sustituye el fichero
  const dest = fileFor(key);
  const tmp = new File(dataDir(), `${dest.name}.tmp`);
  if (tmp.exists) tmp.delete();
  tmp.create();
  await tmp.write(text);
  if (dest.exists) dest.delete();
  tmp.move(dest);
}

export async function cacheSet<T>(key: string, data: T) {
  const entry = { ts: Date.now(), data };
  remember(key, entry);
  try {
    await writeEntry(key, entry);
  } catch {
    // si no se puede guardar, se sigue con los datos en memoria
  }
}

/** Borra todos los datos guardados de Datadis */
export async function cacheClear() {
  memory.clear();
  if (useFiles) {
    try {
      const dir = new Directory(Paths.document, DATA_DIR);
      if (dir.exists) dir.delete();
    } catch {
      // ignorado
    }
  }
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(CACHE_PREFIX)));
}

/**
 * Borra ficheros que ya no se usan: versiones anteriores guardaban las potencias máximas y la
 * reactiva con las fechas en el nombre y cada mes dejaban un fichero nuevo.
 */
export function cachePruneObsolete() {
  if (!useFiles) return;
  try {
    const dir = new Directory(Paths.document, DATA_DIR);
    if (!dir.exists) return;
    for (const f of dir.list()) {
      if (f instanceof File && /^(maxp|react)_/.test(f.name) && !/_(24m|12m)_[0-9a-f]+\.json$/.test(f.name)) f.delete();
      else if (f instanceof File && f.name.endsWith('.tmp')) f.delete(); // escrituras a medias
    }
  } catch {
    // ignorado
  }
}

/** Número de ficheros y espacio ocupado por los datos guardados */
export function cacheStats(): { files: number; bytes: number } {
  if (!useFiles) return { files: 0, bytes: 0 };
  try {
    const dir = new Directory(Paths.document, DATA_DIR);
    if (!dir.exists) return { files: 0, bytes: 0 };
    let bytes = 0;
    let files = 0;
    for (const f of dir.list()) {
      if (f instanceof File && f.name.endsWith('.json')) {
        files++;
        bytes += f.size ?? 0;
      }
    }
    return { files, bytes };
  } catch {
    return { files: 0, bytes: 0 };
  }
}
