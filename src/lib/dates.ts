/**
 * Utilidades para manejo de fechas de semanas y días
 */

export interface DayInfo {
  dateStr: string; // YYYY-MM-DD
  dayOfWeek: number; // 0 = Domingo, 1 = Lunes, ..., 6 = Sábado
  dayName: string; // Lunes, Martes...
  dayShort: string; // Lun, Mar...
  dayNumber: number; // 1..31
  monthName: string; // Octubre...
  isToday: boolean;
  isPast: boolean;
}

const DAYS_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DAYS_SHORT_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

/**
 * Formatea una fecha como YYYY-MM-DD en hora local
 */
export function formatDateYMD(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Obtiene la fecha de hoy en formato YYYY-MM-DD
 */
export function getTodayYMD(): string {
  return formatDateYMD(new Date());
}

/**
 * Devuelve el Lunes de la semana de la fecha dada
 */
export function getMondayOfWeek(date: Date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay();
  // En JS 0 = Domingo, 1 = Lunes...
  // Diferencia hasta el Lunes:
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Obtiene el número de semana ISO en el año
 */
export function getWeekNumber(date: Date = new Date()): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * Obtiene los 7 días de la semana (Lunes a Domingo) para la fecha dada
 */
export function getDaysOfWeek(referenceDate: Date = new Date()): DayInfo[] {
  const monday = getMondayOfWeek(referenceDate);
  const todayStr = getTodayYMD();
  const days: DayInfo[] = [];

  for (let i = 0; i < 7; i++) {
    const cur = new Date(monday);
    cur.setDate(monday.getDate() + i);
    const dateStr = formatDateYMD(cur);
    const dayOfWeek = cur.getDay();

    days.push({
      dateStr,
      dayOfWeek,
      dayName: DAYS_ES[dayOfWeek],
      dayShort: DAYS_SHORT_ES[dayOfWeek],
      dayNumber: cur.getDate(),
      monthName: MONTHS_ES[cur.getMonth()],
      isToday: dateStr === todayStr,
      isPast: dateStr < todayStr,
    });
  }

  return days;
}
