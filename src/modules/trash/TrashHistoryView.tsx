import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  Trash2,
  RotateCcw,
  Eye,
  Search,
  X,
  CheckCircle2,
  Clock,
  Calendar,
  Filter,
} from 'lucide-react';
import { liveQuery } from 'dexie';
import { db } from '../../db/db';
import {
  formatDate,
  formatFC,
  formatNumber,
  toISODate,
  getDateRangeForFilter,
} from '../../utils/formatters';
import { STOCK_ADJUSTMENT_REASON_LABELS } from '../../utils/ingredientStockCalculator';
import { formatReceiptNumber } from '../../utils/receiptPdfGenerator';
import {
  ALL_TRASH_KINDS,
  TRASH_KIND_LABELS,
  formatDateTimeFR,
  restoreFromTrash,
  permanentlyDeleteTrashItem,
  emptyTrash,
} from '../../utils/trashManager';
import { ConfirmModal } from '../../components/ConfirmModal';
import { EmptyState } from '../../components/EmptyState';
import type {
  AppSettings,
  TrashItem,
  TrashKind,
  PeriodFilterType,
  DailyEntry,
  PersonalSale,
  ProductionEntry,
  Expense,
  Payment,
  ReserveMovement,
  DebtPayment,
  Customer,
  StockAdjustment,
} from '../../types';

interface TrashHistoryViewProps {
  settings: AppSettings;
  onBack: () => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
}

type TrashPeriodFilter = 'all' | PeriodFilterType;

