import { db } from '../db/db';
import type { ReserveMovement, DailyEntry, Expense } from '../types';

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

export interface ClosedMonthSummary {
  month: string; // YYYY-MM
  ventesDuMois: number;
  reserveDuMois: number; // réserve % × ventesDuMois
  depensesDuMois: number;
  resteNormaleFC: number; // max(0, reserveDuMois - depensesDuMois)
  depassementPrisSurBeneficeFC: number; // max(0, depensesDuMois - reserveDuMois)
}

export interface CaisseStartingPoint {
  startDate?: string; // YYYY-MM-DD
  startNormaleFC?: number;
  startCapitalFC?: number;
}

export interface ReserveDetails {
  soldeNormaleFC: number; // Toujours >= 0
  soldeCapitalFC: number; // Peut être négatif (manque)
  capitalUtiliseFC: number; // Somme des restes pris sur le capital
  depensesPayeesParNormaleFC: number; // Somme des dépenses payées par la caisse normale
  manqueFC: number; // max(0, -soldeCapitalFC)

  // Détail pour chaque dépense
  expenseDetails: Record<string, { paidByNormaleFC: number; takenFromCapitalFC: number }>;
  expensesOnCapital: ExpenseBreakdownItem[]; // Dépenses où takenFromCapitalFC > 0
  allExpenseBreakdowns: ExpenseBreakdownItem[];

  // Totaux informatifs & compatibilité
  totalAdditionsFC: number;
  totalWithdrawalsFC: number;
  totalSalesReserveFC: number;
  totalExpensesFC: number;
  allTimeSalesFC: number;
  reserveRatePct: number;
  soldeFC: number; // solde global combiné (soldeNormaleFC + soldeCapitalFC)

  // Mois clôturés et point de départ
  startingPoint?: CaisseStartingPoint | null;
  closedMonths: ClosedMonthSummary[];
  totalDepassementClosedMonthsFC: number; // Somme des dépassements pris sur bénéfice des mois clôturés
  lastClosedMonthResteFC: number; // Reste de la caisse normale du dernier mois clôturé (pour proposition par défaut)
}

type TimelineEvent =
  | { type: 'ajout'; order: 1; id: string; date: string; amountFC: number; createdAt: number }
  | { type: 'vente'; order: 2; id: string; date: string; totalSalesFC: number; createdAt: number }
  | {
      type: 'depense';
      order: 3;
      id: string;
      date: string;
      amountFC: number;
      category: string;
      detail?: string;
      createdAt: number;
    }
  | { type: 'retrait'; order: 4; id: string; date: string; amountFC: number; createdAt: number };

/**
 * Calcule pour n'importe quel mois donné (YYYY-MM) le reste de la Caisse normale :
 * - ventesDuMois, reserveDuMois = réserve % × ventesDuMois, depensesDuMois
 * - Reste de la Caisse normale = max(0, reserveDuMois - depensesDuMois)
 */
