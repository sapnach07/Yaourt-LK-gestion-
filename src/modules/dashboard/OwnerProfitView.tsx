import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  AlertTriangle,
  Wallet,
  Info,
  Calendar,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { liveQuery } from 'dexie';
import { db } from '../../db/db';
import {
  formatDate,
  formatFC,
  toISODate,
  toISOMonth,
  formatMonthName,
  getDateRangeForFilter,
} from '../../utils/formatters';
import { calculateReserveBalance } from '../../utils/reserveCalculator';
import { computeDebtAllocations, type AllocatedDebtPayment } from '../../utils/debtCalculator';
import type {
  DailyEntry,
  Expense,
  ReserveMovement,
  Employee,
  AppSettings,
  PeriodFilterType,
  PersonalSale,
  DebtPayment,
  Payment,
} from '../../types';

export interface OwnerProfitPeriodStats {
  totalSalesFC: number;
  totalCommissionFC: number;
  totalCaisseShareFC: number;
  sellerOwnerShareFC: number;
  personalOwnerTotalShareFC: number;
  totalOwnerShareGrossFC: number;
  periodClosedMonthsCompensationFC: number;
  totalConsumptionFC: number;
  totalOwnerShareFC: number;
  totalDamagedFC: number;
  pendingDebtFC: number;
  oldDebtsCollectedFC: number;
  oldDebtsOwnerShareFC: number;
  sellerBreakdown: Array<{
    employee: Employee;
    salesFC: number;
    commissionFC: number;
    caisseShareFC: number;
    ownerShareFC: number;
    damagedFC: number;
  }>;
}

/**
 * Calcul pur et sans effet de bord de "Mon Bénéfice" sur une plage [startDate, endDate].
 * Partagé avec l'écran Caisse pour garantir un montant strictement identique.
 */
