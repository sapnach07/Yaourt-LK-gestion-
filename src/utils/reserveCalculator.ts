import { db } from '../db/db';
import type { ReserveMovement, DailyEntry, Expense, PersonalSale, Payment, Employee } from '../types';

export interface ExpenseBreakdownItem {
  expenseId: string;
  date: string;
  amountFC: number;
  category: string;
  detail: string;
  createdAt: number;
  paidByNormaleFC: number;
  takenFromCapitalFC: number;
}

export interface CaisseStartingPoint {
  startDate?: string; // YYYY-MM-DD
  startReserveFC?: number;
  startBeneficesFC?: number;
  startVendeursFC?: number;
  // Rétrocompatibilité
  startNormaleFC?: number;
  startCapitalFC?: number;
}

export interface ProvenanceItem {
  label: string;
  amountFC: number;
  pct: number;
}

export interface ProvenanceSection {
  totalEntreesFC: number;
  entrees: ProvenanceItem[];
  totalSortiesFC: number;
  sorties: ProvenanceItem[];
}

export interface VendeurProvenanceItem {
  employeeId: string;
  employeeName: string;
  commissionsFC: number;
  paymentsFC: number;
  resteDuFC: number;
  pctCommissions: number;
}

export interface ProvenanceVendeursSection {
  totalCommissionsFC: number;
  totalPaymentsFC: number;
  soldeDuFC: number;
  vendeurs: VendeurProvenanceItem[];
}

export interface ReserveDetails {
  // 1. Caisse Réserve
  soldeReserveFC: number; // ajouts − retraits + (réserve % × toutes ventes) − toutes dépenses (peut être négatif)
  totalAdditionsReserveFC: number; // Ajouts manuels à la réserve (toutes sources)
  totalWithdrawalsReserveFC: number; // Retraits de la réserve
  totalSalesReserveFC: number; // réserve % × toutes les ventes
  totalExpensesFC: number; // Toutes les dépenses
  manqueFC: number; // max(0, -soldeReserveFC)

  // 2. Caisse Bénéfices personnels
  soldeBeneficesFC: number; // somme(ownerShareFC) + somme(ownerCommissionFC + ownerShareFC ventes perso) − retraits bénéfices − transferts vers réserve − consommations
  totalBeneficesVendeursFC: number; // somme des ownerShareFC des vendeurs
  totalBeneficesPersoFC: number; // somme des (ownerCommissionFC + ownerShareFC) des ventes personnelles
  totalConsumptionFC: number; // somme des consommations personnelles
  totalWithdrawalsBeneficesFC: number; // retraits caisse = 'benefices'
  totalTransfersToReserveFC: number; // ajouts réserve de source = 'benefices'

  // 3. Caisse Vendeurs
  soldeVendeursFC: number; // somme(commissions) − somme(paiements) (solde positif = reste dû aux vendeurs)
  totalCommissionsVendeursFC: number; // somme des commissions gagnées
  totalPaymentsVendeursFC: number; // somme des paiements versés
  startVendeursFC: number;

  // Provenance détaillée en temps réel
  provenanceReserve: ProvenanceSection;
  provenanceBenefices: ProvenanceSection;
  provenanceVendeurs: ProvenanceVendeursSection;

  // Totaux globaux & rétrocompatibilité
  allTimeSalesFC: number;
  reserveRatePct: number;
  soldeFC: number; // solde de la réserve (ou solde combiné)
  soldeNormaleFC: number; // alias soldeReserveFC pour compatibilité
  soldeCapitalFC: number; // alias soldeReserveFC pour compatibilité (ou manqueFC = max(0, -soldeCapitalFC))
  capitalUtiliseFC: number;
  depensesPayeesParNormaleFC: number;
  expenseDetails: Record<string, { paidByNormaleFC: number; takenFromCapitalFC: number }>;
  expensesOnCapital: ExpenseBreakdownItem[];
  allExpenseBreakdowns: ExpenseBreakdownItem[];
  totalAdditionsFC: number;
  totalWithdrawalsFC: number;
  startingPoint?: CaisseStartingPoint | null;
  closedMonths: any[];
  totalDepassementClosedMonthsFC: number;
  lastClosedMonthResteFC: number;
}

