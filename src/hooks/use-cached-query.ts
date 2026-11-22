import { useCallback, useEffect, useRef, useState } from 'react';

import { cacheGet, cacheSet } from '@/lib/storage';

type State<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  updatedAt: number | null;
};

/**
 * Consulta con caché persistente. Si hay datos en caché más recientes que `ttlMs`
 * no se consulta Datadis (evita los límites de peticiones).
 * `key = null` desactiva la consulta.
 */
export function useCachedQuery<T>(key: string | null, fetcher: () => Promise<T>, ttlMs: number) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: !!key, updatedAt: null });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const currentKey = useRef(key);
  currentKey.current = key;

  const run = useCallback(
    async (force: boolean) => {
      if (!key) return;
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        if (!force) {
          const cached = await cacheGet<T>(key);
          if (cached) {
            if (currentKey.current !== key) return;
            setState({ data: cached.data, error: null, loading: Date.now() - cached.ts > ttlMs, updatedAt: cached.ts });
            if (Date.now() - cached.ts <= ttlMs) return;
          }
        }
        const data = await fetcherRef.current();
        await cacheSet(key, data);
        if (currentKey.current !== key) return;
        setState({ data, error: null, loading: false, updatedAt: Date.now() });
      } catch (e) {
        if (currentKey.current !== key) return;
        setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) }));
      }
    },
    [key, ttlMs],
  );

  useEffect(() => {
    if (!key) {
      setState({ data: null, error: null, loading: false, updatedAt: null });
      return;
    }
    setState({ data: null, error: null, loading: true, updatedAt: null });
    run(false);
  }, [key, run]);

  const refresh = useCallback(() => run(true), [run]);

  return { ...state, refresh };
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
