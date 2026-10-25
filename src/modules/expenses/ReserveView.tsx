import React, { useState, useEffect, useMemo } from 'react';
import {
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  Plus,
  Minus,
  Calendar,
  Edit2,
  Trash2,
  X,
  AlertTriangle,
  Clock,
  UserCheck,
  ArrowLeft,
  Receipt,
  RotateCcw,
  Users,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { db } from '../../db/db';
import {
  formatDate,
  formatFC,
  toISODate,
  toISOMonth,
  formatMonthName,
  parseLocaleNumber,
  formatNumber,
  getDateRangeForFilter,
} from '../../utils/formatters';
import { ConfirmModal } from '../../components/ConfirmModal';
import {
  calculateReserveBalance,
  calculatePeriodReserveSummary,
  getBeneficesBalanceAtDate,
  type ReserveDetails,
  type PeriodReserveSummary,
} from '../../utils/reserveCalculator';
import { computeDebtAllocations } from '../../utils/debtCalculator';
import {
  computeOwnerProfitStats,
  computeBeneficesOutflowsForRange,
} from '../dashboard/OwnerProfitView';
import { PaymentsHistoryModal } from '../employees/PaymentsHistoryModal';
import type {
  ReserveMovement,
  DailyEntry,
  Expense,
  AppSettings,
  PersonalSale,
  Payment,
  Employee,
  DebtPayment,
} from '../../types';

interface ReserveViewProps {
  settings: AppSettings;
  onSettingsUpdated?: (newSettings: AppSettings) => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
  onBack?: () => void;
  initialPrefill?: { amount: number; reason: string; source?: 'personnel' | 'benefices' } | null;
  onClearPrefill?: () => void;
}

export const ReserveView: React.FC<ReserveViewProps> = ({
  settings,
  onSettingsUpdated,
  onShowToast,
  onBack,
  initialPrefill,
  onClearPrefill,
}) => {
  const [movements, setMovements] = useState<ReserveMovement[]>([]);
  const [dailyEntries, setDailyEntries] = useState<DailyEntry[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [personalSales, setPersonalSales] = useState<PersonalSale[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [debtPayments, setDebtPayments] = useState<DebtPayment[]>([]);

  // Sub-screen for payments history
  const [isPaymentsHistoryOpen, setIsPaymentsHistoryOpen] = useState(false);
  const [selectedPaymentsMonth, setSelectedPaymentsMonth] = useState<string>(toISOMonth(new Date()));

  // Active caisse tab for movement history ('reserve' | 'benefices')
  const [historyTab, setHistoryTab] = useState<'reserve' | 'benefices'>('reserve');

  // Form modal state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formCaisse, setFormCaisse] = useState<'reserve' | 'benefices'>('reserve');
  const [formType, setFormType] = useState<'ajout' | 'retrait'>('ajout');
  const [formSource, setFormSource] = useState<'personnel' | 'benefices'>('personnel');
  const [editingMovement, setEditingMovement] = useState<ReserveMovement | null>(null);

  const [date, setDate] = useState(toISODate(new Date()));
  const [amount, setAmount] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [formError, setFormError] = useState<string>('');

  // Delete modal state
  const [movementToDelete, setMovementToDelete] = useState<ReserveMovement | null>(null);

  const currency = settings.currency || 'FC';
  const reserveRate = settings.expenseReservePct || 50;
  const todayStr = toISODate(new Date());

  // Consultation mode: date selection ("Voir la caisse au") & period ("Du / Au")
  const [viewDate, setViewDate] = useState<string>(todayStr);
  const [isPeriodOpen, setIsPeriodOpen] = useState(false);
  const [periodStart, setPeriodStart] = useState<string>(() => {
    const d = new Date();
    d.setDate(1);
    return toISODate(d);
  });
  const [periodEnd, setPeriodEnd] = useState<string>(todayStr);

  const isAsOfOtherDate = Boolean(viewDate && viewDate !== todayStr && !isPeriodOpen);

  useEffect(() => {
    loadData();
  }, []);

  // Handle external prefill from red banner clicks
  useEffect(() => {
    if (initialPrefill) {
      setEditingMovement(null);
      setFormCaisse('reserve');
      setFormType('ajout');
      setFormSource(initialPrefill.source || 'personnel');
      setDate(toISODate(new Date()));
      setAmount(formatNumber(initialPrefill.amount));
      setReason(initialPrefill.reason);
      setFormError('');
      setIsFormOpen(true);
      onClearPrefill?.();
    }
  }, [initialPrefill, onClearPrefill]);

  const loadData = async () => {
    try {
      const [movs, entries, exps, pSales, pays, emps, dPays] = await Promise.all([
        db.reserveMovements.orderBy('date').reverse().toArray(),
        db.dailyEntries.toArray(),
        db.expenses.toArray(),
        db.personalSales.toArray(),
        db.payments.toArray(),
        db.employees.toArray(),
        db.debtPayments.toArray(),
      ]);
      setMovements(movs);
      setDailyEntries(entries);
      setExpenses(exps);
      setPersonalSales(pSales);
      setPayments(pays);
      setEmployees(emps);
      setDebtPayments(dPays);
    } catch (e: any) {
      console.error('Erreur chargement caisse:', e);
      onShowToast('error', 'Erreur chargement des données de la caisse');
    }
  };

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

  // Real-time calculation of the 3 caisses
  const reserveDetails: ReserveDetails = calculateReserveBalance(
    movements,
    dailyEntries,
    expenses,
    reserveRate,
    startingPoint,
    isAsOfOtherDate ? viewDate : null,
    personalSales,
    payments,
    employees,
    debtPayments
  );

  // Period summary calculation
  const periodSummary: PeriodReserveSummary = calculatePeriodReserveSummary(
    movements,
    dailyEntries,
    expenses,
    periodStart || todayStr,
    periodEnd || todayStr,
    reserveRate,
    startingPoint,
    personalSales,
    payments,
    employees,
    debtPayments
  );

  // Bénéfice gagné ce mois-ci (même calcul que "Mon Bénéfice" pour "Ce mois") et retraits du mois
  const currentMonthBeneficesInfo = useMemo(() => {
    const curMonthRange = getDateRangeForFilter('this_month');
    const debtData = computeDebtAllocations(
      personalSales,
      debtPayments,
      reserveRate,
      [],
      settings.debtReminderDays ?? 2
    );
    const monthProfit = computeOwnerProfitStats({
      startDate: curMonthRange.startDate,
      endDate: curMonthRange.endDate,
      dailyEntries,
      personalSales,
      paymentAllocations: debtData.paymentAllocations,
      totalRemainingDebtFC: debtData.totalRemainingFC,
      employees,
      reserveRate,
      caisseStartDate: settings.caisseStartDate,
      closedMonths: reserveDetails.closedMonths,
    });
    const outflows = computeBeneficesOutflowsForRange(
      movements,
      curMonthRange.startDate,
      curMonthRange.endDate
    );
    return {
      earnedFC: monthProfit.totalOwnerShareFC,
      withdrawnFC: outflows.totalOutflowsFC,
    };
  }, [
    personalSales,
    debtPayments,
    reserveRate,
    settings.debtReminderDays,
    settings.caisseStartDate,
    dailyEntries,
    employees,
    reserveDetails.closedMonths,
    movements,
  ]);

  // Rappel de paiement vendeur(se)s (du 25 de chaque mois et pendant les premiers jours du mois suivant)
  const paymentReminder = useMemo(() => {
    const now = new Date();
    const day = now.getDate();
    const curMonth = toISOMonth(now);

    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonth = toISOMonth(prevDate);

    const getRemainingForMonth = (mStr: string) => {
      let earned = 0;
      let paid = 0;
      dailyEntries
        .filter((e) => e.date && e.date.startsWith(mStr))
        .forEach((e) => {
          earned += e.employeeCommissionFC || 0;
        });
      payments
        .filter((p) => p.month === mStr)
        .forEach((p) => {
          paid += p.amountFC || 0;
        });
      return Math.max(0, earned - paid);
    };

    // Premiers jours du mois suivant (1 à 10) : priorité au mois précédent
    if (day <= 10) {
      const remPrev = getRemainingForMonth(prevMonth);
      if (remPrev > 0) {
        return { month: prevMonth, remainingFC: remPrev };
      }
    }

    // À partir du 25 du mois : mois en cours ou mois précédent
    if (day >= 25) {
      const remCur = getRemainingForMonth(curMonth);
      if (remCur > 0) {
        return { month: curMonth, remainingFC: remCur };
      }
      const remPrev = getRemainingForMonth(prevMonth);
      if (remPrev > 0) {
        return { month: prevMonth, remainingFC: remPrev };
      }
    }

    // Si mois précédent non soldé et jour <= 15
    const remPrev = getRemainingForMonth(prevMonth);
    if (day <= 15 && remPrev > 0) {
      return { month: prevMonth, remainingFC: remPrev };
    }

    return null;
  }, [dailyEntries, payments]);

  // Handlers for Réserve operations
  const handleOpenAddReserve = (source: 'personnel' | 'benefices' = 'personnel', prefilledAmt?: number, prefilledReason?: string) => {
    setEditingMovement(null);
    setFormCaisse('reserve');
    setFormType('ajout');
    setFormSource(source);
    setDate(toISODate(new Date()));
    setAmount(prefilledAmt ? formatNumber(prefilledAmt) : '');
    setReason(prefilledReason || '');
    setFormError('');
    setIsFormOpen(true);
  };

  const handleOpenWithdrawReserve = () => {
    setEditingMovement(null);
    setFormCaisse('reserve');
    setFormType('retrait');
    setDate(toISODate(new Date()));
    setAmount('');
    setReason('');
    setFormError('');
    setIsFormOpen(true);
  };

  // Handler for Bénéfices operations
  const handleOpenWithdrawBenefices = () => {
    setEditingMovement(null);
    setFormCaisse('benefices');
    setFormType('retrait');
    setDate(toISODate(new Date()));
    setAmount('');
    setReason('');
    setFormError('');
    setIsFormOpen(true);
  };

  // Handler for editing an existing movement
  const handleOpenEdit = (mov: ReserveMovement) => {
    setEditingMovement(mov);
    setFormCaisse(mov.caisse || 'reserve');
    setFormType(mov.type);
    setFormSource(mov.source || 'personnel');
    setDate(mov.date);
    setAmount(formatNumber(mov.amountFC));
    setReason(mov.reason || '');
    setFormError('');
    setIsFormOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const numAmount = parseLocaleNumber(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setFormError('Veuillez entrer un montant positif supérieur à 0 FC.');
      return;
    }

    if (!reason.trim()) {
      setFormError('Veuillez indiquer un motif pour ce mouvement.');
      return;
    }

    // Si ajout à la réserve pris sur les bénéfices OU retrait des bénéfices :
    // Refuser si numAmount > solde disponible des bénéfices à cette date
    if (
      (formCaisse === 'reserve' && formType === 'ajout' && formSource === 'benefices') ||
      (formCaisse === 'benefices' && formType === 'retrait')
    ) {
      const beneficesDispo = getBeneficesBalanceAtDate(
        movements,
        dailyEntries,
        expenses,
        reserveRate,
        date,
        editingMovement?.id,
        startingPoint,
        personalSales,
        payments,
        employees,
        debtPayments
      );

      if (numAmount > beneficesDispo) {
        setFormError(
          `Montant non disponible : le solde de la Caisse Bénéfices personnels à cette date est de ${formatFC(
            beneficesDispo,
            currency
          )}. Vous ne pouvez pas prélever plus que ce solde.`
        );
        return;
      }
    }

    try {
      if (editingMovement) {
        const updated: ReserveMovement = {
          ...editingMovement,
          date,
          amountFC: Math.round(numAmount),
          type: formType,
          caisse: formCaisse,
          source: formCaisse === 'reserve' && formType === 'ajout' ? formSource : undefined,
          reason: reason.trim(),
        };
        await db.reserveMovements.put(updated);
        onShowToast('success', 'Mouvement modifié avec succès.');
      } else {
        const newMov: ReserveMovement = {
          id: 'res_' + Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5),
          date,
          amountFC: Math.round(numAmount),
          type: formType,
          caisse: formCaisse,
          source: formCaisse === 'reserve' && formType === 'ajout' ? formSource : undefined,
          reason: reason.trim(),
          createdAt: Date.now(),
        };
        await db.reserveMovements.add(newMov);

        if (formCaisse === 'reserve') {
          if (formType === 'ajout') {
            onShowToast(
              'success',
              formSource === 'benefices'
                ? 'Transfert de vos bénéfices vers la Réserve enregistré.'
                : 'Ajout de votre argent personnel à la Réserve enregistré.'
            );
          } else {
            onShowToast('success', 'Retrait de la Réserve enregistré.');
          }
        } else {
          onShowToast('success', 'Retrait de vos bénéfices personnels enregistré.');
        }
      }

      setIsFormOpen(false);
      await loadData();
    } catch (err: any) {
      setFormError('Erreur lors de l’enregistrement : ' + err.message);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!movementToDelete) return;
    try {
      await db.reserveMovements.delete(movementToDelete.id);
      setMovementToDelete(null);
      await loadData();
      onShowToast('info', 'Mouvement supprimé.');
    } catch (err: any) {
      onShowToast('error', 'Erreur suppression : ' + err.message);
    }
  };

  return (
    <div className="pb-28 pt-3 px-4 max-w-lg mx-auto space-y-4">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Retour"
              className="p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 active:scale-95 transition-all min-h-[44px] min-w-[44px] flex items-center justify-center -ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          )}
          <div>
            <h2 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
              <Wallet className="w-5 h-5 text-teal-700" />
              <span>Caisse</span>
            </h2>
            <p className="text-xs text-slate-500 font-medium">
              Caisse Réserve, Bénéfices personnels et Caisse Vendeurs en temps réel
            </p>
          </div>
        </div>
      </div>

      {/* SÉLECTEUR DE DATE ET PÉRIODE */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-3 shadow-2xs space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          {/* Champ date : Voir la caisse au */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-slate-700 whitespace-nowrap">Voir la caisse au :</span>
            <input
              type="date"
              value={viewDate}
              onChange={(e) => {
                setViewDate(e.target.value);
                setIsPeriodOpen(false);
              }}
              className="px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 bg-slate-50 focus:bg-white focus:outline-teal-700"
            />
            <button
              type="button"
              onClick={() => {
                setViewDate(todayStr);
                setIsPeriodOpen(false);
              }}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                viewDate === todayStr && !isPeriodOpen
                  ? 'bg-teal-700 text-white shadow-2xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              Aujourd’hui
            </button>
          </div>

          {/* Bouton Voir une période */}
          <button
            type="button"
            onClick={() => setIsPeriodOpen(!isPeriodOpen)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              isPeriodOpen ? 'bg-slate-900 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            {isPeriodOpen ? 'Fermer la période' : 'Voir une période'}
          </button>
        </div>

        {/* Bandeau d'état à une date précise */}
        {isAsOfOtherDate && (
          <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-amber-700 shrink-0" />
              <span>État au {formatDate(viewDate)} (lecture seule)</span>
            </span>
            <button
              type="button"
              onClick={() => setViewDate(todayStr)}
              className="text-[11px] underline text-amber-800 hover:text-amber-950 font-bold"
            >
              Revenir au temps réel
            </button>
          </div>
        )}

        {/* Période Du / Au */}
        {isPeriodOpen && (
          <div className="pt-2 border-t border-slate-100 space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Du :</label>
                <input
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 bg-slate-50 focus:bg-white focus:outline-teal-700"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Au :</label>
                <input
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 bg-slate-50 focus:bg-white focus:outline-teal-700"
                />
              </div>
            </div>

            {/* Résumé des 3 caisses sur la période */}
            <div className="space-y-2.5 pt-1">
              <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center justify-between">
                <span>Période du {formatDate(periodSummary.startDate)} au {formatDate(periodSummary.endDate)}</span>
                <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded font-mono">Lecture seule</span>
              </div>

              {/* 1. Caisse Réserve */}
              <div className="p-3 rounded-2xl bg-teal-50/70 border border-teal-200 text-xs space-y-1.5">
                <span className="font-extrabold text-teal-900 block text-xs uppercase">
                  Caisse Réserve (Période)
                </span>
                <div className="space-y-1 font-mono text-[11px] text-teal-950">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 font-sans">Solde au début :</span>
                    <span className="font-bold">{formatFC(periodSummary.reserveStartFC, currency)}</span>
                  </div>
                  <div className="flex items-center justify-between text-teal-800">
                    <span className="font-sans">+ {reserveRate} % des ventes :</span>
                    <span className="font-bold">+{formatFC(periodSummary.reserveSalesAddFC, currency)}</span>
                  </div>
                  <div className="flex items-center justify-between text-teal-800">
                    <span className="font-sans">+ Ajouts / Dépôts :</span>
                    <span className="font-bold">+{formatFC(periodSummary.reserveAdditionsFC, currency)}</span>
                  </div>
                  {periodSummary.reserveConsumptionFC > 0 && (
                    <div className="flex items-center justify-between text-teal-800">
                      <span className="font-sans">+ Ma consommation (payée par bénéfices) :</span>
                      <span className="font-bold">+{formatFC(periodSummary.reserveConsumptionFC, currency)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-rose-700">
                    <span className="font-sans">− Dépenses :</span>
                    <span className="font-bold">−{formatFC(periodSummary.reserveExpensesFC, currency)}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span className="font-sans">− Retraits :</span>
                    <span className="font-bold">−{formatFC(periodSummary.reserveWithdrawalsFC, currency)}</span>
                  </div>
                  <div className="pt-1 border-t border-teal-200 flex items-center justify-between font-extrabold text-xs text-teal-900">
                    <span className="font-sans">= Solde à la fin :</span>
                    <span className={periodSummary.reserveEndFC < 0 ? 'text-rose-700' : ''}>
                      {formatFC(periodSummary.reserveEndFC, currency)}
                    </span>
                  </div>
                </div>
              </div>

              {/* 2. Caisse Bénéfices */}
              <div className="p-3 rounded-2xl bg-emerald-50/70 border border-emerald-200 text-xs space-y-1.5">
                <span className="font-extrabold text-emerald-900 block text-xs uppercase">
                  Caisse Bénéfices personnels (Période)
                </span>
                <div className="space-y-1 font-mono text-[11px] text-emerald-950">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 font-sans">Solde au début :</span>
                    <span className="font-bold">{formatFC(periodSummary.beneficesStartFC, currency)}</span>
                  </div>
                  <div className="flex items-center justify-between text-emerald-800">
                    <span className="font-sans">+ Part sur ventes vendeurs :</span>
                    <span className="font-bold">+{formatFC(periodSummary.beneficesVendeursFC, currency)}</span>
                  </div>
                  <div className="flex items-center justify-between text-emerald-800">
                    <span className="font-sans">+ Part & com. ventes perso :</span>
                    <span className="font-bold">+{formatFC(periodSummary.beneficesPersoFC, currency)}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span className="font-sans">− Retraits personnels :</span>
                    <span className="font-bold">−{formatFC(periodSummary.beneficesWithdrawalsFC, currency)}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span className="font-sans">− Transferts vers la Réserve :</span>
                    <span className="font-bold">−{formatFC(periodSummary.beneficesTransfersFC, currency)}</span>
                  </div>
                  {periodSummary.beneficesConsumptionFC > 0 && (
                    <div className="flex items-center justify-between text-slate-600">
                      <span className="font-sans">− Mes yaourts consommés :</span>
                      <span className="font-bold">−{formatFC(periodSummary.beneficesConsumptionFC, currency)}</span>
                    </div>
                  )}
                  <div className="pt-1 border-t border-emerald-200 flex items-center justify-between font-extrabold text-xs text-emerald-900">
                    <span className="font-sans">= Solde à la fin :</span>
                    <span>{formatFC(periodSummary.beneficesEndFC, currency)}</span>
                  </div>
                </div>
              </div>

              {/* 3. Caisse Vendeurs */}
              <div className="p-3 rounded-2xl bg-indigo-50/70 border border-indigo-200 text-xs space-y-1.5">
                <span className="font-extrabold text-indigo-900 block text-xs uppercase">
                  Caisse Vendeurs (Période)
                </span>
                <div className="space-y-1 font-mono text-[11px] text-indigo-950">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 font-sans">Solde dû au début :</span>
                    <span className="font-bold">{formatFC(periodSummary.vendeursStartFC, currency)}</span>
                  </div>
                  <div className="flex items-center justify-between text-indigo-800">
                    <span className="font-sans">+ Commissions gagnées :</span>
                    <span className="font-bold">+{formatFC(periodSummary.vendeursCommissionsAddFC, currency)}</span>
                  </div>
                  <div className="flex items-center justify-between text-emerald-700">
                    <span className="font-sans">− Paiements versés :</span>
                    <span className="font-bold">−{formatFC(periodSummary.vendeursPaymentsPaidFC, currency)}</span>
                  </div>
                  <div className="pt-1 border-t border-indigo-200 flex items-center justify-between font-extrabold text-xs text-indigo-900">
                    <span className="font-sans">= Reste dû à la fin :</span>
                    <span>{formatFC(periodSummary.vendeursEndFC, currency)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 4. ALERTE ROUGE : si la Réserve est négative */}
      {reserveDetails.soldeReserveFC < 0 && (
        <div className="p-4 rounded-2xl bg-rose-600 text-white shadow-md space-y-2 text-xs">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 shrink-0 text-white mt-0.5" />
            <div>
              <span className="font-extrabold text-sm block">
                Les dépenses dépassent la réserve de {formatFC(reserveDetails.manqueFC, currency)}
              </span>
              <p className="text-[11px] text-rose-100 leading-snug mt-0.5">
                La caisse réserve est en déficit. Choisissez comment combler ce manque :
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => handleOpenAddReserve('personnel', reserveDetails.manqueFC, 'Complément argent personnel')}
              className="flex-1 py-2 px-3 rounded-xl bg-white text-rose-700 font-extrabold hover:bg-rose-50 active:scale-95 transition-all text-xs shadow-xs"
            >
              Ajouter mon argent personnel
            </button>
            <button
              type="button"
              onClick={() => handleOpenAddReserve('benefices', reserveDetails.manqueFC, 'Transfert pris sur mes bénéfices')}
              className="flex-1 py-2 px-3 rounded-xl bg-rose-800 text-white border border-rose-400/50 font-extrabold hover:bg-rose-900 active:scale-95 transition-all text-xs shadow-xs"
            >
              Prendre sur mes bénéfices
            </button>
          </div>
        </div>
      )}

      {/* 5. BANNIÈRE ORANGE DE RAPPEL : paiement des vendeurs recommandé */}
      {paymentReminder && (
        <div className="p-3.5 rounded-2xl bg-amber-500 text-white shadow-md flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <AlertCircle className="w-5 h-5 shrink-0 text-white" />
            <div>
              <span className="font-extrabold block">
                Paiement de {formatMonthName(paymentReminder.month)} recommandé : reste dû{' '}
                {formatFC(paymentReminder.remainingFC, currency)}
              </span>
              <p className="text-[11px] text-amber-100 leading-snug">
                Certains règlements de commissions pour ce mois n'ont pas encore été versés.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedPaymentsMonth(paymentReminder.month);
              setIsPaymentsHistoryOpen(true);
            }}
            className="px-3 py-2 rounded-xl bg-white text-amber-800 font-extrabold hover:bg-amber-50 active:scale-95 transition-all shrink-0 min-h-[38px] text-xs shadow-xs flex items-center gap-1"
          >
            <span>Paiements</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* SECTION POINT DE DÉPART DES CAISSES */}
      <div className="rounded-3xl border border-slate-200/90 bg-white p-4 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-teal-100 text-teal-800 flex items-center justify-center">
              <Wallet className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                Point de départ des caisses
              </h3>
              <p className="text-[11px] text-slate-500">
                Initialiser les soldes à une date de référence
              </p>
            </div>
          </div>

          {settings.caisseStartDate ? (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-mono">
              Actif ({formatDate(settings.caisseStartDate)})
            </span>
          ) : (
            <span className="text-[10px] font-medium text-slate-400">
              Non configuré
            </span>
          )}
        </div>

        {settings.caisseStartDate ? (
          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center font-mono">
              <div>
                <span className="text-[10px] text-slate-400 font-sans block uppercase">Date départ</span>
                <span className="font-extrabold text-slate-900 text-xs">{formatDate(settings.caisseStartDate)}</span>
              </div>
              <div>
                <span className="text-[10px] text-teal-700 font-sans block uppercase">Départ Réserve</span>
                <span className="font-extrabold text-teal-900 text-xs">
                  {formatFC(
                    settings.caisseStartReserveFC ??
                      ((settings.caisseStartNormaleFC ?? 0) + (settings.caisseStartCapitalFC ?? 0)),
                    currency
                  )}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-emerald-700 font-sans block uppercase">Départ Bénéfices</span>
                <span className="font-extrabold text-emerald-900 text-xs">
                  {formatFC(settings.caisseStartBeneficesFC ?? 0, currency)}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-indigo-700 font-sans block uppercase">Départ Vendeurs</span>
                <span className="font-extrabold text-indigo-900 text-xs">
                  {formatFC(settings.caisseStartVendeursFC ?? 0, currency)}
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
              <span className="text-[11px] text-slate-500">
                Événements antérieurs à la date ignorés.
              </span>
              <button
                type="button"
                onClick={async () => {
                  const updated = {
                    ...settings,
                    caisseStartDate: undefined,
                    caisseStartReserveFC: undefined,
                    caisseStartBeneficesFC: undefined,
                    caisseStartVendeursFC: undefined,
                    caisseStartNormaleFC: undefined,
                    caisseStartCapitalFC: undefined,
                  };
                  await db.settings.put(updated);
                  onSettingsUpdated?.(updated);
                  onShowToast('info', 'Point de départ retiré : calcul rétabli sur tout l’historique.');
                }}
                className="px-2.5 py-1 rounded-xl bg-rose-50 text-rose-700 hover:bg-rose-100 font-bold text-xs border border-rose-200 flex items-center gap-1 active:scale-95"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Retirer</span>
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const dateInput = form.elements.namedItem('startDate') as HTMLInputElement;
              const resInput = form.elements.namedItem('startReserve') as HTMLInputElement;
              const benInput = form.elements.namedItem('startBenefices') as HTMLInputElement;
              const venInput = form.elements.namedItem('startVendeurs') as HTMLInputElement;

              const dateVal = dateInput.value.trim();
              if (!dateVal) {
                onShowToast('error', 'Veuillez saisir une date de départ.');
                return;
              }

              const resVal = resInput.value ? parseLocaleNumber(resInput.value) : 0;
              const benVal = benInput.value ? parseLocaleNumber(benInput.value) : 0;
              const venVal = venInput.value ? parseLocaleNumber(venInput.value) : 0;

              const updated = {
                ...settings,
                caisseStartDate: dateVal,
                caisseStartReserveFC: Math.round(resVal),
                caisseStartBeneficesFC: Math.round(benVal),
                caisseStartVendeursFC: Math.round(venVal),
                caisseStartNormaleFC: Math.round(resVal),
                caisseStartCapitalFC: 0,
              };

              await db.settings.put(updated);
              onSettingsUpdated?.(updated);
              onShowToast('success', 'Point de départ enregistré.');
            }}
            className="space-y-2.5"
          >
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-600 mb-0.5">Date départ *</label>
                <input
                  name="startDate"
                  type="date"
                  defaultValue="2026-10-01"
                  required
                  className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-white"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                  Départ Réserve ({currency})
                </label>
                <input
                  name="startReserve"
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-white"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                  Départ Bénéfices ({currency})
                </label>
                <input
                  name="startBenefices"
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-white"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-600 mb-0.5">
                  Départ Vendeurs ({currency})
                </label>
                <input
                  name="startVendeurs"
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end pt-1">
              <button
                type="submit"
                className="px-3.5 py-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs shadow-xs active:scale-95"
              >
                Activer le point de départ
              </button>
            </div>
          </form>
        )}
      </div>

      {/* ======================= LES TROIS CARTES DE CAISSE ======================= */}
      <div className="space-y-3.5">
        {/* CARTE 1 : CAISSE RÉSERVE */}
        <div
          className={`rounded-3xl border-2 p-4 sm:p-5 shadow-2xs space-y-3 transition-all ${
            reserveDetails.soldeReserveFC < 0
              ? 'border-rose-400 bg-rose-50/70'
              : 'border-teal-200 bg-teal-50/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-teal-700 text-white flex items-center justify-center font-bold">
                <Wallet className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-black uppercase tracking-wider text-slate-800 block">
                  Caisse Réserve
                </span>
                <span className="text-[10px] text-slate-500 font-medium">
                  {reserveRate} % des ventes + dépôts − dépenses
                </span>
              </div>
            </div>

            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-md font-mono ${
                reserveDetails.soldeReserveFC < 0
                  ? 'bg-rose-200 text-rose-900'
                  : 'bg-teal-100 text-teal-800'
              }`}
            >
              {reserveDetails.soldeReserveFC < 0 ? 'Déficit' : 'Solde Actif'}
            </span>
          </div>

          <div>
            <span
              className={`text-2xl sm:text-3xl font-black font-mono tracking-tight block ${
                reserveDetails.soldeReserveFC < 0 ? 'text-rose-700' : 'text-teal-950'
              }`}
            >
              {formatFC(reserveDetails.soldeReserveFC, currency)}
            </span>
            {reserveDetails.soldeReserveFC < 0 && (
              <span className="text-xs font-extrabold text-rose-700 block mt-0.5">
                Manque : {formatFC(reserveDetails.manqueFC, currency)}
              </span>
            )}
          </div>

          {/* Boutons d'action Réserve */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => handleOpenAddReserve('personnel')}
              className="py-2.5 px-3 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs shadow-xs active:scale-95 transition-all flex items-center justify-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>+ Ajouter de l'argent</span>
            </button>
            <button
              type="button"
              onClick={handleOpenWithdrawReserve}
              className="py-2.5 px-3 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-bold text-xs shadow-2xs active:scale-95 transition-all flex items-center justify-center gap-1.5"
            >
              <Minus className="w-4 h-4" />
              <span>− Retirer de l'argent</span>
            </button>
          </div>

          {/* Bloc Provenance Réserve */}
          <div className="p-3 rounded-2xl bg-white/80 border border-teal-200/80 space-y-2 text-xs">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-700 block">
              Provenance Réserve (Temps réel)
            </span>

            {/* Entrées */}
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-teal-800 uppercase block">
                Entrées (+{formatFC(reserveDetails.provenanceReserve.totalEntreesFC, currency)}) :
              </span>
              {reserveDetails.provenanceReserve.entrees.length === 0 ? (
                <p className="text-[11px] text-slate-400 italic">Aucune entrée</p>
              ) : (
                <div className="space-y-0.5 font-mono text-[11px]">
                  {reserveDetails.provenanceReserve.entrees.map((ent, idx) => (
                    <div key={idx} className="flex items-center justify-between text-slate-700">
                      <span className="text-slate-600 truncate max-w-[200px]">{ent.label}</span>
                      <span className="font-bold shrink-0">
                        +{formatFC(ent.amountFC, currency)} ({ent.pct.toFixed(1)}%)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Sorties */}
            <div className="space-y-1 pt-1.5 border-t border-slate-100">
              <span className="text-[10px] font-bold text-rose-700 uppercase block">
                Sorties (−{formatFC(reserveDetails.provenanceReserve.totalSortiesFC, currency)}) :
              </span>
              {reserveDetails.provenanceReserve.sorties.length === 0 ? (
                <p className="text-[11px] text-slate-400 italic">Aucune sortie</p>
              ) : (
                <div className="space-y-0.5 font-mono text-[11px]">
                  {reserveDetails.provenanceReserve.sorties.map((sor, idx) => (
                    <div key={idx} className="flex items-center justify-between text-rose-800">
                      <span className="text-slate-600 truncate max-w-[200px]">{sor.label}</span>
                      <span className="font-bold shrink-0">
                        −{formatFC(sor.amountFC, currency)} ({sor.pct.toFixed(1)}%)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* CARTE 2 : CAISSE BÉNÉFICES PERSONNELS */}
        <div className="rounded-3xl border-2 border-emerald-200 bg-emerald-50/40 p-4 sm:p-5 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-700 text-white flex items-center justify-center font-bold">
                <UserCheck className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-black uppercase tracking-wider text-slate-800 block">
                  Caisse Bénéfices personnels
                </span>
                <span className="text-[10px] text-slate-500 font-medium">
                  Part gérant sur ventes − retraits & transferts
                </span>
              </div>
            </div>

            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md font-mono bg-emerald-100 text-emerald-800">
              Argent disponible
            </span>
          </div>

          <div className="space-y-2">
            <div>
              <span className="text-[11px] font-bold text-emerald-800 block mb-0.5">
                Solde total (anciens mois + ce mois)
              </span>
              <span className="text-2xl sm:text-3xl font-black font-mono tracking-tight text-emerald-950 block">
                {formatFC(reserveDetails.soldeBeneficesFC, currency)}
              </span>
              <span className="text-[11px] text-slate-500 block mt-0.5">
                Disponible pour retrait personnel ou pour alimenter la Réserve
              </span>
            </div>

            <div className="p-2.5 rounded-2xl bg-emerald-100/80 border border-emerald-300/80 text-xs space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-extrabold text-emerald-950">
                  Bénéfice gagné ce mois-ci :
                </span>
                <span className="font-black font-mono text-emerald-950 shrink-0">
                  {formatFC(currentMonthBeneficesInfo.earnedFC, currency)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px] text-emerald-800">
                <span className="font-semibold">
                  dont déjà retiré ce mois-ci :
                </span>
                <span className="font-bold font-mono shrink-0">
                  {formatFC(currentMonthBeneficesInfo.withdrawnFC, currency)}
                </span>
              </div>
            </div>
          </div>

          {/* Bouton d'action Bénéfices */}
          <div className="pt-1">
            <button
              type="button"
              onClick={handleOpenWithdrawBenefices}
              disabled={reserveDetails.soldeBeneficesFC <= 0}
              className="w-full py-2.5 px-3 rounded-xl bg-emerald-800 hover:bg-emerald-900 disabled:opacity-50 disabled:pointer-events-none text-white font-bold text-xs shadow-xs active:scale-95 transition-all flex items-center justify-center gap-1.5"
            >
              <Minus className="w-4 h-4" />
              <span>− Retirer de mes bénéfices</span>
            </button>
          </div>

          {/* Bloc Provenance Bénéfices */}
          <div className="p-3 rounded-2xl bg-white/80 border border-emerald-200/80 space-y-2 text-xs">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-700 block">
              Provenance Bénéfices (Temps réel)
            </span>

            {/* Entrées */}
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-emerald-800 uppercase block">
                Entrées (+{formatFC(reserveDetails.provenanceBenefices.totalEntreesFC, currency)}) :
              </span>
              {reserveDetails.provenanceBenefices.entrees.length === 0 ? (
                <p className="text-[11px] text-slate-400 italic">Aucune entrée</p>
              ) : (
                <div className="space-y-0.5 font-mono text-[11px]">
                  {reserveDetails.provenanceBenefices.entrees.map((ent, idx) => (
                    <div key={idx} className="flex items-center justify-between text-slate-700">
                      <span className="text-slate-600 truncate max-w-[200px]">{ent.label}</span>
                      <span className="font-bold shrink-0">
                        +{formatFC(ent.amountFC, currency)} ({ent.pct.toFixed(1)}%)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Sorties */}
            <div className="space-y-1 pt-1.5 border-t border-slate-100">
              <span className="text-[10px] font-bold text-slate-600 uppercase block">
                Sorties (−{formatFC(reserveDetails.provenanceBenefices.totalSortiesFC, currency)}) :
              </span>
              {reserveDetails.provenanceBenefices.sorties.length === 0 ? (
                <p className="text-[11px] text-slate-400 italic">Aucune sortie</p>
              ) : (
                <div className="space-y-0.5 font-mono text-[11px]">
                  {reserveDetails.provenanceBenefices.sorties.map((sor, idx) => (
                    <div key={idx} className="flex items-center justify-between text-slate-700">
                      <span className="text-slate-600 truncate max-w-[200px]">{sor.label}</span>
                      <span className="font-bold shrink-0">
                        −{formatFC(sor.amountFC, currency)} ({sor.pct.toFixed(1)}%)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* CARTE 3 : CAISSE VENDEURS (sous les deux autres) */}
        <div className="rounded-3xl border-2 border-indigo-200 bg-indigo-50/40 p-4 sm:p-5 shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-indigo-700 text-white flex items-center justify-center font-bold">
                <Users className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-black uppercase tracking-wider text-slate-800 block">
                  Caisse Vendeurs
                </span>
                <span className="text-[10px] text-slate-500 font-medium">
                  Commissions gagnées − paiements versés
                </span>
              </div>
            </div>

            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-md font-mono ${
                reserveDetails.soldeVendeursFC > 0
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-emerald-100 text-emerald-800'
              }`}
            >
              {reserveDetails.soldeVendeursFC > 0 ? 'Dû aux vendeurs' : 'À jour'}
            </span>
          </div>

          <div>
            <span className="text-2xl sm:text-3xl font-black font-mono tracking-tight text-indigo-950 block">
              {formatFC(reserveDetails.soldeVendeursFC, currency)}
            </span>
            <span className="text-[11px] text-slate-500 block mt-0.5">
              {reserveDetails.soldeVendeursFC > 0
                ? 'Solde dû aux vendeur(se)s sur leurs commissions'
                : 'Aucune commission en attente de règlement'}
            </span>
          </div>

          {/* Bouton vers l'historique des paiements */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => {
                setSelectedPaymentsMonth(toISOMonth(new Date()));
                setIsPaymentsHistoryOpen(true);
              }}
              className="w-full py-2.5 px-3 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-bold text-xs shadow-xs active:scale-95 transition-all flex items-center justify-center gap-1.5"
            >
              <Receipt className="w-4 h-4" />
              <span>Paiements des vendeur(se)s</span>
            </button>
          </div>

          {/* Bloc Provenance Vendeurs */}
          <div className="p-3 rounded-2xl bg-white/80 border border-indigo-200/80 space-y-2 text-xs">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-700 block">
              Provenance Caisse Vendeurs (Temps réel)
            </span>

            <div className="space-y-1 font-mono text-[11px]">
              <div className="flex items-center justify-between text-slate-600">
                <span>Commissions gagnées (Total) :</span>
                <span className="font-bold text-indigo-900">
                  +{formatFC(reserveDetails.provenanceVendeurs.totalCommissionsFC, currency)}
                </span>
              </div>
              <div className="flex items-center justify-between text-slate-600">
                <span>Paiements versés (Total) :</span>
                <span className="font-bold text-emerald-700">
                  −{formatFC(reserveDetails.provenanceVendeurs.totalPaymentsFC, currency)}
                </span>
              </div>
              <div className="pt-1 border-t border-slate-100 flex items-center justify-between text-slate-800 font-extrabold">
                <span>Reste dû global :</span>
                <span className={reserveDetails.soldeVendeursFC > 0 ? 'text-amber-700' : 'text-slate-700'}>
                  {formatFC(reserveDetails.soldeVendeursFC, currency)}
                </span>
              </div>
            </div>

            {/* Détail par personne */}
            {reserveDetails.provenanceVendeurs.vendeurs.length > 0 && (
              <div className="pt-2 border-t border-slate-100 space-y-1">
                <span className="text-[10px] font-bold text-slate-600 uppercase block">
                  Détail & Reste dû par personne :
                </span>
                <div className="space-y-1 font-mono text-[11px]">
                  {reserveDetails.provenanceVendeurs.vendeurs.map((v) => (
                    <div
                      key={v.employeeId}
                      className="p-1.5 rounded-lg bg-slate-50 flex items-center justify-between"
                    >
                      <div>
                        <span className="font-bold text-slate-900 font-sans block">{v.employeeName}</span>
                        <span className="text-[10px] text-slate-400">
                          Gagné : {formatFC(v.commissionsFC, currency)} · Payé : {formatFC(v.paymentsFC, currency)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span
                          className={`font-black ${
                            v.resteDuFC > 0 ? 'text-amber-700' : 'text-emerald-700'
                          }`}
                        >
                          {v.resteDuFC > 0 ? `Dû : ${formatFC(v.resteDuFC, currency)}` : 'Soldé'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ======================= HISTORIQUE DES MOUVEMENTS ======================= */}
      <div className="rounded-3xl border border-slate-200/90 bg-white p-4 shadow-2xs space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-teal-700" />
            <span>Historique des mouvements de caisse</span>
          </h3>

          {/* Onglets Réserve vs Bénéfices */}
          <div className="flex items-center p-0.5 rounded-xl bg-slate-100 text-xs font-bold">
            <button
              type="button"
              onClick={() => setHistoryTab('reserve')}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                historyTab === 'reserve' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500'
              }`}
            >
              Réserve
            </button>
            <button
              type="button"
              onClick={() => setHistoryTab('benefices')}
              className={`px-2.5 py-1 rounded-lg transition-all ${
                historyTab === 'benefices' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500'
              }`}
            >
              Bénéfices
            </button>
          </div>
        </div>

        {/* Liste des mouvements filtrée */}
        {(() => {
          const list = movements.filter((m) => {
            const c = m.caisse || 'reserve';
            return c === historyTab;
          });

          if (list.length === 0) {
            return (
              <div className="p-5 text-center text-xs text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                Aucun mouvement pour la caisse {historyTab === 'reserve' ? 'Réserve' : 'Bénéfices personnels'}.
              </div>
            );
          }

          return (
            <div className="divide-y divide-slate-100 border border-slate-100 rounded-2xl overflow-hidden text-xs">
              {list.map((mov) => {
                const isAjout = mov.type === 'ajout';
                const isTransferFromBenefices = mov.caisse === 'reserve' && isAjout && mov.source === 'benefices';

                return (
                  <div key={mov.id} className="p-3 flex items-center justify-between gap-3 bg-white">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                          isAjout ? 'bg-teal-100 text-teal-800' : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        {isAjout ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-extrabold text-slate-900">{formatDate(mov.date)}</span>
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                              isAjout ? 'bg-teal-50 text-teal-800' : 'bg-rose-50 text-rose-800'
                            }`}
                          >
                            {isAjout ? 'Ajout' : 'Retrait'}
                          </span>
                          {isTransferFromBenefices && (
                            <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded">
                              Depuis mes bénéfices
                            </span>
                          )}
                          {mov.caisse === 'reserve' && isAjout && mov.source === 'personnel' && (
                            <span className="text-[10px] font-bold bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded">
                              Argent personnel
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 truncate mt-0.5">{mov.reason}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`font-mono font-black text-xs ${
                          isAjout ? 'text-teal-800' : 'text-rose-700'
                        }`}
                      >
                        {isAjout ? '+' : '−'}
                        {formatFC(mov.amountFC, currency)}
                      </span>

                      <button
                        type="button"
                        onClick={() => handleOpenEdit(mov)}
                        className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg min-h-[32px] min-w-[32px] flex items-center justify-center"
                        title="Modifier"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => setMovementToDelete(mov)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-slate-100 rounded-lg min-h-[32px] min-w-[32px] flex items-center justify-center"
                        title="Supprimer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* MODALE D'AJOUT / RETRAIT / MODIFICATION */}
      {isFormOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-200"
        >
          <div className="bg-white rounded-3xl max-w-sm w-full shadow-2xl overflow-hidden">
            {/* Header */}
            <div
              className={`p-4 border-b flex items-center justify-between ${
                formType === 'ajout'
                  ? 'bg-teal-50/70 border-teal-100'
                  : 'bg-rose-50/70 border-rose-100'
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                    formType === 'ajout' ? 'bg-teal-700 text-white' : 'bg-rose-700 text-white'
                  }`}
                >
                  {formType === 'ajout' ? <Plus className="w-5 h-5" /> : <Minus className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {editingMovement
                      ? 'Modifier le mouvement'
                      : formCaisse === 'reserve'
                      ? formType === 'ajout'
                        ? '+ Ajouter à la Réserve'
                        : '− Retirer de la Réserve'
                      : '− Retirer de mes bénéfices'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {formCaisse === 'reserve' ? 'Caisse Réserve' : 'Caisse Bénéfices personnels'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 min-h-[36px] min-w-[36px] flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSave} className="p-5 space-y-4 text-xs">
              {formError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Origine de l'argent (obligatoire si ajout à la Réserve) */}
              {formCaisse === 'reserve' && formType === 'ajout' && (
                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Origine de l'argent *
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormSource('personnel')}
                      className={`p-2 rounded-xl font-bold border text-center transition-all ${
                        formSource === 'personnel'
                          ? 'bg-teal-700 text-white border-teal-700 shadow-2xs'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      Mon argent personnel
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormSource('benefices')}
                      className={`p-2 rounded-xl font-bold border text-center transition-all ${
                        formSource === 'benefices'
                          ? 'bg-emerald-700 text-white border-emerald-700 shadow-2xs'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      Retiré de mes bénéfices
                    </button>
                  </div>
                  {formSource === 'benefices' && (
                    <p className="text-[11px] text-emerald-800 mt-1 font-medium">
                      Solde Bénéfices disponible :{' '}
                      <strong>{formatFC(reserveDetails.soldeBeneficesFC, currency)}</strong>
                    </p>
                  )}
                </div>
              )}

              {/* Montant */}
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Montant ({currency}) *
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Ex : 50 000"
                  required
                  autoFocus
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono text-base font-bold text-slate-900 focus:outline-none focus:border-teal-600"
                />
              </div>

              {/* Date */}
              <div>
                <label className="font-bold text-slate-700 block mb-1">Date *</label>
                <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200">
                  <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                    className="w-full bg-transparent font-medium text-slate-800 text-xs focus:outline-none"
                  />
                </div>
              </div>

              {/* Motif */}
              <div>
                <label className="font-bold text-slate-700 block mb-1">Motif (raison) *</label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={
                    formType === 'ajout'
                      ? 'Ex : Complément pour achat emballages...'
                      : 'Ex : Prélèvement personnel...'
                  }
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-800 focus:outline-none focus:border-teal-600"
                />
              </div>

              {/* Boutons validation */}
              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold hover:bg-slate-50 active:scale-95 transition-all min-h-[44px]"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className={`flex-1 py-2.5 rounded-xl text-white font-bold active:scale-95 transition-all min-h-[44px] ${
                    formType === 'ajout'
                      ? 'bg-teal-700 hover:bg-teal-800'
                      : 'bg-rose-700 hover:bg-rose-800'
                  }`}
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODALE HISTORIQUE DES PAIEMENTS VENDEURS */}
      <PaymentsHistoryModal
        isOpen={isPaymentsHistoryOpen}
        initialMonth={selectedPaymentsMonth}
        onClose={() => setIsPaymentsHistoryOpen(false)}
        employees={employees}
        dailyEntries={dailyEntries}
        payments={payments}
        settings={settings}
        onShowToast={onShowToast}
        onPaymentsChanged={async () => {
          await loadData();
        }}
      />

      {/* MODALE DE SUPPRESSION DE MOUVEMENT */}
      <ConfirmModal
        isOpen={Boolean(movementToDelete)}
        title="Supprimer ce mouvement ?"
        message={`Confirmez-vous la suppression de ce ${
          movementToDelete?.type === 'ajout' ? 'dépôt' : 'retrait'
        } de ${movementToDelete ? formatFC(movementToDelete.amountFC, currency) : ''} (${
          movementToDelete?.reason || ''
        }) ? Les soldes des caisses seront recalculés.`}
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        isDanger={true}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setMovementToDelete(null)}
      />
    </div>
  );
};
