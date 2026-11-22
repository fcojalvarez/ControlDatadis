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
 *  - Si Datadis avisa del límite de consultas, la cola se detiene hasta que pase la pausa y se
 *    reanuda sola. Si Datadis falla varias veces seguidas, se espera unos minutos.
 */
import type { DatadisClient, DistributorError, MeasurementType } from '@/api/datadis';
import { DatadisError } from '@/api/datadis';
import { compact, type CompactReading } from '@/lib/consumption';
import { cacheGet, cacheSet } from '@/lib/storage';

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
  cooldownUntil: number; // pausa por límite de consultas (0 = ninguna)
  pausedUntil: number; // pausa por fallos seguidos
};

type MonthEntry = { rows: CompactReading[]; distributorErrors?: DistributorError[] };

/** Tras un fallo, un mes no se vuelve a pedir automáticamente hasta pasado este tiempo */
const FAILED_RETRY_MS = 10 * 60_000;
/** Pausa tras varios fallos seguidos (Datadis caído) */
const FAILURE_PAUSE_MS = 3 * 60_000;

class ConsumptionSync {
  private client: DatadisClient | null = null;
  private queue = new Map<string, MonthJob>();
  private running: string | null = null;
  private errors = new Map<string, string>();
  private failedAt = new Map<string, number>();
  private consecutiveFailures = 0;
  private pausedUntil = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(key: string | null) => void>();
  /** Meses recién descargados (para no releer el fichero) */
  readonly fresh = new Map<string, MonthEntry>();
  private snapshot: SyncSnapshot = { pending: new Set(), running: null, errors: new Map(), cooldownUntil: 0, pausedUntil: 0 };

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
      cooldownUntil: this.client?.rateLimitedUntil ?? 0,
      pausedUntil: this.pausedUntil > Date.now() ? this.pausedUntil : 0,
    };
    this.listeners.forEach((l) => l(key));
  }

  /**
   * Añade meses a la cola. Si ya estaban, se queda con la prioridad más alta.
   * `force` ignora los fallos recientes (actualización manual).
   */
  enqueue(client: DatadisClient, jobs: MonthJob[], force = false) {
    this.client = client;
    const now = Date.now();
    let changed = false;
    for (const j of jobs) {
      if (this.running === j.key) continue;
      if (!force && now - (this.failedAt.get(j.key) ?? 0) < FAILED_RETRY_MS) continue;
      const cur = this.queue.get(j.key);
      if (!cur || cur.priority < j.priority) {
        this.queue.set(j.key, j);
        changed = true;
      }
      if (force) this.failedAt.delete(j.key);
    }
    if (force) this.pausedUntil = 0;
    if (changed) {
      this.emit(null);
      this.pump();
    }
  }

  private schedule(at: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.timer = null;
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
        this.failedAt.delete(job.key);
        this.consecutiveFailures = 0;
        this.running = null;
        this.emit(job.key);
      } catch (e) {
        this.running = null;
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof DatadisError && e.rateLimited) {
          // Límite de consultas: el mes vuelve a la cola y se espera a que pase la pausa
          this.queue.set(job.key, job);
          this.errors.set(job.key, msg);
          this.emit(job.key);
          continue; // el bucle detecta la pausa y programa la reanudación
        }
        this.errors.set(job.key, msg);
        this.failedAt.set(job.key, Date.now());
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures >= 2) {
          // Datadis no responde: se espera antes de seguir con el resto de meses
          this.pausedUntil = Date.now() + FAILURE_PAUSE_MS;
          this.consecutiveFailures = 0;
        }
        this.emit(job.key);
      }
    }
  }
}

export const consumptionSync = new ConsumptionSync();
