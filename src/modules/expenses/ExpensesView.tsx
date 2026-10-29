import React, { useState, useEffect, useMemo } from 'react';
import {
  WalletCards,
  Plus,
  AlertTriangle,
  Calendar,
  Edit2,
  Trash2,
  X,
  Check,
  Calculator,
  Wallet,
} from 'lucide-react';
import { db } from '../../db/db';
import {
  formatDate,
  formatFC,
  formatPercent,
  toISODate,
  toISOMonth,
  formatMonthName,
  safePercentage,
  parseLocaleNumber,
  formatNumber,
} from '../../utils/formatters';
import { ConfirmModal } from '../../components/ConfirmModal';
import { EmptyState } from '../../components/EmptyState';
import { calculateReserveBalance } from '../../utils/reserveCalculator';
import { moveToTrash } from '../../utils/trashManager';
import type {
  Expense,
  ExpenseIngredientLine,
  DailyEntry,
  ReserveMovement,
  AppSettings,
  PersonalSale,
  DebtPayment,
  Payment,
  Employee,
  CostItem,
} from '../../types';

interface ExpensesViewProps {
  settings: AppSettings;
  onSettingsUpdated?: (newSettings: AppSettings) => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
  onOpenCalculator?: () => void;
  onOpenReserve?: (prefill?: { amount: number; reason: string; source?: 'personnel' | 'benefices' }) => void;
}

interface ExpenseIngredientFormRow {
  rowId: string;
  itemId: string;
  purchaseQtyStr: string;
  amountStr: string;
  amountManuallyEdited: boolean;
  originalItemId?: string;
  originalPurchaseQty?: number;
  originalUsageQty?: number;
  frozenName?: string;
}

interface PendingRefPriceUpdate {
  itemId: string;
  itemName: string;
  oldPriceFC: number;
  newPriceFC: number;
}

function formatFlexibleNumber(amount: number): string {
  if (!Number.isFinite(amount) || isNaN(amount)) return '0';
  const rounded = Math.round(amount * 100) / 100;
  if (Math.abs(rounded - Math.round(rounded)) < 0.005) {
    return Math.round(rounded)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }
  const [intPart, decPart] = rounded.toFixed(2).split('.');
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const trimmedDec = decPart.replace(/0+$/, '');
  return trimmedDec ? `${formattedInt},${trimmedDec}` : formattedInt;
}

function formatFlexibleFC(amount: number, currency = 'FC'): string {
  return `${formatFlexibleNumber(amount)} ${currency}`;
}

