import type { Customer, DebtPayment, PersonalSale } from '../types';
import { toISODate } from './formatters';

export interface PaymentAllocationSlice {
  saleId?: string;
  amountFC: number;
  reserveFC: number;
  beneficesFC: number;
  ownerCommissionFC: number;
  ownerShareFC: number;
}

export interface AllocatedDebtPayment {
  payment: DebtPayment;
  date: string;
  customerId: string;
  totalAmountFC: number;
  reserveFC: number;
  beneficesFC: number;
  ownerCommissionFC: number;
  ownerShareFC: number;
  slices: PaymentAllocationSlice[];
}

export interface SaleDebtStatus {
  sale: PersonalSale;
  saleId: string;
  totalFC: number;
  paidFC: number;
  writtenOffFC: number;
  remainingFC: number;
  status: 'unpaid' | 'partial' | 'paid' | 'written_off';
}

export type CustomerDebtBadge = 'Non payé' | 'Partiel' | 'Payé';

export interface CustomerDebtSummary {
  customer: Customer;
  sales: SaleDebtStatus[];
  payments: DebtPayment[];
  totalCreditFC: number;
  totalPaidFC: number;
  totalWrittenOffFC: number;
  remainingFC: number;
  oldestUnpaidDate: string | null;
  daysOverdue: number;
  isOverdue: boolean;
  badge: CustomerDebtBadge;
  hasAnyWrittenOff: boolean;
}

export interface DebtComputationResult {
  paymentAllocations: AllocatedDebtPayment[];
  saleStatusMap: Map<string, SaleDebtStatus>;
  customerSummaries: CustomerDebtSummary[];
  totalRemainingFC: number;
  debtorCount: number;
  overdueCount: number;
}

/**
 * Normalise un nom de client pour vérifier l'unicité sans tenir compte des majuscules ni des espaces superflus.
 */
export function normalizeCustomerName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr');
}

/**
 * Vérifie si un nom de client existe déjà (sans tenir compte des majuscules).
 */
export function findCustomerByNormalizedName(
  customers: Customer[],
  name: string,
  excludeCustomerId?: string
): Customer | undefined {
  const target = normalizeCustomerName(name);
  if (!target) return undefined;
  return customers.find(
    (c) => c.id !== excludeCustomerId && normalizeCustomerName(c.name) === target
  );
}

/**
 * Nombre de jours entiers écoulés entre `fromDateStr` (YYYY-MM-DD) et `toDateStr` (YYYY-MM-DD).
 */
export function calculateDaysBetweenDates(fromDateStr: string, toDateStr: string = toISODate(new Date())): number {
  if (!fromDateStr || !toDateStr) return 0;
  const [fy, fm, fd] = fromDateStr.split('-').map((n) => parseInt(n, 10));
  const [ty, tm, td] = toDateStr.split('-').map((n) => parseInt(n, 10));
  if (!fy || !fm || !fd || !ty || !tm || !td) return 0;
  const fromUtc = Date.UTC(fy, fm - 1, fd);
  const toUtc = Date.UTC(ty, tm - 1, td);
  return Math.max(0, Math.floor((toUtc - fromUtc) / (24 * 60 * 60 * 1000)));
}

/**
 * Calcule la répartition d'une tranche `amountFC` affectée à une vente à crédit `sale`
 * selon la règle d'encaissement :
 * - Vente normale : part Caisse Réserve = arrondi(A × S.expenseReserveFC ÷ S.totalSalesFC), Bénéfices = A − part Réserve
 * - Ancienne dette (isOpeningDebt) : utilise le pourcentage de réserve actuel des Paramètres
 */
function splitPaymentSliceForSale(
  amountFC: number,
  sale: PersonalSale | null,
  currentReserveRatePct: number
): PaymentAllocationSlice {
  const A = Math.round(amountFC);
  if (A <= 0) {
    return {
      saleId: sale?.id,
      amountFC: 0,
      reserveFC: 0,
      beneficesFC: 0,
      ownerCommissionFC: 0,
      ownerShareFC: 0,
    };
  }

  if (!sale || sale.isOpeningDebt || !sale.totalSalesFC || sale.totalSalesFC <= 0) {
    const reserveFC = Math.round((A * currentReserveRatePct) / 100);
    const beneficesFC = A - reserveFC;
    return {
      saleId: sale?.id,
      amountFC: A,
      reserveFC,
      beneficesFC,
      ownerCommissionFC: 0,
      ownerShareFC: beneficesFC,
    };
  }

  const saleReserveFC =
    sale.expenseReserveFC !== undefined
      ? sale.expenseReserveFC
      : Math.round((sale.totalSalesFC * currentReserveRatePct) / 100);

  const reserveFC = Math.round((A * saleReserveFC) / sale.totalSalesFC);
  const beneficesFC = A - reserveFC;

  const rawCommFC = sale.ownerCommissionFC
    ? Math.round((A * sale.ownerCommissionFC) / sale.totalSalesFC)
    : 0;
  const ownerCommissionFC = Math.max(0, Math.min(beneficesFC, rawCommFC));
  const ownerShareFC = beneficesFC - ownerCommissionFC;

  return {
    saleId: sale.id,
    amountFC: A,
    reserveFC,
    beneficesFC,
    ownerCommissionFC,
    ownerShareFC,
  };
}

