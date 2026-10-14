import type { Product, ProductionEntry, DailyEntry, PersonalSale } from '../types';
import { formatMonthName, toISODate, toISOMonth } from './formatters';

export interface ProductStockResult {
  product: Product;
  totalProduced: number;
  totalDelivered: number;
  totalRest: number; // Somme des restes ramenés au stock maison (saisies validées)
  totalSoldByOwner: number;
  houseStock: number; // total produit − total livré + total restes − total vendu en ventes personnelles
}

export interface ProductPeriodStockResult {
  product: Product;
  initialStock: number; // Stock maison au début de la période (avant startDate)
  producedInPeriod: number; // Entrées de production pendant la période
  deliveredInPeriod: number; // Sorties livrées pendant la période
  restInPeriod: number; // Restes ramenés validés pendant la période
  soldByOwnerInPeriod: number; // Ventes personnelles pendant la période
  soldByEmployeesInPeriod: number; // Ventes réalisées par les vendeurs pendant la période
  damagedInPeriod: number; // Quantité abîmée pendant la période
  netChange: number; // producedInPeriod - deliveredInPeriod + restInPeriod - soldByOwnerInPeriod
  closingStock: number; // initialStock + netChange (stock à la fin / clôture de la période)
}

export interface MonthlyStockClosureItem {
  product: Product;
  initialStock: number;
  produced: number;
  delivered: number;
  rest: number;
  soldOwner: number;
  soldEmployees: number;
  damaged: number;
  netChange: number;
  closingStock: number;
}

export interface MonthlyStockClosure {
  month: string; // YYYY-MM
  monthLabel: string; // e.g. "Octobre 2026"
  startDate: string; // YYYY-MM-01
  endDate: string; // YYYY-MM-lastDay
  isCurrentMonth: boolean;
  isClosed: boolean; // true si mois antérieur au mois actuel
  items: MonthlyStockClosureItem[];
  totals: {
    initialStock: number;
    produced: number;
    delivered: number;
    rest: number;
    soldOwner: number;
    soldEmployees: number;
    totalSold: number;
    damaged: number;
    netChange: number;
    closingStock: number;
  };
}

/**
 * Calcule le stock maison en temps réel (all-time) pour un produit donné selon la règle :
 * stock maison = total produit − total livré (somme des "delivered") + total des restes ramenés (saisies validées) − total vendu en ventes personnelles.
 */
export function calculateProductStock(
  productId: string,
  productionEntries: ProductionEntry[],
  dailyEntries: DailyEntry[],
  personalSales: PersonalSale[] = []
): {
  totalProduced: number;
  totalDelivered: number;
  totalRest: number;
  totalSoldByOwner: number;
  houseStock: number;
} {
  let totalProduced = 0;
  for (const p of productionEntries) {
    const item = p.items.find((i) => i.productId === productId);
    if (item) totalProduced += item.producedQty || 0;
  }

  let totalDelivered = 0;
  let totalRest = 0;
  for (const d of dailyEntries) {
    const item = d.items.find((i) => i.productId === productId);
    if (item) {
      totalDelivered += item.delivered || 0;
      // Un reste n'est compté dans le stock maison que pour les saisies dont le statut est "validated" (une saisie sans statut compte comme "validated")
      // Pour une saisie "incomplete", le reste compte pour 0
      const isValidated = !d.status || d.status === 'validated';
      if (isValidated) {
        totalRest += item.rest || 0;
      }
    }
  }

  let totalSoldByOwner = 0;
  for (const ps of personalSales) {
    const item = ps.items.find((i) => i.productId === productId);
    if (item) totalSoldByOwner += item.soldQty || 0;
  }

  const houseStock = totalProduced - totalDelivered + totalRest - totalSoldByOwner;

  return {
    totalProduced,
    totalDelivered,
    totalRest,
    totalSoldByOwner,
    houseStock,
  };
}

/**
 * Calcule le stock maison pour tous les produits d'une liste (en temps réel)
 */
