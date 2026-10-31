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
  FileDown,
  Check,
} from 'lucide-react';
import { db } from '../../db/db';
import {
  formatDate,
  formatDateWithTime,
  formatDeliveryReturnTimes,
  compareRecordsByDateTimeDesc,
  formatFC,
  formatMonthName,
  toISOMonth,
} from '../../utils/formatters';
import { ConfirmModal } from '../../components/ConfirmModal';
import { moveToTrash } from '../../utils/trashManager';
import { generatePaymentByDaysPDF } from '../../utils/pdfGenerator';
import {
  buildPaidEntryMap,
  formatPaymentModeLabel,
  formatPaymentTypeLabel,
  formatShortDayMonth,
  getEmployeePaidForMonth,
  getEntryPaymentStatus,
  getPaymentShareForMonth,
  getPaymentsTouchingMonth,
  isSellerMonthClosed,
  upsertSellerMonthClosure,
} from '../../utils/sellerPayroll';
import { PaymentModal } from './PaymentModal';
import type { Employee, Payment, DailyEntry, AppSettings } from '../../types';

interface PaymentsHistoryModalProps {
  isOpen: boolean;
  initialMonth?: string;
  initialTab?: 'month' | 'days';
  initialEmployeeId?: string;
  onClose: () => void;
  employees: Employee[];
  dailyEntries: DailyEntry[];
  payments: Payment[];
  settings: AppSettings;
  onSettingsUpdated?: (newSettings: AppSettings) => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
  onPaymentsChanged: () => void;
}

