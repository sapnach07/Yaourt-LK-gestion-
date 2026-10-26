import type {
  CostItem,
  Expense,
  ProductionEntry,
  ProductCostConfig,
  StockAdjustment,
  StockAdjustmentReason,
} from '../types';

export const STOCK_ADJUSTMENT_REASON_LABELS: Record<StockAdjustmentReason, string> = {
  renverse: 'Renversé ou perdu',
  perime: 'Périmé',
  erreur_comptage: 'Erreur de comptage',
  don: 'Don ou offert',
  autre: 'Autre',
};

export interface IngredientStockItemResult {
  item: CostItem;
  startingQty: number;
  purchasedUsageQty: number;
  usedUsageQty: number;
  adjustedUsageQty: number;
  stockUsageQty: number;
  stockPurchaseQty: number;
  avgUsagePerBatch: number | null;
  remainingBatches: number | null;
  negativeShortfallQty: number;
  isNegative: boolean;
  isLowStock: boolean;
  needsPurchase: boolean;
}

export interface IngredientStockComputationResult {
  items: IngredientStockItemResult[];
  productionsWithoutIngredients: ProductionEntry[];
}

export interface ItemPurchaseHistoryPoint {
  expenseId: string;
  date: string;
  createdAt: number;
  supplier: string;
  purchaseQty: number;
  usageQty: number;
  amountFC: number;
  unitPurchasePriceFC: number;
  unitUsagePriceFC: number;
  prevUnitPurchasePriceFC: number | null;
  variationFC: number | null;
  variationPct: number | null;
}

export interface SupplierPriceComparison {
  supplierLabel: string;
  isUnspecified: boolean;
  purchaseCount: number;
  avgUnitPriceFC: number;
  minUnitPriceFC: number;
  maxUnitPriceFC: number;
  lastDate: string;
  isCheapest: boolean;
}

export interface ItemPriceAnalytics {
  item: CostItem;
  purchases: ItemPurchaseHistoryPoint[];
  lastPriceFC: number | null;
  minPriceFC: number | null;
  maxPriceFC: number | null;
  avgPriceFC: number | null;
  lastVariationFC: number | null;
  lastVariationPct: number | null;
  isPriceRiseAboveThreshold: boolean;
  batchCostIncreaseFC: number | null;
  avgUsagePerBatch: number | null;
  supplierComparison: SupplierPriceComparison[];
}

function cleanFloat(val: number): number {
  if (!Number.isFinite(val) || isNaN(val)) return 0;
  return Math.round(val * 1_000_000) / 1_000_000;
}

/**
 * Calcule la quantité d'un ingrédient ou emballage (en unités d'utilisation) consommée par une production donnée.
 */
export function getItemUsageInProduction(
  production: ProductionEntry,
  item: CostItem,
  productCosting?: Record<string, ProductCostConfig>
): number {
  if (item.kind === 'ingredient') {
    const lines = production.costing?.lines;
    if (!Array.isArray(lines) || lines.length === 0) return 0;
    let total = 0;
    for (const line of lines) {
      if (line.itemId === item.id) {
        total += Number(line.qty) || 0;
      }
    }
    return cleanFloat(total);
  }

  // kind === 'packaging'
  // Si la production possède packagingLines figées dans costing, les utiliser en priorité
  if (production.costing && Array.isArray(production.costing.packagingLines)) {
    let frozenPkgTotal = 0;
    for (const pl of production.costing.packagingLines) {
      if (pl.itemId === item.id) {
        frozenPkgTotal += Number(pl.qty) || 0;
      }
    }
    return cleanFloat(frozenPkgTotal);
  }

  // Repli (productions existantes sans packagingLines) : productBreakdown ou quantité produite × emballage défini dans les Paramètres
  let totalPkg = 0;
  const prodItems = Array.isArray(production.items) ? production.items : [];
  const breakdownList = production.costing?.productBreakdown;

  for (const pItem of prodItems) {
    const producedQty = Number(pItem.producedQty) || 0;
    if (producedQty <= 0) continue;

    const snap = Array.isArray(breakdownList)
      ? breakdownList.find((b) => b.productId === pItem.productId)
      : undefined;

    if (snap && Array.isArray(snap.packagingLines)) {
      for (const pl of snap.packagingLines) {
        if (pl.itemId === item.id) {
          const lineTotal = Number.isFinite(Number(pl.totalQty))
            ? Number(pl.totalQty)
            : (Number(pl.qtyPerUnit) || 0) * producedQty;
          totalPkg += lineTotal;
        }
      }
    } else {
      const cfg = productCosting?.[pItem.productId];
      if (cfg && Array.isArray(cfg.packaging)) {
        for (const pkgLine of cfg.packaging) {
          if (pkgLine.itemId === item.id) {
            totalPkg += producedQty * (Number(pkgLine.qtyPerUnit) || 0);
          }
        }
      }
    }
  }

  return cleanFloat(totalPkg);
}

