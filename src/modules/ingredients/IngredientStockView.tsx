import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  Package,
  TrendingUp,
  SlidersHorizontal,
  ShoppingCart,
  Plus,
  Edit2,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  X,
  Share2,
  Store,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { liveQuery } from 'dexie';
import { db } from '../../db/db';
import {
  formatFC,
  formatDate,
  formatNumber,
  formatPercent,
  parseLocaleNumber,
  toISODate,
} from '../../utils/formatters';
import {
  STOCK_ADJUSTMENT_REASON_LABELS,
  calculateIngredientsStock,
  calculateItemsPriceAnalytics,
} from '../../utils/ingredientStockCalculator';
import { SecurityConfirmModal } from '../../components/SecurityConfirmModal';
import type {
  AppSettings,
  CostItem,
  Expense,
  Product,
  ProductionEntry,
  StockAdjustment,
  StockAdjustmentReason,
} from '../../types';

export type StockSubTab = 'stock' | 'prices' | 'adjustments' | 'shopping';
type AdjustmentInputMode = 'delta' | 'count';

interface IngredientStockViewProps {
  settings: AppSettings;
  onBack: () => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
  initialTab?: StockSubTab;
}

function formatFlexibleFC(amount: number, currency = 'FC'): string {
  if (!Number.isFinite(amount) || isNaN(amount)) return `0 ${currency}`;
  if (Math.abs(amount - Math.round(amount)) < 0.005) {
    return formatFC(Math.round(amount), currency);
  }
  const fixed = amount.toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const sign = intPart.startsWith('-') ? '-' : '';
  const digits = sign ? intPart.slice(1) : intPart;
  const formattedInt = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const trimmedDec = decPart.replace(/0+$/, '');
  return trimmedDec
    ? `${sign}${formattedInt},${trimmedDec} ${currency}`
    : `${sign}${formattedInt} ${currency}`;
}