export const PaymentsHistoryModal: React.FC<PaymentsHistoryModalProps> = ({
  isOpen,
  initialMonth,
  initialTab,
  initialEmployeeId,
  onClose,
  employees,
  dailyEntries,
  payments,
  settings,
  onSettingsUpdated,
  onShowToast,
  onPaymentsChanged,
}) => {
  const [activeTab, setActiveTab] = useState<'month' | 'days'>(() => initialTab || 'month');
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    return initialMonth || toISOMonth(new Date());
  });

  // Onglet "Par jours" : filtres et sélection
  const [daysSellerFilter, setDaysSellerFilter] = useState<string>(
    () => initialEmployeeId || 'all'
  );
  const [daysStatusFilter, setDaysStatusFilter] = useState<'unpaid' | 'all'>('unpaid');
  const [rangeFrom, setRangeFrom] = useState<string>('');
  const [rangeTo, setRangeTo] = useState<string>('');
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());

  // State for PaymentModal (add/edit/by_days)
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentToEdit, setPaymentToEdit] = useState<Payment | null>(null);
  const [targetEmployee, setTargetEmployee] = useState<Employee | null>(null);
  const [modalCoveredEntries, setModalCoveredEntries] = useState<DailyEntry[] | null>(null);
  const [modalAmountOverride, setModalAmountOverride] = useState<number | null>(null);

  // Clôture du mois ("✓ Payé et clôturer")
  const [pendingClosureAfterPayment, setPendingClosureAfterPayment] = useState<{
    employee: Employee;
    month: string;
    earnedComm: number;
    priorPaidComm: number;
  } | null>(null);
  const [closureConfirmTarget, setClosureConfirmTarget] = useState<{
    employee: Employee;
    month: string;
    remainingFC: number;
  } | null>(null);

  // State for ConfirmModal (delete)
  const [paymentToDelete, setPaymentToDelete] = useState<Payment | null>(null);
  const [generatingPdfId, setGeneratingPdfId] = useState<string | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    if (initialMonth) {
      setSelectedMonth(initialMonth);
    }
    if (initialTab) {
      setActiveTab(initialTab);
    }
    if (initialEmployeeId) {
      setDaysSellerFilter(initialEmployeeId);
    }
    setSelectedEntryIds(new Set());
  }, [isOpen, initialMonth, initialTab, initialEmployeeId]);

  const currency = settings.currency || 'FC';

  // Index dynamique de tous les jours déjà payés (jamais stocké sur DailyEntry)
  const paidEntryMap = useMemo(() => buildPaidEntryMap(payments), [payments]);

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

  // 1. Data per employee for the selected month ("Par mois")
  const sellerSummaries = useMemo(() => {
    const relevantEmployees = employees.filter((e) => !e.isArchived);

    return relevantEmployees.map((emp) => {
      const empEntries = dailyEntries.filter(
        (e) => e.employeeId === emp.id && e.date.startsWith(selectedMonth)
      );
      const earnedComm = empEntries.reduce((sum, e) => sum + (e.employeeCommissionFC || 0), 0);

      // "Payé du mois" : prorata pour les paiements avec coveredItems, affecté à month sinon
      const paidComm = getEmployeePaidForMonth(payments, emp.id, selectedMonth);
      const empMonthPayments = getPaymentsTouchingMonth(payments, selectedMonth, emp.id);

      const isClosed = isSellerMonthClosed(settings.payrollClosures, emp.id, selectedMonth);
      const rawRemainingDue = earnedComm - paidComm;
      const remainingDue = isClosed ? 0 : rawRemainingDue;

      const unpaidMonthEntries = empEntries
        .filter((e) => getEntryPaymentStatus(e, paidEntryMap).status === 'unpaid')
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        employee: emp,
        earnedComm,
        paidComm,
        rawRemainingDue,
        remainingDue,
        isClosed,
        unpaidMonthEntries,
        paymentsCount: empMonthPayments.length,
      };
    });
  }, [employees, dailyEntries, payments, selectedMonth, settings.payrollClosures, paidEntryMap]);

  // Totals for this month
  const totalEarnedMonth = sellerSummaries.reduce((sum, s) => sum + s.earnedComm, 0);
  const totalPaidMonth = sellerSummaries.reduce((sum, s) => sum + s.paidComm, 0);
  const totalRemainingMonth = sellerSummaries.reduce((sum, s) => sum + s.remainingDue, 0);

  // 2. List of payments touching this month (du plus récent au plus ancien)
  const monthPayments = useMemo(() => {
    return getPaymentsTouchingMonth(payments, selectedMonth).sort(compareRecordsByDateTimeDesc);
  }, [payments, selectedMonth]);

  // =========================================================================
  // ONGLET "PAR JOURS" : liste sur TOUTES les dates + sélection
  // =========================================================================
  const selectableSellers = useMemo(() => {
    return employees
      .filter((e) => !e.isArchived || dailyEntries.some((d) => d.employeeId === e.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [employees, dailyEntries]);

  const sellerEntriesAllDates = useMemo(() => {
    return dailyEntries
      .filter((e) => daysSellerFilter === 'all' || e.employeeId === daysSellerFilter)
      .sort(compareRecordsByDateTimeDesc);
  }, [dailyEntries, daysSellerFilter]);

  const displayedDayRows = useMemo(() => {
    return sellerEntriesAllDates
      .map((entry) => ({
        entry,
        dayStatus: getEntryPaymentStatus(entry, paidEntryMap),
      }))
      .filter(({ dayStatus }) => {
        if (daysStatusFilter === 'unpaid') {
          return dayStatus.status !== 'paid';
        }
        return true;
      });
  }, [sellerEntriesAllDates, paidEntryMap, daysStatusFilter]);

  const visibleSelectableEntries = useMemo(() => {
    return displayedDayRows
      .filter((r) => r.dayStatus.status === 'unpaid')
      .map((r) => r.entry);
  }, [displayedDayRows]);

  const allVisibleUnpaidChecked =
    visibleSelectableEntries.length > 0 &&
    visibleSelectableEntries.every((e) => selectedEntryIds.has(e.id));

  // Compteur en direct des jours cochés (uniquement parmi les jours "Non payé" valides)
  const checkedStats = useMemo(() => {
    const entries: DailyEntry[] = [];
    const empIds = new Set<string>();
    let totalCommissionFC = 0;

    for (const entry of dailyEntries) {
      if (!selectedEntryIds.has(entry.id)) continue;
      const st = getEntryPaymentStatus(entry, paidEntryMap);
      if (st.status !== 'unpaid') continue;
      entries.push(entry);
      empIds.add(entry.employeeId);
      totalCommissionFC += Math.round(entry.employeeCommissionFC || 0);
    }

    entries.sort((a, b) => a.date.localeCompare(b.date));

    return {
      entries,
      count: entries.length,
      totalCommissionFC,
      distinctEmployeeIds: Array.from(empIds),
    };
  }, [dailyEntries, selectedEntryIds, paidEntryMap]);

  // Liste des paiements par jours enregistrés (filtrés par vendeuse dans l'onglet "Par jours")
  const recordedDayPayments = useMemo(() => {
    return payments
      .filter((p) => {
        if (!Array.isArray(p.coveredItems) || p.coveredItems.length === 0) return false;
        if (daysSellerFilter !== 'all' && p.employeeId !== daysSellerFilter) return false;
        return true;
      })
      .sort(compareRecordsByDateTimeDesc);
  }, [payments, daysSellerFilter]);

  const handleToggleEntryCheck = (entry: DailyEntry) => {
    const st = getEntryPaymentStatus(entry, paidEntryMap);
    if (st.status !== 'unpaid') return; // Jamais la possibilité de cocher un jour déjà payé ou à compléter
    setSelectedEntryIds((prev) => {
      const next = new Set(prev);
      if (next.has(entry.id)) {
        next.delete(entry.id);
      } else {
        next.add(entry.id);
      }
      return next;
    });
  };

  const handleToggleCheckAll = () => {
    if (visibleSelectableEntries.length === 0) return;
    if (allVisibleUnpaidChecked) {
      setSelectedEntryIds((prev) => {
        const next = new Set(prev);
        for (const e of visibleSelectableEntries) {
          next.delete(e.id);
        }
        return next;
      });
    } else {
      setSelectedEntryIds((prev) => {
        const next = new Set(prev);
        for (const e of visibleSelectableEntries) {
          next.add(e.id);
        }
        return next;
      });
    }
  };

  const handleSelectPeriodRange = (fromStr: string, toStr: string) => {
    if (!fromStr || !toStr) {
      onShowToast('info', 'Veuillez choisir les deux dates « Du » et « au ».');
      return;
    }
    const start = fromStr <= toStr ? fromStr : toStr;
    const end = fromStr <= toStr ? toStr : fromStr;

    const matchingUnpaid = sellerEntriesAllDates.filter((entry) => {
      if (entry.date < start || entry.date > end) return false;
      return getEntryPaymentStatus(entry, paidEntryMap).status === 'unpaid';
    });

    setSelectedEntryIds(new Set(matchingUnpaid.map((e) => e.id)));
    if (matchingUnpaid.length === 0) {
      onShowToast('info', 'Aucun jour non payé sur cette période.');
    }
  };

  const handlePaySelectedDays = () => {
    if (checkedStats.count === 0) return;
    if (checkedStats.distinctEmployeeIds.length > 1) {
      onShowToast(
        'error',
        'Veuillez sélectionner les jours d’un(e) seul(e) vendeur(se) à la fois.'
      );
      return;
    }

    const empId = checkedStats.distinctEmployeeIds[0];
    const emp =
      employees.find((e) => e.id === empId) || {
        id: empId,
        name: checkedStats.entries[0]?.employeeName || 'Vendeur(se)',
        commissionRate: checkedStats.entries[0]?.employeeCommissionRate || 20,
        startDate: checkedStats.entries[0]?.date || '',
        isArchived: false,
        createdAt: 0,
      };

    setPendingClosureAfterPayment(null);
    setPaymentToEdit(null);
    setTargetEmployee(emp);
    setModalCoveredEntries(checkedStats.entries);
    setModalAmountOverride(null);
    setIsPaymentModalOpen(true);
  };

  // Bouton "✓ Payé et clôturer" sur une vendeuse du mois sélectionné
  const handlePayAndCloseMonth = (item: (typeof sellerSummaries)[number]) => {
    const { employee, earnedComm, paidComm, rawRemainingDue, unpaidMonthEntries } = item;

    // Préremplit la sélection avec tous les jours non payés du mois
    setDaysSellerFilter(employee.id);
    setSelectedEntryIds(new Set(unpaidMonthEntries.map((e) => e.id)));

    if (unpaidMonthEntries.length > 0 && rawRemainingDue > 0) {
      const sumUnpaidComm = unpaidMonthEntries.reduce(
        (sum, e) => sum + Math.round(e.employeeCommissionFC || 0),
        0
      );
      const suggestedAmt =
        rawRemainingDue < sumUnpaidComm ? Math.max(0, Math.round(rawRemainingDue)) : sumUnpaidComm;

      setPendingClosureAfterPayment({
        employee,
        month: selectedMonth,
        earnedComm,
        priorPaidComm: paidComm,
      });
      setPaymentToEdit(null);
      setTargetEmployee(employee);
      setModalCoveredEntries(unpaidMonthEntries);
      setModalAmountOverride(suggestedAmt);
      setIsPaymentModalOpen(true);
      return;
    }

    // Aucun jour non payé restant à payer (ou solde <= 0) : confirmation directe de clôture
    setClosureConfirmTarget({
      employee,
      month: selectedMonth,
      remainingFC: Math.max(0, Math.round(rawRemainingDue)),
    });
  };

  const persistMonthClosure = async (
    employee: Employee,
    month: string,
    forgivenFC: number
  ) => {
    try {
      const currentSettings = (await db.settings.get('app_settings')) || settings;
      const updatedClosures = upsertSellerMonthClosure(currentSettings.payrollClosures, {
        employeeId: employee.id,
        month,
        closedAt: Date.now(),
        forgivenFC: forgivenFC > 0 ? forgivenFC : undefined,
      });
      const updatedSettings: AppSettings = {
        ...currentSettings,
        payrollClosures: updatedClosures,
      };
      await db.settings.put(updatedSettings);
      onSettingsUpdated?.(updatedSettings);
      setClosureConfirmTarget(null);
      onPaymentsChanged();
      onShowToast(
        'success',
        `Mois de ${formatMonthName(month)} clôturé pour ${employee.name}.`
      );
    } catch (err: any) {
      onShowToast('error', 'Erreur lors de la clôture : ' + err.message);
    }
  };

  const handleGeneratePaymentPDF = async (payment: Payment) => {
    setGeneratingPdfId(payment.id);
    try {
      const emp: Employee =
        employees.find((e) => e.id === payment.employeeId) || {
          id: payment.employeeId,
          name: payment.employeeName,
          commissionRate: 20,
          startDate: payment.date,
          isArchived: false,
          createdAt: 0,
        };
      await generatePaymentByDaysPDF(
        {
          employee: emp,
          payment,
          dailyEntries,
          settings,
        },
        'download'
      );
    } catch (err: any) {
      onShowToast('error', 'Erreur lors de la génération de la fiche : ' + err.message);
    } finally {
      setGeneratingPdfId(null);
    }
  };

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

  const renderPaymentCard = (p: Payment, showMonthShare = false) => {
    const hasCoveredDays = Array.isArray(p.coveredItems) && p.coveredItems.length > 0;
    const typeLabel = formatPaymentTypeLabel(p.paymentType);
    const typeColor =
      p.paymentType === 'advance'
        ? 'bg-amber-100 text-amber-800 border-amber-200'
        : p.paymentType === 'final'
        ? 'bg-indigo-100 text-indigo-800 border-indigo-200'
        : p.paymentType === 'by_days'
        ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
        : 'bg-teal-100 text-teal-800 border-teal-200';

    const monthShareFC = showMonthShare ? getPaymentShareForMonth(p, selectedMonth) : p.amountFC;
    const isProratedAcrossMonths =
      showMonthShare && hasCoveredDays && monthShareFC !== p.amountFC;

    return (
      <div
        key={p.id}
        className="p-3.5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs flex flex-col gap-2.5 text-xs"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-slate-900">{formatDateWithTime(p.date, p.time)}</span>
              <span className="font-extrabold text-teal-900 bg-teal-50 px-2 py-0.5 rounded-md border border-teal-200/60">
                {p.employeeName}
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${typeColor}`}>
                {typeLabel}
              </span>
              {p.paymentMode && (
                <span className="text-[10px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                  {formatPaymentModeLabel(p.paymentMode)}
                </span>
              )}
            </div>

            {hasCoveredDays && p.periodFrom && p.periodTo && (
              <p className="text-[11px] text-slate-600 font-medium mt-1">
                {p.periodFrom === p.periodTo
                  ? `Jour payé : ${formatDate(p.periodFrom)}`
                  : `Période : du ${formatDate(p.periodFrom)} au ${formatDate(p.periodTo)}`}{' '}
                ({p.coveredItems!.length} {p.coveredItems!.length > 1 ? 'jours' : 'jour'})
              </p>
            )}

            {isProratedAcrossMonths && (
              <p className="text-[11px] text-teal-800 font-semibold mt-0.5 font-mono">
                Part pour {formatMonthName(selectedMonth)} : {formatFC(monthShareFC, currency)}
              </p>
            )}

            {p.notes && (
              <p className="text-[11px] text-slate-500 italic mt-1 truncate">« {p.notes} »</p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="font-black font-mono text-sm text-slate-900">
              {formatFC(p.amountFC, currency)}
            </span>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  const emp = employees.find((e) => e.id === p.employeeId) || null;
                  setPendingClosureAfterPayment(null);
                  setModalCoveredEntries(null);
                  setModalAmountOverride(null);
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

        {hasCoveredDays && (
          <div className="pt-2 border-t border-slate-100 flex items-center justify-end">
            <button
              type="button"
              disabled={generatingPdfId === p.id}
              onClick={() => handleGeneratePaymentPDF(p)}
              className="px-3 py-1.5 rounded-xl bg-teal-50 hover:bg-teal-100 disabled:opacity-50 text-teal-800 border border-teal-200 font-bold text-[11px] inline-flex items-center gap-1.5 active:scale-95 transition-all min-h-[34px]"
            >
              <FileDown className="w-3.5 h-3.5 text-teal-700" />
              <span>Fiche de paiement</span>
            </button>
          </div>
        )}
      </div>
    );
  };

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

        {/* Onglets : Par mois | Par jours */}
        <div className="px-5 py-2.5 bg-white border-b border-slate-200/80">
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-2xl">
            <button
              type="button"
              onClick={() => setActiveTab('month')}
              className={`py-2 px-3 rounded-xl text-xs font-extrabold transition-all min-h-[38px] ${
                activeTab === 'month'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Par mois
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('days')}
              className={`py-2 px-3 rounded-xl text-xs font-extrabold transition-all min-h-[38px] ${
                activeTab === 'days'
                  ? 'bg-white text-teal-800 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Par jours
            </button>
          </div>
        </div>

        {/* ================================================================= */}
        {/* ONGLET 1 : PAR MOIS (existant conservé + prorata + clôture)       */}
        {/* ================================================================= */}
        {activeTab === 'month' && (
          <>
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
                    setPendingClosureAfterPayment(null);
                    setModalCoveredEntries(null);
                    setModalAmountOverride(null);
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
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-extrabold text-slate-900 text-sm">
                              {item.employee.name}
                            </span>
                            {item.isClosed && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Clôturé</span>
                              </span>
                            )}
                            {!item.isClosed && item.remainingDue <= 0 && item.earnedComm > 0 && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Réglé</span>
                              </span>
                            )}
                            {!item.isClosed && item.remainingDue > 0 && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md">
                                <AlertCircle className="w-3 h-3" />
                                <span>À payer</span>
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-[11px] font-mono text-slate-500 flex-wrap">
                            <span>
                              Gagné :{' '}
                              <strong className="text-slate-800">
                                {formatFC(item.earnedComm, currency)}
                              </strong>
                            </span>
                            <span>·</span>
                            <span>
                              Payé :{' '}
                              <strong className="text-slate-800">
                                {formatFC(item.paidComm, currency)}
                              </strong>{' '}
                              ({item.paymentsCount})
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-2 pt-1 sm:pt-0 border-t sm:border-t-0 border-slate-100 flex-wrap">
                          <div className="text-right mr-1">
                            <span className="text-[10px] text-slate-400 block font-sans uppercase">
                              Reste dû
                            </span>
                            <span
                              className={`font-black font-mono text-sm ${
                                item.remainingDue > 0 ? 'text-amber-700' : 'text-slate-700'
                              }`}
                            >
                              {formatFC(item.remainingDue, currency)}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setPendingClosureAfterPayment(null);
                                setModalCoveredEntries(null);
                                setModalAmountOverride(null);
                                setPaymentToEdit(null);
                                setTargetEmployee(item.employee);
                                setIsPaymentModalOpen(true);
                              }}
                              className="px-2.5 py-1.5 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 font-bold text-xs shadow-2xs active:scale-95 transition-all flex items-center gap-1 min-h-[34px]"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Payer</span>
                            </button>

                            {!item.isClosed &&
                              (item.unpaidMonthEntries.length > 0 || item.rawRemainingDue > 0) && (
                                <button
                                  type="button"
                                  onClick={() => handlePayAndCloseMonth(item)}
                                  className="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-2xs active:scale-95 transition-all flex items-center gap-1 min-h-[34px]"
                                >
                                  <Check className="w-3 h-3" />
                                  <span>Payé et clôturer</span>
                                </button>
                              )}
                          </div>
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
                        setPendingClosureAfterPayment(null);
                        setModalCoveredEntries(null);
                        setModalAmountOverride(null);
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
                    {monthPayments.map((p) => renderPaymentCard(p, true))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ================================================================= */}
        {/* ONGLET 2 : PAR JOURS                                              */}
        {/* ================================================================= */}
        {activeTab === 'days' && (
          <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
            {/* Barre de filtres : Vendeuse + Non payés / Tous */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Vendeur(se)
                </label>
                <select
                  value={daysSellerFilter}
                  onChange={(e) => {
                    setDaysSellerFilter(e.target.value);
                    setSelectedEntryIds(new Set());
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 min-h-[40px]"
                >
                  <option value="all">Toutes</option>
                  {selectableSellers.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Statut des jours
                </label>
                <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setDaysStatusFilter('unpaid')}
                    className={`py-1.5 px-2.5 rounded-lg text-xs font-bold transition-all min-h-[32px] ${
                      daysStatusFilter === 'unpaid'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Non payés
                  </button>
                  <button
                    type="button"
                    onClick={() => setDaysStatusFilter('all')}
                    className={`py-1.5 px-2.5 rounded-lg text-xs font-bold transition-all min-h-[32px] ${
                      daysStatusFilter === 'all'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Tous
                  </button>
                </div>
              </div>
            </div>

            {/* Sélection par période : Du [date] au [date] + Tout cocher */}
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2.5 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 items-end">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                    Du
                  </label>
                  <input
                    type="date"
                    value={rangeFrom}
                    onChange={(e) => {
                      const val = e.target.value;
                      setRangeFrom(val);
                      if (val && rangeTo) {
                        handleSelectPeriodRange(val, rangeTo);
                      }
                    }}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-white min-h-[36px]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                    au
                  </label>
                  <input
                    type="date"
                    value={rangeTo}
                    onChange={(e) => {
                      const val = e.target.value;
                      setRangeTo(val);
                      if (rangeFrom && val) {
                        handleSelectPeriodRange(rangeFrom, val);
                      }
                    }}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-white min-h-[36px]"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleSelectPeriodRange(rangeFrom, rangeTo)}
                    className="flex-1 py-2 px-2.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold text-[11px] min-h-[36px] flex items-center justify-center gap-1"
                  >
                    <Calendar className="w-3.5 h-3.5 text-teal-700" />
                    <span>Période</span>
                  </button>
                  <button
                    type="button"
                    disabled={visibleSelectableEntries.length === 0}
                    onClick={handleToggleCheckAll}
                    className="flex-1 py-2 px-2.5 rounded-xl bg-teal-50 hover:bg-teal-100 disabled:opacity-50 border border-teal-200 text-teal-800 font-bold text-[11px] min-h-[36px]"
                  >
                    {allVisibleUnpaidChecked ? 'Tout décocher' : 'Tout cocher'}
                  </button>
                </div>
              </div>
            </div>

            {/* Compteur en direct + bouton "Payer ces jours" */}
            <div className="p-3.5 rounded-2xl bg-teal-900 text-white shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
              <div>
                <span className="font-extrabold text-sm font-mono block">
                  Total à payer : {formatFC(checkedStats.totalCommissionFC, currency)} pour{' '}
                  {checkedStats.count} {checkedStats.count > 1 ? 'jours' : 'jour'}
                </span>
                {checkedStats.distinctEmployeeIds.length > 1 && (
                  <span className="text-[11px] text-amber-200 font-semibold block mt-0.5">
                    Veuillez ne cocher que les jours d’un(e) seul(e) vendeur(se) à la fois.
                  </span>
                )}
              </div>

              <button
                type="button"
                disabled={
                  checkedStats.count === 0 || checkedStats.distinctEmployeeIds.length > 1
                }
                onClick={handlePaySelectedDays}
                className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-45 text-white font-extrabold text-xs shadow-xs active:scale-95 transition-all shrink-0 min-h-[40px]"
              >
                Payer ces jours
              </button>
            </div>

            {/* Liste des saisies du plus récent au plus ancien sur TOUTES les dates */}
            {displayedDayRows.length === 0 ? (
              <div className="p-6 text-center rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-xs text-slate-500">
                {daysStatusFilter === 'unpaid'
                  ? 'Aucun jour non payé pour ce filtre.'
                  : 'Aucune saisie enregistrée pour ce filtre.'}
              </div>
            ) : (
              <div className="space-y-2">
                {displayedDayRows.map(({ entry, dayStatus }) => {
                  const isUnpaid = dayStatus.status === 'unpaid';
                  const isIncomplete = dayStatus.status === 'incomplete';
                  const isPaid = dayStatus.status === 'paid';
                  const isChecked = isUnpaid && selectedEntryIds.has(entry.id);
                  const deliveryReturnLabel = formatDeliveryReturnTimes(
                    entry.deliveryTime,
                    entry.returnTime
                  );

                  return (
                    <div
                      key={entry.id}
                      onClick={() => {
                        if (isUnpaid) handleToggleEntryCheck(entry);
                      }}
                      className={`p-3 rounded-2xl border flex items-center justify-between gap-3 text-xs transition-all ${
                        isIncomplete
                          ? 'bg-slate-100/80 border-slate-200 opacity-60 cursor-not-allowed'
                          : isPaid
                          ? 'bg-white border-slate-200/80'
                          : isChecked
                          ? 'bg-teal-50/70 border-teal-400 cursor-pointer shadow-2xs'
                          : 'bg-white border-slate-200/90 hover:border-teal-300 cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={!isUnpaid}
                          onChange={() => handleToggleEntryCheck(entry)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Sélectionner la journée du ${formatDate(entry.date)}`}
                          className="w-4 h-4 rounded accent-teal-700 disabled:opacity-40 shrink-0"
                        />

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-extrabold text-slate-900">
                              {formatDateWithTime(entry.date, entry.time)}
                            </span>
                            {daysSellerFilter === 'all' && (
                              <span className="text-[11px] font-bold text-teal-900 bg-teal-50 px-2 py-0.5 rounded-md border border-teal-200/60">
                                {entry.employeeName}
                              </span>
                            )}
                          </div>
                          {deliveryReturnLabel && (
                            <p className="text-[10px] font-semibold text-slate-500 font-mono mt-0.5">
                              {deliveryReturnLabel}
                            </p>
                          )}
                          <div className="flex items-center gap-2.5 mt-0.5 text-[11px] font-mono text-slate-600 flex-wrap">
                            <span>
                              Ventes :{' '}
                              <strong className="text-slate-800">
                                {formatFC(entry.totalSalesFC, currency)}
                              </strong>
                            </span>
                            <span>·</span>
                            <span>
                              Commission :{' '}
                              <strong className="text-teal-800">
                                {formatFC(entry.employeeCommissionFC, currency)}
                              </strong>
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        {isUnpaid && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                            Non payé
                          </span>
                        )}
                        {isPaid && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 font-mono">
                            Payé le {formatShortDayMonth(dayStatus.payment.date)} –{' '}
                            {formatFC(dayStatus.coveredItem.commissionFC, currency)}
                          </span>
                        )}
                        {isIncomplete && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-200 text-slate-600 border border-slate-300">
                            À compléter
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Paiements par jours enregistrés (accès direct à "Fiche de paiement", édition et suppression) */}
            {recordedDayPayments.length > 0 && (
              <div className="space-y-2.5 pt-3 border-t border-slate-200/80">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <Receipt className="w-3.5 h-3.5 text-teal-700" />
                  <span>Paiements par jours enregistrés ({recordedDayPayments.length})</span>
                </h3>
                <div className="space-y-2">
                  {recordedDayPayments.map((p) => renderPaymentCard(p, false))}
                </div>
              </div>
            )}
          </div>
        )}

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

      {/* PaymentModal (Ajout / Modification / Paiement par jours) */}
      <PaymentModal
        isOpen={isPaymentModalOpen}
        employee={targetEmployee}
        employees={employees}
        initialMonth={selectedMonth}
        paymentToEdit={paymentToEdit}
        coveredEntries={modalCoveredEntries}
        defaultAmountOverride={modalAmountOverride}
        currency={currency}
        onClose={() => {
          setIsPaymentModalOpen(false);
          setPaymentToEdit(null);
          setTargetEmployee(null);
          setModalCoveredEntries(null);
          setModalAmountOverride(null);
          setPendingClosureAfterPayment(null);
        }}
        onPaymentSaved={(savedPayment) => {
          const isEditing = Boolean(paymentToEdit);
          const closureCtx = pendingClosureAfterPayment;

          setSelectedEntryIds(new Set());
          setModalCoveredEntries(null);
          setModalAmountOverride(null);
          setPendingClosureAfterPayment(null);
          onPaymentsChanged();

          if (closureCtx && savedPayment) {
            const addedForMonth = getPaymentShareForMonth(savedPayment, closureCtx.month);
            const newRemaining = Math.round(
              closureCtx.earnedComm - (closureCtx.priorPaidComm + addedForMonth)
            );
            if (newRemaining > 0) {
              setClosureConfirmTarget({
                employee: closureCtx.employee,
                month: closureCtx.month,
                remainingFC: newRemaining,
              });
              return;
            }
            void persistMonthClosure(closureCtx.employee, closureCtx.month, 0);
            return;
          }

          onShowToast(
            'success',
            isEditing ? 'Paiement modifié avec succès.' : 'Paiement enregistré avec succès.'
          );
        }}
      />

      {/* Confirmation de clôture mensuelle (annulation du reste éventuel) */}
      <ConfirmModal
        isOpen={Boolean(closureConfirmTarget)}
        title={`Clôturer ${
          closureConfirmTarget ? formatMonthName(closureConfirmTarget.month) : ''
        } ?`}
        message={
          closureConfirmTarget && closureConfirmTarget.remainingFC > 0
            ? `Il reste ${formatFC(
                closureConfirmTarget.remainingFC,
                currency
              )} non versé pour ${
                closureConfirmTarget.employee.name
              } sur ${formatMonthName(
                closureConfirmTarget.month
              )}. Confirmez-vous l’annulation de ce reste éventuel et la clôture du mois ?`
            : `Confirmez-vous la clôture du mois de ${
                closureConfirmTarget ? formatMonthName(closureConfirmTarget.month) : ''
              } pour ${closureConfirmTarget?.employee.name || ''} ?`
        }
        confirmLabel="Clôturer le mois"
        cancelLabel="Annuler"
        isDanger={false}
        requirePin={false}
        onConfirm={() => {
          if (closureConfirmTarget) {
            void persistMonthClosure(
              closureConfirmTarget.employee,
              closureConfirmTarget.month,
              closureConfirmTarget.remainingFC
            );
          }
        }}
        onCancel={() => setClosureConfirmTarget(null)}
      />

      {/* Delete Payment Confirm (protégée par code PIN via isDanger={true}) */}
      <ConfirmModal
        isOpen={Boolean(paymentToDelete)}
        title="Supprimer ce versement ?"
        message={`Voulez-vous supprimer le versement de ${formatFC(
          paymentToDelete?.amountFC,
          currency
        )} effectué le ${formatDateWithTime(
          paymentToDelete?.date,
          paymentToDelete?.time
        )} pour ${
          paymentToDelete?.employeeName
        } ? Les jours éventuellement couverts redeviendront « Non payés ».`}
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        isDanger={true}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setPaymentToDelete(null)}
      />
    </div>
  );
};
