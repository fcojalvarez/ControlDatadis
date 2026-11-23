/**
 * Periodos horarios de la tarifa de acceso 2.0TD (Circular CNMC 3/2020), península,
 * Baleares, Canarias, Ceuta y Melilla (horario peninsular en hora local):
 *
 *  Lunes a viernes laborables:
 *    P1 (punta): 10-14 y 18-22
 *    P2 (llano): 08-10, 14-18 y 22-24
 *    P3 (valle): 00-08
 *  Sábados, domingos y festivos nacionales de fecha fija: todo el día P3.
 */

export type Period = 'P1' | 'P2' | 'P3';
export const PERIODS: Period[] = ['P1', 'P2', 'P3'];

export const PERIOD_LABELS: Record<Period, string> = {
  P1: 'Punta',
  P2: 'Llano',
  P3: 'Valle',
};

// Festivos nacionales no sustituibles y de fecha fija (MM-DD)
const NATIONAL_HOLIDAYS = new Set(['01-01', '01-06', '05-01', '08-15', '10-12', '11-01', '12-06', '12-08', '12-25']);

export function isHolidayOrWeekend(d: Date): boolean {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return true;
  const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return NATIONAL_HOLIDAYS.has(md);
}

/** Periodo para un intervalo que COMIENZA en la fecha/hora `start`. */
export function periodFor(start: Date): Period {
  if (isHolidayOrWeekend(start)) return 'P3';
  const h = start.getHours();
  if (h < 8) return 'P3';
  if ((h >= 10 && h < 14) || (h >= 18 && h < 22)) return 'P1';
  return 'P2';
}

/**
 * Periodo de un pico de potencia de Datadis. Según la distribuidora llega como «PUNTA»/«LLANO»/
 * «VALLE», «P1»…«P3» o simplemente «1»…«3».
 */
export function maxPowerPeriod(p: string | number | null | undefined): Period {
  const s = String(p ?? '').trim().toUpperCase();
  if (/^(P?3|VALLE)$/.test(s)) return 'P3';
  if (/^(P?2|LLANO)$/.test(s)) return 'P2';
  return 'P1';
}
