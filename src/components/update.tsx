import { useEffect, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Linking, Pressable, View } from 'react-native';

import { ProgressBar } from '@/components/bar-chart';
import { Button, Card, Notice, T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { fmtDate, fmtNum } from '@/lib/format';
import {
  RELEASES_PAGE,
  autoCheckForUpdate,
  canSelfUpdate,
  checkForUpdate,
  downloadAndInstall,
  installedBuild,
  installedVersion,
  type ReleaseInfo,
} from '@/lib/updater';

type Phase = { kind: 'idle' } | { kind: 'checking' } | { kind: 'downloading'; progress: number } | { kind: 'error'; message: string };

/** Descarga e instalación con barra de progreso */
function useInstaller() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const install = async (release: ReleaseInfo) => {
    setPhase({ kind: 'downloading', progress: 0 });
    try {
      await downloadAndInstall(release, (progress) => setPhase({ kind: 'downloading', progress }));
      setPhase({ kind: 'idle' });
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };
  return { phase, setPhase, install };
}

function InstallProgress({ phase, release }: { phase: Phase; release: ReleaseInfo }) {
  const c = useTheme();
  if (phase.kind === 'downloading') {
    return (
      <View style={{ gap: 6 }}>
        <ProgressBar value={phase.progress} max={1} color={c.tint} />
        <T variant="small">
          {phase.progress < 1
            ? `Descargando… ${fmtNum(phase.progress * 100, 0)} % de ${fmtNum(release.apkSize / 1024 / 1024, 0)} MB`
            : 'Abriendo el instalador de Android…'}
        </T>
      </View>
    );
  }
  if (phase.kind === 'error') {
    return (
      <View style={{ gap: 6 }}>
        <T variant="small" style={{ color: c.danger }}>
          No se pudo actualizar: {phase.message}
        </T>
        <Button title="Descargar desde el navegador" variant="secondary" onPress={() => Linking.openURL(release.apkUrl)} />
      </View>
    );
  }
  return null;
}

/** Aviso en la pantalla de inicio cuando hay una versión nueva (se comprueba cada 12 h) */
export function UpdateBanner() {
  const c = useTheme();
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const { phase, install } = useInstaller();

  useEffect(() => {
    let alive = true;
    autoCheckForUpdate().then((r) => alive && setRelease(r));
    return () => {
      alive = false;
    };
  }, []);

  if (!release || dismissed) return null;
  return (
    <Notice tone="good">
      <T style={{ fontWeight: '700' }}>Hay una versión nueva de la app</T>
      <T variant="small" style={{ color: c.text }}>
        Build {release.build} (tienes la {installedBuild()}). Se instala encima y conservas todos tus datos.
      </T>
      {phase.kind === 'idle' ? (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
          <Button title="Actualizar" onPress={() => install(release)} style={{ flex: 1 }} />
          <Button title="Más tarde" variant="secondary" onPress={() => setDismissed(true)} style={{ flex: 1 }} />
        </View>
      ) : (
        <InstallProgress phase={phase} release={release} />
      )}
    </Notice>
  );
}

/** Sección de Ajustes: versión instalada y búsqueda manual de actualizaciones */
export function UpdateCard() {
  const c = useTheme();
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [checked, setChecked] = useState(false);
  const { phase, setPhase, install } = useInstaller();

  const check = async () => {
    setPhase({ kind: 'checking' });
    try {
      setRelease(await checkForUpdate());
      setChecked(true);
      setPhase({ kind: 'idle' });
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <Card
      title="Versión"
      info="La app busca versiones nuevas sola cada 12 horas y te avisa en la pantalla de inicio. Al actualizar se descarga el APK y se abre el instalador de Android (la primera vez pide permitir instalar apps de esta fuente). Se conservan todos los datos."
      right={
        <Pressable onPress={check} disabled={phase.kind === 'checking'} hitSlop={10} accessibilityLabel="Buscar actualizaciones">
          {phase.kind === 'checking' ? <ActivityIndicator color={c.tint} /> : <Ionicons name="refresh" size={22} color={c.tint} />}
        </Pressable>
      }>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <T style={{ flex: 1, fontWeight: '600' }}>
          {installedVersion()} · build {installedBuild()}
        </T>
        {checked && !release && phase.kind === 'idle' ? (
          <T variant="small" style={{ color: c.p3, fontWeight: '700' }}>
            Es la última
          </T>
        ) : null}
        <Pressable onPress={() => Linking.openURL(RELEASES_PAGE)} hitSlop={8} accessibilityLabel="Ver versiones en GitHub">
          <Ionicons name="logo-github" size={20} color={c.textSecondary} />
        </Pressable>
      </View>
      {phase.kind === 'error' && !release ? (
        <T variant="small" style={{ color: c.danger }}>
          No se pudo comprobar: {phase.message}
        </T>
      ) : null}
      {release ? (
        <>
          <T variant="small" style={{ color: c.text }}>
            Nueva: {release.version} · build {release.build} ({fmtDate(release.publishedAt.slice(0, 10))})
          </T>
          {phase.kind === 'idle' || phase.kind === 'checking' ? (
            <Button title={canSelfUpdate() ? 'Instalar' : 'Ver en GitHub'} onPress={() => install(release)} />
          ) : (
            <InstallProgress phase={phase} release={release} />
          )}
        </>
      ) : null}
    </Card>
  );
}

