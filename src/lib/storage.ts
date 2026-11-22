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

export async function cacheGet<T>(key: string): Promise<CacheEntry<T> | null> {
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
  try {
    await writeEntry(key, { ts: Date.now(), data });
  } catch {
    // si no se puede guardar, se sigue con los datos en memoria
  }
}

/** Borra todos los datos guardados de Datadis */
export async function cacheClear() {
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
