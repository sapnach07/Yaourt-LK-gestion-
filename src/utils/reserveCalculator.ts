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
 * Calcule l'état des deux caisses (Caisse normale et Caisse Capital)
 * en rejouant tous les événements par ordre chronologique strict :
 * - Date croissante
 * - À même date : ajouts (1), puis ventes (2), puis dépenses (3), puis retraits (4)
 * - À égalité, par createdAt croissant
 */
export function calculateReserveBalance(
  movements: ReserveMovement[],
  dailyEntries: DailyEntry[],
  expenses: Expense[],
  reserveRatePct = 50
): ReserveDetails {
  const events: TimelineEvent[] = [];

  // Mouvements manuels de capital (ajouts et retraits)
  for (const m of movements) {
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

  // Tri chronologique strict
  events.sort((a, b) => {
    if (a.date !== b.date) {
      return a.date.localeCompare(b.date);
    }
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return a.createdAt - b.createdAt;
  });

  let soldeNormaleFC = 0;
  let soldeCapitalFC = 0;
  let capitalUtiliseFC = 0;
  let depensesPayeesParNormaleFC = 0;

  let totalAdditionsFC = 0;
  let totalWithdrawalsFC = 0;
  let totalSalesReserveFC = 0;
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
  excludeMovementId?: string
): number {
  const filteredMovements = excludeMovementId
    ? movements.filter((m) => m.id !== excludeMovementId)
    : movements;

  // Calcul du solde chronologique complet avec les mouvements filtrés
  const details = calculateReserveBalance(filteredMovements, dailyEntries, expenses, reserveRatePct);

  // Le solde du capital actuel disponible
  return details.soldeCapitalFC;
}

/**
 * Charge directement les données de Dexie et retourne le calcul du solde
 */
export async function getCumulativeReserveDetails(reserveRatePct = 50): Promise<ReserveDetails> {
  const [movements, entries, expenses] = await Promise.all([
    db.reserveMovements.toArray(),
    db.dailyEntries.toArray(),
    db.expenses.toArray(),
  ]);

  return calculateReserveBalance(movements, entries, expenses, reserveRatePct);
}
