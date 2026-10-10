import React, { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp,
  TrendingDown,
  FileText,
  AlertTriangle,
  Award,
  Calendar,
  Filter,
  Package,
  Users,
  Target,
  Clock,
  HelpCircle,
  Wallet,
  Info,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { db } from '../../db/db';
import {
  formatDate,
  formatFC,
  formatPercent,
  safePercentage,
  safeDivide,
  getDateRangeForFilter,
  toISODate,
  toISOMonth,
  getFrenchDayName,
} from '../../utils/formatters';
import { generateMonthlyManagementReportPDF } from '../../utils/pdfGenerator';
import { EmptyState } from '../../components/EmptyState';
import { calculateReserveBalance, type ReserveDetails } from '../../utils/reserveCalculator';
import type {
  DailyEntry,
  Expense,
  Employee,
  Product,
  AppSettings,
  PeriodFilterType,
  ProductionEntry,
  Payment,
  ReserveMovement,
} from '../../types';

interface DashboardViewProps {
  settings: AppSettings;
  onNavigateToTab?: (tab: 'daily' | 'employees' | 'expenses' | 'settings') => void;
  onOpenReserve?: (prefill?: { amount: number; reason: string }) => void;
  onOpenEarnings?: () => void;
  onOpenOwnerProfit?: () => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
}

const PRODUCT_COLORS = ['#0d9488', '#0284c7', '#f59e0b', '#8b5cf6', '#ec4899'];
const CATEGORY_COLORS = ['#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6', '#6366f1'];

export const DashboardView: React.FC<DashboardViewProps> = ({
  settings,
  onNavigateToTab,
  onOpenReserve,
  onOpenEarnings,
  onOpenOwnerProfit,
  onShowToast,
}) => {
  const [periodType, setPeriodType] = useState<PeriodFilterType>('this_month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('all');
  const [selectedProductId, setSelectedProductId] = useState<string>('all');

  const [dailyEntries, setDailyEntries] = useState<DailyEntry[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productionEntries, setProductionEntries] = useState<ProductionEntry[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [reserveMovements, setReserveMovements] = useState<ReserveMovement[]>([]);

  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [dList, eList, empList, prodList, pList, payList, movList] = await Promise.all([
      db.dailyEntries.toArray(),
      db.expenses.toArray(),
      db.employees.toArray(),
      db.products.orderBy('sortOrder').toArray(),
      db.productionEntries.toArray(),
      db.payments.toArray(),
      db.reserveMovements.toArray(),
    ]);

    setDailyEntries(dList);
    setExpenses(eList);
    setEmployees(empList);
    setProducts(prodList);
    setProductionEntries(pList);
    setPayments(payList);
    setReserveMovements(movList);
  };

  // Date ranges
  const dateRange = useMemo(
    () => getDateRangeForFilter(periodType, customStart, customEnd),
    [periodType, customStart, customEnd]
  );

  // Filter entries in current period vs previous period
  const { currentEntries, prevEntries, currentExpenses, prevExpenses } = useMemo(() => {
    const curE = dailyEntries.filter(
      (e) => e.date >= dateRange.startDate && e.date <= dateRange.endDate
    );
    const prevE = dailyEntries.filter(
      (e) => e.date >= dateRange.prevStartDate && e.date <= dateRange.prevEndDate
    );
    const curExp = expenses.filter(
      (e) => e.date >= dateRange.startDate && e.date <= dateRange.endDate
    );
    const prevExp = expenses.filter(
      (e) => e.date >= dateRange.prevStartDate && e.date <= dateRange.prevEndDate
    );
    return {
      currentEntries: curE,
      prevEntries: prevE,
      currentExpenses: curExp,
      prevExpenses: prevExp,
    };
  }, [dailyEntries, expenses, dateRange]);

  // Compute metrics for a set of entries
  const computeMetrics = (
    entries: DailyEntry[],
    expensesList: Expense[],
    empFilter: string,
    prodFilter: string
  ) => {
    let salesFC = 0;
    let commissionFC = 0;
    let ownerShareFC = 0;
    let damagedFC = 0;

    let totalToSellQty = 0;
    let soldQty = 0;
    let damagedQty = 0;
    let restQty = 0;

    for (const entry of entries) {
      if (empFilter !== 'all' && entry.employeeId !== empFilter) continue;

      let entrySalesFC = 0;
      for (const item of entry.items) {
        if (prodFilter !== 'all' && item.productId !== prodFilter) continue;

        const itemSalesFC = item.sold * item.unitPrice;
        const itemDamagedFC = item.damaged * item.unitPrice;
        salesFC += itemSalesFC;
        entrySalesFC += itemSalesFC;
        damagedFC += itemDamagedFC;

        // Proportional commission and owner share if product filter is active
        if (prodFilter !== 'all') {
          commissionFC += (itemSalesFC * entry.employeeCommissionRate) / 100;
          ownerShareFC += (itemSalesFC * entry.ownerShareRate) / 100;
        }

        totalToSellQty += item.totalToSell;
        soldQty += item.sold;
        damagedQty += item.damaged;
        restQty += item.rest;
      }

      if (prodFilter === 'all') {
        commissionFC += entry.employeeCommissionFC ?? ((entrySalesFC * entry.employeeCommissionRate) / 100);
        ownerShareFC += entry.ownerShareFC ?? ((entrySalesFC * entry.ownerShareRate) / 100);
      }
    }

    const expensesFC =
      prodFilter === 'all' && empFilter === 'all'
        ? expensesList.reduce((acc, exp) => acc + exp.amountFC, 0)
        : 0; // Expenses are overhead for the whole business

    const realProfitFC = salesFC - commissionFC - expensesFC;
    const profitMarginPct = safePercentage(realProfitFC, salesFC);
    const sellRatePct = safePercentage(soldQty, totalToSellQty);
    const lossRatePct = safePercentage(damagedQty, totalToSellQty);
    const restRatePct = safePercentage(restQty, totalToSellQty);

    const expenseReserveRate = settings.expenseReservePct || 50;
    const expenseReserveFC = (salesFC * expenseReserveRate) / 100;
    const expenseVsSalesPct = safePercentage(expensesFC, salesFC);

    return {
      salesFC: Math.round(salesFC),
      commissionFC: Math.round(commissionFC),
      ownerShareFC: Math.round(ownerShareFC),
      damagedFC: Math.round(damagedFC),
      expensesFC: Math.round(expensesFC),
      realProfitFC: Math.round(realProfitFC),
      profitMarginPct,
      sellRatePct,
      lossRatePct,
      restRatePct,
      totalToSellQty,
      soldQty,
      damagedQty,
      restQty,
      expenseReserveFC: Math.round(expenseReserveFC),
      expenseVsSalesPct,
    };
  };

  const currentMetrics = useMemo(
    () => computeMetrics(currentEntries, currentExpenses, selectedEmployeeId, selectedProductId),
    [currentEntries, currentExpenses, selectedEmployeeId, selectedProductId, settings.expenseReservePct]
  );

  const prevMetrics = useMemo(
    () => computeMetrics(prevEntries, prevExpenses, selectedEmployeeId, selectedProductId),
    [prevEntries, prevExpenses, selectedEmployeeId, selectedProductId, settings.expenseReservePct]
  );

  // Metric variation calculator
  const calcVariation = (current: number, prev: number, invertGood = false) => {
    if (!prev || prev === 0) return null;
    const diff = current - prev;
    const pct = (diff / prev) * 100;
    const isUp = diff > 0;
    // For loss or expenses, going down is good!
    const isGood = invertGood ? !isUp : isUp;
    return {
      diff,
      pct,
      isUp,
      isGood,
    };
  };

  const salesVar = calcVariation(currentMetrics.salesFC, prevMetrics.salesFC);
  const commVar = calcVariation(currentMetrics.commissionFC, prevMetrics.commissionFC);
  const expVar = calcVariation(currentMetrics.expensesFC, prevMetrics.expensesFC, true);
  const profitVar = calcVariation(currentMetrics.realProfitFC, prevMetrics.realProfitFC);
  const sellRateVar = calcVariation(currentMetrics.sellRatePct, prevMetrics.sellRatePct);
  const lossRateVar = calcVariation(currentMetrics.lossRatePct, prevMetrics.lossRatePct, true);

  // Daily Chart Data: Sales & Expenses per day
  const dailyChartData = useMemo(() => {
    const map: Record<
      string,
      { date: string; displayDate: string; ventes: number; commission: number; depenses: number }
    > = {};

    currentEntries.forEach((entry) => {
      if (selectedEmployeeId !== 'all' && entry.employeeId !== selectedEmployeeId) return;

      let daySales = 0;
      let dayComm = 0;
      entry.items.forEach((item) => {
        if (selectedProductId !== 'all' && item.productId !== selectedProductId) return;
        const itemSales = item.sold * item.unitPrice;
        daySales += itemSales;
        dayComm += (itemSales * entry.employeeCommissionRate) / 100;
      });

      const actualComm =
        selectedProductId === 'all'
          ? (entry.employeeCommissionFC ?? Math.round(dayComm))
          : Math.round(dayComm);

      if (!map[entry.date]) {
        map[entry.date] = {
          date: entry.date,
          displayDate: formatDate(entry.date).slice(0, 5),
          ventes: 0,
          commission: 0,
          depenses: 0,
        };
      }
      map[entry.date].ventes += daySales;
      map[entry.date].commission += actualComm;
    });

    if (selectedEmployeeId === 'all' && selectedProductId === 'all') {
      currentExpenses.forEach((exp) => {
        if (!map[exp.date]) {
          map[exp.date] = {
            date: exp.date,
            displayDate: formatDate(exp.date).slice(0, 5),
            ventes: 0,
            commission: 0,
            depenses: 0,
          };
        }
        map[exp.date].depenses += exp.amountFC;
      });
    }

    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
  }, [currentEntries, currentExpenses, selectedEmployeeId, selectedProductId]);

  // Employee Sales comparison
  const employeeSalesData = useMemo(() => {
    const map: Record<
      string,
      { id: string; name: string; ventes: number; commissionFC: number; soldQty: number; damagedQty: number; totalQty: number }
    > = {};

    employees.forEach((emp) => {
      map[emp.id] = {
        id: emp.id,
        name: emp.name,
        ventes: 0,
        commissionFC: 0,
        soldQty: 0,
        damagedQty: 0,
        totalQty: 0,
      };
    });

    currentEntries.forEach((entry) => {
      const target = map[entry.employeeId];
      if (target) {
        let entrySales = 0;
        let entryComm = 0;
        entry.items.forEach((item) => {
          if (selectedProductId !== 'all' && item.productId !== selectedProductId) return;
          const itemSales = item.sold * item.unitPrice;
          target.ventes += itemSales;
          entrySales += itemSales;
          entryComm += (itemSales * entry.employeeCommissionRate) / 100;
          target.soldQty += item.sold;
          target.damagedQty += item.damaged;
          target.totalQty += item.totalToSell;
        });
        const actualComm =
          selectedProductId === 'all'
            ? (entry.employeeCommissionFC ?? Math.round(entryComm))
            : Math.round(entryComm);

        target.commissionFC += actualComm;
      }
    });

    return Object.values(map)
      .filter((e) => e.totalQty > 0 || e.ventes > 0)
      .sort((a, b) => b.ventes - a.ventes);
  }, [currentEntries, employees, selectedProductId]);

  // Employee Stacked Bar %: Vendu / Reste / Abîmé
  const employeePerformanceStacked = useMemo(() => {
    return employeeSalesData.map((emp) => {
      const restQty = Math.max(0, emp.totalQty - emp.soldQty - emp.damagedQty);
      return {
        name: emp.name,
        venduPct: parseFloat(safePercentage(emp.soldQty, emp.totalQty).toFixed(1)),
        restePct: parseFloat(safePercentage(restQty, emp.totalQty).toFixed(1)),
        abimePct: parseFloat(safePercentage(emp.damagedQty, emp.totalQty).toFixed(1)),
      };
    });
  }, [employeeSalesData]);

  // Product Pie Breakdown
  const productSalesData = useMemo(() => {
    const map: Record<string, { name: string; value: number }> = {};

    currentEntries.forEach((entry) => {
      if (selectedEmployeeId !== 'all' && entry.employeeId !== selectedEmployeeId) return;
      entry.items.forEach((item) => {
        if (!map[item.productId]) {
          map[item.productId] = { name: item.productName, value: 0 };
        }
        map[item.productId].value += item.sold * item.unitPrice;
      });
    });

    return Object.values(map).filter((p) => p.value > 0);
  }, [currentEntries, selectedEmployeeId]);

  // Expenses Category Breakdown
  const categoryExpensesData = useMemo(() => {
    const map: Record<string, { name: string; value: number }> = {};

    currentExpenses.forEach((exp) => {
      if (!map[exp.category]) {
        map[exp.category] = { name: exp.category, value: 0 };
      }
      map[exp.category].value += exp.amountFC;
    });

    return Object.values(map).filter((c) => c.value > 0);
  }, [currentExpenses]);

  // Cumulative Real Profit curve
  const cumulativeProfitData = useMemo(() => {
    const sorted = [...dailyChartData];
    let running = 0;
    return sorted.map((day) => {
      // Vraie commission de chaque journée (somme réelle de chaque saisie)
      const dayComm = day.commission || 0;
      const netDay = day.ventes - dayComm - day.depenses;
      running += netDay;
      return {
        displayDate: day.displayDate,
        beneficeCumule: running,
      };
    });
  }, [dailyChartData]);

  // Managerial Insights:
  // Best day, worst day, best day of week
  const { bestDay, worstDay, bestWeekdayName, avgSalesPerDay } = useMemo(() => {
    if (dailyChartData.length === 0) {
      return { bestDay: null, worstDay: null, bestWeekdayName: '-', avgSalesPerDay: 0 };
    }

    const sortedBySales = [...dailyChartData].sort((a, b) => b.ventes - a.ventes);
    const bDay = sortedBySales[0];
    const wDay = sortedBySales[sortedBySales.length - 1];

    const totalPeriodSales = dailyChartData.reduce((acc, d) => acc + d.ventes, 0);
    const avgSales = Math.round(totalPeriodSales / dailyChartData.length);

    // Group sales by day of week
    const weekdayTotals: Record<string, number> = {};
    dailyChartData.forEach((d) => {
      const dayName = getFrenchDayName(d.date);
      weekdayTotals[dayName] = (weekdayTotals[dayName] || 0) + d.ventes;
    });

    let bestWeekDay = '-';
    let maxWeekdaySales = -1;
    for (const [dayName, total] of Object.entries(weekdayTotals)) {
      if (total > maxWeekdaySales) {
        maxWeekdaySales = total;
        bestWeekDay = dayName;
      }
    }

    return {
      bestDay: bDay,
      worstDay: wDay,
      bestWeekdayName: bestWeekDay,
      avgSalesPerDay: avgSales,
    };
  }, [dailyChartData]);

  // Monthly Goal projection
  const { salesTargetProgressPct, projectedMonthEndSales } = useMemo(() => {
    const target = settings.monthlySalesTargetFC || 1000000;
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const currentDay = Math.max(1, now.getDate());

    const monthEntries = dailyEntries.filter((e) => e.date.startsWith(toISOMonth(now)));
    const currentMonthSales = monthEntries.reduce((acc, e) => acc + (e.totalSalesFC || 0), 0);

    const progressPct = safePercentage(currentMonthSales, target);
    const dailyPace = currentMonthSales / currentDay;
    const projected = Math.round(dailyPace * daysInMonth);

    return {
      salesTargetProgressPct: progressPct,
      projectedMonthEndSales: projected,
    };
  }, [dailyEntries, settings.monthlySalesTargetFC]);

  // Break-even point (Seuil de rentabilité)
  // How much sales needed to cover expenses given current gross margin
  const breakEvenSalesFC = useMemo(() => {
    // If expenses are E, and reserve/comm takes (100 - ownerShareRate),
    // Sales required = expenses / (ownerShareRate / 100)
    const reserveRate = (settings.expenseReservePct || 50) / 100;
    if (reserveRate <= 0) return 0;
    return Math.round(currentMetrics.expensesFC / reserveRate);
  }, [currentMetrics.expensesFC, settings.expenseReservePct]);

  // Cumulative Reserve Calculation (depuis le tout début)
  const cumulativeReserve = useMemo(() => {
    return calculateReserveBalance(
      reserveMovements,
      dailyEntries,
      expenses,
      settings.expenseReservePct || 50
    );
  }, [reserveMovements, dailyEntries, expenses, settings.expenseReservePct]);

  // Smart Alerts
  const smartAlerts = useMemo(() => {
    const alerts: Array<{ id: string; type: 'danger' | 'warning' | 'info'; title: string; message: string }> = [];

    // 1. Loss rate too high
    if (currentMetrics.lossRatePct > (settings.lossAlertThresholdPct || 5.0)) {
      alerts.push({
        id: 'loss_high',
        type: 'danger',
        title: 'Taux de perte anormalement élevé',
        message: `Le taux de yaourts abîmés est de ${formatPercent(
          currentMetrics.lossRatePct
        )}, dépassant votre seuil de tolérance de ${formatPercent(
          settings.lossAlertThresholdPct
        )}. Perte nette : ${formatFC(currentMetrics.damagedFC, settings.currency)}.`,
      });
    }



    // 3. Negative or low house stock
    products.forEach((prod) => {
      const prodSum = productionEntries.reduce((acc, p) => {
        const it = p.items.find((i) => i.productId === prod.id);
        return acc + (it ? it.producedQty : 0);
      }, 0);
      const delivSum = dailyEntries.reduce((acc, d) => {
        const it = d.items.find((i) => i.productId === prod.id);
        return acc + (it ? it.delivered : 0);
      }, 0);
      const houseStock = prodSum - delivSum;
      if (houseStock < 0) {
        alerts.push({
          id: `neg_stock_${prod.id}`,
          type: 'danger',
          title: `Stock maison négatif (${prod.name})`,
          message: `Le stock calculé pour ${prod.name} est de ${houseStock}. Pensez à enregistrer la production.`,
        });
      }
    });

    // 4. End of month payment due check
    const currentMonthStr = toISOMonth(new Date());
    employees
      .filter((e) => !e.isArchived)
      .forEach((emp) => {
        const empEntries = dailyEntries.filter(
          (d) => d.employeeId === emp.id && d.date.startsWith(currentMonthStr)
        );
        const earnedComm = empEntries.reduce((acc, d) => acc + (d.employeeCommissionFC || 0), 0);
        const empPayments = payments.filter(
          (p) => p.employeeId === emp.id && p.month === currentMonthStr
        );
        const paidComm = empPayments.reduce((acc, p) => acc + (p.amountFC || 0), 0);
        const balance = earnedComm - paidComm;
        if (balance > 0 && new Date().getDate() >= 25) {
          alerts.push({
            id: `pay_due_${emp.id}`,
            type: 'warning',
            title: `Règlement dû pour ${emp.name}`,
            message: `Fin de mois proche : ${formatFC(balance, settings.currency)} reste à verser sur sa commission.`,
          });
        }
      });

    // 5. Old backup reminder
    if (!settings.lastBackupDate) {
      alerts.push({
        id: 'no_backup',
        type: 'info',
        title: 'Première sauvegarde recommandée',
        message: 'Vous n’avez pas encore exporté de sauvegarde JSON de vos données.',
      });
    }

    return alerts;
  }, [
    currentMetrics,
    settings,
    products,
    productionEntries,
    dailyEntries,
    employees,
    payments,
  ]);

  const currency = settings.currency || 'FC';

  // Export Monthly Management Report PDF
  const handleExportMonthReportPDF = async () => {
    setIsGeneratingPdf(true);
    try {
      const monthStr = toISOMonth(new Date());
      await generateMonthlyManagementReportPDF({
        month: monthStr,
        settings,
        stats: {
          totalSalesFC: currentMetrics.salesFC,
          totalCommissionFC: currentMetrics.commissionFC,
          totalExpensesFC: currentMetrics.expensesFC,
          realProfitFC: currentMetrics.realProfitFC,
          profitMarginPct: currentMetrics.profitMarginPct,
          soldQty: currentMetrics.soldQty,
          damagedQty: currentMetrics.damagedQty,
          damagedValueFC: currentMetrics.damagedFC,
          totalToSellQty: currentMetrics.totalToSellQty,
          sellRatePct: currentMetrics.sellRatePct,
          lossRatePct: currentMetrics.lossRatePct,
          expenseReserveFC: currentMetrics.expenseReserveFC,
          expenseVsReserveBalanceFC: currentMetrics.expenseReserveFC - currentMetrics.expensesFC,
        },
        employeeBreakdown: employeeSalesData.map((e) => ({
          name: e.name,
          salesFC: e.ventes,
          commissionFC: e.commissionFC,
          sellRatePct: safePercentage(e.soldQty, e.totalQty),
          lossRatePct: safePercentage(e.damagedQty, e.totalQty),
        })),
        categoryExpenses: categoryExpensesData.map((c) => ({
          category: c.name,
          amountFC: c.value,
        })),
      });
      onShowToast('success', 'Rapport mensuel PDF généré avec succès.');
    } catch (e: any) {
      onShowToast('error', 'Erreur génération rapport PDF : ' + e.message);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <div className="pb-28 pt-3 px-4 max-w-lg mx-auto space-y-5">
      {/* ALERTE ROUGE : si soldeCapitalFC < 0 */}
      {cumulativeReserve.soldeCapitalFC < 0 && (
        <div className="p-3.5 rounded-2xl bg-rose-600 text-white shadow-md flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <AlertTriangle className="w-5 h-5 shrink-0 text-white" />
            <div>
              <span className="font-extrabold block">Alerte Caisse Capital</span>
              <p className="text-[11px] text-rose-100 leading-snug">
                Il manque {formatFC(cumulativeReserve.manqueFC, currency)} dans la Caisse Capital : ajoute{' '}
                {formatFC(cumulativeReserve.manqueFC, currency)} de ton argent personnel.
              </p>
            </div>
          </div>
          {onOpenReserve && (
            <button
              type="button"
              onClick={() =>
                onOpenReserve({
                  amount: cumulativeReserve.manqueFC,
                  reason: 'Complément argent personnel',
                })
              }
              className="px-3 py-2 rounded-xl bg-white text-rose-700 font-extrabold hover:bg-rose-50 active:scale-95 transition-all shrink-0 min-h-[38px] text-xs shadow-xs"
            >
              Ajouter {formatFC(cumulativeReserve.manqueFC, currency)}
            </button>
          )}
        </div>
      )}

      {/* Top Header & Period Filter */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight">
              Tableau de Bord
            </h2>
            <p className="text-xs text-slate-500 font-medium">
              Gestion commerciale et financière
            </p>
          </div>

          <div className="flex items-center gap-2">
            {onOpenReserve && (
              <button
                type="button"
                onClick={() => onOpenReserve()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold shadow-xs active:scale-95 transition-all min-h-[44px]"
              >
                <Wallet className="w-4 h-4" />
                <span>Caisse</span>
              </button>
            )}

            <button
              type="button"
              disabled={isGeneratingPdf || dailyEntries.length === 0}
              onClick={handleExportMonthReportPDF}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold shadow-xs active:scale-95 transition-all min-h-[44px]"
            >
              <FileText className="w-4 h-4 text-teal-400" />
              <span>Rapport PDF</span>
            </button>
          </div>
        </div>

        {/* Period Selector Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar bg-slate-200/70 p-1 rounded-2xl">
          {[
            { id: 'today', label: 'Aujourd’hui' },
            { id: 'this_week', label: 'Cette semaine' },
            { id: 'this_month', label: 'Ce mois' },
            { id: 'last_month', label: 'Mois dernier' },
            { id: 'custom', label: 'Personnalisée' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setPeriodType(tab.id as PeriodFilterType)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all min-h-[36px] ${
                periodType === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Custom date range row */}
        {periodType === 'custom' && (
          <div className="p-3 bg-white rounded-2xl border border-slate-200/90 shadow-2xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-teal-700" />
                Choisir une date précise ou une période
              </span>
              {(customStart || customEnd) && (
                <button
                  type="button"
                  onClick={() => {
                    const todayStr = toISODate(new Date());
                    setCustomStart(todayStr);
                    setCustomEnd(todayStr);
                  }}
                  className="text-[10px] font-bold text-teal-700 hover:text-teal-800"
                >
                  Date du jour
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                  Du (ou date unique)
                </label>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCustomStart(val);
                    if (!customEnd || customEnd < val) {
                      setCustomEnd(val);
                    }
                  }}
                  className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-slate-50 focus:bg-white focus:outline-teal-700"
                />
              </div>

              <span className="text-xs font-bold text-slate-400 mt-4">à</span>

              <div className="flex-1">
                <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                  Au
                </label>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCustomEnd(val);
                    if (!customStart) {
                      setCustomStart(val);
                    }
                  }}
                  className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-slate-50 focus:bg-white focus:outline-teal-700"
                />
              </div>
            </div>

            {/* Quick date shortcuts */}
            <div className="flex items-center gap-1.5 pt-1 overflow-x-auto no-scrollbar text-[10px]">
              <span className="text-slate-400 shrink-0 font-medium">Accès rapide :</span>
              <button
                type="button"
                onClick={() => {
                  const todayStr = toISODate(new Date());
                  setCustomStart(todayStr);
                  setCustomEnd(todayStr);
                }}
                className="px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold shrink-0"
              >
                Aujourd’hui
              </button>
              <button
                type="button"
                onClick={() => {
                  const y = new Date();
                  y.setDate(y.getDate() - 1);
                  const yStr = toISODate(y);
                  setCustomStart(yStr);
                  setCustomEnd(yStr);
                }}
                className="px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold shrink-0"
              >
                Hier
              </button>
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  const firstDay = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
                  const lastDay = toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
                  setCustomStart(firstDay);
                  setCustomEnd(lastDay);
                }}
                className="px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold shrink-0"
              >
                Tout ce mois
              </button>
            </div>
          </div>
        )}

        {/* Optional Employee & Product Filters */}
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-xl border border-slate-200/90 shadow-2xs">
              <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <select
                value={selectedEmployeeId}
                onChange={(e) => setSelectedEmployeeId(e.target.value)}
                className="w-full text-xs font-semibold text-slate-800 bg-transparent focus:outline-none"
              >
                <option value="all">Tous/Toutes vendeurs(ses)</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex-1">
            <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-xl border border-slate-200/90 shadow-2xs">
              <Package className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                className="w-full text-xs font-semibold text-slate-800 bg-transparent focus:outline-none"
              >
                <option value="all">Tous produits</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Smart Alerts Banner (if any) */}
      {smartAlerts.length > 0 && (
        <div className="space-y-2">
          {smartAlerts.map((alert) => (
            <div
              key={alert.id}
              className={`p-3 rounded-2xl border flex items-start gap-2.5 shadow-2xs text-xs ${
                alert.type === 'danger'
                  ? 'bg-rose-50/90 border-rose-300 text-rose-950'
                  : alert.type === 'warning'
                  ? 'bg-amber-50/90 border-amber-300 text-amber-950'
                  : 'bg-teal-50/90 border-teal-300 text-teal-950'
              }`}
            >
              <AlertTriangle
                className={`w-4 h-4 shrink-0 mt-0.5 ${
                  alert.type === 'danger'
                    ? 'text-rose-600'
                    : alert.type === 'warning'
                    ? 'text-amber-600'
                    : 'text-teal-700'
                }`}
              />
              <div className="flex-1 min-w-0">
                <span className="font-extrabold block leading-tight">{alert.title}</span>
                <p className="mt-0.5 text-[11px] leading-snug">{alert.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty Database State if no sales recorded anywhere */}
      {dailyEntries.length === 0 && (
        <EmptyState
          icon={<Award className="w-8 h-8 text-teal-700" />}
          title="Prêt à démarrer l’activité"
          description="L'application est configurée pour fonctionner 100% hors ligne. Enregistrez votre première journée pour alimenter ce tableau de bord."
          actionLabel="Enregistrer une vente"
          onAction={() => onNavigateToTab && onNavigateToTab('daily')}
        />
      )}

      {/* SECTION A: KEY PERFORMANCE INDICATORS (KPIs) */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">
            Indicateurs Clés & Bénéfices
          </h3>
          <span className="text-[11px] font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded-lg border border-teal-200/80 font-mono">
            {dateRange.startDate === dateRange.endDate
              ? formatDate(dateRange.startDate)
              : `${formatDate(dateRange.startDate)} → ${formatDate(dateRange.endDate)}`}
          </span>
        </div>

        {/* Hero Card: Bénéfice Réel */}
        <div className="p-4 rounded-3xl bg-slate-900 text-white shadow-md relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Bénéfice Réel Net
            </span>
            <span className="text-[10px] text-teal-300 font-mono bg-slate-800 px-2 py-0.5 rounded-md">
              Ventes − Comm. − Dépenses
            </span>
          </div>

          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-3xl font-black font-mono tracking-tight text-white">
              {formatFC(currentMetrics.realProfitFC, currency)}
            </span>
            <div className="text-right">
              <span className="text-xs font-bold text-teal-400 block font-mono">
                Marge : {formatPercent(currentMetrics.profitMarginPct)}
              </span>
            </div>
          </div>

          {/* Period variation */}
          {profitVar && (
            <div className="mt-2 pt-2 border-t border-slate-800 flex items-center gap-1.5 text-xs font-semibold">
              {profitVar.isUp ? (
                <TrendingUp className="w-4 h-4 text-emerald-400" />
              ) : (
                <TrendingDown className="w-4 h-4 text-rose-400" />
              )}
              <span className={profitVar.isGood ? 'text-emerald-400' : 'text-rose-400'}>
                {profitVar.isUp ? '+' : ''}
                {formatPercent(profitVar.pct)}
              </span>
              <span className="text-slate-400 text-[11px]">vs période précédente</span>
            </div>
          )}
        </div>

        {/* 2x2 Grid of Main Financials */}
        <div className="grid grid-cols-2 gap-2.5">
          {/* Ventes Totales */}
          <div className="p-3.5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs">
            <span className="text-[11px] font-bold text-slate-500 uppercase block">
              Ventes Totales
            </span>
            <span className="text-base font-extrabold text-slate-900 font-mono mt-0.5 block">
              {formatFC(currentMetrics.salesFC, currency)}
            </span>
            {salesVar && (
              <div className="flex items-center gap-1 mt-1 text-[11px] font-bold font-mono">
                {salesVar.isUp ? (
                  <TrendingUp className="w-3 h-3 text-emerald-600" />
                ) : (
                  <TrendingDown className="w-3 h-3 text-rose-600" />
                )}
                <span className={salesVar.isGood ? 'text-emerald-700' : 'text-rose-700'}>
                  {salesVar.isUp ? '+' : ''}
                  {formatPercent(salesVar.pct)}
                </span>
              </div>
            )}
          </div>

          {/* Commissions Vendeurs(ses) */}
          <div
            onClick={onOpenEarnings}
            role="button"
            tabIndex={0}
            className="p-3.5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs cursor-pointer hover:border-teal-400 active:scale-[0.99] transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-teal-700 uppercase block">
                  Commissions dues
                </span>
                <span className="text-[9px] font-bold text-teal-700 bg-teal-50 border border-teal-200/80 px-1.5 py-0.5 rounded-md">
                  Gains →
                </span>
              </div>
              <span className="text-base font-extrabold text-teal-900 font-mono mt-0.5 block">
                {formatFC(currentMetrics.commissionFC, currency)}
              </span>
              {commVar && (
                <div className="flex items-center gap-1 mt-1 text-[11px] font-bold font-mono">
                  {commVar.isUp ? (
                    <TrendingUp className="w-3 h-3 text-teal-700" />
                  ) : (
                    <TrendingDown className="w-3 h-3 text-slate-500" />
                  )}
                  <span className="text-slate-600">
                    {commVar.isUp ? '+' : ''}
                    {formatPercent(commVar.pct)}
                  </span>
                </div>
              )}
            </div>
            <div className="mt-1.5 pt-1.5 border-t border-slate-100 text-[10px] text-teal-700 font-medium">
              <span>Voir les gains des vendeurs(ses) →</span>
            </div>
          </div>

          {/* Dépenses réelles */}
          <div className="p-3.5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs">
            <span className="text-[11px] font-bold text-slate-500 uppercase block">
              Dépenses totales
            </span>
            <span className="text-base font-extrabold text-slate-900 font-mono mt-0.5 block">
              {formatFC(currentMetrics.expensesFC, currency)}
            </span>
            {expVar && (
              <div className="flex items-center gap-1 mt-1 text-[11px] font-bold font-mono">
                {expVar.isUp ? (
                  <TrendingUp className="w-3 h-3 text-rose-600" />
                ) : (
                  <TrendingDown className="w-3 h-3 text-emerald-600" />
                )}
                <span className={expVar.isGood ? 'text-emerald-700' : 'text-rose-700'}>
                  {expVar.isUp ? '+' : ''}
                  {formatPercent(expVar.pct)}
                </span>
              </div>
            )}
          </div>

          {/* Mes bénéfices (Gérant) */}
          <div
            onClick={onOpenOwnerProfit}
            role="button"
            tabIndex={0}
            className="p-3.5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs cursor-pointer hover:border-emerald-400 active:scale-[0.99] transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-emerald-700 uppercase block">
                  Mes bénéfices (Gérant)
                </span>
                <span className="text-[9px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200/80 px-1.5 py-0.5 rounded-md">
                  Détail →
                </span>
              </div>
              <span className="text-base font-extrabold font-mono mt-0.5 block text-emerald-900">
                {formatFC(currentMetrics.ownerShareFC, currency)}
              </span>
            </div>

            <div className="mt-1.5 pt-1.5 border-t border-slate-100 text-[10px] text-slate-500">
              <span>Ventes × ma part % (dépenses prises en charge par la Caisse)</span>
            </div>
          </div>
        </div>

        {/* Operational Ratios & Progress Gauges */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs space-y-3.5">
          {/* Taux de vente */}
          <div>
            <div className="flex items-center justify-between text-xs font-bold mb-1">
              <span className="text-slate-700">Taux de Vente ({currentMetrics.soldQty} vendus / {currentMetrics.totalToSellQty} total)</span>
              <span className="text-emerald-700 font-mono font-extrabold">
                {formatPercent(currentMetrics.sellRatePct)}
              </span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  currentMetrics.sellRatePct >= 80
                    ? 'bg-emerald-600'
                    : currentMetrics.sellRatePct >= 50
                    ? 'bg-amber-500'
                    : 'bg-rose-500'
                }`}
                style={{ width: `${Math.min(100, currentMetrics.sellRatePct)}%` }}
              />
            </div>
          </div>

          {/* Taux de perte (abîmé) */}
          <div>
            <div className="flex items-center justify-between text-xs font-bold mb-1">
              <span className="text-slate-700">
                Taux de Perte ({currentMetrics.damagedQty} abîmés · {formatFC(currentMetrics.damagedFC, currency)})
              </span>
              <span
                className={`font-mono font-extrabold ${
                  currentMetrics.lossRatePct > (settings.lossAlertThresholdPct || 5)
                    ? 'text-rose-600'
                    : 'text-slate-700'
                }`}
              >
                {formatPercent(currentMetrics.lossRatePct)}
              </span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  currentMetrics.lossRatePct <= 3
                    ? 'bg-emerald-600'
                    : currentMetrics.lossRatePct <= (settings.lossAlertThresholdPct || 5)
                    ? 'bg-amber-500'
                    : 'bg-rose-600'
                }`}
                style={{ width: `${Math.min(100, currentMetrics.lossRatePct * 3)}%` }}
              />
            </div>
          </div>

          {/* Dépenses vs Caisse normale */}
          <div>
            <div className="flex items-center justify-between text-xs font-bold mb-1">
              <span className="text-slate-700">
                Dépenses en % des ventes (Caisse normale : {settings.expenseReservePct} %)
              </span>
              <span
                className={`font-mono font-extrabold ${
                  currentMetrics.expenseVsSalesPct > (settings.expenseReservePct || 50)
                    ? 'text-rose-600'
                    : 'text-emerald-700'
                }`}
              >
                {formatPercent(currentMetrics.expenseVsSalesPct)}
              </span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  currentMetrics.expenseVsSalesPct > (settings.expenseReservePct || 50)
                    ? 'bg-rose-600'
                    : 'bg-teal-600'
                }`}
                style={{ width: `${Math.min(100, currentMetrics.expenseVsSalesPct)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* SECTION B: CHARTS (GRAPHICAL ANALYSIS) */}
      <div className="space-y-4">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">
          Graphiques d’Analyse
        </h3>

        {/* 1. Curve: Ventes par jour vs Dépenses */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-800">
              Ventes et Dépenses par jour
            </h4>
            <div className="flex items-center gap-3 text-[10px] font-bold">
              <span className="flex items-center gap-1 text-teal-700">
                <span className="w-2.5 h-2.5 rounded-full bg-teal-600 inline-block" />
                Ventes
              </span>
              <span className="flex items-center gap-1 text-rose-600">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
                Dépenses
              </span>
            </div>
          </div>

          {dailyChartData.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              Aucune donnée pour cette période
            </div>
          ) : (
            <div className="h-48 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyChartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <XAxis dataKey="displayDate" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip
                    formatter={(val: any) => [formatFC(Number(val), currency), '']}
                    labelFormatter={(label) => `Date : ${label}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="ventes"
                    stroke="#0d9488"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                    name="Ventes"
                  />
                  <Line
                    type="monotone"
                    dataKey="depenses"
                    stroke="#ef4444"
                    strokeWidth={2}
                    dot={{ r: 2.5 }}
                    name="Dépenses"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* 2. Bar Chart: Ventes comparées par vendeur(se) */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs space-y-2">
          <h4 className="text-xs font-bold text-slate-800">
            Ventes comparées par vendeur(se) ({currency})
          </h4>

          {employeeSalesData.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              Aucune donnée de vendeur(se)
            </div>
          ) : (
            <div className="h-44 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={employeeSalesData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(val: any) => [formatFC(Number(val), currency), 'Ventes']} />
                  <Bar dataKey="ventes" fill="#0d9488" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* 3. Product Sales (Donut) & Expenses (Donut) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Products Pie */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-3.5 shadow-2xs flex flex-col justify-between">
            <h4 className="text-xs font-bold text-slate-800 mb-2">
              Ventes par produit
            </h4>
            {productSalesData.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">Aucune vente</div>
            ) : (
              <>
                <div className="h-36 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={productSalesData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={32}
                        outerRadius={55}
                        paddingAngle={3}
                      >
                        {productSalesData.map((_, idx) => (
                          <Cell
                            key={`cell-${idx}`}
                            fill={PRODUCT_COLORS[idx % PRODUCT_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip formatter={(val: any) => [formatFC(Number(val), currency), '']} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap justify-center gap-2 pt-2 text-[10px] font-semibold">
                  {productSalesData.map((p, idx) => (
                    <span key={p.name} className="flex items-center gap-1">
                      <span
                        className="w-2 h-2 rounded-full inline-block"
                        style={{ backgroundColor: PRODUCT_COLORS[idx % PRODUCT_COLORS.length] }}
                      />
                      {p.name}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Category Expenses Pie */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-3.5 shadow-2xs flex flex-col justify-between">
            <h4 className="text-xs font-bold text-slate-800 mb-2">
              Dépenses par catégorie
            </h4>
            {categoryExpensesData.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">Aucune dépense</div>
            ) : (
              <>
                <div className="h-36 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryExpensesData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={32}
                        outerRadius={55}
                        paddingAngle={3}
                      >
                        {categoryExpensesData.map((_, idx) => (
                          <Cell
                            key={`cat-cell-${idx}`}
                            fill={CATEGORY_COLORS[idx % CATEGORY_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip formatter={(val: any) => [formatFC(Number(val), currency), '']} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap justify-center gap-2 pt-2 text-[10px] font-semibold">
                  {categoryExpensesData.map((c, idx) => (
                    <span key={c.name} className="flex items-center gap-1 truncate max-w-[110px]">
                      <span
                        className="w-2 h-2 rounded-full inline-block shrink-0"
                        style={{ backgroundColor: CATEGORY_COLORS[idx % CATEGORY_COLORS.length] }}
                      />
                      <span className="truncate">{c.name}</span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* 4. Stacked Bars: Vendu / Reste / Abîmé par vendeur(se) (%) */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-800">
              Répartition Vendu / Reste / Abîmé (%)
            </h4>
            <div className="flex items-center gap-2 text-[10px] font-bold">
              <span className="text-emerald-700">■ Vendu</span>
              <span className="text-slate-500">■ Reste</span>
              <span className="text-rose-600">■ Abîmé</span>
            </div>
          </div>

          {employeePerformanceStacked.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">Aucun(e) vendeur(se)</div>
          ) : (
            <div className="h-44 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={employeePerformanceStacked}
                  margin={{ top: 5, right: 5, left: -20, bottom: 0 }}
                >
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                  <Tooltip formatter={(val: any) => [`${val} %`, '']} />
                  <Bar dataKey="venduPct" stackId="a" fill="#10b981" name="Vendu %" />
                  <Bar dataKey="restePct" stackId="a" fill="#94a3b8" name="Reste %" />
                  <Bar dataKey="abimePct" stackId="a" fill="#ef4444" name="Abîmé %" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* 5. Cumulative Real Profit Evolution */}
        {cumulativeProfitData.length > 1 && (
          <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-2xs space-y-2">
            <h4 className="text-xs font-bold text-slate-800">
              Évolution du bénéfice réel cumulé ({currency})
            </h4>
            <div className="h-40 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cumulativeProfitData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <XAxis dataKey="displayDate" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(val: any) => [formatFC(Number(val), currency), 'Cumul']} />
                  <Line
                    type="monotone"
                    dataKey="beneficeCumule"
                    stroke="#047857"
                    strokeWidth={2.5}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* SECTION C: MANAGERIAL INSIGHTS */}
      <div className="space-y-3 pt-1">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">
          Analyses de Gestionnaire
        </h3>

        {/* Monthly Target Progress & Projection Card */}
        <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-2xs space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Target className="w-4 h-4 text-teal-700" />
              <h4 className="text-xs font-bold text-slate-800">
                Objectif Mensuel de Ventes
              </h4>
            </div>
            <span className="text-xs font-extrabold font-mono text-teal-800">
              {formatPercent(salesTargetProgressPct)}
            </span>
          </div>

          <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
            <div
              className="bg-teal-700 h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, salesTargetProgressPct)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
            <span>Cible : {formatFC(settings.monthlySalesTargetFC || 1000000, currency)}</span>
            <span>
              Projection fin de mois :{' '}
              <strong className="text-slate-800">
                {formatFC(projectedMonthEndSales, currency)}
              </strong>
            </span>
          </div>
        </div>

        {/* Break-even point & Daily average */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="p-3.5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs">
            <span className="text-[10px] font-bold text-slate-500 uppercase block">
              Seuil de Rentabilité
            </span>
            <span className="text-sm font-extrabold text-slate-900 font-mono mt-0.5 block">
              {formatFC(breakEvenSalesFC, currency)}
            </span>
            <span className="text-[10px] text-slate-400 mt-1 block">
              Ventes nécessaires pour couvrir les charges
            </span>
          </div>

          <div className="p-3.5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs">
            <span className="text-[10px] font-bold text-slate-500 uppercase block">
              Moyenne Ventes / Jour
            </span>
            <span className="text-sm font-extrabold text-slate-900 font-mono mt-0.5 block">
              {formatFC(avgSalesPerDay, currency)}
            </span>
            <span className="text-[10px] text-slate-400 mt-1 block">
              Sur les journées actives
            </span>
          </div>
        </div>

        {/* Best / Worst Day / Profitable day of week */}
        <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-2xs space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
            <Clock className="w-4 h-4 text-teal-700" />
            <span>Rythme de vente & Calendrier</span>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1 text-center text-xs">
            <div className="bg-slate-50 p-2 rounded-xl">
              <span className="text-[10px] text-slate-500 block font-semibold">Meilleur jour</span>
              <span className="font-bold text-emerald-700 font-mono block">
                {bestDay ? formatDate(bestDay.date) : '-'}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {bestDay ? formatFC(bestDay.ventes, currency) : ''}
              </span>
            </div>

            <div className="bg-slate-50 p-2 rounded-xl">
              <span className="text-[10px] text-slate-500 block font-semibold">Pire jour</span>
              <span className="font-bold text-rose-600 font-mono block">
                {worstDay ? formatDate(worstDay.date) : '-'}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {worstDay ? formatFC(worstDay.ventes, currency) : ''}
              </span>
            </div>

            <div className="bg-slate-50 p-2 rounded-xl">
              <span className="text-[10px] text-slate-500 block font-semibold">Jour le plus fort</span>
              <span className="font-bold text-teal-800 block truncate">
                {bestWeekdayName}
              </span>
              <span className="text-[10px] text-slate-400">de la semaine</span>
            </div>
          </div>
        </div>

        {/* Employee Ranking Table */}
        <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-2xs">
          <div className="p-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Award className="w-4 h-4 text-teal-700" />
              <h4 className="text-xs font-bold text-slate-800">
                Classement des Vendeurs(ses)
              </h4>
            </div>
          </div>

          {employeeSalesData.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-400">
              Aucun(e) vendeur(se) actif(ve) sur cette période
            </div>
          ) : (
            <div className="divide-y divide-slate-100 text-xs">
              {employeeSalesData.map((emp, idx) => {
                const sellRate = safePercentage(emp.soldQty, emp.totalQty);
                const lossRate = safePercentage(emp.damagedQty, emp.totalQty);

                return (
                  <div key={emp.name} className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-700 font-bold text-[11px] flex items-center justify-center font-mono">
                        {idx + 1}
                      </span>
                      <div>
                        <span className="font-bold text-slate-900 block">{emp.name}</span>
                        <span className="text-[11px] text-slate-500 font-mono">
                          Taux vente : {formatPercent(sellRate)} · Perte : {formatPercent(lossRate)}
                        </span>
                      </div>
                    </div>

                    <span className="font-extrabold text-slate-900 font-mono">
                      {formatFC(emp.ventes, currency)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