/**
 * Calcule l'usage moyen par fournée d'un élément sur les 3 dernières productions ayant des ingrédients enregistrés.
 * Retourne null si aucune production avec ingrédients n'existe ou si l'usage moyen est 0.
 */
export function computeAvgUsagePerBatch(
  item: CostItem,
  productionEntries: ProductionEntry[],
  productCosting?: Record<string, ProductCostConfig>,
  endDate?: string
): number | null {
  const maxDate = endDate?.trim() || null;

  const withIngredients = productionEntries
    .filter((p) => {
      if (!p.date) return false;
      if (maxDate && p.date > maxDate) return false;
      return Boolean(p.costing && Array.isArray(p.costing.lines) && p.costing.lines.length > 0);
    })
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));

  const last3 = withIngredients.slice(0, 3);
  if (last3.length === 0) return null;

  let sum = 0;
  for (const prod of last3) {
    sum += getItemUsageInProduction(prod, item, productCosting);
  }

  const avg = cleanFloat(sum / last3.length);
  return avg > 0 ? avg : null;
}

/**
 * Calcule le stock en temps réel (ou à une date de fin facultative) pour chaque élément suivi.
 * Fonction 100 % pure : ne modifie jamais aucune table, caisse ou donnée.
 */
export function calculateIngredientsStock(params: {
  costItems: CostItem[];
  expenses: Expense[];
  productionEntries: ProductionEntry[];
  stockAdjustments: StockAdjustment[];
  productCosting?: Record<string, ProductCostConfig>;
  stockStartDate?: string;
  stockStart?: Record<string, number>;
  stockLowBatches?: number;
  endDate?: string;
  excludeAdjustmentId?: string;
}): IngredientStockComputationResult {
  const {
    costItems,
    expenses,
    productionEntries,
    stockAdjustments,
    productCosting,
    stockStartDate,
    stockStart,
    stockLowBatches = 1,
    endDate,
    excludeAdjustmentId,
  } = params;

  const startDate = stockStartDate?.trim() || null;
  const maxDate = endDate?.trim() || null;
  const lowThreshold =
    Number.isFinite(Number(stockLowBatches)) && Number(stockLowBatches) >= 0
      ? Number(stockLowBatches)
      : 1;

  const isDateInWindow = (d?: string): boolean => {
    if (!d) return false;
    if (startDate && d < startDate) return false;
    if (maxDate && d > maxDate) return false;
    return true;
  };

  // Productions dans la fenêtre qui n'ont aucun ingrédient renseigné
  const productionsWithoutIngredients = productionEntries
    .filter((p) => {
      if (!isDateInWindow(p.date)) return false;
      const hasProduced =
        Array.isArray(p.items) && p.items.some((it) => (Number(it.producedQty) || 0) > 0);
      if (!hasProduced) return false;
      const hasIngredients = Boolean(
        p.costing && Array.isArray(p.costing.lines) && p.costing.lines.length > 0
      );
      return !hasIngredients;
    })
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));

  const trackedItems = costItems.filter(
    (it) => it.isActive !== false && it.trackStock !== false
  );

  const items: IngredientStockItemResult[] = trackedItems.map((item) => {
    const isBeforeStartDate = Boolean(startDate && maxDate && maxDate < startDate);
    const startingQty = isBeforeStartDate ? 0 : cleanFloat(Number(stockStart?.[item.id]) || 0);

    // 1. Somme des usageQty des ingredientLines des dépenses datées à partir de stockStartDate
    let purchasedUsageQty = 0;
    for (const exp of expenses) {
      if (!isDateInWindow(exp.date)) continue;
      if (!Array.isArray(exp.ingredientLines)) continue;
      for (const line of exp.ingredientLines) {
        if (line.itemId === item.id) {
          purchasedUsageQty += Number(line.usageQty) || 0;
        }
      }
    }
    purchasedUsageQty = cleanFloat(purchasedUsageQty);

    // 2. Somme des quantités utilisées par les productions datées à partir de stockStartDate
    let usedUsageQty = 0;
    for (const prod of productionEntries) {
      if (!isDateInWindow(prod.date)) continue;
      usedUsageQty += getItemUsageInProduction(prod, item, productCosting);
    }
    usedUsageQty = cleanFloat(usedUsageQty);

    // 3. Somme des ajustements à partir de stockStartDate
    let adjustedUsageQty = 0;
    for (const adj of stockAdjustments) {
      if (excludeAdjustmentId && adj.id === excludeAdjustmentId) continue;
      if (!isDateInWindow(adj.date)) continue;
      if (adj.itemId === item.id) {
        adjustedUsageQty += Number(adj.qtyDelta) || 0;
      }
    }
    adjustedUsageQty = cleanFloat(adjustedUsageQty);

    const stockUsageQty = cleanFloat(
      startingQty + purchasedUsageQty - usedUsageQty + adjustedUsageQty
    );

    const unitsPerPurchase =
      Number(item.usageUnitsPerPurchase) > 0 ? Number(item.usageUnitsPerPurchase) : 1;
    const stockPurchaseQty = cleanFloat(stockUsageQty / unitsPerPurchase);

    const avgUsagePerBatch = computeAvgUsagePerBatch(
      item,
      productionEntries,
      productCosting,
      maxDate || undefined
    );

    const remainingBatches =
      avgUsagePerBatch !== null && avgUsagePerBatch > 0
        ? cleanFloat(stockUsageQty / avgUsagePerBatch)
        : null;

    const isNegative = stockUsageQty < 0;
    const negativeShortfallQty = isNegative ? cleanFloat(Math.abs(stockUsageQty)) : 0;

    const hadAnyActivity =
      startingQty > 0 || purchasedUsageQty > 0 || usedUsageQty > 0 || adjustedUsageQty !== 0;

    const isLowStock =
      !isNegative &&
      ((remainingBatches !== null && remainingBatches < lowThreshold) ||
        (remainingBatches === null && stockUsageQty === 0 && hadAnyActivity && lowThreshold > 0));

    const needsPurchase = isNegative || isLowStock;

    return {
      item,
      startingQty,
      purchasedUsageQty,
      usedUsageQty,
      adjustedUsageQty,
      stockUsageQty,
      stockPurchaseQty,
      avgUsagePerBatch,
      remainingBatches,
      negativeShortfallQty,
      isNegative,
      isLowStock,
      needsPurchase,
    };
  });

  return {
    items,
    productionsWithoutIngredients,
  };
}

