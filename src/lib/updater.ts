/**
 * Actualización de la app desde las Releases de GitHub (APK firmado siempre con la misma clave,
 * así que se instala encima conservando los datos guardados).
 *
 * El flujo de compilación (.github/workflows/android-apk.yml) pone como versionCode de Android el
 * número de ejecución y publica la Release con la etiqueta `apk-<versión>-build<N>`.
 */
import * as Application from 'expo-application';
import { File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking, Platform } from 'react-native';

import { getJSON, setJSON } from '@/lib/storage';

export const UPDATE_REPO = 'fcojalvarez/ControlDatadis';
const LATEST_URL = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
export const RELEASES_PAGE = `https://github.com/${UPDATE_REPO}/releases/latest`;
const LAST_CHECK_KEY = 'updater:lastCheck';
const AUTO_CHECK_EVERY_MS = 12 * 3_600_000;

export type ReleaseInfo = {
  build: number;
  version: string;
  name: string;
  notes: string;
  publishedAt: string;
  apkUrl: string;
  apkSize: number;
  pageUrl: string;
};

/** Número de build instalado (versionCode de Android). 0 en desarrollo. */
export function installedBuild(): number {
  const n = Number(Application.nativeBuildVersion);
  return Number.isFinite(n) ? n : 0;
}

export function installedVersion(): string {
  return Application.nativeApplicationVersion ?? '—';
}

export function canSelfUpdate(): boolean {
  return Platform.OS === 'android';
}

/** Consulta la última Release publicada en GitHub. */
export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(LATEST_URL, { headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal });
    if (res.status === 404) return null; // todavía no hay ninguna Release
    if (!res.ok) throw new Error(`GitHub respondió ${res.status}`);
    const r = (await res.json()) as {
      tag_name: string;
      name: string;
      body: string;
      published_at: string;
      html_url: string;
      assets: { name: string; browser_download_url: string; size: number }[];
    };
    const apk = r.assets.find((a) => a.name.toLowerCase().endsWith('.apk'));
    const m = r.tag_name.match(/^apk-(.+)-build(\d+)$/);
    if (!apk || !m) return null;
    return {
      version: m[1],
      build: Number(m[2]),
      name: r.name,
      notes: r.body ?? '',
      publishedAt: r.published_at,
      apkUrl: apk.browser_download_url,
      apkSize: apk.size,
      pageUrl: r.html_url,
    };
  } catch (e) {
    if (controller.signal.aborted) throw new Error('GitHub tardó demasiado en responder.');
    throw e instanceof Error ? e : new Error(String(e));
  } finally {
    clearTimeout(timer);
  }
}

/** Devuelve la Release si es más nueva que la instalada. */
export async function checkForUpdate(): Promise<ReleaseInfo | null> {
  const latest = await fetchLatestRelease();
  await setJSON(LAST_CHECK_KEY, { ts: Date.now() });
  return latest && latest.build > installedBuild() ? latest : null;
}

/** Comprobación automática como mucho cada 12 horas (no molesta si no hay red). */
export async function autoCheckForUpdate(): Promise<ReleaseInfo | null> {
  if (!canSelfUpdate()) return null;
  const { ts } = await getJSON<{ ts: number }>(LAST_CHECK_KEY, { ts: 0 });
  if (Date.now() - ts < AUTO_CHECK_EVERY_MS) return null;
  try {
    return await checkForUpdate();
  } catch {
    return null;
  }
}

/**
 * Descarga el APK y abre el instalador de Android. La primera vez Android pedirá permitir
 * "instalar apps desconocidas" para Control Datadis.
 */
export async function downloadAndInstall(release: ReleaseInfo, onProgress: (fraction: number) => void): Promise<void> {
  if (!canSelfUpdate()) {
    await Linking.openURL(release.pageUrl);
    return;
  }
  const dest = new File(Paths.cache, `ControlDatadis-build${release.build}.apk`);
  if (dest.exists) dest.delete();
  const task = File.createDownloadTask(release.apkUrl, dest, {
    onProgress: ({ bytesWritten, totalBytes }) => {
      const total = totalBytes > 0 ? totalBytes : release.apkSize;
      if (total > 0) onProgress(Math.min(1, bytesWritten / total));
    },
  });
  const file = await task.downloadAsync();
  if (!file) throw new Error('La descarga se interrumpió.');
  onProgress(1);
  const contentUri = await getContentUriAsync(file.uri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    type: 'application/vnd.android.package-archive',
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
  });
}