export interface PeriodReserveSummary {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  // Caisse Réserve
  reserveStartFC: number;
  reserveAdditionsFC: number;
  reserveSalesAddFC: number;
  reserveConsumptionFC: number;
  reserveWithdrawalsFC: number;
  reserveExpensesFC: number;
  reserveEndFC: number;
  // Caisse Bénéfices
  beneficesStartFC: number;
  beneficesVendeursFC: number;
  beneficesPersoFC: number;
  beneficesConsumptionFC: number;
  beneficesWithdrawalsFC: number;
  beneficesTransfersFC: number;
  beneficesEndFC: number;
  // Caisse Vendeurs
  vendeursStartFC: number;
  vendeursCommissionsAddFC: number;
  vendeursPaymentsPaidFC: number;
  vendeursEndFC: number;
  // Provenance sur la période
  provenanceReserve: ProvenanceSection;
  provenanceBenefices: ProvenanceSection;
  provenanceVendeurs: ProvenanceVendeursSection;

  // Rétrocompatibilité
  normaleStartFC: number;
  normaleSalesAddFC: number;
  normaleExpensesPaidFC: number;
  normaleEndFC: number;
  capitalStartFC: number;
  capitalAdditionsFC: number;
  capitalWithdrawalsFC: number;
  capitalExpensesTakenFC: number;
  capitalEndFC: number;
}

/**
 * Calcule l'état des deux caisses :
 * - Caisse Réserve
 * - Caisse Bénéfices personnels
 *
 * Plus d'ordre chronologique : somme directe des composantes.
 */
