import React, { useState, useEffect, useRef } from 'react';
import {
  Settings,
  Download,
  Upload,
  FileSpreadsheet,
  Lock,
  Unlock,
  ShieldCheck,
  Plus,
  Trash2,
  Edit2,
  Check,
  Package,
  Layers,
  AlertTriangle,
  Smartphone,
  Wallet,
  Calendar,
  RotateCcw,
  UserCheck,
  Calculator,
  ChevronRight,
} from 'lucide-react';
import { db } from '../../db/db';
import {
  exportAllDataToJSON,
  restoreDataFromJSON,
  exportSalesToCSV,
  exportExpensesToCSV,
} from '../../utils/exportImport';
import { calculateMonthResteNormale } from '../../utils/reserveCalculator';
import { formatFC, formatDate, formatPercent, parseLocaleNumber, formatNumber } from '../../utils/formatters';
import { ConfirmModal } from '../../components/ConfirmModal';
import { PWAInstallButton } from '../../components/PWAInstallButton';
import { PayslipSettingsSection } from './PayslipSettingsSection';
import type {
  AppSettings,
  Product,
  CostItem,
  ProductCostConfig,
  ProductPackagingLine,
} from '../../types';

interface SettingsViewProps {
  settings: AppSettings;
  onSettingsUpdated: (newSettings: AppSettings) => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
  onOpenIngredientStock?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSettingsUpdated,
  onShowToast,
  onOpenIngredientStock,
}) => {
  // Local settings form state
  const [businessName, setBusinessName] = useState(settings.businessName || 'Yaourt Gestion');
  const [appLogoBase64, setAppLogoBase64] = useState<string | undefined>(settings.appLogoBase64);
  const appLogoInputRef = useRef<HTMLInputElement | null>(null);
  const [currency, setCurrency] = useState(settings.currency || 'FC');
  const [expenseReservePct, setExpenseReservePct] = useState(formatNumber(settings.expenseReservePct));
  const [monthlySalesTargetFC, setMonthlySalesTargetFC] = useState(
    formatNumber(settings.monthlySalesTargetFC)
  );
  const [lossAlertThresholdPct, setLossAlertThresholdPct] = useState(
    formatNumber(settings.lossAlertThresholdPct)
  );

  useEffect(() => {
    setAppLogoBase64(settings.appLogoBase64);
  }, [settings.appLogoBase64]);

  // Products state
  const [products, setProducts] = useState<Product[]>([]);
  const [newProductName, setNewProductName] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('1000');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Categories state
  const [categories, setCategories] = useState<string[]>(settings.expenseCategories);
  const [newCategoryName, setNewCategoryName] = useState('');

  // Storage persistence state
  const [isPersisted, setIsPersisted] = useState<boolean | null>(null);

  // PIN modal
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState('');

  // Point de départ des caisses
  const [caisseStartDate, setCaisseStartDate] = useState(settings.caisseStartDate || '');
  const [caisseStartNormaleFC, setCaisseStartNormaleFC] = useState(
    settings.caisseStartNormaleFC !== undefined ? formatNumber(settings.caisseStartNormaleFC) : ''
  );
  const [caisseStartCapitalFC, setCaisseStartCapitalFC] = useState(
    settings.caisseStartCapitalFC !== undefined ? formatNumber(settings.caisseStartCapitalFC) : '0'
  );
  const [caisseStartVendeursFC, setCaisseStartVendeursFC] = useState(
    settings.caisseStartVendeursFC !== undefined ? formatNumber(settings.caisseStartVendeursFC) : '0'
  );
  const [suggestedNormaleFC, setSuggestedNormaleFC] = useState<number | null>(null);

  // Ventes personnelles (Ma commission, Consommation & Rappel dettes)
  const [ownerCommissionPct, setOwnerCommissionPct] = useState(
    settings.ownerCommissionPct !== undefined ? formatNumber(settings.ownerCommissionPct) : '0'
  );
  const [consumptionPaidPct, setConsumptionPaidPct] = useState(
    settings.consumptionPaidPct !== undefined
      ? formatNumber(settings.consumptionPaidPct)
      : formatNumber(settings.expenseReservePct ?? 50)
  );
  const [debtReminderDays, setDebtReminderDays] = useState(
    settings.debtReminderDays !== undefined ? formatNumber(settings.debtReminderDays) : '2'
  );

  // Restore file handling
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingRestoreContent, setPendingRestoreContent] = useState<string | null>(null);
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);

  useEffect(() => {
    loadProducts();
    checkPersistence();
    loadSuggestedStartingPoint();
  }, []);

  const loadSuggestedStartingPoint = async () => {
    try {
      const [entries, exps] = await Promise.all([
        db.dailyEntries.toArray(),
        db.expenses.toArray(),
      ]);
      // Si une date de départ existe ou par défaut, trouver le dernier mois clôturé
      const refDate = settings.caisseStartDate || '2026-10-01';
      const closedMonthSet = new Set<string>();
      for (const e of entries) {
        if (e.date && e.date < refDate) closedMonthSet.add(e.date.substring(0, 7));
      }
      for (const exp of exps) {
        if (exp.date && exp.date < refDate) closedMonthSet.add(exp.date.substring(0, 7));
      }
      const sorted = Array.from(closedMonthSet).sort();
      if (sorted.length > 0) {
        const lastMonth = sorted[sorted.length - 1];
        const res = calculateMonthResteNormale(entries, exps, lastMonth, settings.expenseReservePct || 50);
        setSuggestedNormaleFC(res.resteNormaleFC);
      }
    } catch (e) {
      console.error('Erreur calcul suggestion point de départ:', e);
    }
  };

  const loadProducts = async () => {
    const list = await db.products.orderBy('sortOrder').toArray();
    setProducts(list);
  };

  const checkPersistence = async () => {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persisted) {
      const persisted = await navigator.storage.persisted();
      setIsPersisted(persisted);
    }
  };

  const handleSaveGeneralSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const reserveNum = parseLocaleNumber(expenseReservePct);
    const targetNum = parseLocaleNumber(monthlySalesTargetFC);
    const lossThresholdNum = parseLocaleNumber(lossAlertThresholdPct);

    if (isNaN(reserveNum) || reserveNum < 0 || reserveNum > 100) {
      onShowToast('error', 'Le % de réserve dépenses doit être compris entre 0 et 100.');
      return;
    }

    const updated: AppSettings = {
      ...settings,
      businessName: businessName.trim() || 'Yaourt Gestion',
      currency: currency.trim() || 'FC',
      expenseReservePct: reserveNum,
      monthlySalesTargetFC: isNaN(targetNum) ? 1000000 : targetNum,
      lossAlertThresholdPct: isNaN(lossThresholdNum) ? 5.0 : lossThresholdNum,
      expenseCategories: categories,
      appLogoBase64: appLogoBase64,
    };

    await db.settings.put(updated);
    onSettingsUpdated(updated);
    onShowToast('success', 'Paramètres généraux enregistrés.');
  };

  const handleAppLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const reader = new FileReader();
      reader.onload = (uploadEvt) => {
        const img = new Image();
        img.onload = async () => {
          const maxDim = 400;
          let width = img.width;
          let height = img.height;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(img, 0, 0, width, height);
          const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
          const resized = canvas.toDataURL(mime, 0.85);

          setAppLogoBase64(resized);
          const updated: AppSettings = {
            ...settings,
            appLogoBase64: resized,
          };
          await db.settings.put(updated);
          onSettingsUpdated(updated);
          onShowToast('success', 'Logo de l’application mis à jour avec succès.');
        };
        img.src = uploadEvt.target?.result as string;
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      onShowToast('error', 'Erreur chargement logo : ' + err.message);
    }
  };

  const handleRemoveAppLogo = async () => {
    setAppLogoBase64(undefined);
    const updated: AppSettings = {
      ...settings,
      appLogoBase64: undefined,
    };
    await db.settings.put(updated);
    onSettingsUpdated(updated);
    onShowToast('info', 'Logo personnalisé supprimé (icône par défaut rétablie).');
  };

  const handleSaveCaisseStartingPoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!caisseStartDate.trim()) {
      onShowToast('error', 'Veuillez sélectionner une date de départ valide (ex : 2026-10-01).');
      return;
    }

    const numNormale = caisseStartNormaleFC === '' ? (suggestedNormaleFC ?? 0) : parseLocaleNumber(caisseStartNormaleFC);
    const numCapital = caisseStartCapitalFC === '' ? 0 : parseLocaleNumber(caisseStartCapitalFC);

    if (isNaN(numNormale) || numNormale < 0) {
      onShowToast('error', 'Le solde de départ de la Caisse normale doit être un montant positif ou nul.');
      return;
    }

    if (isNaN(numCapital)) {
      onShowToast('error', 'Le solde de départ de la Caisse Capital doit être un nombre valide.');
      return;
    }

    const numVendeurs = caisseStartVendeursFC === '' ? 0 : parseLocaleNumber(caisseStartVendeursFC);

    const updated: AppSettings = {
      ...settings,
      caisseStartDate: caisseStartDate.trim(),
      caisseStartNormaleFC: Math.round(numNormale),
      caisseStartCapitalFC: Math.round(numCapital),
      caisseStartReserveFC: Math.round(numNormale) + Math.round(numCapital),
      caisseStartBeneficesFC: 0,
      caisseStartVendeursFC: Math.round(numVendeurs),
    };

    await db.settings.put(updated);
    onSettingsUpdated(updated);
    onShowToast('success', 'Point de départ des caisses enregistré avec succès.');
  };

  const handleRemoveCaisseStartingPoint = async () => {
    const updated: AppSettings = {
      ...settings,
      caisseStartDate: undefined,
      caisseStartNormaleFC: undefined,
      caisseStartCapitalFC: undefined,
      caisseStartReserveFC: undefined,
      caisseStartBeneficesFC: undefined,
      caisseStartVendeursFC: undefined,
    };

    await db.settings.put(updated);
    onSettingsUpdated(updated);
    setCaisseStartDate('');
    setCaisseStartNormaleFC('');
    setCaisseStartCapitalFC('0');
    setCaisseStartVendeursFC('0');
    onShowToast('info', 'Point de départ retiré : le calcul revient sur tout l’historique.');
  };

  const handleSavePersonalSalesSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const commNum = parseLocaleNumber(ownerCommissionPct);
    if (isNaN(commNum) || commNum < 0 || commNum > 100) {
      onShowToast('error', 'Ma commission (%) doit être comprise entre 0 et 100.');
      return;
    }
    const paidPctNum = parseLocaleNumber(consumptionPaidPct);
    if (isNaN(paidPctNum) || paidPctNum < 0 || paidPctNum > 100) {
      onShowToast('error', 'La part payée pour ma consommation (%) doit être comprise entre 0 et 100.');
      return;
    }

    const reminderDaysNum =
      debtReminderDays.trim() === '' ? 2 : Math.round(parseLocaleNumber(debtReminderDays));
    if (isNaN(reminderDaysNum) || reminderDaysNum < 0 || reminderDaysNum > 365) {
      onShowToast('error', 'Le délai de rappel de dette doit être compris entre 0 et 365 jours.');
      return;
    }

    const updated: AppSettings = {
      ...settings,
      ownerCommissionPct: commNum,
      consumptionPaidPct: paidPctNum,
      debtReminderDays: reminderDaysNum,
    };

    await db.settings.put(updated);
    onSettingsUpdated(updated);
    onShowToast('success', 'Paramètres des ventes personnelles enregistrés.');
  };

  // Product management
  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProductName.trim()) return;
    const priceNum = parseLocaleNumber(newProductPrice);
    if (isNaN(priceNum) || priceNum <= 0) {
      onShowToast('error', 'Prix invalide');
      return;
    }

    const newProd: Product = {
      id: 'prod_' + Date.now().toString(),
      name: newProductName.trim(),
      defaultPrice: priceNum,
      isActive: true,
      sortOrder: products.length + 1,
      createdAt: Date.now(),
    };

    await db.products.put(newProd);
    setNewProductName('');
    setNewProductPrice('1000');
    await loadProducts();
    onShowToast('success', `Produit ${newProd.name} ajouté.`);
  };

  const handleUpdateProductPrice = async (prod: Product, newPriceStr: string) => {
    const priceNum = parseLocaleNumber(newPriceStr);
    if (isNaN(priceNum) || priceNum <= 0) return;
    await db.products.update(prod.id, { defaultPrice: priceNum });
    setEditingProduct(null);
    await loadProducts();
    onShowToast('success', `Prix de ${prod.name} mis à jour (${formatFC(priceNum, currency)}).`);
  };

  const handleToggleProductActive = async (prod: Product) => {
    await db.products.update(prod.id, { isActive: !prod.isActive });
    await loadProducts();
  };

  // Categories management
  const handleAddCategory = () => {
    if (!newCategoryName.trim()) return;
    if (categories.includes(newCategoryName.trim())) {
      onShowToast('error', 'Cette catégorie existe déjà.');
      return;
    }
    const updated = [...categories, newCategoryName.trim()];
    setCategories(updated);
    setNewCategoryName('');
    db.settings.update(settings.id, { expenseCategories: updated });
    onSettingsUpdated({ ...settings, expenseCategories: updated });
    onShowToast('success', 'Catégorie ajoutée.');
  };

  const handleDeleteCategory = (catToDelete: string) => {
    const updated = categories.filter((c) => c !== catToDelete);
    setCategories(updated);
    db.settings.update(settings.id, { expenseCategories: updated });
    onSettingsUpdated({ ...settings, expenseCategories: updated });
  };

  // PIN Management
  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');

    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
      setPinError('Le code PIN doit comporter exactement 4 chiffres.');
      return;
    }

    if (newPin !== confirmPin) {
      setPinError('Les deux codes PIN ne correspondent pas.');
      return;
    }

    const updated = { ...settings, pinCode: newPin };
    await db.settings.put(updated);
    onSettingsUpdated(updated);
    setIsPinModalOpen(false);
    setNewPin('');
    setConfirmPin('');
    onShowToast('success', 'Code PIN activé avec succès.');
  };

  const handleDisablePin = async () => {
    const updated = { ...settings, pinCode: '' };
    await db.settings.put(updated);
    onSettingsUpdated(updated);
    onShowToast('info', 'Code PIN désactivé.');
  };

  // Backup & Restore
  const handleExportJSON = async () => {
    try {
      await exportAllDataToJSON();
      const updated = await db.settings.get('app_settings');
      if (updated) onSettingsUpdated(updated);
      onShowToast('success', 'Sauvegarde JSON exportée avec succès.');
    } catch (e: any) {
      onShowToast('error', 'Erreur sauvegarde : ' + e.message);
    }
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setPendingRestoreContent(content);
      setIsRestoreModalOpen(true);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleExecuteRestore = async (mode: 'replace' | 'merge') => {
    if (!pendingRestoreContent) return;
    setIsRestoreModalOpen(false);

    const res = await restoreDataFromJSON(pendingRestoreContent, mode);
    setPendingRestoreContent(null);

    if (res.success) {
      const reloadedSettings = (await db.settings.get('app_settings')) || settings;
      onSettingsUpdated(reloadedSettings);
      await loadProducts();
      onShowToast('success', res.message);
    } else {
      onShowToast('error', res.message);
    }
  };

  return (
    <div className="pb-28 pt-3 px-4 max-w-lg mx-auto space-y-5">
      {/* Page Header */}
      <div>
        <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">
          Paramètres & Sauvegardes
        </h2>
        <p className="text-xs text-slate-500">
          Configuration du business, produits, sécurité et exports
        </p>
      </div>

      {/* Shortcut Button: Stock d'ingrédients */}
      {onOpenIngredientStock && (
        <button
          type="button"
          onClick={onOpenIngredientStock}
          className="w-full p-4 rounded-2xl bg-teal-800 hover:bg-teal-900 active:scale-[0.99] text-white shadow-sm flex items-center justify-between gap-3 transition-all text-left"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
              <Package className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <span className="text-sm font-extrabold block leading-tight">
                Stock d’ingrédients
              </span>
              <span className="text-[11px] text-teal-100 block truncate mt-0.5">
                Stock calculé, historique des prix, ajustements et liste d’achats
              </span>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-teal-200 shrink-0" />
        </button>
      )}

      {/* Storage persistence notification */}
      <div className="p-3.5 rounded-2xl bg-teal-50/80 border border-teal-200/70 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-teal-700 shrink-0" />
          <div>
            <span className="text-xs font-bold text-slate-900 block leading-tight">
              Stockage local persistant
            </span>
            <span className="text-[11px] text-slate-600">
              {isPersisted
                ? 'Données protégées par le système contre la suppression.'
                : 'Stockage IndexedDB local actif pour APK hors ligne.'}
            </span>
          </div>
        </div>
        <span className="text-[10px] font-extrabold text-teal-800 bg-white px-2 py-1 rounded-md border border-teal-200">
          HORS LIGNE
        </span>
      </div>

      {/* PWA Mobile Installation Section */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs space-y-2.5">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
          <Smartphone className="w-4 h-4 text-teal-700" />
          <span>Application Mobile (PWA & Hors Ligne)</span>
        </h3>
        <p className="text-xs text-slate-600 leading-relaxed">
          Yaourt Gestion est configurée pour fonctionner à 100 % hors ligne avec mise en cache locale intégrale de tous les fichiers.
        </p>
        <div className="pt-1">
          <PWAInstallButton variant="full" logoBase64={settings.appLogoBase64} />
        </div>
      </div>

      {/* Section 1: Business & Calculation Parameters */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs space-y-3.5">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
          <Settings className="w-4 h-4 text-teal-700" />
          <span>Paramètres de gestion & Ratios</span>
        </h3>

        <form onSubmit={handleSaveGeneralSettings} className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Nom du business
            </label>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 bg-white"
            />
          </div>

          {/* Logo de l'application */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-bold text-slate-800">
                  Logo de l'application
                </label>
                <p className="text-[11px] text-slate-500">
                  Affiché dans l'en-tête, sur l'écran de verrouillage et au chargement.
                </p>
              </div>
              {appLogoBase64 && (
                <button
                  type="button"
                  onClick={handleRemoveAppLogo}
                  className="text-[11px] text-rose-600 hover:text-rose-700 font-semibold inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  Supprimer
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-white border border-slate-200/90 shadow-xs flex items-center justify-center p-1 overflow-hidden shrink-0">
                {appLogoBase64 ? (
                  <img
                    src={appLogoBase64}
                    alt="Logo actuel"
                    className="w-full h-full object-contain rounded-xl"
                  />
                ) : (
                  <img
                    src="/pwa-192x192.png"
                    alt="Logo par défaut"
                    className="w-full h-full object-contain rounded-xl"
                  />
                )}
              </div>

              <div className="flex-1 space-y-1">
                <input
                  type="file"
                  ref={appLogoInputRef}
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={handleAppLogoUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => appLogoInputRef.current?.click()}
                  className="w-full py-2 px-3 rounded-xl bg-white border border-slate-300 hover:border-teal-600 text-slate-800 hover:text-teal-700 text-xs font-bold shadow-xs active:scale-95 transition-all flex items-center justify-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5 text-teal-700" />
                  <span>{appLogoBase64 ? 'Remplacer le logo' : 'Choisir un logo dans le téléphone'}</span>
                </button>
                <span className="text-[10px] text-slate-400 block text-center">
                  PNG, JPG, WebP ou SVG (taille optimisée automatiquement)
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Devise
              </label>
              <input
                type="text"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Réserve dépenses (%)
              </label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  value={expenseReservePct}
                  onChange={(e) => setExpenseReservePct(e.target.value.replace(/[^0-9.,]/g, ''))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 bg-white pr-7"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                  %
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Objectif mensuel ({currency})
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={monthlySalesTargetFC}
                onChange={(e) => setMonthlySalesTargetFC(e.target.value.replace(/[^0-9.,]/g, ''))}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Alerte perte max (%)
              </label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  value={lossAlertThresholdPct}
                  onChange={(e) => setLossAlertThresholdPct(e.target.value.replace(/[^0-9.,]/g, ''))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 bg-white pr-7"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                  %
                </span>
              </div>
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-2.5 px-3 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold shadow-xs active:scale-95 transition-all min-h-[44px]"
          >
            Enregistrer les ratios
          </button>
        </form>
      </div>

      {/* Section : Point de départ des caisses */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs space-y-3.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
            <Wallet className="w-4 h-4 text-teal-700" />
            <span>Point de départ des caisses</span>
          </h3>
          {settings.caisseStartDate && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-mono">
              Actif ({formatDate(settings.caisseStartDate)})
            </span>
          )}
        </div>

        <p className="text-[11px] text-slate-500 leading-snug">
          Permet de clôturer les mois passés et de démarrer les caisses à une date précise avec des soldes définis.
          Les mois antérieurs seront clôturés en un seul bloc, sans utiliser la Caisse Capital.
        </p>

        <form onSubmit={handleSaveCaisseStartingPoint} className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center justify-between">
              <span>Date de départ (début des nouvelles caisses) *</span>
              {caisseStartDate && (
                <span className="text-[10px] font-normal text-slate-400 font-mono">
                  {formatDate(caisseStartDate)}
                </span>
              )}
            </label>
            <div className="relative">
              <input
                type="date"
                value={caisseStartDate}
                onChange={(e) => {
                  setCaisseStartDate(e.target.value);
                  // Si l'utilisateur choisit une date et qu'aucun solde normale n'est saisi, proposer le reste suggéré
                  if (suggestedNormaleFC !== null && !caisseStartNormaleFC) {
                    setCaisseStartNormaleFC(formatNumber(suggestedNormaleFC));
                  }
                }}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 bg-white"
              />
            </div>
            {!caisseStartDate && (
              <p className="text-[10px] text-slate-400 mt-0.5">
                Vide par défaut. Entrez par exemple le 01/10/2026 pour clôturer septembre 2026 et avant.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Solde Caisse normale ({currency})
              </label>
              <input
                type="text"
                inputMode="decimal"
                placeholder={suggestedNormaleFC !== null ? `${formatNumber(suggestedNormaleFC)} (suggéré)` : '0'}
                value={caisseStartNormaleFC}
                onChange={(e) => setCaisseStartNormaleFC(e.target.value.replace(/[^0-9.,]/g, ''))}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 bg-white"
              />
              {suggestedNormaleFC !== null && (
                <div className="mt-1 flex items-center justify-between text-[10px]">
                  <span className="text-slate-400">Reste dernier mois :</span>
                  <button
                    type="button"
                    onClick={() => setCaisseStartNormaleFC(formatNumber(suggestedNormaleFC))}
                    className="font-bold text-teal-700 hover:text-teal-800 underline"
                  >
                    {formatFC(suggestedNormaleFC, currency)}
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Solde Caisse Capital ({currency})
              </label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={caisseStartCapitalFC}
                onChange={(e) => setCaisseStartCapitalFC(e.target.value.replace(/[^0-9.,]/g, ''))}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 bg-white"
              />
              <span className="text-[10px] text-slate-400 block mt-1">
                0 {currency} par défaut
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              className="flex-1 py-2.5 px-3 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold shadow-xs active:scale-95 transition-all min-h-[42px]"
            >
              Enregistrer le point de départ
            </button>

            {settings.caisseStartDate && (
              <button
                type="button"
                onClick={handleRemoveCaisseStartingPoint}
                className="py-2.5 px-3 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold active:scale-95 transition-all min-h-[42px] flex items-center gap-1.5"
                title="Revenir au calcul sur tout l'historique"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Retirer</span>
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Section : Ventes personnelles */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs space-y-3.5">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
          <UserCheck className="w-4 h-4 text-teal-700" />
          <span>Ventes personnelles</span>
        </h3>
        <p className="text-[11px] text-slate-500 leading-snug">
          Configurez votre commission de vendeur par défaut pour les ventes directes du gérant sans intermédiaire.
        </p>

        <form onSubmit={handleSavePersonalSalesSettings} className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Ma commission (%)
            </label>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={ownerCommissionPct}
                onChange={(e) => setOwnerCommissionPct(e.target.value.replace(/[^0-9.,]/g, ''))}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 bg-white pr-7"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                %
              </span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              0 % par défaut. Sera proposée automatiquement lors de la création d'une vente personnelle.
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Part payée pour ma consommation (%)
            </label>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={consumptionPaidPct}
                onChange={(e) => setConsumptionPaidPct(e.target.value.replace(/[^0-9.,]/g, ''))}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 bg-white pr-7"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                %
              </span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              Par défaut égale à la part de la Réserve : je ne paie que le coût, pas ma propre marge
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Délai avant alerte de retard sur une dette (jours)
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={debtReminderDays}
              onChange={(e) => setDebtReminderDays(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="2"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 bg-white"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              2 jours par défaut. Au-delà de ce délai, la dette est signalée en retard.
            </p>
          </div>

          <button
            type="submit"
            className="w-full py-2.5 px-3 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold shadow-xs active:scale-95 transition-all min-h-[42px]"
          >
            Enregistrer
          </button>
        </form>
      </div>

      {/* Section 2: Products & Prices */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs space-y-3.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Package className="w-4 h-4 text-teal-700" />
            <span>Catalogue Produits & Prix</span>
          </h3>
        </div>

        {/* Existing Products List */}
        <div className="space-y-2">
          {products.map((prod) => (
            <div
              key={prod.id}
              className={`p-3 rounded-xl border flex items-center justify-between gap-2 ${
                prod.isActive ? 'bg-slate-50 border-slate-200' : 'bg-slate-100 border-slate-200 opacity-60'
              }`}
            >
              <div>
                <span className="text-xs font-bold text-slate-900 block">{prod.name}</span>
                <span className="text-[11px] font-mono text-teal-700 font-extrabold">
                  {formatFC(prod.defaultPrice, currency)}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                {editingProduct?.id === prod.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      inputMode="decimal"
                      defaultValue={formatNumber(prod.defaultPrice)}
                      id={`price_input_${prod.id}`}
                      className="w-20 px-2 py-1 rounded-lg border border-teal-500 text-xs font-bold font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const input = document.getElementById(
                          `price_input_${prod.id}`
                        ) as HTMLInputElement;
                        if (input) handleUpdateProductPrice(prod, input.value);
                      }}
                      className="p-1.5 bg-teal-700 text-white rounded-lg text-xs font-bold"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingProduct(prod)}
                    className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg min-w-[32px] min-h-[32px] flex items-center justify-center"
                    title="Modifier le prix"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => handleToggleProductActive(prod)}
                  className={`px-2 py-1 rounded-lg text-[10px] font-bold min-h-[32px] ${
                    prod.isActive
                      ? 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {prod.isActive ? 'Désactiver' : 'Activer'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add Product Form */}
        <form onSubmit={handleAddProduct} className="pt-2 border-t border-slate-100 flex items-center gap-2">
          <input
            type="text"
            placeholder="Nom du nouveau produit"
            value={newProductName}
            onChange={(e) => setNewProductName(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800"
          />
          <input
            type="text"
            inputMode="decimal"
            placeholder="Prix FC"
            value={newProductPrice}
            onChange={(e) => setNewProductPrice(e.target.value.replace(/[^0-9.,]/g, ''))}
            className="w-24 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 text-center"
          />
          <button
            type="submit"
            className="p-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white min-h-[40px] min-w-[40px] flex items-center justify-center shadow-xs"
            title="Ajouter produit"
          >
            <Plus className="w-4 h-4" />
          </button>
        </form>
      </div>

      {/* Section: Coût de revient : ingrédients et emballages */}
      <CostingSettingsSection
        settings={settings}
        products={products}
        onSettingsUpdated={onSettingsUpdated}
        onShowToast={onShowToast}
      />

      {/* Section: Stock de départ & alertes (ingrédients et emballages) */}
      <IngredientStockSettingsSection
        settings={settings}
        onSettingsUpdated={onSettingsUpdated}
        onShowToast={onShowToast}
      />

      {/* Section 3: Expense Categories */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs space-y-3">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
          <Layers className="w-4 h-4 text-teal-700" />
          <span>Catégories de Dépenses</span>
        </h3>

        <div className="flex flex-wrap gap-1.5">
          {categories.map((cat) => (
            <span
              key={cat}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-100 text-slate-800 text-xs font-medium border border-slate-200/60"
            >
              <span>{cat}</span>
              {categories.length > 1 && (
                <button
                  type="button"
                  onClick={() => handleDeleteCategory(cat)}
                  className="text-slate-400 hover:text-rose-600 p-0.5"
                  title="Supprimer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <input
            type="text"
            placeholder="Nouvelle catégorie (ex : Transport, Sucre...)"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800"
          />
          <button
            type="button"
            onClick={handleAddCategory}
            className="px-3.5 py-2 rounded-xl bg-slate-800 text-white text-xs font-bold hover:bg-slate-900 min-h-[40px]"
          >
            Ajouter
          </button>
        </div>
      </div>

      {/* Section 4: Security & PIN Code */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {settings.pinCode ? (
              <Lock className="w-4 h-4 text-emerald-600" />
            ) : (
              <Unlock className="w-4 h-4 text-slate-400" />
            )}
            <div>
              <h3 className="text-xs font-bold text-slate-900">
                Code PIN de verrouillage (4 chiffres)
              </h3>
              <p className="text-[11px] text-slate-500">
                {settings.pinCode
                  ? 'Code PIN actif à l’ouverture de l’application'
                  : 'Aucun code PIN (accès libre)'}
              </p>
            </div>
          </div>

          {settings.pinCode ? (
            <button
              type="button"
              onClick={handleDisablePin}
              className="px-3 py-1.5 rounded-xl bg-rose-50 text-rose-700 hover:bg-rose-100 text-xs font-bold border border-rose-200 min-h-[38px]"
            >
              Désactiver
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsPinModalOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-teal-50 text-teal-700 hover:bg-teal-100 text-xs font-bold border border-teal-200 min-h-[38px]"
            >
              Activer un PIN
            </button>
          )}
        </div>
      </div>

      {/* Section: Fiche de Paie (Personnalisation PDF) */}
      <PayslipSettingsSection
        settings={settings}
        onSettingsUpdated={onSettingsUpdated}
        onShowToast={onShowToast}
      />

      {/* Section 5: Backup & Restore */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs space-y-3">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
          <Download className="w-4 h-4 text-teal-700" />
          <span>Sauvegarde & Restauration (Hors ligne)</span>
        </h3>

        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Dernière sauvegarde :</span>
            <span className="font-bold text-slate-800 font-mono">
              {settings.lastBackupDate ? formatDate(settings.lastBackupDate) : 'Jamais'}
            </span>
          </div>
          {!settings.lastBackupDate && (
            <p className="text-amber-700 font-medium text-[11px]">
              Pensez à faire une sauvegarde régulière de vos données pour éviter toute perte en cas de changement de téléphone.
            </p>
          )}
        </div>

        {/* JSON Buttons */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={handleExportJSON}
            className="py-3 px-3 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs active:scale-95 transition-all min-h-[44px]"
          >
            <Download className="w-4 h-4" />
            <span>Sauvegarder (JSON)</span>
          </button>

          <label className="py-3 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer border border-slate-200 active:scale-95 transition-all min-h-[44px]">
            <Upload className="w-4 h-4 text-teal-700" />
            <span>Restaurer (JSON)</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileSelected}
              className="hidden"
            />
          </label>
        </div>

        {/* CSV Export Buttons */}
        <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
          <button
            type="button"
            onClick={exportSalesToCSV}
            className="flex-1 py-2 px-3 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 flex items-center justify-center gap-1.5 min-h-[40px]"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
            <span>Export Ventes CSV</span>
          </button>
          <button
            type="button"
            onClick={exportExpensesToCSV}
            className="flex-1 py-2 px-3 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 flex items-center justify-center gap-1.5 min-h-[40px]"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-teal-700" />
            <span>Export Dépenses CSV</span>
          </button>
        </div>
      </div>

      {/* PIN Setup Modal */}
      {isPinModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in"
        >
          <div className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl border border-slate-100 space-y-4">
            <h3 className="text-base font-bold text-slate-900">
              Définir un Code PIN à 4 chiffres
            </h3>

            {pinError && (
              <p className="text-xs font-semibold text-rose-600 bg-rose-50 p-2 rounded-xl">
                {pinError}
              </p>
            )}

            <form onSubmit={handleSavePin} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Code PIN (4 chiffres)
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••"
                  required
                  className="w-full text-center tracking-widest text-xl font-bold py-2.5 rounded-xl border border-slate-200 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Confirmer le code PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••"
                  required
                  className="w-full text-center tracking-widest text-xl font-bold py-2.5 rounded-xl border border-slate-200 font-mono"
                />
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsPinModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 min-h-[44px]"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-teal-700 text-white text-xs font-bold hover:bg-teal-800 min-h-[44px]"
                >
                  Activer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Restore Mode Choice Modal */}
      {isRestoreModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in"
        >
          <div className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center gap-2 text-teal-800">
              <Upload className="w-5 h-5 text-teal-700" />
              <h3 className="text-base font-bold text-slate-900">
                Mode de Restauration
              </h3>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Comment souhaitez-vous appliquer le fichier de sauvegarde ?
            </p>

            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => handleExecuteRestore('merge')}
                className="w-full text-left p-3 rounded-2xl border border-teal-200 bg-teal-50/70 hover:bg-teal-100 transition-all min-h-[44px]"
              >
                <span className="text-xs font-bold text-teal-900 block">
                  1. Fusionner avec les données actuelles
                </span>
                <span className="text-[11px] text-teal-700">
                  Conserve vos données existantes et ajoute les nouveaux enregistrements.
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleExecuteRestore('replace')}
                className="w-full text-left p-3 rounded-2xl border border-rose-200 bg-rose-50/70 hover:bg-rose-100 transition-all min-h-[44px]"
              >
                <span className="text-xs font-bold text-rose-900 block">
                  2. Remplacer totalement
                </span>
                <span className="text-[11px] text-rose-700">
                  Efface les données actuelles pour restaurer exactement le fichier de sauvegarde.
                </span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setIsRestoreModalOpen(false);
                setPendingRestoreContent(null);
              }}
              className="w-full py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 min-h-[44px]"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

function formatUnitCostFC(amount: number, currency = 'FC'): string {
  if (!Number.isFinite(amount) || isNaN(amount)) return `0 ${currency}`;
  const rounded2 = Math.round(amount * 100) / 100;
  const [intPart, decPart] = rounded2.toFixed(2).split('.');
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const trimmedDec = decPart.replace(/0+$/, '');
  return trimmedDec ? `${formattedInt},${trimmedDec} ${currency}` : `${formattedInt} ${currency}`;
}

interface CostingSettingsSectionProps {
  settings: AppSettings;
  products: Product[];
  onSettingsUpdated: (newSettings: AppSettings) => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
}

const CostingSettingsSection: React.FC<CostingSettingsSectionProps> = ({
  settings,
  products,
  onSettingsUpdated,
  onShowToast,
}) => {
  const currency = settings.currency || 'FC';
  const costItems: CostItem[] = settings.costItems ?? [];
  const productCosting: Record<string, ProductCostConfig> = settings.productCosting ?? {};

  // Shared modal state for adding/editing an ingredient or packaging item
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CostItem | null>(null);
  const [formKind, setFormKind] = useState<'ingredient' | 'packaging'>('ingredient');
  const [formName, setFormName] = useState('');
  const [formPurchaseUnit, setFormPurchaseUnit] = useState('');
  const [formPurchasePrice, setFormPurchasePrice] = useState('');
  const [formUsageUnitsPerPurchase, setFormUsageUnitsPerPurchase] = useState('');
  const [formUsageUnit, setFormUsageUnit] = useState('');
  const [formAllowDecimals, setFormAllowDecimals] = useState(false);
  const [formTrackStock, setFormTrackStock] = useState(true);
  const [formExpenseCategory, setFormExpenseCategory] = useState('');
  const [formAutoUpdateRefPrice, setFormAutoUpdateRefPrice] = useState(false);

  // Per-product drafts for volumeWeight and existing packaging line quantities
  const [volumeInputs, setVolumeInputs] = useState<Record<string, string>>({});
  const [lineQtyInputs, setLineQtyInputs] = useState<Record<string, string>>({});
  const [newPkgItemIds, setNewPkgItemIds] = useState<Record<string, string>>({});
  const [newPkgQtys, setNewPkgQtys] = useState<Record<string, string>>({});

  const activeProducts = products.filter((p) => p.isActive);
  const ingredients = costItems.filter((item) => item.kind === 'ingredient');
  const packagings = costItems.filter((item) => item.kind === 'packaging');
  const activePackagings = packagings.filter((item) => item.isActive);

  const costItemsById = new Map<string, CostItem>();
  for (const item of costItems) {
    costItemsById.set(item.id, item);
  }

  // Sync per-product inputs when settings or products change
  useEffect(() => {
    const nextVols: Record<string, string> = {};
    const nextLineQtys: Record<string, string> = {};
    const currentCosting = settings.productCosting ?? {};

    for (const prod of products) {
      const cfg = currentCosting[prod.id];
      const vol = cfg && cfg.volumeWeight > 0 ? cfg.volumeWeight : 1;
      nextVols[prod.id] = formatNumber(vol, 4);
      if (cfg?.packaging) {
        for (const line of cfg.packaging) {
          nextLineQtys[`${prod.id}::${line.itemId}`] = formatNumber(line.qtyPerUnit, 4);
        }
      }
    }
    setVolumeInputs(nextVols);
    setLineQtyInputs(nextLineQtys);
  }, [settings.productCosting, products]);

  const persistCostingData = async (
    nextItems: CostItem[],
    nextProductCosting: Record<string, ProductCostConfig>
  ) => {
    const updated: AppSettings = {
      ...settings,
      costItems: nextItems,
      productCosting: nextProductCosting,
    };
    await db.settings.put(updated);
    onSettingsUpdated(updated);
  };

  const openAddItemModal = (kind: 'ingredient' | 'packaging') => {
    setEditingItem(null);
    setFormKind(kind);
    setFormName('');
    setFormPurchaseUnit('');
    setFormPurchasePrice('');
    setFormUsageUnitsPerPurchase('');
    setFormUsageUnit('');
    setFormAllowDecimals(false);
    setFormTrackStock(true);
    setFormExpenseCategory('');
    setFormAutoUpdateRefPrice(false);
    setIsItemModalOpen(true);
  };

  const openEditItemModal = (item: CostItem) => {
    setEditingItem(item);
    setFormKind(item.kind);
    setFormName(item.name);
    setFormPurchaseUnit(item.purchaseUnit);
    setFormPurchasePrice(formatNumber(item.purchasePriceFC, 4));
    setFormUsageUnitsPerPurchase(formatNumber(item.usageUnitsPerPurchase, 4));
    setFormUsageUnit(item.usageUnit);
    setFormAllowDecimals(item.allowDecimals);
    setFormTrackStock(item.trackStock !== false);
    setFormExpenseCategory(item.expenseCategory || '');
    setFormAutoUpdateRefPrice(Boolean(item.autoUpdateRefPrice));
    setIsItemModalOpen(true);
  };

  const handleSaveCostItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = formName.trim();
    const trimmedPurchaseUnit = formPurchaseUnit.trim();
    const trimmedUsageUnit = formUsageUnit.trim();

    if (!trimmedName) {
      onShowToast('error', 'Veuillez saisir le nom de l’élément.');
      return;
    }
    if (!trimmedPurchaseUnit) {
      onShowToast('error', 'Veuillez indiquer l’unité d’achat (ex. paquet, bouteille).');
      return;
    }
    if (formPurchasePrice.trim() === '') {
      onShowToast('error', 'Veuillez saisir le prix d’achat.');
      return;
    }
    const priceNum = parseLocaleNumber(formPurchasePrice);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      onShowToast('error', 'Le prix d’achat doit être un nombre positif ou nul.');
      return;
    }
    if (formUsageUnitsPerPurchase.trim() === '') {
      onShowToast('error', 'Veuillez indiquer le contenu d’un achat en unités d’utilisation.');
      return;
    }
    const unitsNum = parseLocaleNumber(formUsageUnitsPerPurchase);
    if (!Number.isFinite(unitsNum) || unitsNum <= 0) {
      onShowToast('error', 'Le contenu d’un achat doit être supérieur à 0.');
      return;
    }
    if (!trimmedUsageUnit) {
      onShowToast('error', 'Veuillez indiquer l’unité d’utilisation (ex. boîte, sachet, bouchon).');
      return;
    }

    const cleanedExpenseCategory = formExpenseCategory.trim() || undefined;

    if (editingItem) {
      const updatedItem: CostItem = {
        ...editingItem,
        kind: formKind,
        name: trimmedName,
        purchaseUnit: trimmedPurchaseUnit,
        purchasePriceFC: priceNum,
        usageUnit: trimmedUsageUnit,
        usageUnitsPerPurchase: unitsNum,
        allowDecimals: formAllowDecimals,
        trackStock: formTrackStock,
        expenseCategory: cleanedExpenseCategory,
        autoUpdateRefPrice: formAutoUpdateRefPrice,
      };
      const nextItems = costItems.map((it) => (it.id === editingItem.id ? updatedItem : it));
      await persistCostingData(nextItems, productCosting);
      setIsItemModalOpen(false);
      onShowToast('success', `« ${trimmedName} » mis à jour.`);
    } else {
      const newItem: CostItem = {
        id: 'cost_' + Date.now().toString() + '_' + Math.random().toString(36).slice(2, 6),
        kind: formKind,
        name: trimmedName,
        purchaseUnit: trimmedPurchaseUnit,
        purchasePriceFC: priceNum,
        usageUnit: trimmedUsageUnit,
        usageUnitsPerPurchase: unitsNum,
        allowDecimals: formAllowDecimals,
        trackStock: formTrackStock,
        expenseCategory: cleanedExpenseCategory,
        autoUpdateRefPrice: formAutoUpdateRefPrice,
        isActive: true,
        createdAt: Date.now(),
      };
      const nextItems = [...costItems, newItem];
      await persistCostingData(nextItems, productCosting);
      setIsItemModalOpen(false);
      onShowToast(
        'success',
        formKind === 'ingredient'
          ? `Ingrédient « ${trimmedName} » ajouté.`
          : `Emballage « ${trimmedName} » ajouté.`
      );
    }
  };

  const handleToggleCostItemActive = async (item: CostItem) => {
    const nextActive = !item.isActive;
    const nextItems = costItems.map((it) =>
      it.id === item.id ? { ...it, isActive: nextActive } : it
    );
    await persistCostingData(nextItems, productCosting);
    onShowToast(
      'info',
      nextActive
        ? `« ${item.name} » réactivé.`
        : `« ${item.name} » désactivé (conservé pour l’historique).`
    );
  };

  const getSavedProductConfig = (productId: string): ProductCostConfig => {
    const existing = productCosting[productId];
    return {
      volumeWeight: existing && existing.volumeWeight > 0 ? existing.volumeWeight : 1,
      packaging: existing?.packaging ? [...existing.packaging] : [],
    };
  };

  const handleSaveProductVolume = async (productId: string, rawVal?: string) => {
    const savedCfg = getSavedProductConfig(productId);
    const strVal = (rawVal !== undefined ? rawVal : volumeInputs[productId] ?? '').trim();

    if (!strVal) {
      setVolumeInputs((prev) => ({
        ...prev,
        [productId]: formatNumber(savedCfg.volumeWeight, 4),
      }));
      return;
    }

    const volNum = parseLocaleNumber(strVal);
    if (!Number.isFinite(volNum) || volNum <= 0) {
      onShowToast('error', 'Le volume relatif doit être un nombre supérieur à 0.');
      setVolumeInputs((prev) => ({
        ...prev,
        [productId]: formatNumber(savedCfg.volumeWeight, 4),
      }));
      return;
    }

    if (volNum === savedCfg.volumeWeight && productCosting[productId]) {
      setVolumeInputs((prev) => ({
        ...prev,
        [productId]: formatNumber(volNum, 4),
      }));
      return;
    }

    const nextCosting: Record<string, ProductCostConfig> = {
      ...productCosting,
      [productId]: {
        ...savedCfg,
        volumeWeight: volNum,
      },
    };
    await persistCostingData(costItems, nextCosting);
    onShowToast('success', 'Volume relatif enregistré.');
  };

  const handleSavePackagingLineQty = async (
    productId: string,
    itemId: string,
    rawVal?: string
  ) => {
    const key = `${productId}::${itemId}`;
    const savedCfg = getSavedProductConfig(productId);
    const existingLine = savedCfg.packaging.find((l) => l.itemId === itemId);
    if (!existingLine) return;

    const strVal = (rawVal !== undefined ? rawVal : lineQtyInputs[key] ?? '').trim();
    if (!strVal) {
      setLineQtyInputs((prev) => ({
        ...prev,
        [key]: formatNumber(existingLine.qtyPerUnit, 4),
      }));
      return;
    }

    const qtyNum = parseLocaleNumber(strVal);
    const item = costItemsById.get(itemId);

    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      onShowToast('error', 'La quantité par unité produite doit être supérieure à 0.');
      setLineQtyInputs((prev) => ({
        ...prev,
        [key]: formatNumber(existingLine.qtyPerUnit, 4),
      }));
      return;
    }

    if (item && !item.allowDecimals && !Number.isInteger(qtyNum)) {
      onShowToast(
        'error',
        `« ${item.name} » n’accepte pas les quantités avec virgule (nombre entier requis).`
      );
      setLineQtyInputs((prev) => ({
        ...prev,
        [key]: formatNumber(existingLine.qtyPerUnit, 4),
      }));
      return;
    }

    if (qtyNum === existingLine.qtyPerUnit) {
      setLineQtyInputs((prev) => ({
        ...prev,
        [key]: formatNumber(qtyNum, 4),
      }));
      return;
    }

    const nextPackaging: ProductPackagingLine[] = savedCfg.packaging.map((l) =>
      l.itemId === itemId ? { ...l, qtyPerUnit: qtyNum } : l
    );

    const nextCosting: Record<string, ProductCostConfig> = {
      ...productCosting,
      [productId]: {
        ...savedCfg,
        packaging: nextPackaging,
      },
    };
    await persistCostingData(costItems, nextCosting);
    onShowToast('success', 'Quantité d’emballage mise à jour.');
  };

  const handleAddPackagingLine = async (productId: string, availableItems: CostItem[]) => {
    const selectedId = newPkgItemIds[productId] || availableItems[0]?.id || '';
    const item = costItemsById.get(selectedId);
    if (!item || item.kind !== 'packaging' || !item.isActive) {
      onShowToast('error', 'Veuillez choisir un élément d’emballage actif.');
      return;
    }

    const rawQty = (newPkgQtys[productId] ?? '1').trim();
    const qtyNum = parseLocaleNumber(rawQty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      onShowToast('error', 'La quantité par unité produite doit être supérieure à 0.');
      return;
    }

    if (!item.allowDecimals && !Number.isInteger(qtyNum)) {
      onShowToast(
        'error',
        `« ${item.name} » n’accepte pas les quantités avec virgule (nombre entier requis).`
      );
      return;
    }

    const savedCfg = getSavedProductConfig(productId);
    if (savedCfg.packaging.some((l) => l.itemId === item.id)) {
      onShowToast('error', 'Cet emballage est déjà présent sur ce produit.');
      return;
    }

    const draftVol = parseLocaleNumber(volumeInputs[productId] ?? '');
    const effectiveVol =
      Number.isFinite(draftVol) && draftVol > 0 ? draftVol : savedCfg.volumeWeight;

    const nextCosting: Record<string, ProductCostConfig> = {
      ...productCosting,
      [productId]: {
        volumeWeight: effectiveVol,
        packaging: [...savedCfg.packaging, { itemId: item.id, qtyPerUnit: qtyNum }],
      },
    };

    await persistCostingData(costItems, nextCosting);
    setNewPkgItemIds((prev) => ({ ...prev, [productId]: '' }));
    setNewPkgQtys((prev) => ({ ...prev, [productId]: '1' }));
    onShowToast('success', `« ${item.name} » ajouté à l’emballage du produit.`);
  };

  const handleRemovePackagingLine = async (productId: string, itemId: string) => {
    const savedCfg = getSavedProductConfig(productId);
    const nextPackaging = savedCfg.packaging.filter((l) => l.itemId !== itemId);
    const nextCosting: Record<string, ProductCostConfig> = {
      ...productCosting,
      [productId]: {
        ...savedCfg,
        packaging: nextPackaging,
      },
    };
    await persistCostingData(costItems, nextCosting);
    onShowToast('info', 'Ligne d’emballage retirée de ce produit.');
  };

  // Live preview inside the add/edit CostItem modal
  const parsedFormPrice =
    formPurchasePrice.trim() !== '' ? parseLocaleNumber(formPurchasePrice) : NaN;
  const parsedFormUnits =
    formUsageUnitsPerPurchase.trim() !== '' ? parseLocaleNumber(formUsageUnitsPerPurchase) : NaN;
  const liveFormUnitCost =
    Number.isFinite(parsedFormPrice) &&
    parsedFormPrice >= 0 &&
    Number.isFinite(parsedFormUnits) &&
    parsedFormUnits > 0
      ? parsedFormPrice / parsedFormUnits
      : null;

  const renderCostItemsList = (items: CostItem[], kind: 'ingredient' | 'packaging') => {
    const sorted = [...items].sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return a.createdAt - b.createdAt;
    });

    if (sorted.length === 0) {
      return (
        <p className="text-[11px] text-slate-500 italic py-2">
          {kind === 'ingredient'
            ? 'Aucun ingrédient enregistré pour le moment.'
            : 'Aucun emballage enregistré pour le moment.'}
        </p>
      );
    }

    return (
      <div className="divide-y divide-slate-100">
        {sorted.map((item) => {
          const unitCost =
            item.usageUnitsPerPurchase > 0
              ? item.purchasePriceFC / item.usageUnitsPerPurchase
              : 0;
          return (
            <div
              key={item.id}
              className={`py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                item.isActive ? '' : 'opacity-60'
              }`}
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-bold text-slate-900">{item.name}</span>
                  {!item.isActive && (
                    <span className="px-1.5 py-0.5 rounded-md bg-slate-200 text-slate-700 text-[10px] font-bold">
                      Désactivé
                    </span>
                  )}
                  <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-medium">
                    {item.allowDecimals ? 'Avec virgule' : 'Entier uniquement'}
                  </span>
                  {item.trackStock === false && (
                    <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[10px] font-medium">
                      Stock non suivi
                    </span>
                  )}
                  {item.expenseCategory && (
                    <span className="px-1.5 py-0.5 rounded-md bg-teal-50 text-teal-800 text-[10px] font-semibold">
                      {item.expenseCategory}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500">
                  Achat : 1 {item.purchaseUnit} ({formatUnitCostFC(item.purchasePriceFC, currency)})
                  {' → '}
                  {formatNumber(item.usageUnitsPerPurchase, 4)} {item.usageUnit}
                </p>
                <p className="text-[11px] font-bold text-teal-800">
                  Coût par {item.usageUnit} : {formatUnitCostFC(unitCost, currency)}
                </p>
              </div>

              <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                <button
                  type="button"
                  onClick={() => openEditItemModal(item)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold flex items-center gap-1 min-h-[34px]"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Modifier</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleCostItemActive(item)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold min-h-[34px] ${
                    item.isActive
                      ? 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100'
                      : 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                  }`}
                >
                  {item.isActive ? 'Désactiver' : 'Réactiver'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs space-y-4">
      <div className="space-y-1">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
          <Calculator className="w-4 h-4 text-teal-700" />
          <span>Coût de revient : ingrédients et emballages</span>
        </h3>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Estimation de coût uniquement : cette section ne crée aucune dépense et ne modifie jamais
          les caisses, les bénéfices, le stock ni les ventes.
        </p>
      </div>

      {/* Help example box */}
      <div className="p-3 rounded-xl bg-teal-50/70 border border-teal-200/80 text-[11px] text-teal-900 leading-relaxed">
        <span className="font-bold">Exemple :</span> Ex. paquet de sucre vanillé : prix 1 500,
        contenu 10, unité sachet → 150 FC le sachet
      </div>

      {/* Sub-section 1: Ingrédients */}
      <div className="p-3 rounded-xl border border-slate-200/80 bg-slate-50/40 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-bold text-slate-900">Ingrédients</h4>
            <p className="text-[10px] text-slate-500">
              Un élément désactivé n’est plus proposé pour les nouvelles productions mais reste
              visible dans les anciennes.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openAddItemModal('ingredient')}
            className="px-3 py-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold flex items-center gap-1 shrink-0 min-h-[38px]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Ajouter</span>
          </button>
        </div>

        {renderCostItemsList(ingredients, 'ingredient')}
      </div>

      {/* Sub-section 2: Emballages */}
      <div className="p-3 rounded-xl border border-slate-200/80 bg-slate-50/40 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-bold text-slate-900">Emballages</h4>
            <p className="text-[10px] text-slate-500">
              Bouteilles vides, bouchons, sachets, étiquettes… (jamais supprimés définitivement).
            </p>
          </div>
          <button
            type="button"
            onClick={() => openAddItemModal('packaging')}
            className="px-3 py-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold flex items-center gap-1 shrink-0 min-h-[38px]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Ajouter</span>
          </button>
        </div>

        {renderCostItemsList(packagings, 'packaging')}
      </div>

      {/* Sub-section 3: Volume relatif & Emballage par produit actif */}
      <div className="space-y-3 pt-1">
        <div>
          <h4 className="text-xs font-bold text-slate-900">
            Volume relatif & emballage par produit actif
          </h4>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Sert à répartir le coût des ingrédients entre tes produits, ex. 1 bouteille = 2 sachets
            → mets 2 pour la bouteille et 1 pour le sachet.
          </p>
        </div>

        {activeProducts.length === 0 ? (
          <p className="text-[11px] text-slate-500 italic">Aucun produit actif.</p>
        ) : (
          <div className="space-y-3">
            {activeProducts.map((prod) => {
              const savedCfg = getSavedProductConfig(prod.id);
              const volInputStr = volumeInputs[prod.id] ?? formatNumber(savedCfg.volumeWeight, 4);
              const parsedDraftVol = parseLocaleNumber(volInputStr);
              const isVolDirty =
                volInputStr.trim() !== '' &&
                Number.isFinite(parsedDraftVol) &&
                parsedDraftVol !== savedCfg.volumeWeight;

              const usedItemIds = new Set(savedCfg.packaging.map((l) => l.itemId));
              const selectablePackagings = activePackagings.filter(
                (item) => !usedItemIds.has(item.id)
              );
              const selectedNewItemId =
                newPkgItemIds[prod.id] && selectablePackagings.some((i) => i.id === newPkgItemIds[prod.id])
                  ? newPkgItemIds[prod.id]
                  : selectablePackagings[0]?.id || '';
              const selectedNewItem = costItemsById.get(selectedNewItemId);

              // Calculate live packaging cost per unit for this product
              const packagingUnitCostFC = savedCfg.packaging.reduce((sum, line) => {
                const item = costItemsById.get(line.itemId);
                if (!item || item.usageUnitsPerPurchase <= 0) return sum;
                const itemUnitCost = item.purchasePriceFC / item.usageUnitsPerPurchase;
                const draftKey = `${prod.id}::${line.itemId}`;
                const rawDraft = lineQtyInputs[draftKey];
                const parsedDraft =
                  rawDraft !== undefined && rawDraft.trim() !== ''
                    ? parseLocaleNumber(rawDraft)
                    : line.qtyPerUnit;
                const effectiveQty =
                  Number.isFinite(parsedDraft) && parsedDraft > 0 ? parsedDraft : line.qtyPerUnit;
                return sum + effectiveQty * itemUnitCost;
              }, 0);

              return (
                <div
                  key={prod.id}
                  className="p-3 rounded-xl border border-slate-200 bg-white space-y-3"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <span className="text-xs font-extrabold text-slate-900">{prod.name}</span>
                      <span className="ml-2 text-[11px] text-slate-500">
                        (Prix vente : {formatFC(prod.defaultPrice, currency)})
                      </span>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-teal-50 border border-teal-200 text-[11px] font-bold text-teal-900">
                      Coût d’emballage par unité : {formatUnitCostFC(packagingUnitCostFC, currency)}
                    </span>
                  </div>

                  {/* Volume relatif */}
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs font-bold text-slate-800">Volume relatif</label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={volInputStr}
                          onChange={(e) =>
                            setVolumeInputs((prev) => ({
                              ...prev,
                              [prod.id]: e.target.value.replace(/[^0-9.,]/g, ''),
                            }))
                          }
                          onBlur={(e) => handleSaveProductVolume(prod.id, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleSaveProductVolume(prod.id, volInputStr);
                            }
                          }}
                          className="w-20 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-900 text-center"
                        />
                        {isVolDirty && (
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handleSaveProductVolume(prod.id, volInputStr)}
                            className="p-1.5 rounded-lg bg-teal-700 text-white hover:bg-teal-800"
                            title="Enregistrer le volume relatif"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-snug">
                      Sert à répartir le coût des ingrédients entre tes produits, ex. 1 bouteille =
                      2 sachets → mets 2 pour la bouteille et 1 pour le sachet.
                    </p>
                  </div>

                  {/* Emballage de ce produit */}
                  <div className="space-y-2">
                    <h5 className="text-[11px] font-bold text-slate-700">
                      Emballage de ce produit
                    </h5>

                    {savedCfg.packaging.length === 0 ? (
                      <p className="text-[11px] text-slate-400 italic">
                        Aucun élément d’emballage associé à ce produit.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {savedCfg.packaging.map((line) => {
                          const item = costItemsById.get(line.itemId);
                          const draftKey = `${prod.id}::${line.itemId}`;
                          const qtyStr =
                            lineQtyInputs[draftKey] ?? formatNumber(line.qtyPerUnit, 4);
                          const parsedQty = parseLocaleNumber(qtyStr);
                          const isQtyDirty =
                            qtyStr.trim() !== '' &&
                            Number.isFinite(parsedQty) &&
                            parsedQty !== line.qtyPerUnit;
                          const itemUnitCost =
                            item && item.usageUnitsPerPurchase > 0
                              ? item.purchasePriceFC / item.usageUnitsPerPurchase
                              : 0;
                          const effectiveQty =
                            Number.isFinite(parsedQty) && parsedQty > 0
                              ? parsedQty
                              : line.qtyPerUnit;
                          const lineCost = effectiveQty * itemUnitCost;

                          return (
                            <div
                              key={line.itemId}
                              className="flex items-center justify-between gap-2 p-2 rounded-xl bg-slate-50 border border-slate-200/70"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-xs font-semibold text-slate-800">
                                    {item ? item.name : 'Élément inconnu'}
                                  </span>
                                  {item && !item.isActive && (
                                    <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                                      désactivé
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] text-slate-500">
                                  {formatUnitCostFC(lineCost, currency)} par unité produite
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <input
                                  type="text"
                                  inputMode={item?.allowDecimals ? 'decimal' : 'numeric'}
                                  value={qtyStr}
                                  onChange={(e) => {
                                    const pattern = item?.allowDecimals
                                      ? /[^0-9.,]/g
                                      : /[^0-9]/g;
                                    setLineQtyInputs((prev) => ({
                                      ...prev,
                                      [draftKey]: e.target.value.replace(pattern, ''),
                                    }));
                                  }}
                                  onBlur={(e) =>
                                    handleSavePackagingLineQty(prod.id, line.itemId, e.target.value)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      handleSavePackagingLineQty(prod.id, line.itemId, qtyStr);
                                    }
                                  }}
                                  className="w-16 px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-900 text-center"
                                />
                                <span className="text-[11px] text-slate-600 font-medium">
                                  {item?.usageUnit || 'u.'}
                                </span>
                                {isQtyDirty && (
                                  <button
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() =>
                                      handleSavePackagingLineQty(prod.id, line.itemId, qtyStr)
                                    }
                                    className="p-1.5 rounded-lg bg-teal-700 text-white hover:bg-teal-800"
                                    title="Enregistrer la quantité"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleRemovePackagingLine(prod.id, line.itemId)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                                  title="Retirer cet emballage de ce produit"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Add packaging line form */}
                    {selectablePackagings.length > 0 ? (
                      <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 pt-1">
                        <select
                          value={selectedNewItemId}
                          onChange={(e) =>
                            setNewPkgItemIds((prev) => ({
                              ...prev,
                              [prod.id]: e.target.value,
                            }))
                          }
                          className="flex-1 min-w-[140px] px-2.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-800 min-h-[38px]"
                        >
                          {selectablePackagings.map((pkg) => (
                            <option key={pkg.id} value={pkg.id}>
                              {pkg.name} ({pkg.usageUnit})
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          inputMode={selectedNewItem?.allowDecimals ? 'decimal' : 'numeric'}
                          placeholder="Qté"
                          value={newPkgQtys[prod.id] ?? '1'}
                          onChange={(e) => {
                            const pattern = selectedNewItem?.allowDecimals
                              ? /[^0-9.,]/g
                              : /[^0-9]/g;
                            setNewPkgQtys((prev) => ({
                              ...prev,
                              [prod.id]: e.target.value.replace(pattern, ''),
                            }));
                          }}
                          className="w-20 px-2.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-800 text-center min-h-[38px]"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddPackagingLine(prod.id, selectablePackagings)}
                          className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold flex items-center gap-1 min-h-[38px] shrink-0"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Ajouter</span>
                        </button>
                      </div>
                    ) : activePackagings.length === 0 ? (
                      <p className="text-[10px] text-slate-500">
                        Ajoutez d’abord un emballage actif dans la section « Emballages » ci-dessus
                        (ex. bouteille vide, étiquette, sachet).
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Shared Add/Edit Modal for Ingrédient & Emballage */}
      {isItemModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in overflow-y-auto"
        >
          <div className="w-full max-w-md bg-white rounded-3xl p-5 shadow-2xl border border-slate-100 space-y-4 my-auto">
            <h3 className="text-base font-bold text-slate-900">
              {editingItem
                ? formKind === 'ingredient'
                  ? 'Modifier l’ingrédient'
                  : 'Modifier l’emballage'
                : formKind === 'ingredient'
                ? 'Nouvel ingrédient'
                : 'Nouvel emballage'}
            </h3>

            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 leading-relaxed">
              Ex. paquet de sucre vanillé : prix 1 500, contenu 10, unité sachet → 150 FC le sachet
            </div>

            <form onSubmit={handleSaveCostItem} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Nom</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={
                    formKind === 'ingredient'
                      ? 'Ex. Sucre vanillé, Lait en poudre...'
                      : 'Ex. Bouteille vide, Étiquette, Sachet...'
                  }
                  required
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Unité d’achat
                  </label>
                  <input
                    type="text"
                    value={formPurchaseUnit}
                    onChange={(e) => setFormPurchaseUnit(e.target.value)}
                    placeholder="Ex. paquet, bouteille"
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Prix d’achat ({currency})
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formPurchasePrice}
                    onChange={(e) =>
                      setFormPurchasePrice(e.target.value.replace(/[^0-9.,]/g, ''))
                    }
                    placeholder="Ex. 1500"
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-800"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Contenu d’un achat
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formUsageUnitsPerPurchase}
                    onChange={(e) =>
                      setFormUsageUnitsPerPurchase(e.target.value.replace(/[^0-9.,]/g, ''))
                    }
                    placeholder="Ex. 10"
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Unité d’utilisation
                  </label>
                  <input
                    type="text"
                    value={formUsageUnit}
                    onChange={(e) => setFormUsageUnit(e.target.value)}
                    placeholder="Ex. boîte, sachet, bouchon"
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formAllowDecimals}
                  onChange={(e) => setFormAllowDecimals(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                />
                <span className="text-xs font-semibold text-slate-800">
                  Accepter les quantités avec virgule
                </span>
              </label>

              <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formTrackStock}
                  onChange={(e) => setFormTrackStock(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                />
                <span className="text-xs font-semibold text-slate-800">
                  Suivre le stock
                </span>
              </label>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Catégorie de dépense associée
                </label>
                <select
                  value={formExpenseCategory}
                  onChange={(e) => setFormExpenseCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-800 min-h-[38px]"
                >
                  <option value="">— Aucune catégorie associée —</option>
                  {formExpenseCategory &&
                    !(settings.expenseCategories || []).includes(formExpenseCategory) && (
                      <option value={formExpenseCategory}>{formExpenseCategory}</option>
                    )}
                  {(settings.expenseCategories || []).map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formAutoUpdateRefPrice}
                  onChange={(e) => setFormAutoUpdateRefPrice(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded border-slate-300 text-teal-700 focus:ring-teal-600 shrink-0"
                />
                <span className="text-xs font-semibold text-slate-800 leading-snug">
                  Mettre à jour automatiquement le prix de référence après chaque achat
                </span>
              </label>

              {/* Live unit cost display */}
              <div className="p-3 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-teal-900">
                  Coût par {formUsageUnit.trim() || 'unité d’utilisation'} :
                </span>
                <span className="text-sm font-extrabold text-teal-900 font-mono">
                  {liveFormUnitCost !== null
                    ? formatUnitCostFC(liveFormUnitCost, currency)
                    : `— ${currency}`}
                </span>
              </div>

              <div className="pt-1 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsItemModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 min-h-[44px]"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-teal-700 text-white text-xs font-bold hover:bg-teal-800 min-h-[44px]"
                >
                  {editingItem ? 'Enregistrer' : 'Ajouter'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

interface IngredientStockSettingsSectionProps {
  settings: AppSettings;
  onSettingsUpdated: (newSettings: AppSettings) => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
}

const IngredientStockSettingsSection: React.FC<IngredientStockSettingsSectionProps> = ({
  settings,
  onSettingsUpdated,
  onShowToast,
}) => {
  const costItems = settings.costItems ?? [];
  const trackedItems = costItems.filter(
    (it) => it.isActive !== false && it.trackStock !== false
  );

  const [stockStartDate, setStockStartDate] = useState(settings.stockStartDate || '');
  const [stockStartInputs, setStockStartInputs] = useState<Record<string, string>>({});
  const [stockLowBatchesStr, setStockLowBatchesStr] = useState(
    formatNumber(settings.stockLowBatches ?? 1, 2)
  );
  const [priceRiseAlertPctStr, setPriceRiseAlertPctStr] = useState(
    formatNumber(settings.priceRiseAlertPct ?? 5, 2)
  );

  useEffect(() => {
    setStockStartDate(settings.stockStartDate || '');
    setStockLowBatchesStr(formatNumber(settings.stockLowBatches ?? 1, 2));
    setPriceRiseAlertPctStr(formatNumber(settings.priceRiseAlertPct ?? 5, 2));

    const nextInputs: Record<string, string> = {};
    const currentStart = settings.stockStart ?? {};
    for (const item of settings.costItems ?? []) {
      const val = currentStart[item.id];
      if (val !== undefined && Number.isFinite(val)) {
        nextInputs[item.id] = formatNumber(val, 4);
      } else {
        nextInputs[item.id] = '0';
      }
    }
    setStockStartInputs(nextInputs);
  }, [
    settings.stockStartDate,
    settings.stockStart,
    settings.stockLowBatches,
    settings.priceRiseAlertPct,
    settings.costItems,
  ]);

  const handleSaveStockSettings = async (e: React.FormEvent) => {
    e.preventDefault();

    const parsedLowBatches =
      stockLowBatchesStr.trim() === '' ? 1 : parseLocaleNumber(stockLowBatchesStr);
    if (!Number.isFinite(parsedLowBatches) || parsedLowBatches < 0) {
      onShowToast('error', 'Le seuil de stock bas (en fournées) doit être positif ou nul.');
      return;
    }

    const parsedPriceRisePct =
      priceRiseAlertPctStr.trim() === '' ? 5 : parseLocaleNumber(priceRiseAlertPctStr);
    if (!Number.isFinite(parsedPriceRisePct) || parsedPriceRisePct < 0) {
      onShowToast('error', 'Le seuil d’alerte de hausse de prix (%) doit être positif ou nul.');
      return;
    }

    const nextStockStart: Record<string, number> = { ...(settings.stockStart ?? {}) };
    for (const item of trackedItems) {
      const raw = (stockStartInputs[item.id] ?? '0').trim();
      const qty = raw === '' ? 0 : parseLocaleNumber(raw);
      if (!Number.isFinite(qty) || qty < 0) {
        onShowToast(
          'error',
          `La quantité de départ pour « ${item.name} » doit être positive ou nulle.`
        );
        return;
      }
      if (!item.allowDecimals && !Number.isInteger(qty)) {
        onShowToast(
          'error',
          `« ${item.name} » n’accepte pas les quantités avec virgule (nombre entier requis).`
        );
        return;
      }
      nextStockStart[item.id] = qty;
    }

    const updated: AppSettings = {
      ...settings,
      stockStartDate: stockStartDate.trim() || undefined,
      stockStart: nextStockStart,
      stockLowBatches: parsedLowBatches,
      priceRiseAlertPct: parsedPriceRisePct,
    };

    await db.settings.put(updated);
    onSettingsUpdated(updated);
    onShowToast('success', 'Stock de départ et alertes enregistrés.');
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs space-y-4">
      <div className="space-y-1">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
          <Package className="w-4 h-4 text-teal-700" />
          <span>Stock de départ & alertes (ingrédients)</span>
        </h3>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          Définissez votre stock initial à une date donnée ainsi que vos seuils d’alerte. Ce suivi
          ne modifie jamais les caisses, les dépenses ni le stock des produits finis.
        </p>
      </div>

      <form onSubmit={handleSaveStockSettings} className="space-y-3.5">
        {/* Date du stock de départ */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">
            Date du stock de départ
          </label>
          <input
            type="date"
            value={stockStartDate}
            onChange={(e) => setStockStartDate(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-900 min-h-[40px]"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            Seuls les achats, productions et ajustements datés à partir de cette date seront pris en
            compte.
          </p>
        </div>

        {/* Lignes par élément suivi */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold text-slate-800">
            Quantités de départ (en unités d’utilisation)
          </h4>

          {trackedItems.length === 0 ? (
            <p className="text-[11px] text-slate-500 italic py-1">
              Aucun élément suivi pour le moment. Ajoutez des ingrédients ou emballages ci-dessus.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200/80 bg-slate-50/50">
              {trackedItems.map((item) => {
                const rawVal = stockStartInputs[item.id] ?? '0';
                const parsedUsage = rawVal.trim() === '' ? 0 : parseLocaleNumber(rawVal);
                const safeUsage =
                  Number.isFinite(parsedUsage) && parsedUsage >= 0 ? parsedUsage : 0;
                const unitsPerPurchase =
                  item.usageUnitsPerPurchase > 0 ? item.usageUnitsPerPurchase : 1;
                const equivPurchase = safeUsage / unitsPerPurchase;

                return (
                  <div
                    key={item.id}
                    className="p-2.5 flex items-center justify-between gap-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-bold text-slate-900 block truncate">
                        {item.name}
                      </span>
                      <span className="text-[11px] text-teal-800 font-semibold block">
                        Équivalent : {formatNumber(equivPurchase, 2)} {item.purchaseUnit}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <input
                        type="text"
                        inputMode={item.allowDecimals ? 'decimal' : 'numeric'}
                        value={rawVal}
                        onChange={(e) => {
                          const pattern = item.allowDecimals ? /[^0-9.,]/g : /[^0-9]/g;
                          setStockStartInputs((prev) => ({
                            ...prev,
                            [item.id]: e.target.value.replace(pattern, ''),
                          }));
                        }}
                        className="w-20 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-extrabold text-slate-900 text-center min-h-[36px]"
                      />
                      <span className="text-[11px] font-semibold text-slate-600">
                        {item.usageUnit}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Seuils d'alerte */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Alerte stock bas : moins de N fournées
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={stockLowBatchesStr}
              onChange={(e) => setStockLowBatchesStr(e.target.value.replace(/[^0-9.,]/g, ''))}
              placeholder="1"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-900 min-h-[40px]"
            />
            <span className="text-[10px] text-slate-400 block mt-1">1 fournée par défaut</span>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Alerte hausse de prix : plus de N %
            </label>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                value={priceRiseAlertPctStr}
                onChange={(e) => setPriceRiseAlertPctStr(e.target.value.replace(/[^0-9.,]/g, ''))}
                placeholder="5"
                className="w-full px-3 py-2 pr-7 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-900 min-h-[40px]"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                %
              </span>
            </div>
            <span className="text-[10px] text-slate-400 block mt-1">5 % par défaut</span>
          </div>
        </div>

        <button
          type="submit"
          className="w-full py-2.5 px-3 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold shadow-xs active:scale-95 transition-all min-h-[42px]"
        >
          Enregistrer le stock de départ et les alertes
        </button>
      </form>
    </div>
  );
};

