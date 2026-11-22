/**
 * Cliente de la API privada (gratuita) de Datadis para consumidores.
 *
 * Endpoints (https://datadis.es/private-api):
 *  - POST /nikola-auth/tokens/login                        -> token JWT (texto plano)
 *  - GET  /api-private/api/get-distributors-with-supplies-v2
 *  - GET  /api-private/api/get-supplies-v2
 *  - GET  /api-private/api/get-contract-detail-v2
 *  - GET  /api-private/api/get-consumption-data-v2
 *  - GET  /api-private/api/get-max-power-v2
 *  - GET  /api-private/api/get-reactive-data-v2
 *
 * Todos los endpoints de datos aceptan `authorizedNif` opcional para consultar
 * los suministros de un tercero que te haya autorizado en Datadis.
 */

export const DATADIS_BASE_URL = 'https://datadis.es';
const REQUEST_TIMEOUT_MS = 120_000;

// ---------- Tipos de respuesta ----------

export type DistributorError = {
  distributorCode?: string;
  distributorName?: string;
  errorCode?: string;
  errorDescription?: string;
};

export type Supply = {
  address: string;
  cups: string;
  postalCode: string;
  province: string;
  municipality: string;
  distributor: string;
  validDateFrom: string; // YYYY/MM/DD
  validDateTo: string; // YYYY/MM/DD o ''
  pointType: number;
  distributorCode: string;
};

export type ContractDetail = {
  cups: string;
  distributor: string;
  marketer?: string | null;
  tension?: string | null;
  accessFare?: string | null;
  province?: string | null;
  municipality?: string | null;
  postalCode?: string | null;
  contractedPowerkW?: number[] | null;
  timeDiscrimination?: string | null;
  modePowerControl?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  codeFare?: string | null;
  selfConsumptionTypeCode?: string | null;
  selfConsumptionTypeDesc?: string | null;
  section?: string | null;
  subsection?: string | null;
  partitionCoefficient?: number | string | null;
  cau?: string | null;
  installedCapacity?: number | string | null;
  installedCapacityKW?: number | string | null;
  dateOwner?: { startDate: string; endDate: string }[] | null;
  lastMarketerDate?: string | null;
  maxPowerInstall?: string | number | null;
};

export type ConsumptionRaw = {
  cups: string;
  date: string; // YYYY/MM/DD
  time: string; // HH:MM, hora de FIN del intervalo (01:00 = de 00:00 a 01:00)
  consumptionKWh: number | null;
  obtainMethod: string; // 'Real' | 'Estimada'
  surplusEnergyKWh?: number | null;
  generationEnergyKWh?: number | null;
  selfConsumptionEnergyKWh?: number | null;
};

export type MaxPowerRaw = {
  cups: string;
  date: string; // YYYY/MM/DD
  time: string; // HH:MM
  maxPower: number; // W
  period: string; // 'VALLE' | 'LLANO' | 'PUNTA' | 'P1'...
};

export type ReactiveRow = {
  date: string; // YYYY/MM
  [key: string]: number | string | null;
};

export type MeasurementType = 0 | 1; // 0 = horaria, 1 = cuartohoraria

// ---------- Errores ----------

export class DatadisError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'DatadisError';
    this.status = status;
  }
}

export class AuthError extends DatadisError {
  constructor(message = 'Usuario o contraseña incorrectos') {
    super(message, 401);
    this.name = 'AuthError';
  }
}

// ---------- Utilidades ----------

type Params = Record<string, string | number | undefined | null>;

function buildQuery(params: Params): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v)).replace(/%2F/g, '/')}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    if (controller.signal.aborted) {
      throw new DatadisError('Datadis tardó demasiado en responder. Inténtalo más tarde.');
    }
    throw new DatadisError('No se pudo conectar con Datadis. Revisa tu conexión.');
  } finally {
    clearTimeout(timer);
  }
}

function describeHttpError(status: number, body: string): string {
  const trimmed = body.trim().slice(0, 300);
  let detail = trimmed;
  try {
    const j = JSON.parse(trimmed);
    detail = j.message || j.error || j.description || trimmed;
  } catch {
    // texto plano
  }
  if (status === 429) {
    return 'Datadis limita el número de consultas. Espera un rato antes de volver a consultar.';
  }
  if (status >= 500) {
    return `Datadis o la distribuidora no están respondiendo (${status}). ${detail}`.trim();
  }
  return `Error ${status} de Datadis. ${detail}`.trim();
}