export function calculateReserveBalance(
  movements: ReserveMovement[],
  dailyEntries: DailyEntry[],
  expenses: Expense[],
  reserveRatePct = 50,
  startingPoint?: CaisseStartingPoint | null,
  asOfDate?: string | null,
  personalSales: PersonalSale[] = [],
  payments: Payment[] = [],
  employees: Employee[] = []
): ReserveDetails {
  const hasStartingPoint = Boolean(startingPoint && startingPoint.startDate && startingPoint.startDate.trim());
  const startDate = hasStartingPoint ? startingPoint!.startDate!.trim() : '';
  const filterAsOfDate = asOfDate && asOfDate.trim() ? asOfDate.trim() : null;

  // Soldes de départ
  let startReserveFC = 0;
  let startBeneficesFC = 0;
  let startVendeursFC = 0;

  if (hasStartingPoint) {
    if (startingPoint!.startReserveFC !== undefined) {
      startReserveFC = startingPoint!.startReserveFC;
    } else {
      // Rétrocompatibilité : startNormaleFC + startCapitalFC
      startReserveFC = (startingPoint!.startNormaleFC ?? 0) + (startingPoint!.startCapitalFC ?? 0);
    }
    startBeneficesFC = startingPoint!.startBeneficesFC ?? 0;
    startVendeursFC = startingPoint!.startVendeursFC ?? 0;
  }

  // Filtrage des événements (si point de départ : date >= startDate, si asOfDate : date <= asOfDate)
  const isDateIncluded = (d?: string) => {
    if (!d) return false;
    if (hasStartingPoint && d < startDate) return false;
    if (filterAsOfDate && d > filterAsOfDate) return false;
    return true;
  };

  // 1. Mouvements manuels
  let reserveAdditionsPersonnelFC = 0;
  let reserveAdditionsBeneficesFC = 0;
  let reserveWithdrawalsFC = 0;

  let beneficesWithdrawalsFC = 0;
  let beneficesTransfersToReserveFC = 0;

  for (const m of movements) {
    if (!isDateIncluded(m.date)) continue;
    const amount = m.amountFC || 0;
    const caisse = m.caisse || 'reserve';
    const source = m.source || 'personnel';

    if (caisse === 'reserve') {
      if (m.type === 'ajout') {
        if (source === 'benefices') {
          reserveAdditionsBeneficesFC += amount;
          beneficesTransfersToReserveFC += amount;
        } else {
          reserveAdditionsPersonnelFC += amount;
        }
      } else if (m.type === 'retrait') {
        reserveWithdrawalsFC += amount;
      }
    } else if (caisse === 'benefices') {
      if (m.type === 'retrait') {
        beneficesWithdrawalsFC += amount;
      }
    }
  }

  const totalAdditionsReserveFC = reserveAdditionsPersonnelFC + reserveAdditionsBeneficesFC;

  // 2. Ventes des vendeurs
  let reserveSalesVendeursFC = 0;
  let beneficesVendeursFC = 0;
  let allTimeSalesFC = 0;

  // Caisse Vendeurs tracking
  let totalCommissionsVendeursFC = 0;
  const vendeursMap: Record<
    string,
    { employeeId: string; employeeName: string; commissionsFC: number; paymentsFC: number }
  > = {};

  employees.forEach((emp) => {
    vendeursMap[emp.id] = {
      employeeId: emp.id,
      employeeName: emp.name,
      commissionsFC: 0,
      paymentsFC: 0,
    };
  });

  // Pour la provenance des vendeurs
  const entriesByEmployee: Record<string, { employeeName: string; salesFC: number; reserveFC: number; ownerShareFC: number }> = {};

  for (const e of dailyEntries) {
    if (!isDateIncluded(e.date)) continue;
    const sales = e.totalSalesFC || 0;
    allTimeSalesFC += sales;
    const resPart = Math.round((sales * reserveRatePct) / 100);
    reserveSalesVendeursFC += resPart;
    const ownerPart = e.ownerShareFC || 0;
    beneficesVendeursFC += ownerPart;

    const empComm = e.employeeCommissionFC || 0;
    totalCommissionsVendeursFC += empComm;

    const empId = e.employeeId || 'unknown';
    if (!entriesByEmployee[empId]) {
      entriesByEmployee[empId] = {
        employeeName: e.employeeName || 'Vendeur(se)',
        salesFC: 0,
        reserveFC: 0,
        ownerShareFC: 0,
      };
    }
    entriesByEmployee[empId].salesFC += sales;
    entriesByEmployee[empId].reserveFC += resPart;
    entriesByEmployee[empId].ownerShareFC += ownerPart;

    if (!vendeursMap[empId]) {
      vendeursMap[empId] = {
        employeeId: empId,
        employeeName: e.employeeName || 'Vendeur(se)',
        commissionsFC: 0,
        paymentsFC: 0,
      };
    }
    vendeursMap[empId].commissionsFC += empComm;
    if (e.employeeName) {
      vendeursMap[empId].employeeName = e.employeeName;
    }
  }

  // 3. Ventes personnelles & Consommations personnelles
  let reserveSalesPersoFC = 0;
  let beneficesPersoFC = 0;
  let totalConsumptionFC = 0;

  for (const p of personalSales) {
    if (!isDateIncluded(p.date)) continue;
    if (p.kind === 'consommation') {
      const consumptionVal =
        p.consumptionPaidFC !== undefined ? p.consumptionPaidFC : (p.consumptionValueFC ?? 0);
      totalConsumptionFC += consumptionVal;
    } else {
      const sales = p.totalSalesFC || 0;
      allTimeSalesFC += sales;
      const resPart = p.expenseReserveFC || Math.round((sales * reserveRatePct) / 100);
      reserveSalesPersoFC += resPart;
      const ownerPart = (p.ownerShareFC || 0) + (p.ownerCommissionFC || 0);
      beneficesPersoFC += ownerPart;
    }
  }

  const totalSalesReserveFC = reserveSalesVendeursFC + reserveSalesPersoFC;

  // 4. Dépenses (toutes déduites de la Réserve)
  let totalExpensesFC = 0;
  const expensesByCategory: Record<string, number> = {};
  const allExpenseBreakdowns: ExpenseBreakdownItem[] = [];
  const expenseDetails: Record<string, { paidByNormaleFC: number; takenFromCapitalFC: number }> = {};

  for (const exp of expenses) {
    if (!isDateIncluded(exp.date)) continue;
    const amt = exp.amountFC || 0;
    totalExpensesFC += amt;
    const cat = exp.category || 'Autre dépense';
    expensesByCategory[cat] = (expensesByCategory[cat] || 0) + amt;

    const item: ExpenseBreakdownItem = {
      expenseId: exp.id,
      date: exp.date,
      amountFC: amt,
      category: cat,
      detail: exp.detail || '',
      createdAt: exp.createdAt || 0,
      paidByNormaleFC: amt,
      takenFromCapitalFC: 0,
    };
    allExpenseBreakdowns.push(item);
    expenseDetails[exp.id] = { paidByNormaleFC: amt, takenFromCapitalFC: 0 };
  }

  // 5. Paiements des vendeurs
  let totalPaymentsVendeursFC = 0;
  for (const pay of payments) {
    if (!isDateIncluded(pay.date)) continue;
    const amt = pay.amountFC || 0;
    totalPaymentsVendeursFC += amt;

    const empId = pay.employeeId || 'unknown';
    if (!vendeursMap[empId]) {
      vendeursMap[empId] = {
        employeeId: empId,
        employeeName: pay.employeeName || 'Vendeur(se)',
        commissionsFC: 0,
        paymentsFC: 0,
      };
    }
    vendeursMap[empId].paymentsFC += amt;
    if (pay.employeeName) {
      vendeursMap[empId].employeeName = pay.employeeName;
    }
  }

  // SOLDES FINAUX
  // Caisse Réserve = ajouts (toutes sources) − retraits de la Réserve + (réserve % × toutes ventes) − toutes dépenses + consommation personnelle (payée par mes bénéfices) + départ
  const soldeReserveFC = startReserveFC + totalAdditionsReserveFC - reserveWithdrawalsFC + totalSalesReserveFC - totalExpensesFC + totalConsumptionFC;

  // Caisse Bénéfices personnels = départ + somme(ownerShareFC vendeurs) + somme(ownerCommissionFC + ownerShareFC perso) − retraits bénéfices − transferts vers réserve − consommations personnelles
  const soldeBeneficesFC = startBeneficesFC + beneficesVendeursFC + beneficesPersoFC - beneficesWithdrawalsFC - beneficesTransfersToReserveFC - totalConsumptionFC;

  // Caisse Vendeurs = départ + somme(commissions gagnées) − somme(paiements versés)
  // Un solde positif = ce que je dois encore aux vendeur(se)s
  const soldeVendeursFC = startVendeursFC + totalCommissionsVendeursFC - totalPaymentsVendeursFC;

  const manqueFC = Math.max(0, -soldeReserveFC);

  // 5. Calcul des Provenances
  // Provenance Réserve
  const reserveTotalEntreesFC = startReserveFC + totalAdditionsReserveFC + totalSalesReserveFC + totalConsumptionFC;
  const reserveEntreesList: ProvenanceItem[] = [];

  if (startReserveFC > 0) {
    reserveEntreesList.push({
      label: 'Solde de départ',
      amountFC: startReserveFC,
      pct: reserveTotalEntreesFC > 0 ? (startReserveFC / reserveTotalEntreesFC) * 100 : 0,
    });
  }

  // Entrées par vendeur(se)
  Object.values(entriesByEmployee).forEach((emp) => {
    if (emp.reserveFC > 0) {
      reserveEntreesList.push({
        label: `Ventes ${emp.employeeName} (${reserveRatePct} %)`,
        amountFC: emp.reserveFC,
        pct: reserveTotalEntreesFC > 0 ? (emp.reserveFC / reserveTotalEntreesFC) * 100 : 0,
      });
    }
  });

  // Ventes personnelles
  if (reserveSalesPersoFC > 0) {
    reserveEntreesList.push({
      label: `Ventes personnelles (${reserveRatePct} %)`,
      amountFC: reserveSalesPersoFC,
      pct: reserveTotalEntreesFC > 0 ? (reserveSalesPersoFC / reserveTotalEntreesFC) * 100 : 0,
    });
  }

  // Dépôts personnels
  if (reserveAdditionsPersonnelFC > 0) {
    reserveEntreesList.push({
      label: 'Dépôts argent personnel',
      amountFC: reserveAdditionsPersonnelFC,
      pct: reserveTotalEntreesFC > 0 ? (reserveAdditionsPersonnelFC / reserveTotalEntreesFC) * 100 : 0,
    });
  }

  // Transferts depuis les bénéfices
  if (reserveAdditionsBeneficesFC > 0) {
    reserveEntreesList.push({
      label: 'Transferts depuis mes bénéfices',
      amountFC: reserveAdditionsBeneficesFC,
      pct: reserveTotalEntreesFC > 0 ? (reserveAdditionsBeneficesFC / reserveTotalEntreesFC) * 100 : 0,
    });
  }

  // Consommation personnelle payée par les bénéfices
  if (totalConsumptionFC > 0) {
    reserveEntreesList.push({
      label: 'Ma consommation (payée par mes bénéfices)',
      amountFC: totalConsumptionFC,
      pct: reserveTotalEntreesFC > 0 ? (totalConsumptionFC / reserveTotalEntreesFC) * 100 : 0,
    });
  }

  // Sorties Réserve
  const reserveTotalSortiesFC = totalExpensesFC + reserveWithdrawalsFC;
  const reserveSortiesList: ProvenanceItem[] = [];

  // Dépenses par catégorie
  Object.entries(expensesByCategory).forEach(([cat, amt]) => {
    reserveSortiesList.push({
      label: `Dépenses : ${cat}`,
      amountFC: amt,
      pct: reserveTotalSortiesFC > 0 ? (amt / reserveTotalSortiesFC) * 100 : 0,
    });
  });

  // Retraits
  if (reserveWithdrawalsFC > 0) {
    reserveSortiesList.push({
      label: 'Retraits de la Réserve',
      amountFC: reserveWithdrawalsFC,
      pct: reserveTotalSortiesFC > 0 ? (reserveWithdrawalsFC / reserveTotalSortiesFC) * 100 : 0,
    });
  }

  const provenanceReserve: ProvenanceSection = {
    totalEntreesFC: reserveTotalEntreesFC,
    entrees: reserveEntreesList,
    totalSortiesFC: reserveTotalSortiesFC,
    sorties: reserveSortiesList,
  };

  // Provenance Bénéfices personnels
  const beneficesTotalEntreesFC = startBeneficesFC + beneficesVendeursFC + beneficesPersoFC;
  const beneficesEntreesList: ProvenanceItem[] = [];

  if (startBeneficesFC > 0) {
    beneficesEntreesList.push({
      label: 'Solde de départ',
      amountFC: startBeneficesFC,
      pct: beneficesTotalEntreesFC > 0 ? (startBeneficesFC / beneficesTotalEntreesFC) * 100 : 0,
    });
  }

  Object.values(entriesByEmployee).forEach((emp) => {
    if (emp.ownerShareFC > 0) {
      beneficesEntreesList.push({
        label: `Part sur ventes : ${emp.employeeName}`,
        amountFC: emp.ownerShareFC,
        pct: beneficesTotalEntreesFC > 0 ? (emp.ownerShareFC / beneficesTotalEntreesFC) * 100 : 0,
      });
    }
  });

  if (beneficesPersoFC > 0) {
    beneficesEntreesList.push({
      label: 'Part & com. ventes personnelles',
      amountFC: beneficesPersoFC,
      pct: beneficesTotalEntreesFC > 0 ? (beneficesPersoFC / beneficesTotalEntreesFC) * 100 : 0,
    });
  }

  const beneficesTotalSortiesFC = beneficesWithdrawalsFC + beneficesTransfersToReserveFC + totalConsumptionFC;
  const beneficesSortiesList: ProvenanceItem[] = [];

  if (beneficesWithdrawalsFC > 0) {
    beneficesSortiesList.push({
      label: 'Retraits personnels',
      amountFC: beneficesWithdrawalsFC,
      pct: beneficesTotalSortiesFC > 0 ? (beneficesWithdrawalsFC / beneficesTotalSortiesFC) * 100 : 0,
    });
  }

  if (beneficesTransfersToReserveFC > 0) {
    beneficesSortiesList.push({
      label: 'Transferts vers la Réserve',
      amountFC: beneficesTransfersToReserveFC,
      pct: beneficesTotalSortiesFC > 0 ? (beneficesTransfersToReserveFC / beneficesTotalSortiesFC) * 100 : 0,
    });
  }

  if (totalConsumptionFC > 0) {
    beneficesSortiesList.push({
      label: 'Mes yaourts consommés',
      amountFC: totalConsumptionFC,
      pct: beneficesTotalSortiesFC > 0 ? (totalConsumptionFC / beneficesTotalSortiesFC) * 100 : 0,
    });
  }

  const provenanceBenefices: ProvenanceSection = {
    totalEntreesFC: beneficesTotalEntreesFC,
    entrees: beneficesEntreesList,
    totalSortiesFC: beneficesTotalSortiesFC,
    sorties: beneficesSortiesList,
  };

  // Provenance Caisse Vendeurs
  const vendeursList: VendeurProvenanceItem[] = Object.values(vendeursMap)
    .filter((v) => v.commissionsFC > 0 || v.paymentsFC > 0)
    .map((v) => ({
      employeeId: v.employeeId,
      employeeName: v.employeeName,
      commissionsFC: v.commissionsFC,
      paymentsFC: v.paymentsFC,
      resteDuFC: v.commissionsFC - v.paymentsFC,
      pctCommissions:
        totalCommissionsVendeursFC > 0
          ? (v.commissionsFC / totalCommissionsVendeursFC) * 100
          : 0,
    }))
    .sort((a, b) => b.commissionsFC - a.commissionsFC);

  const provenanceVendeurs: ProvenanceVendeursSection = {
    totalCommissionsFC: totalCommissionsVendeursFC,
    totalPaymentsFC: totalPaymentsVendeursFC,
    soldeDuFC: soldeVendeursFC,
    vendeurs: vendeursList,
  };

  return {
    soldeReserveFC,
    totalAdditionsReserveFC,
    totalWithdrawalsReserveFC: reserveWithdrawalsFC,
    totalSalesReserveFC,
    totalExpensesFC,
    manqueFC,

    soldeBeneficesFC,
    totalBeneficesVendeursFC: beneficesVendeursFC,
    totalBeneficesPersoFC: beneficesPersoFC,
    totalConsumptionFC,
    totalWithdrawalsBeneficesFC: beneficesWithdrawalsFC,
    totalTransfersToReserveFC: beneficesTransfersToReserveFC,

    soldeVendeursFC,
    totalCommissionsVendeursFC,
    totalPaymentsVendeursFC,
    startVendeursFC,

    provenanceReserve,
    provenanceBenefices,
    provenanceVendeurs,

    allTimeSalesFC,
    reserveRatePct,
    soldeFC: soldeReserveFC,
    soldeNormaleFC: soldeReserveFC,
    soldeCapitalFC: soldeReserveFC,
    capitalUtiliseFC: 0,
    depensesPayeesParNormaleFC: totalExpensesFC,
    expenseDetails,
    expensesOnCapital: [],
    allExpenseBreakdowns,
    totalAdditionsFC: totalAdditionsReserveFC,
    totalWithdrawalsFC: reserveWithdrawalsFC + beneficesWithdrawalsFC,
    startingPoint: hasStartingPoint ? startingPoint : null,
    closedMonths: [],
    totalDepassementClosedMonthsFC: 0,
    lastClosedMonthResteFC: 0,
  };
}

