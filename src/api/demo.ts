/**
 * MODO DEMO: un cliente de Datadis que no se conecta a nada y responde con datos simulados,
 * realistas y siempre iguales (generados a partir de la fecha), para enseñar todo lo que hace la
 * app sin cuenta o mientras se descargan los datos reales.
 *
 *  - Piso (sin placas): calefacción en invierno, aire acondicionado en verano, picos al cocinar y
 *    algún pico por encima de la potencia; cambió de 3,45 a 4,6 kW hace año y medio.
 *  - Casa (con placas): generación solar según el mes, autoconsumo y excedentes.
 *  - Un suministro antiguo ya dado de baja.
 */
import type { ConsumptionRaw, ContractDetail, DistributorError, MaxPowerRaw, MeasurementType, ReactiveRow, Supply } from '@/api/datadis';
import { DatadisClient } from '@/api/datadis';
import { periodFor } from '@/lib/periods';

export const DEMO_USER = 'DEMO';

const PISO = 'ES0031400000000001AA0F';
const CASA = 'ES0021000000000002BB1F';
const ANTIGUO = 'ES0031400000000003CC0F';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;

/** Fecha de hace `n` meses (día 1) en formato YYYY/MM/DD */
function monthsAgo(n: number, day = 1): string {
  const t = new Date();
  return ymd(new Date(t.getFullYear(), t.getMonth() - n, day));
}

/** Número pseudoaleatorio estable (0..1) a partir de un texto */
function rand(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  h += h << 13;
  h ^= h >>> 7;
  h += h << 3;
  h ^= h >>> 17;
  h += h << 5;
  return ((h >>> 0) % 100000) / 100000;
}

function supplies(): Supply[] {
  return [
    {
      address: 'CALLE DEL EJEMPLO 12, 3ºB',
      cups: PISO,
      postalCode: '28013',
      province: 'MADRID',
      municipality: 'MADRID',
      distributor: 'I-DE REDES ELÉCTRICAS INTELIGENTES',
      validDateFrom: '2019/03/15',
      validDateTo: '',
      pointType: 5,
      distributorCode: '2',
    },
    {
      address: 'URBANIZACIÓN LOS PINOS 7',
      cups: CASA,
      postalCode: '46183',
      province: 'VALENCIA',
      municipality: "L'ELIANA",
      distributor: 'I-DE REDES ELÉCTRICAS INTELIGENTES',
      validDateFrom: '2021/06/01',
      validDateTo: '',
      pointType: 5,
      distributorCode: '2',
    },
    {
      address: 'AVENIDA ANTIGUA 3, 1ºA',
      cups: ANTIGUO,
      postalCode: '28045',
      province: 'MADRID',
      municipality: 'MADRID',
      distributor: 'I-DE REDES ELÉCTRICAS INTELIGENTES',
      validDateFrom: '2016/01/10',
      validDateTo: '2019/03/14',
      pointType: 5,
      distributorCode: '2',
    },
  ] as Supply[];
}

function contracts(cups: string): ContractDetail[] {
  const common = {
    cups,
    distributor: 'I-DE REDES ELÉCTRICAS INTELIGENTES',
    tension: 'BAJA TENSIÓN',
    accessFare: '2.0TD',
    codeFare: '2T',
    timeDiscrimination: 'TARIFA DE TRES PERIODOS',
    modePowerControl: 'ICP',
    section: '1',
  };
  if (cups === CASA) {
    return [
      {
        ...common,
        marketer: 'SOL Y LUZ ENERGÍA SL',
        province: 'VALENCIA',
        municipality: "L'ELIANA",
        postalCode: '46183',
        contractedPowerkW: [5.75, 5.75],
        startDate: '2021/06/01',
        endDate: '',
        selfConsumptionTypeCode: '41',
        selfConsumptionTypeDesc: 'CON EXCEDENTES ACOGIDO A COMPENSACIÓN',
        cau: `${CASA}A000`,
        installedCapacityKW: 4.2,
        partitionCoefficient: 1,
        maxPowerInstall: '7.36',
        lastMarketerDate: '2021/06/01',
        dateOwner: [{ startDate: '2021/06/01', endDate: '' }],
      },
    ];
  }
  const change = monthsAgo(18);
  const before = new Date(Number(change.slice(0, 4)), Number(change.slice(5, 7)) - 1, 0);
  return [
    {
      ...common,
      marketer: 'ENERGÍA DE EJEMPLO SA',
      province: 'MADRID',
      municipality: 'MADRID',
      postalCode: '28013',
      contractedPowerkW: [3.45, 3.45],
      startDate: '2019/03/15',
      endDate: ymd(before),
      maxPowerInstall: '5.75',
      dateOwner: [{ startDate: '2019/03/15', endDate: '' }],
    },
    {
      ...common,
      marketer: 'LUZ CLARA COMERCIALIZADORA SL',
      province: 'MADRID',
      municipality: 'MADRID',
      postalCode: '28013',
      contractedPowerkW: [4.6, 4.6],
      startDate: change,
      endDate: '',
      maxPowerInstall: '5.75',
      lastMarketerDate: change,
      dateOwner: [{ startDate: '2019/03/15', endDate: '' }],
    },
  ];
}

