import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  Calendar,
  Users,
  FileSpreadsheet,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  AlertCircle,
  Banknote,
  DollarSign,
  Phone,
} from 'lucide-react';
import { liveQuery } from 'dexie';
import { db } from '../../db/db';
import {
  formatDate,
  formatFC,
  formatPercent,
  toISODate,
  toISOMonth,
  getDateRangeForFilter,
  safePercentage,
} from '../../utils/formatters';
import { MonthlySheetModal } from './MonthlySheetModal';
import { PaymentModal } from './PaymentModal';
import type { DailyEntry, Employee, Payment, AppSettings, PeriodFilterType } from '../../types';

interface EmployeeEarningsViewProps {
  settings: AppSettings;
  onBack: () => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
}

export const EmployeeEarningsView: React.FC<EmployeeEarningsViewProps> = ({
  settings,
  onBack,
  onShowToast,
}) => {
  const [periodType, setPeriodType] = useState<PeriodFilterType>('this_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // Live data from IndexedDB
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [dailyEntries, setDailyEntries] = useState<DailyEntry[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  // Modals for monthly sheet and payments
  const [selectedSheetEmp, setSelectedSheetEmp] = useState<Employee | null>(null);
  const [selectedPaymentEmp, setSelectedPaymentEmp] = useState<Employee | null>(null);

  const currency = settings.currency || 'FC';
  const todayStr = toISODate(new Date());

  // Dexie liveQuery: updates automatically after every entry or payment with zero reload
  useEffect(() => {
    const subscription = liveQuery(async () => {
      const [empList, entryList, payList] = await Promise.all([
        db.employees.toArray(),
        db.dailyEntries.toArray(),
        db.payments.toArray(),
      ]);
      return { empList, entryList, payList };
    }).subscribe({
      next: ({ empList, entryList, payList }) => {
        setEmployees(empList);
        setDailyEntries(entryList);
        setPayments(payList);
      },
      error: (err) => {
        console.error('Erreur liveQuery EmployeeEarningsView:', err);
      },
    });

    return () => subscription.unsubscribe();
  }, []);

  // Compute date range
  const dateRange = useMemo(
    () => getDateRangeForFilter(periodType, customStart, customEnd),
    [periodType, customStart, customEnd]
  );

  // Filter entries in the selected range
  const currentEntries = useMemo(() => {
    return dailyEntries.filter(
      (entry) => entry.date >= dateRange.startDate && entry.date <= dateRange.endDate
    );
  }, [dailyEntries, dateRange]);

  // Today's entries for "Gagné aujourd'hui"
  const todayEntries = useMemo(() => {
    return dailyEntries.filter((entry) => entry.date === todayStr);
  }, [dailyEntries, todayStr]);

  // Filter payments in the selected range (or matching the month of the period)
  const currentPayments = useMemo(() => {
    return payments.filter((pay) => {
      if (pay.date >= dateRange.startDate && pay.date <= dateRange.endDate) return true;
      if (periodType === 'this_month') {
        const curMonth = toISOMonth(new Date());
        return pay.month === curMonth;
      }
      if (periodType === 'last_month') {
        const now = new Date();
        const prevMonthStr = toISOMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));
        return pay.month === prevMonthStr;
      }
      return false;
    });
  }, [payments, dateRange, periodType]);

  // Compute stats per employee
  const employeeEarningsStats = useMemo(() => {
    // Show active employees, or archived ones if they have entries in this period
    const relevantEmployees = employees.filter(
      (emp) => !emp.isArchived || currentEntries.some((e) => e.employeeId === emp.id)
    );

    return relevantEmployees
      .map((emp) => {
        const empEntries = currentEntries.filter((e) => e.employeeId === emp.id);
        const empPayments = currentPayments.filter((p) => p.employeeId === emp.id);
        const empTodayEntries = todayEntries.filter((e) => e.employeeId === emp.id);

        let salesFC = 0;
        let commissionGagneeFC = 0; // Somme réelle des employeeCommissionFC
        let soldQty = 0;
        let damagedQty = 0;
        let totalToSellQty = 0;

        for (const entry of empEntries) {
          salesFC += entry.totalSalesFC;
          commissionGagneeFC += entry.employeeCommissionFC; // Vraie commission de chaque saisie

          for (const item of entry.items) {
            soldQty += item.sold;
            damagedQty += item.damaged;
            totalToSellQty += item.totalToSell;
          }
        }

        // Gagné aujourd'hui
        const gagneAujourdhuiFC = empTodayEntries.reduce(
          (sum, e) => sum + (e.employeeCommissionFC || 0),
          0
        );

        // Déjà versé
        const dejaVerseFC = empPayments.reduce((sum, p) => sum + (p.amountFC || 0), 0);

        // Reste à payer
        const resteAPayerFC = commissionGagneeFC - dejaVerseFC;

        // Taux
        const tauxVentePct = safePercentage(soldQty, totalToSellQty);
        const tauxPertePct = safePercentage(damagedQty, totalToSellQty);

        return {
          employee: emp,
          salesFC,
          commissionGagneeFC: Math.round(commissionGagneeFC),
          dejaVerseFC: Math.round(dejaVerseFC),
          resteAPayerFC: Math.round(resteAPayerFC),
          gagneAujourdhuiFC: Math.round(gagneAujourdhuiFC),
          tauxVentePct,
          tauxPertePct,
          soldQty,
          damagedQty,
          totalToSellQty,
          entriesCount: empEntries.length,
        };
      })
      .sort((a, b) => b.commissionGagneeFC - a.commissionGagneeFC);
  }, [employees, currentEntries, currentPayments, todayEntries]);

  // Overall Totals
  const totals = useMemo(() => {
    let totalSalesFC = 0;
    let totalCommissionsFC = 0;
    let totalVerseFC = 0;
    let totalResteAPayerFC = 0;
    let totalGagneAujourdhuiFC = 0;

    for (const stat of employeeEarningsStats) {
      totalSalesFC += stat.salesFC;
      totalCommissionsFC += stat.commissionGagneeFC;
      totalVerseFC += stat.dejaVerseFC;
      totalResteAPayerFC += stat.resteAPayerFC;
      totalGagneAujourdhuiFC += stat.gagneAujourdhuiFC;
    }

    return {
      totalSalesFC,
      totalCommissionsFC,
      totalVerseFC,
      totalResteAPayerFC,
      totalGagneAujourdhuiFC,
    };
  }, [employeeEarningsStats]);

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
          <h2 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            Gains des Vendeurs(ses)
          </h2>
          <p className="text-xs text-slate-500">
            Commissions réelles, versements et reste à payer en temps réel
          </p>
        </div>
      </div>

      {/* Period Filter Buttons */}
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
          onClick={() => setPeriodType('this_month')}
          className={`flex-1 py-1.5 px-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-all min-h-[36px] ${
            periodType === 'this_month'
              ? 'bg-white text-slate-900 shadow-2xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Ce mois
        </button>
        <button
          type="button"
          onClick={() => setPeriodType('last_month')}
          className={`flex-1 py-1.5 px-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-all min-h-[36px] ${
            periodType === 'last_month'
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

      {/* Totals Banner */}
      <div className="rounded-3xl bg-linear-to-br from-teal-900 via-teal-800 to-slate-900 text-white p-4 shadow-md space-y-3">
        <div className="flex items-center justify-between text-xs font-bold text-teal-200 uppercase tracking-wider">
          <span>Totaux de la période</span>
          <span className="font-mono text-[11px] text-teal-300">
            {formatDate(dateRange.startDate)} → {formatDate(dateRange.endDate)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/10 p-2.5 rounded-2xl backdrop-blur-xs">
            <span className="text-[11px] text-teal-100 block">Ventes Totales</span>
            <span className="text-base font-extrabold font-mono text-white">
              {formatFC(totals.totalSalesFC, currency)}
            </span>
          </div>
          <div className="bg-white/10 p-2.5 rounded-2xl backdrop-blur-xs">
            <span className="text-[11px] text-teal-100 block">Commissions gagnées</span>
            <span className="text-base font-extrabold font-mono text-emerald-300">
              {formatFC(totals.totalCommissionsFC, currency)}
            </span>
          </div>
          <div className="bg-white/10 p-2.5 rounded-2xl backdrop-blur-xs">
            <span className="text-[11px] text-teal-100 block">Déjà versé</span>
            <span className="text-base font-extrabold font-mono text-slate-200">
              {formatFC(totals.totalVerseFC, currency)}
            </span>
          </div>
          <div className="bg-emerald-500/20 border border-emerald-400/30 p-2.5 rounded-2xl backdrop-blur-xs">
            <span className="text-[11px] text-emerald-200 block font-bold">RESTE À PAYER</span>
            <span className="text-base font-extrabold font-mono text-emerald-300">
              {formatFC(totals.totalResteAPayerFC, currency)}
            </span>
          </div>
        </div>
      </div>

      {/* Gagné Aujourd'hui par vendeur(se) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-3.5 shadow-2xs space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
            <DollarSign className="w-4 h-4 text-emerald-700" />
            <span>Gagné aujourd'hui</span>
          </h3>
          <span className="text-xs font-extrabold font-mono text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200">
            Total : {formatFC(totals.totalGagneAujourdhuiFC, currency)}
          </span>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          {employeeEarningsStats.map(({ employee, gagneAujourdhuiFC }) => (
            <div
              key={employee.id}
              className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 ${
                gagneAujourdhuiFC > 0
                  ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                  : 'bg-slate-50 text-slate-500 border-slate-200'
              }`}
            >
              <span className="truncate max-w-[110px]">{employee.name} :</span>
              <span className="font-mono">{formatFC(gagneAujourdhuiFC, currency)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Employee List */}
      <div className="space-y-3">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 px-1">
          Détail par Vendeur(se) ({employeeEarningsStats.length})
        </h3>

        {employeeEarningsStats.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400 text-xs">
            Aucun(e) vendeur(se) trouvé(e).
          </div>
        ) : (
          employeeEarningsStats.map(
            ({
              employee,
              salesFC,
              commissionGagneeFC,
              dejaVerseFC,
              resteAPayerFC,
              gagneAujourdhuiFC,
              tauxVentePct,
              tauxPertePct,
              soldQty,
              totalToSellQty,
            }) => (
              <div
                key={employee.id}
                className="bg-white rounded-3xl border border-slate-200/90 p-4 shadow-2xs space-y-3 transition-all hover:border-slate-300"
              >
                {/* Employee Header */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="font-extrabold text-slate-900 text-sm flex items-center gap-1.5">
                      {employee.name}
                      {employee.isArchived && (
                        <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-md">
                          Archivé(e)
                        </span>
                      )}
                    </h4>
                    {employee.phone && (
                      <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                        <Phone className="w-3 h-3" />
                        <span>{employee.phone}</span>
                      </p>
                    )}
                  </div>

                  {/* Reste à payer Badge */}
                  <div className="text-right">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">
                      Reste à payer
                    </span>
                    <span
                      className={`text-sm font-black font-mono px-2 py-0.5 rounded-lg border inline-block ${
                        resteAPayerFC > 0
                          ? 'text-emerald-800 bg-emerald-50 border-emerald-200'
                          : resteAPayerFC < 0
                          ? 'text-rose-700 bg-rose-50 border-rose-200'
                          : 'text-slate-600 bg-slate-100 border-slate-200'
                      }`}
                    >
                      {formatFC(resteAPayerFC, currency)}
                    </span>
                  </div>
                </div>

                {/* Financial Grid */}
                <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                  <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200/70">
                    <span className="text-[10px] font-bold text-slate-500 uppercase block">
                      Ventes Réalisées
                    </span>
                    <span className="font-extrabold font-mono text-slate-900 text-xs">
                      {formatFC(salesFC, currency)}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-2xl bg-teal-50/70 border border-teal-200/70">
                    <span className="text-[10px] font-bold text-teal-800 uppercase block">
                      Commission Gagnée
                    </span>
                    <span className="font-extrabold font-mono text-teal-900 text-xs">
                      {formatFC(commissionGagneeFC, currency)}
                    </span>
                    <span className="text-[9px] text-teal-600 block mt-0.5">
                      (somme réelle des saisies)
                    </span>
                  </div>

                  <div className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200/70">
                    <span className="text-[10px] font-bold text-slate-500 uppercase block">
                      Déjà Versé
                    </span>
                    <span className="font-extrabold font-mono text-slate-800 text-xs">
                      {formatFC(dejaVerseFC, currency)}
                    </span>
                    <span className="text-[9px] text-slate-400 block mt-0.5">
                      Avances et règlements
                    </span>
                  </div>

                  <div className="p-2.5 rounded-2xl bg-emerald-50/60 border border-emerald-200/70">
                    <span className="text-[10px] font-bold text-emerald-800 uppercase block">
                      Gagné Aujourd'hui
                    </span>
                    <span className="font-extrabold font-mono text-emerald-900 text-xs">
                      {formatFC(gagneAujourdhuiFC, currency)}
                    </span>
                  </div>
                </div>

                {/* Performance rates */}
                <div className="flex items-center justify-between text-[11px] bg-slate-100/70 px-3 py-2 rounded-xl">
                  <div className="flex items-center gap-1.5 font-medium text-slate-700">
                    <span className="text-slate-500">Taux de vente :</span>
                    <span className="font-bold text-slate-900 font-mono">
                      {formatPercent(tauxVentePct)}
                    </span>
                    <span className="text-slate-400 text-[10px]">
                      ({soldQty}/{totalToSellQty})
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 font-medium">
                    <span className="text-slate-500">Taux de perte :</span>
                    <span
                      className={`font-bold font-mono ${
                        tauxPertePct > 5 ? 'text-rose-600' : 'text-slate-700'
                      }`}
                    >
                      {formatPercent(tauxPertePct)}
                    </span>
                  </div>
                </div>

                {/* Actions: Voir la fiche du mois & Verser */}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setSelectedSheetEmp(employee)}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200/90 text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-all min-h-[44px]"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-teal-700" />
                    <span>Voir la fiche du mois</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedPaymentEmp(employee)}
                    className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center gap-1 active:scale-95 transition-all min-h-[44px]"
                  >
                    <Banknote className="w-4 h-4" />
                    <span>Payer</span>
                  </button>
                </div>
              </div>
            )
          )
        )}
      </div>

      {/* Monthly Sheet Modal */}
      {selectedSheetEmp && (
        <MonthlySheetModal
          isOpen={Boolean(selectedSheetEmp)}
          employee={selectedSheetEmp}
          onClose={() => setSelectedSheetEmp(null)}
          onOpenPaymentModal={(emp) => {
            setSelectedSheetEmp(null);
            setSelectedPaymentEmp(emp);
          }}
          settings={settings}
        />
      )}

      {/* Payment Modal */}
      {selectedPaymentEmp && (
        <PaymentModal
          isOpen={Boolean(selectedPaymentEmp)}
          employee={selectedPaymentEmp}
          onClose={() => setSelectedPaymentEmp(null)}
          onPaymentSaved={() => {
            onShowToast('success', 'Règlement enregistré avec succès.');
          }}
        />
      )}
    </div>
  );
};
