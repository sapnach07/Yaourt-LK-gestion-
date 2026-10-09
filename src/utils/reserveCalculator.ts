import { db } from '../db/db';
import type { ReserveMovement, DailyEntry, Expense } from '../types';

export interface ReserveDetails {
  totalAdditionsFC: number; // Somme des ajouts
  totalWithdrawalsFC: number; // Somme des retraits
  totalSalesReserveFC: number; // (réserve % × toutes les ventes)
  totalExpensesFC: number; // Toutes les dépenses
  allTimeSalesFC: number; // Toutes les ventes
  reserveRatePct: number; // Réserve %
  soldeFC: number; // somme des ajouts − somme des retraits + réserve des ventes − toutes les dépenses
}

/**
 * Calcule le solde cumulé de la réserve depuis le tout début (toutes les données confondues) :
 * Solde = somme des ajouts − somme des retraits + (réserve % × toutes les ventes) − toutes les dépenses
 */
export function calculateReserveBalance(
  movements: ReserveMovement[],
  dailyEntries: DailyEntry[],
  expenses: Expense[],
  reserveRatePct: number = 50
): ReserveDetails {
  let totalAdditionsFC = 0;
  let totalWithdrawalsFC = 0;

  for (const m of movements) {
    if (m.type === 'ajout') {
      totalAdditionsFC += m.amountFC || 0;
    } else if (m.type === 'retrait') {
      totalWithdrawalsFC += m.amountFC || 0;
    }
  }

  // Somme de toutes les ventes depuis le début
  let allTimeSalesFC = 0;
  for (const entry of dailyEntries) {
    allTimeSalesFC += entry.totalSalesFC || 0;
  }

  const totalSalesReserveFC = Math.round((allTimeSalesFC * reserveRatePct) / 100);

  // Somme de toutes les dépenses depuis le début
  let totalExpensesFC = 0;
  for (const exp of expenses) {
    totalExpensesFC += exp.amountFC || 0;
  }

  const soldeFC = totalAdditionsFC - totalWithdrawalsFC + totalSalesReserveFC - totalExpensesFC;

  return {
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