/**
 * Moteur FIFO d'affectation des paiements de dettes et d'état des dettes clients.
 * - Chaque paiement est appliqué d'abord à la dette la plus ancienne du client (date ASC, puis createdAt ASC).
 * - Les ventes 'paid' ou sans paymentStatus et les consommations sont ignorées ici.
 */
export function computeDebtAllocations(
  personalSales: PersonalSale[],
  debtPayments: DebtPayment[],
  currentReserveRatePct = 50,
  customers: Customer[] = [],
  debtReminderDays = 2,
  todayStr: string = toISODate(new Date())
): DebtComputationResult {
  const creditSales = personalSales.filter(
    (s) => s.kind !== 'consommation' && s.paymentStatus === 'credit'
  );

  // Regroupement par customerId (ou fallback sur clé dérivée si ancien enregistrement sans id)
  const customerMap = new Map<string, Customer>();
  for (const c of customers) {
    customerMap.set(c.id, c);
  }

  for (const s of creditSales) {
    const cId = s.customerId || `orphan_${normalizeCustomerName(s.customerName || s.id)}`;
    if (!customerMap.has(cId)) {
      customerMap.set(cId, {
        id: cId,
        name: s.customerName || 'Client',
        createdAt: s.createdAt || 0,
      });
    }
  }

  for (const p of debtPayments) {
    if (p.customerId && !customerMap.has(p.customerId)) {
      customerMap.set(p.customerId, {
        id: p.customerId,
        name: 'Client',
        createdAt: p.createdAt || 0,
      });
    }
  }

  const salesByCustomer = new Map<string, PersonalSale[]>();
  for (const s of creditSales) {
    const cId = s.customerId || `orphan_${normalizeCustomerName(s.customerName || s.id)}`;
    const arr = salesByCustomer.get(cId) || [];
    arr.push(s);
    salesByCustomer.set(cId, arr);
  }

  const paymentsByCustomer = new Map<string, DebtPayment[]>();
  for (const p of debtPayments) {
    const arr = paymentsByCustomer.get(p.customerId) || [];
    arr.push(p);
    paymentsByCustomer.set(p.customerId, arr);
  }

  const saleStatusMap = new Map<string, SaleDebtStatus>();
  const paymentAllocations: AllocatedDebtPayment[] = [];
  const customerSummaries: CustomerDebtSummary[] = [];

  for (const [customerId, customer] of customerMap.entries()) {
    const cSales = [...(salesByCustomer.get(customerId) || [])].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if ((a.createdAt || 0) !== (b.createdAt || 0)) return (a.createdAt || 0) - (b.createdAt || 0);
      return a.id.localeCompare(b.id);
    });

    const cPayments = [...(paymentsByCustomer.get(customerId) || [])].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if ((a.createdAt || 0) !== (b.createdAt || 0)) return (a.createdAt || 0) - (b.createdAt || 0);
      return a.id.localeCompare(b.id);
    });

    // Suivi du montant déjà payé sur chaque vente de ce client
    const paidPerSale = new Map<string, number>();
    for (const s of cSales) {
      paidPerSale.set(s.id, 0);
    }

    // Affectation FIFO de chaque paiement aux ventes les plus anciennes
    for (const pay of cPayments) {
      let remainingToAllocate = Math.max(0, Math.round(pay.amountFC || 0));
      const slices: PaymentAllocationSlice[] = [];

      for (const sale of cSales) {
        if (remainingToAllocate <= 0) break;
        const totalFC = Math.max(0, Math.round(sale.totalSalesFC || 0));
        const writtenOffFC = Math.max(0, Math.round(sale.writtenOffFC || 0));
        const alreadyPaid = paidPerSale.get(sale.id) || 0;
        const payableCapacity = Math.max(0, totalFC - writtenOffFC - alreadyPaid);
        if (payableCapacity <= 0) continue;

        const applied = Math.min(remainingToAllocate, payableCapacity);
        paidPerSale.set(sale.id, alreadyPaid + applied);
        remainingToAllocate -= applied;

        slices.push(splitPaymentSliceForSale(applied, sale, currentReserveRatePct));
      }

      // Si un surplus de paiement dépasse les dettes actuelles
      if (remainingToAllocate > 0) {
        slices.push(splitPaymentSliceForSale(remainingToAllocate, null, currentReserveRatePct));
      }

      const reserveFC = slices.reduce((sum, sl) => sum + sl.reserveFC, 0);
      const beneficesFC = slices.reduce((sum, sl) => sum + sl.beneficesFC, 0);
      const ownerCommissionFC = slices.reduce((sum, sl) => sum + sl.ownerCommissionFC, 0);
      const ownerShareFC = slices.reduce((sum, sl) => sum + sl.ownerShareFC, 0);

      paymentAllocations.push({
        payment: pay,
        date: pay.date,
        customerId,
        totalAmountFC: Math.max(0, Math.round(pay.amountFC || 0)),
        reserveFC,
        beneficesFC,
        ownerCommissionFC,
        ownerShareFC,
        slices,
      });
    }

    // Construction des statuts par vente
    const saleStatuses: SaleDebtStatus[] = cSales.map((sale) => {
      const totalFC = Math.max(0, Math.round(sale.totalSalesFC || 0));
      const paidFC = paidPerSale.get(sale.id) || 0;
      const writtenOffFC = Math.min(
        Math.max(0, totalFC - paidFC),
        Math.max(0, Math.round(sale.writtenOffFC || 0))
      );
      const remainingFC = Math.max(0, totalFC - paidFC - writtenOffFC);

      let status: SaleDebtStatus['status'] = 'unpaid';
      if (remainingFC === 0) {
        status = writtenOffFC > 0 && paidFC < totalFC ? 'written_off' : 'paid';
      } else if (paidFC > 0) {
        status = 'partial';
      } else {
        status = 'unpaid';
      }

      const st: SaleDebtStatus = {
        sale,
        saleId: sale.id,
        totalFC,
        paidFC,
        writtenOffFC,
        remainingFC,
        status,
      };
      saleStatusMap.set(sale.id, st);
      return st;
    });

    const totalCreditFC = saleStatuses.reduce((sum, st) => sum + st.totalFC, 0);
    const totalPaidFC = cPayments.reduce((sum, p) => sum + Math.max(0, Math.round(p.amountFC || 0)), 0);
    const totalWrittenOffFC = saleStatuses.reduce((sum, st) => sum + st.writtenOffFC, 0);
    const remainingFC = saleStatuses.reduce((sum, st) => sum + st.remainingFC, 0);

    const openSales = saleStatuses.filter((st) => st.remainingFC > 0);
    const oldestUnpaidDate = openSales.length > 0 ? openSales[0].sale.date : null;
    const daysOverdue = oldestUnpaidDate ? calculateDaysBetweenDates(oldestUnpaidDate, todayStr) : 0;
    const isOverdue = remainingFC > 0 && daysOverdue > debtReminderDays;

    let badge: CustomerDebtBadge = 'Payé';
    if (remainingFC > 0) {
      const hasPartialOnOpen = openSales.some((st) => st.paidFC > 0);
      badge = hasPartialOnOpen ? 'Partiel' : 'Non payé';
    }

    const hasAnyWrittenOff = saleStatuses.some((st) => (st.sale.writtenOffFC || 0) > 0);

    // Inclure tous les clients enregistrés dans la table customers (ou ayant des ventes/paiements)
    if (customers.some((c) => c.id === customerId) || cSales.length > 0 || cPayments.length > 0) {
      customerSummaries.push({
        customer,
        sales: saleStatuses,
        payments: cPayments,
        totalCreditFC,
        totalPaidFC,
        totalWrittenOffFC,
        remainingFC,
        oldestUnpaidDate,
        daysOverdue,
        isOverdue,
        badge,
        hasAnyWrittenOff,
      });
    }
  }

  // Tri : d'abord ceux qui doivent de l'argent (plus ancienne dette d'abord, puis montant décroissant), puis les soldés par nom
  customerSummaries.sort((a, b) => {
    const aOwes = a.remainingFC > 0 ? 1 : 0;
    const bOwes = b.remainingFC > 0 ? 1 : 0;
    if (aOwes !== bOwes) return bOwes - aOwes;
    if (aOwes && bOwes) {
      if (a.oldestUnpaidDate && b.oldestUnpaidDate && a.oldestUnpaidDate !== b.oldestUnpaidDate) {
        return a.oldestUnpaidDate.localeCompare(b.oldestUnpaidDate);
      }
      if (b.remainingFC !== a.remainingFC) return b.remainingFC - a.remainingFC;
    }
    return a.customer.name.localeCompare(b.customer.name, 'fr');
  });

  const activeDebtors = customerSummaries.filter((c) => c.remainingFC > 0);
  const totalRemainingFC = activeDebtors.reduce((sum, c) => sum + c.remainingFC, 0);
  const debtorCount = activeDebtors.length;
  const overdueCount = activeDebtors.filter((c) => c.isOverdue).length;

  return {
    paymentAllocations,
    saleStatusMap,
    customerSummaries,
    totalRemainingFC,
    debtorCount,
    overdueCount,
  };
}