/** YYYY/MM a partir de una fecha */
export function toYearMonth(d: Date): string {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ---------- Cliente ----------

export async function login(username: string, password: string): Promise<string> {
  const body = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  const res = await fetchWithTimeout(`${DATADIS_BASE_URL}/nikola-auth/tokens/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/plain' },
    body,
  });
  const text = await res.text();
  if (res.status === 200 && text && !text.trim().startsWith('{')) {
    return text.trim();
  }
  if (res.status === 200) {
    // por si alguna versión devuelve {"token": "..."}
    try {
      const j = JSON.parse(text);
      if (j.token) return String(j.token);
    } catch {
      // ignorado
    }
  }
  if (res.status === 401 || res.status === 403 || /credential|incorrect|bad/i.test(text)) {
    throw new AuthError();
  }
  throw new DatadisError(describeHttpError(res.status, text), res.status);
}

export class DatadisClient {
  constructor(
    private getToken: () => string | null,
    private refreshToken: () => Promise<string>,
  ) {}

  private async get<T>(path: string, params: Params = {}, retry = true): Promise<T> {
    const token = this.getToken() ?? (await this.refreshToken());
    const url = `${DATADIS_BASE_URL}${path}${buildQuery(params)}`;
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Accept-Encoding': 'identity',
      },
    });
    if (res.status === 401 && retry) {
      await this.refreshToken();
      return this.get<T>(path, params, false);
    }
    const text = await res.text();
    if (!res.ok) {
      throw new DatadisError(describeHttpError(res.status, text), res.status);
    }
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new DatadisError('Respuesta inesperada de Datadis.');
    }
  }

  async getDistributorsWithSupplies(authorizedNif?: string) {
    const r = await this.get<{
      distExistenceUser?: { distributorCodes?: string[] };
      distributorError?: DistributorError[];
    }>('/api-private/api/get-distributors-with-supplies-v2', { authorizedNif });
    return {
      distributorCodes: r.distExistenceUser?.distributorCodes ?? [],
      errors: r.distributorError ?? [],
    };
  }

  async getSupplies(authorizedNif?: string, distributorCode?: string) {
    const r = await this.get<{ supplies?: Supply[]; distributorError?: DistributorError[] }>(
      '/api-private/api/get-supplies-v2',
      { authorizedNif, distributorCode },
    );
    return { supplies: r.supplies ?? [], errors: r.distributorError ?? [] };
  }

  async getContractDetail(cups: string, distributorCode: string, authorizedNif?: string) {
    const r = await this.get<{ contract?: ContractDetail[]; distributorError?: DistributorError[] }>(
      '/api-private/api/get-contract-detail-v2',
      { cups, distributorCode, authorizedNif },
    );
    return { contracts: r.contract ?? [], errors: r.distributorError ?? [] };
  }

  async getConsumption(opts: {
    cups: string;
    distributorCode: string;
    startDate: string; // YYYY/MM
    endDate: string; // YYYY/MM
    measurementType: MeasurementType;
    pointType: number;
    authorizedNif?: string;
  }) {
    const r = await this.get<{ timeCurve?: ConsumptionRaw[]; distributorError?: DistributorError[] }>(
      '/api-private/api/get-consumption-data-v2',
      opts,
    );
    return { rows: r.timeCurve ?? [], errors: r.distributorError ?? [] };
  }

  async getMaxPower(opts: {
    cups: string;
    distributorCode: string;
    startDate: string;
    endDate: string;
    authorizedNif?: string;
  }) {
    const r = await this.get<{ maxPower?: MaxPowerRaw[]; distributorError?: DistributorError[] }>(
      '/api-private/api/get-max-power-v2',
      opts,
    );
    return { rows: r.maxPower ?? [], errors: r.distributorError ?? [] };
  }

  async getReactive(opts: {
    cups: string;
    distributorCode: string;
    startDate: string;
    endDate: string;
    authorizedNif?: string;
  }) {
    const r = await this.get<{
      reactiveEnergy?: { energy?: ReactiveRow[]; code?: string; code_desc?: string } | { energy?: ReactiveRow[] }[];
      distributorError?: DistributorError[];
    }>('/api-private/api/get-reactive-data-v2', opts);
    const re = r.reactiveEnergy;
    const list = Array.isArray(re) ? re : re ? [re] : [];
    const rows = list.flatMap((x) => x.energy ?? []);
    const first = list[0] as { code?: string; code_desc?: string } | undefined;
    return {
      rows,
      code: first?.code,
      codeDesc: first?.code_desc,
      errors: r.distributorError ?? [],
    };
  }
}
