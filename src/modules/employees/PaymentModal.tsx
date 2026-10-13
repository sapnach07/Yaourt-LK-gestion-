import React, { useState } from 'react';
import { X, Check } from 'lucide-react';
import { db } from '../../db/db';
import { toISODate, toISOMonth, formatFC, parseLocaleNumber } from '../../utils/formatters';
import type { Employee, Payment } from '../../types';

interface PaymentModalProps {
  isOpen: boolean;
  employee: Employee | null;
  employees?: Employee[];
  initialMonth?: string;
  paymentToEdit?: Payment | null;
  onClose: () => void;
  onPaymentSaved: () => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  employee,
  employees,
  initialMonth,
  paymentToEdit,
  onClose,
  onPaymentSaved,
}) => {
  const [selectedEmpId, setSelectedEmpId] = useState<string>(() => {
    return paymentToEdit?.employeeId || employee?.id || employees?.[0]?.id || '';
  });
  const [date, setDate] = useState(() => paymentToEdit?.date || toISODate(new Date()));
  const [month, setMonth] = useState(() => paymentToEdit?.month || initialMonth || toISOMonth(new Date()));
  const [amount, setAmount] = useState<string>(() => paymentToEdit ? String(paymentToEdit.amountFC) : '');
  const [paymentType, setPaymentType] = useState<'advance' | 'salary' | 'final'>(() => paymentToEdit?.paymentType || 'salary');
  const [notes, setNotes] = useState(() => paymentToEdit?.notes || '');
  const [error, setError] = useState('');

  // Re-synchronize state when modal opens or props change
  React.useEffect(() => {
    if (isOpen) {
      if (paymentToEdit) {
        setSelectedEmpId(paymentToEdit.employeeId);
        setDate(paymentToEdit.date);
        setMonth(paymentToEdit.month);
        setAmount(String(paymentToEdit.amountFC));
        setPaymentType(paymentToEdit.paymentType);
        setNotes(paymentToEdit.notes || '');
      } else {
        setSelectedEmpId(employee?.id || employees?.[0]?.id || '');
        setDate(toISODate(new Date()));
        setMonth(initialMonth || toISOMonth(new Date()));
        setAmount('');
        setPaymentType('salary');
        setNotes('');
      }
      setError('');
    }
  }, [isOpen, paymentToEdit, employee, employees, initialMonth]);

  if (!isOpen) return null;

  const currentEmployee = employee || (employees ? employees.find((e) => e.id === selectedEmpId) : null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!currentEmployee) {
      setError('Veuillez sélectionner un(e) vendeur(se).');
      return;
    }

    const numericAmount = parseLocaleNumber(amount);
    if (numericAmount <= 0) {
      setError('Veuillez saisir un montant valide supérieur à 0 FC.');
      return;
    }

    try {
      if (paymentToEdit) {
        const updatedPayment: Payment = {
          ...paymentToEdit,
          employeeId: currentEmployee.id,
          employeeName: currentEmployee.name,
          month: month || toISOMonth(new Date(date)),
          date: date || toISODate(new Date()),
          amountFC: numericAmount,
          paymentType,
          notes: notes.trim(),
        };
        await db.payments.put(updatedPayment);
      } else {
        const newPayment: Payment = {
          id: 'pay_' + Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5),
          employeeId: currentEmployee.id,
          employeeName: currentEmployee.name,
          month: month || toISOMonth(new Date(date)),
          date: date || toISODate(new Date()),
          amountFC: numericAmount,
          paymentType,
          notes: notes.trim(),
          createdAt: Date.now(),
        };
        await db.payments.put(newPayment);
      }
      onPaymentSaved();
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
              {paymentToEdit ? 'Modifier un Paiement' : 'Enregistrer un Paiement'}
            </h2>
            {employee ? (
              <p className="text-xs text-slate-500 font-medium">Vendeur(se) : {employee.name}</p>
            ) : (
              <p className="text-xs text-slate-500 font-medium">Règlement des commissions vendeur(se)</p>
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

          {!employee && employees && employees.length > 0 && (
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

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Date du versement
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Type de paiement
            </label>
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
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Montant versé (en FC) *
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
                FC
              </span>
            </div>
            {amount && parseLocaleNumber(amount) > 0 && (
              <p className="text-[11px] font-semibold text-teal-700 mt-1">
                = {formatFC(parseLocaleNumber(amount))}
              </p>
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
              placeholder="Ex : Avance sur commission mi-mois"
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
