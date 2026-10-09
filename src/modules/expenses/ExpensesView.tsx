import React, { useState, useEffect } from 'react';
import {
  WalletCards,
  Plus,
  AlertTriangle,
  Calendar,
  Edit2,
  Trash2,
  X,
  Check,
  ShieldCheck,
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
import { calculateReserveBalance, type ReserveDetails } from '../../utils/reserveCalculator';
import type { Expense, DailyEntry, ReserveMovement, AppSettings } from '../../types';

interface ExpensesViewProps {
  settings: AppSettings;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
  onOpenCalculator?: () => void;
  onOpenReserve?: () => void;
}

export const ExpensesView: React.FC<ExpensesViewProps> = ({
  settings,
  onShowToast,
  onOpenCalculator,
  onOpenReserve,
}) => {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [dailyEntries, setDailyEntries] = useState<DailyEntry[]>([]);
  const [reserveMovements, setReserveMovements] = useState<ReserveMovement[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>(toISOMonth(new Date()));
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Form modal state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  const [date, setDate] = useState(toISODate(new Date()));
  const [amount, setAmount] = useState<string>('');
  const [category, setCategory] = useState<string>(settings.expenseCategories[0] || 'Lait concentré');
  const [detail, setDetail] = useState('');
  const [formError, setFormError] = useState('');

  // Delete modal
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [exps, entries, movs] = await Promise.all([
      db.expenses.orderBy('date').reverse().toArray(),
      db.dailyEntries.toArray(),
      db.reserveMovements.toArray(),
    ]);
    setExpenses(exps);
    setDailyEntries(entries);
    setReserveMovements(movs);
  };

  const handleOpenAdd = () => {
    setEditingExpense(null);
    setDate(toISODate(new Date()));
    setAmount('');
    setCategory(settings.expenseCategories[0] || 'Lait concentré');
    setDetail('');
    setFormError('');
    setIsFormOpen(true);
  };

  const handleOpenEdit = (exp: Expense) => {
    setEditingExpense(exp);
    setDate(exp.date);
    setAmount(formatNumber(exp.amountFC));
    setCategory(exp.category);
    setDetail(exp.detail);
    setFormError('');
    setIsFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const numAmount = parseLocaleNumber(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setFormError('Veuillez entrer un montant valide supérieur à 0 FC.');
      return;
    }

    try {
      if (editingExpense) {
        const updated: Expense = {
          ...editingExpense,
          date,
          amountFC: numAmount,
          category,
          detail: detail.trim(),
        };
        await db.expenses.put(updated);
        onShowToast('success', 'Dépense mise à jour.');
      } else {
        const newExp: Expense = {
          id: 'exp_' + Date.now().toString(),
          date,
          amountFC: numAmount,
          category,
          detail: detail.trim(),
          createdAt: Date.now(),
        };
        await db.expenses.put(newExp);
        onShowToast('success', 'Dépense enregistrée.');
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
      await db.expenses.delete(expenseToDelete.id);
      onShowToast('info', 'Dépense supprimée.');
      setExpenseToDelete(null);
      await loadData();
    } catch (err: any) {
      onShowToast('error', 'Erreur suppression : ' + err.message);
    }
  };

  // Month calculations (information secondaire)
  const monthEntries = dailyEntries.filter((e) => e.date.startsWith(selectedMonth));
  const totalSalesInMonthFC = monthEntries.reduce((acc, e) => acc + (e.totalSalesFC || 0), 0);
  const reserveRate = settings.expenseReservePct || 50;
  const expenseReserveInMonthFC = Math.round((totalSalesInMonthFC * reserveRate) / 100);

  const monthExpenses = expenses.filter((e) => e.date.startsWith(selectedMonth));
  const totalExpensesInMonthFC = monthExpenses.reduce((acc, e) => acc + (e.amountFC || 0), 0);

  const monthReserveBalanceFC = expenseReserveInMonthFC - totalExpensesInMonthFC;
  const isMonthExceeded = totalExpensesInMonthFC > expenseReserveInMonthFC;
  const monthOverrunFC = totalExpensesInMonthFC - expenseReserveInMonthFC;
  const monthOverrunPct = safePercentage(monthOverrunFC, expenseReserveInMonthFC);

  // SOLDE DE RÉSERVE CUMULÉ (depuis le tout début, sans filtre de période ni remise à zéro)
  const cumulativeDetails = calculateReserveBalance(
    reserveMovements,
    dailyEntries,
    expenses,
    reserveRate
  );
  const isCumulativeNegative = cumulativeDetails.soldeFC < 0;

  // Filtered by category
  const displayedExpenses = monthExpenses.filter((e) =>
    selectedCategory === 'all' ? true : e.category === selectedCategory
  );

  const currency = settings.currency || 'FC';

  return (
    <div className="pb-24 pt-3 px-4 max-w-lg mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">
            Dépenses
          </h2>
          <p className="text-xs text-slate-500">
            Achats, charges et suivi de la réserve de 50 %
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onOpenReserve && (
            <button
              type="button"
              onClick={onOpenReserve}
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

      {/* Expense Reserve Comparison Card */}
      <div
        className={`rounded-2xl border p-4 shadow-xs transition-all ${
          isCumulativeNegative
            ? 'bg-rose-50 border-rose-300 text-rose-950'
            : 'bg-emerald-50/70 border-emerald-300 text-emerald-950'
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {isCumulativeNegative ? (
              <div className="w-7 h-7 rounded-lg bg-rose-600 text-white flex items-center justify-center">
                <AlertTriangle className="w-4 h-4" />
              </div>
            ) : (
              <div className="w-7 h-7 rounded-lg bg-emerald-700 text-white flex items-center justify-center">
                <ShieldCheck className="w-4 h-4" />
              </div>
            )}
            <div>
              <h3 className="text-xs font-extrabold uppercase tracking-wide">
                Solde Caisse Cumulé : {formatFC(cumulativeDetails.soldeFC, currency)}
              </h3>
              <span className="text-[11px] text-slate-600">
                Comparaison du mois : {formatMonthName(selectedMonth)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {onOpenReserve && (
              <button
                type="button"
                onClick={onOpenReserve}
                className="text-[11px] font-bold text-teal-700 hover:underline px-1.5 py-0.5 rounded bg-white/70 border border-slate-200/80"
              >
                Gérer
              </button>
            )}
            <span
              className={`text-xs font-extrabold px-2 py-0.5 rounded-md font-mono ${
                isCumulativeNegative
                  ? 'bg-rose-200/80 text-rose-800'
                  : 'bg-emerald-200/80 text-emerald-800'
              }`}
            >
              {isCumulativeNegative ? 'DÉFICIT CAISSE' : 'CAISSE POSITIVE'}
            </span>
          </div>
        </div>

        {/* 3 Metric Columns: Month comparison (information secondaire, sans alerte rouge) */}
        <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-200/60 text-center">
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-semibold block">
              Réserve mois ({reserveRate}%)
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
            <span className="text-xs font-extrabold font-mono text-slate-800">
              {monthReserveBalanceFC >= 0
                ? `+${formatFC(monthReserveBalanceFC, currency)}`
                : formatFC(monthReserveBalanceFC, currency)}
            </span>
          </div>
        </div>

        {/* L'alerte rouge ne s'affiche que si le solde CUMULÉ est négatif */}
        {isCumulativeNegative && (
          <div className="mt-3 p-2 rounded-xl bg-white/90 border border-rose-300 text-rose-800 text-xs font-bold flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>
              Alerte : Solde cumulé de la caisse négatif ({formatFC(cumulativeDetails.soldeFC, currency)}) ! Pensez à réapprovisionner la caisse.
            </span>
          </div>
        )}
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
          {displayedExpenses.map((exp) => (
            <div
              key={exp.id}
              className="bg-white rounded-2xl border border-slate-200/80 p-3.5 shadow-xs flex items-center justify-between gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-900">
                    {formatDate(exp.date)}
                  </span>
                  <span className="text-[11px] font-semibold text-teal-800 bg-teal-50 px-2 py-0.5 rounded-md border border-teal-200/40">
                    {exp.category}
                  </span>
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
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      {isFormOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
        >
          <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 flex flex-col overflow-hidden max-h-[90vh]">
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

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Catégorie de charge *
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
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
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
                    required
                    className="w-full px-3.5 py-3 rounded-xl border border-slate-200 text-base font-bold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 pr-12"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">
                    {currency}
                  </span>
                </div>
                {amount && parseLocaleNumber(amount) > 0 && (
                  <p className="text-[11px] font-semibold text-teal-700 mt-1">
                    = {formatFC(parseLocaleNumber(amount), currency)}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Détail / Motif *
                </label>
                <input
                  type="text"
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  placeholder="Ex : 2 cartons de lait au marché, 5 paquets de sucre vanillé"
                  required
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
