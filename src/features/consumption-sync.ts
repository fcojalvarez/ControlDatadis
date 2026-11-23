/**
 * Cola única de descarga de la curva de consumo, MES A MES.
 *
 * Datadis es lento y limita el número de consultas. Pedir muchos meses a la vez (o desde varias
 * pantallas a la vez) hace que se alcance el límite y la descarga se quede a medias. Por eso:
 *  - Cada consulta pide un solo mes y cada mes se guarda en el móvil nada más llegar: si algo
 *    se corta, lo ya descargado no se pierde y se continúa donde se quedó.
 *  - Hay una sola cola para toda la app: los meses se piden de uno en uno (el cliente además
 *    deja una pausa entre consultas) y nunca se pide dos veces el mismo mes.
 *  - Prioridades: primero lo que se está viendo en pantalla, después el histórico; dentro de cada
 *    prioridad, los meses más recientes primero.
 *  - Datadis no deja repetir una consulta idéntica en 24 h: un mes descargado hace menos de un día
 *    no se vuelve a pedir, y si Datadis rechaza un mes por repetido, solo ESE mes espera a mañana
 *    (los demás siguen descargándose). La espera se guarda en el móvil.
 *  - Si Datadis avisa de un límite general, la cola se detiene hasta que pase la pausa y se
 *    reanuda sola. Si Datadis falla varias veces seguidas, se espera unos minutos.
 *  - Los meses que fallan se reintentan solos cuando toca (se ve la hora en «Ver qué falta»).
 */
import type { DatadisClient, DistributorError, MeasurementType } from '@/api/datadis';
import { DatadisError } from '@/api/datadis';
import { compact, type CompactReading } from '@/lib/consumption';
import { cacheGet, cacheSet, getJSON, setJSON } from '@/lib/storage';

export const PRIORITY = { VIEW: 10, HISTORY: 1 } as const;

export type MonthJob = {
  key: string; // clave de caché del mes
  month: string; // YYYY-MM
  cups: string;
  distributorCode: string;
  pointType: number;
  measurementType: MeasurementType;
  authorizedNif?: string;
  priority: number;
};

export type SyncSnapshot = {
  pending: ReadonlySet<string>; // claves en cola o descargándose
  running: string | null;
  errors: ReadonlyMap<string, string>; // último error por clave
  /** Meses que esperan para reintentarse: clave → hora del reintento */
  waiting: ReadonlyMap<string, { at: number; blocked: boolean }>;
  cooldownUntil: number; // pausa por límite de consultas (0 = ninguna)
  pausedUntil: number; // pausa por fallos seguidos
};

type MonthEntry = { rows: CompactReading[]; distributorErrors?: DistributorError[] };

/** Tras un fallo, un mes no se vuelve a pedir automáticamente hasta pasado este tiempo */
const FAILED_RETRY_MS = 10 * 60_000;
/** Pausa tras varios fallos seguidos (Datadis caído) */
const FAILURE_PAUSE_MS = 3 * 60_000;
/** Datadis no deja repetir la misma consulta en 24 h */
const MIN_REFETCH_MS = 24 * 60 * 60_000 + 10 * 60_000;
const BLOCKED_KEY = 'datadis:blocked-months';

class ConsumptionSync {
  private client: DatadisClient | null = null;
  private queue = new Map<string, MonthJob>();
  private running: string | null = null;
  private errors = new Map<string, string>();
  /** Meses que esperan a reintentarse (tras un fallo o por consulta repetida) */
  private delayed = new Map<string, { job: MonthJob; at: number; blocked: boolean }>();
  /** Consultas que Datadis no deja repetir hasta una hora (se guarda en el móvil) */
  private blockedUntil = new Map<string, number>();
  private loadBlocked: Promise<void> | null = null;
  private consecutiveFailures = 0;
  private pausedUntil = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(key: string | null) => void>();
  /** Meses recién descargados (para no releer el fichero) */
  readonly fresh = new Map<string, MonthEntry>();
  private snapshot: SyncSnapshot = { pending: new Set(), running: null, errors: new Map(), waiting: new Map(), cooldownUntil: 0, pausedUntil: 0 };

