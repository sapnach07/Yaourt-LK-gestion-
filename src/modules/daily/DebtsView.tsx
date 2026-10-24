import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  Plus,
  Search,
  Phone,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Edit2,
  Trash2,
  X,
  Check,
  UserPlus,
  Ban,
  RotateCcw,
  Wallet,
  FileText,
  ChevronRight,
  Users,
} from 'lucide-react';
import { liveQuery } from 'dexie';
import { db } from '../../db/db';
import {
  formatDate,
  formatFC,
  toISODate,
  parseLocaleNumber,
  formatNumber,
} from '../../utils/formatters';
import {
  computeDebtAllocations,
  findCustomerByNormalizedName,
  calculateDaysBetweenDates,
  type CustomerDebtSummary,
} from '../../utils/debtCalculator';
import { SecurityConfirmModal } from '../../components/SecurityConfirmModal';
import type { AppSettings, Customer, DebtPayment, PersonalSale } from '../../types';

interface DebtsViewProps {
  settings: AppSettings;
  onBack: () => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
  initialCustomerId?: string | null;
}

type DebtFilterTab = 'all' | 'overdue' | 'settled';

export const DebtsView: React.FC<DebtsViewProps> = ({
  settings,
  onBack,
  onShowToast,
  initialCustomerId,
}) => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [debtPayments, setDebtPayments] = useState<DebtPayment[]>([]);
  const [personalSales, setPersonalSales] = useState<PersonalSale[]>([]);

  const [filterTab, setFilterTab] = useState<DebtFilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    initialCustomerId || null
  );

  // Payment modal state (create or edit)
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<DebtPayment | null>(null);
  const [payAmountStr, setPayAmountStr] = useState('');
  const [payDate, setPayDate] = useState(toISODate(new Date()));
  const [payNote, setPayNote] = useState('');
  const [payError, setPayError] = useState('');
  const [overpayConfirmed, setOverpayConfirmed] = useState(false);

  // Opening debt ("Ajouter une ancienne dette") modal state
  const [isOpeningDebtModalOpen, setIsOpeningDebtModalOpen] = useState(false);
  const [odCustomerId, setOdCustomerId] = useState('');
  const [odCustomerSearch, setOdCustomerSearch] = useState('');
  const [odIsCreatingCustomer, setOdIsCreatingCustomer] = useState(false);
  const [odNewCustName, setOdNewCustName] = useState('');
  const [odNewCustPhone, setOdNewCustPhone] = useState('');
  const [odAmountStr, setOdAmountStr] = useState('');
  const [odDate, setOdDate] = useState(toISODate(new Date()));
  const [odNote, setOdNote] = useState('');
  const [odError, setOdError] = useState('');

  // Edit customer modal state
  const [isEditCustomerModalOpen, setIsEditCustomerModalOpen] = useState(false);
  const [editCustName, setEditCustName] = useState('');
  const [editCustPhone, setEditCustPhone] = useState('');
  const [editCustNote, setEditCustNote] = useState('');
  const [editCustError, setEditCustError] = useState('');

  // Security confirmations
  const [paymentToDelete, setPaymentToDelete] = useState<DebtPayment | null>(null);
  const [isWriteOffModalOpen, setIsWriteOffModalOpen] = useState(false);
  const [isDeleteCustomerModalOpen, setIsDeleteCustomerModalOpen] = useState(false);

  const currency = settings.currency || 'FC';
  const reserveRate = settings.expenseReservePct ?? 50;
  const debtReminderDays = settings.debtReminderDays ?? 2;

  useEffect(() => {
    if (initialCustomerId) {
      setSelectedCustomerId(initialCustomerId);
    }
  }, [initialCustomerId]);

  useEffect(() => {
    const sub = liveQuery(async () => {
      const [custs, pays, sales] = await Promise.all([
        db.customers.toArray(),
        db.debtPayments.toArray(),
        db.personalSales.toArray(),
      ]);
      return { custs, pays, sales };
    }).subscribe({
      next: ({ custs, pays, sales }) => {
        setCustomers(custs);
        setDebtPayments(pays);
        setPersonalSales(sales);
      },
      error: (err) => {
        console.error('Erreur chargement dettes:', err);
      },
    });
    return () => sub.unsubscribe();
  }, []);

  const debtData = useMemo(() => {
    return computeDebtAllocations(
      personalSales,
      debtPayments,
      reserveRate,
      customers,
      debtReminderDays,
      toISODate(new Date())
    );
  }, [personalSales, debtPayments, reserveRate, customers, debtReminderDays]);

  const selectedCustomerSummary: CustomerDebtSummary | null = useMemo(() => {
    if (!selectedCustomerId) return null;
    return (
      debtData.customerSummaries.find((c) => c.customer.id === selectedCustomerId) || null
    );
  }, [debtData.customerSummaries, selectedCustomerId]);

  const filteredSummaries = useMemo(() => {
    const q = searchQuery.trim().toLocaleLowerCase('fr');
    return debtData.customerSummaries.filter((item) => {
      if (filterTab === 'overdue' && !item.isOverdue) return false;
      if (filterTab === 'settled' && item.remainingFC > 0) return false;
      if (filterTab === 'all' && !q) {
        // Dans "Tous", afficher tous les clients qui doivent de l'argent + ceux qui ont eu des dettes/enregistrements
        return true;
      }
      if (q) {
        const matchName = item.customer.name.toLocaleLowerCase('fr').includes(q);
        const matchPhone = (item.customer.phone || '').toLocaleLowerCase('fr').includes(q);
        if (!matchName && !matchPhone) return false;
      }
      return true;
    });
  }, [debtData.customerSummaries, filterTab, searchQuery]);

  const settledCount = useMemo(
    () => debtData.customerSummaries.filter((c) => c.remainingFC === 0).length,
    [debtData.customerSummaries]
  );

  // --- Handlers: Payment Modal ---
  const openNewPaymentModal = (prefillFullAmount = false) => {
    if (!selectedCustomerSummary) return;
    setEditingPayment(null);
    setPayAmountStr(
      prefillFullAmount && selectedCustomerSummary.remainingFC > 0
        ? formatNumber(selectedCustomerSummary.remainingFC)
        : ''
    );
    setPayDate(toISODate(new Date()));
    setPayNote('');
    setPayError('');
    setOverpayConfirmed(false);
    setIsPaymentModalOpen(true);
  };

  const openEditPaymentModal = (pay: DebtPayment) => {
    setEditingPayment(pay);
    setPayAmountStr(formatNumber(pay.amountFC));
    setPayDate(pay.date);
    setPayNote(pay.note || '');
    setPayError('');
    setOverpayConfirmed(false);
    setIsPaymentModalOpen(true);
  };

  const maxExpectedPaymentForModal = useMemo(() => {
    if (!selectedCustomerSummary) return 0;
    return (
      selectedCustomerSummary.remainingFC +
      (editingPayment ? Math.max(0, Math.round(editingPayment.amountFC || 0)) : 0)
    );
  }, [selectedCustomerSummary, editingPayment]);

  const currentPayAmountNum = parseLocaleNumber(payAmountStr);
  const isOverpaying =
    !isNaN(currentPayAmountNum) &&
    currentPayAmountNum > 0 &&
    Math.round(currentPayAmountNum) > maxExpectedPaymentForModal;

  const handleSavePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerSummary) return;
    setPayError('');

    if (!payDate.trim()) {
      setPayError('Veuillez choisir une date valide.');
      return;
    }

    const amt = Math.round(parseLocaleNumber(payAmountStr));
    if (isNaN(amt) || amt <= 0) {
      setPayError('Veuillez saisir un montant supérieur à 0 FC.');
      return;
    }

    if (amt > maxExpectedPaymentForModal && !overpayConfirmed) {
      setOverpayConfirmed(true);
      return;
    }

    try {
      const record: DebtPayment = {
        id: editingPayment ? editingPayment.id : crypto.randomUUID(),
        customerId: selectedCustomerSummary.customer.id,
        date: payDate.trim(),
        amountFC: amt,
        note: payNote.trim() || undefined,
        createdAt: editingPayment ? editingPayment.createdAt : Date.now(),
      };
      await db.debtPayments.put(record);
      setIsPaymentModalOpen(false);
      setEditingPayment(null);
      onShowToast(
        'success',
        editingPayment
          ? 'Paiement mis à jour avec succès.'
          : 'Paiement enregistré et versé dans les caisses.'
      );
    } catch (err: any) {
      setPayError('Erreur : ' + err.message);
    }
  };

  const handleConfirmDeletePayment = async () => {
    if (!paymentToDelete) return;
    try {
      await db.debtPayments.delete(paymentToDelete.id);
      setPaymentToDelete(null);
      onShowToast('info', 'Paiement supprimé. Les caisses et le reste dû ont été recalculés.');
    } catch (err: any) {
      onShowToast('error', 'Erreur lors de la suppression : ' + err.message);
    }
  };

  // --- Handlers: Write-off & Restore Debt ---
  const handleConfirmWriteOff = async () => {
    if (!selectedCustomerSummary) return;
    try {
      const now = Date.now();
      await db.transaction('rw', db.personalSales, async () => {
        for (const st of selectedCustomerSummary.sales) {
          if (st.remainingFC > 0) {
            const existingSale = await db.personalSales.get(st.saleId);
            if (existingSale) {
              await db.personalSales.put({
                ...existingSale,
                writtenOffFC: Math.max(0, Math.round(existingSale.writtenOffFC || 0)) + st.remainingFC,
                writtenOffAt: now,
              });
            }
          }
        }
      });
      setIsWriteOffModalOpen(false);
      onShowToast('info', 'Le reste de la dette a été marqué comme abandonné (aucune entrée en caisse).');
    } catch (err: any) {
      onShowToast('error', 'Erreur : ' + err.message);
    }
  };

  const handleRestoreWrittenOffOnSale = async (sale: PersonalSale) => {
    try {
      const existing = await db.personalSales.get(sale.id);
      if (!existing) return;
      await db.personalSales.put({
        ...existing,
        writtenOffFC: undefined,
        writtenOffAt: undefined,
      });
      onShowToast('success', 'Dette rétablie avec succès.');
    } catch (err: any) {
      onShowToast('error', 'Erreur : ' + err.message);
    }
  };

  // --- Handlers: Opening Debt ("Ajouter une ancienne dette") ---
  const openOpeningDebtModal = (preselectedCustId?: string) => {
    setOdCustomerId(preselectedCustId || '');
    setOdCustomerSearch('');
    setOdIsCreatingCustomer(customers.length === 0 && !preselectedCustId);
    setOdNewCustName('');
    setOdNewCustPhone('');
    setOdAmountStr('');
    setOdDate(toISODate(new Date()));
    setOdNote('');
    setOdError('');
    setIsOpeningDebtModalOpen(true);
  };

  const handleSaveOpeningDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    setOdError('');

    if (!odDate.trim()) {
      setOdError('Veuillez sélectionner une date valide.');
      return;
    }

    const amt = Math.round(parseLocaleNumber(odAmountStr));
    if (isNaN(amt) || amt <= 0) {
      setOdError('Veuillez entrer un montant supérieur à 0 FC.');
      return;
    }

    let finalCustomer: Customer | undefined;

    if (odIsCreatingCustomer) {
      const cleanName = odNewCustName.trim().replace(/\s+/g, ' ');
      if (!cleanName) {
        setOdError('Veuillez saisir le nom du client.');
        return;
      }
      const duplicate = findCustomerByNormalizedName(customers, cleanName);
      if (duplicate) {
        setOdError(`Un client nommé « ${duplicate.name} » existe déjà. Sélectionnez-le dans la liste.`);
        return;
      }
      finalCustomer = {
        id: crypto.randomUUID(),
        name: cleanName,
        phone: odNewCustPhone.trim() || undefined,
        createdAt: Date.now(),
      };
    } else {
      finalCustomer = customers.find((c) => c.id === odCustomerId);
      if (!finalCustomer) {
        setOdError('Veuillez choisir un client ou cliquer sur « Nouveau client ».');
        return;
      }
    }

    try {
      const reservePartFC = Math.round((amt * reserveRate) / 100);
      const openingSale: PersonalSale = {
        id: crypto.randomUUID(),
        date: odDate.trim(),
        items: [],
        totalSalesFC: amt,
        ownerCommissionRate: 0,
        ownerCommissionFC: 0,
        expenseReserveRate: reserveRate,
        expenseReserveFC: reservePartFC,
        ownerShareRate: Math.max(0, 100 - reserveRate),
        ownerShareFC: amt - reservePartFC,
        kind: 'vente',
        paymentStatus: 'credit',
        customerId: finalCustomer.id,
        customerName: finalCustomer.name,
        isOpeningDebt: true,
        notes: odNote.trim() || undefined,
        createdAt: Date.now(),
      };

      await db.transaction('rw', [db.customers, db.personalSales], async () => {
        if (odIsCreatingCustomer && finalCustomer) {
          await db.customers.put(finalCustomer);
        }
        await db.personalSales.put(openingSale);
      });

      setIsOpeningDebtModalOpen(false);
      onShowToast('success', `Ancienne dette enregistrée pour ${finalCustomer.name}.`);
    } catch (err: any) {
      setOdError('Erreur : ' + err.message);
    }
  };

  // --- Handlers: Edit & Delete Customer ---
  const openEditCustomerModal = () => {
    if (!selectedCustomerSummary) return;
    setEditCustName(selectedCustomerSummary.customer.name);
    setEditCustPhone(selectedCustomerSummary.customer.phone || '');
    setEditCustNote(selectedCustomerSummary.customer.note || '');
    setEditCustError('');
    setIsEditCustomerModalOpen(true);
  };

  const handleSaveCustomerEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerSummary) return;
    setEditCustError('');

    const cleanName = editCustName.trim().replace(/\s+/g, ' ');
    if (!cleanName) {
      setEditCustError('Le nom du client est obligatoire.');
      return;
    }

    const duplicate = findCustomerByNormalizedName(
      customers,
      cleanName,
      selectedCustomerSummary.customer.id
    );
    if (duplicate) {
      setEditCustError(`Un autre client porte déjà le nom « ${duplicate.name} ».`);
      return;
    }

    try {
      const custId = selectedCustomerSummary.customer.id;
      const updatedCustomer: Customer = {
        ...selectedCustomerSummary.customer,
        name: cleanName,
        phone: editCustPhone.trim() || undefined,
        note: editCustNote.trim() || undefined,
      };

      await db.transaction('rw', [db.customers, db.personalSales], async () => {
        await db.customers.put(updatedCustomer);
        const linkedSales = await db.personalSales.where('customerId').equals(custId).toArray();
        for (const s of linkedSales) {
          await db.personalSales.put({ ...s, customerName: cleanName });
        }
      });

      setIsEditCustomerModalOpen(false);
      onShowToast('success', 'Informations du client mises à jour.');
    } catch (err: any) {
      setEditCustError('Erreur : ' + err.message);
    }
  };

  const handleRequestDeleteCustomer = () => {
    if (!selectedCustomerSummary) return;
    if (selectedCustomerSummary.remainingFC > 0) {
      onShowToast(
        'error',
        `Impossible de supprimer ${selectedCustomerSummary.customer.name} tant qu'il reste ${formatFC(
          selectedCustomerSummary.remainingFC,
          currency
        )} à payer.`
      );
      return;
    }
    if (selectedCustomerSummary.sales.length > 0 || selectedCustomerSummary.payments.length > 0) {
      onShowToast(
        'info',
        'Ce client possède un historique de prises ou de paiements lié aux caisses et reste conservé dans les clients soldés.'
      );
      return;
    }
    setIsDeleteCustomerModalOpen(true);
  };

  const handleConfirmDeleteCustomer = async () => {
    if (!selectedCustomerSummary) return;
    try {
      await db.customers.delete(selectedCustomerSummary.customer.id);
      setIsDeleteCustomerModalOpen(false);
      setSelectedCustomerId(null);
      onShowToast('info', 'Client supprimé.');
    } catch (err: any) {
      onShowToast('error', 'Erreur : ' + err.message);
    }
  };

  const filteredOdCustomers = useMemo(() => {
    const q = odCustomerSearch.trim().toLocaleLowerCase('fr');
    const sorted = [...customers].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    if (!q) return sorted;
    return sorted.filter(
      (c) =>
        c.name.toLocaleLowerCase('fr').includes(q) ||
        (c.phone || '').toLocaleLowerCase('fr').includes(q)
    );
  }, [customers, odCustomerSearch]);

  const renderCustomerBadge = (badge: CustomerDebtSummary['badge']) => {
    if (badge === 'Non payé') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-extrabold bg-rose-100 text-rose-800 border border-rose-200">
          Non payé
        </span>
      );
    }
    if (badge === 'Partiel') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-extrabold bg-amber-100 text-amber-800 border border-amber-200">
          Partiel
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-200">
        Payé
      </span>
    );
  };

  // ============================================================================
  // VUE DÉTAIL : FICHE D'UN CLIENT
  // ============================================================================
  if (selectedCustomerSummary) {
    const { customer, sales, payments, totalCreditFC, totalPaidFC, totalWrittenOffFC, remainingFC, daysOverdue, isOverdue, badge } =
      selectedCustomerSummary;

    return (
      <div className="pb-28 pt-3 px-4 max-w-lg mx-auto space-y-4">
        {/* Top Bar */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setSelectedCustomerId(null)}
              aria-label="Retour à la liste des dettes"
              className="p-2.5 rounded-2xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 active:scale-95 transition-all shadow-2xs min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-black text-slate-900 truncate">{customer.name}</h2>
                {renderCustomerBadge(badge)}
              </div>
              {customer.phone && (
                <p className="text-xs text-slate-500 flex items-center gap-1 font-mono mt-0.5">
                  <Phone className="w-3 h-3 text-teal-700" />
                  <span>{customer.phone}</span>
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={openEditCustomerModal}
              className="p-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 hover:text-teal-700 hover:bg-slate-50 min-h-[40px] min-w-[40px] flex items-center justify-center"
              title="Modifier le client"
            >
              <Edit2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleRequestDeleteCustomer}
              className="p-2.5 rounded-xl bg-white border border-slate-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50 min-h-[40px] min-w-[40px] flex items-center justify-center"
              title="Supprimer le client"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {customer.note && (
          <div className="p-2.5 rounded-xl bg-slate-100 border border-slate-200 text-xs text-slate-700 italic">
            Note client : {customer.note}
          </div>
        )}

        {/* Reste à payer Hero Card */}
        <div
          className={`rounded-3xl p-4 shadow-md text-white space-y-3 ${
            remainingFC > 0
              ? isOverdue
                ? 'bg-linear-to-br from-rose-700 via-rose-800 to-slate-900'
                : 'bg-linear-to-br from-amber-600 via-amber-700 to-slate-900'
              : 'bg-linear-to-br from-emerald-800 via-teal-900 to-slate-900'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-white/80">
              Reste à payer
            </span>
            {remainingFC > 0 && selectedCustomerSummary.oldestUnpaidDate && (
              <span
                className={`text-[11px] font-mono px-2 py-0.5 rounded-lg font-bold ${
                  isOverdue ? 'bg-rose-500/40 text-white border border-rose-300/40' : 'bg-white/15 text-white'
                }`}
              >
                Depuis le {formatDate(selectedCustomerSummary.oldestUnpaidDate)} ({daysOverdue} j)
              </span>
            )}
          </div>

          <div className="text-3xl font-black font-mono tracking-tight">
            {formatFC(remainingFC, currency)}
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/15 text-xs">
            <div>
              <span className="text-[10px] text-white/70 block">Total pris</span>
              <span className="font-mono font-bold">{formatFC(totalCreditFC, currency)}</span>
            </div>
            <div>
              <span className="text-[10px] text-white/70 block">Déjà payé</span>
              <span className="font-mono font-bold text-emerald-200">
                {formatFC(totalPaidFC, currency)}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-white/70 block">Abandonné</span>
              <span className="font-mono font-bold text-rose-200">
                {formatFC(totalWrittenOffFC, currency)}
              </span>
            </div>
          </div>
        </div>

        {/* Boutons d'action sur la dette */}
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => openNewPaymentModal(false)}
              className="py-3 px-3 rounded-2xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-extrabold shadow-xs active:scale-95 transition-all min-h-[46px] flex items-center justify-center gap-1.5"
            >
              <Wallet className="w-4 h-4" />
              <span>Enregistrer un paiement</span>
            </button>

            <button
              type="button"
              disabled={remainingFC <= 0}
              onClick={() => openNewPaymentModal(true)}
              className="py-3 px-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-45 text-white text-xs font-extrabold shadow-xs active:scale-95 transition-all min-h-[46px] flex items-center justify-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Payé en totalité</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => openOpeningDebtModal(customer.id)}
              className="flex-1 py-2.5 px-3 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold active:scale-95 transition-all min-h-[40px] flex items-center justify-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5 text-teal-700" />
              <span>Ajouter une ancienne dette</span>
            </button>

            {remainingFC > 0 && (
              <button
                type="button"
                onClick={() => setIsWriteOffModalOpen(true)}
                className="py-2.5 px-3 rounded-xl bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 text-xs font-bold active:scale-95 transition-all min-h-[40px] flex items-center justify-center gap-1.5"
              >
                <Ban className="w-3.5 h-3.5" />
                <span>Abandonner la dette</span>
              </button>
            )}
          </div>
        </div>

        {/* Liste des prises à crédit */}
        <div className="space-y-2.5">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 px-1">
            Prises à crédit ({sales.length})
          </h3>

          {sales.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 text-center text-xs text-slate-400">
              Aucune prise à crédit enregistrée pour ce client.
            </div>
          ) : (
            <div className="space-y-2.5">
              {[...sales].reverse().map((st) => {
                const { sale } = st;
                const saleDays =
                  st.remainingFC > 0
                    ? calculateDaysBetweenDates(sale.date, toISODate(new Date()))
                    : 0;
                const saleOverdue = st.remainingFC > 0 && saleDays > debtReminderDays;

                return (
                  <div
                    key={sale.id}
                    className="bg-white rounded-2xl border border-slate-200/90 p-3.5 shadow-2xs space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-extrabold text-slate-900">
                            {formatDate(sale.date)}
                          </span>
                          {sale.isOpeningDebt && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                              Ancienne dette
                            </span>
                          )}
                          {st.status === 'paid' && (
                            <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800">
                              Payé
                            </span>
                          )}
                          {st.status === 'partial' && (
                            <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800">
                              Partiel
                            </span>
                          )}
                          {st.status === 'unpaid' && (
                            <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-rose-100 text-rose-800">
                              Non payé
                            </span>
                          )}
                          {st.status === 'written_off' && (
                            <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-slate-200 text-slate-700">
                              Dette abandonnée
                            </span>
                          )}
                        </div>
                        {st.remainingFC > 0 && (
                          <span
                            className={`text-[11px] font-mono block mt-0.5 ${
                              saleOverdue ? 'text-rose-600 font-extrabold' : 'text-slate-500'
                            }`}
                          >
                            {saleDays} jour{saleDays > 1 ? 's' : ''} écoulé{saleDays > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>

                      <div className="text-right">
                        <span className="text-xs font-black font-mono text-slate-900 block">
                          {formatFC(st.totalFC, currency)}
                        </span>
                        {st.remainingFC > 0 && (
                          <span className="text-[11px] font-mono font-bold text-rose-600 block">
                            Reste : {formatFC(st.remainingFC, currency)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Produits pris */}
                    {sale.isOpeningDebt ? (
                      <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                        Ancienne dette reprise (sans sortie de stock ni statistiques de vente)
                      </div>
                    ) : (
                      <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 space-y-1">
                        {sale.items.map((it) => (
                          <div
                            key={it.productId}
                            className="flex items-center justify-between text-xs text-slate-700"
                          >
                            <span className="font-medium">
                              {it.productName} × {formatNumber(it.soldQty)}
                            </span>
                            <span className="font-mono font-bold text-slate-900">
                              {formatFC(it.soldQty * it.unitPrice, currency)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Détail payé / abandonné */}
                    <div className="flex items-center justify-between flex-wrap gap-2 text-[11px] font-mono pt-1 border-t border-slate-100">
                      <span className="text-emerald-700 font-bold">
                        Payé : {formatFC(st.paidFC, currency)}
                      </span>
                      {st.writtenOffFC > 0 && (
                        <span className="text-slate-600 font-bold">
                          Abandonné : {formatFC(st.writtenOffFC, currency)}
                        </span>
                      )}
                      <span
                        className={`font-extrabold ${
                          st.remainingFC > 0 ? 'text-rose-700' : 'text-emerald-800'
                        }`}
                      >
                        Reste : {formatFC(st.remainingFC, currency)}
                      </span>
                    </div>

                    {sale.notes && (
                      <p className="text-xs text-slate-500 italic bg-slate-50 p-2 rounded-lg">
                        Note : {sale.notes}
                      </p>
                    )}

                    {(sale.writtenOffFC || 0) > 0 && (
                      <div className="pt-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleRestoreWrittenOffOnSale(sale)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900 text-xs font-bold transition-all active:scale-95"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Rétablir la dette</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Liste des paiements reçus */}
        <div className="space-y-2.5">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 px-1">
            Paiements reçus ({payments.length})
          </h3>

          {payments.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 text-center text-xs text-slate-400">
              Aucun paiement enregistré pour le moment.
            </div>
          ) : (
            <div className="space-y-2">
              {[...payments].reverse().map((pay) => (
                <div
                  key={pay.id}
                  className="bg-white rounded-2xl border border-slate-200/90 p-3.5 shadow-2xs flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-extrabold text-slate-900">
                        {formatDate(pay.date)}
                      </span>
                      <span className="text-sm font-black font-mono text-emerald-700">
                        +{formatFC(pay.amountFC, currency)}
                      </span>
                    </div>
                    {pay.note && (
                      <p className="text-xs text-slate-500 italic truncate mt-0.5">{pay.note}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditPaymentModal(pay)}
                      className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 min-h-[38px] min-w-[38px] flex items-center justify-center"
                      title="Modifier ce paiement"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentToDelete(pay)}
                      className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 min-h-[38px] min-w-[38px] flex items-center justify-center"
                      title="Supprimer ce paiement"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Modal Enregistrer / Modifier un paiement */}
        {isPaymentModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    {editingPayment ? 'Modifier le paiement' : 'Enregistrer un paiement'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Client : <strong>{customer.name}</strong> · Reste dû :{' '}
                    <strong className="font-mono">
                      {formatFC(maxExpectedPaymentForModal, currency)}
                    </strong>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsPaymentModalOpen(false);
                    setEditingPayment(null);
                  }}
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSavePayment} className="p-4 space-y-3.5">
                {payError && (
                  <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>{payError}</span>
                  </div>
                )}

                {isOverpaying && (
                  <div
                    className={`p-3 rounded-2xl border text-xs flex items-start gap-2 ${
                      overpayConfirmed
                        ? 'bg-amber-100 border-amber-300 text-amber-950 font-bold'
                        : 'bg-amber-50 border-amber-200 text-amber-900'
                    }`}
                  >
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-extrabold">
                        Attention : le montant saisi dépasse le reste dû ({formatFC(maxExpectedPaymentForModal, currency)}).
                      </p>
                      {overpayConfirmed && (
                        <p className="text-[11px]">
                          Cliquez une seconde fois sur le bouton ci-dessous pour confirmer quand même ce paiement.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Montant payé ({currency}) *
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoFocus
                    placeholder="Ex : 2500"
                    value={payAmountStr}
                    onChange={(e) => {
                      setPayAmountStr(e.target.value.replace(/[^0-9.,]/g, ''));
                      setOverpayConfirmed(false);
                      setPayError('');
                    }}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-extrabold font-mono text-slate-900 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Date du paiement *
                  </label>
                  <input
                    type="date"
                    required
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Note (facultatif)
                  </label>
                  <input
                    type="text"
                    placeholder="Ex : Payé en espèces, acompte..."
                    value={payNote}
                    onChange={(e) => setPayNote(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-900 bg-white"
                  />
                </div>

                <button
                  type="submit"
                  className={`w-full py-3 px-4 rounded-xl text-white text-xs font-extrabold shadow-xs active:scale-95 transition-all min-h-[44px] flex items-center justify-center gap-2 ${
                    overpayConfirmed
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-teal-700 hover:bg-teal-800'
                  }`}
                >
                  <Check className="w-4 h-4" />
                  <span>
                    {overpayConfirmed
                      ? 'Confirmer malgré le dépassement'
                      : editingPayment
                      ? 'Enregistrer les modifications'
                      : 'Enregistrer le paiement'}
                  </span>
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Modal Modifier le client */}
        {isEditCustomerModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
                <h3 className="text-base font-extrabold text-slate-900">Modifier le client</h3>
                <button
                  type="button"
                  onClick={() => setIsEditCustomerModalOpen(false)}
                  className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveCustomerEdit} className="p-4 space-y-3">
                {editCustError && (
                  <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
                    {editCustError}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Nom *</label>
                  <input
                    type="text"
                    required
                    value={editCustName}
                    onChange={(e) => setEditCustName(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Téléphone (facultatif)
                  </label>
                  <input
                    type="tel"
                    value={editCustPhone}
                    onChange={(e) => setEditCustPhone(e.target.value)}
                    placeholder="Ex : 081..."
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-900 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Note (facultatif)
                  </label>
                  <input
                    type="text"
                    value={editCustNote}
                    onChange={(e) => setEditCustNote(e.target.value)}
                    placeholder="Ex : Voisin, cliente régulière..."
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-900 bg-white"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-3 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-extrabold shadow-xs min-h-[44px]"
                >
                  Enregistrer
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Modal Ancienne dette aussi accessible depuis la fiche client */}
        {isOpeningDebtModalOpen && renderOpeningDebtModal()}

        {/* Confirmation sécurisée suppression d'un paiement */}
        <SecurityConfirmModal
          isOpen={Boolean(paymentToDelete)}
          title="Supprimer ce paiement ?"
          message={`Le paiement de ${formatFC(
            paymentToDelete?.amountFC || 0,
            currency
          )} du ${formatDate(
            paymentToDelete?.date
          )} sera retiré des caisses et le reste dû du client augmentera d'autant.`}
          pinCode={settings.pinCode}
          confirmWord="SUPPRIMER"
          confirmLabel="Supprimer le paiement"
          onConfirm={handleConfirmDeletePayment}
          onCancel={() => setPaymentToDelete(null)}
        />

        {/* Confirmation sécurisée abandon de dette */}
        <SecurityConfirmModal
          isOpen={isWriteOffModalOpen}
          title="Abandonner le reste de cette dette ?"
          message={`Le reste dû de ${formatFC(
            remainingFC,
            currency
          )} pour ${customer.name} sera marqué comme abandonné. Cet argent n'entrera dans aucune caisse, mais la trace restera visible avec possibilité de rétablir la dette plus tard.`}
          pinCode={settings.pinCode}
          confirmWord="SUPPRIMER"
          confirmLabel="Abandonner la dette"
          onConfirm={handleConfirmWriteOff}
          onCancel={() => setIsWriteOffModalOpen(false)}
        />

        {/* Confirmation suppression client vide */}
        <SecurityConfirmModal
          isOpen={isDeleteCustomerModalOpen}
          title="Supprimer ce client ?"
          message={`Voulez-vous supprimer la fiche client de ${customer.name} ?`}
          pinCode={settings.pinCode}
          confirmWord="SUPPRIMER"
          confirmLabel="Supprimer"
          onConfirm={handleConfirmDeleteCustomer}
          onCancel={() => setIsDeleteCustomerModalOpen(false)}
        />
      </div>
    );
  }

  // Helper rendu modal Ancienne dette
  function renderOpeningDebtModal() {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
        <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-auto">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                Ajouter une ancienne dette
              </h3>
              <p className="text-xs text-slate-500">
                Dette antérieure sans sortie de stock ni impact sur les ventes passées
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsOpeningDebtModalOpen(false)}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSaveOpeningDebt} className="p-4 space-y-3.5">
            {odError && (
              <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{odError}</span>
              </div>
            )}

            {/* Choix client ou Nouveau client */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700">Client *</label>
                <button
                  type="button"
                  onClick={() => {
                    setOdIsCreatingCustomer((prev) => !prev);
                    setOdError('');
                  }}
                  className="text-xs font-bold text-teal-700 hover:text-teal-900 inline-flex items-center gap-1"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>
                    {odIsCreatingCustomer ? 'Choisir un client existant' : '+ Nouveau client'}
                  </span>
                </button>
              </div>

              {odIsCreatingCustomer ? (
                <div className="p-3 rounded-2xl bg-teal-50/50 border border-teal-200 space-y-2.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Nom du nouveau client *
                    </label>
                    <input
                      type="text"
                      placeholder="Ex : Maman Grâce"
                      value={odNewCustName}
                      onChange={(e) => {
                        setOdNewCustName(e.target.value);
                        setOdError('');
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Téléphone (facultatif)
                    </label>
                    <input
                      type="tel"
                      placeholder="Ex : 082..."
                      value={odNewCustPhone}
                      onChange={(e) => setOdNewCustPhone(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-900 bg-white"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Rechercher un client..."
                      value={odCustomerSearch}
                      onChange={(e) => setOdCustomerSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-slate-50 focus:bg-white"
                    />
                  </div>
                  <div className="max-h-36 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100 bg-white">
                    {filteredOdCustomers.length === 0 ? (
                      <div className="p-2.5 text-center text-xs text-slate-400">
                        Aucun client trouvé. Cliquez sur « + Nouveau client ».
                      </div>
                    ) : (
                      filteredOdCustomers.map((c) => {
                        const isSelected = c.id === odCustomerId;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setOdCustomerId(c.id);
                              setOdError('');
                            }}
                            className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between transition-colors ${
                              isSelected
                                ? 'bg-teal-50 text-teal-900 font-extrabold'
                                : 'hover:bg-slate-50 text-slate-800 font-semibold'
                            }`}
                          >
                            <span>
                              {c.name}
                              {c.phone ? ` · ${c.phone}` : ''}
                            </span>
                            {isSelected && <Check className="w-4 h-4 text-teal-700" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Montant dû ({currency}) *
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="Ex : 5000"
                  value={odAmountStr}
                  onChange={(e) => setOdAmountStr(e.target.value.replace(/[^0-9.,]/g, ''))}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-extrabold font-mono text-slate-900 bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Date de la dette *
                </label>
                <input
                  type="date"
                  required
                  value={odDate}
                  onChange={(e) => setOdDate(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 bg-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Note (facultatif)
              </label>
              <input
                type="text"
                placeholder="Ex : Reste avant utilisation de l'application..."
                value={odNote}
                onChange={(e) => setOdNote(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-900 bg-white"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-extrabold shadow-xs active:scale-95 transition-all min-h-[44px]"
            >
              Enregistrer l'ancienne dette
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ============================================================================
  // VUE PRINCIPALE : LISTE DES DETTES CLIENTS
  // ============================================================================
  return (
    <div className="pb-28 pt-3 px-4 max-w-lg mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onBack}
            aria-label="Retour"
            className="p-2.5 rounded-2xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 active:scale-95 transition-all shadow-2xs min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-lg font-black text-slate-900 tracking-tight">Dettes clients</h2>
            <p className="text-xs text-slate-500">Suivi des ventes personnelles à crédit</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => openOpeningDebtModal()}
          className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs active:scale-95 transition-all min-h-[42px]"
        >
          <Plus className="w-4 h-4 text-teal-400" />
          <span>Ajouter une ancienne dette</span>
        </button>
      </div>

      {/* Résumé global */}
      <div className="grid grid-cols-3 gap-2">
        <div className="p-3 rounded-2xl bg-slate-900 text-white shadow-2xs">
          <span className="text-[10px] font-bold uppercase text-slate-400 block">Total dû</span>
          <span className="text-sm font-black font-mono text-amber-300 mt-0.5 block">
            {formatFC(debtData.totalRemainingFC, currency)}
          </span>
        </div>

        <div className="p-3 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
          <span className="text-[10px] font-bold uppercase text-slate-500 block">Débiteurs</span>
          <span className="text-sm font-black font-mono text-slate-900 mt-0.5 block">
            {debtData.debtorCount} client{debtData.debtorCount > 1 ? 's' : ''}
          </span>
        </div>

        <div className="p-3 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
          <span className="text-[10px] font-bold uppercase text-rose-700 block">
            En retard (&gt;{debtReminderDays}j)
          </span>
          <span
            className={`text-sm font-black font-mono mt-0.5 block ${
              debtData.overdueCount > 0 ? 'text-rose-600' : 'text-emerald-700'
            }`}
          >
            {debtData.overdueCount}
          </span>
        </div>
      </div>

      {/* Filtres Tous / En retard / Soldés + Recherche */}
      <div className="space-y-2.5">
        <div className="flex items-center p-1 bg-slate-200/70 rounded-2xl gap-1">
          <button
            type="button"
            onClick={() => setFilterTab('all')}
            className={`flex-1 py-2 px-2 text-xs font-bold rounded-xl transition-all min-h-[38px] ${
              filterTab === 'all'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Tous ({debtData.customerSummaries.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('overdue')}
            className={`flex-1 py-2 px-2 text-xs font-bold rounded-xl transition-all min-h-[38px] ${
              filterTab === 'overdue'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'text-rose-800 hover:text-rose-950'
            }`}
          >
            En retard ({debtData.overdueCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('settled')}
            className={`flex-1 py-2 px-2 text-xs font-bold rounded-xl transition-all min-h-[38px] ${
              filterTab === 'settled'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Soldés ({settledCount})
          </button>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher un client par nom ou téléphone..."
            className="w-full pl-9 pr-3 py-2.5 rounded-2xl border border-slate-200 bg-white text-xs font-semibold text-slate-800 shadow-2xs"
          />
        </div>
      </div>

      {/* Liste des clients */}
      {filteredSummaries.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200/90 p-8 text-center shadow-2xs space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-teal-50 text-teal-700 flex items-center justify-center mx-auto">
            <Users className="w-6 h-6" />
          </div>
          <h4 className="text-sm font-bold text-slate-800">
            {filterTab === 'overdue'
              ? 'Aucune dette en retard'
              : filterTab === 'settled'
              ? 'Aucun client soldé'
              : 'Aucune dette enregistrée'}
          </h4>
          <p className="text-xs text-slate-500 max-w-xs mx-auto">
            Lors d'une vente personnelle choisie « À crédit » ou via « Ajouter une ancienne dette », vos clients apparaîtront ici.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredSummaries.map((item) => (
            <button
              key={item.customer.id}
              type="button"
              onClick={() => setSelectedCustomerId(item.customer.id)}
              className={`w-full text-left bg-white rounded-2xl p-4 shadow-2xs border transition-all active:scale-[0.99] flex items-center justify-between gap-3 ${
                item.isOverdue
                  ? 'border-rose-300 bg-rose-50/20'
                  : 'border-slate-200/90 hover:border-teal-400'
              }`}
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-extrabold text-slate-900 truncate">
                    {item.customer.name}
                  </span>
                  {renderCustomerBadge(item.badge)}
                </div>

                {item.remainingFC > 0 && item.oldestUnpaidDate ? (
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <span className="text-slate-500 font-mono">
                      Plus ancienne : {formatDate(item.oldestUnpaidDate)}
                    </span>
                    <span>·</span>
                    <span
                      className={`font-mono ${
                        item.isOverdue
                          ? 'text-rose-600 font-extrabold'
                          : 'text-slate-600 font-semibold'
                      }`}
                    >
                      {item.daysOverdue} jour{item.daysOverdue > 1 ? 's' : ''} de retard
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">
                    {item.hasAnyWrittenOff && item.totalPaidFC < item.totalCreditFC
                      ? 'Solde clôturé (dette abandonnée)'
                      : 'Aucune dette en cours'}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    Total dû
                  </span>
                  <span
                    className={`text-sm font-black font-mono ${
                      item.remainingFC > 0
                        ? item.isOverdue
                          ? 'text-rose-700'
                          : 'text-slate-900'
                        : 'text-emerald-700'
                    }`}
                  >
                    {formatFC(item.remainingFC, currency)}
                  </span>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </div>
            </button>
          ))}
        </div>
      )}

      {isOpeningDebtModalOpen && renderOpeningDebtModal()}
    </div>
  );
};
