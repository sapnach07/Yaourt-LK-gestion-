import { db } from '../db/db';
import { formatDate, formatFC, toISODate } from './formatters';
import { normalizeCustomerName } from './debtCalculator';
import type {
  AppSettings,
  Customer,
  CostItem,
  Expense,
  ExpenseIngredientLine,
  ProductCostConfig,
  ProductionCosting,
  ProductionCostLine,
  ProductionCostPackagingLine,
  ProductionProductCostSnapshot,
  StockAdjustment,
  StockAdjustmentReason,
} from '../types';

const VALID_ADJUSTMENT_REASONS = new Set<StockAdjustmentReason>([
  'renverse',
  'perime',
  'erreur_comptage',
  'don',
  'autre',
]);

function sanitizeCostItems(raw: unknown): CostItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const items: CostItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== 'object' || !it.id || !it.name) continue;
    const usageUnits = Number(it.usageUnitsPerPurchase);
    if (isNaN(usageUnits) || usageUnits <= 0) continue;
    const price = Number(it.purchasePriceFC);
    const expenseCat =
      typeof it.expenseCategory === 'string' && it.expenseCategory.trim()
        ? it.expenseCategory.trim()
        : undefined;
    items.push({
      id: String(it.id),
      kind: it.kind === 'packaging' ? 'packaging' : 'ingredient',
      name: String(it.name).trim(),
      purchaseUnit: String(it.purchaseUnit || '').trim() || 'unité',
      purchasePriceFC: !isNaN(price) && price >= 0 ? price : 0,
      usageUnit: String(it.usageUnit || '').trim() || 'unité',
      usageUnitsPerPurchase: usageUnits,
      allowDecimals: Boolean(it.allowDecimals),
      trackStock: it.trackStock === undefined ? true : Boolean(it.trackStock),
      expenseCategory: expenseCat,
      autoUpdateRefPrice: Boolean(it.autoUpdateRefPrice),
      isActive: it.isActive !== false,
      createdAt: Number(it.createdAt) || Date.now(),
    });
  }
  return items;
}

function sanitizeStockStart(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const result: Record<string, number> = {};
  for (const [itemId, val] of Object.entries(raw as Record<string, unknown>)) {
    const num = Number(val);
    if (itemId && Number.isFinite(num)) {
      result[String(itemId)] = num;
    }
  }
  return result;
}

function sanitizeDismissedPriceAlertKeys(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const result: Record<string, string> = {};
  for (const [itemId, val] of Object.entries(raw as Record<string, unknown>)) {
    if (itemId && typeof val === 'string' && val.trim()) {
      result[String(itemId)] = val.trim();
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function sanitizeExpense(raw: any): Expense {
  const base: Expense = {
    ...raw,
    id: String(raw.id),
    date: String(raw.date),
    amountFC: Number(raw.amountFC) || 0,
    category: String(raw.category || 'Autre dépense'),
    detail: String(raw.detail || ''),
    createdAt: Number(raw.createdAt) || Date.now(),
  };

  if (Array.isArray(raw.ingredientLines)) {
    const lines: ExpenseIngredientLine[] = raw.ingredientLines
      .filter((l: any) => l && typeof l === 'object' && l.itemId && l.name)
      .map((l: any) => ({
        itemId: String(l.itemId),
        name: String(l.name),
        purchaseQty: Number(l.purchaseQty) || 0,
        usageQty: Number(l.usageQty) || 0,
        amountFC: Number(l.amountFC) || 0,
      }))
      .filter((l: ExpenseIngredientLine) => l.purchaseQty > 0);
    if (lines.length > 0) {
      base.ingredientLines = lines;
    } else {
      delete base.ingredientLines;
    }
  }

  if (raw.otherFeesFC !== undefined && Number.isFinite(Number(raw.otherFeesFC))) {
    base.otherFeesFC = Number(raw.otherFeesFC);
  } else {
    delete base.otherFeesFC;
  }

  if (typeof raw.supplier === 'string' && raw.supplier.trim()) {
    base.supplier = raw.supplier.trim();
  } else {
    delete base.supplier;
  }

  return base;
}

function sanitizeStockAdjustments(raw: unknown): StockAdjustment[] {
  if (!Array.isArray(raw)) return [];
  const list: StockAdjustment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || !item.id || !item.itemId || !item.date) continue;
    const qtyDelta = Number(item.qtyDelta);
    if (!Number.isFinite(qtyDelta) || qtyDelta === 0) continue;
    const rawReason = String(item.reason || 'autre') as StockAdjustmentReason;
    const reason: StockAdjustmentReason = VALID_ADJUSTMENT_REASONS.has(rawReason)
      ? rawReason
      : 'autre';
    list.push({
      id: String(item.id),
      itemId: String(item.itemId),
      date: String(item.date),
      qtyDelta,
      reason,
      note: item.note ? String(item.note).trim() || undefined : undefined,
      createdAt: Number(item.createdAt) || Date.now(),
    });
  }
  return list;
}

function sanitizeProductCosting(
  raw: unknown
): Record<string, ProductCostConfig> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const result: Record<string, ProductCostConfig> = {};
  for (const [productId, cfg] of Object.entries(raw as Record<string, any>)) {
    if (!productId || !cfg || typeof cfg !== 'object') continue;
    const vw = Number(cfg.volumeWeight);
    const volumeWeight = !isNaN(vw) && vw > 0 ? vw : 1;
    const packaging = Array.isArray(cfg.packaging)
      ? cfg.packaging
          .filter(
            (line: any) =>
              line &&
              line.itemId &&
              !isNaN(Number(line.qtyPerUnit)) &&
              Number(line.qtyPerUnit) > 0
          )
          .map((line: any) => ({
            itemId: String(line.itemId),
            qtyPerUnit: Number(line.qtyPerUnit),
          }))
      : [];
    result[productId] = { volumeWeight, packaging };
  }
  return result;
}

