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
import type { AppSettings, Product } from '../../types';

interface SettingsViewProps {
  settings: AppSettings;
  onSettingsUpdated: (newSettings: AppSettings) => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSettingsUpdated,
  onShowToast,
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

  // Ventes personnelles (Ma commission & Consommation)
  const [ownerCommissionPct, setOwnerCommissionPct] = useState(
    settings.ownerCommissionPct !== undefined ? formatNumber(settings.ownerCommissionPct) : '0'
  );
  const [consumptionPaidPct, setConsumptionPaidPct] = useState(
    settings.consumptionPaidPct !== undefined
      ? formatNumber(settings.consumptionPaidPct)
      : formatNumber(settings.expenseReservePct ?? 50)
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

    const updated: AppSettings = {
      ...settings,
      ownerCommissionPct: commNum,
      consumptionPaidPct: paidPctNum,
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
          <PWAInstallButton variant="full" />
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
                    src="/icon.svg"
                    alt="Logo par défaut"
                    className="w-full h-full object-cover rounded-xl"
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