export function calculateAllProductsStock(
  products: Product[],
  productionEntries: ProductionEntry[],
  dailyEntries: DailyEntry[],
  personalSales: PersonalSale[] = []
): ProductStockResult[] {
  return products.map((prod) => {
    const stock = calculateProductStock(prod.id, productionEntries, dailyEntries, personalSales);
    return {
      product: prod,
      ...stock,
    };
  });
}

/**
 * Calcule le stock maison acumulé strictement avant une date donnée (stock initial au matin de targetDate).
 */
export function calculateProductStockBeforeDate(
  productId: string,
  targetDate: string, // YYYY-MM-DD
  productionEntries: ProductionEntry[],
  dailyEntries: DailyEntry[],
  personalSales: PersonalSale[] = []
): number {
  let prodBefore = 0;
  for (const p of productionEntries) {
    if (p.date < targetDate) {
      const item = p.items.find((i) => i.productId === productId);
      if (item) prodBefore += item.producedQty || 0;
    }
  }

  let delBefore = 0;
  let restBefore = 0;
  for (const d of dailyEntries) {
    if (d.date < targetDate) {
      const item = d.items.find((i) => i.productId === productId);
      if (item) {
        delBefore += item.delivered || 0;
        const isValidated = !d.status || d.status === 'validated';
        if (isValidated) {
          restBefore += item.rest || 0;
        }
      }
    }
  }

  let soldBefore = 0;
  for (const ps of personalSales) {
    if (ps.date < targetDate) {
      const item = ps.items.find((i) => i.productId === productId);
      if (item) soldBefore += item.soldQty || 0;
    }
  }

  return prodBefore - delBefore + restBefore - soldBefore;
}

/**
 * Calcule le stock et les mouvements d'un produit pour une période donnée [startDate, endDate] :
 * - initialStock : stock présent au début de la période (avant startDate)
 * - mouvements de la période : production, livraisons, ventes personnelles, restes validés, abîmés
 * - closingStock : stock à la clôture / fin de la période (initialStock + netChange)
 * Ne mélange en aucun cas les flux des autres mois.
 */
export function calculateProductStockForPeriod(
  product: Product,
  startDate: string,
  endDate: string,
  productionEntries: ProductionEntry[],
  dailyEntries: DailyEntry[],
  personalSales: PersonalSale[] = []
): ProductPeriodStockResult {
  const initialStock = calculateProductStockBeforeDate(
    product.id,
    startDate,
    productionEntries,
    dailyEntries,
    personalSales
  );

  let producedInPeriod = 0;
  for (const p of productionEntries) {
    if (p.date >= startDate && p.date <= endDate) {
      const item = p.items.find((i) => i.productId === product.id);
      if (item) producedInPeriod += item.producedQty || 0;
    }
  }

  let deliveredInPeriod = 0;
  let soldByEmployeesInPeriod = 0;
  let damagedInPeriod = 0;
  let restInPeriod = 0;
  for (const d of dailyEntries) {
    if (d.date >= startDate && d.date <= endDate) {
      const item = d.items.find((i) => i.productId === product.id);
      if (item) {
        deliveredInPeriod += item.delivered || 0;
        soldByEmployeesInPeriod += item.sold || 0;
        damagedInPeriod += item.damaged || 0;
        const isValidated = !d.status || d.status === 'validated';
        if (isValidated) {
          restInPeriod += item.rest || 0;
        }
      }
    }
  }

  let soldByOwnerInPeriod = 0;
  for (const ps of personalSales) {
    if (ps.date >= startDate && ps.date <= endDate) {
      const item = ps.items.find((i) => i.productId === product.id);
      if (item) soldByOwnerInPeriod += item.soldQty || 0;
    }
  }

  const netChange =
    producedInPeriod - deliveredInPeriod + restInPeriod - soldByOwnerInPeriod;
  const closingStock = initialStock + netChange;

  return {
    product,
    initialStock,
    producedInPeriod,
    deliveredInPeriod,
    restInPeriod,
    soldByOwnerInPeriod,
    soldByEmployeesInPeriod,
    damagedInPeriod,
    netChange,
    closingStock,
  };
}

/**
 * Calcule l'état des stocks pour tous les produits sur une période donnée
 */
