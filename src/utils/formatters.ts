/**
 * Formats a number as FC currency: "10 000 FC"
 */
export function formatFC(amount: number | null | undefined, currency = 'FC'): string {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return `0 ${currency}`;
  }
  const rounded = Math.round(amount);
  // Format with spaces as thousands separator
  const formatted = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${formatted} ${currency}`;
}

/**
 * Formats a standard date YYYY-MM-DD to jj/mm/aaaa
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return dateStr;
  }
}

/**
 * Formats a number as percentage with 1 decimal place: "12,5 %"
 * Returns "0,0 %" or "-" if denominator is 0.
 */
export function formatPercent(
  value: number | null | undefined,
  fallback = '0,0 %'
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return fallback;
  }
  const formatted = value.toFixed(1).replace('.', ',');
  return `${formatted} %`;
}

/**
 * Safe division returning 0 if denominator is 0.
 */
export function safeDivide(numerator: number, denominator: number): number {
  if (!denominator || isNaN(denominator) || denominator === 0) {
    return 0;
  }
  return numerator / denominator;
}

/**
 * Safe percentage (numerator / denominator * 100)
 */
export function safePercentage(numerator: number, denominator: number): number {
  if (!denominator || isNaN(denominator) || denominator === 0) {
    return 0;
  }
  return (numerator / denominator) * 100;
}

/**
 * Formats a Date object to YYYY-MM-DD
 */
export function toISODate(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns the current month formatted as YYYY-MM
 */
export function toISOMonth(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Gets human-readable month name in French (e.g. "Octobre 2026")
 */
export function formatMonthName(yearMonth: string): string {
  if (!yearMonth) return '';
  const [yearStr, monthStr] = yearMonth.split('-');
  const monthNames = [
    'Janvier',
    'Février',
    'Mars',
    'Avril',
    'Mai',
    'Juin',
    'Juillet',
    'Août',
    'Septembre',
    'Octobre',
    'Novembre',
    'Décembre',
  ];
  const mIndex = parseInt(monthStr, 10) - 1;
  if (mIndex >= 0 && mIndex < 12) {
    return `${monthNames[mIndex]} ${yearStr}`;
  }
  return yearMonth;
}

/**
 * Day name in French
 */
export function getFrenchDayName(dateStr: string): string {
  const days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return days[d.getDay()];
}

/**
 * Date range helper for period filters
 */
export function getDateRangeForFilter(
  filterType: 'today' | 'this_week' | 'this_month' | 'last_month' | 'custom',
  customStart?: string,
  customEnd?: string
): { startDate: string; endDate: string; prevStartDate: string; prevEndDate: string } {
  const now = new Date();
  const todayStr = toISODate(now);

  if (filterType === 'today') {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = toISODate(yesterday);
    return {
      startDate: todayStr,
      endDate: todayStr,
      prevStartDate: yStr,
      prevEndDate: yStr,
    };
  }

  if (filterType === 'this_week') {
    const dayOfWeek = now.getDay(); // 0 is Sunday, 1 is Monday...
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    // Prev week
    const prevMonday = new Date(monday);
    prevMonday.setDate(monday.getDate() - 7);
    const prevSunday = new Date(sunday);
    prevSunday.setDate(sunday.getDate() - 7);

    return {
      startDate: toISODate(monday),
      endDate: toISODate(sunday),
      prevStartDate: toISODate(prevMonday),
      prevEndDate: toISODate(prevSunday),
    };
  }

  if (filterType === 'this_month') {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const prevMonthFirst = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthLast = new Date(now.getFullYear(), now.getMonth(), 0);

    return {
      startDate: toISODate(firstDay),
      endDate: toISODate(lastDay),
      prevStartDate: toISODate(prevMonthFirst),
      prevEndDate: toISODate(prevMonthLast),
    };
  }

  if (filterType === 'last_month') {
    const prevMonthFirst = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthLast = new Date(now.getFullYear(), now.getMonth(), 0);

    const prev2MonthFirst = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const prev2MonthLast = new Date(now.getFullYear(), now.getMonth() - 1, 0);

    return {
      startDate: toISODate(prevMonthFirst),
      endDate: toISODate(prevMonthLast),
      prevStartDate: toISODate(prev2MonthFirst),
      prevEndDate: toISODate(prev2MonthLast),
    };
  }

  // Custom
  const start = customStart || todayStr;
  const end = customEnd || todayStr;
  const sDate = new Date(start);
  const eDate = new Date(end);
  const durationMs = eDate.getTime() - sDate.getTime();
  const prevEnd = new Date(sDate.getTime() - 24 * 60 * 60 * 1000);
  const prevStart = new Date(prevEnd.getTime() - durationMs);

  return {
    startDate: start,
    endDate: end,
    prevStartDate: toISODate(prevStart),
    prevEndDate: toISODate(prevEnd),
  };
}
