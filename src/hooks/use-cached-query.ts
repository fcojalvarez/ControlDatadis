import { useCallback, useEffect, useRef, useState } from 'react';

import { DatadisError } from '@/api/datadis';
import { cacheGet, cacheSet } from '@/lib/storage';

type State<T> = {
  key: string | null; // consulta a la que pertenecen estos datos
  data: T | null;
  error: string | null;
  loading: boolean;
  updatedAt: number | null; // cuándo se descargaron los datos que se muestran
  /** Se están mostrando datos guardados porque la actualización falló o vino vacía */
  stale: boolean;
};

type Options<T> = {
  /** Si la respuesta nueva está vacía y ya había datos guardados, se conservan los guardados */
  isEmpty?: (d: T) => boolean;
};

/**
 * Consulta con almacenamiento local persistente ("offline first"):
 *  - Siempre se muestran primero los datos guardados en el móvil, aunque sean antiguos.
 *  - Solo se consulta Datadis si los datos guardados tienen más de `ttlMs` (o al forzar).
 *  - Si Datadis falla o devuelve una respuesta vacía, se mantienen los datos guardados.
 * `key = null` desactiva la consulta.
 */
export function useCachedQuery<T>(key: string | null, fetcher: () => Promise<T>, ttlMs: number, options: Options<T> = {}) {
  const [state, setState] = useState<State<T>>({ key, data: null, error: null, loading: !!key, updatedAt: null, stale: false });
  const fetcherRef = useRef(fetcher);
  const isEmptyRef = useRef(options.isEmpty);
  const currentKey = useRef(key);
  useEffect(() => {
    fetcherRef.current = fetcher;
    isEmptyRef.current = options.isEmpty;
    currentKey.current = key;
  });

  const run = useCallback(
    async (force: boolean) => {
      if (!key) return;
      currentKey.current = key;
      const cached = await cacheGet<T>(key);
      if (currentKey.current !== key) return;
      if (cached) {
        const fresh = Date.now() - cached.ts <= ttlMs;
        setState({ key, data: cached.data, error: null, loading: force || !fresh, updatedAt: cached.ts, stale: false });
        if (fresh && !force) return;
      } else {
        setState((s) => (s.key === key ? { ...s, loading: true, error: null } : { key, data: null, error: null, loading: true, updatedAt: null, stale: false }));
      }
      try {
        const data = await fetcherRef.current();
        if (currentKey.current !== key) return;
        const empty = isEmptyRef.current?.(data) ?? false;
        if (empty && cached && !(isEmptyRef.current?.(cached.data) ?? false)) {
          // Datadis devolvió vacío pero teníamos datos: no se pierden
          setState({ key, data: cached.data, error: null, loading: false, updatedAt: cached.ts, stale: true });
          return;
        }
        await cacheSet(key, data);
        setState({ key, data, error: null, loading: false, updatedAt: Date.now(), stale: false });
      } catch (e) {
        if (currentKey.current !== key) return;
        const msg = e instanceof Error ? e.message : String(e);
        // Consulta repetida en menos de 24 h: lo guardado ya es lo último, no es un error
        const repeated = e instanceof DatadisError && e.repeated;
        setState((s) => (repeated && s.data !== null ? { ...s, loading: false, error: null, stale: false } : { ...s, loading: false, error: msg, stale: s.data !== null }));
      }
    },
    [key, ttlMs],
  );

  useEffect(() => {
    // Todas las actualizaciones de estado ocurren de forma asíncrona (tras leer los datos guardados)
    void Promise.resolve().then(() => run(false));
  }, [run]);

  const refresh = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    return run(true);
  }, [run]);

  // Mientras llegan los datos de una consulta nueva no se muestran los de la anterior
  const current: State<T> =
    state.key === key ? state : { key, data: null, error: null, loading: !!key, updatedAt: null, stale: false };
  return { data: current.data, error: current.error, loading: current.loading, updatedAt: current.updatedAt, stale: current.stale, refresh };
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