/** Potencia media (kW) que demanda la vivienda en un cuarto de hora concreto */
function loadKW(cups: string, d: Date, quarter: number): number {
  const h = Math.floor(quarter / 4);
  const m = d.getMonth();
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  const day = ymd(d);
  const casa = cups === CASA;
  let kw = casa ? 0.18 : 0.13; // siempre encendido (nevera, router…)
  if (h >= 7 && h < 9 && !weekend) kw += 0.45; // desayuno, termo
  if (h >= 9 && h < 13 && weekend) kw += 0.35;
  if (h >= 13 && h < 15) kw += 0.55; // comida
  if (h >= 19 && h < 23) kw += 0.6; // cena, tele, luces
  if (h >= 23 || h < 1) kw += 0.15;
  // Estaciones: calefacción eléctrica en invierno, aire acondicionado en verano
  if ([11, 0, 1].includes(m) && ((h >= 7 && h < 10) || (h >= 18 && h < 24))) kw += casa ? 0.6 : 0.45;
  if ([6, 7].includes(m) && h >= 15 && h < 23) kw += casa ? 0.9 : 0.7;
  // Electrodomésticos fuertes unos minutos: horno, vitro, lavadora…
  const r = rand(`${cups}${day}`);
  if (h === 20 && quarter % 4 === Math.floor(r * 4)) kw += 1.2 + 1.9 * r * r;
  if (h === 14 && quarter % 4 === 1 && r > 0.55) kw += 1.4 + r * 1.2;
  if (weekend && h === 11 && quarter % 4 === 2 && r > 0.4) kw += 1.2; // lavadora
  return kw * (0.85 + rand(`${cups}${day}${quarter}`) * 0.3);
}

/** Generación solar (kW) de la casa en un cuarto de hora */
function solarKW(d: Date, quarter: number): number {
  const h = quarter / 4 + 0.125;
  const m = d.getMonth();
  const daylight = [9.5, 10.5, 12, 13, 14, 14.8, 14.5, 13.6, 12.4, 11, 9.8, 9.2][m];
  const noon = 13.8;
  const x = (h - noon) / (daylight / 2);
  if (Math.abs(x) >= 1) return 0;
  const strength = [0.45, 0.55, 0.68, 0.78, 0.86, 0.92, 0.95, 0.9, 0.78, 0.62, 0.5, 0.42][m];
  const clouds = 0.55 + rand(`sol${ymd(d)}`) * 0.45;
  return 4.2 * strength * clouds * Math.cos((x * Math.PI) / 2) ** 1.5;
}

/** Curva de consumo de un mes (horaria o cuartohoraria), como la devolvería Datadis */
function consumption(cups: string, ym: string, mt: MeasurementType): ConsumptionRaw[] {
  const [y, mo] = ym.split('/').map(Number);
  const sup = supplies().find((s) => s.cups === cups);
  if (!sup) return [];
  const today = new Date();
  const lastDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2); // publican con retraso
  const from = sup.validDateFrom;
  const to = sup.validDateTo || ymd(lastDay);
  const rows: ConsumptionRaw[] = [];
  const days = new Date(y, mo, 0).getDate();
  for (let dd = 1; dd <= days; dd++) {
    const d = new Date(y, mo - 1, dd);
    const day = ymd(d);
    if (day < from || day > to || d > lastDay) continue;
    const estimated = rand(`est${cups}${day}`) < 0.015;
    const quarters = Array.from({ length: 96 }, (_, q) => {
      const load = loadKW(cups, d, q) / 4; // kWh del cuarto de hora
      if (cups !== CASA) return { grid: load, surplus: 0, gen: 0, self: 0 };
      const gen = solarKW(d, q) / 4;
      const self = Math.min(gen, load);
      return { grid: load - self, surplus: gen - self, gen, self };
    });
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    const steps = mt === 1 ? 96 : 24;
    const per = 96 / steps;
    for (let i = 0; i < steps; i++) {
      const part = quarters.slice(i * per, (i + 1) * per);
      const sum = (k: 'grid' | 'surplus' | 'gen' | 'self') => r3(part.reduce((a, x) => a + x[k], 0));
      const endMin = (i + 1) * per * 15;
      rows.push({
        cups,
        date: day,
        time: `${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}`,
        consumptionKWh: sum('grid'),
        obtainMethod: estimated ? 'Estimada' : 'Real',
        surplusEnergyKWh: sum('surplus'),
        generationEnergyKWh: sum('gen'),
        selfConsumptionEnergyKWh: sum('self'),
      });
    }
  }
  return rows;
}

