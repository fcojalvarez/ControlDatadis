import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { DatadisClient, login as apiLogin } from '@/api/datadis';
import { DEMO_USER, DemoClient } from '@/api/demo';
import { DEFAULT_PRICES, type Prices } from '@/lib/consumption';
import type { SupplyTariffs } from '@/lib/tariff';
import { cachePruneObsolete, clearCredentials, getJSON, loadCredentials, saveCredentials, setJSON } from '@/lib/storage';

type Status = 'loading' | 'loggedOut' | 'loggedIn';

type Settings = {
  prices: Prices; // precios por defecto para suministros sin tarifa propia (versiones anteriores)
  tariffs: Record<string, SupplyTariffs>; // tarifa de cada suministro (por CUPS)
  summaryLayout: { order: string[]; hidden: string[] }; // orden y tarjetas ocultas del Resumen
  hasSolar: boolean; // tiene placas solares (si no, se oculta todo lo de autoconsumo)
  authorizedNifs: string[]; // NIFs que te han autorizado en Datadis
  activeNif: string | null; // null = mis suministros
};

const DEFAULT_SETTINGS: Settings = {
  prices: DEFAULT_PRICES,
  tariffs: {},
  summaryLayout: { order: [], hidden: [] },
  hasSolar: true,
  authorizedNifs: [],
  activeNif: null,
};
const SETTINGS_KEY = 'settings';
// v2: las pausas guardadas con la lógica anterior (que confundía consultas repetidas con el límite) se descartan
const COOLDOWN_KEY = 'datadis:cooldown:v2';

type SessionValue = {
  status: Status;
  username: string | null;
  client: DatadisClient;
  /** Modo demo: datos simulados (lo real sigue guardado y se sigue descargando aparte) */
  demo: boolean;
  setDemo: (on: boolean) => void;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  signIn: (username: string, password: string, remember: boolean) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

type AuthState = {
  token: string | null;
  creds: { username: string; password: string } | null;
  refreshing: Promise<string> | null;
};

/** Obtiene un token nuevo con las credenciales guardadas (una sola petición simultánea). */
function refreshToken(auth: AuthState): Promise<string> {
  if (!auth.creds) return Promise.reject(new Error('Sesión caducada. Vuelve a iniciar sesión.'));
  if (!auth.refreshing) {
    auth.refreshing = apiLogin(auth.creds.username, auth.creds.password)
      .then((t) => {
        auth.token = t;
        return t;
      })
      .finally(() => {
        auth.refreshing = null;
      });
  }
  return auth.refreshing;
}

// Estado de autenticación de la app (no necesita provocar renders). La app tiene una única sesión.
const auth: AuthState = { token: null, creds: null, refreshing: null };
const client = new DatadisClient(
  () => auth.token,
  () => refreshToken(auth),
);

// Cliente simulado del modo demo (no se conecta a Datadis)
const demoClient = new DemoClient();

// La pausa por límite de consultas se guarda para respetarla aunque se cierre la app
client.onCooldownChange((until, step) => {
  setJSON(COOLDOWN_KEY, { until, step });
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [username, setUsername] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    (async () => {
      const [saved, s, cooldown] = await Promise.all([
        loadCredentials(),
        getJSON<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS),
        getJSON<{ until: number; step: number }>(COOLDOWN_KEY, { until: 0, step: 0 }),
      ]);
      // Si Datadis limitó las consultas en una sesión anterior, se respeta la pausa
      client.restoreCooldown(cooldown.until, cooldown.step);
      // Limpieza de ficheros que dejaron versiones anteriores
      cachePruneObsolete();
      setSettings({ ...DEFAULT_SETTINGS, ...s, prices: { ...DEFAULT_PRICES, ...s.prices }, tariffs: s.tariffs ?? {}, summaryLayout: { ...DEFAULT_SETTINGS.summaryLayout, ...s.summaryLayout } });
      if (saved) {
        // El token se obtiene de forma perezosa en la primera consulta
        auth.creds = saved;
        setUsername(saved.username);
        setStatus('loggedIn');
      } else {
        setStatus('loggedOut');
      }
    })();
  }, []);

  const signIn = useCallback(async (user: string, password: string, remember: boolean) => {
    const u = user.trim().toUpperCase();
    const t = await apiLogin(u, password);
    auth.token = t;
    auth.creds = { username: u, password };
    if (remember) await saveCredentials(auth.creds);
    setUsername(u);
    setStatus('loggedIn');
  }, []);

  const signOut = useCallback(async () => {
    setDemo(false);
    auth.token = null;
    auth.creds = null;
    // Los datos descargados se conservan en el móvil (se borran desde Ajustes si se quiere)
    await clearCredentials();
    setUsername(null);
    setSettings((s) => ({ ...s, activeNif: null }));
    setStatus('loggedOut');
  }, []);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      setJSON(SETTINGS_KEY, next);
      return next;
    });
  }, []);

  const value = useMemo(
    () =>
      demo
        ? // En el modo demo la app funciona igual pero con el cliente simulado y su propio usuario
          // (las claves de lo guardado llevan el usuario, así que nada se mezcla con lo real)
          { status: 'loggedIn' as const, username: DEMO_USER, client: demoClient, demo, setDemo, settings: { ...settings, activeNif: null }, updateSettings, signIn, signOut }
        : { status, username, client, demo, setDemo, settings, updateSettings, signIn, signOut },
    [demo, status, username, settings, updateSettings, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession debe usarse dentro de SessionProvider');
  return ctx;
}