export function calculateMonthResteNormale(
  dailyEntries: DailyEntry[],
  expenses: Expense[],
  monthStr: string, // YYYY-MM
  reserveRatePct = 50
): {
  month: string;
  ventesDuMois: number;
  reserveDuMois: number;
  depensesDuMois: number;
  resteNormaleFC: number;
  depassementPrisSurBeneficeFC: number;
} {
  const monthEntries = dailyEntries.filter((e) => e.date && e.date.startsWith(monthStr));
  const monthExpenses = expenses.filter((e) => e.date && e.date.startsWith(monthStr));

  const ventesDuMois = monthEntries.reduce((sum, e) => sum + (e.totalSalesFC || 0), 0);
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

/**
 * Calcule l'état des deux caisses (Caisse normale et Caisse Capital)
 * en tenant compte du point de départ optionnel :
 *
 * 1. Si caisseStartingPoint est défini avec une date de départ (ex: '2026-10-01') :
 *    - Mois clôturés (avant la date de départ) : calculés en bloc mois par mois
 *      (ventesDuMois, reserveDuMois, depensesDuMois, resteNormale, depassement).
 *    - Événements à partir de la date de départ : rejoués chronologiquement
 *      en commençant avec soldeNormaleFC = startNormaleFC et soldeCapitalFC = startCapitalFC.
 * 2. Sans point de départ : calcul chronologique sur tout l'historique démarrant à 0.
 */
export function calculateReserveBalance(
  movements: ReserveMovement[],
  dailyEntries: DailyEntry[],
  expenses: Expense[],
  reserveRatePct = 50,
  startingPoint?: CaisseStartingPoint | null
): ReserveDetails {
  const hasStartingPoint = Boolean(startingPoint && startingPoint.startDate && startingPoint.startDate.trim());
  const startDate = hasStartingPoint ? startingPoint!.startDate!.trim() : '';

  // 1. Calcul des mois clôturés (si point de départ actif)
  const closedMonths: ClosedMonthSummary[] = [];
  let totalDepassementClosedMonthsFC = 0;
  let lastClosedMonthResteFC = 0;

  if (hasStartingPoint) {
    // Identifier tous les mois YYYY-MM strictement antérieurs à startDate
    const closedMonthSet = new Set<string>();

    for (const e of dailyEntries) {
      if (e.date && e.date < startDate) {
        closedMonthSet.add(e.date.substring(0, 7));
      }
    }
    for (const exp of expenses) {
      if (exp.date && exp.date < startDate) {
        closedMonthSet.add(exp.date.substring(0, 7));
      }
    }

    const sortedClosedMonths = Array.from(closedMonthSet).sort();

    for (const mStr of sortedClosedMonths) {
      const summary = calculateMonthResteNormale(dailyEntries, expenses, mStr, reserveRatePct);
      closedMonths.push(summary);
      totalDepassementClosedMonthsFC += summary.depassementPrisSurBeneficeFC;
    }

    if (closedMonths.length > 0) {
      lastClosedMonthResteFC = closedMonths[closedMonths.length - 1].resteNormaleFC;
    }
  }

  // 2. Événements à rejouer chronologiquement
  const events: TimelineEvent[] = [];

  // Mouvements manuels de capital (ajouts et retraits)
  for (const m of movements) {
    if (hasStartingPoint && m.date < startDate) continue;
    if (m.type === 'ajout') {
      events.push({
        type: 'ajout',
        order: 1,
        id: m.id,
        date: m.date,
        amountFC: m.amountFC || 0,
        createdAt: m.createdAt || 0,
      });
    } else if (m.type === 'retrait') {
      events.push({
        type: 'retrait',
        order: 4,
        id: m.id,
        date: m.date,
        amountFC: m.amountFC || 0,
        createdAt: m.createdAt || 0,
      });
    }
  }

  // Saisies de ventes journalières
  for (const e of dailyEntries) {
    if (hasStartingPoint && e.date < startDate) continue;
    events.push({
      type: 'vente',
      order: 2,
      id: e.id,
      date: e.date,
      totalSalesFC: e.totalSalesFC || 0,
      createdAt: e.createdAt || 0,
    });
  }

  // Dépenses
  for (const exp of expenses) {
    if (hasStartingPoint && exp.date < startDate) continue;
    events.push({
      type: 'depense',
      order: 3,
      id: exp.id,
      date: exp.date,
      amountFC: exp.amountFC || 0,
      category: exp.category || '',
      detail: exp.detail || '',
      createdAt: exp.createdAt || 0,
    });
  }

  // Tri chronologique strict :
  // - Date croissante
  // - À même date : ajouts (1), puis ventes (2), puis dépenses (3), puis retraits (4)
  // - À égalité, par createdAt croissant
  events.sort((a, b) => {
    if (a.date !== b.date) {
      return a.date.localeCompare(b.date);
    }
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return a.createdAt - b.createdAt;
  });

  // Soldes de départ
  let soldeNormaleFC = hasStartingPoint ? Math.max(0, startingPoint?.startNormaleFC || 0) : 0;
  let soldeCapitalFC = hasStartingPoint ? (startingPoint?.startCapitalFC || 0) : 0;

  let capitalUtiliseFC = 0;
  let depensesPayeesParNormaleFC = 0;

  let totalAdditionsFC = hasStartingPoint ? (startingPoint?.startCapitalFC && startingPoint.startCapitalFC > 0 ? startingPoint.startCapitalFC : 0) : 0;
  let totalWithdrawalsFC = 0;
  let totalSalesReserveFC = hasStartingPoint ? (startingPoint?.startNormaleFC || 0) : 0;
  let totalExpensesFC = 0;
  let allTimeSalesFC = 0;

  const expenseDetails: Record<string, { paidByNormaleFC: number; takenFromCapitalFC: number }> = {};
  const allExpenseBreakdowns: ExpenseBreakdownItem[] = [];
  const expensesOnCapital: ExpenseBreakdownItem[] = [];

  for (const ev of events) {
    if (ev.type === 'ajout') {
      soldeCapitalFC += ev.amountFC;
      totalAdditionsFC += ev.amountFC;
    } else if (ev.type === 'vente') {
      allTimeSalesFC += ev.totalSalesFC;
      const partReserve = Math.round((ev.totalSalesFC * reserveRatePct) / 100);
      soldeNormaleFC += partReserve;
      totalSalesReserveFC += partReserve;
    } else if (ev.type === 'depense') {
      const D = ev.amountFC;
      totalExpensesFC += D;

      // La dépense est d'abord payée par la caisse normale
      const payéeParNormale = Math.min(D, soldeNormaleFC);
      soldeNormaleFC -= payéeParNormale;

      // Le reste est pris sur le capital (peut devenir négatif)
      const reste = D - payéeParNormale;
      soldeCapitalFC -= reste;

      capitalUtiliseFC += reste;
      depensesPayeesParNormaleFC += payéeParNormale;

      const breakdown: ExpenseBreakdownItem = {
        expenseId: ev.id,
        date: ev.date,
        amountFC: D,
        category: ev.category,
        detail: ev.detail || '',
        createdAt: ev.createdAt,
        paidByNormaleFC: payéeParNormale,
        takenFromCapitalFC: reste,
      };

      expenseDetails[ev.id] = {
        paidByNormaleFC: payéeParNormale,
        takenFromCapitalFC: reste,
      };
      allExpenseBreakdowns.push(breakdown);
      if (reste > 0) {
        expensesOnCapital.push(breakdown);
      }
    } else if (ev.type === 'retrait') {
      soldeCapitalFC -= ev.amountFC;
      totalWithdrawalsFC += ev.amountFC;
    }
  }

  const manqueFC = Math.max(0, -soldeCapitalFC);
  const soldeFC = soldeNormaleFC + soldeCapitalFC;

  return {
    soldeNormaleFC,
    soldeCapitalFC,
    capitalUtiliseFC,
    depensesPayeesParNormaleFC,
    manqueFC,
    expenseDetails,
    expensesOnCapital,
    allExpenseBreakdowns,
    totalAdditionsFC,
    totalWithdrawalsFC,
    totalSalesReserveFC,
    totalExpensesFC,
    allTimeSalesFC,
    reserveRatePct,
    soldeFC,
    startingPoint: hasStartingPoint ? startingPoint : null,
    closedMonths,
    totalDepassementClosedMonthsFC,
    lastClosedMonthResteFC,
  };
}

/**
 * Calcule le solde disponible dans la Caisse Capital à une date donnée,
 * pour valider si un retrait est autorisé.
 * Si le capital est négatif ou nul à cette date, le retrait est interdit.
 */
export function getCapitalBalanceAtDate(
  movements: ReserveMovement[],
  dailyEntries: DailyEntry[],
  expenses: Expense[],
  reserveRatePct: number,
  targetDate: string,
  excludeMovementId?: string,
  startingPoint?: CaisseStartingPoint | null
): number {
  const filteredMovements = excludeMovementId
    ? movements.filter((m) => m.id !== excludeMovementId)
    : movements;

  // Calcul du solde chronologique complet avec les mouvements filtrés
  const details = calculateReserveBalance(
    filteredMovements,
    dailyEntries,
    expenses,
    reserveRatePct,
    startingPoint
  );

  // Le solde du capital actuel disponible
  return details.soldeCapitalFC;
}

/**
 * Charge directement les données de Dexie et retourne le calcul du solde
 */
export async function getCumulativeReserveDetails(
  reserveRatePct = 50,
  startingPoint?: CaisseStartingPoint | null
): Promise<ReserveDetails> {
  const [movements, entries, expenses] = await Promise.all([
    db.reserveMovements.toArray(),
    db.dailyEntries.toArray(),
    db.expenses.toArray(),
  ]);

  return calculateReserveBalance(movements, entries, expenses, reserveRatePct, startingPoint);
}