export const IngredientStockView: React.FC<IngredientStockViewProps> = ({
  settings,
  onBack,
  onShowToast,
  initialTab,
}) => {
  const [subTab, setSubTab] = useState<StockSubTab>(initialTab || 'stock');

  useEffect(() => {
    if (initialTab) {
      setSubTab(initialTab);
    }
  }, [initialTab]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [productionEntries, setProductionEntries] = useState<ProductionEntry[]>([]);
  const [stockAdjustments, setStockAdjustments] = useState<StockAdjustment[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [showMissingProdList, setShowMissingProdList] = useState(false);

  // Filter for Prix tab
  const [selectedPriceItemId, setSelectedPriceItemId] = useState<string>('all');

  // Shopping list editable quantities (in purchase units)
  const [shoppingQtyInputs, setShoppingQtyInputs] = useState<Record<string, string>>({});

  // Adjustment modal state
  const [isAdjModalOpen, setIsAdjModalOpen] = useState(false);
  const [editingAdj, setEditingAdj] = useState<StockAdjustment | null>(null);
  const [adjItemId, setAdjItemId] = useState('');
  const [adjDate, setAdjDate] = useState(toISODate(new Date()));
  const [adjMode, setAdjMode] = useState<AdjustmentInputMode>('delta');
  const [adjSign, setAdjSign] = useState<'remove' | 'add'>('remove');
  const [adjQtyStr, setAdjQtyStr] = useState('');
  const [adjCountedStr, setAdjCountedStr] = useState('');
  const [adjReason, setAdjReason] = useState<StockAdjustmentReason>('renverse');
  const [adjNote, setAdjNote] = useState('');
  const [adjError, setAdjError] = useState('');

  // Deletion confirmation state
  const [adjToDelete, setAdjToDelete] = useState<StockAdjustment | null>(null);

  const currency = settings.currency || 'FC';
  const costItems = useMemo(() => settings.costItems ?? [], [settings.costItems]);
  const productCosting = settings.productCosting;
  const stockStartDate = settings.stockStartDate;
  const stockStart = settings.stockStart;
  const stockLowBatches = settings.stockLowBatches ?? 1;
  const priceRiseAlertPct = settings.priceRiseAlertPct ?? 5;

  useEffect(() => {
    const sub = liveQuery(async () => {
      const [exps, prods, adjs, catProds] = await Promise.all([
        db.expenses.toArray(),
        db.productionEntries.toArray(),
        db.stockAdjustments.toArray(),
        db.products.toArray(),
      ]);
      return { exps, prods, adjs, catProds };
    }).subscribe({
      next: ({ exps, prods, adjs, catProds }) => {
        setExpenses(exps);
        setProductionEntries(prods);
        setStockAdjustments(adjs);
        setProducts(catProds);
      },
      error: (err) => {
        console.error('Erreur chargement stock ingrédients:', err);
      },
    });
    return () => sub.unsubscribe();
  }, []);

  const costItemsById = useMemo(() => {
    const map = new Map<string, CostItem>();
    for (const it of costItems) {
      map.set(it.id, it);
    }
    return map;
  }, [costItems]);

  const productsById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of products) {
      map.set(p.id, p);
    }
    return map;
  }, [products]);

  // 1. Real-time stock computation
  const stockResult = useMemo(
    () =>
      calculateIngredientsStock({
        costItems,
        expenses,
        productionEntries,
        stockAdjustments,
        productCosting,
        stockStartDate,
        stockStart,
        stockLowBatches,
      }),
    [
      costItems,
      expenses,
      productionEntries,
      stockAdjustments,
      productCosting,
      stockStartDate,
      stockStart,
      stockLowBatches,
    ]
  );

  // 2. Price analytics computation
  const priceAnalytics = useMemo(
    () =>
      calculateItemsPriceAnalytics({
        costItems,
        expenses,
        productionEntries,
        productCosting,
        priceRiseAlertPct,
      }),
    [costItems, expenses, productionEntries, productCosting, priceRiseAlertPct]
  );

  const priceAnalyticsByItemId = useMemo(() => {
    const map = new Map<string, (typeof priceAnalytics)[number]>();
    for (const entry of priceAnalytics) {
      map.set(entry.item.id, entry);
    }
    return map;
  }, [priceAnalytics]);

  // Keep default 1 purchase unit for items needing purchase
  const shoppingItems = useMemo(
    () => stockResult.items.filter((res) => res.needsPurchase),
    [stockResult.items]
  );

  useEffect(() => {
    setShoppingQtyInputs((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const sItem of shoppingItems) {
        if (next[sItem.item.id] === undefined) {
          next[sItem.item.id] = '1';
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [shoppingItems]);

  // Selectable items for adjustments (active tracked items + editing item if inactive)
  const adjustableItems = useMemo(() => {
    return costItems.filter(
      (it) =>
        (it.isActive !== false && it.trackStock !== false) ||
        (editingAdj && it.id === editingAdj.itemId)
    );
  }, [costItems, editingAdj]);

  // Theoretical stock at adjDate when using "Compter le stock"
  const theoreticalAtAdjDate = useMemo(() => {
    if (!isAdjModalOpen || !adjItemId) return 0;
    const snap = calculateIngredientsStock({
      costItems,
      expenses,
      productionEntries,
      stockAdjustments,
      productCosting,
      stockStartDate,
      stockStart,
      stockLowBatches,
      endDate: adjDate || undefined,
      excludeAdjustmentId: editingAdj?.id,
    });
    const found = snap.items.find((r) => r.item.id === adjItemId);
    return found ? found.stockUsageQty : 0;
  }, [
    isAdjModalOpen,
    adjItemId,
    adjDate,
    editingAdj,
    costItems,
    expenses,
    productionEntries,
    stockAdjustments,
    productCosting,
    stockStartDate,
    stockStart,
    stockLowBatches,
  ]);

  const selectedAdjItem = costItemsById.get(adjItemId);

  const liveCountedDelta = useMemo(() => {
    if (adjMode !== 'count') return null;
    if (adjCountedStr.trim() === '') return null;
    const counted = parseLocaleNumber(adjCountedStr);
    if (!Number.isFinite(counted) || counted < 0) return null;
    return Math.round((counted - theoreticalAtAdjDate) * 1_000_000) / 1_000_000;
  }, [adjMode, adjCountedStr, theoreticalAtAdjDate]);

  const openCreateAdjModal = (preselectedItemId?: string) => {
    const firstId = preselectedItemId || adjustableItems[0]?.id || '';
    setEditingAdj(null);
    setAdjItemId(firstId);
    setAdjDate(toISODate(new Date()));
    setAdjMode('delta');
    setAdjSign('remove');
    setAdjQtyStr('');
    setAdjCountedStr('');
    setAdjReason('renverse');
    setAdjNote('');
    setAdjError('');
    setIsAdjModalOpen(true);
  };

  const openEditAdjModal = (adj: StockAdjustment) => {
    setEditingAdj(adj);
    setAdjItemId(adj.itemId);
    setAdjDate(adj.date);
    setAdjMode('delta');
    setAdjSign(adj.qtyDelta >= 0 ? 'add' : 'remove');
    setAdjQtyStr(formatNumber(Math.abs(adj.qtyDelta), 4));
    setAdjCountedStr('');
    setAdjReason(adj.reason);
    setAdjNote(adj.note || '');
    setAdjError('');
    setIsAdjModalOpen(true);
  };

  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdjError('');

    const item = costItemsById.get(adjItemId);
    if (!item) {
      setAdjError('Veuillez choisir un ingrédient ou emballage.');
      return;
    }
    if (!adjDate) {
      setAdjError('Veuillez indiquer la date de l’ajustement.');
      return;
    }
    if (stockStartDate && adjDate < stockStartDate) {
      setAdjError(
        `La date (${formatDate(adjDate)}) est antérieure à la date du stock de départ (${formatDate(
          stockStartDate
        )}).`
      );
      return;
    }
    if (!adjReason || !STOCK_ADJUSTMENT_REASON_LABELS[adjReason]) {
      setAdjError('Veuillez sélectionner un motif obligatoire.');
      return;
    }

    let finalDelta = 0;

    if (adjMode === 'delta') {
      if (adjQtyStr.trim() === '') {
        setAdjError('Veuillez saisir la quantité à ajuster.');
        return;
      }
      const rawQty = parseLocaleNumber(adjQtyStr);
      if (!Number.isFinite(rawQty) || rawQty <= 0) {
        setAdjError('La quantité doit être supérieure à 0.');
        return;
      }
      if (!item.allowDecimals && !Number.isInteger(rawQty)) {
        setAdjError(
          `« ${item.name} » n’accepte pas les quantités avec virgule (nombre entier requis).`
        );
        return;
      }
      finalDelta = adjSign === 'add' ? rawQty : -rawQty;
    } else {
      if (adjCountedStr.trim() === '') {
        setAdjError('Veuillez saisir la quantité réelle comptée.');
        return;
      }
      const counted = parseLocaleNumber(adjCountedStr);
      if (!Number.isFinite(counted) || counted < 0) {
        setAdjError('La quantité réelle comptée doit être positive ou nulle.');
        return;
      }
      if (!item.allowDecimals && !Number.isInteger(counted)) {
        setAdjError(
          `« ${item.name} » n’accepte pas les quantités avec virgule (nombre entier requis).`
        );
        return;
      }
      finalDelta = Math.round((counted - theoreticalAtAdjDate) * 1_000_000) / 1_000_000;
      if (Math.abs(finalDelta) < 0.000001) {
        setAdjError('Aucun écart : la quantité comptée correspond déjà au stock calculé.');
        return;
      }
    }

    const trimmedNote = adjNote.trim();

    if (editingAdj) {
      const updated: StockAdjustment = {
        ...editingAdj,
        itemId: item.id,
        date: adjDate,
        qtyDelta: finalDelta,
        reason: adjReason,
        note: trimmedNote || undefined,
      };
      await db.stockAdjustments.put(updated);
      setIsAdjModalOpen(false);
      onShowToast('success', 'Ajustement de stock mis à jour.');
    } else {
      const created: StockAdjustment = {
        id: 'adj_' + Date.now().toString() + '_' + Math.random().toString(36).slice(2, 6),
        itemId: item.id,
        date: adjDate,
        qtyDelta: finalDelta,
        reason: adjReason,
        note: trimmedNote || undefined,
        createdAt: Date.now(),
      };
      await db.stockAdjustments.add(created);
      setIsAdjModalOpen(false);
      onShowToast('success', 'Ajustement de stock enregistré.');
    }
  };

  const handleConfirmDeleteAdjustment = async () => {
    if (!adjToDelete) return;
    await db.stockAdjustments.delete(adjToDelete.id);
    setAdjToDelete(null);
    onShowToast('info', 'Ajustement supprimé.');
  };

  // Sorted adjustments for Ajustements tab
  const sortedAdjustments = useMemo(() => {
    return [...stockAdjustments].sort(
      (a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0)
    );
  }, [stockAdjustments]);

  // Shopping list rows & totals
  const shoppingComputedRows = useMemo(() => {
    return shoppingItems.map((stockEntry) => {
      const { item } = stockEntry;
      const analytics = priceAnalyticsByItemId.get(item.id);
      const hasLastPaid = analytics?.lastPriceFC !== null && analytics?.lastPriceFC !== undefined;
      const unitPriceFC = hasLastPaid ? analytics!.lastPriceFC! : item.purchasePriceFC;
      const rawInput = shoppingQtyInputs[item.id] ?? '1';
      const parsedQty = rawInput.trim() === '' ? 0 : parseLocaleNumber(rawInput);
      const effectiveQty = Number.isFinite(parsedQty) && parsedQty >= 0 ? parsedQty : 0;
      const lineTotalFC = effectiveQty * unitPriceFC;

      return {
        stockEntry,
        item,
        rawInput,
        effectiveQty,
        unitPriceFC,
        hasLastPaid,
        lineTotalFC,
      };
    });
  }, [shoppingItems, priceAnalyticsByItemId, shoppingQtyInputs]);

  const shoppingTotalFC = useMemo(() => {
    return shoppingComputedRows.reduce((sum, r) => sum + r.lineTotalFC, 0);
  }, [shoppingComputedRows]);

  const whatsappShareText = useMemo(() => {
    const activeLines = shoppingComputedRows.filter((r) => r.effectiveQty > 0);
    const header = `🛒 *Liste d'achats — ${settings.businessName || 'Yaourt Gestion'}*\nDate : ${formatDate(
      toISODate(new Date())
    )}`;
    if (activeLines.length === 0) {
      return header;
    }
    const body = activeLines
      .map(
        (r) =>
          `• ${r.item.name} : ${formatNumber(r.effectiveQty, 2)} ${r.item.purchaseUnit} × ${formatFlexibleFC(
            r.unitPriceFC,
            currency
          )} = ${formatFC(Math.round(r.lineTotalFC), currency)}`
      )
      .join('\n');
    const footer = `\n*Total estimé : ${formatFC(Math.round(shoppingTotalFC), currency)}*`;
    return `${header}\n\n${body}${footer}`;
  }, [shoppingComputedRows, shoppingTotalFC, settings.businessName, currency]);

  const alertCount = useMemo(() => {
    return stockResult.items.filter((it) => it.isNegative || it.isLowStock).length;
  }, [stockResult.items]);

  const priceAlertCount = useMemo(() => {
    return priceAnalytics.filter((pa) => pa.isPriceRiseAboveThreshold).length;
  }, [priceAnalytics]);

  const filteredPriceAnalytics = useMemo(() => {
    if (selectedPriceItemId === 'all') return priceAnalytics;
    return priceAnalytics.filter((pa) => pa.item.id === selectedPriceItemId);
  }, [priceAnalytics, selectedPriceItemId]);

  return (
    <div className="pb-28 pt-3 px-4 max-w-lg mx-auto space-y-4">
      {/* Top Bar */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Retour"
          className="p-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 active:scale-95 transition-all min-h-[42px] min-w-[42px] flex items-center justify-center shadow-2xs"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-extrabold text-slate-900 tracking-tight leading-tight">
            Stock d’ingrédients
          </h2>
          <p className="text-xs text-slate-500 truncate">
            Suivi calculé des ingrédients, prix, ajustements et achats
          </p>
        </div>
      </div>

      {/* 4 Sub-tabs */}
      <div className="grid grid-cols-4 gap-1 p-1 rounded-2xl bg-slate-200/75">
        <button
          type="button"
          onClick={() => setSubTab('stock')}
          className={`py-2 px-1.5 rounded-xl text-[11px] font-extrabold flex items-center justify-center gap-1 transition-all min-h-[40px] ${
            subTab === 'stock'
              ? 'bg-white text-teal-800 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Package className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Stock</span>
          {alertCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-md bg-rose-600 text-white text-[9px] font-extrabold">
              {alertCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab('prices')}
          className={`py-2 px-1.5 rounded-xl text-[11px] font-extrabold flex items-center justify-center gap-1 transition-all min-h-[40px] ${
            subTab === 'prices'
              ? 'bg-white text-teal-800 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Prix</span>
          {priceAlertCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-md bg-amber-600 text-white text-[9px] font-extrabold">
              {priceAlertCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab('adjustments')}
          className={`py-2 px-1.5 rounded-xl text-[11px] font-extrabold flex items-center justify-center gap-1 transition-all min-h-[40px] ${
            subTab === 'adjustments'
              ? 'bg-white text-teal-800 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Ajustements</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('shopping')}
          className={`py-2 px-1.5 rounded-xl text-[11px] font-extrabold flex items-center justify-center gap-1 transition-all min-h-[40px] ${
            subTab === 'shopping'
              ? 'bg-white text-teal-800 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ShoppingCart className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Liste d’achats</span>
          {shoppingItems.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-md bg-teal-700 text-white text-[9px] font-extrabold">
              {shoppingItems.length}
            </span>
          )}
        </button>
      </div>

      {/* ===================================================================== */}
      {/* TAB 1 : STOCK                                                         */}
      {/* ===================================================================== */}
      {subTab === 'stock' && (
        <div className="space-y-3.5">
          {stockStartDate && (
            <div className="px-3 py-2 rounded-xl bg-slate-100 border border-slate-200/80 text-[11px] text-slate-600 flex items-center justify-between">
              <span>Point de départ du stock :</span>
              <span className="font-bold text-slate-800">{formatDate(stockStartDate)}</span>
            </div>
          )}

          {/* Banner: productions without ingredients */}
          {stockResult.productionsWithoutIngredients.length > 0 && (
            <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 space-y-2">
              <button
                type="button"
                onClick={() => setShowMissingProdList((prev) => !prev)}
                className="w-full flex items-start justify-between gap-2 text-left"
              >
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-extrabold text-amber-950 leading-snug">
                      {stockResult.productionsWithoutIngredients.length}{' '}
                      {stockResult.productionsWithoutIngredients.length > 1
                        ? 'productions sans ingrédients : le stock ne baisse pas pour elles'
                        : 'production sans ingrédients : le stock ne baisse pas pour elle'}
                    </p>
                    <p className="text-[11px] text-amber-800 mt-0.5">
                      {showMissingProdList ? 'Masquer la liste' : 'Toucher pour voir la liste'}
                    </p>
                  </div>
                </div>
                {showMissingProdList ? (
                  <ChevronUp className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
                )}
              </button>

              {showMissingProdList && (
                <div className="pt-2 border-t border-amber-200/80 space-y-1.5">
                  {stockResult.productionsWithoutIngredients.map((prod) => {
                    const summary = (prod.items || [])
                      .filter((i) => i.producedQty > 0)
                      .map((i) => {
                        const pName = productsById.get(i.productId)?.name || 'Produit';
                        return `${formatNumber(i.producedQty)} ${pName}`;
                      })
                      .join(', ');
                    return (
                      <div
                        key={prod.id}
                        className="flex items-center justify-between gap-2 text-[11px] bg-white/80 px-2.5 py-1.5 rounded-lg border border-amber-200/60"
                      >
                        <span className="font-bold text-slate-800">{formatDate(prod.date)}</span>
                        <span className="text-slate-600 truncate">
                          {summary || 'Production enregistrée'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {stockResult.items.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 text-center space-y-2 shadow-2xs">
              <Package className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-xs font-bold text-slate-800">
                Aucun ingrédient ou emballage suivi pour le moment
              </p>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Ajoutez vos ingrédients et emballages dans Paramètres → « Coût de revient :
                ingrédients et emballages » et activez « Suivre le stock ».
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {stockResult.items.map((entry) => {
                const {
                  item,
                  startingQty,
                  purchasedUsageQty,
                  usedUsageQty,
                  adjustedUsageQty,
                  stockUsageQty,
                  stockPurchaseQty,
                  remainingBatches,
                  isNegative,
                  isLowStock,
                } = entry;

                return (
                  <div
                    key={item.id}
                    className={`bg-white rounded-2xl border p-4 shadow-2xs space-y-2.5 ${
                      isNegative
                        ? 'border-rose-300 bg-rose-50/20'
                        : isLowStock
                        ? 'border-amber-300 bg-amber-50/20'
                        : 'border-slate-200/80'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="text-sm font-extrabold text-slate-900">{item.name}</h3>
                          <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold">
                            {item.kind === 'ingredient' ? 'Ingrédient' : 'Emballage'}
                          </span>
                        </div>

                        {/* Stock in usage units & purchase units */}
                        <p
                          className={`mt-1 text-sm font-extrabold ${
                            isNegative ? 'text-rose-700' : 'text-teal-900'
                          }`}
                        >
                          {formatNumber(stockUsageQty, 2)} {item.usageUnit}
                          <span className="text-xs font-semibold text-slate-500">
                            , soit {formatNumber(stockPurchaseQty, 1)} {item.purchaseUnit}
                          </span>
                        </p>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                          Fournées restantes
                        </span>
                        <span className="text-sm font-extrabold text-slate-900 font-mono">
                          {remainingBatches !== null
                            ? formatNumber(Math.max(0, remainingBatches), 1)
                            : '—'}
                        </span>
                      </div>
                    </div>

                    {/* Alert badges */}
                    {isNegative && (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-100 border border-rose-200 text-rose-800 text-[11px] font-extrabold">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>Stock négatif : un achat n’est pas noté ?</span>
                      </div>
                    )}

                    {!isNegative && isLowStock && (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-100 border border-amber-200 text-amber-900 text-[11px] font-extrabold">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>Stock bas</span>
                      </div>
                    )}

                    {/* Subtle movement breakdown */}
                    <div className="pt-2 border-t border-slate-100 grid grid-cols-4 gap-1.5 text-center text-[10px]">
                      <div className="p-1.5 rounded-lg bg-slate-50">
                        <span className="text-slate-400 block">Départ</span>
                        <span className="font-bold text-slate-700">
                          {formatNumber(startingQty, 2)}
                        </span>
                      </div>
                      <div className="p-1.5 rounded-lg bg-emerald-50/60">
                        <span className="text-emerald-700 block">+ Achats</span>
                        <span className="font-bold text-emerald-800">
                          {formatNumber(purchasedUsageQty, 2)}
                        </span>
                      </div>
                      <div className="p-1.5 rounded-lg bg-slate-50">
                        <span className="text-slate-500 block">− Prod.</span>
                        <span className="font-bold text-slate-800">
                          {formatNumber(usedUsageQty, 2)}
                        </span>
                      </div>
                      <div className="p-1.5 rounded-lg bg-slate-50">
                        <span className="text-slate-500 block">± Ajust.</span>
                        <span className="font-bold text-slate-800">
                          {adjustedUsageQty > 0
                            ? `+${formatNumber(adjustedUsageQty, 2)}`
                            : formatNumber(adjustedUsageQty, 2)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2 : PRIX                                                          */}
      {/* ===================================================================== */}
      {subTab === 'prices' && (
        <div className="space-y-3.5">
          {priceAnalytics.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 text-center space-y-2 shadow-2xs">
              <TrendingUp className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-xs font-bold text-slate-800">
                Aucun ingrédient ou emballage actif
              </p>
              <p className="text-[11px] text-slate-500">
                Définissez d’abord vos éléments dans Paramètres → « Coût de revient ».
              </p>
            </div>
          ) : (
            <>
              {/* Filter by item */}
              <div className="bg-white rounded-2xl border border-slate-200/80 p-3 shadow-2xs flex items-center justify-between gap-2">
                <label className="text-xs font-bold text-slate-700 shrink-0">Élément :</label>
                <select
                  value={selectedPriceItemId}
                  onChange={(e) => setSelectedPriceItemId(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-900 min-h-[38px]"
                >
                  <option value="all">Tous les éléments ({priceAnalytics.length})</option>
                  {priceAnalytics.map((pa) => (
                    <option key={pa.item.id} value={pa.item.id}>
                      {pa.item.name} ({pa.purchases.length} achat
                      {pa.purchases.length > 1 ? 's' : ''})
                    </option>
                  ))}
                </select>
              </div>

              {filteredPriceAnalytics.map((pa) => {
                const {
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
                  supplierComparison,
                } = pa;

                const chartData = purchases.map((pt, idx) => ({
                  idx: idx + 1,
                  label: formatDate(pt.date).slice(0, 5),
                  fullDate: formatDate(pt.date),
                  price: Math.round(pt.unitPurchasePriceFC * 100) / 100,
                }));

                const reversedPurchases = [...purchases].reverse();

                return (
                  <div
                    key={item.id}
                    className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs space-y-3.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-extrabold text-slate-900">{item.name}</h3>
                        <p className="text-[11px] text-slate-500">
                          Unité d’achat : <span className="font-semibold">{item.purchaseUnit}</span>{' '}
                          • Réf. actuelle :{' '}
                          <span className="font-semibold text-slate-700">
                            {formatFlexibleFC(item.purchasePriceFC, currency)}
                          </span>
                        </p>
                      </div>

                      {lastVariationFC !== null && (
                        <span
                          className={`px-2 py-1 rounded-lg text-[11px] font-extrabold shrink-0 ${
                            lastVariationFC > 0
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : lastVariationFC < 0
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {lastVariationFC > 0 ? '+' : ''}
                          {formatFlexibleFC(lastVariationFC, currency)}
                          {lastVariationPct !== null
                            ? ` (${lastVariationPct > 0 ? '+' : ''}${formatPercent(
                                lastVariationPct
                              )})`
                            : ''}
                        </span>
                      )}
                    </div>

                    {/* Alert when price rise exceeds threshold */}
                    {isPriceRiseAboveThreshold && (
                      <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                        <div className="text-xs text-amber-950 leading-snug">
                          {batchCostIncreaseFC !== null && batchCostIncreaseFC > 0 ? (
                            <p className="font-extrabold">
                              Ton coût par fournée monte de {formatFC(batchCostIncreaseFC, currency)}
                            </p>
                          ) : (
                            <p className="font-extrabold">
                              Hausse de prix de +{formatPercent(lastVariationPct)} par rapport à
                              l’achat précédent
                            </p>
                          )}
                          <p className="text-[11px] text-amber-800 mt-0.5">
                            Hausse supérieure au seuil d’alerte ({formatNumber(priceRiseAlertPct)} %).
                          </p>
                        </div>
                      </div>
                    )}

                    {purchases.length === 0 ? (
                      <p className="text-[11px] text-slate-500 italic py-1">
                        Aucun achat détaillé enregistré dans les dépenses pour cet élément.
                      </p>
                    ) : (
                      <>
                        {/* Stats: Dernier, Plus bas, Plus haut, Moyen */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                            <span className="text-[10px] font-bold text-slate-500 block">
                              Dernier prix
                            </span>
                            <span className="text-xs font-extrabold text-slate-900 font-mono">
                              {lastPriceFC !== null
                                ? formatFlexibleFC(lastPriceFC, currency)
                                : '—'}
                            </span>
                          </div>
                          <div className="p-2.5 rounded-xl bg-emerald-50/60 border border-emerald-200/70">
                            <span className="text-[10px] font-bold text-emerald-700 block">
                              Plus bas
                            </span>
                            <span className="text-xs font-extrabold text-emerald-900 font-mono">
                              {minPriceFC !== null
                                ? formatFlexibleFC(minPriceFC, currency)
                                : '—'}
                            </span>
                          </div>
                          <div className="p-2.5 rounded-xl bg-rose-50/60 border border-rose-200/70">
                            <span className="text-[10px] font-bold text-rose-700 block">
                              Plus haut
                            </span>
                            <span className="text-xs font-extrabold text-rose-900 font-mono">
                              {maxPriceFC !== null
                                ? formatFlexibleFC(maxPriceFC, currency)
                                : '—'}
                            </span>
                          </div>
                          <div className="p-2.5 rounded-xl bg-teal-50/60 border border-teal-200/70">
                            <span className="text-[10px] font-bold text-teal-800 block">
                              Prix moyen
                            </span>
                            <span className="text-xs font-extrabold text-teal-950 font-mono">
                              {avgPriceFC !== null
                                ? formatFlexibleFC(avgPriceFC, currency)
                                : '—'}
                            </span>
                          </div>
                        </div>

                        {/* Evolution chart */}
                        {chartData.length >= 2 && (
                          <div className="space-y-1.5">
                            <h4 className="text-[11px] font-bold text-slate-700">
                              Évolution du prix d’achat ({currency} / {item.purchaseUnit})
                            </h4>
                            <div className="h-40 w-full rounded-xl bg-slate-50/70 border border-slate-200/70 p-2">
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={chartData}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                  <XAxis
                                    dataKey="label"
                                    tick={{ fontSize: 10, fill: '#64748b' }}
                                    stroke="#cbd5e1"
                                  />
                                  <YAxis
                                    width={52}
                                    tick={{ fontSize: 10, fill: '#64748b' }}
                                    stroke="#cbd5e1"
                                  />
                                  <Tooltip
                                    formatter={(val: unknown) => [
                                      formatFlexibleFC(Number(val) || 0, currency),
                                      `Prix / ${item.purchaseUnit}`,
                                    ]}
                                    labelFormatter={(_, payload) =>
                                      payload && payload[0]?.payload?.fullDate
                                        ? `Date : ${payload[0].payload.fullDate}`
                                        : ''
                                    }
                                    contentStyle={{
                                      borderRadius: '12px',
                                      border: '1px solid #e2e8f0',
                                      fontSize: '11px',
                                    }}
                                  />
                                  <Line
                                    type="monotone"
                                    dataKey="price"
                                    stroke="#0f766e"
                                    strokeWidth={2.5}
                                    dot={{ r: 3.5, fill: '#0f766e' }}
                                    activeDot={{ r: 5 }}
                                  />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        )}

                        {/* Supplier comparison */}
                        {supplierComparison.length > 0 && (
                          <div className="space-y-1.5">
                            <h4 className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                              <Store className="w-3.5 h-3.5 text-teal-700" />
                              <span>Comparaison par lieu d’achat</span>
                            </h4>
                            <div className="space-y-1.5">
                              {supplierComparison.map((sup) => (
                                <div
                                  key={sup.supplierLabel}
                                  className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 ${
                                    sup.isCheapest
                                      ? 'bg-emerald-50/70 border-emerald-300'
                                      : 'bg-slate-50 border-slate-200/70'
                                  }`}
                                >
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-xs font-bold text-slate-900">
                                        {sup.supplierLabel}
                                      </span>
                                      {sup.isCheapest && (
                                        <span className="px-1.5 py-0.5 rounded-md bg-emerald-600 text-white text-[10px] font-extrabold">
                                          Moins cher
                                        </span>
                                      )}
                                    </div>
                                    <span className="text-[10px] text-slate-500">
                                      {sup.purchaseCount} achat{sup.purchaseCount > 1 ? 's' : ''} •
                                      Dernier : {formatDate(sup.lastDate)}
                                    </span>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <span className="text-xs font-extrabold text-slate-900 font-mono block">
                                      {formatFlexibleFC(sup.avgUnitPriceFC, currency)}
                                    </span>
                                    <span className="text-[10px] text-slate-500">
                                      moy. / {item.purchaseUnit}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Purchase history */}
                        <div className="space-y-1.5">
                          <h4 className="text-[11px] font-bold text-slate-700">
                            Historique des achats ({reversedPurchases.length})
                          </h4>
                          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200/70 bg-white overflow-hidden">
                            {reversedPurchases.map((pt, idx) => (
                              <div
                                key={`${pt.expenseId}_${idx}`}
                                className="p-2.5 flex items-center justify-between gap-2 text-xs"
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-bold text-slate-900">
                                      {formatDate(pt.date)}
                                    </span>
                                    <span className="text-[11px] text-slate-500">
                                      • {pt.supplier || 'Lieu non précisé'}
                                    </span>
                                  </div>
                                  <p className="text-[11px] text-slate-600">
                                    Qté : {formatNumber(pt.purchaseQty, 4)} {item.purchaseUnit} (
                                    {formatFC(Math.round(pt.amountFC), currency)})
                                  </p>
                                </div>

                                <div className="text-right shrink-0">
                                  <span className="font-extrabold text-slate-900 font-mono block">
                                    {formatFlexibleFC(pt.unitPurchasePriceFC, currency)} /{' '}
                                    {item.purchaseUnit}
                                  </span>
                                  {pt.variationFC !== null && (
                                    <span
                                      className={`text-[10px] font-bold ${
                                        pt.variationFC > 0
                                          ? 'text-rose-600'
                                          : pt.variationFC < 0
                                          ? 'text-emerald-600'
                                          : 'text-slate-400'
                                      }`}
                                    >
                                      {pt.variationFC > 0 ? '+' : ''}
                                      {formatFlexibleFC(pt.variationFC, currency)}
                                      {pt.variationPct !== null
                                        ? ` (${pt.variationPct > 0 ? '+' : ''}${formatPercent(
                                            pt.variationPct
                                          )})`
                                        : ''}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 3 : AJUSTEMENTS                                                   */}
      {/* ===================================================================== */}
      {subTab === 'adjustments' && (
        <div className="space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slate-600">
              Pertes, péremptions, dons ou recomptages réels du stock.
            </p>
            <button
              type="button"
              disabled={adjustableItems.length === 0}
              onClick={() => openCreateAdjModal()}
              className="px-3.5 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs font-extrabold flex items-center gap-1.5 shrink-0 min-h-[42px] shadow-xs"
            >
              <Plus className="w-4 h-4" />
              <span>+ Ajuster le stock</span>
            </button>
          </div>

          {adjustableItems.length === 0 && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
              Ajoutez d’abord un ingrédient ou emballage suivi dans les Paramètres pour enregistrer
              un ajustement.
            </div>
          )}

          {sortedAdjustments.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 text-center space-y-2 shadow-2xs">
              <SlidersHorizontal className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-xs font-bold text-slate-800">Aucun ajustement enregistré</p>
              <p className="text-[11px] text-slate-500">
                Utilisez « + Ajuster le stock » en cas de perte, don ou comptage physique.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {sortedAdjustments.map((adj) => {
                const item = costItemsById.get(adj.itemId);
                const isPositive = adj.qtyDelta >= 0;
                const isBeforeStart = Boolean(stockStartDate && adj.date < stockStartDate);

                return (
                  <div
                    key={adj.id}
                    className={`bg-white rounded-2xl border border-slate-200/80 p-3.5 shadow-2xs space-y-2 ${
                      isBeforeStart ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-extrabold text-slate-900">
                            {item ? item.name : 'Élément inconnu'}
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-bold">
                            {STOCK_ADJUSTMENT_REASON_LABELS[adj.reason] || adj.reason}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-500 block mt-0.5">
                          {formatDate(adj.date)}
                          {isBeforeStart ? ' (avant stock de départ)' : ''}
                        </span>
                      </div>

                      <span
                        className={`px-2.5 py-1 rounded-xl text-xs font-extrabold font-mono shrink-0 ${
                          isPositive
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        {isPositive ? '+' : ''}
                        {formatNumber(adj.qtyDelta, 4)} {item?.usageUnit || 'u.'}
                      </span>
                    </div>

                    {adj.note && (
                      <p className="text-[11px] text-slate-600 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-100">
                        {adj.note}
                      </p>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => openEditAdjModal(adj)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold flex items-center gap-1 min-h-[34px]"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>Modifier</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setAdjToDelete(adj)}
                        className="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[11px] font-bold flex items-center gap-1 min-h-[34px]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Supprimer</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 4 : LISTE D'ACHATS                                                */}
      {/* ===================================================================== */}
      {subTab === 'shopping' && (
        <div className="space-y-3.5">
          {shoppingComputedRows.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 text-center space-y-2 shadow-2xs">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
              <p className="text-xs font-bold text-slate-800">
                Aucun article sous le seuil d’alerte
              </p>
              <p className="text-[11px] text-slate-500">
                Tous vos ingrédients et emballages suivis ont un stock suffisant (seuil : moins de{' '}
                {formatNumber(stockLowBatches, 1)} fournée{stockLowBatches > 1 ? 's' : ''}).
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2.5">
                {shoppingComputedRows.map(
                  ({ stockEntry, item, rawInput, unitPriceFC, hasLastPaid, lineTotalFC }) => (
                    <div
                      key={item.id}
                      className="bg-white rounded-2xl border border-slate-200/80 p-3.5 shadow-2xs space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-extrabold text-slate-900">
                              {item.name}
                            </span>
                            {stockEntry.isNegative ? (
                              <span className="px-1.5 py-0.5 rounded-md bg-rose-100 text-rose-800 text-[10px] font-extrabold">
                                Stock négatif
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-900 text-[10px] font-extrabold">
                                Stock bas
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            En stock : {formatNumber(stockEntry.stockUsageQty, 2)} {item.usageUnit}{' '}
                            ({formatNumber(stockEntry.stockPurchaseQty, 1)} {item.purchaseUnit})
                          </p>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="text-xs font-extrabold text-teal-900 font-mono block">
                            {formatFC(Math.round(lineTotalFC), currency)}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {hasLastPaid ? 'Dernier prix payé' : 'Prix de réf.'} :{' '}
                            {formatFlexibleFC(unitPriceFC, currency)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                        <label className="text-xs font-bold text-slate-700">
                          Quantité à acheter ({item.purchaseUnit})
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={rawInput}
                          onChange={(e) =>
                            setShoppingQtyInputs((prev) => ({
                              ...prev,
                              [item.id]: e.target.value.replace(/[^0-9.,]/g, ''),
                            }))
                          }
                          className="w-24 px-2.5 py-1.5 rounded-xl border border-slate-300 bg-slate-50 text-xs font-extrabold text-slate-900 text-center min-h-[38px]"
                        />
                      </div>
                    </div>
                  )
                )}
              </div>

              {/* Total & WhatsApp Share */}
              <div className="bg-teal-900 text-white rounded-2xl p-4 shadow-md space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-bold text-teal-200 block">Total estimé</span>
                    <span className="text-[10px] text-teal-300">
                      Calculé au dernier prix payé (ou prix de référence)
                    </span>
                  </div>
                  <span className="text-lg font-extrabold font-mono">
                    {formatFC(Math.round(shoppingTotalFC), currency)}
                  </span>
                </div>

                <a
                  href={`https://wa.me/?text=${encodeURIComponent(whatsappShareText)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:scale-98 text-white text-xs font-extrabold flex items-center justify-center gap-2 shadow-sm transition-all min-h-[44px]"
                >
                  <Share2 className="w-4 h-4" />
                  <span>Partager sur WhatsApp</span>
                </a>
              </div>
            </>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL : AJOUTER / MODIFIER UN AJUSTEMENT                              */}
      {/* ===================================================================== */}
      {isAdjModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto"
        >
          <div className="relative w-full max-w-md bg-white rounded-3xl p-5 shadow-2xl border border-slate-200 space-y-4 my-auto">
            <button
              type="button"
              onClick={() => setIsAdjModalOpen(false)}
              aria-label="Fermer"
              className="absolute right-3.5 top-3.5 p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-base font-extrabold text-slate-900 pr-8">
              {editingAdj ? 'Modifier l’ajustement' : 'Ajuster le stock'}
            </h3>

            <form onSubmit={handleSaveAdjustment} className="space-y-3.5">
              {/* Item selector */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Élément</label>
                <select
                  value={adjItemId}
                  onChange={(e) => setAdjItemId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-900 min-h-[42px]"
                >
                  {adjustableItems.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name} ({it.usageUnit})
                    </option>
                  ))}
                </select>
              </div>

              {/* Date */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Date</label>
                <input
                  type="date"
                  value={adjDate}
                  onChange={(e) => setAdjDate(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-900 min-h-[42px]"
                />
              </div>

              {/* Mode: Ajouter / Retirer OR Compter le stock */}
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-100">
                <button
                  type="button"
                  onClick={() => setAdjMode('delta')}
                  className={`py-2 px-2 rounded-lg text-xs font-bold transition-all min-h-[38px] ${
                    adjMode === 'delta'
                      ? 'bg-white text-teal-800 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Ajouter / Retirer
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAdjMode('count');
                    setAdjReason('erreur_comptage');
                  }}
                  className={`py-2 px-2 rounded-lg text-xs font-bold transition-all min-h-[38px] ${
                    adjMode === 'count'
                      ? 'bg-white text-teal-800 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Compter le stock
                </button>
              </div>

              {adjMode === 'delta' ? (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setAdjSign('remove')}
                      className={`py-2 px-3 rounded-xl border text-xs font-extrabold min-h-[40px] ${
                        adjSign === 'remove'
                          ? 'bg-rose-50 border-rose-300 text-rose-800'
                          : 'bg-white border-slate-200 text-slate-600'
                      }`}
                    >
                      − Retirer du stock
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdjSign('add')}
                      className={`py-2 px-3 rounded-xl border text-xs font-extrabold min-h-[40px] ${
                        adjSign === 'add'
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                          : 'bg-white border-slate-200 text-slate-600'
                      }`}
                    >
                      + Ajouter au stock
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Quantité ({selectedAdjItem?.usageUnit || 'unités d’utilisation'})
                    </label>
                    <input
                      type="text"
                      inputMode={selectedAdjItem?.allowDecimals ? 'decimal' : 'numeric'}
                      value={adjQtyStr}
                      onChange={(e) => {
                        const pattern = selectedAdjItem?.allowDecimals ? /[^0-9.,]/g : /[^0-9]/g;
                        setAdjQtyStr(e.target.value.replace(pattern, ''));
                      }}
                      placeholder={selectedAdjItem?.allowDecimals ? 'Ex. 1,5' : 'Ex. 2'}
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-extrabold text-slate-900 min-h-[42px]"
                    />
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-teal-50/70 border border-teal-200 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600 font-medium">Stock théorique à cette date :</span>
                    <span className="font-extrabold text-slate-900 font-mono">
                      {formatNumber(theoreticalAtAdjDate, 2)} {selectedAdjItem?.usageUnit || ''}
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1">
                      Quantité réelle comptée ({selectedAdjItem?.usageUnit || 'unités'})
                    </label>
                    <input
                      type="text"
                      inputMode={selectedAdjItem?.allowDecimals ? 'decimal' : 'numeric'}
                      value={adjCountedStr}
                      onChange={(e) => {
                        const pattern = selectedAdjItem?.allowDecimals ? /[^0-9.,]/g : /[^0-9]/g;
                        setAdjCountedStr(e.target.value.replace(pattern, ''));
                      }}
                      placeholder="Saisissez le stock réel compté"
                      className="w-full px-3 py-2.5 rounded-xl border border-teal-300 bg-white text-xs font-extrabold text-slate-900 min-h-[42px]"
                    />
                  </div>

                  {liveCountedDelta !== null && (
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-teal-200/70">
                      <span className="font-bold text-teal-950">Écart calculé automatiquement :</span>
                      <span
                        className={`font-extrabold font-mono ${
                          liveCountedDelta > 0
                            ? 'text-emerald-700'
                            : liveCountedDelta < 0
                            ? 'text-rose-700'
                            : 'text-slate-600'
                        }`}
                      >
                        {liveCountedDelta > 0 ? '+' : ''}
                        {formatNumber(liveCountedDelta, 4)} {selectedAdjItem?.usageUnit || ''}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Mandatory Reason */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Motif (obligatoire)
                </label>
                <select
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value as StockAdjustmentReason)}
                  required
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-900 min-h-[42px]"
                >
                  {(Object.keys(STOCK_ADJUSTMENT_REASON_LABELS) as StockAdjustmentReason[]).map(
                    (reasonKey) => (
                      <option key={reasonKey} value={reasonKey}>
                        {STOCK_ADJUSTMENT_REASON_LABELS[reasonKey]}
                      </option>
                    )
                  )}
                </select>
              </div>

              {/* Optional Note */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Note (facultatif)
                </label>
                <input
                  type="text"
                  value={adjNote}
                  onChange={(e) => setAdjNote(e.target.value)}
                  placeholder="Ex. Sachet percé pendant le transport"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 min-h-[40px]"
                />
              </div>

              {adjError && (
                <p className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 px-3 py-2 rounded-xl">
                  {adjError}
                </p>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsAdjModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 min-h-[44px]"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold min-h-[44px]"
                >
                  {editingAdj ? 'Enregistrer' : 'Valider l’ajustement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Security Confirmation for Deleting an Adjustment */}
      <SecurityConfirmModal
        isOpen={Boolean(adjToDelete)}
        title="Supprimer cet ajustement ?"
        message="Cette suppression recalculera immédiatement le stock de l’élément."
        pinCode={settings.pinCode}
        confirmWord="SUPPRIMER"
        confirmLabel="Supprimer"
        onConfirm={handleConfirmDeleteAdjustment}
        onCancel={() => setAdjToDelete(null)}
      />
    </div>
  );
};
