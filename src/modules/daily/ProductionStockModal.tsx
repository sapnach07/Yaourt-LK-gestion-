import React, { useState, useEffect } from 'react';
import { X, Check, Plus, Trash2, RotateCcw, AlertTriangle, Calculator } from 'lucide-react';
import { db } from '../../db/db';
import {
  toISODate,
  parseLocaleNumber,
  formatNumber,
  formatDate,
} from '../../utils/formatters';
import type {
  Product,
  ProductionEntry,
  ProductionItem,
  ProductionCosting,
  ProductionCostLine,
  ProductionCostPackagingLine,
  ProductionPackagingLineSnapshot,
  ProductionProductCostSnapshot,
  AppSettings,
  Employee,
  CostItem,
} from '../../types';

export function formatCostNumber(amount: number): string {
  if (!Number.isFinite(amount) || isNaN(amount)) return '0';
  const isNeg = amount < 0;
  const absRounded = Math.round(Math.abs(amount) * 100) / 100;
  if (absRounded === 0) return '0';
  const [intPart, decPart] = absRounded.toFixed(2).split('.');
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const trimmedDec = decPart.replace(/0+$/, '');
  const formatted = trimmedDec ? `${formattedInt},${trimmedDec}` : formattedInt;
  return isNeg ? `-${formatted}` : formatted;
}

export function formatCostAmountFC(amount: number, currency = 'FC'): string {
  return `${formatCostNumber(amount)} ${currency}`;
}

interface IngredientFormRow {
  rowId: string;
  itemId: string;
  qtyStr: string;
  frozen?: {
    name: string;
    usageUnit: string;
    unitCostFC: number;
    allowDecimals: boolean;
  };
}

interface ProductionStockModalProps {
  isOpen: boolean;
  entryToEdit?: ProductionEntry | null;
  products: Product[];
  settings?: AppSettings;
  employees?: Employee[];
  productionEntries?: ProductionEntry[];
  onClose: () => void;
  onSaved: () => void;
}