/**
 * Calcule l'historique des prix d'achat, statistiques, comparaison par fournisseur
 * et impact sur le coût d'une fournée en cas de hausse supérieure au seuil.
 */
export function calculateItemsPriceAnalytics(params: {
  costItems: CostItem[];
  expenses: Expense[];
  productionEntries: ProductionEntry[];
  productCosting?: Record<string, ProductCostConfig>;
  priceRiseAlertPct?: number;
  endDate?: string;
}): ItemPriceAnalytics[] {
  const {
    costItems,
    expenses,
    productionEntries,
    productCosting,
    priceRiseAlertPct = 5,
    endDate,
  } = params;

  const maxDate = endDate?.trim() || null;
  const thresholdPct =
    Number.isFinite(Number(priceRiseAlertPct)) && Number(priceRiseAlertPct) >= 0
      ? Number(priceRiseAlertPct)
      : 5;

  // Trier les dépenses par ordre chronologique pour suivre l'évolution d'un achat au suivant
  const sortedExpenses = [...expenses]
    .filter((exp) => {
      if (!exp.date) return false;
      if (maxDate && exp.date > maxDate) return false;
      return Array.isArray(exp.ingredientLines) && exp.ingredientLines.length > 0;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));

  const targetItems = costItems.filter((it) => it.isActive !== false);

  return targetItems.map((item) => {
    const purchases: ItemPurchaseHistoryPoint[] = [];
    let prevUnitPrice: number | null = null;

    for (const exp of sortedExpenses) {
      for (const line of exp.ingredientLines || []) {
        if (line.itemId !== item.id) continue;
        const pQty = Number(line.purchaseQty) || 0;
        const amt = Number(line.amountFC) || 0;
        if (pQty <= 0) continue;

        const uQty =
          Number(line.usageQty) > 0
            ? Number(line.usageQty)
            : pQty * (Number(item.usageUnitsPerPurchase) || 1);
        const unitPurchasePriceFC = amt / pQty;
        const unitUsagePriceFC = uQty > 0 ? amt / uQty : 0;

        const variationFC =
          prevUnitPrice !== null ? unitPurchasePriceFC - prevUnitPrice : null;
        const variationPct =
          prevUnitPrice !== null && prevUnitPrice > 0
            ? ((unitPurchasePriceFC - prevUnitPrice) / prevUnitPrice) * 100
            : null;

        purchases.push({
          expenseId: exp.id,
          date: exp.date,
          createdAt: exp.createdAt || 0,
          supplier: (exp.supplier || '').trim(),
          purchaseQty: cleanFloat(pQty),
          usageQty: cleanFloat(uQty),
          amountFC: amt,
          unitPurchasePriceFC,
          unitUsagePriceFC,
          prevUnitPurchasePriceFC: prevUnitPrice,
          variationFC,
          variationPct,
        });

        prevUnitPrice = unitPurchasePriceFC;
      }
    }

    const avgUsagePerBatch = computeAvgUsagePerBatch(
      item,
      productionEntries,
      productCosting,
      maxDate || undefined
    );

    if (purchases.length === 0) {
      return {
        item,
        purchases: [],
        lastPriceFC: null,
        minPriceFC: null,
        maxPriceFC: null,
        avgPriceFC: null,
        lastVariationFC: null,
        lastVariationPct: null,
        isPriceRiseAboveThreshold: false,
        batchCostIncreaseFC: null,
        avgUsagePerBatch,
        supplierComparison: [],
      };
    }

    const unitPrices = purchases.map((p) => p.unitPurchasePriceFC);
    const lastPurchase = purchases[purchases.length - 1];
    const prevPurchase = purchases.length >= 2 ? purchases[purchases.length - 2] : null;

    const lastPriceFC = lastPurchase.unitPurchasePriceFC;
    const minPriceFC = Math.min(...unitPrices);
    const maxPriceFC = Math.max(...unitPrices);
    const avgPriceFC = unitPrices.reduce((s, v) => s + v, 0) / unitPrices.length;

    const lastVariationFC = lastPurchase.variationFC;
    const lastVariationPct = lastPurchase.variationPct;

    const isPriceRiseAboveThreshold =
      lastVariationPct !== null && lastVariationPct > thresholdPct;

    let batchCostIncreaseFC: number | null = null;
    if (isPriceRiseAboveThreshold && prevPurchase && avgUsagePerBatch !== null && avgUsagePerBatch > 0) {
      const deltaUsageCost = lastPurchase.unitUsagePriceFC - prevPurchase.unitUsagePriceFC;
      if (deltaUsageCost > 0) {
        batchCostIncreaseFC = Math.round(deltaUsageCost * avgUsagePerBatch);
      }
    }

    // Comparaison par lieu d'achat (fournisseur)
    const supplierMap = new Map<
      string,
      {
        label: string;
        isUnspecified: boolean;
        prices: number[];
        lastDate: string;
      }
    >();

    for (const p of purchases) {
      const trimmed = p.supplier.trim();
      const key = trimmed ? trimmed.toLocaleLowerCase('fr') : '__unspecified__';
      const existing = supplierMap.get(key);
      if (existing) {
        existing.prices.push(p.unitPurchasePriceFC);
        if (p.date >= existing.lastDate) {
          existing.lastDate = p.date;
          if (trimmed) existing.label = trimmed;
        }
      } else {
        supplierMap.set(key, {
          label: trimmed || 'Lieu non précisé',
          isUnspecified: !trimmed,
          prices: [p.unitPurchasePriceFC],
          lastDate: p.date,
        });
      }
    }

    const rawSuppliers = Array.from(supplierMap.values()).map((grp) => {
      const avg = grp.prices.reduce((s, v) => s + v, 0) / grp.prices.length;
      return {
        supplierLabel: grp.label,
        isUnspecified: grp.isUnspecified,
        purchaseCount: grp.prices.length,
        avgUnitPriceFC: avg,
        minUnitPriceFC: Math.min(...grp.prices),
        maxUnitPriceFC: Math.max(...grp.prices),
        lastDate: grp.lastDate,
        isCheapest: false,
      };
    });

    rawSuppliers.sort((a, b) => a.avgUnitPriceFC - b.avgUnitPriceFC);

    // Mettre en évidence le fournisseur nommé le moins cher (ou le 1er s'il n'y a pas de nom précisé)
    const namedSuppliers = rawSuppliers.filter((s) => !s.isUnspecified);
    if (namedSuppliers.length > 0) {
      const minAvg = Math.min(...namedSuppliers.map((s) => s.avgUnitPriceFC));
      for (const s of rawSuppliers) {
        if (!s.isUnspecified && Math.abs(s.avgUnitPriceFC - minAvg) < 0.001) {
          s.isCheapest = true;
          break;
        }
      }
    } else if (rawSuppliers.length > 0) {
      rawSuppliers[0].isCheapest = true;
    }

    return {
      item,
      purchases,
      lastPriceFC,
      minPriceFC,
      maxPriceFC,
      avgPriceFC,
      lastVariationFC,
      lastVariationPct,
      isPriceRiseAboveThreshold,
      batchCostIncreaseFC,
      avgUsagePerBatch,
      supplierComparison: rawSuppliers,
    };
  });
}