export function calculateAllProductsStockForPeriod(
  products: Product[],
  startDate: string,
  endDate: string,
  productionEntries: ProductionEntry[],
  dailyEntries: DailyEntry[],
  personalSales: PersonalSale[] = []
): ProductPeriodStockResult[] {
  return products.map((prod) =>
    calculateProductStockForPeriod(
      prod,
      startDate,
      endDate,
      productionEntries,
      dailyEntries,
      personalSales
    )
  );
}

/**
 * Retourne la date de début et de fin (YYYY-MM-DD) d'un mois (YYYY-MM)
 */
export function getMonthDateRange(yearMonth: string): { startDate: string; endDate: string } {
  const [yearStr, monthStr] = yearMonth.split('-');
  const y = parseInt(yearStr, 10);
  const m = parseInt(monthStr, 10);
  const lastDay = new Date(y, m, 0).getDate();
  const padMonth = String(m).padStart(2, '0');
  const padDay = String(lastDay).padStart(2, '0');
  return {
    startDate: `${y}-${padMonth}-01`,
    endDate: `${y}-${padMonth}-${padDay}`,
  };
}

/**
 * Récupère tous les mois distincts (YYYY-MM) ayant des données d'activité, triés du plus récent au plus ancien.
 */
export function getAllActivityMonths(
  productionEntries: ProductionEntry[],
  dailyEntries: DailyEntry[],
  personalSales: PersonalSale[] = []
): string[] {
  const monthsSet = new Set<string>();
  const currentMonth = toISOMonth(new Date());
  monthsSet.add(currentMonth);

  for (const p of productionEntries) {
    if (p.date && p.date.length >= 7) monthsSet.add(p.date.substring(0, 7));
  }
  for (const d of dailyEntries) {
    if (d.date && d.date.length >= 7) monthsSet.add(d.date.substring(0, 7));
  }
  for (const ps of personalSales) {
    if (ps.date && ps.date.length >= 7) monthsSet.add(ps.date.substring(0, 7));
  }

  return Array.from(monthsSet).sort().reverse();
}

/**
 * Calcule la clôture des stocks pour chaque mois sans mélanger les mois.
 * Chaque mois a son stock initial (au 1er), ses mouvements propres (production, livraisons, ventes personnelles, restes validés, pertes)
 * et son stock de clôture au dernier jour du mois.
 */
export function calculateMonthlyStockClosures(
  products: Product[],
  productionEntries: ProductionEntry[],
  dailyEntries: DailyEntry[],
  personalSales: PersonalSale[] = []
): MonthlyStockClosure[] {
  const allMonths = getAllActivityMonths(productionEntries, dailyEntries, personalSales);
  const currentMonth = toISOMonth(new Date());

  return allMonths.map((month) => {
    const { startDate, endDate } = getMonthDateRange(month);
    const isCurrentMonth = month === currentMonth;
    const isClosed = month < currentMonth;

    const items = calculateAllProductsStockForPeriod(
      products,
      startDate,
      endDate,
      productionEntries,
      dailyEntries,
      personalSales
    );

    const totals = {
      initialStock: items.reduce((acc, it) => acc + it.initialStock, 0),
      produced: items.reduce((acc, it) => acc + it.producedInPeriod, 0),
      delivered: items.reduce((acc, it) => acc + it.deliveredInPeriod, 0),
      rest: items.reduce((acc, it) => acc + it.restInPeriod, 0),
      soldOwner: items.reduce((acc, it) => acc + it.soldByOwnerInPeriod, 0),
      soldEmployees: items.reduce((acc, it) => acc + it.soldByEmployeesInPeriod, 0),
      totalSold: items.reduce(
        (acc, it) => acc + it.soldByEmployeesInPeriod + it.soldByOwnerInPeriod,
        0
      ),
      damaged: items.reduce((acc, it) => acc + it.damagedInPeriod, 0),
      netChange: items.reduce((acc, it) => acc + it.netChange, 0),
      closingStock: items.reduce((acc, it) => acc + it.closingStock, 0),
    };

    return {
      month,
      monthLabel: formatMonthName(month),
      startDate,
      endDate,
      isCurrentMonth,
      isClosed,
      items,
      totals,
    };
  });
}