function sanitizeProductionCosting(raw: unknown): ProductionCosting | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, any>;
  if (!Array.isArray(obj.lines) || obj.lines.length === 0) return undefined;

  const lines: ProductionCostLine[] = obj.lines
    .filter((l: any) => l && typeof l === 'object' && l.itemId && l.name && Number(l.qty) > 0)
    .map((l: any) => {
      const qty = Number(l.qty);
      const unitCostFC = Number(l.unitCostFC) >= 0 ? Number(l.unitCostFC) : 0;
      const totalFC = Number.isFinite(Number(l.totalFC)) ? Number(l.totalFC) : qty * unitCostFC;
      return {
        itemId: String(l.itemId),
        name: String(l.name),
        qty,
        usageUnit: String(l.usageUnit || 'unité'),
        unitCostFC,
        totalFC,
      };
    });

  if (lines.length === 0) return undefined;

  const sellPrices: Record<string, number> = {};
  if (obj.sellPrices && typeof obj.sellPrices === 'object' && !Array.isArray(obj.sellPrices)) {
    for (const [prodId, price] of Object.entries(obj.sellPrices)) {
      const pNum = Number(price);
      if (prodId && Number.isFinite(pNum) && pNum >= 0) {
        sellPrices[prodId] = pNum;
      }
    }
  }

  let productBreakdown: ProductionProductCostSnapshot[] | undefined = undefined;
  if (Array.isArray(obj.productBreakdown)) {
    productBreakdown = obj.productBreakdown
      .filter((pb: any) => pb && typeof pb === 'object' && pb.productId)
      .map((pb: any) => ({
        productId: String(pb.productId),
        productName: String(pb.productName || ''),
        producedQty: Number(pb.producedQty) || 0,
        volumeWeight: Number(pb.volumeWeight) > 0 ? Number(pb.volumeWeight) : 1,
        packagingUnitCostFC: Number(pb.packagingUnitCostFC) || 0,
        packagingTotalFC: Number(pb.packagingTotalFC) || 0,
        packagingLines: Array.isArray(pb.packagingLines)
          ? pb.packagingLines
              .filter((pl: any) => pl && typeof pl === 'object' && pl.itemId)
              .map((pl: any) => ({
                itemId: String(pl.itemId),
                name: String(pl.name || ''),
                qtyPerUnit: Number(pl.qtyPerUnit) || 0,
                totalQty: Number(pl.totalQty) || 0,
                usageUnit: String(pl.usageUnit || 'unité'),
                unitCostFC: Number(pl.unitCostFC) || 0,
                totalFC: Number(pl.totalFC) || 0,
              }))
          : undefined,
        ingredientShareFC: Number(pb.ingredientShareFC) || 0,
        unitCostFC: Number(pb.unitCostFC) || 0,
        sellPriceFC: Number(pb.sellPriceFC) || 0,
        revenueFC: Number(pb.revenueFC) || 0,
      }));
  }

  const ingredientsFC = Number(obj.ingredientsFC) || 0;
  const packagingFC = Number(obj.packagingFC) || 0;
  const totalCostFC = Number.isFinite(Number(obj.totalCostFC))
    ? Number(obj.totalCostFC)
    : ingredientsFC + packagingFC;
  const revenueFC = Number(obj.revenueFC) || 0;
  const gainFC = Number.isFinite(Number(obj.gainFC))
    ? Number(obj.gainFC)
    : revenueFC - totalCostFC;
  const commissionPct = Number(obj.commissionPct) >= 0 ? Number(obj.commissionPct) : 0;
  const netGainFC = Number.isFinite(Number(obj.netGainFC))
    ? Number(obj.netGainFC)
    : gainFC - (commissionPct / 100) * revenueFC;

  let packagingLines: ProductionCostPackagingLine[] | undefined = undefined;
  if (Array.isArray(obj.packagingLines)) {
    packagingLines = obj.packagingLines
      .filter((pl: any) => pl && typeof pl === 'object' && pl.itemId && Number(pl.qty) > 0)
      .map((pl: any) => ({
        itemId: String(pl.itemId),
        name: String(pl.name || ''),
        qty: Number(pl.qty),
      }));
  }

  return {
    lines,
    ...(packagingLines !== undefined ? { packagingLines } : {}),
    ingredientsFC,
    packagingFC,
    totalCostFC,
    sellPrices,
    revenueFC,
    gainFC,
    commissionLabel: String(obj.commissionLabel || 'Moi-même'),
    commissionPct,
    netGainFC,
    sellerId: obj.sellerId ? String(obj.sellerId) : undefined,
    productBreakdown,
  };
}

