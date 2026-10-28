import React, { useState, useEffect, useMemo } from 'react';
import {
  ClipboardEdit,
  Plus,
  Package,
  Calendar,
  AlertTriangle,
  Edit2,
  Trash2,
  Warehouse,
  Users,
  UserCheck,
  CalendarCheck,
  Filter,
  RotateCcw,
  Clock,
  FileText,
  Printer,
  Share2,
  Search,
  Eye,
  Ban,
  X,
} from 'lucide-react';
import { db } from '../../db/db';
import {
  formatDate,
  formatFC,
  toISODate,
  toISOMonth,
  formatMonthName,
  formatNumber,
} from '../../utils/formatters';
import {
  calculateAllProductsStock,
  calculateAllProductsStockForPeriod,
  calculateMonthlyStockClosures,
  getMonthDateRange,
  getAllActivityMonths,
} from '../../utils/stockCalculator';
import { computeDebtAllocations } from '../../utils/debtCalculator';
import {
  formatReceiptNumber,
  computeMissingPrintedReceiptNumbers,
  generateFilledReceiptPDF,
  RECEIPT_PAYMENT_MODE_LABELS,
} from '../../utils/receiptPdfGenerator';
import { DailyEntryModal } from './DailyEntryModal';
import {
  ProductionStockModal,
  ProductionCostDetailModal,
  formatCostAmountFC,
} from './ProductionStockModal';
import { PersonalSaleModal } from './PersonalSaleModal';
import { ReceiptViewModal } from './ReceiptViewModal';
import { MonthlyStockClosureModal } from './MonthlyStockClosureModal';
import { ConfirmModal } from '../../components/ConfirmModal';
import { SecurityConfirmModal } from '../../components/SecurityConfirmModal';
import { EmptyState } from '../../components/EmptyState';
import type {
  DailyEntry,
  ProductionEntry,
  Employee,
  Product,
  AppSettings,
  PersonalSale,
  Customer,
  DebtPayment,
} from '../../types';

interface DailyEntryViewProps {
  settings: AppSettings;
  onSettingsUpdated?: (newSettings: AppSettings) => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
  onOpenCalculator?: () => void;
  initialStatusFilter?: 'all' | 'incomplete' | 'validated';
  initialSubTab?: 'sales' | 'production' | 'personal';
  onOpenDebts?: (customerId?: string) => void;
}

