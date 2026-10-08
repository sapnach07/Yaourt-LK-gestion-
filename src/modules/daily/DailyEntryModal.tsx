import React, { useState, useEffect } from 'react';
import { X, Check, AlertTriangle, Calculator, Sparkles } from 'lucide-react';
import { db } from '../../db/db';
import { toISODate, formatFC, parseLocaleNumber, formatNumber } from '../../utils/formatters';
import type { Employee, Product, DailyEntry, DailyEntryItem, AppSettings } from '../../types';

interface DailyEntryModalProps {
  isOpen: boolean;
  entryToEdit?: DailyEntry | null;
  employees: Employee[];
  products: Product[];
  settings: AppSettings;
  onClose: () => void;
  onSaved: () => void;
  onOpenCalculator?: () => void;
}

interface FormProductState {
  productId: string;
  productName: string;
  unitPrice: number;
  previousRest: string;
  delivered: string; // Commande du jour
  sold: string;
  damaged: string;
}

export const DailyEntryModal: React.FC<DailyEntryModalProps> = ({
  isOpen,
  entryToEdit,
  employees,
  products,
  settings,
  onClose,
  onSaved,
  onOpenCalculator,
}) => {
  const [date, setDate] = useState(toISODate(new Date()));
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [customCommissionRate, setCustomCommissionRate] = useState<string>('20');
  const [productRows, setProductRows] = useState<FormProductState[]>([]);
  const [notes, setNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Active employees only (or include currently selected if editing archived)
  const activeEmployees = employees.filter((e) => !e.isArchived || e.id === selectedEmployeeId);
  const activeProducts = products.filter((p) => p.isActive);

  useEffect(() => {
    if (!isOpen) return;

    if (entryToEdit) {
      // Load from editing entry
      setDate(entryToEdit.date);
      setSelectedEmployeeId(entryToEdit.employeeId);
      setCustomCommissionRate(formatNumber(entryToEdit.employeeCommissionRate));
      setNotes(entryToEdit.notes || '');

      const rows: FormProductState[] = activeProducts.map((p) => {
        const existingItem = entryToEdit.items.find((item) => item.productId === p.id);
        return {
          productId: p.id,
          productName: p.name,
          unitPrice: existingItem ? existingItem.unitPrice : p.defaultPrice,
          previousRest: existingItem && existingItem.previousRest > 0 ? formatNumber(existingItem.previousRest) : '',
          delivered: existingItem && existingItem.delivered > 0 ? formatNumber(existingItem.delivered) : '',
          sold: existingItem && existingItem.sold > 0 ? formatNumber(existingItem.sold) : '',
          damaged: existingItem && existingItem.damaged > 0 ? formatNumber(existingItem.damaged) : '',
        };
      });
      setProductRows(rows);
    } else {
      // New entry setup: Reste calculé avec la commande du jour, sans hériter des anciennes saisies
      const defaultEmp = activeEmployees[0];
      const initialEmpId = defaultEmp ? defaultEmp.id : '';
      setSelectedEmployeeId(initialEmpId);
      setCustomCommissionRate(defaultEmp ? formatNumber(defaultEmp.commissionRate) : '20');
      setDate(toISODate(new Date()));
      setNotes('');

      // Build pristine product rows without auto-importing old entries' rests
      const rows: FormProductState[] = activeProducts.map((p) => ({
        productId: p.id,
        productName: p.name,
        unitPrice: p.defaultPrice,
        previousRest: '',
        delivered: '',
        sold: '',
        damaged: '',
      }));
      setProductRows(rows);
    }
  }, [isOpen, entryToEdit]);

  const handleEmployeeChange = (newEmpId: string) => {
    setSelectedEmployeeId(newEmpId);
    const emp = employees.find((e) => e.id === newEmpId);
    if (emp) {
      setCustomCommissionRate(formatNumber(emp.commissionRate));
    }
  };

  const handleRowChange = (
    index: number,
    field: 'previousRest' | 'delivered' | 'sold' | 'damaged',
    val: string
  ) => {
    // Allow digits, dots and commas (e.g. 11,5)
    const sanitized = val.replace(/[^0-9.,]/g, '');

    setProductRows((prev) => {
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        [field]: sanitized,
      };
      return copy;
    });
  };

  if (!isOpen) return null;

  const currentEmployee = employees.find((e) => e.id === selectedEmployeeId);
  const commissionRateNum = parseLocaleNumber(customCommissionRate);
  const expenseReserveRate = settings.expenseReservePct || 50;
  const ownerShareRate = Math.max(0, 100 - expenseReserveRate - commissionRateNum);
  const currency = settings.currency || 'FC';

  // Live calculations:
  // Le reste est calculé directement avec la commande du jour : Commande du jour − Ventes − Abîmé (pas celle des anciennes)
  let totalSalesFC = 0;
  let totalDamagedFC = 0;
  let hasOverSoldWarning = false;

  const calculatedItems: DailyEntryItem[] = productRows.map((r) => {
    const deliveredNum = parseLocaleNumber(r.delivered);
    const soldNum = parseLocaleNumber(r.sold);
    const damagedNum = parseLocaleNumber(r.damaged);

    // Total à vendre du jour = Commande du jour
    const totalToSell = deliveredNum;
    // Reste calculé = Commande du jour - Vendu - Abîmé (sur la commande du jour uniquement)
    const rest = Math.max(0, Math.round((deliveredNum - soldNum - damagedNum) * 100) / 100);

    if (soldNum + damagedNum > deliveredNum && deliveredNum > 0) {
      hasOverSoldWarning = true;
    }

    const soldFC = soldNum * r.unitPrice;
    const damagedFC = damagedNum * r.unitPrice;
    totalSalesFC += soldFC;
    totalDamagedFC += damagedFC;

    return {
      productId: r.productId,
      productName: r.productName,
      unitPrice: r.unitPrice,
      previousRest: 0,
      delivered: deliveredNum,
      totalToSell,
      sold: soldNum,
      damaged: damagedNum,
      rest,
    };
  });

  const employeeCommissionFC = Math.round((totalSalesFC * commissionRateNum) / 100);
  const expenseReserveFC = Math.round((totalSalesFC * expenseReserveRate) / 100);
  const ownerShareFC = Math.round((totalSalesFC * ownerShareRate) / 100);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!selectedEmployeeId || !currentEmployee) {
      setErrorMsg('Veuillez sélectionner un(e) vendeur(se).');
      return;
    }

    if (productRows.length === 0) {
      setErrorMsg('Aucun produit disponible.');
      return;
    }

    const entry: DailyEntry = {
      id: entryToEdit ? entryToEdit.id : 'entry_' + Date.now().toString(),
      date,
      employeeId: selectedEmployeeId,
      employeeName: currentEmployee.name,
      employeeCommissionRate: commissionRateNum,
      items: calculatedItems,
      totalSalesFC,
      totalDamagedFC,
      employeeCommissionFC,
      expenseReserveRate,
      expenseReserveFC,
      ownerShareRate,
      ownerShareFC,
      notes: notes.trim() || undefined,
      createdAt: entryToEdit ? entryToEdit.createdAt : Date.now(),
    };

    try {
      await db.dailyEntries.put(entry);
      onSaved();
      onClose();
    } catch (err: any) {
      setErrorMsg('Erreur lors de l’enregistrement : ' + err.message);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="w-full sm:max-w-2xl bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 flex flex-col overflow-hidden max-h-[95vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50/70">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {entryToEdit ? 'Modifier la Saisie' : 'Nouvelle Saisie Journalière'}
            </h2>
            <p className="text-xs text-slate-500 font-medium">
              Reste calculé avec la commande du jour (virgules acceptées, ex : 11,5)
            </p>
          </div>
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
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-600 min-w-[40px] min-h-[40px] flex items-center justify-center"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 overflow-y-auto space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
              {errorMsg}
            </div>
          )}

          {hasOverSoldWarning && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                Attention : Vendu + Abîmé dépasse la Commande du jour pour un ou plusieurs produits !
              </span>
            </div>
          )}

          {/* Date & Employee Pickers */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Date de la saisie *
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
                Vendeur(se) *
              </label>
              <select
                value={selectedEmployeeId}
                onChange={(e) => handleEmployeeChange(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {activeEmployees.length === 0 ? (
                  <option value="">Aucun(e) vendeur(se) actif(ve) (créez-en un(e))</option>
                ) : (
                  activeEmployees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({formatNumber(emp.commissionRate)} %)
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {/* Commission & Share Formula info pill */}
          {currentEmployee && (
            <div className="p-3 rounded-2xl bg-teal-50/70 border border-teal-200/60 text-xs text-slate-700 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-medium">
                <Sparkles className="w-3.5 h-3.5 text-teal-700" />
                <span>Règle de partage :</span>
              </div>
              <div className="flex items-center gap-2 font-mono text-[11px] font-bold">
                <div className="flex items-center gap-1 text-teal-800">
                  <span>Vendeur(se) :</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={customCommissionRate}
                    onChange={(e) => setCustomCommissionRate(e.target.value.replace(/[^0-9.,]/g, ''))}
                    className="w-12 px-1 py-0.5 rounded-lg border border-teal-300 bg-white text-center font-bold text-xs"
                    title="Taux de commission (virgules acceptées, ex : 22,5)"
                  />
                  <span>%</span>
                </div>
                <span>·</span>
                <span className="text-amber-700">Réserve : {expenseReserveRate} %</span>
                <span>·</span>
                <span className="text-emerald-700">Gérant : {formatNumber(ownerShareRate)} %</span>
              </div>
            </div>
          )}

          {/* Products Input Cards */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                Quantités par produit (ex : 11,5)
              </h3>
              <span className="text-[11px] text-teal-700 font-semibold">
                Reste = Commande du jour − Ventes − Abîmé
              </span>
            </div>

            {productRows.map((row, idx) => {
              const deliveredNum = parseLocaleNumber(row.delivered);
              const soldNum = parseLocaleNumber(row.sold);
              const damagedNum = parseLocaleNumber(row.damaged);

              const rest = Math.max(0, Math.round((deliveredNum - soldNum - damagedNum) * 100) / 100);
              const isOver = soldNum + damagedNum > deliveredNum && deliveredNum > 0;

              return (
                <div
                  key={row.productId}
                  className={`p-3.5 rounded-2xl border transition-all ${
                    isOver
                      ? 'bg-amber-50/40 border-amber-300'
                      : 'bg-slate-50/60 border-slate-200/80 hover:bg-white'
                  }`}
                >
                  {/* Product Header */}
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">{row.productName}</span>
                      <span className="text-xs font-semibold text-slate-500 font-mono">
                        ({formatFC(row.unitPrice, currency)} / u)
                      </span>
                    </div>
                    <div className="text-xs font-bold font-mono">
                      <span className="text-slate-500">Commande du jour : </span>
                      <span className="text-slate-900 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                        {formatNumber(deliveredNum)}
                      </span>
                    </div>
                  </div>

                  {/* Inputs Grid: 3 Clean Columns */}
                  <div className="grid grid-cols-3 gap-2">
                    {/* Commande du jour (Livraison) */}
                    <div>
                      <label className="block text-[11px] font-bold text-teal-800 mb-0.5">
                        Commande du jour *
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.delivered}
                        placeholder="0"
                        onChange={(e) => handleRowChange(idx, 'delivered', e.target.value)}
                        className="w-full px-2.5 py-2 rounded-xl border border-teal-300 text-xs font-bold font-mono text-slate-900 bg-white text-center focus:ring-2 focus:ring-teal-500"
                      />
                    </div>

                    {/* Vendu */}
                    <div>
                      <label className="block text-[11px] font-bold text-emerald-700 mb-0.5">
                        - Vendu
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.sold}
                        placeholder="0"
                        onChange={(e) => handleRowChange(idx, 'sold', e.target.value)}
                        className="w-full px-2.5 py-2 rounded-xl border border-emerald-300 text-xs font-bold font-mono text-emerald-900 bg-emerald-50/50 text-center focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>

                    {/* Abîmé */}
                    <div>
                      <label className="block text-[11px] font-bold text-rose-700 mb-0.5">
                        - Abîmé (perte)
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.damaged}
                        placeholder="0"
                        onChange={(e) => handleRowChange(idx, 'damaged', e.target.value)}
                        className="w-full px-2.5 py-2 rounded-xl border border-rose-300 text-xs font-bold font-mono text-rose-900 bg-rose-50/50 text-center focus:ring-2 focus:ring-rose-500"
                      />
                    </div>
                  </div>

                  {/* Calculated Result row */}
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-200/60 text-xs">
                    <span className="text-slate-600 font-medium">
                      Ventes :{' '}
                      <span className="font-bold font-mono text-emerald-700">
                        {formatFC(soldNum * row.unitPrice, currency)}
                      </span>
                    </span>
                    <span className="font-medium">
                      Reste calculé :{' '}
                      <span className="font-extrabold font-mono text-teal-800 bg-teal-50 px-2 py-0.5 rounded-md border border-teal-200/50">
                        {formatNumber(rest)}
                      </span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Notes input */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Notes de la journée (optionnel)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex : Commande spéciale, temps chaud..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          {/* Live Financial Recap */}
          <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-2">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wide block">
              Calculs automatiques de la saisie
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs pt-1">
              <div>
                <span className="text-slate-400 block text-[11px]">Ventes du jour</span>
                <span className="text-base font-extrabold text-white font-mono">
                  {formatFC(totalSalesFC, currency)}
                </span>
              </div>
              <div>
                <span className="text-teal-300 block text-[11px]">
                  Commission ({formatNumber(commissionRateNum)} %)
                </span>
                <span className="text-base font-extrabold text-teal-400 font-mono">
                  {formatFC(employeeCommissionFC, currency)}
                </span>
              </div>
              <div>
                <span className="text-amber-300 block text-[11px]">
                  Réserve dépenses ({expenseReserveRate} %)
                </span>
                <span className="text-sm font-bold text-amber-300 font-mono">
                  {formatFC(expenseReserveFC, currency)}
                </span>
              </div>
              <div>
                <span className="text-emerald-300 block text-[11px]">
                  Ma part théorique ({formatNumber(ownerShareRate)} %)
                </span>
                <span className="text-sm font-bold text-emerald-400 font-mono">
                  {formatFC(ownerShareFC, currency)}
                </span>
              </div>
            </div>
            {totalDamagedFC > 0 && (
              <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs text-rose-300">
                <span>Perte yaourt abîmé (à ma charge) :</span>
                <span className="font-bold font-mono">{formatFC(totalDamagedFC, currency)}</span>
              </div>
            )}
          </div>

          {/* Actions */}
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
              disabled={activeEmployees.length === 0}
              className="flex-1 py-3 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs font-bold shadow-xs active:scale-95 transition-all flex items-center justify-center gap-1.5 min-h-[44px]"
            >
              <Check className="w-4 h-4" />
              <span>{entryToEdit ? 'Mettre à jour' : 'Enregistrer la saisie'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