export interface BackupData {
  version: number;
  exportDate: string;
  businessName: string;
  employees: any[];
  products: any[];
  dailyEntries: any[];
  productionEntries: any[];
  expenses: any[];
  reserveMovements?: any[];
  payments: any[];
  personalSales?: any[];
  customers?: any[];
  debtPayments?: any[];
  stockAdjustments?: any[];
  settings: AppSettings;
}

/**
 * Exports all IndexedDB data to a downloadable JSON file.
 * Updates lastBackupDate in settings.
 */
export async function exportAllDataToJSON(): Promise<void> {
  const [
    employees,
    products,
    dailyEntries,
    productionEntries,
    expenses,
    reserveMovements,
    payments,
    personalSales,
    customers,
    debtPayments,
    stockAdjustments,
    settingsList,
  ] = await Promise.all([
    db.employees.toArray(),
    db.products.toArray(),
    db.dailyEntries.toArray(),
    db.productionEntries.toArray(),
    db.expenses.toArray(),
    db.reserveMovements.toArray(),
    db.payments.toArray(),
    db.personalSales.toArray(),
    db.customers.toArray(),
    db.debtPayments.toArray(),
    db.stockAdjustments.toArray(),
    db.settings.toArray(),
  ]);

  const currentSettings = settingsList[0] || (await db.settings.get('app_settings'));
  const now = new Date();
  const dateStr = toISODate(now);

  const backup: BackupData = {
    version: 5,
    exportDate: now.toISOString(),
    businessName: currentSettings?.businessName || 'Yaourt Gestion',
    employees,
    products,
    dailyEntries,
    productionEntries,
    expenses,
    reserveMovements,
    payments,
    personalSales,
    customers,
    debtPayments,
    stockAdjustments,
    settings: {
      ...currentSettings,
      debtReminderDays: currentSettings?.debtReminderDays ?? 2,
      costItems: currentSettings?.costItems,
      productCosting: currentSettings?.productCosting,
      stockStartDate: currentSettings?.stockStartDate,
      stockStart: currentSettings?.stockStart,
      stockLowBatches: currentSettings?.stockLowBatches ?? 1,
      priceRiseAlertPct: currentSettings?.priceRiseAlertPct ?? 5,
      dismissedPriceAlertKeys: currentSettings?.dismissedPriceAlertKeys,
      lastBackupDate: dateStr,
    },
  };

  // Update last backup date in database
  if (currentSettings) {
    await db.settings.put({
      ...currentSettings,
      lastBackupDate: dateStr,
    });
  }

  const jsonStr = JSON.stringify(backup, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const filename = `Sauvegarde_YaourtGestion_${dateStr}.json`;

  downloadBlob(blob, filename);
}

/**
 * Restores data from JSON backup.
 * Mode: 'replace' deletes existing records; 'merge' updates or adds.
 */
export async function restoreDataFromJSON(
  fileContent: string,
  mode: 'replace' | 'merge'
): Promise<{ success: boolean; message: string }> {
  try {
    const data: BackupData = JSON.parse(fileContent);

    if (!data.version || !Array.isArray(data.employees)) {
      return {
        success: false,
        message: 'Le fichier sélectionné n’est pas une sauvegarde valide de Yaourt Gestion.',
      };
    }

    if (mode === 'replace') {
      await Promise.all([
        db.employees.clear(),
        db.products.clear(),
        db.dailyEntries.clear(),
        db.productionEntries.clear(),
        db.expenses.clear(),
        db.reserveMovements.clear(),
        db.payments.clear(),
        db.personalSales.clear(),
        db.customers.clear(),
        db.debtPayments.clear(),
        db.stockAdjustments.clear(),
      ]);
    }

    // Dédoublonnage insensible à la casse des clients lors d'une fusion (ou d'un import)
    const existingCustomers: Customer[] = mode === 'merge' ? await db.customers.toArray() : [];
    const byNormalizedName = new Map<string, Customer>();
    for (const c of existingCustomers) {
      byNormalizedName.set(normalizeCustomerName(c.name), c);
    }

    const customerIdRemap = new Map<string, string>();
    if (Array.isArray(data.customers) && data.customers.length > 0) {
      const customersToPut: Customer[] = [];
      for (const rawC of data.customers) {
        if (!rawC || !rawC.id || !rawC.name) continue;
        const norm = normalizeCustomerName(String(rawC.name));
        if (!norm) continue;
        const already = byNormalizedName.get(norm);
        if (already && already.id !== rawC.id) {
          // Même nom (insensible à la casse) mais ID différent : conserver le client existant et remapper l'ID
          customerIdRemap.set(rawC.id, already.id);
          const merged: Customer = {
            ...already,
            phone: already.phone || rawC.phone || undefined,
            note: already.note || rawC.note || undefined,
          };
          byNormalizedName.set(norm, merged);
          customersToPut.push(merged);
        } else {
          const cleanC: Customer = {
            id: String(rawC.id),
            name: String(rawC.name).trim(),
            phone: rawC.phone ? String(rawC.phone).trim() : undefined,
            note: rawC.note ? String(rawC.note).trim() : undefined,
            createdAt: Number(rawC.createdAt) || Date.now(),
          };
          byNormalizedName.set(norm, cleanC);
          customersToPut.push(cleanC);
        }
      }
      if (customersToPut.length > 0) {
        await db.customers.bulkPut(customersToPut);
      }
    }

    if (data.employees?.length) await db.employees.bulkPut(data.employees);
    if (data.products?.length) await db.products.bulkPut(data.products);
    if (data.dailyEntries?.length) await db.dailyEntries.bulkPut(data.dailyEntries);
    if (data.productionEntries?.length) {
      const sanitizedProductions = data.productionEntries.map((pe: any) => {
        const sanitizedCosting = sanitizeProductionCosting(pe?.costing);
        if (sanitizedCosting) {
          return { ...pe, costing: sanitizedCosting };
        }
        const { costing: _unused, ...rest } = pe || {};
        return rest;
      });
      await db.productionEntries.bulkPut(sanitizedProductions);
    }
    if (data.expenses?.length) {
      const sanitizedExpenses = data.expenses
        .filter((e: any) => e && e.id && e.date)
        .map((e: any) => sanitizeExpense(e));
      if (sanitizedExpenses.length > 0) {
        await db.expenses.bulkPut(sanitizedExpenses);
      }
    }
    if (data.reserveMovements?.length) await db.reserveMovements.bulkPut(data.reserveMovements);
    if (data.payments?.length) await db.payments.bulkPut(data.payments);
    if (data.personalSales?.length) {
      const sanitizedSales = data.personalSales.map((ps: any) => {
        const kind = ps.kind || 'vente';
        const isConsommation = kind === 'consommation';
        const remappedCustomerId = ps.customerId
          ? customerIdRemap.get(ps.customerId) || ps.customerId
          : undefined;
        return {
          ...ps,
          kind,
          consumptionValueFC: ps.consumptionValueFC ?? 0,
          consumptionPaidFC: ps.consumptionPaidFC,
          // Une consommation ne peut jamais être à crédit ; une vente existante sans statut reste payée
          paymentStatus: isConsommation
            ? undefined
            : ps.paymentStatus === 'credit'
            ? 'credit'
            : ps.paymentStatus === 'paid'
            ? 'paid'
            : undefined,
          customerId: isConsommation ? undefined : remappedCustomerId,
          customerName: isConsommation ? undefined : ps.customerName,
          isOpeningDebt: isConsommation ? undefined : Boolean(ps.isOpeningDebt) || undefined,
          writtenOffFC:
            !isConsommation && ps.writtenOffFC !== undefined ? Number(ps.writtenOffFC) : undefined,
          writtenOffAt:
            !isConsommation && ps.writtenOffAt !== undefined ? Number(ps.writtenOffAt) : undefined,
        };
      });
      await db.personalSales.bulkPut(sanitizedSales);
    }
    if (Array.isArray(data.debtPayments) && data.debtPayments.length > 0) {
      const sanitizedDebtPayments = data.debtPayments
        .filter((dp: any) => dp && dp.id && dp.customerId && dp.date)
        .map((dp: any) => ({
          id: String(dp.id),
          customerId: customerIdRemap.get(String(dp.customerId)) || String(dp.customerId),
          date: String(dp.date),
          amountFC: Math.max(0, Math.round(Number(dp.amountFC) || 0)),
          note: dp.note ? String(dp.note).trim() : undefined,
          createdAt: Number(dp.createdAt) || Date.now(),
        }));
      if (sanitizedDebtPayments.length > 0) {
        await db.debtPayments.bulkPut(sanitizedDebtPayments);
      }
    }
    if (Array.isArray(data.stockAdjustments) && data.stockAdjustments.length > 0) {
      const sanitizedAdjustments = sanitizeStockAdjustments(data.stockAdjustments);
      if (sanitizedAdjustments.length > 0) {
        await db.stockAdjustments.bulkPut(sanitizedAdjustments);
      }
    }
    if (data.settings) {
      const existingSettings =
        mode === 'merge' ? await db.settings.get('app_settings') : undefined;

      const importedCostItems = sanitizeCostItems(data.settings.costItems);
      const importedProductCosting = sanitizeProductCosting(data.settings.productCosting);
      const importedStockStart = sanitizeStockStart(data.settings.stockStart);

      let finalCostItems: CostItem[] | undefined = importedCostItems;
      let finalProductCosting: Record<string, ProductCostConfig> | undefined =
        importedProductCosting;
      let finalStockStart: Record<string, number> | undefined = importedStockStart;

      if (mode === 'merge') {
        if (existingSettings?.costItems || importedCostItems) {
          const map = new Map<string, CostItem>();
          for (const item of existingSettings?.costItems || []) {
            map.set(item.id, item);
          }
          for (const item of importedCostItems || []) {
            map.set(item.id, item);
          }
          finalCostItems = Array.from(map.values());
        }

        if (existingSettings?.productCosting || importedProductCosting) {
          finalProductCosting = {
            ...(existingSettings?.productCosting || {}),
            ...(importedProductCosting || {}),
          };
        }

        if (existingSettings?.stockStart || importedStockStart) {
          finalStockStart = {
            ...(existingSettings?.stockStart || {}),
            ...(importedStockStart || {}),
          };
        }
      }

      const rawStockStartDate =
        typeof data.settings.stockStartDate === 'string' && data.settings.stockStartDate.trim()
          ? data.settings.stockStartDate.trim()
          : undefined;
      const finalStockStartDate =
        mode === 'merge'
          ? rawStockStartDate ?? existingSettings?.stockStartDate
          : rawStockStartDate;

      const rawLowBatches = Number(data.settings.stockLowBatches);
      const finalStockLowBatches =
        data.settings.stockLowBatches !== undefined && Number.isFinite(rawLowBatches) && rawLowBatches >= 0
          ? rawLowBatches
          : (existingSettings?.stockLowBatches ?? 1);

      const rawPriceRisePct = Number(data.settings.priceRiseAlertPct);
      const finalPriceRiseAlertPct =
        data.settings.priceRiseAlertPct !== undefined && Number.isFinite(rawPriceRisePct) && rawPriceRisePct >= 0
          ? rawPriceRisePct
          : (existingSettings?.priceRiseAlertPct ?? 5);

      const importedDismissedKeys = sanitizeDismissedPriceAlertKeys(
        data.settings.dismissedPriceAlertKeys
      );
      const finalDismissedKeys =
        mode === 'merge'
          ? existingSettings?.dismissedPriceAlertKeys || importedDismissedKeys
            ? {
                ...(existingSettings?.dismissedPriceAlertKeys || {}),
                ...(importedDismissedKeys || {}),
              }
            : undefined
          : importedDismissedKeys;

      await db.settings.put({
        ...(existingSettings || {}),
        ...data.settings,
        id: 'app_settings',
        debtReminderDays:
          data.settings.debtReminderDays !== undefined
            ? data.settings.debtReminderDays
            : (existingSettings?.debtReminderDays ?? 2),
        costItems: finalCostItems,
        productCosting: finalProductCosting,
        stockStartDate: finalStockStartDate,
        stockStart: finalStockStart,
        stockLowBatches: finalStockLowBatches,
        priceRiseAlertPct: finalPriceRiseAlertPct,
        dismissedPriceAlertKeys: finalDismissedKeys,
      });
    }

    return {
      success: true,
      message: `Restauration réussie (${mode === 'replace' ? 'Remplacement' : 'Fusion'}).`,
    };
  } catch (err: any) {
    console.error('Erreur restauration:', err);
    return {
      success: false,
      message: `Erreur lors de la lecture du fichier : ${err.message || 'Format invalide'}`,
    };
  }
}

/**
 * Exports daily sales entries to CSV format.
 */
export async function exportSalesToCSV(): Promise<void> {
  const entries = await db.dailyEntries.orderBy('date').reverse().toArray();
  const settings = await db.settings.get('app_settings');
  const currency = settings?.currency || 'FC';

  let csv = '\uFEFF'; // UTF-8 BOM for Excel
  csv += 'Date;Vendeur(se);Produit;Prix Unitaire;Reste Veille;Livraison;Total à Vendre;Vendu;Abîmé;Reste;Ventes (FC);Perte (FC);Commission (%);Commission (FC);Réserve Dépenses (FC);Part Gérant (FC)\r\n';

  for (const entry of entries) {
    for (const item of entry.items) {
      const soldFC = item.sold * item.unitPrice;
      const damagedFC = item.damaged * item.unitPrice;
      const commFC = Math.round((soldFC * entry.employeeCommissionRate) / 100);
      const reserveFC = Math.round((soldFC * entry.expenseReserveRate) / 100);
      const ownerFC = Math.round((soldFC * entry.ownerShareRate) / 100);

      const row = [
        formatDate(entry.date),
        escapeCsv(entry.employeeName),
        escapeCsv(item.productName),
        item.unitPrice,
        item.previousRest,
        item.delivered,
        item.totalToSell,
        item.sold,
        item.damaged,
        item.rest,
        soldFC,
        damagedFC,
        entry.employeeCommissionRate,
        commFC,
        reserveFC,
        ownerFC,
      ];
      csv += row.join(';') + '\r\n';
    }
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `Ventes_YaourtGestion_${toISODate(new Date())}.csv`);
}

/**
 * Exports expenses to CSV format.
 */
export async function exportExpensesToCSV(): Promise<void> {
  const expenses = await db.expenses.orderBy('date').reverse().toArray();

  let csv = '\uFEFF';
  csv += 'Date;Catégorie;Détail;Montant (FC)\r\n';

  for (const exp of expenses) {
    const row = [
      formatDate(exp.date),
      escapeCsv(exp.category),
      escapeCsv(exp.detail),
      exp.amountFC,
    ];
    csv += row.join(';') + '\r\n';
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `Depenses_YaourtGestion_${toISODate(new Date())}.csv`);
}

function escapeCsv(str: string = ''): string {
  if (str.includes(';') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