export function computeOwnerProfitStats(params: {
  startDate: string;
  endDate: string;
  dailyEntries: DailyEntry[];
  personalSales: PersonalSale[];
  paymentAllocations: AllocatedDebtPayment[];
  totalRemainingDebtFC: number;
  employees: Employee[];
  reserveRate: number;
  caisseStartDate?: string;
  closedMonths?: Array<{ month: string; depassementPrisSurBeneficeFC: number }>;
}): OwnerProfitPeriodStats {
  const {
    startDate,
    endDate,
    dailyEntries,
    personalSales,
    paymentAllocations,
    totalRemainingDebtFC,
    employees,
    reserveRate,
    caisseStartDate,
    closedMonths = [],
  } = params;

  const periodEntries = dailyEntries.filter(
    (entry) => entry.date >= startDate && entry.date <= endDate
  );
  const periodPersonalSales = personalSales.filter(
    (p) => p.date >= startDate && p.date <= endDate
  );

  let totalSalesFC = 0;
  let totalCommissionFC = 0;
  let totalOwnerShareGrossFC = 0;
  let sellerOwnerShareFC = 0;
  let totalDamagedFC = 0;

  const sellerMap: Record<
    string,
    {
      employee: Employee;
      salesFC: number;
      commissionFC: number;
      caisseShareFC: number;
      ownerShareFC: number;
      damagedFC: number;
    }
  > = {};

  employees.forEach((emp) => {
    sellerMap[emp.id] = {
      employee: emp,
      salesFC: 0,
      commissionFC: 0,
      caisseShareFC: 0,
      ownerShareFC: 0,
      damagedFC: 0,
    };
  });

  for (const entry of periodEntries) {
    totalSalesFC += entry.totalSalesFC;
    totalCommissionFC += entry.employeeCommissionFC;
    totalOwnerShareGrossFC += entry.ownerShareFC;
    sellerOwnerShareFC += entry.ownerShareFC;

    let entryDamagedFC = 0;
    for (const item of entry.items) {
      entryDamagedFC += item.damaged * (item.unitPrice || 0);
    }
    totalDamagedFC += entryDamagedFC;

    const target = sellerMap[entry.employeeId];
    if (target) {
      target.salesFC += entry.totalSalesFC;
      target.commissionFC += entry.employeeCommissionFC;
      target.ownerShareFC += entry.ownerShareFC;
      target.damagedFC += entryDamagedFC;
    }
  }

  const sellerSalesTotalFC = totalSalesFC;
  let personalSalesTotalFC = 0;
  let personalCommissionFC = 0;
  let personalOwnerShareFC = 0;
  let personalCaisseFC = 0;
  let totalConsumptionFC = 0;

  for (const p of periodPersonalSales) {
    if (p.kind === 'consommation') {
      totalConsumptionFC +=
        p.consumptionPaidFC !== undefined ? p.consumptionPaidFC : (p.consumptionValueFC || 0);
    } else if (p.paymentStatus !== 'credit' && !p.isOpeningDebt) {
      personalSalesTotalFC += p.totalSalesFC || 0;
      personalCommissionFC += p.ownerCommissionFC || 0;
      personalOwnerShareFC += p.ownerShareFC || 0;
      personalCaisseFC += p.expenseReserveFC || 0;
    }
  }

  const salesById = new Map<string, PersonalSale>();
  for (const p of personalSales) {
    salesById.set(p.id, p);
  }

  let oldDebtsCollectedFC = 0;
  let oldDebtsOwnerShareFC = 0;

  // Paiements de dettes encaissés sur la période (affectés FIFO)
  for (const alloc of paymentAllocations) {
    if (alloc.date >= startDate && alloc.date <= endDate) {
      personalSalesTotalFC += alloc.totalAmountFC;
      personalCommissionFC += alloc.ownerCommissionFC;
      personalOwnerShareFC += alloc.ownerShareFC;
      personalCaisseFC += alloc.reserveFC;

      const paymentMonthStart = `${alloc.date.slice(0, 7)}-01`;
      for (const slice of alloc.slices) {
        if (!slice.saleId) continue;
        const sale = salesById.get(slice.saleId);
        if (sale && (sale.isOpeningDebt || (sale.date && sale.date < paymentMonthStart))) {
          oldDebtsCollectedFC += slice.amountFC;
          oldDebtsOwnerShareFC += slice.beneficesFC;
        }
      }
    }
  }

  const personalOwnerTotalShareFC = personalOwnerShareFC + personalCommissionFC;
  const pendingDebtFC = totalRemainingDebtFC;

  totalSalesFC += personalSalesTotalFC;
  totalCommissionFC += personalCommissionFC;
  totalOwnerShareGrossFC += personalOwnerTotalShareFC;

  const totalCaisseShareFC =
    Math.round((sellerSalesTotalFC * reserveRate) / 100) + personalCaisseFC;

  const sellerBreakdown = Object.values(sellerMap)
    .map((s) => ({
      ...s,
      caisseShareFC: Math.round((s.salesFC * reserveRate) / 100),
    }))
    .filter((s) => s.salesFC > 0 || !s.employee.isArchived)
    .sort((a, b) => b.ownerShareFC - a.ownerShareFC);

  if (personalSalesTotalFC > 0 || pendingDebtFC > 0) {
    sellerBreakdown.unshift({
      employee: { id: 'owner_direct', name: 'Mes ventes personnelles', isArchived: false } as Employee,
      salesFC: personalSalesTotalFC,
      commissionFC: personalCommissionFC,
      caisseShareFC: personalCaisseFC,
      ownerShareFC: personalOwnerTotalShareFC,
      damagedFC: 0,
    });
  }

  let periodClosedMonthsCompensationFC = 0;
  if (caisseStartDate) {
    for (const cm of closedMonths) {
      const monthStart = `${cm.month}-01`;
      const lastDayObj = new Date(
        parseInt(cm.month.slice(0, 4), 10),
        parseInt(cm.month.slice(5, 7), 10),
        0
      );
      const monthEnd = `${cm.month}-${String(lastDayObj.getDate()).padStart(2, '0')}`;

      if (monthEnd >= startDate && monthStart <= endDate) {
        periodClosedMonthsCompensationFC += cm.depassementPrisSurBeneficeFC;
      }
    }
  }

  const totalOwnerShareFC = Math.round(
    totalOwnerShareGrossFC - periodClosedMonthsCompensationFC - totalConsumptionFC
  );

  return {
    totalSalesFC,
    totalCommissionFC,
    totalCaisseShareFC,
    sellerOwnerShareFC: Math.round(sellerOwnerShareFC),
    personalOwnerTotalShareFC: Math.round(personalOwnerTotalShareFC),
    totalOwnerShareGrossFC: Math.round(totalOwnerShareGrossFC),
    periodClosedMonthsCompensationFC,
    totalConsumptionFC: Math.round(totalConsumptionFC),
    totalOwnerShareFC,
    totalDamagedFC,
    pendingDebtFC,
    oldDebtsCollectedFC: Math.round(oldDebtsCollectedFC),
    oldDebtsOwnerShareFC: Math.round(oldDebtsOwnerShareFC),
    sellerBreakdown,
  };
}

