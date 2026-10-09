import React, { useState, useEffect } from 'react';
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
  Check,
  AlertTriangle,
  FileText,
  Clock,
  TrendingUp,
  UserCheck,
} from 'lucide-react';
import { db } from '../../db/db';
import {
  formatDate,
  formatFC,
  toISODate,
  parseLocaleNumber,
  formatNumber,
} from '../../utils/formatters';
import { ConfirmModal } from '../../components/ConfirmModal';
import { EmptyState } from '../../components/EmptyState';
import { calculateReserveBalance, type ReserveDetails } from '../../utils/reserveCalculator';
import type { ReserveMovement, DailyEntry, Expense, AppSettings } from '../../types';

interface ReserveViewProps {
  settings: AppSettings;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
  onBack?: () => void;
}

export const ReserveView: React.FC<ReserveViewProps> = ({
  settings,
  onShowToast,
  onBack,
}) => {
  const [movements, setMovements] = useState<ReserveMovement[]>([]);
  const [dailyEntries, setDailyEntries] = useState<DailyEntry[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);

  // Form modal state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formType, setFormType] = useState<'ajout' | 'retrait'>('ajout');
  const [editingMovement, setEditingMovement] = useState<ReserveMovement | null>(null);

  const [date, setDate] = useState(toISODate(new Date()));
  const [amount, setAmount] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [formError, setFormError] = useState<string>('');

  // Delete modal state
  const [movementToDelete, setMovementToDelete] = useState<ReserveMovement | null>(null);

  const currency = settings.currency || 'FC';
  const reserveRate = settings.expenseReservePct || 50;

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [movs, entries, exps] = await Promise.all([
        db.reserveMovements.orderBy('date').reverse().toArray(),
        db.dailyEntries.toArray(),
        db.expenses.toArray(),
      ]);
      setMovements(movs);
      setDailyEntries(entries);
      setExpenses(exps);
    } catch (e: any) {
      console.error('Erreur chargement réserve:', e);
      onShowToast('error', 'Erreur chargement des données de réserve');
    }
  };

  const reserveDetails: ReserveDetails = calculateReserveBalance(
    movements,
    dailyEntries,
    expenses,
    reserveRate
  );

  // Bénéfices du gérant cumulés : part théorique et déduction de l'excédent de dépenses
  let totalOwnerShareGrossFC = 0;
  for (const entry of dailyEntries) {
    totalOwnerShareGrossFC += entry.ownerShareFC || 0;
  }
  const totalExpenseOverrunFC = Math.max(0, reserveDetails.totalExpensesFC - reserveDetails.totalSalesReserveFC);
  const netOwnerProfitFC = Math.round(totalOwnerShareGrossFC - totalExpenseOverrunFC);

  const handleOpenAdd = () => {
    setEditingMovement(null);
    setFormType('ajout');
    setDate(toISODate(new Date()));
    setAmount('');
    setReason('');
    setFormError('');
    setIsFormOpen(true);
  };

  const handleOpenWithdraw = () => {
    setEditingMovement(null);
    setFormType('retrait');
    setDate(toISODate(new Date()));
    setAmount('');
    setReason('');
    setFormError('');
    setIsFormOpen(true);
  };

  const handleOpenEdit = (mov: ReserveMovement) => {
    setEditingMovement(mov);
    setFormType(mov.type);
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

    // Interdire de retirer plus que le solde disponible
    if (formType === 'retrait') {
      // Si on modifie un retrait existant, le solde disponible actuel est : solde actuel + ancien montant du retrait
      const availableBalance = editingMovement && editingMovement.type === 'retrait'
        ? reserveDetails.soldeFC + editingMovement.amountFC
        : editingMovement && editingMovement.type === 'ajout'
        ? reserveDetails.soldeFC - editingMovement.amountFC
        : reserveDetails.soldeFC;

      if (numAmount > availableBalance) {
        setFormError(
          `Retrait impossible : le montant demandé (${formatFC(numAmount, currency)}) dépasse le solde disponible (${formatFC(Math.max(0, availableBalance), currency)}).`
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
          reason: reason.trim(),
          createdAt: Date.now(),
        };
        await db.reserveMovements.add(newMov);
        onShowToast(
          'success',
          formType === 'ajout'
            ? 'Ajout de fonds enregistré avec succès.'
            : 'Retrait de réserve enregistré avec succès.'
        );
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
      {/* En-tête avec bouton retour facultatif */}
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
            <h2 className="text-lg font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              <Wallet className="w-5 h-5 text-teal-700" />
              Caisse
            </h2>
            <p className="text-xs text-slate-500 font-medium">
              Suivi de la caisse (dépenses, fonds de 50 % et mouvements)
            </p>
          </div>
        </div>
      </div>

      {/* 1. CARTE DU SOLDE EN GRAND */}
      <div
        className={`rounded-3xl border-2 p-5 shadow-sm transition-all ${
          reserveDetails.soldeFC >= 0
            ? 'bg-emerald-50/80 border-emerald-400 text-emerald-950'
            : 'bg-rose-50/80 border-rose-400 text-rose-950'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
            Solde de Caisse Disponible
          </span>
          <span
            className={`text-xs font-extrabold px-2.5 py-0.5 rounded-full font-mono ${
              reserveDetails.soldeFC >= 0
                ? 'bg-emerald-200/90 text-emerald-900'
                : 'bg-rose-200/90 text-rose-900'
            }`}
          >
            {reserveDetails.soldeFC >= 0 ? 'Solde Positif' : 'Déficit Caisse'}
          </span>
        </div>

        {/* Le solde en grand, vert s'il est positif ou nul, rouge seulement s'il est négatif */}
        <div className="mt-2 mb-3">
          <span
            className={`text-3xl sm:text-4xl font-black font-mono tracking-tight block ${
              reserveDetails.soldeFC >= 0 ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {formatFC(reserveDetails.soldeFC, currency)}
          </span>
          <span className="text-[11px] text-slate-500 font-medium">
            Cumulé depuis le tout début (toutes les ventes, dépenses et mouvements)
          </span>
        </div>

        {/* Formule détaillée sous le solde */}
        <div className="pt-3 border-t border-slate-200/80 space-y-2 text-xs">
          <span className="text-[11px] font-bold text-slate-600 block uppercase tracking-wide">
            Composition de la caisse :
          </span>

          <div className="grid grid-cols-2 gap-2 text-slate-800">
            {/* 1. Dépenses */}
            <div className="bg-white/80 p-2.5 rounded-xl border border-slate-200/70">
              <span className="text-[10px] text-slate-500 block font-semibold">
                1. Dépenses totales
              </span>
              <span className="font-extrabold font-mono text-rose-700 block">
                −{formatFC(reserveDetails.totalExpensesFC, currency)}
              </span>
              <span className="text-[9px] text-slate-400 block">
                Achats et charges
              </span>
            </div>

            {/* 2. Fonds (les 50%) */}
            <div className="bg-white/80 p-2.5 rounded-xl border border-slate-200/70">
              <span className="text-[10px] text-slate-500 block font-semibold">
                2. Fonds (les {reserveRate} %)
              </span>
              <span className="font-extrabold font-mono text-emerald-700 block">
                +{formatFC(reserveDetails.totalSalesReserveFC, currency)}
              </span>
              <span className="text-[9px] text-slate-400 block font-mono">
                sur {formatFC(reserveDetails.allTimeSalesFC, currency)} ventes
              </span>
            </div>

            <div className="bg-white/80 p-2.5 rounded-xl border border-slate-200/70">
              <span className="text-[10px] text-slate-500 block font-semibold">
                + Ajouts manuels
              </span>
              <span className="font-extrabold font-mono text-emerald-700 block">
                +{formatFC(reserveDetails.totalAdditionsFC, currency)}
              </span>
              <span className="text-[9px] text-slate-400 block">
                Argent de ma poche
              </span>
            </div>

            <div className="bg-white/80 p-2.5 rounded-xl border border-slate-200/70">
              <span className="text-[10px] text-slate-500 block font-semibold">
                − Retraits manuels
              </span>
              <span className="font-extrabold font-mono text-slate-700 block">
                −{formatFC(reserveDetails.totalWithdrawalsFC, currency)}
              </span>
              <span className="text-[9px] text-slate-400 block">
                Prélèvements
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION MES BÉNÉFICES (PART DU GÉRANT & DÉDUCTION EN CAS DE DÉPASSEMENT DES DÉPENSES) */}
      <div className="rounded-3xl border border-slate-200/90 bg-white p-4 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center">
              <UserCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                Mes Bénéfices à Moi (Part Gérant)
              </h3>
              <p className="text-[11px] text-slate-500">
                Calculé sur le cumul de l'activité
              </p>
            </div>
          </div>
          <span className={`text-base font-extrabold font-mono ${
            netOwnerProfitFC < 0 ? 'text-rose-700' : 'text-emerald-900'
          }`}>
            {formatFC(netOwnerProfitFC, currency)}
          </span>
        </div>

        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2 text-xs">
          <div className="flex items-center justify-between font-mono">
            <span className="text-slate-600">Part brute théorique ({100 - reserveRate - 20}% des ventes) :</span>
            <span className="font-extrabold text-slate-900">+{formatFC(totalOwnerShareGrossFC, currency)}</span>
          </div>

          {totalExpenseOverrunFC > 0 ? (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 space-y-1">
              <div className="flex items-center justify-between font-bold font-mono">
                <span className="flex items-center gap-1.5 text-rose-800">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
                  Dépassement du seuil déduit :
                </span>
                <span className="text-rose-700 font-extrabold">−{formatFC(totalExpenseOverrunFC, currency)}</span>
              </div>
              <p className="text-[11px] text-rose-800 leading-snug">
                <strong>Pourquoi ce montant est déduit ?</strong> Les dépenses totales ({formatFC(reserveDetails.totalExpensesFC, currency)}) ont dépassé les {reserveRate} % prévus ({formatFC(reserveDetails.totalSalesReserveFC, currency)}). L'excédent de <strong>{formatFC(totalExpenseOverrunFC, currency)}</strong> a donc été directement retenu sur votre part personnelle.
              </p>
            </div>
          ) : (
            <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-medium flex items-center gap-1.5">
              <span>✓ Les dépenses ({formatFC(reserveDetails.totalExpensesFC, currency)}) ne dépassent pas le seuil de {reserveRate} % ({formatFC(reserveDetails.totalSalesReserveFC, currency)}). Aucune déduction effectuée.</span>
            </div>
          )}

          <div className="pt-2 border-t border-slate-200 flex items-center justify-between font-bold">
            <span className="text-slate-800">Bénéfice net personnel disponible :</span>
            <span className={`font-mono text-sm ${netOwnerProfitFC < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
              {formatFC(netOwnerProfitFC, currency)}
            </span>
          </div>
        </div>
      </div>

      {/* 2. DEUX GROS BOUTONS : AJOUTER ET RETIRER */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={handleOpenAdd}
          className="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-emerald-700 hover:bg-emerald-800 active:scale-95 text-white font-bold shadow-sm transition-all min-h-[56px]"
        >
          <div className="flex items-center gap-1.5 text-sm">
            <Plus className="w-5 h-5 stroke-[2.5]" />
            <span>Ajouter de l'argent</span>
          </div>
          <span className="text-[10px] text-emerald-100 font-normal mt-0.5">
            Argent de ma poche
          </span>
        </button>

        <button
          type="button"
          onClick={handleOpenWithdraw}
          className="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-rose-700 hover:bg-rose-800 active:scale-95 text-white font-bold shadow-sm transition-all min-h-[56px]"
        >
          <div className="flex items-center gap-1.5 text-sm">
            <Minus className="w-5 h-5 stroke-[2.5]" />
            <span>Retirer de l'argent</span>
          </div>
          <span className="text-[10px] text-rose-100 font-normal mt-0.5">
            Prélèvement sur la caisse
          </span>
        </button>
      </div>

      {/* 3. HISTORIQUE DES MOUVEMENTS */}
      <div className="space-y-2 pt-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Clock className="w-4 h-4" />
            Historique des mouvements ({movements.length})
          </h3>
        </div>

        {movements.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/80 p-6 text-center text-xs text-slate-400 space-y-1">
            <p className="font-semibold text-slate-600">Aucun mouvement manuel enregistré</p>
            <p>Utilisez les boutons ci-dessus pour ajouter ou retirer des fonds dans la réserve.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden shadow-2xs">
            {movements.map((mov) => {
              const isAjout = mov.type === 'ajout';
              return (
                <div key={mov.id} className="p-3.5 flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        isAjout
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-rose-100 text-rose-700'
                      }`}
                    >
                      {isAjout ? (
                        <ArrowDownLeft className="w-5 h-5 stroke-[2.5]" />
                      ) : (
                        <ArrowUpRight className="w-5 h-5 stroke-[2.5]" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                            isAjout
                              ? 'bg-emerald-50 text-emerald-800'
                              : 'bg-rose-50 text-rose-800'
                          }`}
                        >
                          {isAjout ? 'Ajout' : 'Retrait'}
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono">
                          {formatDate(mov.date)}
                        </span>
                      </div>
                      <p className="font-bold text-slate-900 truncate mt-0.5">
                        {mov.reason || (isAjout ? 'Ajout de fonds' : 'Retrait')}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`font-mono font-extrabold text-sm ${
                        isAjout ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {isAjout ? '+' : '−'}
                      {formatFC(mov.amountFC, currency)}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleOpenEdit(mov)}
                      title="Modifier"
                      aria-label="Modifier le mouvement"
                      className="p-1.5 text-slate-400 hover:text-teal-700 rounded-lg hover:bg-slate-100 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setMovementToDelete(mov)}
                      title="Supprimer"
                      aria-label="Supprimer le mouvement"
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
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

      {/* MODALE D'AJOUT / RETRAIT / MODIFICATION */}
      {isFormOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        >
          <div className="bg-white rounded-3xl max-w-sm w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div
              className={`p-4 border-b flex items-center justify-between ${
                formType === 'ajout'
                  ? 'bg-emerald-50/70 border-emerald-100'
                  : 'bg-rose-50/70 border-rose-100'
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                    formType === 'ajout'
                      ? 'bg-emerald-700 text-white'
                      : 'bg-rose-700 text-white'
                  }`}
                >
                  {formType === 'ajout' ? (
                    <Plus className="w-5 h-5" />
                  ) : (
                    <Minus className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {editingMovement
                      ? 'Modifier le mouvement'
                      : formType === 'ajout'
                      ? "+ Ajouter de l'argent"
                      : "− Retirer de l'argent"}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {formType === 'ajout'
                      ? 'Argent de ma poche pour alimenter la caisse'
                      : 'Prélèvement sur le solde de la caisse'}
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

              {/* Si on modifie, on peut basculer le type si besoin */}
              {editingMovement && (
                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Type de mouvement
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormType('ajout')}
                      className={`p-2 rounded-xl font-bold border transition-all ${
                        formType === 'ajout'
                          ? 'bg-emerald-700 text-white border-emerald-700'
                          : 'bg-slate-50 text-slate-700 border-slate-200'
                      }`}
                    >
                      + Ajout
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormType('retrait')}
                      className={`p-2 rounded-xl font-bold border transition-all ${
                        formType === 'retrait'
                          ? 'bg-rose-700 text-white border-rose-700'
                          : 'bg-slate-50 text-slate-700 border-slate-200'
                      }`}
                    >
                      − Retrait
                    </button>
                  </div>
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
                  placeholder="Ex: 50 000"
                  required
                  autoFocus
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono text-base font-bold text-slate-900 focus:outline-none focus:border-teal-600"
                />
                {formType === 'retrait' && (
                  <p className="text-[11px] text-slate-500 mt-1">
                    Solde disponible max :{' '}
                    <strong className="text-emerald-700 font-mono">
                      {formatFC(Math.max(0, reserveDetails.soldeFC), currency)}
                    </strong>
                  </p>
                )}
              </div>

              {/* Date (aujourd'hui par défaut) */}
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

              {/* Motif (texte libre) */}
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Motif (raison) *
                </label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={
                    formType === 'ajout'
                      ? 'Ex: Remise de fonds personnels, avance d’achat...'
                      : 'Ex: Achat matériel imprévu, prélèvement caisse...'
                  }
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-800 focus:outline-none focus:border-teal-600"
                />
              </div>

              {/* Buttons */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-100 min-h-[44px]"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className={`flex-1 py-2.5 rounded-xl font-bold text-white shadow-xs active:scale-95 transition-all min-h-[44px] ${
                    formType === 'ajout'
                      ? 'bg-emerald-700 hover:bg-emerald-800'
                      : 'bg-rose-700 hover:bg-rose-800'
                  }`}
                >
                  {editingMovement ? 'Mettre à jour' : 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODALE DE CONFIRMATION DE SUPPRESSION INTERNE */}
      <ConfirmModal
        isOpen={Boolean(movementToDelete)}
        title="Supprimer ce mouvement de caisse ?"
        message={`Êtes-vous sûr de vouloir supprimer ce ${
          movementToDelete?.type === 'ajout' ? 'ajout' : 'retrait'
        } de ${movementToDelete ? formatFC(movementToDelete.amountFC, currency) : ''} (${
          movementToDelete?.reason || ''
        }) ? Le solde de caisse sera recalculé immédiatement.`}
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        isDanger={true}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setMovementToDelete(null)}
      />
    </div>
  );
};