/**
 * Calcul du résumé des caisses sur une période donnée [startDate, endDate]
 */
export function calculatePeriodReserveSummary(
  movements: ReserveMovement[],
  dailyEntries: DailyEntry[],
  expenses: Expense[],
  startDate: string, // YYYY-MM-DD
  endDate: string,   // YYYY-MM-DD
  reserveRatePct = 50,
  startingPoint?: CaisseStartingPoint | null,
  personalSales: PersonalSale[] = [],
  payments: Payment[] = [],
  employees: Employee[] = []
): PeriodReserveSummary {
  // Calculer la veille de startDate pour l'état au début
  const sDate = new Date(startDate);
  sDate.setDate(sDate.getDate() - 1);
  const dayBefore = sDate.toISOString().slice(0, 10);

  const startDetails = calculateReserveBalance(
    movements,
    dailyEntries,
    expenses,
    reserveRatePct,
    startingPoint,
    dayBefore,
    personalSales,
    payments,
    employees
  );

  const endDetails = calculateReserveBalance(
    movements,
    dailyEntries,
    expenses,
    reserveRatePct,
    startingPoint,
    endDate,
    personalSales,
    payments,
    employees
  );

  // Événements stricts de la période [startDate, endDate]
  const periodMovements = movements.filter((m) => m.date && m.date >= startDate && m.date <= endDate);
  const periodEntries = dailyEntries.filter((e) => e.date && e.date >= startDate && e.date <= endDate);
  const periodExpenses = expenses.filter((e) => e.date && e.date >= startDate && e.date <= endDate);
  const periodPersonalSales = personalSales.filter((p) => p.date && p.date >= startDate && p.date <= endDate);
  const periodPayments = payments.filter((p) => p.date && p.date >= startDate && p.date <= endDate);

  // Calcul sur la période seule (sans startingPoint pour avoir les flux stricts de la période)
  const periodOnlyDetails = calculateReserveBalance(
    periodMovements,
    periodEntries,
    periodExpenses,
    reserveRatePct,
    null,
    null,
    periodPersonalSales,
    periodPayments,
    employees
  );

  return {
    startDate,
    endDate,
    reserveStartFC: startDetails.soldeReserveFC,
    reserveAdditionsFC: periodOnlyDetails.totalAdditionsReserveFC,
    reserveSalesAddFC: periodOnlyDetails.totalSalesReserveFC,
    reserveConsumptionFC: periodOnlyDetails.totalConsumptionFC,
    reserveWithdrawalsFC: periodOnlyDetails.totalWithdrawalsReserveFC,
    reserveExpensesFC: periodOnlyDetails.totalExpensesFC,
    reserveEndFC: endDetails.soldeReserveFC,

    beneficesStartFC: startDetails.soldeBeneficesFC,
    beneficesVendeursFC: periodOnlyDetails.totalBeneficesVendeursFC,
    beneficesPersoFC: periodOnlyDetails.totalBeneficesPersoFC,
    beneficesConsumptionFC: periodOnlyDetails.totalConsumptionFC,
    beneficesWithdrawalsFC: periodOnlyDetails.totalWithdrawalsBeneficesFC,
    beneficesTransfersFC: periodOnlyDetails.totalTransfersToReserveFC,
    beneficesEndFC: endDetails.soldeBeneficesFC,

    vendeursStartFC: startDetails.soldeVendeursFC,
    vendeursCommissionsAddFC: periodOnlyDetails.totalCommissionsVendeursFC,
    vendeursPaymentsPaidFC: periodOnlyDetails.totalPaymentsVendeursFC,
    vendeursEndFC: endDetails.soldeVendeursFC,

    provenanceReserve: periodOnlyDetails.provenanceReserve,
    provenanceBenefices: periodOnlyDetails.provenanceBenefices,
    provenanceVendeurs: periodOnlyDetails.provenanceVendeurs,

    normaleStartFC: startDetails.soldeReserveFC,
    normaleSalesAddFC: periodOnlyDetails.totalSalesReserveFC,
    normaleExpensesPaidFC: periodOnlyDetails.totalExpensesFC,
    normaleEndFC: endDetails.soldeReserveFC,
    capitalStartFC: startDetails.soldeBeneficesFC,
    capitalAdditionsFC: periodOnlyDetails.totalAdditionsReserveFC,
    capitalWithdrawalsFC: periodOnlyDetails.totalWithdrawalsReserveFC,
    capitalExpensesTakenFC: 0,
    capitalEndFC: endDetails.soldeBeneficesFC,
  };
}