/**
 * Retraits personnels et transferts vers la Réserve depuis la Caisse Bénéfices sur [startDate, endDate]
 */
export function computeBeneficesOutflowsForRange(
  movements: ReserveMovement[],
  startDate: string,
  endDate: string
): { withdrawalsFC: number; transfersFC: number; totalOutflowsFC: number } {
  let withdrawalsFC = 0;
  let transfersFC = 0;

  for (const m of movements) {
    if (!m.date || m.date < startDate || m.date > endDate) continue;
    const amount = m.amountFC || 0;
    const caisse = m.caisse || 'reserve';
    const source = m.source || 'personnel';

    if (caisse === 'benefices' && m.type === 'retrait') {
      withdrawalsFC += amount;
    } else if (caisse === 'reserve' && m.type === 'ajout' && source === 'benefices') {
      transfersFC += amount;
    }
  }

  return {
    withdrawalsFC: Math.round(withdrawalsFC),
    transfersFC: Math.round(transfersFC),
    totalOutflowsFC: Math.round(withdrawalsFC + transfersFC),
  };
}

function getMonthDateBounds(yearMonth: string): {
  startDate: string;
  endDate: string;
  prevStartDate: string;
  prevEndDate: string;
} {
  const [yStr, mStr] = yearMonth.split('-');
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const firstDay = new Date(y, m - 1, 1);
  const lastDay = new Date(y, m, 0);
  const prevFirst = new Date(y, m - 2, 1);
  const prevLast = new Date(y, m - 1, 0);
  return {
    startDate: toISODate(firstDay),
    endDate: toISODate(lastDay),
    prevStartDate: toISODate(prevFirst),
    prevEndDate: toISODate(prevLast),
  };
}

function shiftYearMonth(yearMonth: string, deltaMonths: number): string {
  const [yStr, mStr] = yearMonth.split('-');
  const d = new Date(parseInt(yStr, 10), parseInt(mStr, 10) - 1 + deltaMonths, 1);
  return toISOMonth(d);
}

interface OwnerProfitViewProps {
  settings: AppSettings;
  onBack: () => void;
  onOpenReserve?: () => void;
}

