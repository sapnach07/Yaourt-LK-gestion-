import React, { useState, useMemo } from 'react';
import {
  X,
  Warehouse,
  Package,
  Calendar,
  AlertTriangle,
  Users,
  UserCheck,
  TrendingUp,
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  Layers,
  ChevronRight,
  Filter,
} from 'lucide-react';
import {
  formatDate,
  formatFC,
  formatNumber,
  formatPercent,
  safePercentage,
  toISODate,
  getDateRangeForFilter,
} from '../../utils/formatters';
import { calculateProductStock } from '../../utils/stockCalculator';
import type {
  Product,
  ProductionEntry,
  DailyEntry,
  PersonalSale,
  Employee,
  PeriodFilterType,
} from '../../types';

interface StockDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  productionEntries: ProductionEntry[];
  dailyEntries: DailyEntry[];
  personalSales: PersonalSale[];
  employees: Employee[];
  currency: string;
  initialPeriodType?: PeriodFilterType;
  initialCustomStart?: string;
  initialCustomEnd?: string;
  initialProductId?: string;
  onNavigateToTab?: (tab: 'daily' | 'employees' | 'expenses' | 'settings') => void;
}

export const StockDetailModal: React.FC<StockDetailModalProps> = ({
  isOpen,
  onClose,
  products,
  productionEntries,
  dailyEntries,
  personalSales,
  employees,
  currency,
  initialPeriodType = 'this_month',
  initialCustomStart = '',
  initialCustomEnd = '',
  initialProductId = 'all',
  onNavigateToTab,
}) => {
  const [periodType, setPeriodType] = useState<PeriodFilterType>(initialPeriodType);
  const [customStart, setCustomStart] = useState<string>(initialCustomStart);
  const [customEnd, setCustomEnd] = useState<string>(initialCustomEnd);
  const [selectedProductId, setSelectedProductId] = useState<string>(initialProductId);
  const [activeTab, setActiveTab] = useState<'products' | 'employees' | 'movements'>('products');

  // Compute date range for the modal
  const dateRange = useMemo(
    () => getDateRangeForFilter(periodType, customStart, customEnd),
    [periodType, customStart, customEnd]
  );

  // Filter entries within the period
  const periodProductions = useMemo(
    () =>
      productionEntries.filter(
        (p) => p.date >= dateRange.startDate && p.date <= dateRange.endDate
      ),
    [productionEntries, dateRange]
  );

  const periodDailyEntries = useMemo(
    () =>
      dailyEntries.filter(
        (d) => d.date >= dateRange.startDate && d.date <= dateRange.endDate
      ),
    [dailyEntries, dateRange]
  );

  const periodPersonalSales = useMemo(
    () =>
      personalSales.filter(
        (ps) => ps.date >= dateRange.startDate && ps.date <= dateRange.endDate
      ),
    [personalSales, dateRange]
  );

  // Real-time stock across all time for active products
  const realTimeStockMap = useMemo(() => {
    const map = new Map<
      string,
      {
        totalProduced: number;
        totalDelivered: number;
        totalRest: number;
        totalSoldByOwner: number;
        houseStock: number;
      }
    >();

    products.forEach((prod) => {
      const stock = calculateProductStock(prod.id, productionEntries, dailyEntries, personalSales);
      map.set(prod.id, stock);
    });

    return map;
  }, [products, productionEntries, dailyEntries, personalSales]);

  // Period statistics per product
  const periodProductStats = useMemo(() => {
    return products
      .filter((prod) => selectedProductId === 'all' || prod.id === selectedProductId)
      .map((prod) => {
        // Produced in period
        let producedInPeriod = 0;
        periodProductions.forEach((p) => {
          const it = p.items.find((i) => i.productId === prod.id);
          if (it) producedInPeriod += it.producedQty || 0;
        });

        // Delivered in period
        let deliveredInPeriod = 0;
        let soldByEmployeesInPeriod = 0;
        let damagedInPeriod = 0;
        let restInPeriod = 0;
        periodDailyEntries.forEach((d) => {
          const it = d.items.find((i) => i.productId === prod.id);
          if (it) {
            deliveredInPeriod += it.delivered || 0;
            soldByEmployeesInPeriod += it.sold || 0;
            damagedInPeriod += it.damaged || 0;
            const isValidated = !d.status || d.status === 'validated';
            if (isValidated) {
              restInPeriod += it.rest || 0;
            }
          }
        });

        // Sold by owner in period
        let soldByOwnerInPeriod = 0;
        periodPersonalSales.forEach((ps) => {
          const it = ps.items.find((i) => i.productId === prod.id);
          if (it) soldByOwnerInPeriod += it.soldQty || 0;
        });

        // Net house stock flow in period = +Produced -Delivered +Rest -SoldByOwner
        const netHouseFlowInPeriod =
          producedInPeriod - deliveredInPeriod + restInPeriod - soldByOwnerInPeriod;

        // Total sales in period (employees + owner)
        const totalSoldInPeriod = soldByEmployeesInPeriod + soldByOwnerInPeriod;

        // Current real-time numbers
        const rt = realTimeStockMap.get(prod.id) || {
          totalProduced: 0,
          totalDelivered: 0,
          totalRest: 0,
          totalSoldByOwner: 0,
          houseStock: 0,
        };

        return {
          product: prod,
          producedInPeriod,
          deliveredInPeriod,
          soldByEmployeesInPeriod,
          soldByOwnerInPeriod,
          totalSoldInPeriod,
          damagedInPeriod,
          restInPeriod,
          netHouseFlowInPeriod,
          realTimeHouseStock: rt.houseStock,
          realTimeTotalRest: rt.totalRest,
          realTimeTotalStock: rt.houseStock,
        };
      });
  }, [
    products,
    selectedProductId,
    periodProductions,
    periodDailyEntries,
    periodPersonalSales,
    realTimeStockMap,
  ]);

  // Overall totals for the period
  const periodTotals = useMemo(() => {
    let produced = 0;
    let delivered = 0;
    let soldEmployees = 0;
    let soldOwner = 0;
    let damaged = 0;
    let rest = 0;
    let netHouse = 0;
    let currentHouse = 0;
    let currentRest = 0;

    periodProductStats.forEach((p) => {
      produced += p.producedInPeriod;
      delivered += p.deliveredInPeriod;
      soldEmployees += p.soldByEmployeesInPeriod;
      soldOwner += p.soldByOwnerInPeriod;
      damaged += p.damagedInPeriod;
      rest += p.restInPeriod;
      netHouse += p.netHouseFlowInPeriod;
      currentHouse += p.realTimeHouseStock;
      currentRest += p.realTimeTotalRest;
    });

    return {
      produced,
      delivered,
      soldEmployees,
      soldOwner,
      totalSold: soldEmployees + soldOwner,
      damaged,
      rest,
      netHouse,
      currentHouse,
      currentRest,
      currentTotal: currentHouse,
    };
  }, [periodProductStats]);

  // Seller breakdown for the period
  const sellerStats = useMemo(() => {
    return employees
      .filter((e) => !e.isArchived)
      .map((emp) => {
        const empEntries = periodDailyEntries.filter((d) => d.employeeId === emp.id);
        let delivered = 0;
        let sold = 0;
        let damaged = 0;

        empEntries.forEach((entry) => {
          entry.items.forEach((item) => {
            if (selectedProductId !== 'all' && item.productId !== selectedProductId) return;
            delivered += item.delivered || 0;
            sold += item.sold || 0;
            damaged += item.damaged || 0;
          });
        });

        // Current real-time rest for this employee (seules les saisies validées sont comptabilisées)
        const allEmpEntries = dailyEntries.filter((d) => d.employeeId === emp.id);
        let currentRest = 0;
        if (allEmpEntries.length > 0) {
          const latest = allEmpEntries[0];
          const isValidated = !latest.status || latest.status === 'validated';
          if (isValidated) {
            latest.items.forEach((item) => {
              if (selectedProductId !== 'all' && item.productId !== selectedProductId) return;
              currentRest += item.rest || 0;
            });
          }
        }

        return {
          employee: emp,
          delivered,
          sold,
          damaged,
          currentRest,
          entriesCount: empEntries.length,
        };
      })
      .filter((s) => s.delivered > 0 || s.sold > 0 || s.currentRest > 0 || s.entriesCount > 0);
  }, [employees, periodDailyEntries, dailyEntries, selectedProductId]);

  // Chronological movement timeline
  const movementEvents = useMemo(() => {
    const list: Array<{
      id: string;
      date: string;
      type: 'production' | 'delivery' | 'personal_sale';
      title: string;
      subtitle: string;
      items: Array<{ name: string; qty: number }>;
      createdAt: number;
    }> = [];

    // Production entries
    periodProductions.forEach((p) => {
      const items = p.items
        .filter((i) => selectedProductId === 'all' || i.productId === selectedProductId)
        .filter((i) => (i.producedQty || 0) > 0)
        .map((i) => ({ name: i.productName, qty: i.producedQty }));

      if (items.length > 0) {
        list.push({
          id: p.id,
          date: p.date,
          type: 'production',
          title: 'Production réalisée',
          subtitle: p.notes ? `Note : ${p.notes}` : 'Entrée en stock maison',
          items,
          createdAt: p.createdAt || 0,
        });
      }
    });

    // Daily deliveries
    periodDailyEntries.forEach((d) => {
      const items = d.items
        .filter((i) => selectedProductId === 'all' || i.productId === selectedProductId)
        .filter((i) => (i.delivered || 0) > 0)
        .map((i) => ({ name: i.productName, qty: i.delivered }));

      if (items.length > 0) {
        list.push({
          id: d.id,
          date: d.date,
          type: 'delivery',
          title: `Livraison à ${d.employeeName}`,
          subtitle: `Ventes : ${d.items.reduce((acc, it) => acc + (it.sold || 0), 0)} · Abîmés : ${d.items.reduce((acc, it) => acc + (it.damaged || 0), 0)}`,
          items,
          createdAt: d.createdAt || 0,
        });
      }
    });

    // Personal sales
    periodPersonalSales.forEach((ps) => {
      const items = ps.items
        .filter((i) => selectedProductId === 'all' || i.productId === selectedProductId)
        .filter((i) => (i.soldQty || 0) > 0)
        .map((i) => ({ name: i.productName, qty: i.soldQty }));

      if (items.length > 0) {
        list.push({
          id: ps.id,
          date: ps.date,
          type: 'personal_sale',
          title: 'Vente directe par le gérant',
          subtitle: ps.notes ? `Note : ${ps.notes}` : 'Sortie directe de stock maison',
          items,
          createdAt: ps.createdAt || 0,
        });
      }
    });

    // Sort by date descending, then createdAt descending
    return list.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.createdAt - a.createdAt;
    });
  }, [periodProductions, periodDailyEntries, periodPersonalSales, selectedProductId]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-fadeIn"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-teal-500/20 text-teal-300 flex items-center justify-center shrink-0">
              <Warehouse className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black tracking-tight leading-tight truncate">
                  Détail des Stocks & Périodes
                </h3>
                <span className="text-[10px] uppercase font-extrabold bg-teal-400 text-slate-950 px-2 py-0.5 rounded-full shrink-0">
                  Temps réel
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate">
                Mouvements, état en direct et analyse par période
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors shrink-0"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filters bar: Period and Product selector */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 space-y-3 shrink-0">
          {/* Period selector */}
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
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all min-h-[34px] ${
                  periodType === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Custom Date Range Picker */}
          {periodType === 'custom' && (
            <div className="p-3 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-2">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-700">
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-teal-700" />
                  Sélectionner la période d’analyse :
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
                    Aujourd’hui
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                    Du
                  </label>
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCustomStart(val);
                      if (!customEnd || customEnd < val) setCustomEnd(val);
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
                      if (!customStart) setCustomStart(val);
                    }}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-slate-50 focus:bg-white focus:outline-teal-700"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Product selector filter & Active Date Badge */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-0.5">
            <div className="flex items-center gap-2 flex-1">
              <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-xl border border-slate-200 shadow-2xs flex-1">
                <Package className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="w-full text-xs font-semibold text-slate-800 bg-transparent focus:outline-none"
                >
                  <option value="all">Tous les produits</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="text-right">
              <span className="text-[11px] font-bold text-teal-800 bg-teal-50 px-2.5 py-1 rounded-xl border border-teal-200 font-mono inline-block">
                {dateRange.startDate === dateRange.endDate
                  ? formatDate(dateRange.startDate)
                  : `${formatDate(dateRange.startDate)} → ${formatDate(dateRange.endDate)}`}
              </span>
            </div>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-5">
          {/* Real-time Current Position Banner */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 text-white shadow-md">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-teal-400" />
                Position Actuelle (Temps Réel)
              </span>
              <span className="text-[11px] font-bold text-teal-300 font-mono">
                {products.length} produit{products.length > 1 ? 's' : ''} au catalogue
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center pt-1">
              <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/60">
                <span className="text-[10px] text-slate-400 block font-semibold truncate">
                  Stock Maison Actuel
                </span>
                <span
                  className={`text-lg sm:text-xl font-black font-mono mt-0.5 block ${
                    periodTotals.currentHouse < 0
                      ? 'text-rose-400'
                      : periodTotals.currentHouse <= 10
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {formatNumber(periodTotals.currentHouse)}
                </span>
                <span className="text-[9px] text-slate-400">Dans l'atelier</span>
              </div>

              <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/60">
                <span className="text-[10px] text-slate-400 block font-semibold truncate">
                  Reste ramené
                </span>
                <span className="text-lg sm:text-xl font-black font-mono text-teal-300 mt-0.5 block">
                  {formatNumber(periodTotals.currentRest)}
                </span>
                <span className="text-[9px] text-slate-400">Total retourné</span>
              </div>

              <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/60">
                <span className="text-[10px] text-slate-400 block font-semibold truncate">
                  Stock Global Total
                </span>
                <span className="text-lg sm:text-xl font-black font-mono text-white mt-0.5 block">
                  {formatNumber(periodTotals.currentTotal)}
                </span>
                <span className="text-[9px] text-slate-400">Maison + Vendeurs</span>
              </div>
            </div>
          </div>

          {/* Period Summary KPI Cards */}
          <div className="space-y-2">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-600 flex items-center justify-between">
              <span>Flux sur la période sélectionnée</span>
              <span className="text-[11px] font-normal text-slate-500 lowercase">
                (activités entre le {formatDate(dateRange.startDate)} et le{' '}
                {formatDate(dateRange.endDate)})
              </span>
            </h4>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="bg-teal-50/70 p-3 rounded-2xl border border-teal-200/80">
                <span className="text-[10px] font-bold text-teal-800 uppercase block truncate">
                  🏭 Produit
                </span>
                <span className="text-base sm:text-lg font-black font-mono text-teal-950 mt-0.5 block">
                  {formatNumber(periodTotals.produced)}
                </span>
                <span className="text-[10px] text-teal-700 font-medium">Entrées en stock</span>
              </div>

              <div className="bg-sky-50/70 p-3 rounded-2xl border border-sky-200/80">
                <span className="text-[10px] font-bold text-sky-800 uppercase block truncate">
                  🚚 Livré aux vendeurs
                </span>
                <span className="text-base sm:text-lg font-black font-mono text-sky-950 mt-0.5 block">
                  {formatNumber(periodTotals.delivered)}
                </span>
                <span className="text-[10px] text-sky-700 font-medium">Sorties vers équipe</span>
              </div>

              <div className="bg-indigo-50/70 p-3 rounded-2xl border border-indigo-200/80">
                <span className="text-[10px] font-bold text-indigo-800 uppercase block truncate">
                  👤 Vendu par moi
                </span>
                <span className="text-base sm:text-lg font-black font-mono text-indigo-950 mt-0.5 block">
                  {formatNumber(periodTotals.soldOwner)}
                </span>
                <span className="text-[10px] text-indigo-700 font-medium">Ventes personnelles</span>
              </div>

              <div className="bg-emerald-50/70 p-3 rounded-2xl border border-emerald-200/80">
                <span className="text-[10px] font-bold text-emerald-800 uppercase block truncate">
                  🛒 Vendu au total
                </span>
                <span className="text-base sm:text-lg font-black font-mono text-emerald-950 mt-0.5 block">
                  {formatNumber(periodTotals.totalSold)}
                </span>
                <span className="text-[10px] text-emerald-700 font-medium">
                  {periodTotals.soldEmployees} vend. + {periodTotals.soldOwner} moi
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="bg-rose-50/70 p-3 rounded-2xl border border-rose-200/80">
                <span className="text-[10px] font-bold text-rose-800 uppercase block truncate">
                  ⚠️ Abîmé / Pertes
                </span>
                <span className="text-base font-black font-mono text-rose-950 mt-0.5 block">
                  {formatNumber(periodTotals.damaged)}
                </span>
                <span className="text-[10px] text-rose-700 font-medium">
                  Taux :{' '}
                  {formatPercent(
                    safePercentage(
                      periodTotals.damaged,
                      periodTotals.totalSold + periodTotals.damaged
                    )
                  )}
                </span>
              </div>

              <div className="bg-slate-100 p-3 rounded-2xl border border-slate-200">
                <span className="text-[10px] font-bold text-slate-700 uppercase block truncate">
                  🔄 Variation Stock Maison
                </span>
                <span
                  className={`text-base font-black font-mono mt-0.5 block ${
                    periodTotals.netHouse > 0
                      ? 'text-emerald-700'
                      : periodTotals.netHouse < 0
                      ? 'text-rose-700'
                      : 'text-slate-800'
                  }`}
                >
                  {periodTotals.netHouse > 0 ? '+' : ''}
                  {formatNumber(periodTotals.netHouse)}
                </span>
                <span className="text-[10px] text-slate-500 font-medium">
                  Produit − Livré − Vendu par moi
                </span>
              </div>
            </div>
          </div>

          {/* Sub-tab view: Par Produit / Par Vendeur / Journal chronologique */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center p-1 bg-slate-200/70 rounded-2xl gap-1">
              <button
                type="button"
                onClick={() => setActiveTab('products')}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all min-h-[38px] ${
                  activeTab === 'products'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Par Produit ({periodProductStats.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('employees')}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all min-h-[38px] ${
                  activeTab === 'employees'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Par Vendeur(se) ({sellerStats.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('movements')}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all min-h-[38px] ${
                  activeTab === 'movements'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Journal Mouvements ({movementEvents.length})
              </button>
            </div>

            {/* TAB 1: PRODUCT BREAKDOWN */}
            {activeTab === 'products' && (
              <div className="space-y-3">
                {periodProductStats.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400 bg-slate-50 rounded-2xl">
                    Aucun produit trouvé
                  </div>
                ) : (
                  periodProductStats.map((item) => {
                    const isHouseNegative = item.realTimeHouseStock < 0;
                    const isHouseLow =
                      item.realTimeHouseStock >= 0 && item.realTimeHouseStock <= 10;

                    return (
                      <div
                        key={item.product.id}
                        className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3"
                      >
                        {/* Header of product */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
                              <Package className="w-4 h-4" />
                            </div>
                            <div>
                              <h5 className="text-sm font-extrabold text-slate-900 leading-tight">
                                {item.product.name}
                              </h5>
                              <span className="text-[11px] text-slate-500 font-mono">
                                Prix : {formatFC(item.product.defaultPrice, currency)}
                              </span>
                            </div>
                          </div>

                          <div className="text-right">
                            <span className="text-[10px] uppercase font-bold text-slate-500 block">
                              Stock maison actuel
                            </span>
                            <span
                              className={`text-base font-extrabold font-mono inline-flex items-center gap-1 ${
                                isHouseNegative
                                  ? 'text-rose-600'
                                  : isHouseLow
                                  ? 'text-amber-600'
                                  : 'text-emerald-700'
                              }`}
                            >
                              {isHouseNegative && <AlertTriangle className="w-3.5 h-3.5" />}
                              {formatNumber(item.realTimeHouseStock)}
                            </span>
                          </div>
                        </div>

                        {/* Period activity chips */}
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                            Mouvements sur la période
                          </span>
                          <div className="grid grid-cols-4 gap-1.5 bg-slate-50 p-2.5 rounded-xl text-center text-xs">
                            <div>
                              <span className="text-[10px] text-slate-500 block truncate">
                                Produit
                              </span>
                              <span className="font-extrabold text-slate-800 font-mono">
                                {formatNumber(item.producedInPeriod)}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-500 block truncate">
                                Livré
                              </span>
                              <span className="font-extrabold text-slate-800 font-mono">
                                {formatNumber(item.deliveredInPeriod)}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] text-indigo-700 font-semibold block truncate">
                                Vendu moi
                              </span>
                              <span className="font-extrabold text-indigo-700 font-mono">
                                {formatNumber(item.soldByOwnerInPeriod)}
                              </span>
                            </div>
                            <div>
                              <span className="text-[10px] text-emerald-700 font-semibold block truncate">
                                Vendu vend.
                              </span>
                              <span className="font-extrabold text-emerald-800 font-mono">
                                {formatNumber(item.soldByEmployeesInPeriod)}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Secondary stats row */}
                        <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-100 text-slate-600">
                          <span>
                            Abîmé en période :{' '}
                            <strong className="text-rose-600 font-mono">
                              {formatNumber(item.damagedInPeriod)}
                            </strong>
                          </span>
                          <span>
                            Reste ramené :{' '}
                            <strong className="text-teal-800 font-mono">
                              {formatNumber(item.realTimeTotalRest)}
                            </strong>
                          </span>
                          <span>
                            Stock global :{' '}
                            <strong className="text-slate-900 font-mono">
                              {formatNumber(item.realTimeTotalStock)}
                            </strong>
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* TAB 2: SELLER BREAKDOWN */}
            {activeTab === 'employees' && (
              <div className="space-y-2.5">
                {sellerStats.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400 bg-slate-50 rounded-2xl">
                    Aucune livraison ni vente enregistrée pour les vendeurs sur cette période
                  </div>
                ) : (
                  sellerStats.map((s) => (
                    <div
                      key={s.employee.id}
                      className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-2xs flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-teal-100 text-teal-800 font-extrabold text-xs flex items-center justify-center shrink-0">
                          {s.employee.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <h5 className="text-xs font-bold text-slate-900 truncate">
                            {s.employee.name}
                          </h5>
                          <span className="text-[10px] text-slate-500 font-mono block">
                            Livré : {formatNumber(s.delivered)} · Vendu : {formatNumber(s.sold)} · Abîmé : {formatNumber(s.damaged)}
                          </span>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-[10px] text-slate-500 uppercase font-semibold block">
                          Reste ramené
                        </span>
                        <span className="text-sm font-extrabold font-mono text-teal-800">
                          {formatNumber(s.currentRest)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* TAB 3: CHRONOLOGICAL MOVEMENTS */}
            {activeTab === 'movements' && (
              <div className="space-y-2">
                {movementEvents.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400 bg-slate-50 rounded-2xl">
                    Aucun mouvement enregistré sur cette période
                  </div>
                ) : (
                  movementEvents.map((evt) => (
                    <div
                      key={evt.id}
                      className="bg-white rounded-2xl border border-slate-200 p-3 shadow-2xs flex items-start gap-3"
                    >
                      <div
                        className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                          evt.type === 'production'
                            ? 'bg-teal-100 text-teal-700'
                            : evt.type === 'delivery'
                            ? 'bg-sky-100 text-sky-700'
                            : 'bg-indigo-100 text-indigo-700'
                        }`}
                      >
                        {evt.type === 'production' ? (
                          <Warehouse className="w-3.5 h-3.5" />
                        ) : evt.type === 'delivery' ? (
                          <Users className="w-3.5 h-3.5" />
                        ) : (
                          <UserCheck className="w-3.5 h-3.5" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <h5 className="text-xs font-bold text-slate-900 leading-tight">
                            {evt.title}
                          </h5>
                          <span className="text-[10px] font-mono text-slate-500">
                            {formatDate(evt.date)}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">{evt.subtitle}</p>

                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {evt.items.map((it, idx) => (
                            <span
                              key={idx}
                              className="text-[10px] font-bold font-mono px-2 py-0.5 rounded-md bg-slate-100 text-slate-800"
                            >
                              {it.name} : {formatNumber(it.qty)}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          {onNavigateToTab ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onNavigateToTab('daily');
              }}
              className="text-xs font-bold text-teal-700 hover:text-teal-800 flex items-center gap-1"
            >
              <span>Accéder à Saisies & Stocks</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <div />
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs active:scale-95 transition-all"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