function normalizeText(val: string): string {
  return val
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export const TrashHistoryView: React.FC<TrashHistoryViewProps> = ({
  settings,
  onBack,
  onShowToast,
}) => {
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedKind, setSelectedKind] = useState<'all' | TrashKind>('all');
  const [periodFilter, setPeriodFilter] = useState<TrashPeriodFilter>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const [detailItem, setDetailItem] = useState<TrashItem | null>(null);
  const [itemToHardDelete, setItemToHardDelete] = useState<TrashItem | null>(null);
  const [isEmptyTrashOpen, setIsEmptyTrashOpen] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const currency = settings.currency || 'FC';

  useEffect(() => {
    const sub = liveQuery(() => db.trash.toArray()).subscribe({
      next: (list) => {
        const sorted = [...list].sort((a, b) => b.deletedAt - a.deletedAt);
        setTrashItems(sorted);
      },
      error: (err) => {
        console.error('Erreur chargement corbeille:', err);
      },
    });
    return () => sub.unsubscribe();
  }, []);

  // Keep detail modal synced if restored while open
  useEffect(() => {
    if (!detailItem) return;
    const latest = trashItems.find((t) => t.id === detailItem.id);
    if (!latest) {
      setDetailItem(null);
    } else if (latest.restoredAt !== detailItem.restoredAt) {
      setDetailItem(latest);
    }
  }, [trashItems, detailItem]);

  const costItemNamesById = useMemo(() => {
    const map = new Map<string, { name: string; usageUnit: string }>();
    for (const ci of settings.costItems || []) {
      map.set(ci.id, { name: ci.name, usageUnit: ci.usageUnit });
    }
    return map;
  }, [settings.costItems]);

  const activeRange = useMemo(() => {
    if (periodFilter === 'all') return null;
    return getDateRangeForFilter(periodFilter, customStart, customEnd);
  }, [periodFilter, customStart, customEnd]);

  const filteredItems = useMemo(() => {
    const q = normalizeText(searchQuery);

    return trashItems.filter((item) => {
      if (selectedKind !== 'all' && item.kind !== selectedKind) {
        return false;
      }

      if (activeRange) {
        const deletedDateStr = toISODate(new Date(item.deletedAt));
        if (deletedDateStr < activeRange.startDate || deletedDateStr > activeRange.endDate) {
          return false;
        }
      }

      if (q) {
        const haystackParts = [
          item.label,
          TRASH_KIND_LABELS[item.kind],
          item.originalDate,
          formatDate(item.originalDate),
          formatDateTimeFR(item.deletedAt),
          item.restoredAt ? formatDateTimeFR(item.restoredAt) : '',
          item.amountFC !== undefined ? String(item.amountFC) : '',
          JSON.stringify(item.payload || {}),
        ];
        const haystack = normalizeText(haystackParts.join(' '));
        const tokens = q.split(/\s+/).filter(Boolean);
        if (!tokens.every((tok) => haystack.includes(tok))) {
          return false;
        }
      }

      return true;
    });
  }, [trashItems, selectedKind, activeRange, searchQuery]);

  const handleRestore = async (item: TrashItem) => {
    if (restoringId) return;
    setRestoringId(item.id);
    try {
      const res = await restoreFromTrash(item.id);
      if (res.success) {
        onShowToast('success', res.message);
      } else {
        onShowToast('error', res.message);
      }
    } finally {
      setRestoringId(null);
    }
  };

  const handleConfirmHardDelete = async () => {
    if (!itemToHardDelete) return;
    try {
      await permanentlyDeleteTrashItem(itemToHardDelete.id);
      setItemToHardDelete(null);
      onShowToast('info', 'Élément supprimé définitivement.');
    } catch (err: any) {
      onShowToast('error', 'Erreur : ' + (err?.message || String(err)));
    }
  };

  const handleConfirmEmptyTrash = async () => {
    try {
      await emptyTrash();
      setIsEmptyTrashOpen(false);
      onShowToast('info', 'La corbeille a été vidée définitivement.');
    } catch (err: any) {
      onShowToast('error', 'Erreur : ' + (err?.message || String(err)));
    }
  };

  const renderPayloadDetail = (item: TrashItem) => {
    switch (item.kind) {
      case 'dailyEntry': {
        const p = item.payload as DailyEntry;
        return (
          <div className="space-y-2.5 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] text-slate-500 block">Vendeur(se)</span>
                <span className="font-bold text-slate-900">{p.employeeName}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] text-slate-500 block">Commission</span>
                <span className="font-bold text-slate-900 font-mono">
                  {formatFC(p.employeeCommissionFC, currency)} ({formatNumber(p.employeeCommissionRate)} %)
                </span>
              </div>
            </div>
            {Array.isArray(p.items) && p.items.length > 0 && (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-[11px] text-left">
                  <thead className="bg-slate-100 text-slate-600 font-bold">
                    <tr>
                      <th className="py-1.5 px-2.5">Produit</th>
                      <th className="py-1.5 px-2 text-right">Livré</th>
                      <th className="py-1.5 px-2 text-right">Vendu</th>
                      <th className="py-1.5 px-2 text-right">Abîmé</th>
                      <th className="py-1.5 px-2.5 text-right">Reste</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {p.items.map((it) => (
                      <tr key={it.productId}>
                        <td className="py-1.5 px-2.5 font-semibold text-slate-800">
                          {it.productName}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono">{it.delivered}</td>
                        <td className="py-1.5 px-2 text-right font-mono font-bold text-emerald-700">
                          {it.sold}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-rose-600">
                          {it.damaged}
                        </td>
                        <td className="py-1.5 px-2.5 text-right font-mono">{it.rest}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {p.notes && (
              <p className="text-slate-600 italic bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                Note : « {p.notes} »
              </p>
            )}
          </div>
        );
      }

      case 'personalSale': {
        const p = item.payload as PersonalSale;
        const kindLabel =
          p.kind === 'consommation'
            ? 'Consommation personnelle'
            : p.isOpeningDebt
            ? 'Ancienne dette'
            : 'Vente personnelle';
        return (
          <div className="space-y-2.5 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] text-slate-500 block">Nature</span>
                <span className="font-bold text-slate-900">{kindLabel}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] text-slate-500 block">Statut paiement</span>
                <span className="font-bold text-slate-900">
                  {p.paymentStatus === 'credit' ? 'À crédit' : 'Payé'}
                </span>
              </div>
            </div>
            {p.customerName && (
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] text-slate-500 block">Client</span>
                <span className="font-bold text-slate-900">{p.customerName}</span>
              </div>
            )}
            {Array.isArray(p.items) && p.items.length > 0 && (
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <span className="text-[11px] font-bold text-slate-500 block">Produits</span>
                {p.items.map((it, idx) => (
                  <div key={`${it.productId}_${idx}`} className="flex justify-between font-medium">
                    <span>
                      {it.productName} × {formatNumber(it.soldQty)}
                    </span>
                    <span className="font-mono font-bold">
                      {formatFC(it.soldQty * it.unitPrice, currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {p.receipt && (
              <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 font-semibold">
                Reçu attaché : N° {formatReceiptNumber(p.receipt.no)}
              </div>
            )}
            {p.notes && (
              <p className="text-slate-600 italic bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                Note : « {p.notes} »
              </p>
            )}
          </div>
        );
      }

      case 'production': {
        const p = item.payload as ProductionEntry;
        return (
          <div className="space-y-2.5 text-xs">
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
              <span className="text-[11px] font-bold text-slate-500 block">Quantités produites</span>
              {(p.items || []).map((it) => (
                <div key={it.productId} className="flex justify-between font-semibold text-slate-800">
                  <span>{it.productName}</span>
                  <span className="font-mono">{formatNumber(it.producedQty)}</span>
                </div>
              ))}
            </div>
            {p.costing && (
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <span className="text-[11px] font-bold text-slate-500 block">
                  Estimation coût de revient
                </span>
                <div className="flex justify-between">
                  <span className="text-slate-600">Coût total estimé :</span>
                  <span className="font-mono font-bold text-slate-900">
                    {formatFC(Math.round(p.costing.totalCostFC), currency)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Gain net estimé :</span>
                  <span className="font-mono font-bold text-emerald-700">
                    {formatFC(Math.round(p.costing.netGainFC), currency)}
                  </span>
                </div>
              </div>
            )}
            {p.notes && (
              <p className="text-slate-600 italic bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                Note : « {p.notes} »
              </p>
            )}
          </div>
        );
      }

      case 'expense': {
        const p = item.payload as Expense;
        return (
          <div className="space-y-2.5 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] text-slate-500 block">Catégorie</span>
                <span className="font-bold text-slate-900">{p.category}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] text-slate-500 block">Fournisseur</span>
                <span className="font-bold text-slate-900">{p.supplier || '—'}</span>
              </div>
            </div>
            {p.detail && (
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] text-slate-500 block">Détail</span>
                <span className="font-semibold text-slate-800">{p.detail}</span>
              </div>
            )}
            {Array.isArray(p.ingredientLines) && p.ingredientLines.length > 0 && (
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <span className="text-[11px] font-bold text-slate-500 block">
                  Ingrédients achetés
                </span>
                {p.ingredientLines.map((ln, idx) => (
                  <div key={`${ln.itemId}_${idx}`} className="flex justify-between">
                    <span>
                      {ln.name} ({formatNumber(ln.purchaseQty, 4)} achats →{' '}
                      {formatNumber(ln.usageQty, 4)} u.)
                    </span>
                    <span className="font-mono font-bold">{formatFC(ln.amountFC, currency)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      }

      case 'payment': {
        const p = item.payload as Payment;
        const typeLabel =
          p.paymentType === 'advance'
            ? 'Avance'
            : p.paymentType === 'final'
            ? 'Solde final'
            : 'Règlement';
        return (
          <div className="space-y-2.5 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] text-slate-500 block">Vendeur(se)</span>
                <span className="font-bold text-slate-900">{p.employeeName}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] text-slate-500 block">Type & Mois</span>
                <span className="font-bold text-slate-900">
                  {typeLabel} ({p.month})
                </span>
              </div>
            </div>
            {p.notes && (
              <p className="text-slate-600 italic bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                Note : « {p.notes} »
              </p>
            )}
          </div>
        );
      }

      case 'reserveMovement': {
        const p = item.payload as ReserveMovement;
        const caisseName = p.caisse === 'benefices' ? 'Bénéfices personnels' : 'Réserve';
        return (
          <div className="space-y-2.5 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] text-slate-500 block">Caisse</span>
                <span className="font-bold text-slate-900">{caisseName}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] text-slate-500 block">Opération</span>
                <span className="font-bold text-slate-900">
                  {p.type === 'ajout' ? 'Ajout (dépôt)' : 'Retrait'}
                </span>
              </div>
            </div>
            {p.reason && (
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] text-slate-500 block">Motif</span>
                <span className="font-semibold text-slate-800">{p.reason}</span>
              </div>
            )}
          </div>
        );
      }

      case 'debtPayment': {
        const p = item.payload as DebtPayment;
        return (
          <div className="space-y-2.5 text-xs">
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-[11px] text-slate-500 block">Date du paiement</span>
              <span className="font-bold text-slate-900">{formatDate(p.date)}</span>
            </div>
            {p.note && (
              <p className="text-slate-600 italic bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                Note : « {p.note} »
              </p>
            )}
          </div>
        );
      }

      case 'customer': {
        const p = item.payload as Customer;
        return (
          <div className="space-y-2.5 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] text-slate-500 block">Nom du client</span>
                <span className="font-bold text-slate-900">{p.name}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] text-slate-500 block">Téléphone</span>
                <span className="font-bold text-slate-900">{p.phone || '—'}</span>
              </div>
            </div>
            {p.note && (
              <p className="text-slate-600 italic bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                Note : « {p.note} »
              </p>
            )}
          </div>
        );
      }

      case 'stockAdjustment': {
        const p = item.payload as StockAdjustment;
        const ci = costItemNamesById.get(p.itemId);
        const sign = p.qtyDelta > 0 ? '+' : '';
        return (
          <div className="space-y-2.5 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] text-slate-500 block">Élément</span>
                <span className="font-bold text-slate-900">{ci?.name || p.itemId}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-[11px] text-slate-500 block">Variation</span>
                <span className="font-bold font-mono text-slate-900">
                  {sign}
                  {formatNumber(p.qtyDelta, 4)} {ci?.usageUnit || 'u.'}
                </span>
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-[11px] text-slate-500 block">Motif</span>
              <span className="font-semibold text-slate-800">
                {STOCK_ADJUSTMENT_REASON_LABELS[p.reason] || p.reason}
              </span>
            </div>
            {p.note && (
              <p className="text-slate-600 italic bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                Note : « {p.note} »
              </p>
            )}
          </div>
        );
      }
    }
  };

  return (
    <div className="pb-28 pt-3 px-4 max-w-lg mx-auto space-y-4">
      {/* En-tête */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            aria-label="Retour"
            className="p-2.5 rounded-2xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 active:scale-95 transition-all shadow-2xs min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold text-slate-900 tracking-tight leading-snug">
              Historique des suppressions
            </h2>
            <p className="text-xs text-slate-500">
              {trashItems.length} élément{trashItems.length > 1 ? 's' : ''} · Hors calculs et statistiques
            </p>
          </div>
        </div>

        {trashItems.length > 0 && (
          <button
            type="button"
            onClick={() => setIsEmptyTrashOpen(true)}
            className="px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold flex items-center gap-1.5 shrink-0 min-h-[40px] active:scale-95 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Vider la corbeille</span>
          </button>
        )}
      </div>

      {/* Recherche et Filtres */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-3.5 shadow-2xs space-y-3">
        {/* Recherche texte */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher par nom, montant, note..."
            className="w-full pl-9 pr-8 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-slate-50 focus:bg-white focus:outline-teal-700 min-h-[40px]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Effacer la recherche"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-slate-700"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filtre par type & par période */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] font-bold text-slate-600 flex items-center gap-1 mb-1">
              <Filter className="w-3 h-3 text-teal-700" />
              <span>Type d’élément</span>
            </label>
            <select
              value={selectedKind}
              onChange={(e) => setSelectedKind(e.target.value as 'all' | TrashKind)}
              className="w-full px-2.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-white min-h-[38px]"
            >
              <option value="all">Tous les types</option>
              {ALL_TRASH_KINDS.map((k) => (
                <option key={k} value={k}>
                  {TRASH_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-600 flex items-center gap-1 mb-1">
              <Calendar className="w-3 h-3 text-teal-700" />
              <span>Période de suppression</span>
            </label>
            <select
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value as TrashPeriodFilter)}
              className="w-full px-2.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-white min-h-[38px]"
            >
              <option value="all">Toutes les dates</option>
              <option value="today">Aujourd’hui</option>
              <option value="this_week">Cette semaine</option>
              <option value="this_month">Ce mois</option>
              <option value="last_month">Mois dernier</option>
              <option value="custom">Période personnalisée</option>
            </select>
          </div>
        </div>

        {periodFilter === 'custom' && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div>
              <label className="text-[11px] font-bold text-slate-600 block mb-1">Du :</label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-slate-50 min-h-[38px]"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-600 block mb-1">Au :</label>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-slate-50 min-h-[38px]"
              />
            </div>
          </div>
        )}
      </div>

      {/* Liste des suppressions (du plus récent au plus ancien) */}
      {filteredItems.length === 0 ? (
        <EmptyState
          icon={<Trash2 className="w-7 h-7 text-slate-400" />}
          title={
            trashItems.length === 0
              ? 'La corbeille est vide'
              : 'Aucun élément ne correspond aux filtres'
          }
          description={
            trashItems.length === 0
              ? 'Les éléments que vous supprimerez apparaîtront ici et pourront être restaurés à tout moment.'
              : 'Essayez de modifier votre recherche, le type ou la période sélectionnée.'
          }
        />
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => {
            const isRestored = Boolean(item.restoredAt);
            return (
              <div
                key={item.id}
                className={`bg-white rounded-2xl border p-4 shadow-2xs space-y-2.5 ${
                  isRestored ? 'border-emerald-200/90 bg-emerald-50/20' : 'border-slate-200/90'
                }`}
              >
                {/* Ligne haute : Type & Montant */}
                <div className="flex items-start justify-between gap-2">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-[11px] font-extrabold bg-slate-100 text-slate-800 border border-slate-200/80">
                    {TRASH_KIND_LABELS[item.kind]}
                  </span>

                  {item.amountFC !== undefined && (
                    <span className="text-sm font-black font-mono text-slate-900 shrink-0">
                      {formatFC(item.amountFC, currency)}
                    </span>
                  )}
                </div>

                {/* Libellé */}
                <p className="text-sm font-bold text-slate-900 leading-snug">{item.label}</p>

                {/* Métadonnées : Date d'origine & Date de suppression / restauration */}
                <div className="text-[11px] text-slate-500 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-700">
                      Date d’origine : {formatDate(item.originalDate)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-500">
                    <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>Supprimé le {formatDateTimeFR(item.deletedAt)}</span>
                  </div>
                  {item.restoredAt && (
                    <div className="inline-flex items-center gap-1.5 text-emerald-800 font-bold bg-emerald-100/80 px-2.5 py-1 rounded-lg border border-emerald-200 mt-0.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                      <span>Restauré le {formatDateTimeFR(item.restoredAt)}</span>
                    </div>
                  )}
                </div>

                {/* Actions de ligne : Voir le détail, Restaurer (si non restauré), Supprimer définitivement */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setDetailItem(item)}
                      className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold inline-flex items-center gap-1.5 min-h-[38px] transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5 text-slate-600" />
                      <span>Voir le détail</span>
                    </button>

                    {!isRestored && (
                      <button
                        type="button"
                        disabled={restoringId === item.id}
                        onClick={() => handleRestore(item)}
                        className="px-3 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-1.5 min-h-[38px] shadow-2xs active:scale-95 transition-all"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Restaurer</span>
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setItemToHardDelete(item)}
                    className="px-2.5 py-2 rounded-xl text-rose-600 hover:bg-rose-50 text-xs font-bold inline-flex items-center gap-1 min-h-[38px] transition-colors"
                    title="Supprimer définitivement"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Supprimer définitivement</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fenêtre : Voir le détail */}
      {detailItem && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
        >
          <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 flex flex-col overflow-hidden max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50/70">
              <div>
                <span className="text-[11px] font-extrabold text-teal-800 uppercase tracking-wider block">
                  {TRASH_KIND_LABELS[detailItem.kind]}
                </span>
                <h3 className="text-base font-extrabold text-slate-900">
                  Détail de l’élément supprimé
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDetailItem(null)}
                aria-label="Fermer"
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 min-h-[40px] min-w-[40px] flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
                <p className="font-extrabold text-slate-900 text-sm">{detailItem.label}</p>
                <div className="text-slate-600 flex items-center justify-between">
                  <span>Date d’origine :</span>
                  <span className="font-bold text-slate-900">
                    {formatDate(detailItem.originalDate)}
                  </span>
                </div>
                {detailItem.amountFC !== undefined && (
                  <div className="text-slate-600 flex items-center justify-between">
                    <span>Montant :</span>
                    <span className="font-bold font-mono text-slate-900">
                      {formatFC(detailItem.amountFC, currency)}
                    </span>
                  </div>
                )}
                <div className="text-slate-600 flex items-center justify-between">
                  <span>Supprimé le :</span>
                  <span className="font-semibold text-slate-800">
                    {formatDateTimeFR(detailItem.deletedAt)}
                  </span>
                </div>
                {detailItem.restoredAt && (
                  <div className="text-emerald-800 flex items-center justify-between pt-1 border-t border-slate-200 font-bold">
                    <span>Statut :</span>
                    <span>Restauré le {formatDateTimeFR(detailItem.restoredAt)}</span>
                  </div>
                )}
              </div>

              {renderPayloadDetail(detailItem)}
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50/70 flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setDetailItem(null)}
                className="flex-1 py-2.5 px-4 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 min-h-[42px]"
              >
                Fermer
              </button>
              {!detailItem.restoredAt && (
                <button
                  type="button"
                  disabled={restoringId === detailItem.id}
                  onClick={() => handleRestore(detailItem)}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 min-h-[42px]"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Restaurer</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation protégée : Supprimer définitivement un élément */}
      <ConfirmModal
        isOpen={Boolean(itemToHardDelete)}
        title="Supprimer définitivement ?"
        message={`Voulez-vous effacer définitivement « ${
          itemToHardDelete?.label || ''
        } » de l’historique des suppressions ? Cette action est irréversible.`}
        confirmLabel="Supprimer définitivement"
        cancelLabel="Annuler"
        isDanger={true}
        onConfirm={handleConfirmHardDelete}
        onCancel={() => setItemToHardDelete(null)}
      />

      {/* Confirmation protégée : Vider la corbeille */}
      <ConfirmModal
        isOpen={isEmptyTrashOpen}
        title="Vider la corbeille ?"
        message={`Voulez-vous supprimer définitivement les ${trashItems.length} élément${
          trashItems.length > 1 ? 's' : ''
        } de l’historique des suppressions ? Cette action est irréversible.`}
        confirmLabel="Vider la corbeille"
        cancelLabel="Annuler"
        isDanger={true}
        onConfirm={handleConfirmEmptyTrash}
        onCancel={() => setIsEmptyTrashOpen(false)}
      />
    </div>
  );
};