/**
 * Solde des bénéfices personnels disponible à une date donnée pour valider un retrait ou transfert
 */
export function getBeneficesBalanceAtDate(
  movements: ReserveMovement[],
  dailyEntries: DailyEntry[],
  expenses: Expense[],
  reserveRatePct: number,
  targetDate: string,
  excludeMovementId?: string,
  startingPoint?: CaisseStartingPoint | null,
  personalSales: PersonalSale[] = [],
  payments: Payment[] = [],
  employees: Employee[] = []
): number {
  const filteredMovements = excludeMovementId
    ? movements.filter((m) => m.id !== excludeMovementId)
    : movements;

  const details = calculateReserveBalance(
    filteredMovements,
    dailyEntries,
    expenses,
    reserveRatePct,
    startingPoint,
    targetDate,
    personalSales,
    payments,
    employees
  );

  return details.soldeBeneficesFC;
}

/**
 * Rétro-compatibilité : alias vers getBeneficesBalanceAtDate ou solde capital
 */
export function getCapitalBalanceAtDate(
  movements: ReserveMovement[],
  dailyEntries: DailyEntry[],
  expenses: Expense[],
  reserveRatePct: number,
  targetDate: string,
  excludeMovementId?: string,
  startingPoint?: CaisseStartingPoint | null,
  personalSales: PersonalSale[] = [],
  payments: Payment[] = [],
  employees: Employee[] = []
): number {
  return getBeneficesBalanceAtDate(
    movements,
    dailyEntries,
    expenses,
    reserveRatePct,
    targetDate,
    excludeMovementId,
    startingPoint,
    personalSales,
    payments,
    employees
  );
}