export const DailyEntryView: React.FC<DailyEntryViewProps> = ({
  settings,
  onSettingsUpdated,
  onShowToast,
  onOpenCalculator,
  initialStatusFilter,
  initialSubTab,
  onOpenDebts,
}) => {
  const [subTab, setSubTab] = useState<'sales' | 'production' | 'personal'>(
    initialSubTab || 'sales'
  );

  useEffect(() => {
    if (initialSubTab) {
      setSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [dailyEntries, setDailyEntries] = useState<DailyEntry[]>([]);
  const [productionEntries, setProductionEntries] = useState<ProductionEntry[]>([]);
  const [personalSales, setPersonalSales] = useState<PersonalSale[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [debtPayments, setDebtPayments] = useState<DebtPayment[]>([]);

  // Filters for sales
  const [filterEmployeeId, setFilterEmployeeId] = useState<string>('all');
  const [filterDate, setFilterDate] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'incomplete' | 'validated'>(
    initialStatusFilter || 'all'
  );

  useEffect(() => {
    if (initialStatusFilter) {
      setFilterStatus(initialStatusFilter);
    }
  }, [initialStatusFilter]);

  // Filters for personal sales & Carnet des reçus
  const [filterPersonalDate, setFilterPersonalDate] = useState<string>('');
  const [personalViewFilter, setPersonalViewFilter] = useState<'all' | 'receipts'>('all');
  const [receiptSearchQuery, setReceiptSearchQuery] = useState<string>('');

  // Stock period & monthly closure filters (par défaut en temps réel)
  const [stockFilterMode, setStockFilterMode] = useState<'realtime' | 'month' | 'custom'>('realtime');
  const [selectedStockMonth, setSelectedStockMonth] = useState<string>(toISOMonth(new Date()));
  const [customStockStart, setCustomStockStart] = useState<string>(toISODate(new Date()));
  const [customStockEnd, setCustomStockEnd] = useState<string>(toISODate(new Date()));
  const [isMonthlyClosureModalOpen, setIsMonthlyClosureModalOpen] = useState(false);

  // Modals
  const [isDailyModalOpen, setIsDailyModalOpen] = useState(false);
  const [entryToEdit, setEntryToEdit] = useState<DailyEntry | null>(null);

  const [isProdModalOpen, setIsProdModalOpen] = useState(false);
  const [prodToEdit, setProdToEdit] = useState<ProductionEntry | null>(null);
  const [prodDetailToView, setProdDetailToView] = useState<ProductionEntry | null>(null);

  const [isPersonalModalOpen, setIsPersonalModalOpen] = useState(false);
  const [saleToEdit, setSaleToEdit] = useState<PersonalSale | null>(null);
  const [personalModalKind, setPersonalModalKind] = useState<'vente' | 'consommation'>('vente');
  const [personalAutoReceipt, setPersonalAutoReceipt] = useState<boolean>(false);
  const [personalPrefillReceiptNo, setPersonalPrefillReceiptNo] = useState<number | null>(null);

  const [receiptSaleToView, setReceiptSaleToView] = useState<PersonalSale | null>(null);
  const [receiptSaleToDelete, setReceiptSaleToDelete] = useState<PersonalSale | null>(null);
  const [missingReceiptNoToCreate, setMissingReceiptNoToCreate] = useState<number | null>(null);
  const [busyReceiptSaleId, setBusyReceiptSaleId] = useState<string | null>(null);

  const [entryToDelete, setEntryToDelete] = useState<DailyEntry | null>(null);
  const [prodToDelete, setProdToDelete] = useState<ProductionEntry | null>(null);
  const [saleToDelete, setSaleToDelete] = useState<PersonalSale | null>(null);

  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    const [emps, prods, dEntries, pEntries, pSales, custs, dPays] = await Promise.all([
      db.employees.toArray(),
      db.products.orderBy('sortOrder').toArray(),
      db.dailyEntries.orderBy('date').reverse().toArray(),
      db.productionEntries.orderBy('date').reverse().toArray(),
      db.personalSales.orderBy('date').reverse().toArray(),
      db.customers.toArray(),
      db.debtPayments.toArray(),
    ]);

    setEmployees(emps);
    setProducts(prods);
    setDailyEntries(dEntries);
    setProductionEntries(pEntries);
    setPersonalSales(pSales);
    setCustomers(custs);
    setDebtPayments(dPays);
  };

  const debtInfo = useMemo(() => {
    return computeDebtAllocations(
      personalSales,
      debtPayments,
      settings.expenseReservePct ?? 50,
      customers,
      settings.debtReminderDays ?? 2
    );
  }, [personalSales, debtPayments, customers, settings.expenseReservePct, settings.debtReminderDays]);

  // Stock calculations
  // 1. Stock maison d'un produit en temps réel (par défaut)
  const stockData = useMemo(() => {
    return calculateAllProductsStock(products, productionEntries, dailyEntries, personalSales);
  }, [products, productionEntries, dailyEntries, personalSales]);

  // 2. Clôtures mensuelles calculées pour chaque mois (sans mélange de mois)
  const monthlyStockClosures = useMemo(() => {
    return calculateMonthlyStockClosures(products, productionEntries, dailyEntries, personalSales);
  }, [products, productionEntries, dailyEntries, personalSales]);

  // 3. Mois disponibles pour la sélection
  const availableStockMonths = useMemo(() => {
    return getAllActivityMonths(productionEntries, dailyEntries, personalSales);
  }, [productionEntries, dailyEntries, personalSales]);

  // 4. Plage de dates pour le mode sélectionné
  const activePeriodRange = useMemo(() => {
    if (stockFilterMode === 'month') {
      return getMonthDateRange(selectedStockMonth);
    }
    if (stockFilterMode === 'custom') {
      return {
        startDate: customStockStart || toISODate(new Date()),
        endDate: customStockEnd || toISODate(new Date()),
      };
    }
    return null;
  }, [stockFilterMode, selectedStockMonth, customStockStart, customStockEnd]);

  // 5. Calculs des stocks sur la période sélectionnée (clôture mensuelle ou dates personnalisées)
  const periodStockData = useMemo(() => {
    if (!activePeriodRange) return null;
    return calculateAllProductsStockForPeriod(
      products,
      activePeriodRange.startDate,
      activePeriodRange.endDate,
      productionEntries,
      dailyEntries,
      personalSales
    );
  }, [activePeriodRange, products, productionEntries, dailyEntries, personalSales]);

  const handleDeleteDailyEntry = async () => {
    if (!entryToDelete) return;
    try {
      await db.dailyEntries.delete(entryToDelete.id);
      onShowToast('info', 'Saisie de vente supprimée avec succès.');
      setEntryToDelete(null);
      await loadAllData();
    } catch (e: any) {
      onShowToast('error', 'Erreur lors de la suppression : ' + e.message);
    }
  };

  const handleDeleteProdEntry = async () => {
    if (!prodToDelete) return;
    try {
      await db.productionEntries.delete(prodToDelete.id);
      onShowToast('info', 'Saisie de production supprimée avec succès.');
      setProdToDelete(null);
      await loadAllData();
    } catch (e: any) {
      onShowToast('error', 'Erreur lors de la suppression : ' + e.message);
    }
  };

  const handleDeletePersonalSale = async () => {
    if (!saleToDelete) return;
    try {
      await db.personalSales.delete(saleToDelete.id);
      onShowToast('info', 'Vente personnelle supprimée avec succès.');
      setSaleToDelete(null);
      await loadAllData();
    } catch (e: any) {
      onShowToast('error', 'Erreur lors de la suppression : ' + e.message);
    }
  };

  // Status helper: defaults to 'validated' if missing
  const getEntryStatus = (entry: DailyEntry): 'validated' | 'incomplete' => {
    return entry.status || 'validated';
  };

  // Incomplete entries count
  const incompleteCount = dailyEntries.filter((e) => getEntryStatus(e) === 'incomplete').length;

  // Filtered sales entries
  const filteredDailyEntries = dailyEntries.filter((entry) => {
    if (filterEmployeeId !== 'all' && entry.employeeId !== filterEmployeeId) return false;
    if (filterDate && entry.date !== filterDate) return false;
    const entryStatus = getEntryStatus(entry);
    if (filterStatus === 'incomplete' && entryStatus !== 'incomplete') return false;
    if (filterStatus === 'validated' && entryStatus !== 'validated') return false;
    return true;
  });

  const handleDeleteOnlyReceipt = async () => {
    if (!receiptSaleToDelete) return;
    try {
      const removedNo = receiptSaleToDelete.receipt?.no;
      const { receipt: _removedReceipt, ...restSale } = receiptSaleToDelete;
      await db.personalSales.put(restSale);
      setReceiptSaleToDelete(null);
      if (receiptSaleToView?.id === receiptSaleToDelete.id) {
        setReceiptSaleToView(null);
      }
      onShowToast(
        'info',
        removedNo
          ? `Le reçu N° ${formatReceiptNumber(removedNo)} a été supprimé (la vente est conservée).`
          : 'Le reçu a été supprimé (la vente est conservée).'
      );
      await loadAllData();
    } catch (e: any) {
      onShowToast('error', 'Erreur lors de la suppression du reçu : ' + e.message);
    }
  };

  const handleMarkReceiptNumberVoided = async (noToVoid: number) => {
    try {
      const currentSettings = (await db.settings.get('app_settings')) || settings;
      const currentR = currentSettings.receiptSettings || {};
      const nextVoided = Array.from(
        new Set([...(currentR.voidedNumbers || []), Math.floor(noToVoid)])
      ).sort((a, b) => a - b);

      const updatedSettings: AppSettings = {
        ...currentSettings,
        receiptSettings: {
          ...currentR,
          voidedNumbers: nextVoided,
        },
      };
      await db.settings.put(updatedSettings);
      onSettingsUpdated?.(updatedSettings);
      onShowToast('info', `Le reçu N° ${formatReceiptNumber(noToVoid)} est marqué comme annulé.`);
    } catch (e: any) {
      onShowToast('error', 'Erreur : ' + e.message);
    }
  };

  const handleQuickDownloadReceiptPdf = async (sale: PersonalSale) => {
    if (!sale.receipt) return;
    setBusyReceiptSaleId(sale.id);
    try {
      await generateFilledReceiptPDF({
        sale,
        settings,
        products,
        action: 'download',
      });
      onShowToast(
        'success',
        `PDF du reçu N° ${formatReceiptNumber(sale.receipt.no)} téléchargé.`
      );
    } catch (e: any) {
      onShowToast('error', 'Erreur génération PDF : ' + e.message);
    } finally {
      setBusyReceiptSaleId(null);
    }
  };

  const handleQuickShareReceiptPdf = async (sale: PersonalSale) => {
    if (!sale.receipt) return;
    setBusyReceiptSaleId(sale.id);
    try {
      const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
      await generateFilledReceiptPDF({
        sale,
        settings,
        products,
        action: canShare ? 'share' : 'download',
      });
      if (!canShare) {
        onShowToast(
          'info',
          'Partage direct non supporté sur cet appareil : le PDF a été téléchargé.'
        );
      }
    } catch (e: any) {
      onShowToast('error', 'Erreur partage PDF : ' + e.message);
    } finally {
      setBusyReceiptSaleId(null);
    }
  };

  const openPersonalModalForNewSale = (
    kindToOpen: 'vente' | 'consommation',
    withReceipt = false,
    prefillNo: number | null = null
  ) => {
    setSaleToEdit(null);
    setPersonalModalKind(kindToOpen);
    setPersonalAutoReceipt(withReceipt);
    setPersonalPrefillReceiptNo(prefillNo);
    setIsPersonalModalOpen(true);
  };

  const openPersonalModalForEdit = (
    sale: PersonalSale,
    withReceipt = false,
    prefillNo: number | null = null
  ) => {
    setSaleToEdit(sale);
    setPersonalModalKind(sale.kind || 'vente');
    setPersonalAutoReceipt(withReceipt);
    setPersonalPrefillReceiptNo(prefillNo);
    setIsPersonalModalOpen(true);
  };

  // Filtered personal sales entries
  const filteredPersonalSales = personalSales.filter((sale) => {
    if (filterPersonalDate && sale.date !== filterPersonalDate) return false;
    return true;
  });

  // Sales with receipts (Carnet des reçus), sorted by receipt number ascending
  const allReceiptSales = useMemo(() => {
    return personalSales
      .filter((s) => s.kind !== 'consommation' && Boolean(s.receipt))
      .sort((a, b) => (a.receipt?.no || 0) - (b.receipt?.no || 0));
  }, [personalSales]);

  const filteredReceiptSales = useMemo(() => {
    const q = receiptSearchQuery.trim().toLocaleLowerCase('fr');
    return allReceiptSales.filter((s) => {
      if (!s.receipt) return false;
      if (filterPersonalDate && s.receipt.date !== filterPersonalDate && s.date !== filterPersonalDate) {
        return false;
      }
      if (!q) return true;
      const paddedNo = formatReceiptNumber(s.receipt.no).toLocaleLowerCase('fr');
      const rawNo = String(s.receipt.no);
      const client = (s.customerName || '').toLocaleLowerCase('fr');
      return paddedNo.includes(q) || rawNo.includes(q) || client.includes(q);
    });
  }, [allReceiptSales, receiptSearchQuery, filterPersonalDate]);

  // Numéros imprimés sans reçu enregistré (hors numéros annulés)
  const missingPrintedNumbers = useMemo(() => {
    return computeMissingPrintedReceiptNumbers(personalSales, settings.receiptSettings);
  }, [personalSales, settings.receiptSettings]);

  // Ventes client existantes sans reçu (pour proposer d'y attacher un numéro imprimé manquant)
  const clientSalesWithoutReceipt = useMemo(() => {
    return personalSales.filter((s) => s.kind !== 'consommation' && !s.receipt);
  }, [personalSales]);

  const currency = settings.currency || 'FC';

  return (
    <div className="pb-24 pt-3 px-4 max-w-lg mx-auto space-y-4">
      {/* Top Header & Sub-Tabs */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">
            Saisies & Stocks
          </h2>
          <p className="text-xs text-slate-500">
            Enregistrement des ventes, productions et inventaire
          </p>
        </div>

        {subTab === 'sales' ? (
          <button
            type="button"
            onClick={() => {
              setEntryToEdit(null);
              setIsDailyModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold shadow-xs active:scale-95 transition-all min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            <span>Nouvelle saisie</span>
          </button>
        ) : subTab === 'production' ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setProdToEdit(null);
                setIsProdModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold shadow-xs active:scale-95 transition-all min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              <span>Production</span>
            </button>
            <button
              type="button"
              onClick={() => openPersonalModalForNewSale('consommation')}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-xs active:scale-95 transition-all min-h-[44px]"
              title="Sortir des yaourts pour ma consommation personnelle"
            >
              <span>🍽</span>
              <span>Consommation</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            {onOpenDebts && (
              <button
                type="button"
                onClick={() => onOpenDebts()}
                className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs active:scale-95 transition-all min-h-[44px]"
              >
                <Clock className="w-4 h-4 text-amber-400" />
                <span>Dettes</span>
                {debtInfo.debtorCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-slate-950 text-[10px] font-mono font-extrabold">
                    {debtInfo.debtorCount}
                  </span>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => openPersonalModalForNewSale('vente')}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold shadow-xs active:scale-95 transition-all min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              <span>+ Vente client</span>
            </button>
          </div>
        )}
      </div>

      {/* Sub-tab Navigation (3 onglets) */}
      <div className="flex items-center p-1 bg-slate-200/70 rounded-2xl gap-1">
        <button
          type="button"
          onClick={() => setSubTab('sales')}
          className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all min-h-[38px] ${
            subTab === 'sales'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Ventes du jour ({dailyEntries.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab('production')}
          className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all min-h-[38px] ${
            subTab === 'production'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Production & Stocks ({productionEntries.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab('personal')}
          className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all min-h-[38px] ${
            subTab === 'personal'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Mes ventes personnelles ({personalSales.length})
        </button>
      </div>

      {/* SUB-TAB 1: SALES ENTRIES */}
      {subTab === 'sales' && (
        <div className="space-y-3">
          {/* Filter Bar */}
          <div className="p-3 bg-white rounded-2xl border border-slate-200/80 shadow-xs flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[130px]">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Vendeur(se)
              </label>
              <select
                value={filterEmployeeId}
                onChange={(e) => setFilterEmployeeId(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-white"
              >
                <option value="all">Tous/Toutes les vendeurs(ses)</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1 min-w-[120px]">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Date
              </label>
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-white"
              />
            </div>

            {filterDate && (
              <button
                type="button"
                onClick={() => setFilterDate('')}
                className="text-xs font-bold text-teal-700 hover:underline self-end pb-2 min-h-[36px] flex items-center"
              >
                Effacer date
              </button>
            )}
          </div>

          {/* Filtre à trois choix : Toutes / À compléter / Validées */}
          <div className="flex items-center p-1 bg-slate-100 rounded-xl gap-1">
            <button
              type="button"
              onClick={() => setFilterStatus('all')}
              className={`flex-1 py-1.5 px-2 text-xs font-bold rounded-lg transition-all text-center min-h-[34px] flex items-center justify-center gap-1.5 ${
                filterStatus === 'all'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>Toutes</span>
              <span className="text-[11px] font-mono text-slate-500 font-semibold">
                ({dailyEntries.length})
              </span>
            </button>
            <button
              type="button"
              onClick={() => setFilterStatus('incomplete')}
              className={`flex-1 py-1.5 px-2 text-xs font-bold rounded-lg transition-all text-center min-h-[34px] flex items-center justify-center gap-1.5 ${
                filterStatus === 'incomplete'
                  ? 'bg-amber-500 text-white shadow-2xs font-extrabold'
                  : 'text-amber-800 hover:text-amber-900'
              }`}
            >
              <span>À compléter</span>
              <span
                className={`text-[11px] font-mono font-bold px-1.5 py-0.2 rounded-full ${
                  filterStatus === 'incomplete'
                    ? 'bg-white/20 text-white'
                    : incompleteCount > 0
                    ? 'bg-amber-100 text-amber-800'
                    : 'text-slate-500'
                }`}
              >
                {incompleteCount}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setFilterStatus('validated')}
              className={`flex-1 py-1.5 px-2 text-xs font-bold rounded-lg transition-all text-center min-h-[34px] flex items-center justify-center gap-1.5 ${
                filterStatus === 'validated'
                  ? 'bg-white text-emerald-800 shadow-2xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>Validées</span>
              <span className="text-[11px] font-mono text-slate-500 font-semibold">
                ({dailyEntries.length - incompleteCount})
              </span>
            </button>
          </div>

          {/* List of Entries */}
          {filteredDailyEntries.length === 0 ? (
            <EmptyState
              icon={<ClipboardEdit className="w-7 h-7 text-teal-700" />}
              title="Aucune saisie de vente enregistrée"
              description="Créez votre première saisie journalière pour calculer automatiquement les ventes, les restes et la commission du/de la vendeur(se)."
              actionLabel="Nouvelle saisie"
              onAction={() => {
                setEntryToEdit(null);
                setIsDailyModalOpen(true);
              }}
            />
          ) : (
            <div className="space-y-3">
              {filteredDailyEntries.map((entry) => {
                const totalSoldQty = entry.items.reduce((acc, i) => acc + i.sold, 0);
                const totalDamagedQty = entry.items.reduce((acc, i) => acc + i.damaged, 0);
                const status = getEntryStatus(entry);
                const isIncomplete = status === 'incomplete';

                // Determine missing fields text for display
                const missingText = entry.missingFields && entry.missingFields.length > 0
                  ? entry.missingFields.map((f) => (f === 'sold' ? 'Vendu' : 'Abîmé')).join(', ')
                  : 'Vendu, Abîmé';

                return (
                  <div
                    key={entry.id}
                    className={`bg-white rounded-2xl p-4 shadow-xs flex flex-col gap-3 transition-all ${
                      isIncomplete
                        ? 'border-2 border-amber-400 bg-amber-50/20'
                        : 'border border-slate-200/80'
                    }`}
                  >
                    {/* Top Row: Date, Employee, Status Badge, Commission % */}
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-extrabold text-slate-900">
                            {formatDate(entry.date)}
                          </span>
                          <span className="text-xs font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded-lg border border-teal-200/50">
                            {entry.employeeName}
                          </span>
                          {/* Badge de statut */}
                          {isIncomplete ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-lg">
                              À compléter plus tard
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-lg">
                              ✓ Validé
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 font-mono flex-wrap">
                          <span>Commission : {formatNumber(entry.employeeCommissionRate)} %</span>
                          <span>·</span>
                          <span>{formatNumber(totalSoldQty)} vendus</span>
                          {totalDamagedQty > 0 && (
                            <>
                              <span>·</span>
                              <span className="text-rose-600 font-bold">
                                {formatNumber(totalDamagedQty)} abîmés
                              </span>
                            </>
                          )}
                        </div>
                        {isIncomplete && (
                          <div className="mt-1 text-xs font-bold text-amber-800 flex items-center gap-1">
                            <span>Manque : {missingText}</span>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1">
                        {isIncomplete && (
                          <button
                            type="button"
                            onClick={() => {
                              setEntryToEdit(entry);
                              setIsDailyModalOpen(true);
                            }}
                            className="px-2.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold shadow-xs active:scale-95 transition-all min-h-[38px] flex items-center gap-1"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            <span>Compléter</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setEntryToEdit(entry);
                            setIsDailyModalOpen(true);
                          }}
                          className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 min-w-[40px] min-h-[40px] flex items-center justify-center"
                          title="Modifier"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEntryToDelete(entry)}
                          className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-slate-100 min-w-[40px] min-h-[40px] flex items-center justify-center"
                          title="Supprimer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Products details pill grid */}
                    <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-200/60 divide-y divide-slate-200/60 text-xs">
                      {entry.items.map((item) => (
                        <div
                          key={item.productId}
                          className="py-1 first:pt-0 last:pb-0 flex items-center justify-between"
                        >
                          <span className="font-semibold text-slate-800">
                            {item.productName}
                          </span>
                          <div className="flex items-center gap-3 font-mono text-[11px]">
                            <span className="text-slate-500">
                              Cmd jour : <strong className="text-slate-700">{formatNumber(item.delivered)}</strong>
                            </span>
                            <span className="text-emerald-700 font-bold">
                              Vendu : {formatNumber(item.sold)}
                            </span>
                            <span className="text-slate-600">
                              Reste : <strong className="text-teal-800">{formatNumber(item.rest)}</strong>
                            </span>
                            {item.damaged > 0 && (
                              <span className="text-rose-600 font-bold">
                                Perte : {formatNumber(item.damaged)}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Financial summary row */}
                    <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-100 text-center">
                      <div className="bg-slate-50 p-2 rounded-xl">
                        <span className="text-[10px] text-slate-500 block font-semibold">
                          Total Ventes
                        </span>
                        <span className="text-xs font-extrabold text-slate-900 font-mono">
                          {formatFC(entry.totalSalesFC, currency)}
                        </span>
                      </div>
                      <div className="bg-teal-50/70 p-2 rounded-xl">
                        <span className="text-[10px] text-teal-700 block font-semibold">
                          Commission
                        </span>
                        <span className="text-xs font-extrabold text-teal-800 font-mono">
                          {formatFC(entry.employeeCommissionFC, currency)}
                        </span>
                      </div>
                      <div className="bg-emerald-50/70 p-2 rounded-xl">
                        <span className="text-[10px] text-emerald-700 block font-semibold">
                          Part Gérant
                        </span>
                        <span className="text-xs font-extrabold text-emerald-800 font-mono">
                          {formatFC(entry.ownerShareFC, currency)}
                        </span>
                      </div>
                    </div>

                    {entry.notes && (
                      <p className="text-xs text-slate-500 italic bg-slate-50 p-2 rounded-lg">
                        Note : {entry.notes}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: PRODUCTION & STOCK */}
      {subTab === 'production' && (
        <div className="space-y-4">
          {/* Stock Dashboard Header & Filter Bar */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-3.5 shadow-xs space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Warehouse className="w-4 h-4 text-teal-700" />
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-700">
                  {stockFilterMode === 'realtime'
                    ? 'État des stocks en temps réel'
                    : stockFilterMode === 'month'
                    ? `Clôture des stocks : ${formatMonthName(selectedStockMonth)}`
                    : 'État des stocks sur la période sélectionnée'}
                </h3>
              </div>

              {/* Bouton vers le Bilan complet des Clôtures mensuelles */}
              <button
                type="button"
                onClick={() => setIsMonthlyClosureModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-teal-50 text-teal-800 hover:bg-teal-100 border border-teal-200 text-xs font-bold transition-all active:scale-95"
              >
                <CalendarCheck className="w-3.5 h-3.5 text-teal-700" />
                <span>Clôtures mensuelles</span>
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-teal-200/70 text-[10px] font-mono font-bold">
                  {monthlyStockClosures.length}
                </span>
              </button>
            </div>

            {/* Onglets de sélection du mode d'affichage (par défaut en temps réel) */}
            <div className="flex items-center p-1 bg-slate-100 rounded-xl gap-1">
              <button
                type="button"
                onClick={() => setStockFilterMode('realtime')}
                className={`flex-1 py-1.5 px-2 text-xs font-bold rounded-lg transition-all min-h-[34px] flex items-center justify-center gap-1.5 ${
                  stockFilterMode === 'realtime'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>⚡ Temps réel (Actuel)</span>
              </button>

              <button
                type="button"
                onClick={() => setStockFilterMode('month')}
                className={`flex-1 py-1.5 px-2 text-xs font-bold rounded-lg transition-all min-h-[34px] flex items-center justify-center gap-1.5 ${
                  stockFilterMode === 'month'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Par Mois (Clôture)</span>
              </button>

              <button
                type="button"
                onClick={() => setStockFilterMode('custom')}
                className={`flex-1 py-1.5 px-2 text-xs font-bold rounded-lg transition-all min-h-[34px] flex items-center justify-center gap-1.5 ${
                  stockFilterMode === 'custom'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Filter className="w-3.5 h-3.5" />
                <span>Période (Dates)</span>
              </button>
            </div>

            {/* Sélecteur de mois si mode "month" */}
            {stockFilterMode === 'month' && (
              <div className="p-3 bg-teal-50/60 rounded-xl border border-teal-100 space-y-2.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-bold text-slate-700">Choisir le mois :</label>
                    <select
                      value={selectedStockMonth}
                      onChange={(e) => setSelectedStockMonth(e.target.value)}
                      className="px-3 py-1.5 rounded-xl border border-teal-200 bg-white text-xs font-bold text-slate-900 focus:outline-teal-700 font-sans"
                    >
                      {availableStockMonths.map((m) => (
                        <option key={m} value={m}>
                          {formatMonthName(m)} {m === toISOMonth(new Date()) ? '(Mois en cours)' : '(Clôturé)'}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={() => setStockFilterMode('realtime')}
                    className="inline-flex items-center gap-1 text-xs font-bold text-teal-800 hover:text-teal-950 underline underline-offset-2"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Revenir au temps réel</span>
                  </button>
                </div>

                <div className="flex items-center justify-between text-[11px] text-teal-950 font-medium pt-1 border-t border-teal-200/60">
                  <span>
                    Bilan clôturé du {formatDate(activePeriodRange?.startDate || '')} au {formatDate(activePeriodRange?.endDate || '')} — mouvements isolés sur ce mois
                  </span>
                  <span className="font-bold text-teal-900">
                    {selectedStockMonth === toISOMonth(new Date())
                      ? '● Clôture provisoire'
                      : '✓ Mois clôturé'}
                  </span>
                </div>
              </div>
            )}

            {/* Sélecteur de dates personnalisées si mode "custom" */}
            {stockFilterMode === 'custom' && (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-500" />
                    Choisir les dates pour voir le stock pendant cette période :
                  </span>
                  <button
                    type="button"
                    onClick={() => setStockFilterMode('realtime')}
                    className="inline-flex items-center gap-1 text-xs font-bold text-teal-700 hover:text-teal-900 underline underline-offset-2"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Revenir au temps réel</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                      Date début
                    </label>
                    <input
                      type="date"
                      value={customStockStart}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCustomStockStart(val);
                        if (!customStockEnd || customStockEnd < val) setCustomStockEnd(val);
                      }}
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-white"
                    />
                  </div>
                  <span className="text-xs font-bold text-slate-400 mt-4">à</span>
                  <div className="flex-1">
                    <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                      Date fin
                    </label>
                    <input
                      type="date"
                      value={customStockEnd}
                      min={customStockStart}
                      onChange={(e) => setCustomStockEnd(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-white"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Cartes des Stocks : Mode Temps Réel (par défaut) */}
          {stockFilterMode === 'realtime' && (
            <div className="space-y-2.5">
              <div className="grid grid-cols-1 gap-2.5">
                {stockData.map((item) => {
                  const isHouseNegative = item.houseStock < 0;
                  const isHouseLow = item.houseStock >= 0 && item.houseStock <= 10;

                  return (
                    <div
                      key={item.product.id}
                      className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center">
                            <Package className="w-4 h-4" />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-slate-900 leading-tight">
                              {item.product.name}
                            </h4>
                            <span className="text-[11px] text-slate-500 font-mono">
                              Prix : {formatFC(item.product.defaultPrice, currency)}
                            </span>
                          </div>
                        </div>

                        {/* House stock badge */}
                        <div className="text-right">
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">
                            Stock maison
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
                            {isHouseNegative && <AlertTriangle className="w-4 h-4" />}
                            {formatNumber(item.houseStock)}
                          </span>
                        </div>
                      </div>

                      {/* Stock Details */}
                      <div className="grid grid-cols-4 gap-1.5 bg-slate-50 p-2.5 rounded-xl text-center text-xs">
                        <div>
                          <span className="text-[10px] text-slate-500 block truncate">Produit</span>
                          <span className="font-bold text-slate-800 font-mono">
                            {formatNumber(item.totalProduced)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-500 block truncate">Livré</span>
                          <span className="font-bold text-slate-800 font-mono">
                            {formatNumber(item.totalDelivered)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-indigo-700 font-semibold block truncate">
                            Vendu par moi
                          </span>
                          <span className="font-bold text-indigo-700 font-mono">
                            {formatNumber(item.totalSoldByOwner)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-teal-700 font-semibold block truncate">
                            Reste ramené
                          </span>
                          <span className="font-bold text-teal-800 font-mono">
                            {formatNumber(item.totalRest)}
                          </span>
                        </div>
                      </div>

                      {isHouseNegative && (
                        <div className="mt-2.5 p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span>
                            Alerte : Stock maison négatif ({formatNumber(item.houseStock)}) ! Enregistrez la production réalisée.
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Cartes des Stocks : Mode Période / Clôture Mensuelle */}
          {stockFilterMode !== 'realtime' && periodStockData && (
            <div className="space-y-2.5">
              <div className="grid grid-cols-1 gap-2.5">
                {periodStockData.map((item) => {
                  const isNegative = item.closingStock < 0;
                  const isLow = item.closingStock >= 0 && item.closingStock <= 10;
                  const isPositiveChange = item.netChange >= 0;

                  return (
                    <div
                      key={item.product.id}
                      className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center">
                            <Package className="w-4 h-4" />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-slate-900 leading-tight">
                              {item.product.name}
                            </h4>
                            <span className="text-[11px] text-slate-500 font-mono">
                              Stock au 1er / début : <strong>{formatNumber(item.initialStock)}</strong>
                            </span>
                          </div>
                        </div>

                        {/* Closing stock badge */}
                        <div className="text-right">
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">
                            {stockFilterMode === 'month' ? 'Stock clôturé' : 'Stock fin période'}
                          </span>
                          <span
                            className={`text-base font-extrabold font-mono inline-flex items-center gap-1 ${
                              isNegative
                                ? 'text-rose-600'
                                : isLow
                                ? 'text-amber-600'
                                : 'text-emerald-700'
                            }`}
                          >
                            {isNegative && <AlertTriangle className="w-4 h-4" />}
                            {formatNumber(item.closingStock)}
                          </span>
                          <span className="text-[10px] text-slate-400 block font-mono">
                            Flux net : {isPositiveChange ? '+' : ''}
                            {formatNumber(item.netChange)}
                          </span>
                        </div>
                      </div>

                      {/* Period Micro Details Grid */}
                      <div className="grid grid-cols-6 gap-1 bg-slate-50 p-2 rounded-xl text-center text-xs">
                        <div>
                          <span className="text-[9px] text-slate-500 block truncate">Stock Début</span>
                          <span className="font-bold text-slate-700 font-mono">
                            {formatNumber(item.initialStock)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[9px] text-teal-700 block truncate">Produit</span>
                          <span className="font-bold text-teal-800 font-mono">
                            +{formatNumber(item.producedInPeriod)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[9px] text-sky-700 block truncate">Livré</span>
                          <span className="font-bold text-sky-800 font-mono">
                            -{formatNumber(item.deliveredInPeriod)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[9px] text-indigo-700 block truncate">Vendu moi</span>
                          <span className="font-bold text-indigo-800 font-mono">
                            -{formatNumber(item.soldByOwnerInPeriod)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[9px] text-teal-700 font-semibold block truncate">Reste ram.</span>
                          <span className="font-bold text-teal-800 font-mono">
                            +{formatNumber(item.restInPeriod)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[9px] text-rose-600 block truncate">Abîmé</span>
                          <span className="font-bold text-rose-700 font-mono">
                            {formatNumber(item.damagedInPeriod)}
                          </span>
                        </div>
                      </div>

                      {isNegative && (
                        <div className="mt-2.5 p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span>
                            Alerte : Stock clôturé négatif ({formatNumber(item.closingStock)}) pour cette période.
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Production History List */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                Historique des productions ({productionEntries.length})
              </h3>
            </div>

            {productionEntries.length === 0 ? (
              <EmptyState
                icon={<Package className="w-7 h-7 text-teal-700" />}
                title="Aucune production enregistrée"
                description="Saisissez votre première fournée de yaourts pour alimenter le stock disponible à la maison."
                actionLabel="Enregistrer une production"
                onAction={() => {
                  setProdToEdit(null);
                  setIsProdModalOpen(true);
                }}
              />
            ) : (
              <div className="space-y-2.5">
                {productionEntries.map((prod) => {
                  const totalProduced = prod.items.reduce((acc, i) => acc + i.producedQty, 0);

                  return (
                    <div
                      key={prod.id}
                      className="bg-white rounded-2xl border border-slate-200/80 p-3.5 shadow-xs flex items-center justify-between gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-xs font-bold text-slate-900">
                            {formatDate(prod.date)}
                          </span>
                          <span className="text-xs font-extrabold text-teal-700 font-mono bg-teal-50 px-2 py-0.5 rounded-md">
                            {formatNumber(totalProduced)} unités
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-2 mt-1.5 text-xs text-slate-600 font-mono">
                          {prod.items.map((i) => (
                            <span key={i.productId}>
                              {i.productName} : <strong>{formatNumber(i.producedQty)}</strong>
                            </span>
                          ))}
                        </div>

                        {prod.notes && (
                          <p className="text-[11px] text-slate-400 italic mt-1">
                            {prod.notes}
                          </p>
                        )}

                        {prod.costing && (
                          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-[11px] font-bold font-mono text-slate-700">
                              Coût : {formatCostAmountFC(prod.costing.totalCostFC, currency)} · Gain
                              estimé :{' '}
                              <span
                                className={
                                  prod.costing.netGainFC <= 0
                                    ? 'text-rose-600'
                                    : 'text-emerald-700'
                                }
                              >
                                {formatCostAmountFC(prod.costing.netGainFC, currency)}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => setProdDetailToView(prod)}
                              className="px-2.5 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200/80 text-[11px] font-bold transition-colors"
                            >
                              Voir le détail
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setProdToEdit(prod);
                            setIsProdModalOpen(true);
                          }}
                          className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 min-w-[36px] min-h-[36px] flex items-center justify-center"
                          title="Modifier"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setProdToDelete(prod)}
                          className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-slate-100 min-w-[36px] min-h-[36px] flex items-center justify-center"
                          title="Supprimer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 3: MES VENTES PERSONNELLES (VENTES, CONSOMMATIONS & CARNET DES REÇUS) */}
      {subTab === 'personal' && (
        <div className="space-y-3">
          {/* Boutons d'action : Vente à un client & Ma consommation */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => openPersonalModalForNewSale('vente')}
              className="flex items-center justify-center gap-1.5 py-3 px-3 rounded-2xl bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs shadow-xs active:scale-95 transition-all min-h-[46px]"
            >
              <Plus className="w-4 h-4" />
              <span>+ Vente à un client</span>
            </button>
            <button
              type="button"
              onClick={() => openPersonalModalForNewSale('consommation')}
              className="flex items-center justify-center gap-1.5 py-3 px-3 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-xs active:scale-95 transition-all min-h-[46px]"
            >
              <span className="text-base">🍽</span>
              <span>Ma consommation</span>
            </button>
          </div>

          {/* Filtre : Toutes les ventes personnelles vs Carnet des reçus ("Reçus") */}
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-200/70 rounded-2xl">
            <button
              type="button"
              onClick={() => setPersonalViewFilter('all')}
              className={`py-2 px-3 rounded-xl text-xs font-bold transition-all min-h-[38px] flex items-center justify-center gap-1.5 ${
                personalViewFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>Toutes ({personalSales.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setPersonalViewFilter('receipts')}
              className={`py-2 px-3 rounded-xl text-xs font-bold transition-all min-h-[38px] flex items-center justify-center gap-1.5 ${
                personalViewFilter === 'receipts'
                  ? 'bg-white text-amber-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5 text-amber-600" />
              <span>Reçus ({allReceiptSales.length})</span>
              {missingPrintedNumbers.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-md bg-amber-500 text-slate-950 text-[10px] font-mono font-extrabold">
                  {missingPrintedNumbers.length}
                </span>
              )}
            </button>
          </div>

          {/* Filter Bar */}
          <div className="p-3 bg-white rounded-2xl border border-slate-200/80 shadow-xs space-y-2.5">
            {personalViewFilter === 'receipts' && (
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={receiptSearchQuery}
                  onChange={(e) => setReceiptSearchQuery(e.target.value)}
                  placeholder="Rechercher par numéro (ex: 0003) ou client..."
                  className="w-full pl-9 pr-8 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                />
                {receiptSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setReceiptSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
                    title="Effacer la recherche"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-[140px]">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  Filtrer par date
                </label>
                <input
                  type="date"
                  value={filterPersonalDate}
                  onChange={(e) => setFilterPersonalDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-white"
                />
              </div>

              {filterPersonalDate && (
                <button
                  type="button"
                  onClick={() => setFilterPersonalDate('')}
                  className="text-xs font-bold text-teal-700 hover:underline self-end pb-2 min-h-[36px] flex items-center"
                >
                  Toutes les dates
                </button>
              )}
            </div>
          </div>

          {personalViewFilter === 'receipts' ? (
            /* CARNET DES REÇUS */
            <div className="space-y-3">
              {/* Bandeau : Numéros imprimés sans reçu enregistré */}
              {missingPrintedNumbers.length > 0 && (
                <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 shadow-xs space-y-2.5">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <div className="text-xs font-bold text-amber-950 leading-snug">
                      Numéros imprimés sans reçu enregistré :{' '}
                      <span className="font-mono font-black">
                        {missingPrintedNumbers.map((n) => formatReceiptNumber(n)).join(', ')}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
                    {missingPrintedNumbers.map((n) => (
                      <div
                        key={n}
                        className="flex flex-wrap items-center justify-between gap-2 bg-white px-2.5 py-2 rounded-xl border border-amber-200/80"
                      >
                        <span className="text-xs font-black font-mono text-slate-900">
                          N° {formatReceiptNumber(n)}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              if (clientSalesWithoutReceipt.length > 0) {
                                setMissingReceiptNoToCreate(n);
                              } else {
                                openPersonalModalForNewSale('vente', true, n);
                              }
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold transition-colors min-h-[32px]"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Créer ce reçu</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMarkReceiptNumberVoided(n)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold transition-colors min-h-[32px]"
                          >
                            <Ban className="w-3 h-3" />
                            <span>Marquer comme annulé</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Liste des reçus par numéro */}
              {filteredReceiptSales.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200/80 p-6 text-center shadow-xs">
                  <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center mx-auto mb-3">
                    <FileText className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-800 mb-1">
                    {allReceiptSales.length === 0
                      ? 'Aucun reçu enregistré'
                      : 'Aucun reçu ne correspond à votre recherche'}
                  </h4>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
                    Activez « Créer un reçu pour cette vente » lors d’une vente à un client, ou créez un reçu sur une vente existante.
                  </p>
                  <button
                    type="button"
                    onClick={() => openPersonalModalForNewSale('vente', true, null)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold shadow-xs active:scale-95 transition-all min-h-[40px]"
                  >
                    <Plus className="w-4 h-4" />
                    <span>+ Vente client avec reçu</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filteredReceiptSales.map((sale) => {
                    const r = sale.receipt!;
                    const totalFC = Math.round(sale.totalSalesFC || 0);
                    const paidNotedFC = Math.round(r.paidNotedFC || 0);
                    const remainingFC = Math.max(0, totalFC - paidNotedFC);
                    const isBusy = busyReceiptSaleId === sale.id;

                    return (
                      <div
                        key={sale.id}
                        className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs space-y-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="px-2.5 py-0.5 rounded-lg bg-amber-100 text-amber-950 border border-amber-300 text-xs font-black font-mono">
                                N° {formatReceiptNumber(r.no)}
                              </span>
                              <span className="text-xs font-bold text-slate-600">
                                {formatDate(r.date)}
                              </span>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                                {RECEIPT_PAYMENT_MODE_LABELS[r.paymentMode]}
                              </span>
                            </div>
                            <div className="text-sm font-extrabold text-slate-900 mt-1">
                              {sale.customerName || 'Client'}
                              {r.phone ? (
                                <span className="text-xs font-semibold text-slate-500 font-mono ml-2">
                                  · {r.phone}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 text-center text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                          <div>
                            <span className="text-[10px] font-bold text-slate-500 uppercase block">
                              Total
                            </span>
                            <span className="text-xs font-extrabold font-mono text-slate-900">
                              {formatFC(totalFC, currency)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] font-bold text-emerald-700 uppercase block">
                              Payé noté
                            </span>
                            <span className="text-xs font-extrabold font-mono text-emerald-800">
                              {formatFC(paidNotedFC, currency)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] font-bold text-amber-800 uppercase block">
                              Reste
                            </span>
                            <span
                              className={`text-xs font-extrabold font-mono ${
                                remainingFC > 0 ? 'text-amber-900' : 'text-slate-600'
                              }`}
                            >
                              {formatFC(remainingFC, currency)}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => setReceiptSaleToView(sale)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-colors min-h-[38px]"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Voir le reçu</span>
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleQuickDownloadReceiptPdf(sale)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors disabled:opacity-50 min-h-[38px]"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span>Imprimer le reçu</span>
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleQuickShareReceiptPdf(sale)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold transition-colors disabled:opacity-50 min-h-[38px]"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                            <span>Partager</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openPersonalModalForEdit(sale, true, null)}
                            className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors min-h-[38px]"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            <span>Modifier le reçu</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setReceiptSaleToDelete(sale)}
                            className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold transition-colors min-h-[38px]"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Supprimer le reçu</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : filteredPersonalSales.length === 0 ? (
            /* Empty state of Personal Sales */
            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 text-center shadow-xs">
              <div className="w-12 h-12 rounded-2xl bg-teal-50 text-teal-700 flex items-center justify-center mx-auto mb-3">
                <UserCheck className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-slate-800 mb-1">
                Aucune vente personnelle ni consommation enregistrée
              </h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
                Enregistrez vos ventes directes sans passer par un(e) vendeur(se), ou sortez des yaourts pour votre consommation personnelle.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => openPersonalModalForNewSale('vente')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold shadow-xs active:scale-95 transition-all min-h-[40px]"
                >
                  <Plus className="w-4 h-4" />
                  <span>+ Vente client</span>
                </button>
                <button
                  type="button"
                  onClick={() => openPersonalModalForNewSale('consommation')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-xs active:scale-95 transition-all min-h-[40px]"
                >
                  <span>🍽</span>
                  <span>Ma consommation</span>
                </button>
              </div>
            </div>
          ) : (
            /* List of Personal Sales */
            <div className="space-y-3">
              {filteredPersonalSales.map((sale) => {
                const totalSoldQty = sale.items.reduce((acc, it) => acc + it.soldQty, 0);
                const isClientSale = sale.kind !== 'consommation';
                const isCreditSale = isClientSale && sale.paymentStatus === 'credit';
                const creditStatus = isCreditSale
                  ? debtInfo.saleStatusMap.get(sale.id)
                  : undefined;
                const isBusy = busyReceiptSaleId === sale.id;

                return (
                  <div
                    key={sale.id}
                    className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col gap-3"
                  >
                    {/* Top Row: Date, Badge, Actions */}
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-extrabold text-slate-900">
                            {formatDate(sale.date)}
                          </span>
                          {sale.kind === 'consommation' ? (
                            <span className="text-xs font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200/50 flex items-center gap-1">
                              <span>🍽 Consommation</span>
                            </span>
                          ) : isCreditSale ? (
                            <>
                              <button
                                type="button"
                                onClick={() => onOpenDebts?.(sale.customerId)}
                                className="text-xs font-bold text-amber-900 bg-amber-50 hover:bg-amber-100 px-2 py-0.5 rounded-lg border border-amber-200 flex items-center gap-1 transition-colors"
                              >
                                <Clock className="w-3 h-3 text-amber-700" />
                                <span>À crédit · {sale.customerName || 'Client'}</span>
                              </button>
                              {creditStatus && (
                                <span
                                  className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md ${
                                    creditStatus.status === 'paid'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : creditStatus.status === 'partial'
                                      ? 'bg-amber-100 text-amber-800'
                                      : creditStatus.status === 'written_off'
                                      ? 'bg-slate-200 text-slate-700'
                                      : 'bg-rose-100 text-rose-800'
                                  }`}
                                >
                                  {creditStatus.status === 'paid'
                                    ? 'Payé'
                                    : creditStatus.status === 'partial'
                                    ? `Partiel (reste ${formatFC(creditStatus.remainingFC, currency)})`
                                    : creditStatus.status === 'written_off'
                                    ? 'Dette abandonnée'
                                    : 'Non payé'}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-xs font-bold text-indigo-800 bg-indigo-50 px-2 py-0.5 rounded-lg border border-indigo-200/50 flex items-center gap-1">
                              <UserCheck className="w-3 h-3" />
                              <span>
                                Vente directe{sale.customerName ? ` · ${sale.customerName}` : ' (Moi)'}
                              </span>
                            </span>
                          )}

                          {isClientSale && sale.receipt && (
                            <button
                              type="button"
                              onClick={() => setReceiptSaleToView(sale)}
                              className="text-xs font-black font-mono text-amber-950 bg-amber-100 hover:bg-amber-200 px-2 py-0.5 rounded-lg border border-amber-300 flex items-center gap-1 transition-colors"
                            >
                              <FileText className="w-3 h-3 text-amber-700" />
                              <span>Reçu N° {formatReceiptNumber(sale.receipt.no)}</span>
                            </button>
                          )}
                        </div>
                        {sale.kind === 'consommation' ? (
                          <div className="flex items-center gap-2 mt-1 text-xs text-amber-800 font-mono">
                            <span>{formatNumber(totalSoldQty)} consommés</span>
                            <span>·</span>
                            <span className="font-semibold">Payée par mes bénéfices</span>
                          </div>
                        ) : sale.isOpeningDebt ? (
                          <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 font-mono">
                            <span>Ancienne dette (sans sortie de stock)</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 font-mono">
                            <span>{formatNumber(totalSoldQty)} vendus</span>
                            {sale.ownerCommissionRate > 0 && (
                              <>
                                <span>·</span>
                                <span>Ma comm. : {formatNumber(sale.ownerCommissionRate)} %</span>
                              </>
                            )}
                            <span>·</span>
                            <span className="text-teal-700 font-semibold">
                              Caisse : {formatNumber(sale.expenseReserveRate)} %
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openPersonalModalForEdit(sale, false, null)}
                          className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 min-w-[40px] min-h-[40px] flex items-center justify-center"
                          title="Modifier"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const paidOnSale = debtInfo.saleStatusMap.get(sale.id)?.paidFC || 0;
                            if (paidOnSale > 0) {
                              onShowToast(
                                'error',
                                'Impossible de supprimer une vente à crédit ayant déjà reçu un paiement. Gérez ses paiements dans Dettes.'
                              );
                              return;
                            }
                            setSaleToDelete(sale);
                          }}
                          className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-slate-100 min-w-[40px] min-h-[40px] flex items-center justify-center"
                          title="Supprimer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Products details */}
                    {sale.isOpeningDebt ? (
                      <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                        Ancienne dette enregistrée sans produits
                      </div>
                    ) : (
                      <div className="space-y-1 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                        {sale.items.map((it) => (
                          <div
                            key={it.productId}
                            className="flex items-center justify-between text-xs font-medium text-slate-700"
                          >
                            <span>
                              {it.productName} × {formatNumber(it.soldQty)}
                              <span className="text-[11px] text-slate-400 font-mono ml-1.5">
                                ({formatFC(it.unitPrice, currency)})
                              </span>
                            </span>
                            <span className="font-mono font-bold text-slate-900">
                              {formatFC(it.soldQty * it.unitPrice, currency)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Financial summary */}
                    {sale.kind === 'consommation' ? (
                      <div className="p-3 bg-amber-50 rounded-xl border border-amber-200/80 flex items-center justify-between text-xs">
                        <div>
                          <span className="font-bold text-amber-900 block">
                            Valeur payée par mes bénéfices :
                          </span>
                          {sale.consumptionPaidFC !== undefined &&
                            sale.consumptionValueFC !== undefined &&
                            sale.consumptionPaidFC !== sale.consumptionValueFC && (
                              <span className="text-[10px] text-amber-800">
                                Prix complet : {formatFC(sale.consumptionValueFC, currency)}
                              </span>
                            )}
                        </div>
                        <span className="font-mono font-black text-amber-950 text-sm">
                          {formatFC(
                            sale.consumptionPaidFC !== undefined
                              ? sale.consumptionPaidFC
                              : (sale.consumptionValueFC || 0),
                            currency
                          )}
                        </span>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-slate-100 text-center text-xs">
                        <div className="bg-slate-50 p-2 rounded-xl">
                          <span className="text-[10px] text-slate-500 block font-semibold">Total Ventes</span>
                          <span className="text-xs font-extrabold text-slate-900 font-mono">
                            {formatFC(sale.totalSalesFC, currency)}
                          </span>
                        </div>
                        <div className="bg-teal-50/70 p-2 rounded-xl">
                          <span className="text-[10px] text-teal-700 block font-semibold">
                            Part Caisse ({sale.expenseReserveRate} %)
                          </span>
                          <span className="text-xs font-extrabold text-teal-800 font-mono">
                            {formatFC(sale.expenseReserveFC, currency)}
                          </span>
                        </div>
                        <div className="bg-indigo-50/70 p-2 rounded-xl">
                          <span className="text-[10px] text-indigo-700 block font-semibold">
                            Ma Commission
                          </span>
                          <span className="text-xs font-extrabold text-indigo-800 font-mono">
                            {formatFC(sale.ownerCommissionFC, currency)}
                          </span>
                        </div>
                        <div className="bg-emerald-50/70 p-2 rounded-xl">
                          <span className="text-[10px] text-emerald-700 block font-semibold">
                            Part Gérant
                          </span>
                          <span className="text-xs font-extrabold text-emerald-800 font-mono">
                            {formatFC(sale.ownerShareFC, currency)}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Actions Reçu sur vente client */}
                    {isClientSale && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
                        {!sale.receipt ? (
                          <button
                            type="button"
                            onClick={() => openPersonalModalForEdit(sale, true, null)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-xs font-bold transition-colors min-h-[36px]"
                          >
                            <FileText className="w-3.5 h-3.5 text-amber-700" />
                            <span>Créer un reçu</span>
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => setReceiptSaleToView(sale)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-colors min-h-[36px]"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Voir le reçu</span>
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleQuickDownloadReceiptPdf(sale)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors disabled:opacity-50 min-h-[36px]"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>Imprimer le reçu</span>
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleQuickShareReceiptPdf(sale)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold transition-colors disabled:opacity-50 min-h-[36px]"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                              <span>Partager</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => openPersonalModalForEdit(sale, true, null)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors min-h-[36px]"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                              <span>Modifier le reçu</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setReceiptSaleToDelete(sale)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold transition-colors min-h-[36px]"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Supprimer le reçu</span>
                            </button>
                          </>
                        )}
                      </div>
                    )}

                    {sale.notes && (
                      <p className="text-xs text-slate-500 italic bg-slate-50 p-2 rounded-lg">
                        Note : {sale.notes}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Daily Entry Modal */}
      <DailyEntryModal
        isOpen={isDailyModalOpen}
        entryToEdit={entryToEdit}
        employees={employees}
        products={products}
        settings={settings}
        onClose={() => {
          setIsDailyModalOpen(false);
          setEntryToEdit(null);
        }}
        onSaved={async (status, missingLabels) => {
          if (status === 'validated') {
            onShowToast('success', 'Saisie validée');
          } else {
            const missingText = missingLabels.length > 0 ? missingLabels.join(', ') : 'Vendu, Abîmé';
            onShowToast('info', `Saisie enregistrée : à compléter plus tard (il manque : ${missingText})`);
          }
          await loadAllData();
        }}
        onOpenCalculator={onOpenCalculator}
      />

      {/* Production Modal */}
      <ProductionStockModal
        isOpen={isProdModalOpen}
        entryToEdit={prodToEdit}
        products={products}
        settings={settings}
        employees={employees}
        productionEntries={productionEntries}
        onClose={() => {
          setIsProdModalOpen(false);
          setProdToEdit(null);
        }}
        onSaved={async () => {
          onShowToast('success', 'Production enregistrée.');
          await loadAllData();
        }}
      />

      {/* Read-only Production Cost Detail Modal */}
      <ProductionCostDetailModal
        entry={prodDetailToView}
        currency={currency}
        onClose={() => setProdDetailToView(null)}
      />

      {/* Personal Sale Modal */}
      <PersonalSaleModal
        isOpen={isPersonalModalOpen}
        saleToEdit={saleToEdit}
        alreadyPaidFC={saleToEdit ? (debtInfo.saleStatusMap.get(saleToEdit.id)?.paidFC || 0) : 0}
        initialKind={personalModalKind}
        products={products}
        settings={settings}
        stockMap={Object.fromEntries(stockData.map((s) => [s.product.id, s.houseStock]))}
        existingSales={personalSales}
        autoEnableReceipt={personalAutoReceipt}
        prefillReceiptNo={personalPrefillReceiptNo}
        onClose={() => {
          setIsPersonalModalOpen(false);
          setSaleToEdit(null);
          setPersonalAutoReceipt(false);
          setPersonalPrefillReceiptNo(null);
        }}
        onSaved={async (savedKind) => {
          const finalKind = savedKind || personalModalKind;
          onShowToast(
            'success',
            finalKind === 'consommation'
              ? 'Consommation personnelle enregistrée avec succès.'
              : 'Vente personnelle enregistrée avec succès.'
          );
          setPersonalAutoReceipt(false);
          setPersonalPrefillReceiptNo(null);
          await loadAllData();
        }}
        onOpenCalculator={onOpenCalculator}
      />

      {/* Large-print Receipt View Modal ("Voir le reçu") */}
      <ReceiptViewModal
        sale={receiptSaleToView}
        products={products}
        settings={settings}
        onClose={() => setReceiptSaleToView(null)}
        onEditReceipt={(sale) => {
          setReceiptSaleToView(null);
          openPersonalModalForEdit(sale, true, null);
        }}
        onDeleteReceipt={(sale) => {
          setReceiptSaleToDelete(sale);
        }}
        onShowToast={onShowToast}
      />

      {/* Security Confirm Modal: Delete ONLY the receipt (keeps the sale) */}
      <SecurityConfirmModal
        isOpen={Boolean(receiptSaleToDelete)}
        title="Supprimer uniquement ce reçu ?"
        message={
          receiptSaleToDelete?.receipt
            ? `Voulez-vous supprimer le reçu N° ${formatReceiptNumber(
                receiptSaleToDelete.receipt.no
              )} ? La vente personnelle du ${formatDate(
                receiptSaleToDelete.date
              )} (${formatFC(receiptSaleToDelete.totalSalesFC, currency)}) sera conservée.`
            : 'Voulez-vous supprimer ce reçu ? La vente personnelle sera conservée.'
        }
        confirmLabel="Supprimer le reçu"
        pinCode={settings.pinCode}
        confirmWord="SUPPRIMER"
        onConfirm={handleDeleteOnlyReceipt}
        onCancel={() => setReceiptSaleToDelete(null)}
      />

      {/* Choice Modal for creating a missing printed receipt number */}
      {missingReceiptNoToCreate !== null && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-5 shadow-2xl border border-slate-100 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    Créer le reçu N° {formatReceiptNumber(missingReceiptNoToCreate)}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Choisissez une vente existante ou créez une nouvelle vente
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMissingReceiptNoToCreate(null)}
                className="p-2 rounded-full text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                const targetNo = missingReceiptNoToCreate;
                setMissingReceiptNoToCreate(null);
                openPersonalModalForNewSale('vente', true, targetNo);
              }}
              className="w-full py-3 px-4 rounded-2xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-xs transition-all min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              <span>
                Nouvelle vente client avec reçu N° {formatReceiptNumber(missingReceiptNoToCreate)}
              </span>
            </button>

            <div className="space-y-2 overflow-y-auto pr-1 flex-1">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Ou attacher à une vente client existante sans reçu :
              </div>
              {clientSalesWithoutReceipt.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    const targetNo = missingReceiptNoToCreate;
                    setMissingReceiptNoToCreate(null);
                    openPersonalModalForEdit(s, true, targetNo);
                  }}
                  className="w-full text-left p-3 rounded-xl border border-slate-200 hover:border-amber-400 hover:bg-amber-50/40 transition-colors flex items-center justify-between gap-2"
                >
                  <div>
                    <div className="text-xs font-extrabold text-slate-900">
                      {formatDate(s.date)}
                      {s.customerName ? ` · ${s.customerName}` : ''}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {s.isOpeningDebt
                        ? 'Ancienne dette'
                        : s.items.map((it) => `${it.productName} × ${it.soldQty}`).join(', ')}
                    </div>
                  </div>
                  <span className="text-xs font-extrabold font-mono text-slate-900 shrink-0">
                    {formatFC(s.totalSalesFC, currency)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Delete Daily Entry Confirm */}
      <ConfirmModal
        isOpen={Boolean(entryToDelete)}
        title="Supprimer cette saisie journalière ?"
        message={`Voulez-vous supprimer la saisie du ${formatDate(
          entryToDelete?.date
        )} pour ${entryToDelete?.employeeName} ? Cette action est irréversible.`}
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        isDanger={true}
        onConfirm={handleDeleteDailyEntry}
        onCancel={() => setEntryToDelete(null)}
      />

      {/* Delete Production Confirm */}
      <ConfirmModal
        isOpen={Boolean(prodToDelete)}
        title="Supprimer cette production ?"
        message={`Voulez-vous supprimer la production du ${formatDate(
          prodToDelete?.date
        )} ? Les stocks à la maison seront recalculés automatiquement.`}
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        isDanger={true}
        onConfirm={handleDeleteProdEntry}
        onCancel={() => setProdToDelete(null)}
      />

      {/* Delete Personal Sale Confirm */}
      <ConfirmModal
        isOpen={Boolean(saleToDelete)}
        title={
          saleToDelete?.kind === 'consommation'
            ? 'Supprimer cette consommation personnelle ?'
            : 'Supprimer cette vente personnelle ?'
        }
        message={
          saleToDelete?.kind === 'consommation'
            ? `Voulez-vous supprimer la consommation du ${formatDate(
                saleToDelete?.date
              )} d'une valeur payée de ${formatFC(
                saleToDelete?.consumptionPaidFC !== undefined
                  ? saleToDelete?.consumptionPaidFC
                  : (saleToDelete?.consumptionValueFC || 0),
                currency
              )} ? Les stocks et la caisse seront recalculés automatiquement.`
            : `Voulez-vous supprimer la vente directe du ${formatDate(
                saleToDelete?.date
              )} d'un montant de ${formatFC(
                saleToDelete?.totalSalesFC,
                currency
              )} ? Les stocks et la caisse seront recalculés automatiquement.`
        }
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        isDanger={true}
        onConfirm={handleDeletePersonalSale}
        onCancel={() => setSaleToDelete(null)}
      />

      {/* Monthly Stock Closures Modal */}
      <MonthlyStockClosureModal
        isOpen={isMonthlyClosureModalOpen}
        onClose={() => setIsMonthlyClosureModalOpen(false)}
        closures={monthlyStockClosures}
        currency={currency}
        onSelectMonth={(month) => {
          setSelectedStockMonth(month);
          setStockFilterMode('month');
          setIsMonthlyClosureModalOpen(false);
        }}
      />
    </div>
  );
};