export const OwnerProfitView: React.FC<OwnerProfitViewProps> = ({
  settings,
  onBack,
  onOpenReserve,
}) => {
  const currentMonthStr = toISOMonth(new Date());
  const lastMonthStr = useMemo(() => shiftYearMonth(currentMonthStr, -1), [currentMonthStr]);

  const [periodType, setPeriodType] = useState<PeriodFilterType | 'month'>('this_month');
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // Live database data
  const [dailyEntries, setDailyEntries] = useState<DailyEntry[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [reserveMovements, setReserveMovements] = useState<ReserveMovement[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [personalSales, setPersonalSales] = useState<PersonalSale[]>([]);
  const [debtPayments, setDebtPayments] = useState<DebtPayment[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  const currency = settings.currency || 'FC';
  const reserveRate = settings.expenseReservePct || 50;

  // Dexie liveQuery: updates automatically after every entry without page reload
  useEffect(() => {
    const subscription = liveQuery(async () => {
      const [entries, expList, movList, empList, pSalesList, dPayList, payList] = await Promise.all([
        db.dailyEntries.toArray(),
        db.expenses.toArray(),
        db.reserveMovements.toArray(),
        db.employees.toArray(),
        db.personalSales.toArray(),
        db.debtPayments.toArray(),
        db.payments.toArray(),
      ]);
      return { entries, expList, movList, empList, pSalesList, dPayList, payList };
    }).subscribe({
      next: ({ entries, expList, movList, empList, pSalesList, dPayList, payList }) => {
        setDailyEntries(entries);
        setExpenses(expList);
        setReserveMovements(movList);
        setEmployees(empList);
        setPersonalSales(pSalesList);
        setDebtPayments(dPayList);
        setPayments(payList);
      },
      error: (err) => {
        console.error('Erreur liveQuery OwnerProfitView:', err);
      },
    });

    return () => subscription.unsubscribe();
  }, []);

  const isSingleMonthMode =
    periodType === 'month' || periodType === 'this_month' || periodType === 'last_month';

  // Compute date range
  const dateRange = useMemo(() => {
    if (periodType === 'month') {
      return getMonthDateBounds(selectedMonth);
    }
    return getDateRangeForFilter(periodType, customStart, customEnd);
  }, [periodType, selectedMonth, customStart, customEnd]);

  const startingPoint = useMemo(
    () =>
      settings.caisseStartDate
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
        : null,
    [
      settings.caisseStartDate,
      settings.caisseStartReserveFC,
      settings.caisseStartBeneficesFC,
      settings.caisseStartVendeursFC,
      settings.caisseStartNormaleFC,
      settings.caisseStartCapitalFC,
    ]
  );

  // Overall Cumulative Caisse
  const cumulativeReserve = useMemo(() => {
    return calculateReserveBalance(
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
  }, [
    reserveMovements,
    dailyEntries,
    expenses,
    reserveRate,
    startingPoint,
    personalSales,
    payments,
    employees,
    debtPayments,
  ]);

  const debtData = useMemo(
    () =>
      computeDebtAllocations(
        personalSales,
        debtPayments,
        reserveRate,
        [],
        settings.debtReminderDays ?? 2
      ),
    [personalSales, debtPayments, reserveRate, settings.debtReminderDays]
  );

  // Profit calculation for the selected period or month
  const profitStats = useMemo(() => {
    return computeOwnerProfitStats({
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      dailyEntries,
      personalSales,
      paymentAllocations: debtData.paymentAllocations,
      totalRemainingDebtFC: debtData.totalRemainingFC,
      employees,
      reserveRate,
      caisseStartDate: settings.caisseStartDate,
      closedMonths: cumulativeReserve.closedMonths,
    });
  }, [
    dateRange,
    dailyEntries,
    personalSales,
    debtData,
    employees,
    reserveRate,
    settings.caisseStartDate,
    cumulativeReserve.closedMonths,
  ]);

  // Liste des 12 derniers mois (du plus récent au plus ancien)
  const monthlyHistory = useMemo(() => {
    const rows: Array<{
      month: string;
      label: string;
      earnedFC: number;
      outflowsFC: number;
      endBalanceFC: number;
    }> = [];

    for (let i = 0; i < 12; i++) {
      const mStr = shiftYearMonth(currentMonthStr, -i);
      const bounds = getMonthDateBounds(mStr);

      const mProfit = computeOwnerProfitStats({
        startDate: bounds.startDate,
        endDate: bounds.endDate,
        dailyEntries,
        personalSales,
        paymentAllocations: debtData.paymentAllocations,
        totalRemainingDebtFC: debtData.totalRemainingFC,
        employees,
        reserveRate,
        caisseStartDate: settings.caisseStartDate,
        closedMonths: cumulativeReserve.closedMonths,
      });

      const mOutflows = computeBeneficesOutflowsForRange(
        reserveMovements,
        bounds.startDate,
        bounds.endDate
      );

      const endCaisse = calculateReserveBalance(
        reserveMovements,
        dailyEntries,
        expenses,
        reserveRate,
        startingPoint,
        bounds.endDate,
        personalSales,
        payments,
        employees,
        debtPayments
      );

      rows.push({
        month: mStr,
        label: formatMonthName(mStr),
        earnedFC: mProfit.totalOwnerShareFC,
        outflowsFC: mOutflows.totalOutflowsFC,
        endBalanceFC: endCaisse.soldeBeneficesFC,
      });
    }

    return rows;
  }, [
    currentMonthStr,
    dailyEntries,
    personalSales,
    debtData,
    employees,
    reserveRate,
    settings.caisseStartDate,
    cumulativeReserve.closedMonths,
    reserveMovements,
    expenses,
    startingPoint,
    payments,
    debtPayments,
  ]);

  const handleSelectMonth = (targetMonth: string, scrollTop = false) => {
    setSelectedMonth(targetMonth);
    if (targetMonth === currentMonthStr) {
      setPeriodType('this_month');
    } else if (targetMonth === lastMonthStr) {
      setPeriodType('last_month');
    } else {
      setPeriodType('month');
    }
    if (scrollTop && typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="pb-28 pt-3 px-4 max-w-lg mx-auto space-y-4">
      {/* Top Header with Back button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Retour"
          className="p-2.5 rounded-2xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 active:scale-95 transition-all shadow-2xs min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight">
            Mon Bénéfice (Part Gérant)
          </h2>
          <p className="text-xs text-slate-500">
            Suivi en temps réel de ma part nette personnelle
          </p>
        </div>
      </div>

      {/* Sélecteur de mois ◀ Octobre 2026 ▶ */}
      <div
        className={`flex items-center justify-between p-1.5 rounded-2xl border transition-all shadow-2xs ${
          isSingleMonthMode
            ? 'bg-emerald-50/80 border-emerald-300'
            : 'bg-white border-slate-200/90'
        }`}
      >
        <button
          type="button"
          onClick={() => handleSelectMonth(shiftYearMonth(selectedMonth, -1))}
          aria-label="Mois précédent"
          className="p-2 rounded-xl text-slate-700 hover:bg-white active:scale-95 transition-all min-h-[40px] min-w-[40px] flex items-center justify-center"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={() => handleSelectMonth(selectedMonth)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-black text-slate-900 hover:bg-white/70 transition-all"
        >
          <Calendar className="w-4 h-4 text-emerald-700" />
          <span>{formatMonthName(selectedMonth)}</span>
        </button>

        <button
          type="button"
          onClick={() => handleSelectMonth(shiftYearMonth(selectedMonth, 1))}
          aria-label="Mois suivant"
          className="p-2 rounded-xl text-slate-700 hover:bg-white active:scale-95 transition-all min-h-[40px] min-w-[40px] flex items-center justify-center"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Period Filter Selector (filtres existants conservés) */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar bg-slate-200/70 p-1 rounded-2xl">
        <button
          type="button"
          onClick={() => setPeriodType('today')}
          className={`flex-1 py-1.5 px-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-all min-h-[36px] ${
            periodType === 'today'
              ? 'bg-white text-slate-900 shadow-2xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Aujourd'hui
        </button>
        <button
          type="button"
          onClick={() => setPeriodType('this_week')}
          className={`flex-1 py-1.5 px-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-all min-h-[36px] ${
            periodType === 'this_week'
              ? 'bg-white text-slate-900 shadow-2xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Cette semaine
        </button>
        <button
          type="button"
          onClick={() => {
            setSelectedMonth(currentMonthStr);
            setPeriodType('this_month');
          }}
          className={`flex-1 py-1.5 px-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-all min-h-[36px] ${
            periodType === 'this_month' ||
            (periodType === 'month' && selectedMonth === currentMonthStr)
              ? 'bg-white text-slate-900 shadow-2xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Ce mois
        </button>
        <button
          type="button"
          onClick={() => {
            setSelectedMonth(lastMonthStr);
            setPeriodType('last_month');
          }}
          className={`flex-1 py-1.5 px-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-all min-h-[36px] ${
            periodType === 'last_month' ||
            (periodType === 'month' && selectedMonth === lastMonthStr)
              ? 'bg-white text-slate-900 shadow-2xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Mois dernier
        </button>
        <button
          type="button"
          onClick={() => setPeriodType('custom')}
          className={`flex-1 py-1.5 px-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-all min-h-[36px] ${
            periodType === 'custom'
              ? 'bg-white text-slate-900 shadow-2xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Personnalisée
        </button>
      </div>

      {/* Custom Date Pickers */}
      {periodType === 'custom' && (
        <div className="p-3 bg-white rounded-2xl border border-slate-200/90 shadow-2xs space-y-2">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <label className="text-[11px] font-bold text-slate-600 block mb-1">Du :</label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-slate-50 focus:bg-white focus:outline-teal-700 min-h-[40px]"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-600 block mb-1">Au :</label>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-slate-50 focus:bg-white focus:outline-teal-700 min-h-[40px]"
              />
            </div>
          </div>
        </div>
      )}

      {/* HERO CARD: Mon Bénéfice */}
      <div className="rounded-3xl bg-linear-to-br from-emerald-900 via-teal-900 to-slate-900 text-white p-5 shadow-md space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">
            Mon Bénéfice Net (Part Gérant)
          </span>
          <span className="text-[11px] font-mono text-teal-200">
            {isSingleMonthMode
              ? formatMonthName(selectedMonth)
              : `${formatDate(dateRange.startDate)} → ${formatDate(dateRange.endDate)}`}
          </span>
        </div>

        <div>
          <span className="text-3xl font-black font-mono tracking-tight text-white block">
            {formatFC(profitStats.totalOwnerShareFC, currency)}
          </span>
          <p className="text-xs text-emerald-200/90 mt-1 leading-snug">
            Somme de ma part (ventes × ma part %). Les dépenses ne sont pas déduites de mon bénéfice : elles sont prises en charge par la Caisse Réserve.
          </p>
        </div>
      </div>

      {/* DÉTAIL DU MOIS (sous la carte principale) */}
      <div className="rounded-3xl bg-white border border-emerald-200/90 p-4 shadow-2xs space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-wider text-emerald-900">
            {isSingleMonthMode
              ? `Détail du mois (${formatMonthName(selectedMonth)})`
              : 'Détail de ma part sur la période'}
          </h3>
        </div>

        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-50/60 border border-emerald-100">
            <span className="font-bold text-slate-700">
              Part sur les ventes des vendeur(se)s
            </span>
            <span className="font-mono font-extrabold text-emerald-900">
              +{formatFC(profitStats.sellerOwnerShareFC, currency)}
            </span>
          </div>

          <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-50/60 border border-emerald-100">
            <span className="font-bold text-slate-700">
              Ma part sur mes ventes personnelles encaissées
            </span>
            <span className="font-mono font-extrabold text-emerald-900">
              +{formatFC(profitStats.personalOwnerTotalShareFC, currency)}
            </span>
          </div>

          <div className="flex items-center justify-between p-2.5 rounded-xl bg-amber-50/70 border border-amber-200/80">
            <span className="font-bold text-amber-900">− Consommations</span>
            <span className="font-mono font-extrabold text-amber-950">
              −{formatFC(profitStats.totalConsumptionFC, currency)}
            </span>
          </div>

          {profitStats.periodClosedMonthsCompensationFC > 0 && (
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800">
              <span className="font-bold">− Compensation des mois clôturés</span>
              <span className="font-mono font-extrabold text-rose-900">
                −{formatFC(profitStats.periodClosedMonthsCompensationFC, currency)}
              </span>
            </div>
          )}
        </div>

        {/* Ligne séparée : Anciennes dettes encaissées ce mois-ci */}
        <div className="pt-2 border-t border-slate-100">
          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs space-y-0.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-slate-700">
                Anciennes dettes encaissées ce mois-ci :
              </span>
              <span className="font-mono font-extrabold text-slate-900 shrink-0">
                {formatFC(profitStats.oldDebtsCollectedFC, currency)}
              </span>
            </div>
            <span className="text-[10px] text-slate-500 block leading-snug">
              Paiements reçus ce mois-ci pour des ventes d'un mois précédent
              {profitStats.oldDebtsOwnerShareFC > 0
                ? ` (dont ${formatFC(profitStats.oldDebtsOwnerShareFC, currency)} de ma part déjà incluse ci-dessus)`
                : ''}
            </span>
          </div>
        </div>
      </div>

      {/* NOUVEAU BLOC : MOIS PAR MOIS (12 derniers mois) */}
      <div className="rounded-3xl bg-white border border-slate-200/90 p-4 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-teal-700" />
            <span>Mois par mois (12 derniers mois)</span>
          </h3>
          <span className="text-[10px] text-slate-400 font-medium">
            Toucher un mois pour le voir
          </span>
        </div>

        <div className="space-y-2">
          {monthlyHistory.map((row) => {
            const isSelectedRow = isSingleMonthMode && selectedMonth === row.month;
            return (
              <button
                key={row.month}
                type="button"
                onClick={() => handleSelectMonth(row.month, true)}
                className={`w-full text-left p-3 rounded-2xl border transition-all active:scale-[0.99] space-y-1.5 ${
                  isSelectedRow
                    ? 'bg-emerald-50/90 border-emerald-400 shadow-2xs'
                    : 'bg-slate-50/70 hover:bg-slate-50 border-slate-200/80'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                    <span>{row.label}</span>
                    {row.month === currentMonthStr && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-teal-100 text-teal-800 uppercase">
                        Ce mois
                      </span>
                    )}
                  </span>
                  <span className="text-xs font-black font-mono text-emerald-800">
                    +{formatFC(row.earnedFC, currency)}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1.5 pt-1 border-t border-slate-200/60 text-[10px] font-mono items-end">
                  <div>
                    <span className="text-slate-400 font-sans block leading-tight">
                      Bénéfice gagné
                    </span>
                    <span className="font-bold text-emerald-800">
                      {formatFC(row.earnedFC, currency)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-sans block leading-tight">
                      Retraits et transferts
                    </span>
                    <span className="font-bold text-slate-700">
                      {row.outflowsFC > 0
                        ? `−${formatFC(row.outflowsFC, currency)}`
                        : formatFC(0, currency)}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-400 font-sans block leading-tight">
                      Solde fin de mois
                    </span>
                    <span className="font-extrabold text-slate-900">
                      {formatFC(row.endBalanceFC, currency)}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* DÉTAIL DU CALCUL DU BÉNÉFICE */}
      <div className="rounded-3xl bg-white border border-slate-200/90 p-4 shadow-2xs space-y-3">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
          <Info className="w-4 h-4 text-teal-700" />
          <span>Détail de la répartition financière</span>
        </h3>

        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
            <span className="font-bold text-slate-700">1. Ventes totales</span>
            <span className="font-mono font-extrabold text-slate-900">
              +{formatFC(profitStats.totalSalesFC, currency)}
            </span>
          </div>

          <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
            <span className="font-bold text-teal-800">2. Commissions des vendeur(se)s</span>
            <span className="font-mono font-extrabold text-teal-900">
              −{formatFC(profitStats.totalCommissionFC, currency)}
            </span>
          </div>

          <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
            <span className="font-bold text-slate-700">
              3. Part Caisse Réserve ({reserveRate} %)
            </span>
            <span className="font-mono font-extrabold text-slate-900">
              −{formatFC(profitStats.totalCaisseShareFC, currency)}
            </span>
          </div>

          {/* Ligne séparée : Compensation des mois clôturés */}
          {profitStats.periodClosedMonthsCompensationFC > 0 && (
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800">
              <span className="font-bold">4. Compensation des mois clôturés</span>
              <span className="font-mono font-extrabold text-rose-900">
                −{formatFC(profitStats.periodClosedMonthsCompensationFC, currency)}
              </span>
            </div>
          )}

          {/* Ligne séparée : Mes yaourts consommés */}
          {profitStats.totalConsumptionFC > 0 && (
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">
              <span className="font-bold">− Mes yaourts consommés</span>
              <span className="font-mono font-extrabold text-amber-950">
                −{formatFC(profitStats.totalConsumptionFC, currency)}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 font-bold">
            <div>
              <span className="block text-xs uppercase font-black text-emerald-900">
                = Mon Bénéfice
              </span>
              <span className="text-[10px] text-emerald-700 font-normal">
                Ventes − Commissions − Part Réserve{profitStats.totalConsumptionFC > 0 ? ' − Yaourts consommés' : ''}
              </span>
            </div>
            <span className="text-base font-black font-mono text-emerald-800">
              {formatFC(profitStats.totalOwnerShareFC, currency)}
            </span>
          </div>
        </div>
      </div>

      {/* INFOS SECONDAIRES (SANS DÉDUCTION) */}
      <div className="grid grid-cols-2 gap-2.5">
        {/* Solde actuel de la Caisse Réserve */}
        <div
          onClick={onOpenReserve}
          className="p-3.5 rounded-3xl bg-white border border-slate-200/90 shadow-2xs cursor-pointer hover:border-teal-400 transition-all flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase block">
                Solde Caisse Réserve
              </span>
              <Wallet className="w-3.5 h-3.5 text-teal-700" />
            </div>
            <span
              className={`text-base font-black font-mono mt-0.5 block ${
                cumulativeReserve.soldeReserveFC < 0 ? 'text-rose-700' : 'text-slate-900'
              }`}
            >
              {formatFC(cumulativeReserve.soldeReserveFC, currency)}
            </span>
          </div>
          <span className="text-[10px] text-teal-700 font-semibold mt-2 block">
            Prend en charge les dépenses →
          </span>
        </div>

        {/* Valeur des Pertes (Abîmé) */}
        <div className="p-3.5 rounded-3xl bg-white border border-slate-200/90 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-rose-700 uppercase block">
                Valeur Pertes (Abîmé)
              </span>
              <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
            </div>
            <span className="text-base font-black font-mono text-rose-700 mt-0.5 block">
              {formatFC(profitStats.totalDamagedFC, currency)}
            </span>
          </div>
          <span className="text-[10px] text-slate-400 mt-2 block">
            Non déduit de ma part
          </span>
        </div>
      </div>

      {/* MA PART PAR VENDEUR(SE) */}
      <div className="space-y-3 pt-1">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 px-1">
          Ma part par Vendeur(se) ({profitStats.sellerBreakdown.length})
        </h3>

        {profitStats.sellerBreakdown.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400 text-xs">
            Aucune vente enregistrée sur cette période.
          </div>
        ) : (
          profitStats.sellerBreakdown.map((item) => (
            <div
              key={item.employee.id}
              className="bg-white rounded-3xl border border-slate-200/90 p-3.5 shadow-2xs space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-extrabold text-slate-900 text-sm">
                    {item.employee.name}
                  </h4>
                  <span className="text-[10px] text-slate-400 block">
                    {item.employee.id === 'owner_direct'
                      ? `Encaissé sur la période : ${formatFC(item.salesFC, currency)}`
                      : `Ventes : ${formatFC(item.salesFC, currency)}`}
                  </span>
                  {item.employee.id === 'owner_direct' && (
                    <span className="text-[11px] font-bold text-amber-700 font-mono block mt-0.5">
                      En attente (dettes) : {formatFC(profitStats.pendingDebtFC, currency)}
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-emerald-700 block">
                    Ma Part
                  </span>
                  <span className="text-sm font-black font-mono text-emerald-900 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200">
                    {formatFC(item.ownerShareFC, currency)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono pt-1 border-t border-slate-100">
                <div className="bg-slate-50 p-1.5 rounded-xl text-center">
                  <span className="text-slate-400 block text-[9px]">Commission</span>
                  <span className="font-bold text-teal-800">
                    {formatFC(item.commissionFC, currency)}
                  </span>
                </div>
                <div className="bg-slate-50 p-1.5 rounded-xl text-center">
                  <span className="text-slate-400 block text-[9px]">Caisse ({reserveRate}%)</span>
                  <span className="font-bold text-slate-700">
                    {formatFC(item.caisseShareFC, currency)}
                  </span>
                </div>
                <div className="bg-emerald-50/70 p-1.5 rounded-xl text-center border border-emerald-200/50">
                  <span className="text-emerald-700 block text-[9px]">Ma Part</span>
                  <span className="font-extrabold text-emerald-900">
                    {formatFC(item.ownerShareFC, currency)}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