/**
 * Charge directement les données de Dexie et retourne le calcul du solde
 */
export async function getCumulativeReserveDetails(
  reserveRatePct = 50,
  startingPoint?: CaisseStartingPoint | null
): Promise<ReserveDetails> {
  const [movements, entries, expenses, pSales, payments, employees] = await Promise.all([
    db.reserveMovements.toArray(),
    db.dailyEntries.toArray(),
    db.expenses.toArray(),
    db.personalSales.toArray(),
    db.payments.toArray(),
    db.employees.toArray(),
  ]);

  return calculateReserveBalance(
    movements,
    entries,
    expenses,
    reserveRatePct,
    startingPoint,
    null,
    pSales,
    payments,
    employees
  );
}

/**
 * Rétrocompatibilité : calcul du reste d'un mois
 */
export function calculateMonthResteNormale(
  dailyEntries: DailyEntry[],
  expenses: Expense[],
  monthStr: string,
  reserveRatePct = 50,
  personalSales: PersonalSale[] = []
) {
  const monthEntries = dailyEntries.filter((e) => e.date && e.date.startsWith(monthStr));
  const monthPersonalSales = personalSales.filter((p) => p.date && p.date.startsWith(monthStr));
  const monthExpenses = expenses.filter((e) => e.date && e.date.startsWith(monthStr));

  const ventesDuMois =
    monthEntries.reduce((sum, e) => sum + (e.totalSalesFC || 0), 0) +
    monthPersonalSales.reduce((sum, p) => sum + (p.totalSalesFC || 0), 0);
  const reserveDuMois = Math.round((ventesDuMois * reserveRatePct) / 100);
  const depensesDuMois = monthExpenses.reduce((sum, e) => sum + (e.amountFC || 0), 0);

  const resteNormaleFC = Math.max(0, reserveDuMois - depensesDuMois);
  const depassementPrisSurBeneficeFC = Math.max(0, depensesDuMois - reserveDuMois);

  return {
    month: monthStr,
    ventesDuMois,
    reserveDuMois,
    depensesDuMois,
    resteNormaleFC,
    depassementPrisSurBeneficeFC,
  };
}
