import React, { useState, useEffect } from 'react';
import { X, Check, AlertTriangle, Calculator, Sparkles } from 'lucide-react';
import { db, getPreviousRestForEmployee } from '../../db/db';
import { toISODate, formatFC } from '../../utils/formatters';
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
  previousRest: number;
  delivered: number;
  sold: number;
  damaged: number;
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
  const [customCommissionRate, setCustomCommissionRate] = useState<number>(20);
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
      setCustomCommissionRate(entryToEdit.employeeCommissionRate);
      setNotes(entryToEdit.notes || '');

      const rows: FormProductState[] = activeProducts.map((p) => {
        const existingItem = entryToEdit.items.find((item) => item.productId === p.id);
        return {
          productId: p.id,
          productName: p.name,
          unitPrice: existingItem ? existingItem.unitPrice : p.defaultPrice,
          previousRest: existingItem ? existingItem.previousRest : 0,
          delivered: existingItem ? existingItem.delivered : 0,
          sold: existingItem ? existingItem.sold : 0,
          damaged: existingItem ? existingItem.damaged : 0,
        };
      });
      setProductRows(rows);
    } else {
      // New entry setup
      const defaultEmp = activeEmployees[0];
      const initialEmpId = defaultEmp ? defaultEmp.id : '';
      setSelectedEmployeeId(initialEmpId);
      setCustomCommissionRate(defaultEmp ? defaultEmp.commissionRate : 20);
      setDate(toISODate(new Date()));
      setNotes('');

      // Build product rows
      initNewRows(initialEmpId, toISODate(new Date()));
    }
  }, [isOpen, entryToEdit]);

  const initNewRows = async (empId: string, targetDate: string) => {
    let autoRests: Record<string, number> = {};
    if (empId && targetDate) {
      autoRests = await getPreviousRestForEmployee(empId, targetDate);
    }

    const rows: FormProductState[] = activeProducts.map((p) => ({
      productId: p.id,
      productName: p.name,
      unitPrice: p.defaultPrice,
      previousRest: autoRests[p.id] || 0,
      delivered: 0,
      sold: 0,
      damaged: 0,
    }));
    setProductRows(rows);
  };

  const handleEmployeeChange = async (newEmpId: string) => {
    setSelectedEmployeeId(newEmpId);
    const emp = employees.find((e) => e.id === newEmpId);
    if (emp) {
      setCustomCommissionRate(emp.commissionRate);
      if (!entryToEdit) {
        // Auto fetch previous rests for this new employee
        const autoRests = await getPreviousRestForEmployee(newEmpId, date);
        setProductRows((prev) =>
          prev.map((row) => ({
            ...row,
            previousRest: autoRests[row.productId] !== undefined ? autoRests[row.productId] : row.previousRest,
          }))
        );
      }
    }
  };

  const handleDateChange = async (newDate: string) => {
    setDate(newDate);
    if (!entryToEdit && selectedEmployeeId) {
      const autoRests = await getPreviousRestForEmployee(selectedEmployeeId, newDate);
      setProductRows((prev) =>
        prev.map((row) => ({
          ...row,
          previousRest: autoRests[row.productId] !== undefined ? autoRests[row.productId] : row.previousRest,
        }))
      );
    }
  };

  const handleRowChange = (
    index: number,
    field: 'previousRest' | 'delivered' | 'sold' | 'damaged' | 'unitPrice',
    val: string
  ) => {
    const numeric = parseFloat(val);
    const safeVal = isNaN(numeric) ? 0 : Math.max(0, numeric);

    setProductRows((prev) => {
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        [field]: safeVal,
      };
      return copy;
    });
  };

  if (!isOpen) return null;

  const currentEmployee = employees.find((e) => e.id === selectedEmployeeId);
  const expenseReserveRate = settings.expenseReservePct || 50;
  const ownerShareRate = Math.max(0, 100 - expenseReserveRate - customCommissionRate);
  const currency = settings.currency || 'FC';

  // Live calculations
  let totalSalesFC = 0;
  let totalDamagedFC = 0;
  let hasOverSoldWarning = false;

  const calculatedItems: DailyEntryItem[] = productRows.map((r) => {
    const totalToSell = r.previousRest + r.delivered;
    const rest = Math.max(0, totalToSell - r.sold - r.damaged);
    if (r.sold + r.damaged > totalToSell) {
      hasOverSoldWarning = true;
    }
    const soldFC = r.sold * r.unitPrice;
    const damagedFC = r.damaged * r.unitPrice;
    totalSalesFC += soldFC;
    totalDamagedFC += damagedFC;

    return {
      productId: r.productId,
      productName: r.productName,
      unitPrice: r.unitPrice,
      previousRest: r.previousRest,
      delivered: r.delivered,
      totalToSell,
      sold: r.sold,
      damaged: r.damaged,
      rest,
    };
  });

  const employeeCommissionFC = Math.round((totalSalesFC * customCommissionRate) / 100);
  const expenseReserveFC = Math.round((totalSalesFC * expenseReserveRate) / 100);
  const ownerShareFC = Math.round((totalSalesFC * ownerShareRate) / 100);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!selectedEmployeeId || !currentEmployee) {
      setErrorMsg('Veuillez sélectionner une employée.');
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
      employeeCommissionRate: customCommissionRate,
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
              Ventes, stock et commissions par employée
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
                Attention : Vendu + Abîmé dépasse le Total à vendre pour un ou plusieurs produits !
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
                onChange={(e) => handleDateChange(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Employée *
              </label>
              <select
                value={selectedEmployeeId}
                onChange={(e) => handleEmployeeChange(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {activeEmployees.length === 0 ? (
                  <option value="">Aucune employée active (créez-en une)</option>
                ) : (
                  activeEmployees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.commissionRate} %)
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
                <span>Règle de partage des ventes :</span>
              </div>
              <div className="flex items-center gap-2 font-mono text-[11px] font-bold">
                <span className="text-teal-800">Employée : {customCommissionRate} %</span>
                <span>·</span>
                <span className="text-amber-700">Réserve : {expenseReserveRate} %</span>
                <span>·</span>
                <span className="text-emerald-700">Gérant : {ownerShareRate} %</span>
              </div>
            </div>
          )}

          {/* Products Input Cards */}
          <div className="space-y-3">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
              Quantités par produit
            </h3>

            {productRows.map((row, idx) => {
              const totalToSell = row.previousRest + row.delivered;
              const rest = Math.max(0, totalToSell - row.sold - row.damaged);
              const isOver = row.sold + row.damaged > totalToSell;

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
                      <span className="text-slate-500">Total à vendre : </span>
                      <span className="text-slate-900 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                        {totalToSell}
                      </span>
                    </div>
                  </div>

                  {/* Inputs Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                        Reste veille
                      </label>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        value={row.previousRest === 0 ? '' : row.previousRest}
                        placeholder="0"
                        onChange={(e) => handleRowChange(idx, 'previousRest', e.target.value)}
                        className="w-full px-2.5 py-2 rounded-xl border border-slate-200 text-xs font-bold font-mono text-slate-800 bg-white text-center focus:ring-2 focus:ring-teal-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                        + Livraison
                      </label>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        value={row.delivered === 0 ? '' : row.delivered}
                        placeholder="0"
                        onChange={(e) => handleRowChange(idx, 'delivered', e.target.value)}
                        className="w-full px-2.5 py-2 rounded-xl border border-slate-200 text-xs font-bold font-mono text-slate-800 bg-white text-center focus:ring-2 focus:ring-teal-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-emerald-700 mb-0.5">
                        - Vendu
                      </label>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        value={row.sold === 0 ? '' : row.sold}
                        placeholder="0"
                        onChange={(e) => handleRowChange(idx, 'sold', e.target.value)}
                        className="w-full px-2.5 py-2 rounded-xl border border-emerald-300 text-xs font-bold font-mono text-emerald-900 bg-emerald-50/50 text-center focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-rose-700 mb-0.5">
                        - Abîmé (perte)
                      </label>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        value={row.damaged === 0 ? '' : row.damaged}
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
                        {formatFC(row.sold * row.unitPrice, currency)}
                      </span>
                    </span>
                    <span className="font-medium">
                      Reste calculé :{' '}
                      <span className="font-extrabold font-mono text-teal-800 bg-teal-50 px-2 py-0.5 rounded-md border border-teal-200/50">
                        {rest}
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
              placeholder="Ex : Pluie l'après-midi, livraison tardive..."
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
                  Commission ({customCommissionRate} %)
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
                  Ma part théorique ({ownerShareRate} %)
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