export const ProductionStockModal: React.FC<ProductionStockModalProps> = ({
  isOpen,
  entryToEdit,
  products,
  settings,
  employees = [],
  productionEntries = [],
  onClose,
  onSaved,
}) => {
  const [date, setDate] = useState(toISODate(new Date()));
  const [items, setItems] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [copyInfoMsg, setCopyInfoMsg] = useState('');

  // Costing form states
  const [ingredientRows, setIngredientRows] = useState<IngredientFormRow[]>([]);
  const [sellPriceInputs, setSellPriceInputs] = useState<Record<string, string>>({});
  const [sellerChoice, setSellerChoice] = useState<string>('self');
  const [useFrozenProductPackaging, setUseFrozenProductPackaging] = useState(false);

  const currency = settings?.currency || 'FC';
  const costItems: CostItem[] = settings?.costItems ?? [];
  const productCosting = settings?.productCosting ?? {};

  const costItemsById = new Map<string, CostItem>();
  for (const ci of costItems) {
    costItemsById.set(ci.id, ci);
  }

  const activeIngredients = costItems.filter(
    (ci) => ci.kind === 'ingredient' && ci.isActive
  );
  const activeEmployees = employees.filter((e) => !e.isArchived);

  const modalProducts = products.filter(
    (p) =>
      p.isActive ||
      Boolean(entryToEdit?.items.some((it) => it.productId === p.id && it.producedQty > 0))
  );

  // Latest production having recorded costing (for "Reprendre la dernière production")
  const lastCostedProduction = [...productionEntries]
    .filter(
      (pe) =>
        pe.id !== entryToEdit?.id &&
        pe.costing &&
        Array.isArray(pe.costing.lines) &&
        pe.costing.lines.length > 0
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)[0] || null;

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg('');
    setCopyInfoMsg('');

    const prodsForInit = products.filter(
      (p) =>
        p.isActive ||
        Boolean(entryToEdit?.items.some((it) => it.productId === p.id && it.producedQty > 0))
    );

    if (entryToEdit) {
      setDate(entryToEdit.date);
      setNotes(entryToEdit.notes || '');
      const stateObj: Record<string, string> = {};
      entryToEdit.items.forEach((item) => {
        stateObj[item.productId] = item.producedQty > 0 ? formatNumber(item.producedQty, 4) : '';
      });
      setItems(stateObj);

      if (entryToEdit.costing) {
        const frozenCosting = entryToEdit.costing;
        const rows: IngredientFormRow[] = frozenCosting.lines.map((line, idx) => {
          const catalogItem = costItems.find((ci) => ci.id === line.itemId);
          return {
            rowId: `frozen_${idx}_${line.itemId}`,
            itemId: line.itemId,
            qtyStr: formatNumber(line.qty, 4),
            frozen: {
              name: line.name,
              usageUnit: line.usageUnit,
              unitCostFC: line.unitCostFC,
              allowDecimals: catalogItem
                ? catalogItem.allowDecimals
                : !Number.isInteger(line.qty),
            },
          };
        });
        setIngredientRows(rows);

        const sellState: Record<string, string> = {};
        prodsForInit.forEach((p) => {
          const savedPrice = frozenCosting.sellPrices?.[p.id];
          sellState[p.id] =
            savedPrice !== undefined
              ? formatNumber(savedPrice, 4)
              : formatNumber(p.defaultPrice, 4);
        });
        setSellPriceInputs(sellState);

        // Restore seller selection
        if (
          frozenCosting.sellerId === 'self' ||
          (frozenCosting.commissionLabel === 'Moi-même' && frozenCosting.commissionPct === 0)
        ) {
          setSellerChoice('self');
        } else {
          const activeEmps = employees.filter((e) => !e.isArchived);
          const matchingEmp = activeEmps.find(
            (e) =>
              (frozenCosting.sellerId && e.id === frozenCosting.sellerId && e.commissionRate === frozenCosting.commissionPct && e.name === frozenCosting.commissionLabel) ||
              (!frozenCosting.sellerId && e.name === frozenCosting.commissionLabel && e.commissionRate === frozenCosting.commissionPct)
          );
          setSellerChoice(matchingEmp ? matchingEmp.id : 'frozen_seller');
        }

        setUseFrozenProductPackaging(true);
      } else {
        setIngredientRows([]);
        const sellState: Record<string, string> = {};
        prodsForInit.forEach((p) => {
          sellState[p.id] = formatNumber(p.defaultPrice, 4);
        });
        setSellPriceInputs(sellState);
        setSellerChoice('self');
        setUseFrozenProductPackaging(false);
      }
    } else {
      setDate(toISODate(new Date()));
      setNotes('');
      const stateObj: Record<string, string> = {};
      const sellState: Record<string, string> = {};
      prodsForInit.forEach((p) => {
        stateObj[p.id] = '';
        sellState[p.id] = formatNumber(p.defaultPrice, 4);
      });
      setItems(stateObj);
      setIngredientRows([]);
      setSellPriceInputs(sellState);
      setSellerChoice('self');
      setUseFrozenProductPackaging(false);
    }
  }, [isOpen, entryToEdit]);

  if (!isOpen) return null;

  const handleQtyChange = (productId: string, val: string) => {
    const sanitized = val.replace(/[^0-9.,]/g, '');
    setItems((prev) => ({
      ...prev,
      [productId]: sanitized,
    }));
  };

  const handleSellPriceChange = (productId: string, val: string) => {
    const sanitized = val.replace(/[^0-9.,]/g, '');
    setSellPriceInputs((prev) => ({
      ...prev,
      [productId]: sanitized,
    }));
  };

  const handleAddIngredientRow = () => {
    setCopyInfoMsg('');
    if (activeIngredients.length === 0) {
      setCopyInfoMsg(
        'Aucun ingrédient actif dans les Paramètres (section Coût de revient : ingrédients et emballages).'
      );
      return;
    }
    const usedIds = new Set(ingredientRows.map((r) => r.itemId));
    const defaultItem =
      activeIngredients.find((ing) => !usedIds.has(ing.id)) || activeIngredients[0];

    setIngredientRows((prev) => [
      ...prev,
      {
        rowId: 'row_' + Date.now().toString() + '_' + Math.random().toString(36).slice(2, 6),
        itemId: defaultItem.id,
        qtyStr: '1',
      },
    ]);
  };

  const handleChangeIngredientItem = (rowId: string, newItemId: string) => {
    const selectedItem = costItemsById.get(newItemId);
    setIngredientRows((prev) =>
      prev.map((row) => {
        if (row.rowId !== rowId) return row;
        let nextQty = row.qtyStr;
        if (selectedItem && !selectedItem.allowDecimals) {
          const parsed = parseLocaleNumber(nextQty);
          if (Number.isFinite(parsed) && parsed > 0 && !Number.isInteger(parsed)) {
            nextQty = String(Math.max(1, Math.round(parsed)));
          } else {
            nextQty = nextQty.replace(/[^0-9]/g, '');
          }
        }
        return {
          rowId: row.rowId,
          itemId: newItemId,
          qtyStr: nextQty,
          frozen: undefined, // Nouveau choix : prix lu dans les réglages actuels
        };
      })
    );
  };

  const handleChangeIngredientQty = (
    rowId: string,
    val: string,
    allowDecimals: boolean
  ) => {
    const sanitized = allowDecimals
      ? val.replace(/[^0-9.,]/g, '')
      : val.replace(/[^0-9]/g, '');
    setIngredientRows((prev) =>
      prev.map((row) => (row.rowId === rowId ? { ...row, qtyStr: sanitized } : row))
    );
  };

  const handleRemoveIngredientRow = (rowId: string) => {
    setIngredientRows((prev) => prev.filter((row) => row.rowId !== rowId));
  };

  const handleCopyLastProduction = () => {
    setErrorMsg('');
    if (!lastCostedProduction || !lastCostedProduction.costing) {
      setCopyInfoMsg('Aucune production précédente avec coûts enregistrés.');
      return;
    }

    const copiedRows: IngredientFormRow[] = [];
    let skippedCount = 0;

    lastCostedProduction.costing.lines.forEach((line, idx) => {
      // Relire l'ingrédient actif dans les réglages actuels
      const byId = activeIngredients.find((ing) => ing.id === line.itemId);
      const byName = !byId
        ? activeIngredients.find(
            (ing) => ing.name.trim().toLowerCase() === line.name.trim().toLowerCase()
          )
        : undefined;
      const targetItem = byId || byName;

      if (!targetItem) {
        skippedCount += 1;
        return;
      }

      const rawQty = line.qty;
      const adjustedQty =
        !targetItem.allowDecimals && !Number.isInteger(rawQty)
          ? Math.max(1, Math.round(rawQty))
          : rawQty;

      copiedRows.push({
        rowId: `copy_${Date.now()}_${idx}_${targetItem.id}`,
        itemId: targetItem.id,
        qtyStr: formatNumber(adjustedQty, 4),
        frozen: undefined, // Prix relus dans les réglages actuels
      });
    });

    if (copiedRows.length === 0) {
      setCopyInfoMsg(
        'Les ingrédients de la dernière production sont actuellement désactivés dans les Paramètres.'
      );
      return;
    }

    setIngredientRows(copiedRows);
    setUseFrozenProductPackaging(false);
    setCopyInfoMsg(
      skippedCount > 0
        ? `Ingrédients actifs repris du ${formatDate(lastCostedProduction.date)} (${skippedCount} désactivé ignoré) — prix actuels appliqués.`
        : `Ingrédients repris du ${formatDate(lastCostedProduction.date)} (prix actuels appliqués).`
    );
  };

  // --- LIVE CALCULATIONS ---
  const computedIngredientLines: Array<
    ProductionCostLine & { rowId: string; allowDecimals: boolean; rawQtyStr: string }
  > = ingredientRows.map((row) => {
    const catalogItem = costItemsById.get(row.itemId);
    const name = row.frozen ? row.frozen.name : catalogItem?.name || 'Ingrédient';
    const usageUnit = row.frozen ? row.frozen.usageUnit : catalogItem?.usageUnit || 'unité';
    const unitCostFC = row.frozen
      ? row.frozen.unitCostFC
      : catalogItem && catalogItem.usageUnitsPerPurchase > 0
      ? catalogItem.purchasePriceFC / catalogItem.usageUnitsPerPurchase
      : 0;
    const allowDecimals = catalogItem
      ? catalogItem.allowDecimals
      : row.frozen?.allowDecimals ?? false;

    const parsedQty = row.qtyStr.trim() !== '' ? parseLocaleNumber(row.qtyStr) : 0;
    const validQty = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 0;
    const totalFC = validQty * unitCostFC;

    return {
      rowId: row.rowId,
      itemId: row.itemId,
      name,
      qty: validQty,
      usageUnit,
      unitCostFC,
      totalFC,
      allowDecimals,
      rawQtyStr: row.qtyStr,
    };
  });

  const ingredientsFC = computedIngredientLines.reduce((sum, l) => sum + l.totalFC, 0);

  const producedQuantities = modalProducts.map((prod) => ({
    product: prod,
    producedQty: Math.max(0, parseLocaleNumber(items[prod.id])),
  }));

  const totalProduced = producedQuantities.reduce((sum, p) => sum + p.producedQty, 0);

  // Per-product packaging & volumeWeight
  const frozenBreakdownMap = new Map<string, ProductionProductCostSnapshot>();
  if (useFrozenProductPackaging && entryToEdit?.costing?.productBreakdown) {
    for (const snap of entryToEdit.costing.productBreakdown) {
      frozenBreakdownMap.set(snap.productId, snap);
    }
  }

  const perProductIntermediate = producedQuantities.map(({ product, producedQty }) => {
    const frozenSnap = frozenBreakdownMap.get(product.id);
    let volumeWeight = 1;
    let packagingUnitCostFC = 0;
    let packagingLines: ProductionPackagingLineSnapshot[] = [];

    if (frozenSnap) {
      volumeWeight = frozenSnap.volumeWeight > 0 ? frozenSnap.volumeWeight : 1;
      packagingUnitCostFC = frozenSnap.packagingUnitCostFC;
      if (frozenSnap.packagingLines) {
        packagingLines = frozenSnap.packagingLines.map((pl) => ({
          itemId: pl.itemId,
          name: pl.name,
          qtyPerUnit: pl.qtyPerUnit,
          totalQty: pl.qtyPerUnit * producedQty,
          usageUnit: pl.usageUnit,
          unitCostFC: pl.unitCostFC,
          totalFC: pl.qtyPerUnit * producedQty * pl.unitCostFC,
        }));
      }
    } else {
      const cfg = productCosting[product.id];
      volumeWeight = cfg && cfg.volumeWeight > 0 ? cfg.volumeWeight : 1;
      const cfgLines = cfg?.packaging ?? [];
      for (const line of cfgLines) {
        const pkgItem = costItemsById.get(line.itemId);
        if (
          !pkgItem ||
          pkgItem.kind !== 'packaging' ||
          !pkgItem.isActive ||
          pkgItem.usageUnitsPerPurchase <= 0
        ) {
          continue;
        }
        const pkgUnitCost = pkgItem.purchasePriceFC / pkgItem.usageUnitsPerPurchase;
        packagingUnitCostFC += line.qtyPerUnit * pkgUnitCost;
        packagingLines.push({
          itemId: pkgItem.id,
          name: pkgItem.name,
          qtyPerUnit: line.qtyPerUnit,
          totalQty: line.qtyPerUnit * producedQty,
          usageUnit: pkgItem.usageUnit,
          unitCostFC: pkgUnitCost,
          totalFC: line.qtyPerUnit * producedQty * pkgUnitCost,
        });
      }
    }

    const packagingTotalFC = producedQty * packagingUnitCostFC;
    const rawSellStr = sellPriceInputs[product.id];
    const parsedSell =
      rawSellStr !== undefined && rawSellStr.trim() !== ''
        ? parseLocaleNumber(rawSellStr)
        : product.defaultPrice;
    const sellPriceFC = Number.isFinite(parsedSell) && parsedSell >= 0 ? parsedSell : 0;

    return {
      product,
      producedQty,
      volumeWeight,
      packagingUnitCostFC,
      packagingTotalFC,
      packagingLines,
      sellPriceFC,
    };
  });

  const packagingFC = perProductIntermediate.reduce(
    (sum, p) => sum + (p.producedQty > 0 ? p.packagingTotalFC : 0),
    0
  );
  const totalCostFC = ingredientsFC + packagingFC;

  const totalWeightedVolume = perProductIntermediate.reduce(
    (sum, p) => (p.producedQty > 0 ? sum + p.producedQty * p.volumeWeight : sum),
    0
  );

  const productBreakdown: ProductionProductCostSnapshot[] = perProductIntermediate.map((p) => {
    const ingredientShareFC =
      p.producedQty > 0 && totalWeightedVolume > 0
        ? ingredientsFC * ((p.producedQty * p.volumeWeight) / totalWeightedVolume)
        : 0;
    const unitCostFC =
      p.producedQty > 0 ? ingredientShareFC / p.producedQty + p.packagingUnitCostFC : 0;
    const prodRevenueFC = p.producedQty * p.sellPriceFC;

    return {
      productId: p.product.id,
      productName: p.product.name,
      producedQty: p.producedQty,
      volumeWeight: p.volumeWeight,
      packagingUnitCostFC: p.packagingUnitCostFC,
      packagingTotalFC: p.producedQty > 0 ? p.packagingTotalFC : 0,
      packagingLines: p.packagingLines,
      ingredientShareFC,
      unitCostFC,
      sellPriceFC: p.sellPriceFC,
      revenueFC: prodRevenueFC,
    };
  });

  // Aggregated packaging summary across produced products
  const aggregatedPackagingMap = new Map<
    string,
    { name: string; totalQty: number; usageUnit: string; totalFC: number }
  >();
  for (const pb of productBreakdown) {
    if (pb.producedQty <= 0 || !pb.packagingLines) continue;
    for (const pl of pb.packagingLines) {
      if (pl.totalQty <= 0) continue;
      const existing = aggregatedPackagingMap.get(pl.itemId);
      if (existing) {
        existing.totalQty += pl.totalQty;
        existing.totalFC += pl.totalFC;
      } else {
        aggregatedPackagingMap.set(pl.itemId, {
          name: pl.name,
          totalQty: pl.totalQty,
          usageUnit: pl.usageUnit,
          totalFC: pl.totalFC,
        });
      }
    }
  }
  const aggregatedPackagingList = Array.from(aggregatedPackagingMap.values());

  const revenueFC = productBreakdown.reduce((sum, pb) => sum + pb.revenueFC, 0);
  const gainFC = revenueFC - totalCostFC;

  // Resolve seller commission
  let commissionLabel = 'Moi-même';
  let commissionPct = 0;
  let resolvedSellerId = 'self';

  if (sellerChoice === 'frozen_seller' && entryToEdit?.costing) {
    commissionLabel = entryToEdit.costing.commissionLabel;
    commissionPct = entryToEdit.costing.commissionPct;
    resolvedSellerId = entryToEdit.costing.sellerId || 'frozen_seller';
  } else if (sellerChoice !== 'self') {
    const selectedEmp = activeEmployees.find((e) => e.id === sellerChoice);
    if (selectedEmp) {
      commissionLabel = selectedEmp.name;
      commissionPct = selectedEmp.commissionRate;
      resolvedSellerId = selectedEmp.id;
    }
  }

  const commissionFC = (commissionPct / 100) * revenueFC;
  const netGainFC = gainFC - commissionFC;

  const hasIngredients = ingredientRows.length > 0;
  const isLosingMoney =
    hasIngredients && totalProduced > 0 && (gainFC <= 0 || netGainFC <= 0);
  const lossAmountFC = Math.max(0, -netGainFC);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const productionItems: ProductionItem[] = modalProducts.map((p) => ({
      productId: p.id,
      productName: p.name,
      producedQty: parseLocaleNumber(items[p.id]),
    }));

    const totalProd = productionItems.reduce((acc, i) => acc + i.producedQty, 0);
    if (totalProd <= 0) {
      setErrorMsg('Veuillez saisir au moins une quantité produite supérieure à 0.');
      return;
    }

    let frozenCosting: ProductionCosting | undefined = undefined;

    if (ingredientRows.length > 0) {
      // Validate each ingredient row
      for (const line of computedIngredientLines) {
        if (!line.itemId) {
          setErrorMsg('Veuillez sélectionner un ingrédient pour chaque ligne ajoutée.');
          return;
        }
        if (line.rawQtyStr.trim() === '' || line.qty <= 0) {
          setErrorMsg(
            `Veuillez saisir une quantité supérieure à 0 pour « ${line.name} » (ou supprimez la ligne).`
          );
          return;
        }
        if (!line.allowDecimals && !Number.isInteger(line.qty)) {
          setErrorMsg(
            `« ${line.name} » n’accepte que des nombres entiers (sans virgule).`
          );
          return;
        }
      }

      // Validate sell prices for produced products
      for (const pb of productBreakdown) {
        if (pb.producedQty > 0) {
          const rawSell = sellPriceInputs[pb.productId];
          if (rawSell !== undefined && rawSell.trim() === '') {
            setErrorMsg(`Veuillez indiquer un prix de vente pour « ${pb.productName} ».`);
            return;
          }
        }
      }

      const sellPricesRecord: Record<string, number> = {};
      for (const pb of productBreakdown) {
        sellPricesRecord[pb.productId] = pb.sellPriceFC;
      }

      const frozenLines: ProductionCostLine[] = computedIngredientLines.map((l) => ({
        itemId: l.itemId,
        name: l.name,
        qty: l.qty,
        usageUnit: l.usageUnit,
        unitCostFC: l.unitCostFC,
        totalFC: l.totalFC,
      }));

      // Pour les nouvelles productions (ou celles ayant déjà packagingLines), figer packagingLines
      const shouldStorePackagingLines =
        !entryToEdit ||
        !useFrozenProductPackaging ||
        Array.isArray(entryToEdit.costing?.packagingLines);

      let frozenPackagingLines: ProductionCostPackagingLine[] | undefined = undefined;
      if (shouldStorePackagingLines) {
        const pkgAgg = new Map<string, { itemId: string; name: string; qty: number }>();
        for (const pb of productBreakdown) {
          if (pb.producedQty <= 0 || !pb.packagingLines) continue;
          for (const pl of pb.packagingLines) {
            if (pl.totalQty <= 0) continue;
            const prev = pkgAgg.get(pl.itemId);
            if (prev) {
              prev.qty = Math.round((prev.qty + pl.totalQty) * 1_000_000) / 1_000_000;
            } else {
              pkgAgg.set(pl.itemId, {
                itemId: pl.itemId,
                name: pl.name,
                qty: Math.round(pl.totalQty * 1_000_000) / 1_000_000,
              });
            }
          }
        }
        frozenPackagingLines = Array.from(pkgAgg.values());
      }

      frozenCosting = {
        lines: frozenLines,
        ...(frozenPackagingLines !== undefined ? { packagingLines: frozenPackagingLines } : {}),
        ingredientsFC,
        packagingFC,
        totalCostFC,
        sellPrices: sellPricesRecord,
        revenueFC,
        gainFC,
        commissionLabel,
        commissionPct,
        netGainFC,
        sellerId: resolvedSellerId,
        productBreakdown,
      };
    }

    const newEntry: ProductionEntry = {
      id: entryToEdit ? entryToEdit.id : 'prod_entry_' + Date.now().toString(),
      date,
      items: productionItems,
      notes: notes.trim() || undefined,
      costing: frozenCosting,
      createdAt: entryToEdit ? entryToEdit.createdAt : Date.now(),
    };

    try {
      await db.productionEntries.put(newEntry);
      onSaved();
      onClose();
    } catch (err: any) {
      setErrorMsg('Erreur lors de l’enregistrement de la production : ' + err.message);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 flex flex-col overflow-hidden max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50/70">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {entryToEdit ? 'Modifier la Production' : 'Enregistrer la Production'}
            </h2>
            <p className="text-xs text-slate-500 font-medium">
              Yaourts fabriqués à la maison (virgules acceptées, ex : 11,5)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 min-w-[40px] min-h-[40px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
              {errorMsg}
            </div>
          )}

          {/* 1. Date */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Date de production *
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          {/* 2. Ingrédients utilisés (facultatif) */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className="text-xs font-bold text-slate-800">
                Ingrédients utilisés (facultatif)
              </label>
              <button
                type="button"
                onClick={handleCopyLastProduction}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white hover:bg-teal-50 text-teal-800 border border-teal-200 text-[11px] font-bold transition-colors min-h-[32px]"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reprendre la dernière production</span>
              </button>
            </div>

            {copyInfoMsg && (
              <p className="text-[11px] text-teal-800 bg-teal-50 border border-teal-200/80 px-2.5 py-1.5 rounded-lg font-medium">
                {copyInfoMsg}
              </p>
            )}

            {computedIngredientLines.length > 0 && (
              <div className="space-y-2">
                {computedIngredientLines.map((line) => {
                  const isCurrentInActive = activeIngredients.some(
                    (ing) => ing.id === line.itemId
                  );
                  return (
                    <div
                      key={line.rowId}
                      className="p-2.5 rounded-xl bg-white border border-slate-200 space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <select
                          value={line.itemId}
                          onChange={(e) =>
                            handleChangeIngredientItem(line.rowId, e.target.value)
                          }
                          className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-900 min-h-[36px]"
                        >
                          {!isCurrentInActive && (
                            <option value={line.itemId}>
                              {line.name} ({line.usageUnit}) — figé
                            </option>
                          )}
                          {activeIngredients.map((ing) => (
                            <option key={ing.id} value={ing.id}>
                              {ing.name} ({ing.usageUnit})
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleRemoveIngredientRow(line.rowId)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 min-w-[34px] min-h-[34px] flex items-center justify-center shrink-0"
                          title="Retirer cet ingrédient"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            inputMode={line.allowDecimals ? 'decimal' : 'numeric'}
                            placeholder={line.allowDecimals ? 'Ex : 1,5' : 'Ex : 2'}
                            value={line.rawQtyStr}
                            onChange={(e) =>
                              handleChangeIngredientQty(
                                line.rowId,
                                e.target.value,
                                line.allowDecimals
                              )
                            }
                            className="w-24 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-bold font-mono text-center text-slate-900 bg-white focus:ring-2 focus:ring-teal-500"
                          />
                          <span className="text-xs font-semibold text-slate-600">
                            {line.usageUnit}
                          </span>
                        </div>

                        <span className="text-xs font-extrabold font-mono text-teal-800">
                          {formatCostAmountFC(line.totalFC, currency)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <button
              type="button"
              onClick={handleAddIngredientRow}
              className="w-full py-2 px-3 rounded-xl border border-dashed border-teal-300 bg-white hover:bg-teal-50/60 text-teal-800 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors min-h-[38px]"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Ajouter un ingrédient</span>
            </button>
          </div>

          {/* 3. Quantités produites par produit */}
          <div className="space-y-2.5">
            <label className="block text-xs font-bold text-slate-700">
              Quantités produites par produit (ex : 11,5)
            </label>
            {modalProducts.map((prod) => (
              <div
                key={prod.id}
                className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-200"
              >
                <div>
                  <span className="text-sm font-bold text-slate-900 block">{prod.name}</span>
                  <span className="text-xs text-slate-500">Unité</span>
                </div>
                <div className="w-32">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={items[prod.id] || ''}
                    onChange={(e) => handleQtyChange(prod.id, e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-base font-bold font-mono text-center text-slate-900 bg-white focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* 4. Notes / Lot */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Notes / Lot (optionnel)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex : Fabrication du matin, 25L de lait"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          {/* 5. RÉSUMÉ EN DIRECT (en bas de la fenêtre, après les quantités produites) */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex items-center gap-1.5">
              <Calculator className="w-4 h-4 text-teal-700" />
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
                Résumé de coût et de gain (estimation)
              </h3>
            </div>

            {!hasIngredients ? (
              <p className="text-xs text-slate-500">
                {totalProduced <= 0
                  ? 'Saisis les quantités produites pour voir le gain (et ajoute des ingrédients ci-dessus si tu souhaites estimer le coût de revient).'
                  : 'Aucun ingrédient ajouté : la production sera enregistrée normalement sans calcul de coût.'}
              </p>
            ) : (
              <>
                {/* Ingrédients utilisés & sous-total */}
                <div className="p-2.5 rounded-xl bg-white border border-slate-200/80 space-y-1">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                    <span>Ingrédients utilisés</span>
                    <span className="font-mono text-teal-800">
                      {formatCostAmountFC(ingredientsFC, currency)}
                    </span>
                  </div>
                  <div className="space-y-0.5 pt-0.5">
                    {computedIngredientLines.map((l) => (
                      <div
                        key={l.rowId}
                        className="flex items-center justify-between text-[11px] text-slate-600"
                      >
                        <span>
                          {l.name} ({formatNumber(l.qty, 4)} {l.usageUnit})
                        </span>
                        <span className="font-mono">
                          {formatCostAmountFC(l.totalFC, currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {totalProduced <= 0 ? (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold text-center">
                    Saisis les quantités produites pour voir le gain
                  </div>
                ) : (
                  <>
                    {/* Emballage automatique */}
                    <div className="p-2.5 rounded-xl bg-white border border-slate-200/80 space-y-1">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                        <span>Emballage (automatique)</span>
                        <span className="font-mono text-teal-800">
                          {formatCostAmountFC(packagingFC, currency)}
                        </span>
                      </div>
                      {aggregatedPackagingList.length === 0 ? (
                        <p className="text-[11px] text-slate-400 italic">
                          Aucun emballage configuré pour ces produits dans les Paramètres.
                        </p>
                      ) : (
                        <div className="space-y-0.5 pt-0.5">
                          {aggregatedPackagingList.map((pk, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between text-[11px] text-slate-600"
                            >
                              <span>
                                {pk.name} ({formatNumber(pk.totalQty, 4)} {pk.usageUnit})
                              </span>
                              <span className="font-mono">
                                {formatCostAmountFC(pk.totalFC, currency)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Coût total de la production */}
                    <div className="p-2.5 rounded-xl bg-slate-900 text-white flex items-center justify-between">
                      <span className="text-xs font-bold">Coût total de la production</span>
                      <span className="text-sm font-extrabold font-mono">
                        {formatCostAmountFC(totalCostFC, currency)}
                      </span>
                    </div>

                    {/* Coût par unité & Prix de vente par produit */}
                    <div className="space-y-2">
                      <span className="block text-[11px] font-bold text-slate-700">
                        Coût par unité & prix de vente (pour cette production)
                      </span>
                      {productBreakdown
                        .filter((pb) => pb.producedQty > 0)
                        .map((pb) => (
                          <div
                            key={pb.productId}
                            className="p-2.5 rounded-xl bg-white border border-slate-200/80 space-y-2"
                          >
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div>
                                <span className="text-xs font-bold text-slate-900">
                                  {pb.productName}
                                </span>
                                <span className="ml-1.5 text-[11px] text-slate-500 font-mono">
                                  × {formatNumber(pb.producedQty, 4)}
                                </span>
                              </div>
                              <span className="text-[11px] font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded-md font-mono">
                                Coût / unité : {formatCostAmountFC(pb.unitCostFC, currency)}
                              </span>
                            </div>

                            <div className="flex items-center justify-between gap-2 text-xs">
                              <div className="flex items-center gap-1.5">
                                <label className="text-[11px] font-semibold text-slate-600">
                                  Prix de vente :
                                </label>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={sellPriceInputs[pb.productId] ?? ''}
                                  onChange={(e) =>
                                    handleSellPriceChange(pb.productId, e.target.value)
                                  }
                                  className="w-24 px-2 py-1 rounded-lg border border-slate-300 text-xs font-bold font-mono text-center text-slate-900 bg-white"
                                />
                                <span className="text-[11px] text-slate-500 font-semibold">
                                  {currency}
                                </span>
                              </div>
                              <span className="text-[11px] font-bold text-slate-700 font-mono">
                                Ventes : {formatCostAmountFC(pb.revenueFC, currency)}
                              </span>
                            </div>
                          </div>
                        ))}
                    </div>

                    {/* Choix "Qui vend ?" */}
                    <div className="p-2.5 rounded-xl bg-white border border-slate-200/80 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-bold text-slate-800">Qui vend ?</label>
                        <select
                          value={sellerChoice}
                          onChange={(e) => setSellerChoice(e.target.value)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-900 min-h-[34px]"
                        >
                          <option value="self">Moi-même (0 %)</option>
                          {sellerChoice === 'frozen_seller' && entryToEdit?.costing && (
                            <option value="frozen_seller">
                              {entryToEdit.costing.commissionLabel} (
                              {formatNumber(entryToEdit.costing.commissionPct, 2)} %)
                            </option>
                          )}
                          {activeEmployees.map((emp) => (
                            <option key={emp.id} value={emp.id}>
                              {emp.name} ({formatNumber(emp.commissionRate, 2)} %)
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="pt-1.5 border-t border-slate-100 space-y-1 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-600 font-medium">
                            Ventes totales (si tout est vendu)
                          </span>
                          <span className="font-bold font-mono text-slate-900">
                            {formatCostAmountFC(revenueFC, currency)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-700 font-semibold">
                            Gain avant commission (ventes − coût)
                          </span>
                          <span
                            className={`font-extrabold font-mono ${
                              gainFC <= 0 ? 'text-rose-600' : 'text-emerald-700'
                            }`}
                          >
                            {formatCostAmountFC(gainFC, currency)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <span>
                            Commission ({commissionLabel} · {formatNumber(commissionPct, 2)} %)
                          </span>
                          <span className="font-mono">
                            -{formatCostAmountFC(commissionFC, currency)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                          <span className="text-slate-900 font-extrabold">
                            Gain après commission
                          </span>
                          <span
                            className={`text-sm font-extrabold font-mono ${
                              netGainFC <= 0 ? 'text-rose-600' : 'text-emerald-700'
                            }`}
                          >
                            {formatCostAmountFC(netGainFC, currency)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* ALERTE UNIQUE SI GAIN <= 0 */}
                    {isLosingMoney && (
                      <div className="p-3 rounded-xl bg-rose-600 text-white text-xs font-extrabold flex items-center gap-2 shadow-xs">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>
                          Aucun bénéfice avec ces prix : tu perds{' '}
                          {formatCostNumber(lossAmountFC)} {currency}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          <div className="pt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 min-h-[44px]"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="flex-1 py-3 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold shadow-xs active:scale-95 transition-all flex items-center justify-center gap-1.5 min-h-[44px]"
            >
              <Check className="w-4 h-4" />
              <span>{entryToEdit ? 'Mettre à jour' : 'Enregistrer la production'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface ProductionCostDetailModalProps {
  entry: ProductionEntry | null;
  currency?: string;
  onClose: () => void;
}

export const ProductionCostDetailModal: React.FC<ProductionCostDetailModalProps> = ({
  entry,
  currency = 'FC',
  onClose,
}) => {
  if (!entry || !entry.costing) return null;

  const { costing } = entry;
  const commissionFC = (costing.commissionPct / 100) * costing.revenueFC;
  const isLosingMoney = costing.gainFC <= 0 || costing.netGainFC <= 0;
  const lossAmountFC = Math.max(0, -costing.netGainFC);

  // Build product breakdown from frozen snapshot or fallback from entry.items + sellPrices
  const breakdown: ProductionProductCostSnapshot[] =
    costing.productBreakdown && costing.productBreakdown.length > 0
      ? costing.productBreakdown.filter((pb) => pb.producedQty > 0)
      : entry.items
          .filter((it) => it.producedQty > 0)
          .map((it) => {
            const totalUnits = entry.items.reduce(
              (s, x) => s + (x.producedQty > 0 ? x.producedQty : 0),
              0
            );
            const share =
              totalUnits > 0 ? costing.totalCostFC * (it.producedQty / totalUnits) : 0;
            const unitCost = it.producedQty > 0 ? share / it.producedQty : 0;
            const sellPrice = costing.sellPrices?.[it.productId] ?? 0;
            return {
              productId: it.productId,
              productName: it.productName,
              producedQty: it.producedQty,
              volumeWeight: 1,
              packagingUnitCostFC: 0,
              packagingTotalFC: 0,
              ingredientShareFC: share,
              unitCostFC: unitCost,
              sellPriceFC: sellPrice,
              revenueFC: it.producedQty * sellPrice,
            };
          });

  // Aggregate packaging lines if saved in productBreakdown
  const aggregatedPkgMap = new Map<
    string,
    { name: string; totalQty: number; usageUnit: string; totalFC: number }
  >();
  for (const pb of breakdown) {
    if (!pb.packagingLines) continue;
    for (const pl of pb.packagingLines) {
      if (pl.totalQty <= 0) continue;
      const existing = aggregatedPkgMap.get(pl.itemId);
      if (existing) {
        existing.totalQty += pl.totalQty;
        existing.totalFC += pl.totalFC;
      } else {
        aggregatedPkgMap.set(pl.itemId, {
          name: pl.name,
          totalQty: pl.totalQty,
          usageUnit: pl.usageUnit,
          totalFC: pl.totalFC,
        });
      }
    }
  }
  const aggregatedPkgList = Array.from(aggregatedPkgMap.values());

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 flex flex-col overflow-hidden max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50/70">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Détail du coût & gain — {formatDate(entry.date)}
            </h2>
            <p className="text-xs text-slate-500 font-medium">
              Estimation figée au moment de l’enregistrement (lecture seule)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 min-w-[40px] min-h-[40px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-3.5">
          {/* Quantités produites */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs space-y-1">
            <span className="font-bold text-slate-700 block">Quantités produites</span>
            <div className="flex flex-wrap gap-2 font-mono text-slate-800">
              {entry.items
                .filter((i) => i.producedQty > 0)
                .map((i) => (
                  <span key={i.productId}>
                    {i.productName} : <strong>{formatNumber(i.producedQty, 4)}</strong>
                  </span>
                ))}
            </div>
            {entry.notes && (
              <p className="text-[11px] text-slate-500 italic pt-0.5">{entry.notes}</p>
            )}
          </div>

          {/* Ingrédients utilisés */}
          <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-bold text-slate-800">
              <span>Ingrédients utilisés</span>
              <span className="font-mono text-teal-800">
                {formatCostAmountFC(costing.ingredientsFC, currency)}
              </span>
            </div>
            <div className="space-y-1 pt-0.5">
              {costing.lines.map((l, idx) => (
                <div
                  key={`${l.itemId}_${idx}`}
                  className="flex items-center justify-between text-[11px] text-slate-600"
                >
                  <span>
                    {l.name} : {formatNumber(l.qty, 4)} {l.usageUnit} ×{' '}
                    {formatCostAmountFC(l.unitCostFC, currency)}
                  </span>
                  <span className="font-mono font-semibold text-slate-800">
                    {formatCostAmountFC(l.totalFC, currency)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Emballage */}
          <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-bold text-slate-800">
              <span>Emballage (automatique)</span>
              <span className="font-mono text-teal-800">
                {formatCostAmountFC(costing.packagingFC, currency)}
              </span>
            </div>
            {aggregatedPkgList.length > 0 && (
              <div className="space-y-1 pt-0.5">
                {aggregatedPkgList.map((pk, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-[11px] text-slate-600"
                  >
                    <span>
                      {pk.name} ({formatNumber(pk.totalQty, 4)} {pk.usageUnit})
                    </span>
                    <span className="font-mono font-semibold text-slate-800">
                      {formatCostAmountFC(pk.totalFC, currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Coût total */}
          <div className="p-3 rounded-xl bg-slate-900 text-white flex items-center justify-between">
            <span className="text-xs font-bold">Coût total de la production</span>
            <span className="text-sm font-extrabold font-mono">
              {formatCostAmountFC(costing.totalCostFC, currency)}
            </span>
          </div>

          {/* Coût par unité & prix de vente */}
          <div className="space-y-2">
            <span className="block text-[11px] font-bold text-slate-700">
              Coût par unité & prix de vente retenus
            </span>
            {breakdown.map((pb) => (
              <div
                key={pb.productId}
                className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1 text-xs"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-bold text-slate-900">
                    {pb.productName} × {formatNumber(pb.producedQty, 4)}
                  </span>
                  <span className="text-[11px] font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded-md font-mono">
                    Coût / unité : {formatCostAmountFC(pb.unitCostFC, currency)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-600 font-mono">
                  <span>Prix de vente : {formatCostAmountFC(pb.sellPriceFC, currency)}</span>
                  <span className="font-bold text-slate-800">
                    Ventes : {formatCostAmountFC(pb.revenueFC, currency)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Ventes & Gains */}
          <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-600 font-medium">Qui vend ?</span>
              <span className="font-bold text-slate-900">
                {costing.commissionLabel} ({formatNumber(costing.commissionPct, 2)} %)
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600 font-medium">
                Ventes totales (si tout est vendu)
              </span>
              <span className="font-bold font-mono text-slate-900">
                {formatCostAmountFC(costing.revenueFC, currency)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-700 font-semibold">
                Gain avant commission (ventes − coût)
              </span>
              <span
                className={`font-extrabold font-mono ${
                  costing.gainFC <= 0 ? 'text-rose-600' : 'text-emerald-700'
                }`}
              >
                {formatCostAmountFC(costing.gainFC, currency)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>
                Commission ({costing.commissionLabel} · {formatNumber(costing.commissionPct, 2)} %)
              </span>
              <span className="font-mono">-{formatCostAmountFC(commissionFC, currency)}</span>
            </div>
            <div className="flex items-center justify-between pt-1.5 border-t border-slate-100">
              <span className="text-slate-900 font-extrabold">Gain après commission</span>
              <span
                className={`text-sm font-extrabold font-mono ${
                  costing.netGainFC <= 0 ? 'text-rose-600' : 'text-emerald-700'
                }`}
              >
                {formatCostAmountFC(costing.netGainFC, currency)}
              </span>
            </div>
          </div>

          {/* ALERTE UNIQUE SI GAIN <= 0 */}
          {isLosingMoney && (
            <div className="p-3 rounded-xl bg-rose-600 text-white text-xs font-extrabold flex items-center gap-2 shadow-xs">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                Aucun bénéfice avec ces prix : tu perds {formatCostNumber(lossAmountFC)}{' '}
                {currency}
              </span>
            </div>
          )}

          <div className="pt-1">
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold min-h-[42px]"
            >
              Fermer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