/** Potencias máximas (pico de 15 min) de cada mes y periodo, sacadas de la misma curva */
function maxPower(cups: string, start: string, end: string): MaxPowerRaw[] {
  const out: MaxPowerRaw[] = [];
  const [sy, sm] = start.split('/').map(Number);
  const [ey, em] = end.split('/').map(Number);
  for (let y = sy, m = sm; y < ey || (y === ey && m <= em); m === 12 ? ((m = 1), y++) : m++) {
    const rows = consumption(cups, `${y}/${pad(m)}`, 1);
    const best: Record<string, ConsumptionRaw> = {};
    for (const r of rows) {
      const [hh, mm] = r.time.split(':').map(Number);
      const [yy, mo, dd] = r.date.split('/').map(Number);
      const startQ = new Date(yy, mo - 1, dd, hh, mm - 15);
      const p = periodFor(startQ);
      const label = p === 'P1' ? 'PUNTA' : p === 'P2' ? 'LLANO' : 'VALLE';
      // El contador mide la potencia total demandada (con placas, la de la red)
      if (!best[label] || (r.consumptionKWh ?? 0) > (best[label].consumptionKWh ?? 0)) best[label] = r;
    }
    for (const [period, r] of Object.entries(best)) {
      out.push({ cups, date: r.date, time: r.time, maxPower: Math.round((r.consumptionKWh ?? 0) * 4 * 1000), period });
    }
  }
  return out;
}

function reactive(start: string, end: string): ReactiveRow[] {
  const out: ReactiveRow[] = [];
  const [sy, sm] = start.split('/').map(Number);
  const [ey, em] = end.split('/').map(Number);
  for (let y = sy, m = sm; y < ey || (y === ey && m <= em); m === 12 ? ((m = 1), y++) : m++) {
    const r = rand(`react${y}${m}`);
    out.push({ date: `${y}/${pad(m)}`, energy_p1: +(6 + r * 5).toFixed(2), energy_p2: +(4 + r * 3).toFixed(2), energy_p3: +(9 + r * 6).toFixed(2), energy_p4: 0, energy_p5: null, energy_p6: null });
  }
  return out;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const noErrors: DistributorError[] = [];

/** Cliente de Datadis simulado: mismas funciones, sin red */
export class DemoClient extends DatadisClient {
  constructor() {
    super(
      () => 'demo',
      async () => 'demo',
    );
  }

  async getDistributorsWithSupplies() {
    await wait(150);
    return { distributorCodes: ['2'], errors: noErrors };
  }

  async getSupplies() {
    await wait(300);
    return { supplies: supplies(), errors: noErrors };
  }

  async getContractDetail(cups: string) {
    await wait(200);
    return { contracts: contracts(cups), errors: noErrors };
  }

  async getConsumption(opts: { cups: string; startDate: string; endDate: string; measurementType: MeasurementType }) {
    await wait(120);
    const rows: ConsumptionRaw[] = [];
    const [sy, sm] = opts.startDate.split('/').map(Number);
    const [ey, em] = opts.endDate.split('/').map(Number);
    for (let y = sy, m = sm; y < ey || (y === ey && m <= em); m === 12 ? ((m = 1), y++) : m++) {
      rows.push(...consumption(opts.cups, `${y}/${pad(m)}`, opts.measurementType));
    }
    return { rows, errors: noErrors };
  }

  async getMaxPower(opts: { cups: string; startDate: string; endDate: string }) {
    await wait(200);
    return { rows: maxPower(opts.cups, opts.startDate, opts.endDate), errors: noErrors };
  }

  async getReactive(opts: { cups: string; startDate: string; endDate: string }) {
    await wait(150);
    return { rows: opts.cups === CASA ? [] : reactive(opts.startDate, opts.endDate), code: '200', codeDesc: 'OK', errors: noErrors };
  }
}
