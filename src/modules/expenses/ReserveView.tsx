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
  AlertTriangle,
  Clock,
  UserCheck,
  ArrowLeft,
  Receipt,
  ShieldCheck,
  ChevronRight,
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
import {
  calculateReserveBalance,
  getCapitalBalanceAtDate,
  type ReserveDetails,
} from '../../utils/reserveCalculator';
import type { ReserveMovement, DailyEntry, Expense, AppSettings } from '../../types';

interface ReserveViewProps {
  settings: AppSettings;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
  onBack?: () => void;
  initialPrefill?: { amount: number; reason: string } | null;
  onClearPrefill?: () => void;
}

export const ReserveView: React.FC<ReserveViewProps> = ({
  settings,
  onShowToast,
  onBack,
  initialPrefill,
  onClearPrefill,
}) => {
  const [movements, setMovements] = useState<ReserveMovement[]>([]);
  const [dailyEntries, setDailyEntries] = useState<DailyEntry[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);

  // View state: main caisse overview or detailed capital screen
  const [isCapitalScreenOpen, setIsCapitalScreenOpen] = useState(false);

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

  // Handle external prefill from red banner clicks
  useEffect(() => {
    if (initialPrefill) {
      setEditingMovement(null);
      setFormType('ajout');
      setDate(toISODate(new Date()));
      setAmount(formatNumber(initialPrefill.amount));
      setReason(initialPrefill.reason);
      setFormError('');
      setIsFormOpen(true);
      onClearPrefill?.();
    }
  }, [initialPrefill, onClearPrefill]);

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
      console.error('Erreur chargement caisse:', e);
      onShowToast('error', 'Erreur chargement des données de la caisse');
    }
  };

  const reserveDetails: ReserveDetails = calculateReserveBalance(
    movements,
    dailyEntries,
    expenses,
    reserveRate
  );

  // Bénéfices du gérant cumulés
  let totalOwnerShareGrossFC = 0;
  for (const entry of dailyEntries) {
    totalOwnerShareGrossFC += entry.ownerShareFC || 0;
  }
  const netOwnerProfitFC = Math.round(totalOwnerShareGrossFC);

  const handleOpenAdd = () => {
    setEditingMovement(null);
    setFormType('ajout');
    setDate(toISODate(new Date()));
    setAmount('');
    setReason('');
    setFormError('');
    setIsFormOpen(true);
  };

  const handleOpenAddPrefilled = (pAmount: number, pReason: string) => {
    setEditingMovement(null);
    setFormType('ajout');
    setDate(toISODate(new Date()));
    setAmount(formatNumber(pAmount));
    setReason(pReason);
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

    // Interdire un retrait supérieur au solde du capital à cette date (si le capital est négatif, aucun retrait)
    if (formType === 'retrait') {
      const capitalAvailable = getCapitalBalanceAtDate(
        movements,
        dailyEntries,
        expenses,
        reserveRate,
        date,
        editingMovement?.id
      );

      if (capitalAvailable <= 0) {
        setFormError(
          `Retrait impossible : le solde de la Caisse Capital à cette date est nul ou négatif (${formatFC(
            capitalAvailable,
            currency
          )}). Aucun retrait n'est autorisé.`
        );
        return;
      }

      if (numAmount > capitalAvailable) {
        setFormError(
          `Retrait impossible : le montant demandé (${formatFC(
            numAmount,
            currency
          )}) dépasse le solde du capital disponible à cette date (${formatFC(
            capitalAvailable,
            currency
          )}).`
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
            ? 'Ajout dans la Caisse Capital enregistré avec succès.'
            : 'Retrait de la Caisse Capital enregistré avec succès.'
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
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isCapitalScreenOpen ? (
            <button
              type="button"
              onClick={() => setIsCapitalScreenOpen(false)}
              aria-label="Retour à la Caisse"
              className="p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 active:scale-95 transition-all min-h-[44px] min-w-[44px] flex items-center justify-center -ml-2"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          ) : (
            onBack && (
              <button
                type="button"
                onClick={onBack}
                aria-label="Retour"
                className="p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 active:scale-95 transition-all min-h-[44px] min-w-[44px] flex items-center justify-center -ml-2"
              >
                <X className="w-5 h-5" />
              </button>
            )
          )}
          <div>
            <h2 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
              <Wallet className="w-5 h-5 text-teal-700" />
              {isCapitalScreenOpen ? 'Caisse Capital' : 'Caisse'}
            </h2>
            <p className="text-xs text-slate-500 font-medium">
              {isCapitalScreenOpen
                ? 'Gestion des fonds propres & dépenses prises sur le capital'
                : 'Caisse normale et Caisse Capital en temps réel'}
            </p>
          </div>
        </div>
      </div>

      {/* ALERTE ROUGE : si soldeCapitalFC < 0 */}
      {reserveDetails.soldeCapitalFC < 0 && (
        <div className="p-3.5 rounded-2xl bg-rose-600 text-white shadow-md flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <AlertTriangle className="w-5 h-5 shrink-0 text-white" />
            <div>
              <span className="font-extrabold block">Alerte Caisse Capital</span>
              <p className="text-[11px] text-rose-100 leading-snug">
                Il manque {formatFC(reserveDetails.manqueFC, currency)} dans la Caisse Capital : ajoute{' '}
                {formatFC(reserveDetails.manqueFC, currency)} de ton argent personnel.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleOpenAddPrefilled(reserveDetails.manqueFC, 'Complément argent personnel')}
            className="px-3 py-2 rounded-xl bg-white text-rose-700 font-extrabold hover:bg-rose-50 active:scale-95 transition-all shrink-0 min-h-[38px] text-xs shadow-xs"
          >
            Ajouter {formatFC(reserveDetails.manqueFC, currency)}
          </button>
        </div>
      )}

      {/* ======================= VUE PRINCIPALE ======================= */}
      {!isCapitalScreenOpen ? (
        <>
          {/* DEUX CARTES EN HAUT */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Carte 1 : Caisse normale */}
            <div className="rounded-3xl border-2 border-emerald-300 bg-emerald-50/70 p-4 shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-emerald-900">
                  Caisse normale
                </span>
                <span className="text-[10px] font-bold text-emerald-800 bg-emerald-200/80 px-2 py-0.5 rounded-md font-mono">
                  {reserveRate} % ventes
                </span>
              </div>

              <div>
                <span className="text-2xl sm:text-3xl font-black font-mono tracking-tight text-emerald-800 block">
                  {formatFC(reserveDetails.soldeNormaleFC, currency)}
                </span>
                <span className="text-[10px] text-emerald-700 font-medium block mt-0.5">
                  Ne peut jamais être négative
                </span>
              </div>

              <div className="pt-2 border-t border-emerald-200/60 space-y-1 text-[11px] font-mono text-emerald-900">
                <div className="flex items-center justify-between">
                  <span>+{formatFC(reserveDetails.totalSalesReserveFC, currency)}</span>
                  <span className="text-[10px] text-emerald-700 font-sans">les {reserveRate} % des ventes</span>
                </div>
                <div className="flex items-center justify-between text-rose-700">
                  <span>−{formatFC(reserveDetails.depensesPayeesParNormaleFC, currency)}</span>
                  <span className="text-[10px] text-rose-600 font-sans">dépenses qu'elle a payées</span>
                </div>
              </div>
            </div>

            {/* Carte 2 : Caisse Capital */}
            <div
              className={`rounded-3xl border-2 p-4 shadow-2xs space-y-2 ${
                reserveDetails.soldeCapitalFC >= 0
                  ? 'border-slate-300 bg-white'
                  : 'border-rose-300 bg-rose-50/70'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-slate-800">
                  Caisse Capital
                </span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md font-mono ${
                    reserveDetails.soldeCapitalFC >= 0
                      ? 'bg-slate-100 text-slate-700'
                      : 'bg-rose-200 text-rose-900'
                  }`}
                >
                  {reserveDetails.soldeCapitalFC >= 0 ? 'Solde OK' : 'Manque'}
                </span>
              </div>

              <div>
                <span
                  className={`text-2xl sm:text-3xl font-black font-mono tracking-tight block ${
                    reserveDetails.soldeCapitalFC >= 0 ? 'text-slate-900' : 'text-rose-700'
                  }`}
                >
                  {formatFC(reserveDetails.soldeCapitalFC, currency)}
                </span>
                <span className="text-[10px] text-slate-500 font-medium block mt-0.5">
                  {reserveDetails.soldeCapitalFC < 0
                    ? `Déficit de ${formatFC(reserveDetails.manqueFC, currency)} à rajouter`
                    : 'Argent personnel & absorbeur'}
                </span>
              </div>

              <div className="pt-2 border-t border-slate-200/80 space-y-1 text-[11px] font-mono text-slate-700">
                <div className="flex items-center justify-between">
                  <span>+{formatFC(reserveDetails.totalAdditionsFC, currency)}</span>
                  <span className="text-[10px] text-slate-500 font-sans">dépôts personnels</span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>−{formatFC(reserveDetails.totalWithdrawalsFC, currency)}</span>
                  <span className="text-[10px] text-slate-500 font-sans">retraits</span>
                </div>
                <div className="flex items-center justify-between text-rose-700 font-bold">
                  <span>−{formatFC(reserveDetails.capitalUtiliseFC, currency)}</span>
                  <span className="text-[10px] text-rose-600 font-sans">dépenses prises sur capital</span>
                </div>
              </div>
            </div>
          </div>

          {/* GROS BOUTON : CAISSE CAPITAL */}
          <button
            type="button"
            onClick={() => setIsCapitalScreenOpen(true)}
            className="w-full p-4 rounded-3xl bg-slate-900 hover:bg-slate-800 text-white shadow-md active:scale-[0.99] transition-all flex items-center justify-between min-h-[58px]"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-teal-400">
                <Wallet className="w-5 h-5 stroke-[2.5]" />
              </div>
              <div className="text-left">
                <span className="text-sm font-black tracking-tight block">
                  Caisse Capital (Gérer les fonds, ajouts, retraits)
                </span>
                <span className="text-[11px] text-slate-300">
                  Solde : {formatFC(reserveDetails.soldeCapitalFC, currency)} • {reserveDetails.expensesOnCapital.length} dépense(s) absorbée(s)
                </span>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-slate-400" />
          </button>

          {/* MES BÉNÉFICES (PART DU GÉRANT) */}
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
                <span className="text-slate-600">Total de ma part sur les ventes :</span>
                <span className="font-extrabold text-slate-900">+{formatFC(totalOwnerShareGrossFC, currency)}</span>
              </div>

              <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-medium flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>Les dépenses sont payées par la Caisse normale et la Caisse Capital (aucune déduction sur votre bénéfice).</span>
              </div>
            </div>
          </div>
        </>
      ) : (
        /* ======================= ÉCRAN DU CAPITAL ======================= */
        <div className="space-y-4">
          {/* Solde Card Capital */}
          <div
            className={`rounded-3xl border-2 p-5 shadow-sm ${
              reserveDetails.soldeCapitalFC >= 0
                ? 'border-slate-300 bg-white'
                : 'border-rose-400 bg-rose-50/80'
            }`}
          >
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
              Solde actuel Caisse Capital
            </span>
            <div className="mt-1 mb-2">
              <span
                className={`text-3xl sm:text-4xl font-black font-mono tracking-tight block ${
                  reserveDetails.soldeCapitalFC >= 0 ? 'text-slate-900' : 'text-rose-700'
                }`}
              >
                {formatFC(reserveDetails.soldeCapitalFC, currency)}
              </span>
              <span className="text-[11px] text-slate-500">
                {reserveDetails.soldeCapitalFC < 0
                  ? `Déficit de ${formatFC(reserveDetails.manqueFC, currency)} : à combler de votre poche`
                  : 'Fonds disponibles pour combler les dépenses'}
              </span>
            </div>

            <div className="pt-3 border-t border-slate-200 space-y-1.5 text-xs text-slate-600 font-mono">
              <div className="flex items-center justify-between">
                <span>Dépôts personnels :</span>
                <span className="font-bold text-slate-900">+{formatFC(reserveDetails.totalAdditionsFC, currency)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Retraits effectués :</span>
                <span className="font-bold text-slate-900">−{formatFC(reserveDetails.totalWithdrawalsFC, currency)}</span>
              </div>
              <div className="flex items-center justify-between text-rose-700 font-bold">
                <span>Dépenses prises sur le capital :</span>
                <span>−{formatFC(reserveDetails.capitalUtiliseFC, currency)}</span>
              </div>
            </div>
          </div>

          {/* Boutons Ajouter et Retirer */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleOpenAdd}
              className="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-emerald-700 hover:bg-emerald-800 active:scale-95 text-white font-bold shadow-sm transition-all min-h-[56px]"
            >
              <div className="flex items-center gap-1.5 text-sm">
                <Plus className="w-5 h-5 stroke-[2.5]" />
                <span>+ Ajouter de l'argent</span>
              </div>
              <span className="text-[10px] text-emerald-100 font-normal mt-0.5">
                Argent de ma poche
              </span>
            </button>

            <button
              type="button"
              onClick={handleOpenWithdraw}
              disabled={reserveDetails.soldeCapitalFC <= 0}
              className="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-rose-700 hover:bg-rose-800 disabled:opacity-50 disabled:pointer-events-none active:scale-95 text-white font-bold shadow-sm transition-all min-h-[56px]"
            >
              <div className="flex items-center gap-1.5 text-sm">
                <Minus className="w-5 h-5 stroke-[2.5]" />
                <span>− Retirer de l'argent</span>
              </div>
              <span className="text-[10px] text-rose-100 font-normal mt-0.5">
                {reserveDetails.soldeCapitalFC <= 0 ? 'Capital négatif / nul' : 'Prélèvement sur capital'}
              </span>
            </button>
          </div>

          {/* Historique des mouvements existants */}
          <div className="space-y-2 pt-1">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              <span>Historique des mouvements ({movements.length})</span>
            </h3>

            {movements.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200/80 p-6 text-center text-xs text-slate-400 space-y-1">
                <p className="font-semibold text-slate-600">Aucun mouvement de capital enregistré</p>
                <p>Utilisez les boutons ci-dessus pour ajouter ou retirer des fonds.</p>
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
                            {mov.reason || (isAjout ? 'Ajout de capital' : 'Retrait')}
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
                          className="p-1.5 text-slate-400 hover:text-teal-700 rounded-lg hover:bg-slate-100 min-h-[36px] min-w-[36px] flex items-center justify-center"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => setMovementToDelete(mov)}
                          title="Supprimer"
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100 min-h-[36px] min-w-[36px] flex items-center justify-center"
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

          {/* LISTE EN LECTURE SEULE : DÉPENSES PRISES SUR LE CAPITAL */}
          <div className="space-y-2 pt-2">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <Receipt className="w-4 h-4 text-rose-700" />
              <span>Dépenses prises sur le capital ({reserveDetails.expensesOnCapital.length})</span>
            </h3>

            {reserveDetails.expensesOnCapital.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200/80 p-5 text-center text-xs text-slate-500 space-y-1">
                <p className="font-bold text-emerald-800">Aucune dépense prise sur le capital</p>
                <p className="text-[11px] text-slate-400">
                  La Caisse normale a été suffisante pour couvrir l'intégralité des dépenses enregistrées.
                </p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden shadow-2xs">
                {reserveDetails.expensesOnCapital.map((item) => (
                  <div
                    key={item.expenseId}
                    className="p-3.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono text-slate-500 font-bold">
                          {formatDate(item.date)}
                        </span>
                        <span className="text-[10px] font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                          {item.category}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-slate-900 truncate mt-0.5">
                        {item.detail || item.category}
                      </p>
                      {item.paidByNormaleFC > 0 && (
                        <p className="text-[10px] text-slate-400">
                          Total {formatFC(item.amountFC, currency)} (dont {formatFC(item.paidByNormaleFC, currency)} couverts par caisse normale)
                        </p>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">
                        Pris sur capital
                      </span>
                      <span className="font-mono font-black text-rose-700 text-sm">
                        −{formatFC(item.takenFromCapitalFC, currency)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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
                      ? 'Alimenter la Caisse Capital de ma poche'
                      : 'Prélèvement sur la Caisse Capital'}
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
                {formType === 'retrait' && (() => {
                  const capitalAvailable = getCapitalBalanceAtDate(
                    movements,
                    dailyEntries,
                    expenses,
                    reserveRate,
                    date,
                    editingMovement?.id
                  );
                  return (
                    <p className="text-[11px] text-slate-500 mt-1">
                      Solde Capital disponible à cette date :{' '}
                      <strong
                        className={`font-mono ${
                          capitalAvailable <= 0 ? 'text-rose-700 font-bold' : 'text-emerald-700 font-bold'
                        }`}
                      >
                        {formatFC(capitalAvailable, currency)}
                      </strong>
                      {capitalAvailable <= 0 && (
                        <span className="block text-rose-600 font-semibold mt-0.5">
                          (Capital négatif ou nul : retrait interdit)
                        </span>
                      )}
                    </p>
                  );
                })()}
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
                      ? 'Ex: Complément argent personnel, avance...'
                      : 'Ex: Remboursement personnel, prélèvement...'
                  }
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-800 focus:outline-none focus:border-teal-600"
                />
              </div>

              {/* Boutons validation */}
              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold hover:bg-slate-50 active:scale-95 transition-all min-h-[44px]"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className={`flex-1 py-2.5 rounded-xl text-white font-bold active:scale-95 transition-all min-h-[44px] ${
                    formType === 'ajout'
                      ? 'bg-emerald-700 hover:bg-emerald-800'
                      : 'bg-rose-700 hover:bg-rose-800'
                  }`}
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODALE DE SUPPRESSION */}
      <ConfirmModal
        isOpen={Boolean(movementToDelete)}
        title="Supprimer ce mouvement ?"
        message={`Confirmez-vous la suppression de ce ${
          movementToDelete?.type === 'ajout' ? 'dépôt' : 'retrait'
        } de ${movementToDelete ? formatFC(movementToDelete.amountFC, currency) : ''} (${
          movementToDelete?.reason || ''
        }) ? Les soldes de la Caisse Capital seront recalculés.`}
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        isDanger={true}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setMovementToDelete(null)}
      />
    </div>
  );
};
