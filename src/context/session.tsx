import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { DatadisClient, login as apiLogin } from '@/api/datadis';
import { DEFAULT_PRICES, type Prices } from '@/lib/consumption';
import { clearCredentials, getJSON, loadCredentials, saveCredentials, setJSON } from '@/lib/storage';

type Status = 'loading' | 'loggedOut' | 'loggedIn';

type Settings = {
  prices: Prices;
  authorizedNifs: string[]; // NIFs que te han autorizado en Datadis
  activeNif: string | null; // null = mis suministros
};

const DEFAULT_SETTINGS: Settings = { prices: DEFAULT_PRICES, authorizedNifs: [], activeNif: null };
const SETTINGS_KEY = 'settings';

type SessionValue = {
  status: Status;
  username: string | null;
  client: DatadisClient;
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

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [username, setUsername] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    (async () => {
      const [saved, s] = await Promise.all([loadCredentials(), getJSON<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS)]);
      setSettings({ ...DEFAULT_SETTINGS, ...s, prices: { ...DEFAULT_PRICES, ...s.prices } });
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
    () => ({ status, username, client, settings, updateSettings, signIn, signOut }),
    [status, username, settings, updateSettings, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession debe usarse dentro de SessionProvider');
  return ctx;
}
