import React, { useState, useMemo } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Plus,
  Edit2,
  Trash2,
  Calendar,
  Wallet,
  CheckCircle2,
  AlertCircle,
  Receipt,
  UserCheck,
} from 'lucide-react';
import { db } from '../../db/db';
import {
  formatDate,
  formatFC,
  formatMonthName,
  toISOMonth,
  toISODate,
} from '../../utils/formatters';
import { ConfirmModal } from '../../components/ConfirmModal';
import { moveToTrash } from '../../utils/trashManager';
import { PaymentModal } from './PaymentModal';
import type { Employee, Payment, DailyEntry, AppSettings } from '../../types';

interface PaymentsHistoryModalProps {
  isOpen: boolean;
  initialMonth?: string;
  onClose: () => void;
  employees: Employee[];
  dailyEntries: DailyEntry[];
  payments: Payment[];
  settings: AppSettings;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
  onPaymentsChanged: () => void;
}

export const PaymentsHistoryModal: React.FC<PaymentsHistoryModalProps> = ({
  isOpen,
  initialMonth,
  onClose,
  employees,
  dailyEntries,
  payments,
  settings,
  onShowToast,
  onPaymentsChanged,
}) => {
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    return initialMonth || toISOMonth(new Date());
  });

  // State for PaymentModal (add/edit)
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentToEdit, setPaymentToEdit] = useState<Payment | null>(null);
  const [targetEmployee, setTargetEmployee] = useState<Employee | null>(null);

  // State for ConfirmModal (delete)
  const [paymentToDelete, setPaymentToDelete] = useState<Payment | null>(null);

  React.useEffect(() => {
    if (initialMonth) {
      setSelectedMonth(initialMonth);
    }
  }, [initialMonth]);

  const currency = settings.currency || 'FC';

  // Month navigation: previous month
  const handlePrevMonth = () => {
    const [yearStr, monthStr] = selectedMonth.split('-');
    let y = parseInt(yearStr, 10);
    let m = parseInt(monthStr, 10) - 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
    const newMonth = `${y}-${String(m).padStart(2, '0')}`;
    setSelectedMonth(newMonth);
  };

  // Month navigation: next month
  const handleNextMonth = () => {
    const [yearStr, monthStr] = selectedMonth.split('-');
    let y = parseInt(yearStr, 10);
    let m = parseInt(monthStr, 10) + 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    const newMonth = `${y}-${String(m).padStart(2, '0')}`;
    setSelectedMonth(newMonth);
  };

  // 1. Data per employee for the selected month
  const sellerSummaries = useMemo(() => {
    const relevantEmployees = employees.filter((e) => !e.isArchived);

    return relevantEmployees.map((emp) => {
      // Commissions gagnées ce mois
      const empEntries = dailyEntries.filter(
        (e) => e.employeeId === emp.id && e.date.startsWith(selectedMonth)
      );
      const earnedComm = empEntries.reduce((sum, e) => sum + (e.employeeCommissionFC || 0), 0);

      // Paiements versés pour ce mois
      const empPayments = payments.filter(
        (p) => p.employeeId === emp.id && p.month === selectedMonth
      );
      const paidComm = empPayments.reduce((sum, p) => sum + (p.amountFC || 0), 0);

      const remainingDue = earnedComm - paidComm;

      return {
        employee: emp,
        earnedComm,
        paidComm,
        remainingDue,
        paymentsCount: empPayments.length,
      };
    });
  }, [employees, dailyEntries, payments, selectedMonth]);

  // Totals for this month
  const totalEarnedMonth = sellerSummaries.reduce((sum, s) => sum + s.earnedComm, 0);
  const totalPaidMonth = sellerSummaries.reduce((sum, s) => sum + s.paidComm, 0);
  const totalRemainingMonth = sellerSummaries.reduce((sum, s) => sum + s.remainingDue, 0);

  // 2. List of payments for this month (du plus récent au plus ancien)
  const monthPayments = useMemo(() => {
    return payments
      .filter((p) => p.month === selectedMonth)
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
  }, [payments, selectedMonth]);

  const handleDeleteConfirm = async () => {
    if (!paymentToDelete) return;
    try {
      await moveToTrash('payment', paymentToDelete);
      onShowToast('info', 'Paiement déplacé dans la corbeille.');
      setPaymentToDelete(null);
      onPaymentsChanged();
    } catch (err: any) {
      onShowToast('error', 'Erreur lors de la suppression : ' + err.message);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="w-full sm:max-w-2xl bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 flex flex-col overflow-hidden max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-teal-100 text-teal-800 flex items-center justify-center">
              <Receipt className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Paiements des Vendeurs(ses)
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Historique des versements, avances et règlements de commissions
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 min-w-[40px] min-h-[40px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sélecteur de mois : ◀ Octobre 2026 ▶ */}
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200/80 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 shadow-2xs active:scale-95 transition-all"
              title="Mois précédent"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-extrabold text-slate-900 min-w-[140px] text-center">
              {formatMonthName(selectedMonth)}
            </span>
            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 shadow-2xs active:scale-95 transition-all"
              title="Mois suivant"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setPaymentToEdit(null);
                setTargetEmployee(null);
                setIsPaymentModalOpen(true);
              }}
              className="px-3 py-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs shadow-xs active:scale-95 transition-all flex items-center gap-1.5 min-h-[36px]"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Enregistrer un paiement</span>
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-5">
          {/* Month Summary Cards */}
          <div className="grid grid-cols-3 gap-2.5">
            <div className="p-3 rounded-2xl bg-teal-50/70 border border-teal-200/80">
              <span className="text-[10px] font-bold text-teal-800 uppercase block">
                Commissions Gagnées
              </span>
              <span className="text-sm sm:text-base font-black text-teal-950 font-mono block mt-0.5">
                {formatFC(totalEarnedMonth, currency)}
              </span>
            </div>
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
              <span className="text-[10px] font-bold text-slate-500 uppercase block">
                Total Payé
              </span>
              <span className="text-sm sm:text-base font-black text-slate-900 font-mono block mt-0.5">
                {formatFC(totalPaidMonth, currency)}
              </span>
            </div>
            <div
              className={`p-3 rounded-2xl border ${
                totalRemainingMonth > 0
                  ? 'bg-amber-50/80 border-amber-300 text-amber-950'
                  : 'bg-emerald-50/80 border-emerald-300 text-emerald-950'
              }`}
            >
              <span
                className={`text-[10px] font-bold uppercase block ${
                  totalRemainingMonth > 0 ? 'text-amber-800' : 'text-emerald-800'
                }`}
              >
                Reste à Payer
              </span>
              <span className="text-sm sm:text-base font-black font-mono block mt-0.5">
                {formatFC(totalRemainingMonth, currency)}
              </span>
            </div>
          </div>

          {/* Section 1 : Situation par vendeur(se) */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5 text-teal-700" />
              <span>Situation par vendeur(se) pour {formatMonthName(selectedMonth)}</span>
            </h3>

            {sellerSummaries.length === 0 ? (
              <p className="text-xs text-slate-400 italic">Aucun(e) vendeur(se) actif(ve).</p>
            ) : (
              <div className="space-y-2">
                {sellerSummaries.map((item) => (
                  <div
                    key={item.employee.id}
                    className="p-3.5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-slate-900 text-sm">
                          {item.employee.name}
                        </span>
                        {item.remainingDue <= 0 && item.earnedComm > 0 && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Réglé</span>
                          </span>
                        )}
                        {item.remainingDue > 0 && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md">
                            <AlertCircle className="w-3 h-3" />
                            <span>À payer</span>
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[11px] font-mono text-slate-500">
                        <span>Gagné : <strong className="text-slate-800">{formatFC(item.earnedComm, currency)}</strong></span>
                        <span>·</span>
                        <span>Payé : <strong className="text-slate-800">{formatFC(item.paidComm, currency)}</strong> ({item.paymentsCount})</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 pt-1 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                      <div className="text-right">
                        <span className="text-[10px] text-slate-400 block font-sans uppercase">Reste dû</span>
                        <span
                          className={`font-black font-mono text-sm ${
                            item.remainingDue > 0 ? 'text-amber-700' : 'text-slate-700'
                          }`}
                        >
                          {formatFC(item.remainingDue, currency)}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setPaymentToEdit(null);
                          setTargetEmployee(item.employee);
                          setIsPaymentModalOpen(true);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 font-bold text-xs shadow-2xs active:scale-95 transition-all flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Payer</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 2 : Liste des paiements du mois */}
          <div className="space-y-2.5 pt-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Receipt className="w-3.5 h-3.5 text-teal-700" />
                <span>Paiements enregistrés ({monthPayments.length})</span>
              </h3>
              <span className="text-[11px] text-slate-400 font-mono">
                Du plus récent au plus ancien
              </span>
            </div>

            {monthPayments.length === 0 ? (
              <div className="p-6 text-center rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-xs text-slate-400 space-y-2">
                <Wallet className="w-8 h-8 mx-auto text-slate-300" />
                <p>Aucun paiement enregistré pour {formatMonthName(selectedMonth)}.</p>
                <button
                  type="button"
                  onClick={() => {
                    setPaymentToEdit(null);
                    setTargetEmployee(null);
                    setIsPaymentModalOpen(true);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-teal-700 text-white font-bold text-xs shadow-xs inline-flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Enregistrer le premier paiement</span>
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {monthPayments.map((p) => {
                  const typeLabel =
                    p.paymentType === 'advance'
                      ? 'Avance'
                      : p.paymentType === 'final'
                      ? 'Solde final'
                      : 'Règlement';

                  const typeColor =
                    p.paymentType === 'advance'
                      ? 'bg-amber-100 text-amber-800 border-amber-200'
                      : p.paymentType === 'final'
                      ? 'bg-indigo-100 text-indigo-800 border-indigo-200'
                      : 'bg-teal-100 text-teal-800 border-teal-200';

                  return (
                    <div
                      key={p.id}
                      className="p-3.5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-slate-900">{formatDate(p.date)}</span>
                          <span className="font-extrabold text-teal-900 bg-teal-50 px-2 py-0.5 rounded-md border border-teal-200/60">
                            {p.employeeName}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${typeColor}`}
                          >
                            {typeLabel}
                          </span>
                        </div>
                        {p.notes && (
                          <p className="text-[11px] text-slate-500 italic mt-1 truncate">
                            « {p.notes} »
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0">
                        <span className="font-black font-mono text-sm text-slate-900">
                          {formatFC(p.amountFC, currency)}
                        </span>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              const emp = employees.find((e) => e.id === p.employeeId) || null;
                              setTargetEmployee(emp);
                              setPaymentToEdit(p);
                              setIsPaymentModalOpen(true);
                            }}
                            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-800 hover:bg-slate-100 min-h-[36px] min-w-[36px] flex items-center justify-center transition-all"
                            title="Modifier ce paiement"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setPaymentToDelete(p)}
                            className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 min-h-[36px] min-w-[36px] flex items-center justify-center transition-all"
                            title="Supprimer ce paiement"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/70 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs min-h-[40px]"
          >
            Fermer
          </button>
        </div>
      </div>

      {/* PaymentModal (Ajout / Modification) */}
      <PaymentModal
        isOpen={isPaymentModalOpen}
        employee={targetEmployee}
        employees={employees}
        initialMonth={selectedMonth}
        paymentToEdit={paymentToEdit}
        onClose={() => {
          setIsPaymentModalOpen(false);
          setPaymentToEdit(null);
          setTargetEmployee(null);
        }}
        onPaymentSaved={() => {
          onShowToast(
            'success',
            paymentToEdit ? 'Paiement modifié avec succès.' : 'Paiement enregistré avec succès.'
          );
          onPaymentsChanged();
        }}
      />

      {/* Delete Payment Confirm */}
      <ConfirmModal
        isOpen={Boolean(paymentToDelete)}
        title="Supprimer ce versement ?"
        message={`Voulez-vous supprimer le versement de ${formatFC(
          paymentToDelete?.amountFC,
          currency
        )} effectué le ${formatDate(paymentToDelete?.date)} pour ${
          paymentToDelete?.employeeName
        } ? Cette action est irréversible.`}
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        isDanger={true}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setPaymentToDelete(null)}
      />
    </div>
  );
};