  subscribe = (fn: (key: string | null) => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this.snapshot;

  private emit(key: string | null) {
    this.snapshot = {
      pending: new Set([...this.queue.keys(), ...(this.running ? [this.running] : [])]),
      running: this.running,
      errors: new Map(this.errors),
      waiting: new Map([...this.delayed].map(([k, d]) => [k, { at: d.at, blocked: d.blocked }])),
      cooldownUntil: this.client?.rateLimitedUntil ?? 0,
      pausedUntil: this.pausedUntil > Date.now() ? this.pausedUntil : 0,
    };
    this.listeners.forEach((l) => l(key));
  }

  /**
   * Añade meses a la cola. Si ya estaban, se queda con la prioridad más alta.
   * `force` adelanta los reintentos de meses que fallaron (actualización manual), pero nunca los
   * que Datadis no deja repetir todavía.
   */
  enqueue(client: DatadisClient, jobs: MonthJob[], force = false) {
    this.client = client;
    if (!this.loadBlocked) {
      this.loadBlocked = getJSON<Record<string, number>>(BLOCKED_KEY, {}).then((saved) => {
        for (const [k, until] of Object.entries(saved)) if (until > Date.now()) this.blockedUntil.set(k, until);
      });
    }
    this.loadBlocked.then(() => this.add(jobs, force));
  }

  private add(jobs: MonthJob[], force: boolean) {
    const now = Date.now();
    let changed = false;
    for (const j of jobs) {
      if (this.running === j.key) continue;
      const blocked = this.blockedUntil.get(j.key) ?? 0;
      const delayed = this.delayed.get(j.key);
      if (blocked > now) {
        this.delayed.set(j.key, { job: higher(delayed?.job, j), at: blocked, blocked: true });
        changed = true;
        continue;
      }
      if (delayed && delayed.at > now && !force) {
        delayed.job = higher(delayed.job, j);
        continue;
      }
      this.delayed.delete(j.key);
      const cur = this.queue.get(j.key);
      if (!cur || cur.priority < j.priority) {
        this.queue.set(j.key, j);
        changed = true;
      }
    }
    if (force) this.pausedUntil = 0;
    if (changed) {
      this.emit(null);
      this.pump();
    }
  }

  /** Pasa a la cola los meses cuyo reintento ya toca */
  private promote() {
    const now = Date.now();
    for (const [k, d] of this.delayed) {
      if (d.at <= now) {
        this.delayed.delete(k);
        this.blockedUntil.delete(k);
        if (!this.queue.has(k)) this.queue.set(k, d.job);
      }
    }
  }

  private wakeForDelayed() {
    if (!this.delayed.size) return;
    this.schedule(Math.min(...[...this.delayed.values()].map((d) => d.at)));
  }

  private saveBlocked() {
    const now = Date.now();
    setJSON(BLOCKED_KEY, Object.fromEntries([...this.blockedUntil].filter(([, t]) => t > now)));
  }

  private schedule(at: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.promote();
        this.emit(null);
        this.pump();
      },
      Math.max(1_000, at - Date.now()),
    );
  }

  private next(): MonthJob | null {
    let best: MonthJob | null = null;
    for (const j of this.queue.values()) {
      if (!best || j.priority > best.priority || (j.priority === best.priority && j.month > best.month)) best = j;
    }
    return best;
  }

  private async pump() {
    if (this.running || !this.client) return;
    const client = this.client;
    this.promote();
    while (this.queue.size) {
      const cooldown = client.rateLimitedUntil;
      if (cooldown) {
        this.emit(null);
        this.schedule(cooldown + 5_000);
        return;
      }
      if (this.pausedUntil > Date.now()) {
        this.emit(null);
        this.schedule(this.pausedUntil);
        return;
      }
      const job = this.next();
      if (!job) return;
      this.queue.delete(job.key);
      this.running = job.key;
      this.emit(null);
      const ym = job.month.replace('-', '/');
      // Descargado hace menos de un día: Datadis rechazaría la misma consulta, se usa lo guardado
      const recent = await cacheGet<MonthEntry>(job.key);
      if (recent && Date.now() - recent.ts < MIN_REFETCH_MS && !isFrozenMonth(recent.data.rows)) {
        this.fresh.set(job.key, recent.data);
        this.errors.delete(job.key);
        this.running = null;
        this.emit(job.key);
        continue;
      }
      try {
        const r = await client.getConsumption({
          cups: job.cups,
          distributorCode: job.distributorCode,
          startDate: ym,
          endDate: ym,
          measurementType: job.measurementType,
          pointType: job.pointType,
          authorizedNif: job.authorizedNif,
        });
        const rows = compact(r.rows).filter((row) => row[0].startsWith(ym));
        if (isFrozenMonth(rows)) {
          // Fallo conocido de algunas distribuidoras (UFD, desde oct. 2026): todo el mes llega con
          // la fecha del día 1 y la curva de ese día repetida. No son datos reales: no se guardan.
          throw new FrozenDataError();
        }
        const saved = await cacheGet<MonthEntry>(job.key);
        if (!rows.length && saved?.data.rows.length) {
          // Datadis devolvió vacío pero ya teníamos el mes: se conserva
          this.fresh.set(job.key, saved.data);
        } else {
          const entry = { rows, distributorErrors: r.errors };
          await cacheSet<MonthEntry>(job.key, entry);
          this.fresh.set(job.key, entry);
        }
        this.errors.delete(job.key);
        this.consecutiveFailures = 0;
        this.running = null;
        this.emit(job.key);
      } catch (e) {
        this.running = null;
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof FrozenDataError) {
          // Se vuelve a probar en un día (la misma consulta no se puede repetir antes)
          const at = Date.now() + MIN_REFETCH_MS;
          this.delayed.set(job.key, { job, at, blocked: false });
          if (recent?.data.rows.length && !isFrozenMonth(recent.data.rows)) this.fresh.set(job.key, recent.data);
          this.errors.set(job.key, msg);
          this.emit(job.key);
          continue;
        }
        if (e instanceof DatadisError && e.repeated) {
          // Solo este mes está bloqueado: espera su turno y los demás siguen sin pausa
          const at = Date.now() + e.retryAfterMs;
          this.blockedUntil.set(job.key, at);
          this.saveBlocked();
          this.delayed.set(job.key, { job, at, blocked: true });
          if (recent?.data.rows.length && !isFrozenMonth(recent.data.rows)) {
            this.fresh.set(job.key, recent.data); // se sigue usando lo guardado
            this.errors.delete(job.key);
          } else {
            this.errors.set(job.key, msg);
          }
          this.emit(job.key);
          continue;
        }
        if (e instanceof DatadisError && e.rateLimited) {
          // Límite general: el mes vuelve a la cola y se espera a que pase la pausa
          this.queue.set(job.key, job);
          this.errors.set(job.key, msg);
          this.emit(job.key);
          continue; // el bucle detecta la pausa y programa la reanudación
        }
        this.errors.set(job.key, msg);
        this.delayed.set(job.key, { job, at: Date.now() + FAILED_RETRY_MS, blocked: false });
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures >= 2) {
          // Datadis no responde: se espera antes de seguir con el resto de meses
          this.pausedUntil = Date.now() + FAILURE_PAUSE_MS;
          this.consecutiveFailures = 0;
        }
        this.emit(job.key);
      }
    }
    // Cola vacía: despertar cuando toque reintentar algún mes
    this.wakeForDelayed();
  }
}

class FrozenDataError extends Error {
  constructor() {
    super('La distribuidora ha enviado datos erróneos (todos los días con la fecha del día 1)');
    this.name = 'FrozenDataError';
  }
}

/** ¿Respuesta «congelada»? Muchas filas pero todas con la misma fecha */
export function isFrozenMonth(rows: CompactReading[]): boolean {
  if (rows.length <= 100) return false;
  const first = rows[0][0];
  return rows.every((r) => r[0] === first);
}

function higher(a: MonthJob | undefined, b: MonthJob): MonthJob {
  return a && a.priority >= b.priority ? a : b;
}

export const consumptionSync = new ConsumptionSync();
