const nf = (digits: number) =>
  new Intl.NumberFormat('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return nf(digits).format(n);
}

export function fmtKWh(n: number | null | undefined, digits = 2): string {
  return `${fmtNum(n, digits)} kWh`;
}

export function fmtKW(n: number | null | undefined, digits = 2): string {
  return `${fmtNum(n, digits)} kW`;
}

export function fmtEur(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
}

export const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
export const WEEKDAYS_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
export const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

/** '2024/03/05' o '2024-03-05' -> '5 mar 2024' */
export function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  const m = s.match(/^(\d{4})[/-](\d{2})(?:[/-](\d{2}))?/);
  if (!m) return s;
  const [, y, mo, d] = m;
  if (!d) return `${MONTHS_SHORT[Number(mo) - 1]} ${y}`;
  return `${Number(d)} ${MONTHS_SHORT[Number(mo) - 1]} ${y}`;
}

/** '2024/03/05' o '2024-03-05' -> '5 mar' */
export function fmtDayMonth(s: string): string {
  const m = s.match(/^\d{4}[/-](\d{2})[/-](\d{2})/);
  return m ? `${Number(m[2])} ${MONTHS_SHORT[Number(m[1]) - 1]}` : s;
}

/** '2026/11/16' -> 'Lunes 16 nov 2026' (o sin año) */
export function fmtWeekdayDate(s: string, withYear = true): string {
  const m = s.match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  if (!m) return s;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${WEEKDAYS[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ''}`;
}

/** Hora «HH:MM» de una marca de tiempo (ms) */
export function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** '2024-03' -> 'marzo 2024' */
export function fmtMonthLong(key: string): string {
  const m = key.match(/^(\d{4})[/-](\d{2})/);
  if (!m) return key;
  return `${MONTHS_LONG[Number(m[2]) - 1]} ${m[1]}`;
}

/** '2024-03' -> 'mar 24' */
export function fmtMonthShort(key: string): string {
  const m = key.match(/^(\d{4})[/-](\d{2})/);
  if (!m) return key;
  return `${MONTHS_SHORT[Number(m[2]) - 1]} ${m[1].slice(2)}`;
}

/** '2024-03-05' -> '5/3' */
export function fmtDayShort(key: string): string {
  const m = key.match(/^\d{4}-(\d{2})-(\d{2})/);
  if (!m) return key;
  return `${Number(m[2])}/${Number(m[1])}`;
}

/** Probabilidad (0..1) como porcentaje legible: '<1 %', '12 %', '>99 %' */
export function fmtPct(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return '0 %';
  if (p < 0.01) return '<1 %';
  if (p > 0.99 && p < 1) return '>99 %';
  return `${Math.round(p * 100)} %`;
}

export function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function pad2(n: number) {
  return String(n).padStart(2, '0');
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function ym(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}


/**
 * Textos que Datadis da en MAYÚSCULAS, más legibles:
 *  - 'name' (empresas, municipios): «COMERCIALIZADORA EJEMPLO SL» → «Comercializadora Ejemplo SL»
 *  - 'sentence' (descripciones): «TARIFA DE TRES PERIODOS» → «Tarifa de tres periodos»
 * Siglas y códigos (SL, S.A.U., I-DE, 2.0TD) se respetan. Si el texto ya trae minúsculas, no se toca.
 */
export function titleCase(s: string, mode: 'name' | 'company' | 'sentence' = 'name'): string {
  if (s !== s.toUpperCase()) return s;
  const keep = new Set(['SL', 'SA', 'SAU', 'SLU', 'CB', 'SC']);
  const lower = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'a']);
  return s
    .toLowerCase()
    .split(/(\s+)/)
    .map((w, i) => {
      const up = w.toUpperCase();
      if (keep.has(up) || /\d/.test(w) || (w.length <= 6 && /[-.]/.test(w) && /[a-z]/.test(w))) return up;
      // En nombres de empresa, las palabras de 2-3 letras suelen ser siglas (UFD, EDP)
      if (mode === 'company' && w.length >= 2 && w.length <= 3 && !lower.has(w)) return up;
      if (i > 0 && (mode === 'sentence' || lower.has(w))) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join('');
}