export const ExpensesView: React.FC<ExpensesViewProps> = ({
  settings,
  onSettingsUpdated,
  onShowToast,
  onOpenCalculator,
  onOpenReserve,
}) => {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [dailyEntries, setDailyEntries] = useState<DailyEntry[]>([]);
  const [reserveMovements, setReserveMovements] = useState<ReserveMovement[]>([]);
  const [personalSales, setPersonalSales] = useState<PersonalSale[]>([]);
  const [debtPayments, setDebtPayments] = useState<DebtPayment[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>(toISOMonth(new Date()));
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Form modal state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  const [date, setDate] = useState(toISODate(new Date()));
  const [amount, setAmount] = useState<string>('');
  const [category, setCategory] = useState<string>(settings.expenseCategories[0] || 'Lait concentré');
  const [categoryManuallyChanged, setCategoryManuallyChanged] = useState(false);
  const [detail, setDetail] = useState('');
  const [ingredientRows, setIngredientRows] = useState<ExpenseIngredientFormRow[]>([]);
  const [otherFeesStr, setOtherFeesStr] = useState<string>('');
  const [supplierStr, setSupplierStr] = useState<string>('');
  const [formError, setFormError] = useState('');

  // Read-only detail modal state
  const [detailExpenseToView, setDetailExpenseToView] = useState<Expense | null>(null);

  // Pending reference price update proposals
  const [pendingRefPriceUpdates, setPendingRefPriceUpdates] = useState<PendingRefPriceUpdate[]>([]);

  // Delete modal
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null);

  const currency = settings.currency || 'FC';
  const costItems = useMemo(() => settings.costItems ?? [], [settings.costItems]);
  const priceRiseAlertPct = settings.priceRiseAlertPct ?? 5;

  const costItemsById = useMemo(() => {
    const map = new Map<string, CostItem>();
    for (const ci of costItems) {
      map.set(ci.id, ci);
    }
    return map;
  }, [costItems]);

  const trackedItems = useMemo(
    () => costItems.filter((ci) => ci.isActive !== false && ci.trackStock !== false),
    [costItems]
  );

  // Dernier prix payé par élément (en excluant la dépense en cours d'édition le cas échéant)
  const lastPaidPriceMap = useMemo(() => {
    const map = new Map<string, { unitPriceFC: number; date: string }>();
    const chronological = [...expenses]
      .filter((exp) => exp.id !== editingExpense?.id && Array.isArray(exp.ingredientLines))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));

    for (const exp of chronological) {
      for (const line of exp.ingredientLines || []) {
        const pQty = Number(line.purchaseQty) || 0;
        const amt = Number(line.amountFC);
        if (pQty > 0 && Number.isFinite(amt) && amt >= 0) {
          map.set(line.itemId, {
            unitPriceFC: amt / pQty,
            date: exp.date,
          });
        }
      }
    }
    return map;
  }, [expenses, editingExpense]);

  // Suggestions de lieux d'achat tirées des dépenses existantes
  const supplierSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const exp of expenses) {
      const s = (exp.supplier || '').trim();
      if (!s) continue;
      const key = s.toLocaleLowerCase('fr');
      if (!seen.has(key)) {
        seen.add(key);
        list.push(s);
      }
    }
    return list;
  }, [expenses]);

  const getDefaultUnitPriceForItem = (itemId: string): number => {
    const lastPaid = lastPaidPriceMap.get(itemId);
    if (lastPaid !== undefined) return lastPaid.unitPriceFC;
    const ci = costItemsById.get(itemId);
    return ci ? ci.purchasePriceFC : 0;
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [exps, entries, movs, pSales, dPays, pays, emps] = await Promise.all([
      db.expenses.orderBy('date').reverse().toArray(),
      db.dailyEntries.toArray(),
      db.reserveMovements.toArray(),
      db.personalSales.toArray(),
      db.debtPayments.toArray(),
      db.payments.toArray(),
      db.employees.toArray(),
    ]);
    setExpenses(exps);
    setDailyEntries(entries);
    setReserveMovements(movs);
    setPersonalSales(pSales);
    setDebtPayments(dPays);
    setPayments(pays);
    setEmployees(emps);
  };

  const handleOpenAdd = () => {
    setEditingExpense(null);
    setDate(toISODate(new Date()));
    setAmount('');
    setCategory(settings.expenseCategories[0] || 'Lait concentré');
    setCategoryManuallyChanged(false);
    setDetail('');
    setIngredientRows([]);
    setOtherFeesStr('');
    setSupplierStr('');
    setFormError('');
    setIsFormOpen(true);
  };

  const handleOpenEdit = (exp: Expense) => {
    setEditingExpense(exp);
    setDate(exp.date);
    setAmount(formatNumber(exp.amountFC));
    setCategory(exp.category);
    setCategoryManuallyChanged(true);
    setDetail(exp.detail);

    if (Array.isArray(exp.ingredientLines) && exp.ingredientLines.length > 0) {
      setIngredientRows(
        exp.ingredientLines.map((line, idx) => ({
          rowId: `edit_${exp.id}_${idx}_${line.itemId}`,
          itemId: line.itemId,
          purchaseQtyStr: formatNumber(line.purchaseQty, 4),
          amountStr: formatNumber(line.amountFC, 2),
          amountManuallyEdited: true,
          originalItemId: line.itemId,
          originalPurchaseQty: line.purchaseQty,
          originalUsageQty: line.usageQty,
          frozenName: line.name,
        }))
      );
      setOtherFeesStr(
        exp.otherFeesFC !== undefined && exp.otherFeesFC > 0
          ? formatNumber(exp.otherFeesFC, 2)
          : ''
      );
      setSupplierStr(exp.supplier || '');
    } else {
      setIngredientRows([]);
      setOtherFeesStr('');
      setSupplierStr('');
    }

    setFormError('');
    setIsFormOpen(true);
  };

  const handleAddIngredientRow = () => {
    setFormError('');
    if (trackedItems.length === 0) {
      setFormError(
        'Aucun ingrédient ou emballage suivi disponible. Ajoutez-en d’abord dans Paramètres → Coût de revient.'
      );
      return;
    }

    const usedIds = new Set(ingredientRows.map((r) => r.itemId));
    const chosen = trackedItems.find((it) => !usedIds.has(it.id)) || trackedItems[0];
    const unitPrice = getDefaultUnitPriceForItem(chosen.id);
    const prefilledAmt = formatNumber(Math.round(unitPrice * 100) / 100, 2);

    const isFirstRow = ingredientRows.length === 0;
    if (isFirstRow && !categoryManuallyChanged && chosen.expenseCategory) {
      setCategory(chosen.expenseCategory);
    }

    setIngredientRows((prev) => [
      ...prev,
      {
        rowId: 'ing_' + Date.now().toString() + '_' + Math.random().toString(36).slice(2, 6),
        itemId: chosen.id,
        purchaseQtyStr: '1',
        amountStr: prefilledAmt,
        amountManuallyEdited: false,
      },
    ]);
  };

  const handleChangeRowItem = (rowId: string, rowIndex: number, newItemId: string) => {
    const newItem = costItemsById.get(newItemId);
    const unitPrice = getDefaultUnitPriceForItem(newItemId);

    if (rowIndex === 0 && !categoryManuallyChanged && newItem?.expenseCategory) {
      setCategory(newItem.expenseCategory);
    }

    setIngredientRows((prev) =>
      prev.map((row) => {
        if (row.rowId !== rowId) return row;
        let nextQtyStr = row.purchaseQtyStr;
        if (newItem && !newItem.allowDecimals) {
          const parsed = parseLocaleNumber(nextQtyStr);
          if (Number.isFinite(parsed) && parsed > 0) {
            nextQtyStr = String(Math.max(1, Math.round(parsed)));
          } else {
            nextQtyStr = '1';
          }
        }
        const qtyNum = nextQtyStr.trim() !== '' ? parseLocaleNumber(nextQtyStr) : 0;
        const nextAmtStr =
          qtyNum > 0 ? formatNumber(Math.round(qtyNum * unitPrice * 100) / 100, 2) : '';

        return {
          rowId: row.rowId,
          itemId: newItemId,
          purchaseQtyStr: nextQtyStr,
          amountStr: nextAmtStr,
          amountManuallyEdited: false,
        };
      })
    );
  };

  const handleChangeRowQty = (rowId: string, rawVal: string, allowDecimals: boolean) => {
    const sanitized = allowDecimals
      ? rawVal.replace(/[^0-9.,]/g, '')
      : rawVal.replace(/[^0-9]/g, '');

    setIngredientRows((prev) =>
      prev.map((row) => {
        if (row.rowId !== rowId) return row;
        if (row.amountManuallyEdited) {
          return { ...row, purchaseQtyStr: sanitized };
        }
        const unitPrice = getDefaultUnitPriceForItem(row.itemId);
        const qtyNum = sanitized.trim() !== '' ? parseLocaleNumber(sanitized) : 0;
        const nextAmtStr =
          qtyNum > 0 ? formatNumber(Math.round(qtyNum * unitPrice * 100) / 100, 2) : '';
        return {
          ...row,
          purchaseQtyStr: sanitized,
          amountStr: nextAmtStr,
        };
      })
    );
  };

  const handleChangeRowAmount = (rowId: string, rawVal: string) => {
    const sanitized = rawVal.replace(/[^0-9.,]/g, '');
    setIngredientRows((prev) =>
      prev.map((row) =>
        row.rowId === rowId
          ? { ...row, amountStr: sanitized, amountManuallyEdited: true }
          : row
      )
    );
  };

  const handleRemoveIngredientRow = (rowId: string) => {
    setIngredientRows((prev) => {
      const next = prev.filter((r) => r.rowId !== rowId);
      if (next.length === 0) {
        setOtherFeesStr('');
        setSupplierStr('');
      } else if (prev[0]?.rowId === rowId && !categoryManuallyChanged) {
        const newFirst = costItemsById.get(next[0].itemId);
        if (newFirst?.expenseCategory) {
          setCategory(newFirst.expenseCategory);
        }
      }
      return next;
    });
  };

  const hasIngredientLines = ingredientRows.length > 0;

  // Calcul en direct des lignes et du total automatique si au moins une ligne est renseignée
  const computedLinesSumFC = useMemo(() => {
    if (!hasIngredientLines) return 0;
    return ingredientRows.reduce((sum, row) => {
      const val = row.amountStr.trim() !== '' ? parseLocaleNumber(row.amountStr) : 0;
      return sum + (Number.isFinite(val) && val > 0 ? val : 0);
    }, 0);
  }, [hasIngredientLines, ingredientRows]);

  const parsedOtherFeesFC = useMemo(() => {
    if (!hasIngredientLines || otherFeesStr.trim() === '') return 0;
    const val = parseLocaleNumber(otherFeesStr);
    return Number.isFinite(val) && val > 0 ? val : 0;
  }, [hasIngredientLines, otherFeesStr]);

  const autoCalculatedTotalFC = useMemo(() => {
    if (!hasIngredientLines) return 0;
    return Math.round((computedLinesSumFC + parsedOtherFeesFC) * 100) / 100;
  }, [hasIngredientLines, computedLinesSumFC, parsedOtherFeesFC]);

  const effectiveFormAmountFC = hasIngredientLines
    ? autoCalculatedTotalFC
    : parseLocaleNumber(amount);

  const handleApplyRefPriceUpdate = async (proposal: PendingRefPriceUpdate) => {
    const latestSettings = (await db.settings.get('app_settings')) || settings;
    const nextCostItems = (latestSettings.costItems ?? []).map((ci) =>
      ci.id === proposal.itemId ? { ...ci, purchasePriceFC: proposal.newPriceFC } : ci
    );
    const updatedSettings: AppSettings = {
      ...latestSettings,
      costItems: nextCostItems,
    };
    await db.settings.put(updatedSettings);
    onSettingsUpdated?.(updatedSettings);
    setPendingRefPriceUpdates((prev) => prev.filter((p) => p.itemId !== proposal.itemId));
    onShowToast(
      'success',
      `Prix de référence de « ${proposal.itemName} » mis à jour à ${formatFlexibleFC(
        proposal.newPriceFC,
        currency
      )}.`
    );
  };

  const handleDismissRefPriceUpdate = (itemId: string) => {
    setPendingRefPriceUpdates((prev) => prev.filter((p) => p.itemId !== itemId));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    let finalAmountFC = 0;
    let finalDetail = detail.trim();
    let finalIngredientLines: ExpenseIngredientLine[] | undefined = undefined;
    let finalOtherFeesFC: number | undefined = undefined;
    let finalSupplier: string | undefined = undefined;

    if (hasIngredientLines) {
      const builtLines: ExpenseIngredientLine[] = [];

      for (const row of ingredientRows) {
        const catalogItem = costItemsById.get(row.itemId);
        const itemName = catalogItem?.name || row.frozenName || 'Ingrédient';
        const allowDecimals = catalogItem ? catalogItem.allowDecimals : true;

        if (!row.itemId) {
          setFormError('Veuillez choisir un ingrédient pour chaque ligne.');
          return;
        }
        if (row.purchaseQtyStr.trim() === '') {
          setFormError(`Veuillez saisir la quantité achetée pour « ${itemName} ».`);
          return;
        }
        const pQty = parseLocaleNumber(row.purchaseQtyStr);
        if (!Number.isFinite(pQty) || pQty <= 0) {
          setFormError(`La quantité achetée pour « ${itemName} » doit être supérieure à 0.`);
          return;
        }
        if (!allowDecimals && !Number.isInteger(pQty)) {
          setFormError(
            `« ${itemName} » n’accepte que des quantités d’achat entières (sans virgule).`
          );
          return;
        }

        if (row.amountStr.trim() === '') {
          setFormError(`Veuillez indiquer le montant pour « ${itemName} ».`);
          return;
        }
        const lineAmt = parseLocaleNumber(row.amountStr);
        if (!Number.isFinite(lineAmt) || lineAmt < 0) {
          setFormError(`Le montant de « ${itemName} » doit être positif ou nul.`);
          return;
        }

        // Conserver usageQty figée si la ligne d'une dépense existante n'a pas changé d'élément ni de quantité
        let usageQty = 0;
        if (
          row.originalItemId === row.itemId &&
          row.originalPurchaseQty === pQty &&
          row.originalUsageQty !== undefined &&
          row.originalUsageQty > 0
        ) {
          usageQty = row.originalUsageQty;
        } else {
          const unitsPerPurchase =
            catalogItem && catalogItem.usageUnitsPerPurchase > 0
              ? catalogItem.usageUnitsPerPurchase
              : 1;
          usageQty = Math.round(pQty * unitsPerPurchase * 1_000_000) / 1_000_000;
        }

        builtLines.push({
          itemId: row.itemId,
          name: itemName,
          purchaseQty: pQty,
          usageQty,
          amountFC: lineAmt,
        });
      }

      if (otherFeesStr.trim() !== '') {
        const fees = parseLocaleNumber(otherFeesStr);
        if (!Number.isFinite(fees) || fees < 0) {
          setFormError('Les autres frais doivent être un nombre positif ou nul.');
          return;
        }
        if (fees > 0) {
          finalOtherFeesFC = fees;
        }
      }

      finalAmountFC =
        Math.round(
          (builtLines.reduce((sum, l) => sum + l.amountFC, 0) + (finalOtherFeesFC || 0)) * 100
        ) / 100;

      if (finalAmountFC <= 0) {
        setFormError('Le montant total de la dépense doit être supérieur à 0 FC.');
        return;
      }

      finalIngredientLines = builtLines;
      if (supplierStr.trim()) {
        finalSupplier = supplierStr.trim();
      }

      if (!finalDetail) {
        finalDetail = builtLines
          .map((l) => {
            const u = costItemsById.get(l.itemId)?.purchaseUnit || 'u.';
            return `${l.name} (${formatNumber(l.purchaseQty, 4)} ${u})`;
          })
          .join(', ');
      }
    } else {
      const numAmount = parseLocaleNumber(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        setFormError('Veuillez entrer un montant valide supérieur à 0 FC.');
        return;
      }
      if (!finalDetail) {
        setFormError('Veuillez saisir le détail / motif de la dépense.');
        return;
      }
      finalAmountFC = numAmount;
    }

    try {
      if (editingExpense) {
        const updated: Expense = {
          ...editingExpense,
          date,
          amountFC: finalAmountFC,
          category,
          detail: finalDetail,
          ingredientLines: finalIngredientLines,
          otherFeesFC: finalOtherFeesFC,
          supplier: finalSupplier,
        };
        if (!finalIngredientLines) delete updated.ingredientLines;
        if (finalOtherFeesFC === undefined) delete updated.otherFeesFC;
        if (!finalSupplier) delete updated.supplier;

        await db.expenses.put(updated);
        onShowToast('success', 'Dépense mise à jour.');
      } else {
        const newExp: Expense = {
          id: 'exp_' + Date.now().toString(),
          date,
          amountFC: finalAmountFC,
          category,
          detail: finalDetail,
          ...(finalIngredientLines ? { ingredientLines: finalIngredientLines } : {}),
          ...(finalOtherFeesFC !== undefined ? { otherFeesFC: finalOtherFeesFC } : {}),
          ...(finalSupplier ? { supplier: finalSupplier } : {}),
          createdAt: Date.now(),
        };
        await db.expenses.put(newExp);
        onShowToast('success', 'Dépense enregistrée.');
      }

      // 3. Vérification du prix de référence par rapport au prix payé par unité d'achat
      if (finalIngredientLines && finalIngredientLines.length > 0) {
        const groupedByItem = new Map<string, { qty: number; amt: number }>();
        for (const l of finalIngredientLines) {
          const prev = groupedByItem.get(l.itemId) || { qty: 0, amt: 0 };
          groupedByItem.set(l.itemId, {
            qty: prev.qty + l.purchaseQty,
            amt: prev.amt + l.amountFC,
          });
        }

        const latestSettings = (await db.settings.get('app_settings')) || settings;
        const currentCostItems = [...(latestSettings.costItems ?? [])];
        const autoUpdatedMessages: string[] = [];
        const newProposals: PendingRefPriceUpdate[] = [];
        let hasAutoChanges = false;

        for (const [itemId, totals] of groupedByItem.entries()) {
          if (totals.qty <= 0) continue;
          const idx = currentCostItems.findIndex((ci) => ci.id === itemId);
          if (idx === -1) continue;
          const targetItem = currentCostItems[idx];
          const newUnitPrice = Math.round((totals.amt / totals.qty) * 100) / 100;

          if (Math.abs(newUnitPrice - targetItem.purchasePriceFC) >= 0.01) {
            if (targetItem.autoUpdateRefPrice) {
              const oldPrice = targetItem.purchasePriceFC;
              currentCostItems[idx] = {
                ...targetItem,
                purchasePriceFC: newUnitPrice,
              };
              hasAutoChanges = true;
              autoUpdatedMessages.push(
                `${targetItem.name} : ${formatFlexibleNumber(oldPrice)} → ${formatFlexibleFC(
                  newUnitPrice,
                  currency
                )}`
              );
            } else {
              newProposals.push({
                itemId: targetItem.id,
                itemName: targetItem.name,
                oldPriceFC: targetItem.purchasePriceFC,
                newPriceFC: newUnitPrice,
              });
            }
          }
        }

        if (hasAutoChanges) {
          const updatedSettings: AppSettings = {
            ...latestSettings,
            costItems: currentCostItems,
          };
          await db.settings.put(updatedSettings);
          onSettingsUpdated?.(updatedSettings);
          onShowToast(
            'info',
            `Prix de référence mis à jour automatiquement (${autoUpdatedMessages.join(' · ')})`
          );
        }

        if (newProposals.length > 0) {
          setPendingRefPriceUpdates((prev) => {
            const byId = new Map(prev.map((p) => [p.itemId, p]));
            for (const np of newProposals) {
              byId.set(np.itemId, np);
            }
            return Array.from(byId.values());
          });
        }
      }

      setIsFormOpen(false);
      await loadData();
    } catch (err: any) {
      setFormError('Erreur : ' + err.message);
    }
  };

  const handleDelete = async () => {
    if (!expenseToDelete) return;
    try {
      await moveToTrash('expense', expenseToDelete);
      onShowToast('info', 'Dépense déplacée dans la corbeille.');
      setExpenseToDelete(null);
      await loadData();
    } catch (err: any) {
      onShowToast('error', 'Erreur suppression : ' + err.message);
    }
  };

  // Month calculations (information secondaire)
  const monthEntries = dailyEntries.filter((e) => e.date.startsWith(selectedMonth));
  const monthPersonalSales = personalSales.filter(
    (p) => p.kind !== 'consommation' && !p.isOpeningDebt && p.date.startsWith(selectedMonth)
  );
  const totalSalesInMonthFC =
    monthEntries.reduce((acc, e) => acc + (e.totalSalesFC || 0), 0) +
    monthPersonalSales.reduce((acc, p) => acc + (p.totalSalesFC || 0), 0);
  const reserveRate = settings.expenseReservePct || 50;
  const expenseReserveInMonthFC = Math.round((totalSalesInMonthFC * reserveRate) / 100);

  const monthExpenses = expenses.filter((e) => e.date.startsWith(selectedMonth));
  const totalExpensesInMonthFC = monthExpenses.reduce((acc, e) => acc + (e.amountFC || 0), 0);

  const monthReserveBalanceFC = expenseReserveInMonthFC - totalExpensesInMonthFC;
  const _isMonthExceeded = totalExpensesInMonthFC > expenseReserveInMonthFC;
  const monthOverrunFC = totalExpensesInMonthFC - expenseReserveInMonthFC;
  const _monthOverrunPct = safePercentage(monthOverrunFC, expenseReserveInMonthFC);
  void _isMonthExceeded;
  void _monthOverrunPct;

  // SOLDE DES CAISSES (en tenant compte du point de départ s'il existe)
  const startingPoint = settings.caisseStartDate
    ? {
        startDate: settings.caisseStartDate,
        startReserveFC:
          settings.caisseStartReserveFC ??
          ((settings.caisseStartNormaleFC ?? 0) + (settings.caisseStartCapitalFC ?? 0)),
        startBeneficesFC: settings.caisseStartBeneficesFC ?? 0,
        startVendeursFC: settings.caisseStartVendeursFC ?? 0,
        startNormaleFC: settings.caisseStartNormaleFC ?? 0,
        startCapitalFC: settings.caisseStartCapitalFC ?? 0,
      }
    : null;

  const cumulativeDetails = calculateReserveBalance(
    reserveMovements,
    dailyEntries,
    expenses,
    reserveRate,
    startingPoint,
    null,
    personalSales,
    payments,
    employees,
    debtPayments
  );

  // Filtered by category
  const displayedExpenses = monthExpenses.filter((e) =>
    selectedCategory === 'all' ? true : e.category === selectedCategory
  );

  // Suggestions filtrées pour le champ "Lieu d'achat"
  const filteredSupplierSuggestions = useMemo(() => {
    const q = supplierStr.trim().toLocaleLowerCase('fr');
    return supplierSuggestions
      .filter((s) => {
        const lower = s.toLocaleLowerCase('fr');
        if (lower === q) return false;
        return !q || lower.includes(q);
      })
      .slice(0, 6);
  }, [supplierSuggestions, supplierStr]);

  return (
    <div className="pb-24 pt-3 px-4 max-w-lg mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">
            Dépenses
          </h2>
          <p className="text-xs text-slate-500">
            Achats, charges et suivi de la Caisse normale ({reserveRate} %)
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onOpenReserve && (
            <button
              type="button"
              onClick={() => onOpenReserve()}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs active:scale-95 transition-all min-h-[44px]"
            >
              <Wallet className="w-4 h-4 text-teal-400" />
              <span>Caisse</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleOpenAdd}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold shadow-xs active:scale-95 transition-all min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            <span>Ajouter</span>
          </button>
        </div>
      </div>

      {/* Bannières de proposition de mise à jour du prix de référence */}
      {pendingRefPriceUpdates.length > 0 && (
        <div className="space-y-2">
          {pendingRefPriceUpdates.map((proposal) => (
            <div
              key={proposal.itemId}
              className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 shadow-2xs space-y-2.5"
            >
              <div className="text-xs text-amber-950 leading-snug">
                <span className="font-bold text-amber-800 block">{proposal.itemName}</span>
                <span className="font-extrabold">
                  Mettre à jour le prix de référence : {formatFlexibleNumber(proposal.oldPriceFC)} →{' '}
                  {formatFlexibleFC(proposal.newPriceFC, currency)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleApplyRefPriceUpdate(proposal)}
                  className="px-3 py-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-extrabold transition-colors min-h-[36px]"
                >
                  Mettre à jour
                </button>
                <button
                  type="button"
                  onClick={() => handleDismissRefPriceUpdate(proposal.itemId)}
                  className="px-3 py-1.5 rounded-xl bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold transition-colors min-h-[36px]"
                >
                  Ignorer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Alerte rouge : si soldeReserveFC < 0 */}
      {cumulativeDetails.soldeReserveFC < 0 && (
        <div className="p-4 rounded-2xl bg-rose-600 text-white shadow-md space-y-2 text-xs">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 shrink-0 text-white mt-0.5" />
            <div>
              <span className="font-extrabold text-sm block">
                Les dépenses dépassent la réserve de {formatFC(cumulativeDetails.manqueFC, currency)}
              </span>
              <p className="text-[11px] text-rose-100 leading-snug mt-0.5">
                La caisse réserve est en déficit. Choisissez comment combler ce manque :
              </p>
            </div>
          </div>
          {onOpenReserve && (
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() =>
                  onOpenReserve({
                    amount: cumulativeDetails.manqueFC,
                    reason: 'Complément argent personnel',
                    source: 'personnel',
                  })
                }
                className="flex-1 py-2 px-3 rounded-xl bg-white text-rose-700 font-extrabold hover:bg-rose-50 active:scale-95 transition-all text-xs shadow-xs text-center min-h-[38px]"
              >
                Ajouter mon argent personnel
              </button>
              <button
                type="button"
                onClick={() =>
                  onOpenReserve({
                    amount: cumulativeDetails.manqueFC,
                    reason: 'Transfert pris sur mes bénéfices',
                    source: 'benefices',
                  })
                }
                className="flex-1 py-2 px-3 rounded-xl bg-rose-800 text-white border border-rose-400/50 font-extrabold hover:bg-rose-900 active:scale-95 transition-all text-xs shadow-xs text-center min-h-[38px]"
              >
                Prendre sur mes bénéfices
              </button>
            </div>
          )}
        </div>
      )}

      {/* Month Selector */}
      <div className="flex items-center justify-between p-3 bg-white rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-teal-700" />
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-white"
          />
        </div>
        <span className="text-xs font-bold text-slate-700">
          {formatMonthName(selectedMonth)}
        </span>
      </div>

      {/* Suivi des Caisses */}
      <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-teal-700 text-white flex items-center justify-center">
              <Wallet className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wide text-slate-800">
                État des Caisses
              </h3>
              <span className="text-[11px] text-slate-500">
                Mois en cours : {formatMonthName(selectedMonth)}
              </span>
            </div>
          </div>

          {onOpenReserve && (
            <button
              type="button"
              onClick={() => onOpenReserve()}
              className="text-xs font-bold text-teal-800 hover:text-teal-900 px-2.5 py-1 rounded-xl bg-teal-50 border border-teal-200/80 active:scale-95 transition-all"
            >
              Gérer la Caisse →
            </button>
          )}
        </div>

        {/* 2 Soldes actuels */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-200 text-emerald-950">
            <span className="text-[10px] font-bold uppercase block text-emerald-800">
              Caisse Bénéfices personnels
            </span>
            <span className="text-base font-black font-mono mt-0.5 block text-emerald-900">
              {formatFC(cumulativeDetails.soldeBeneficesFC, currency)}
            </span>
            <span className="text-[9px] text-emerald-700 block mt-0.5 font-medium">
              (Bénéfices disponibles)
            </span>
          </div>

          <div
            className={`p-2.5 rounded-xl border ${
              cumulativeDetails.soldeReserveFC >= 0
                ? 'bg-slate-50 border-slate-200 text-slate-900'
                : 'bg-rose-50 border-rose-200 text-rose-950'
            }`}
          >
            <span className="text-[10px] font-bold uppercase block text-slate-600">
              Caisse Réserve
            </span>
            <span
              className={`text-base font-black font-mono mt-0.5 block ${
                cumulativeDetails.soldeReserveFC >= 0 ? 'text-slate-900' : 'text-rose-700'
              }`}
            >
              {formatFC(cumulativeDetails.soldeReserveFC, currency)}
            </span>
            <span className="text-[9px] text-slate-500 block mt-0.5 font-medium">
              {cumulativeDetails.soldeReserveFC >= 0
                ? 'Caisse Réserve disponible'
                : `Manque ${formatFC(cumulativeDetails.manqueFC, currency)}`}
            </span>
          </div>
        </div>

        {/* 3 Métriques du mois */}
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 text-center text-xs">
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-semibold block">
              Réserve du mois
            </span>
            <span className="text-xs font-extrabold font-mono text-slate-800">
              {formatFC(expenseReserveInMonthFC, currency)}
            </span>
          </div>

          <div>
            <span className="text-[10px] text-slate-500 uppercase font-semibold block">
              Dépenses mois
            </span>
            <span className="text-xs font-extrabold font-mono text-slate-800">
              {formatFC(totalExpensesInMonthFC, currency)}
            </span>
          </div>

          <div>
            <span className="text-[10px] text-slate-500 uppercase font-semibold block">
              Écart du mois
            </span>
            <span
              className={`text-xs font-extrabold font-mono ${
                monthReserveBalanceFC >= 0 ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              {monthReserveBalanceFC >= 0
                ? `+${formatFC(monthReserveBalanceFC, currency)}`
                : formatFC(monthReserveBalanceFC, currency)}
            </span>
          </div>
        </div>
      </div>

      {/* Category filter pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
        <button
          type="button"
          onClick={() => setSelectedCategory('all')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all min-h-[36px] ${
            selectedCategory === 'all'
              ? 'bg-teal-700 text-white shadow-xs'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          Toutes ({monthExpenses.length})
        </button>
        {settings.expenseCategories.map((cat) => {
          const count = monthExpenses.filter((e) => e.category === cat).length;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all min-h-[36px] ${
                selectedCategory === cat
                  ? 'bg-teal-700 text-white shadow-xs'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {cat} ({count})
            </button>
          );
        })}
      </div>

      {/* Expenses List */}
      {displayedExpenses.length === 0 ? (
        <EmptyState
          icon={<WalletCards className="w-7 h-7 text-teal-700" />}
          title={`Aucune dépense en ${formatMonthName(selectedMonth)}`}
          description="Enregistrez vos achats de matières premières (lait, sucre, essence), emballages (bouteilles, sachets) ou frais généraux."
          actionLabel="Enregistrer une dépense"
          onAction={handleOpenAdd}
        />
      ) : (
        <div className="space-y-2.5">
          {displayedExpenses.map((exp) => {
            const ingCount = Array.isArray(exp.ingredientLines) ? exp.ingredientLines.length : 0;
            return (
              <div
                key={exp.id}
                className="bg-white rounded-2xl border border-slate-200/80 p-3.5 shadow-xs space-y-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-slate-900">
                        {formatDate(exp.date)}
                      </span>
                      <span className="text-[11px] font-semibold text-teal-800 bg-teal-50 px-2 py-0.5 rounded-md border border-teal-200/40">
                        {exp.category}
                      </span>
                      {ingCount > 0 && (
                        <span className="text-[11px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200/80">
                          📦 {ingCount} {ingCount > 1 ? 'ingrédients' : 'ingrédient'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 mt-1 font-medium truncate">
                      {exp.detail || 'Sans détail'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-extrabold text-slate-900 font-mono">
                      {formatFC(exp.amountFC, currency)}
                    </span>
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(exp)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 min-w-[34px] min-h-[34px] flex items-center justify-center"
                        title="Modifier"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpenseToDelete(exp)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-100 min-w-[34px] min-h-[34px] flex items-center justify-center"
                        title="Supprimer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {ingCount > 0 && (
                  <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-500 truncate">
                      {exp.supplier ? `Lieu : ${exp.supplier}` : 'Détail des ingrédients enregistrés'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setDetailExpenseToView(exp)}
                      className="px-2.5 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200/80 text-[11px] font-bold transition-colors shrink-0"
                    >
                      Voir le détail
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Modal */}
      {isFormOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
        >
          <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 flex flex-col overflow-hidden max-h-[92vh]">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50/70">
              <h3 className="text-base font-bold text-slate-900">
                {editingExpense ? 'Modifier la Dépense' : 'Nouvelle Dépense'}
              </h3>
              <div className="flex items-center gap-1">
                {onOpenCalculator && (
                  <button
                    type="button"
                    onClick={onOpenCalculator}
                    className="p-2 rounded-xl text-teal-700 hover:bg-teal-50 min-w-[40px] min-h-[40px] flex items-center justify-center"
                    title="Calculatrice"
                  >
                    <Calculator className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-600 min-w-[40px] min-h-[40px] flex items-center justify-center"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <form onSubmit={handleSave} className="p-5 overflow-y-auto space-y-4">
              {formError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Date de la dépense *
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {/* Zone facultative : Ingrédients achetés */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">
                      Ingrédients achetés (facultatif)
                    </span>
                    <span className="text-[10px] text-slate-500">
                      Alimente automatiquement le stock et l’historique des prix
                    </span>
                  </div>
                </div>

                {hasIngredientLines && (
                  <div className="space-y-2.5">
                    {ingredientRows.map((row, rowIndex) => {
                      const catalogItem = costItemsById.get(row.itemId);
                      const isSelectableInTracked = trackedItems.some(
                        (ti) => ti.id === row.itemId
                      );
                      const allowDecimals = catalogItem ? catalogItem.allowDecimals : true;
                      const purchaseUnit = catalogItem?.purchaseUnit || 'unité';
                      const usageUnit = catalogItem?.usageUnit || 'unité';
                      const unitsPerPurchase =
                        catalogItem && catalogItem.usageUnitsPerPurchase > 0
                          ? catalogItem.usageUnitsPerPurchase
                          : 1;

                      const parsedPQty =
                        row.purchaseQtyStr.trim() !== ''
                          ? parseLocaleNumber(row.purchaseQtyStr)
                          : 0;
                      const validPQty =
                        Number.isFinite(parsedPQty) && parsedPQty > 0 ? parsedPQty : 0;
                      const displayPQty = validPQty > 0 ? validPQty : 1;
                      const displayUsageQty =
                        row.originalItemId === row.itemId &&
                        row.originalPurchaseQty === displayPQty &&
                        row.originalUsageQty !== undefined
                          ? row.originalUsageQty
                          : Math.round(displayPQty * unitsPerPurchase * 1_000_000) / 1_000_000;

                      const lastPaidInfo = lastPaidPriceMap.get(row.itemId);
                      const baseLastOrRefPrice =
                        lastPaidInfo !== undefined
                          ? lastPaidInfo.unitPriceFC
                          : catalogItem?.purchasePriceFC ?? 0;

                      const parsedLineAmt =
                        row.amountStr.trim() !== '' ? parseLocaleNumber(row.amountStr) : NaN;
                      const enteredUnitPrice =
                        validPQty > 0 && Number.isFinite(parsedLineAmt) && parsedLineAmt >= 0
                          ? parsedLineAmt / validPQty
                          : null;

                      const diffPctVsLast =
                        enteredUnitPrice !== null && baseLastOrRefPrice > 0
                          ? ((enteredUnitPrice - baseLastOrRefPrice) / baseLastOrRefPrice) * 100
                          : null;

                      const showPriceDeviation =
                        diffPctVsLast !== null && Math.abs(diffPctVsLast) > priceRiseAlertPct;

                      return (
                        <div
                          key={row.rowId}
                          className="p-3 rounded-xl bg-white border border-slate-200 space-y-2.5 shadow-2xs"
                        >
                          <div className="flex items-center gap-2">
                            <select
                              value={row.itemId}
                              onChange={(e) =>
                                handleChangeRowItem(row.rowId, rowIndex, e.target.value)
                              }
                              className="flex-1 min-w-0 px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-900 min-h-[38px]"
                            >
                              {!isSelectableInTracked && (
                                <option value={row.itemId}>
                                  {catalogItem?.name || row.frozenName || 'Élément'} (
                                  {purchaseUnit})
                                </option>
                              )}
                              {trackedItems.map((ti) => (
                                <option key={ti.id} value={ti.id}>
                                  {ti.name} ({ti.purchaseUnit})
                                </option>
                              ))}
                            </select>

                            <button
                              type="button"
                              onClick={() => handleRemoveIngredientRow(row.rowId)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 min-w-[34px] min-h-[34px] flex items-center justify-center shrink-0"
                              title="Retirer cette ligne"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] font-bold text-slate-600 mb-1">
                                Quantité ({purchaseUnit})
                              </label>
                              <input
                                type="text"
                                inputMode={allowDecimals ? 'decimal' : 'numeric'}
                                placeholder={allowDecimals ? 'Ex : 1,5' : 'Ex : 2'}
                                value={row.purchaseQtyStr}
                                onChange={(e) =>
                                  handleChangeRowQty(row.rowId, e.target.value, allowDecimals)
                                }
                                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-extrabold font-mono text-center text-slate-900 bg-white"
                              />
                            </div>

                            <div>
                              <label className="block text-[10px] font-bold text-slate-600 mb-1">
                                Montant ({currency})
                              </label>
                              <input
                                type="text"
                                inputMode="decimal"
                                placeholder="0"
                                value={row.amountStr}
                                onChange={(e) => handleChangeRowAmount(row.rowId, e.target.value)}
                                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-extrabold font-mono text-right text-slate-900 bg-white"
                              />
                            </div>
                          </div>

                          {/* Équivalent en unités d'utilisation & Dernier prix */}
                          <div className="flex items-center justify-between gap-2 flex-wrap text-[11px]">
                            <span className="font-semibold text-teal-800">
                              {formatNumber(displayPQty, 4)} {purchaseUnit} ={' '}
                              {formatNumber(displayUsageQty, 4)} {usageUnit}
                            </span>
                            <span className="text-slate-500 font-medium">
                              Dernier prix : {formatFlexibleFC(baseLastOrRefPrice, currency)}
                            </span>
                          </div>

                          {/* Mention orange si écart > seuil */}
                          {showPriceDeviation && diffPctVsLast !== null && (
                            <div className="px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-bold">
                              {diffPctVsLast > 0 ? '+' : ''}
                              {formatPercent(diffPctVsLast)} par rapport au dernier achat
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Autres frais & Lieu d'achat */}
                    <div className="grid grid-cols-1 gap-2.5 pt-1">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          Autres frais (transport…) — facultatif
                        </label>
                        <div className="relative">
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            value={otherFeesStr}
                            onChange={(e) =>
                              setOtherFeesStr(e.target.value.replace(/[^0-9.,]/g, ''))
                            }
                            className="w-full px-3 py-2 pr-10 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-900"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400">
                            {currency}
                          </span>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          Lieu d’achat — facultatif
                        </label>
                        <input
                          type="text"
                          list="expense-supplier-suggestions"
                          placeholder="Ex : Marché central, Grossiste..."
                          value={supplierStr}
                          onChange={(e) => setSupplierStr(e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-900"
                        />
                        <datalist id="expense-supplier-suggestions">
                          {supplierSuggestions.map((s) => (
                            <option key={s} value={s} />
                          ))}
                        </datalist>
                        {filteredSupplierSuggestions.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {filteredSupplierSuggestions.map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => setSupplierStr(s)}
                                className="px-2 py-0.5 rounded-lg bg-white hover:bg-teal-50 border border-slate-200 text-[10px] font-bold text-slate-700"
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
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

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Catégorie de charge *
                </label>
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setCategoryManuallyChanged(true);
                  }}
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  {category && !settings.expenseCategories.includes(category) && (
                    <option value={category}>{category}</option>
                  )}
                  {settings.expenseCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Montant en {currency} *
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Ex : 15000 ou 11,5"
                    value={
                      hasIngredientLines
                        ? formatNumber(autoCalculatedTotalFC, 2)
                        : amount
                    }
                    readOnly={hasIngredientLines}
                    onChange={(e) => {
                      if (!hasIngredientLines) {
                        setAmount(e.target.value.replace(/[^0-9.,]/g, ''));
                      }
                    }}
                    required={!hasIngredientLines}
                    className={`w-full px-3.5 py-3 rounded-xl border text-base font-bold pr-12 ${
                      hasIngredientLines
                        ? 'border-teal-200 bg-teal-50/60 text-teal-950 cursor-default'
                        : 'border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500'
                    }`}
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">
                    {currency}
                  </span>
                </div>
                {hasIngredientLines && (
                  <p className="text-[10px] font-semibold text-teal-800 mt-1">
                    Calculé automatiquement (somme des ingrédients + autres frais)
                  </p>
                )}
                {(() => {
                  const numAmount = effectiveFormAmountFC;
                  if (isNaN(numAmount) || numAmount <= 0) return null;

                  const reserveAvant = cumulativeDetails.soldeReserveFC;
                  const diff = editingExpense
                    ? (editingExpense.amountFC || 0) - numAmount
                    : -numAmount;
                  const reserveApres = reserveAvant + diff;

                  return (
                    <div className="mt-1.5 space-y-1">
                      <p className="text-[11px] font-semibold text-slate-700">
                        Réserve avant :{' '}
                        <span
                          className={`font-mono font-bold ${
                            reserveAvant < 0 ? 'text-rose-600' : 'text-slate-900'
                          }`}
                        >
                          {formatFC(reserveAvant, currency)}
                        </span>
                        {' → après : '}
                        <span
                          className={`font-mono font-extrabold ${
                            reserveApres < 0 ? 'text-rose-600' : 'text-emerald-700'
                          }`}
                        >
                          {formatFC(reserveApres, currency)}
                        </span>
                      </p>
                      {reserveApres < 0 && (
                        <p className="text-[11px] font-extrabold text-rose-600 flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            Déficit prévu dans la Réserve :{' '}
                            {formatFC(Math.abs(reserveApres), currency)}
                          </span>
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Détail / Motif {hasIngredientLines ? '(facultatif)' : '*'}
                </label>
                <input
                  type="text"
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  placeholder="Ex : 2 cartons de lait au marché, 5 paquets de sucre vanillé"
                  required={!hasIngredientLines}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div className="pt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="flex-1 py-3 px-4 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 min-h-[44px]"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold shadow-xs active:scale-95 transition-all flex items-center justify-center gap-1.5 min-h-[44px]"
                >
                  <Check className="w-4 h-4" />
                  <span>{editingExpense ? 'Mettre à jour' : 'Enregistrer'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Read-Only Expense Ingredients Detail Modal */}
      {detailExpenseToView && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
        >
          <div className="relative w-full max-w-md bg-white rounded-3xl p-5 shadow-2xl border border-slate-200 space-y-4 max-h-[88vh] overflow-y-auto">
            <button
              type="button"
              onClick={() => setDetailExpenseToView(null)}
              aria-label="Fermer"
              className="absolute right-3.5 top-3.5 p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="pr-8">
              <h3 className="text-base font-extrabold text-slate-900">
                Détail de la dépense
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {formatDate(detailExpenseToView.date)} · {detailExpenseToView.category}
              </p>
            </div>

            {detailExpenseToView.supplier && (
              <div className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/80 text-xs flex items-center justify-between">
                <span className="text-slate-500 font-medium">Lieu d’achat :</span>
                <span className="font-bold text-slate-900">{detailExpenseToView.supplier}</span>
              </div>
            )}

            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-700">
                Ingrédients achetés ({detailExpenseToView.ingredientLines?.length || 0})
              </h4>
              <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200/80 bg-slate-50/50 overflow-hidden">
                {(detailExpenseToView.ingredientLines || []).map((line, idx) => {
                  const ci = costItemsById.get(line.itemId);
                  const pUnit = ci?.purchaseUnit || 'u. achat';
                  const uUnit = ci?.usageUnit || 'u. util.';
                  const unitPrice =
                    line.purchaseQty > 0 ? line.amountFC / line.purchaseQty : 0;

                  return (
                    <div key={`${line.itemId}_${idx}`} className="p-3 flex items-start justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <span className="font-extrabold text-slate-900 block">{line.name}</span>
                        <span className="text-[11px] text-slate-600 block">
                          {formatNumber(line.purchaseQty, 4)} {pUnit} ={' '}
                          {formatNumber(line.usageQty, 4)} {uUnit}
                        </span>
                        <span className="text-[10px] text-slate-400 block">
                          Prix unitaire : {formatFlexibleFC(unitPrice, currency)} / {pUnit}
                        </span>
                      </div>
                      <span className="font-extrabold font-mono text-slate-900 shrink-0">
                        {formatFC(Math.round(line.amountFC), currency)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {detailExpenseToView.otherFeesFC !== undefined &&
              detailExpenseToView.otherFeesFC > 0 && (
                <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/70 text-xs">
                  <span className="text-slate-600 font-semibold">Autres frais :</span>
                  <span className="font-bold font-mono text-slate-900">
                    {formatFC(Math.round(detailExpenseToView.otherFeesFC), currency)}
                  </span>
                </div>
              )}

            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-teal-900 text-white">
              <span className="text-xs font-bold">Total dépense</span>
              <span className="text-sm font-extrabold font-mono">
                {formatFC(detailExpenseToView.amountFC, currency)}
              </span>
            </div>

            {detailExpenseToView.detail && (
              <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <span className="font-bold text-slate-700">Détail :</span>{' '}
                {detailExpenseToView.detail}
              </p>
            )}

            <button
              type="button"
              onClick={() => setDetailExpenseToView(null)}
              className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold min-h-[42px]"
            >
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      <ConfirmModal
        isOpen={Boolean(expenseToDelete)}
        title="Supprimer cette dépense ?"
        message={`Voulez-vous supprimer la dépense de ${formatFC(
          expenseToDelete?.amountFC,
          currency
        )} (${expenseToDelete?.category}) ?`}
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        isDanger={true}
        onConfirm={handleDelete}
        onCancel={() => setExpenseToDelete(null)}
      />
    </div>
  );
};
