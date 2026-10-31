import { calculateDaysBetweenDates } from './debtCalculator';
import { toISODate } from './formatters';
import type {
  AppSettings,
  DailyEntry,
  Employee,
  Payment,
  PaymentCoveredItem,
  PayrollClosure,
  SellerPaymentMode,
  SellerPaymentType,
} from '../types';

export interface PaidEntryRecord {
  payment: Payment;
  coveredItem: PaymentCoveredItem;
}

export type DayPaymentStatus =
  | { status: 'incomplete' }
  | { status: 'paid'; payment: Payment; coveredItem: PaymentCoveredItem }
  | { status: 'unpaid' };

export interface SellerUnpaidReminderItem {
  employeeId: string;
  employeeName: string;
  daysCount: number;
  amountFC: number;
  oldestDate: string;
}

export interface UnpaidDaysReminderResult {
  thresholdDays: number;
  totalDays: number;
  totalAmountFC: number;
  sellers: SellerUnpaidReminderItem[];
}

/**
 * Formate une date ISO YYYY-MM-DD en jj/mm (ex: "15/10").
 */
export function formatShortDayMonth(isoDate?: string | null): string {
  if (!isoDate) return '-';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}`;
}

export function formatPaymentTypeLabel(type?: SellerPaymentType): string {
  switch (type) {
    case 'advance':
      return 'Avance';
    case 'final':
      return 'Solde final';
    case 'by_days':
      return 'Paiement par jours';
    case 'salary':
    default:
      return 'Règlement';
  }
}

export function formatPaymentModeLabel(mode?: SellerPaymentMode): string {
  switch (mode) {
    case 'mobile_money':
      return 'Mobile money';
    case 'autre':
      return 'Autre';
    case 'especes':
    default:
      return 'Espèces';
  }
}

/**
 * Construit dynamiquement l'index des saisies déjà couvertes par un paiement.
 * Jamais stocké sur DailyEntry : supprimer ou modifier un paiement libère aussitôt ses jours.
 */
export function buildPaidEntryMap(
  payments: Payment[],
  excludePaymentId?: string
): Map<string, PaidEntryRecord> {
  const map = new Map<string, PaidEntryRecord>();
  for (const payment of payments) {
    if (excludePaymentId && payment.id === excludePaymentId) continue;
    if (!Array.isArray(payment.coveredItems) || payment.coveredItems.length === 0) continue;
    for (const item of payment.coveredItems) {
      if (!item || !item.entryId) continue;
      map.set(item.entryId, { payment, coveredItem: item });
    }
  }
  return map;
}

/**
 * Retourne le statut dynamique d'une saisie journalière :
 * - 'incomplete' si la saisie est "À compléter plus tard"
 * - 'paid' si son id figure dans coveredItems d'un paiement existant
 * - 'unpaid' sinon
 */
export function getEntryPaymentStatus(
  entry: DailyEntry,
  paidEntryMap: Map<string, PaidEntryRecord>
): DayPaymentStatus {
  if ((entry.status || 'validated') === 'incomplete') {
    return { status: 'incomplete' };
  }
  const hit = paidEntryMap.get(entry.id);
  if (hit) {
    return {
      status: 'paid',
      payment: hit.payment,
      coveredItem: hit.coveredItem,
    };
  }
  return { status: 'unpaid' };
}

/**
 * Répartit le montant d'un paiement par mois :
 * - Sans coveredItems : 100 % sur payment.month (comportement historique).
 * - Avec coveredItems : au prorata des commissions couvertes dans chaque mois
 *   (le reliquat d'arrondi est affecté au dernier mois pour que la somme tombe juste).
 */
export function getPaymentMonthShares(payment: Payment): Record<string, number> {
  const amount = Math.round(payment.amountFC || 0);
  if (!Array.isArray(payment.coveredItems) || payment.coveredItems.length === 0) {
    return payment.month ? { [payment.month]: amount } : {};
  }

  const commByMonth: Record<string, number> = {};
  const countByMonth: Record<string, number> = {};
  let totalCoveredComm = 0;

  for (const it of payment.coveredItems) {
    if (!it?.date) continue;
    const m = it.date.slice(0, 7);
    if (!m) continue;
    const c = Math.max(0, Number(it.commissionFC) || 0);
    commByMonth[m] = (commByMonth[m] || 0) + c;
    countByMonth[m] = (countByMonth[m] || 0) + 1;
    totalCoveredComm += c;
  }

  const months = Object.keys(countByMonth).sort();
  if (months.length === 0) {
    return payment.month ? { [payment.month]: amount } : {};
  }
  if (months.length === 1) {
    return { [months[0]]: amount };
  }

  const shares: Record<string, number> = {};
  let remaining = amount;
  const totalItems = payment.coveredItems.length;

  for (let i = 0; i < months.length; i++) {
    const m = months[i];
    if (i === months.length - 1) {
      shares[m] = remaining;
    } else {
      const share =
        totalCoveredComm > 0
          ? Math.round((amount * (commByMonth[m] || 0)) / totalCoveredComm)
          : Math.round((amount * (countByMonth[m] || 0)) / totalItems);
      shares[m] = share;
      remaining -= share;
    }
  }

  return shares;
}

export function getPaymentShareForMonth(payment: Payment, month: string): number {
  if (!month) return 0;
  const shares = getPaymentMonthShares(payment);
  return shares[month] || 0;
}

export function paymentTouchesMonth(payment: Payment, month: string): boolean {
  if (!month) return false;
  if (Array.isArray(payment.coveredItems) && payment.coveredItems.length > 0) {
    return payment.coveredItems.some((it) => it?.date?.startsWith(month));
  }
  return payment.month === month;
}

/**
 * Retourne tous les paiements qui concernent un mois donné (et optionnellement une vendeuse).
 */
export function getPaymentsTouchingMonth(
  payments: Payment[],
  month: string,
  employeeId?: string
): Payment[] {
  return payments.filter((p) => {
    if (employeeId && p.employeeId !== employeeId) return false;
    return paymentTouchesMonth(p, month);
  });
}

/**
 * Calcule "Payé du mois" pour une vendeuse sur un mois YYYY-MM.
 */
export function getEmployeePaidForMonth(
  payments: Payment[],
  employeeId: string,
  month: string
): number {
  let sum = 0;
  for (const p of payments) {
    if (p.employeeId !== employeeId) continue;
    if (!paymentTouchesMonth(p, month)) continue;
    sum += getPaymentShareForMonth(p, month);
  }
  return Math.round(sum);
}

/**
 * Normalise payrollClosures (objet indexé par `${employeeId}_${month}` ou tableau historique).
 */
export function normalizePayrollClosures(
  raw: AppSettings['payrollClosures']
): Record<string, PayrollClosure> {
  const result: Record<string, PayrollClosure> = {};
  if (!raw) return result;

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const empId = String((item as any).employeeId || '');
      const month = String((item as any).month || '');
      if (!month) continue;
      const key = empId ? `${empId}_${month}` : month;
      result[key] = {
        employeeId: empId,
        month,
        closedAt: Number((item as any).closedAt) || Date.now(),
        forgivenFC:
          (item as any).forgivenFC !== undefined
            ? Math.round(Number((item as any).forgivenFC) || 0)
            : undefined,
      };
    }
    return result;
  }

  if (typeof raw === 'object') {
    for (const [k, val] of Object.entries(raw)) {
      if (!val) continue;
      if (typeof val === 'object') {
        const empId = String((val as any).employeeId || k.split('_')[0] || '');
        const month = String((val as any).month || k.split('_').slice(-1)[0] || '');
        if (!month) continue;
        const normKey = empId && empId !== month ? `${empId}_${month}` : k;
        result[normKey] = {
          employeeId: empId,
          month,
          closedAt: Number((val as any).closedAt) || Date.now(),
          forgivenFC:
            (val as any).forgivenFC !== undefined
              ? Math.round(Number((val as any).forgivenFC) || 0)
              : undefined,
        };
      } else if (val === true) {
        // Tolérance si une ancienne clôture booléenne existe
        const sepIdx = k.lastIndexOf('_');
        const empId = sepIdx > 0 ? k.slice(0, sepIdx) : '';
        const month = sepIdx > 0 ? k.slice(sepIdx + 1) : k;
        result[k] = {
          employeeId: empId,
          month,
          closedAt: 0,
        };
      }
    }
  }

  return result;
}

export function isSellerMonthClosed(
  raw: AppSettings['payrollClosures'],
  employeeId: string,
  month: string
): boolean {
  if (!month) return false;
  const map = normalizePayrollClosures(raw);
  return Boolean(map[`${employeeId}_${month}`] || map[month] || map[`all_${month}`]);
}

export function upsertSellerMonthClosure(
  raw: AppSettings['payrollClosures'],
  closure: PayrollClosure
): Record<string, PayrollClosure> {
  const next = normalizePayrollClosures(raw);
  const cleanClosure: PayrollClosure = {
    employeeId: closure.employeeId,
    month: closure.month,
    closedAt: closure.closedAt || Date.now(),
  };
  if (closure.forgivenFC !== undefined && closure.forgivenFC > 0) {
    cleanClosure.forgivenFC = Math.round(closure.forgivenFC);
  }
  next[`${closure.employeeId}_${closure.month}`] = cleanClosure;
  return next;
}

/**
 * Calcule le rappel des jours non payés depuis plus de N jours (unpaidDaysReminder).
 * - Ignore les saisies "À compléter" (incomplete)
 * - Ignore les mois clôturés (payrollClosures) et les mois déjà intégralement soldés
 * - Ignore les vendeur(se)s archivé(e)s
 */
export function computeUnpaidDaysReminder(params: {
  dailyEntries: DailyEntry[];
  payments: Payment[];
  employees: Employee[];
  unpaidDaysReminder?: number;
  payrollClosures?: AppSettings['payrollClosures'];
  caisseStartDate?: string;
  todayStr?: string;
}): UnpaidDaysReminderResult | null {
  const {
    dailyEntries,
    payments,
    employees,
    unpaidDaysReminder,
    payrollClosures,
    caisseStartDate,
    todayStr = toISODate(new Date()),
  } = params;

  const thresholdDays =
    unpaidDaysReminder !== undefined && Number.isFinite(Number(unpaidDaysReminder))
      ? Math.max(0, Math.floor(Number(unpaidDaysReminder)))
      : 7;

  const activeEmpMap = new Map<string, Employee>();
  for (const emp of employees) {
    if (!emp.isArchived) {
      activeEmpMap.set(emp.id, emp);
    }
  }
  if (activeEmpMap.size === 0) return null;

  const paidMap = buildPaidEntryMap(payments);

  // Calcul par (vendeuse, mois) pour ignorer un mois déjà soldé à 100 % par des paiements mensuels historiques
  const earnedByEmpMonth = new Map<string, number>();
  for (const entry of dailyEntries) {
    if (!entry.date || !entry.employeeId) continue;
    const ym = entry.date.slice(0, 7);
    const key = `${entry.employeeId}_${ym}`;
    earnedByEmpMonth.set(key, (earnedByEmpMonth.get(key) || 0) + (entry.employeeCommissionFC || 0));
  }

  const settledEmpMonthCache = new Map<string, boolean>();
  const isEmpMonthSettled = (empId: string, ym: string): boolean => {
    const key = `${empId}_${ym}`;
    if (settledEmpMonthCache.has(key)) return settledEmpMonthCache.get(key)!;
    const earned = earnedByEmpMonth.get(key) || 0;
    const paid = getEmployeePaidForMonth(payments, empId, ym);
    const settled = earned - paid <= 0;
    settledEmpMonthCache.set(key, settled);
    return settled;
  };

  const perSeller = new Map<string, SellerUnpaidReminderItem>();

  for (const entry of dailyEntries) {
    const emp = activeEmpMap.get(entry.employeeId);
    if (!emp) continue;
    if (!entry.date) continue;
    if ((entry.status || 'validated') === 'incomplete') continue;
    if (paidMap.has(entry.id)) continue;

    const comm = Math.round(entry.employeeCommissionFC || 0);
    if (comm <= 0) continue;

    if (caisseStartDate && entry.date < caisseStartDate) continue;

    const ym = entry.date.slice(0, 7);
    if (isSellerMonthClosed(payrollClosures, emp.id, ym)) continue;
    if (isEmpMonthSettled(emp.id, ym)) continue;

    const elapsedDays = calculateDaysBetweenDates(entry.date, todayStr);
    if (elapsedDays <= thresholdDays) continue;

    const existing = perSeller.get(emp.id);
    if (existing) {
      existing.daysCount += 1;
      existing.amountFC += comm;
      if (entry.date < existing.oldestDate) {
        existing.oldestDate = entry.date;
      }
    } else {
      perSeller.set(emp.id, {
        employeeId: emp.id,
        employeeName: emp.name,
        daysCount: 1,
        amountFC: comm,
        oldestDate: entry.date,
      });
    }
  }

  if (perSeller.size === 0) return null;

  const sellers = Array.from(perSeller.values()).sort(
    (a, b) => a.oldestDate.localeCompare(b.oldestDate) || b.amountFC - a.amountFC
  );

  const totalDays = sellers.reduce((sum, s) => sum + s.daysCount, 0);
  const totalAmountFC = sellers.reduce((sum, s) => sum + s.amountFC, 0);

  return {
    thresholdDays,
    totalDays,
    totalAmountFC,
    sellers,
  };
}
