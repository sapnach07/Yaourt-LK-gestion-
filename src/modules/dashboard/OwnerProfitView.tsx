import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  DollarSign,
  TrendingUp,
  ShieldCheck,
  AlertTriangle,
  Wallet,
  Users,
  Info,
  Calendar,
} from 'lucide-react';
import { liveQuery } from 'dexie';
import { db } from '../../db/db';
import {
  formatDate,
  formatFC,
  formatPercent,
  toISODate,
  getDateRangeForFilter,
  safePercentage,
} from '../../utils/formatters';
import { calculateReserveBalance } from '../../utils/reserveCalculator';
import type {
  DailyEntry,
  Expense,
  ReserveMovement,
  Employee,
  AppSettings,
  PeriodFilterType,
  PersonalSale,
} from '../../types';

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
  const [periodType, setPeriodType] = useState<PeriodFilterType>('this_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // Live database data
  const [dailyEntries, setDailyEntries] = useState<DailyEntry[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [reserveMovements, setReserveMovements] = useState<ReserveMovement[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [personalSales, setPersonalSales] = useState<PersonalSale[]>([]);

  const currency = settings.currency || 'FC';
  const reserveRate = settings.expenseReservePct || 50;

  // Dexie liveQuery: updates automatically after every entry without page reload
  useEffect(() => {
    const subscription = liveQuery(async () => {
      const [entries, expList, movList, empList, pSalesList] = await Promise.all([
        db.dailyEntries.toArray(),
        db.expenses.toArray(),
        db.reserveMovements.toArray(),
        db.employees.toArray(),
        db.personalSales.toArray(),
      ]);
      return { entries, expList, movList, empList, pSalesList };
    }).subscribe({
      next: ({ entries, expList, movList, empList, pSalesList }) => {
        setDailyEntries(entries);
        setExpenses(expList);
        setReserveMovements(movList);
        setEmployees(empList);
        setPersonalSales(pSalesList);
      },
      error: (err) => {
        console.error('Erreur liveQuery OwnerProfitView:', err);
      },
    });

    return () => subscription.unsubscribe();
  }, []);

  // Compute date range
  const dateRange = useMemo(
    () => getDateRangeForFilter(periodType, customStart, customEnd),
    [periodType, customStart, customEnd]
  );

  // Filter entries in selected period
  const periodEntries = useMemo(() => {
    return dailyEntries.filter(
      (entry) => entry.date >= dateRange.startDate && entry.date <= dateRange.endDate
    );
  }, [dailyEntries, dateRange]);

  // Filter personal sales in selected period
  const periodPersonalSales = useMemo(() => {
    return personalSales.filter(
      (p) => p.date >= dateRange.startDate && p.date <= dateRange.endDate
    );
  }, [personalSales, dateRange]);

  // Overall Cumulative Caisse
  const cumulativeReserve = useMemo(() => {
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
    return calculateReserveBalance(
      reserveMovements,
      dailyEntries,
      expenses,
      reserveRate,
      startingPoint,
      null,
      personalSales
    );
  }, [
    reserveMovements,
    dailyEntries,
    expenses,
    reserveRate,
    settings.caisseStartDate,
    settings.caisseStartReserveFC,
    settings.caisseStartBeneficesFC,
    settings.caisseStartVendeursFC,
    settings.caisseStartNormaleFC,
    settings.caisseStartCapitalFC,
    personalSales,
  ]);

  // Profit calculation for the period
  const profitStats = useMemo(() => {
    let totalSalesFC = 0;
    let totalCommissionFC = 0;
    let totalOwnerShareGrossFC = 0;
    let totalDamagedFC = 0;

    // Per-seller map
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

      // Item damages
      let entryDamagedFC = 0;
      for (const item of entry.items) {
        entryDamagedFC += item.damaged * (item.unitPrice || 0);
      }
      totalDamagedFC += entryDamagedFC;

      // Update seller stats
      const target = sellerMap[entry.employeeId];
      if (target) {
        target.salesFC += entry.totalSalesFC;
        target.commissionFC += entry.employeeCommissionFC;
        target.ownerShareFC += entry.ownerShareFC;
        target.damagedFC += entryDamagedFC;
      }
    }

    // Traitement des ventes personnelles du gérant
    let personalSalesTotalFC = 0;
    let personalCommissionFC = 0;
    let personalOwnerShareFC = 0;
    let personalCaisseFC = 0;

    for (const p of periodPersonalSales) {
      personalSalesTotalFC += p.totalSalesFC || 0;
      personalCommissionFC += p.ownerCommissionFC || 0;
      personalOwnerShareFC += p.ownerShareFC || 0;
      personalCaisseFC += p.expenseReserveFC || 0;
    }

    totalSalesFC += personalSalesTotalFC;
    totalCommissionFC += personalCommissionFC;
    totalOwnerShareGrossFC += personalOwnerShareFC + personalCommissionFC;

    // Compute caisse share on total sales
    const totalCaisseShareFC = Math.round((totalSalesFC * reserveRate) / 100);

    // Compute seller caisse shares
    const sellerBreakdown = Object.values(sellerMap)
      .map((s) => ({
        ...s,
        caisseShareFC: Math.round((s.salesFC * reserveRate) / 100),
      }))
      .filter((s) => s.salesFC > 0 || !s.employee.isArchived)
      .sort((a, b) => b.ownerShareFC - a.ownerShareFC);

    if (personalSalesTotalFC > 0) {
      sellerBreakdown.unshift({
        employee: { id: 'owner_direct', name: 'Gérant (Ventes directes)', isArchived: false } as Employee,
        salesFC: personalSalesTotalFC,
        commissionFC: personalCommissionFC,
        caisseShareFC: personalCaisseFC,
        ownerShareFC: personalOwnerShareFC + personalCommissionFC,
        damagedFC: 0,
      });
    }

    // Dépassements des mois clôturés uniquement si un point de départ est défini
    // Déduire le dépassement des mois clôturés qui tombent dans la période sélectionnée
    let periodClosedMonthsCompensationFC = 0;
    if (settings.caisseStartDate) {
      for (const cm of cumulativeReserve.closedMonths) {
        // Le mois est dans la période si au moins un jour du mois chevauche la période
        // ou si la date de début / fin de période inclut ce mois
        const monthStart = `${cm.month}-01`;
        const lastDayObj = new Date(parseInt(cm.month.slice(0, 4), 10), parseInt(cm.month.slice(5, 7), 10), 0);
        const monthEnd = `${cm.month}-${String(lastDayObj.getDate()).padStart(2, '0')}`;

        if (monthEnd >= dateRange.startDate && monthStart <= dateRange.endDate) {
          periodClosedMonthsCompensationFC += cm.depassementPrisSurBeneficeFC;
        }
      }
    }

    const totalOwnerShareFC = Math.round(totalOwnerShareGrossFC - periodClosedMonthsCompensationFC);

    return {
      totalSalesFC,
      totalCommissionFC,
      totalCaisseShareFC,
      totalOwnerShareGrossFC: Math.round(totalOwnerShareGrossFC),
      periodClosedMonthsCompensationFC,
      totalOwnerShareFC,
      totalDamagedFC,
      sellerBreakdown,
    };
  }, [periodEntries, periodPersonalSales, employees, reserveRate, settings.caisseStartDate, cumulativeReserve.closedMonths, dateRange]);

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

      {/* Period Filter Selector */}
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

      {/* HERO CARD: Mon Bénéfice */}
      <div className="rounded-3xl bg-linear-to-br from-emerald-900 via-teal-900 to-slate-900 text-white p-5 shadow-md space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">
            Mon Bénéfice Net (Part Gérant)
          </span>
          <span className="text-[11px] font-mono text-teal-200">
            {formatDate(dateRange.startDate)} → {formatDate(dateRange.endDate)}
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

          <div className="flex items-center justify-between p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 font-bold">
            <div>
              <span className="block text-xs uppercase font-black text-emerald-900">
                = Mon Bénéfice
              </span>
              <span className="text-[10px] text-emerald-700 font-normal">
                Ventes − Commissions − Part Réserve
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
                  <span className="text-[10px] text-slate-400">
                    Ventes : {formatFC(item.salesFC, currency)}
                  </span>
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
