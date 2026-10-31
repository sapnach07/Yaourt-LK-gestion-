import React, { useState, useMemo } from 'react';
import { X, Check, Calendar, AlertCircle } from 'lucide-react';
import { db } from '../../db/db';
import {
  toISODate,
  toISOMonth,
  toLocalTimeStr,
  normalizeTimeStr,
  formatFC,
  formatDate,
  parseLocaleNumber,
} from '../../utils/formatters';
import type {
  DailyEntry,
  Employee,
  Payment,
  PaymentCoveredItem,
  SellerPaymentMode,
  SellerPaymentType,
} from '../../types';

interface PaymentModalProps {
  isOpen: boolean;
  employee: Employee | null;
  employees?: Employee[];
  initialMonth?: string;
  paymentToEdit?: Payment | null;
  coveredEntries?: DailyEntry[] | null;
  defaultAmountOverride?: number | null;
  currency?: string;
  onClose: () => void;
  onPaymentSaved: (savedPayment?: Payment) => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  employee,
  employees,
  initialMonth,
  paymentToEdit,
  coveredEntries,
  defaultAmountOverride,
  currency = 'FC',
  onClose,
  onPaymentSaved,
}) => {
  const [selectedEmpId, setSelectedEmpId] = useState<string>(() => {
    return paymentToEdit?.employeeId || employee?.id || employees?.[0]?.id || '';
  });
  const [date, setDate] = useState(() => paymentToEdit?.date || toISODate(new Date()));
  const [time, setTime] = useState(() =>
    paymentToEdit ? paymentToEdit.time || '' : toLocalTimeStr()
  );
  const [month, setMonth] = useState(
    () => paymentToEdit?.month || initialMonth || toISOMonth(new Date())
  );
  const [amount, setAmount] = useState<string>(() =>
    paymentToEdit ? String(paymentToEdit.amountFC) : ''
  );
  const [paymentType, setPaymentType] = useState<SellerPaymentType>(
    () => paymentToEdit?.paymentType || 'salary'
  );
  const [paymentMode, setPaymentMode] = useState<SellerPaymentMode>(
    () => paymentToEdit?.paymentMode || 'especes'
  );
  const [notes, setNotes] = useState(() => paymentToEdit?.notes || '');
  const [editableCoveredItems, setEditableCoveredItems] = useState<PaymentCoveredItem[]>([]);
  const [checkedEntryIds, setCheckedEntryIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  // Re-synchronize state when modal opens or props change
  React.useEffect(() => {
    if (!isOpen) return;

    if (paymentToEdit) {
      setSelectedEmpId(paymentToEdit.employeeId);
      setDate(paymentToEdit.date);
      setTime(paymentToEdit.time || '');
      setMonth(paymentToEdit.month);
      setAmount(String(paymentToEdit.amountFC));
      setPaymentType(paymentToEdit.paymentType);
      setPaymentMode(paymentToEdit.paymentMode || 'especes');
      setNotes(paymentToEdit.notes || '');

      if (Array.isArray(paymentToEdit.coveredItems) && paymentToEdit.coveredItems.length > 0) {
        const sorted = [...paymentToEdit.coveredItems].sort((a, b) =>
          a.date.localeCompare(b.date)
        );
        setEditableCoveredItems(sorted);
        setCheckedEntryIds(new Set(sorted.map((it) => it.entryId)));
      } else {
        setEditableCoveredItems([]);
        setCheckedEntryIds(new Set());
      }
    } else if (coveredEntries && coveredEntries.length > 0) {
      const items: PaymentCoveredItem[] = [...coveredEntries]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((entry) => ({
          entryId: entry.id,
          date: entry.date,
          commissionFC: Math.round(entry.employeeCommissionFC || 0),
        }));
      const sumComm = items.reduce((s, it) => s + (it.commissionFC || 0), 0);
      const prefillAmt =
        defaultAmountOverride !== undefined && defaultAmountOverride !== null
          ? Math.max(0, Math.round(defaultAmountOverride))
          : sumComm;
      const lastDate = items[items.length - 1].date;

      setSelectedEmpId(
        employee?.id || coveredEntries[0]?.employeeId || employees?.[0]?.id || ''
      );
      setDate(toISODate(new Date()));
      setTime(toLocalTimeStr());
      setMonth(lastDate.slice(0, 7));
      setAmount(prefillAmt > 0 ? String(prefillAmt) : '');
      setPaymentType('by_days');
      setPaymentMode('especes');
      setNotes('');
      setEditableCoveredItems(items);
      setCheckedEntryIds(new Set(items.map((it) => it.entryId)));
    } else {
      setSelectedEmpId(employee?.id || employees?.[0]?.id || '');
      setDate(toISODate(new Date()));
      setTime(toLocalTimeStr());
      setMonth(initialMonth || toISOMonth(new Date()));
      setAmount('');
      setPaymentType('salary');
      setPaymentMode('especes');
      setNotes('');
      setEditableCoveredItems([]);
      setCheckedEntryIds(new Set());
    }
    setError('');
  }, [isOpen, paymentToEdit, employee, employees, initialMonth, coveredEntries, defaultAmountOverride]);

  const activeCheckedItems = useMemo(() => {
    return editableCoveredItems
      .filter((it) => checkedEntryIds.has(it.entryId))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [editableCoveredItems, checkedEntryIds]);

  const sumCheckedCommissionsFC = useMemo(() => {
    return activeCheckedItems.reduce((sum, it) => sum + (it.commissionFC || 0), 0);
  }, [activeCheckedItems]);

  if (!isOpen) return null;

  const isDayBasedContext =
    editableCoveredItems.length > 0 || paymentType === 'by_days';

  const currentEmployee =
    employee || (employees ? employees.find((e) => e.id === selectedEmpId) : null);

  const parsedAmount = amount.trim() ? Math.round(parseLocaleNumber(amount)) : 0;
  const hasValidAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const amountGapFC =
    paymentType === 'by_days' && activeCheckedItems.length > 0 && hasValidAmount
      ? sumCheckedCommissionsFC - parsedAmount
      : 0;

  const toggleCoveredItem = (entryId: string) => {
    setCheckedEntryIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      const nextSum = editableCoveredItems
        .filter((it) => next.has(it.entryId))
        .reduce((s, it) => s + (it.commissionFC || 0), 0);
      if (nextSum > 0) {
        setAmount(String(nextSum));
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!currentEmployee) {
      setError('Veuillez sélectionner un(e) vendeur(se).');
      return;
    }

    const numericAmount = Math.round(parseLocaleNumber(amount));
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError(`Veuillez saisir un montant valide supérieur à 0 ${currency}.`);
      return;
    }

    if (paymentType === 'by_days' && activeCheckedItems.length === 0) {
      setError(
        'Veuillez cocher au moins un jour à régler (ou supprimez ce paiement pour libérer tous les jours).'
      );
      return;
    }

    const sortedItems =
      paymentType === 'by_days' && activeCheckedItems.length > 0
        ? [...activeCheckedItems].sort((a, b) => a.date.localeCompare(b.date))
        : undefined;

    const computedPeriodFrom = sortedItems ? sortedItems[0].date : undefined;
    const computedPeriodTo = sortedItems ? sortedItems[sortedItems.length - 1].date : undefined;
    const effectiveDate = date || toISODate(new Date());
    const normalizedTime = normalizeTimeStr(time);
    const effectiveMonth = computedPeriodTo
      ? computedPeriodTo.slice(0, 7)
      : month || effectiveDate.slice(0, 7);

    try {
      let savedRecord: Payment;

      if (paymentToEdit) {
        const updatedPayment: Payment = {
          ...paymentToEdit,
          employeeId: currentEmployee.id,
          employeeName: currentEmployee.name,
          month: effectiveMonth,
          date: effectiveDate,
          time: normalizedTime,
          amountFC: numericAmount,
          paymentType,
          paymentMode,
          notes: notes.trim(),
        };

        if (!normalizedTime) {
          delete updatedPayment.time;
        }

        if (sortedItems && computedPeriodFrom && computedPeriodTo) {
          updatedPayment.coveredItems = sortedItems;
          updatedPayment.periodFrom = computedPeriodFrom;
          updatedPayment.periodTo = computedPeriodTo;
        } else {
          delete updatedPayment.coveredItems;
          delete updatedPayment.periodFrom;
          delete updatedPayment.periodTo;
        }

        await db.payments.put(updatedPayment);
        savedRecord = updatedPayment;
      } else {
        const newPayment: Payment = {
          id: 'pay_' + Date.now().toString() + '_' + Math.random().toString(36).slice(2, 7),
          employeeId: currentEmployee.id,
          employeeName: currentEmployee.name,
          month: effectiveMonth,
          date: effectiveDate,
          ...(normalizedTime ? { time: normalizedTime } : {}),
          amountFC: numericAmount,
          paymentType,
          paymentMode,
          notes: notes.trim(),
          createdAt: Date.now(),
        };

        if (sortedItems && computedPeriodFrom && computedPeriodTo) {
          newPayment.coveredItems = sortedItems;
          newPayment.periodFrom = computedPeriodFrom;
          newPayment.periodTo = computedPeriodTo;
        }

        await db.payments.put(newPayment);
        savedRecord = newPayment;
      }

      onPaymentSaved(savedRecord);
      onClose();
      setAmount('');
      setNotes('');
    } catch (err: any) {
      setError('Erreur lors de l’enregistrement du paiement : ' + err.message);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 flex flex-col overflow-hidden max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50/70">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {paymentToEdit
                ? 'Modifier un Paiement'
                : paymentType === 'by_days'
                ? 'Payer les jours sélectionnés'
                : 'Enregistrer un Paiement'}
            </h2>
            {currentEmployee ? (
              <p className="text-xs text-slate-500 font-medium">
                Vendeur(se) : {currentEmployee.name}
              </p>
            ) : (
              <p className="text-xs text-slate-500 font-medium">
                Règlement des commissions vendeur(se)
              </p>
            )}
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
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
              {error}
            </div>
          )}

          {!employee && !isDayBasedContext && employees && employees.length > 0 && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Vendeur(se) concerné(e) *
              </label>
              <select
                value={selectedEmpId}
                onChange={(e) => setSelectedEmpId(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Récapitulatif des jours couverts (en création par jours ou édition d'un paiement par jours) */}
          {editableCoveredItems.length > 0 && paymentType === 'by_days' && (
            <div className="p-3 rounded-2xl bg-teal-50/70 border border-teal-200/80 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-extrabold text-teal-950 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-teal-700" />
                  <span>
                    {activeCheckedItems.length}{' '}
                    {activeCheckedItems.length > 1 ? 'jours sélectionnés' : 'jour sélectionné'}
                  </span>
                </span>
                <span className="font-mono font-extrabold text-teal-900">
                  {formatFC(sumCheckedCommissionsFC, currency)}
                </span>
              </div>

              {activeCheckedItems.length > 0 && (
                <p className="text-[11px] text-teal-800 font-medium">
                  Période :{' '}
                  {activeCheckedItems[0].date ===
                  activeCheckedItems[activeCheckedItems.length - 1].date
                    ? `Le ${formatDate(activeCheckedItems[0].date)}`
                    : `Du ${formatDate(activeCheckedItems[0].date)} au ${formatDate(
                        activeCheckedItems[activeCheckedItems.length - 1].date
                      )}`}
                </p>
              )}

              {paymentToEdit && (
                <div className="max-h-32 overflow-y-auto divide-y divide-teal-200/50 bg-white/80 rounded-xl border border-teal-200/60 px-2.5 py-1">
                  {editableCoveredItems.map((it) => {
                    const isChecked = checkedEntryIds.has(it.entryId);
                    return (
                      <label
                        key={it.entryId}
                        className="flex items-center justify-between py-1.5 gap-2 cursor-pointer text-[11px]"
                      >
                        <span className="flex items-center gap-2 font-semibold text-slate-800">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleCoveredItem(it.entryId)}
                            className="w-4 h-4 rounded accent-teal-700"
                          />
                          <span>{formatDate(it.date)}</span>
                        </span>
                        <span className="font-mono font-bold text-teal-800">
                          {formatFC(it.commissionFC, currency)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {paymentType !== 'by_days' && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Mois concerné
              </label>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                required
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Date du versement
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 min-h-[42px]"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-slate-700">Heure</label>
                {time && (
                  <button
                    type="button"
                    onClick={() => setTime('')}
                    className="text-[10px] font-bold text-slate-400 hover:text-rose-600"
                  >
                    Effacer
                  </button>
                )}
              </div>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-mono font-semibold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 min-h-[42px]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Type de paiement
            </label>
            {isDayBasedContext ? (
              <div className="space-y-2">
                <div className="py-2.5 px-3.5 rounded-xl text-xs font-extrabold bg-teal-700 text-white border border-teal-700 text-center">
                  Paiement par jours
                </div>
                {paymentToEdit && (
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPaymentType('salary')}
                      className="py-1.5 px-2 rounded-lg text-[11px] font-bold bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100"
                    >
                      Règlement
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentType('advance')}
                      className="py-1.5 px-2 rounded-lg text-[11px] font-bold bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100"
                    >
                      Avance
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentType('final')}
                      className="py-1.5 px-2 rounded-lg text-[11px] font-bold bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100"
                    >
                      Solde final
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentType('salary')}
                  className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                    paymentType === 'salary'
                      ? 'bg-teal-700 text-white border-teal-700'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  Règlement
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentType('advance')}
                  className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                    paymentType === 'advance'
                      ? 'bg-amber-600 text-white border-amber-600'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  Avance
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentType('final')}
                  className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                    paymentType === 'final'
                      ? 'bg-teal-800 text-white border-teal-800'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  Solde final
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Mode de paiement
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMode('especes')}
                className={`py-2 px-2.5 rounded-xl text-xs font-bold border transition-all ${
                  paymentMode === 'especes'
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                Espèces
              </button>
              <button
                type="button"
                onClick={() => setPaymentMode('mobile_money')}
                className={`py-2 px-2.5 rounded-xl text-xs font-bold border transition-all ${
                  paymentMode === 'mobile_money'
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                Mobile money
              </button>
              <button
                type="button"
                onClick={() => setPaymentMode('autre')}
                className={`py-2 px-2.5 rounded-xl text-xs font-bold border transition-all ${
                  paymentMode === 'autre'
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                Autre
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Montant versé (en {currency}) *
            </label>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
                placeholder="Ex : 25000 ou 11,5"
                required
                className="w-full px-3.5 py-3 rounded-xl border border-slate-200 text-base font-bold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 pr-12"
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-600">
                {currency}
              </span>
            </div>
            {amount && parseLocaleNumber(amount) > 0 && (
              <p className="text-[11px] font-semibold text-teal-700 mt-1">
                = {formatFC(parseLocaleNumber(amount), currency)}
              </p>
            )}
            {paymentType === 'by_days' && activeCheckedItems.length > 0 && amountGapFC !== 0 && (
              <div className="mt-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-bold flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>
                  Écart : {amountGapFC > 0 ? '' : '-'}
                  {formatFC(Math.abs(amountGapFC), currency)}, compté dans le reste dû
                </span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Note ou motif (optionnel)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                paymentType === 'by_days'
                  ? 'Ex : Règlement commissions semaine'
                  : 'Ex : Avance sur commission mi-mois'
              }
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
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
              <span>{paymentToEdit ? 'Mettre à jour' : 'Enregistrer'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
