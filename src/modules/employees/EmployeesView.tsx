import React, { useState, useEffect } from 'react';
import {
  Users,
  Plus,
  Edit2,
  Archive,
  ArchiveRestore,
  FileSpreadsheet,
  Banknote,
  Phone,
  Calendar,
  X,
  Check,
} from 'lucide-react';
import { db } from '../../db/db';
import { formatDate, toISODate, formatFC, parseLocaleNumber, formatNumber } from '../../utils/formatters';
import { MonthlySheetModal } from './MonthlySheetModal';
import { PaymentModal } from './PaymentModal';
import { ConfirmModal } from '../../components/ConfirmModal';
import { EmptyState } from '../../components/EmptyState';
import type { Employee, AppSettings } from '../../types';

interface EmployeesViewProps {
  settings: AppSettings;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
}

export const EmployeesView: React.FC<EmployeesViewProps> = ({
  settings,
  onShowToast,
}) => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [viewArchived, setViewArchived] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [commissionRate, setCommissionRate] = useState<string>('20');
  const [startDate, setStartDate] = useState(toISODate(new Date()));
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');

  // Modals state
  const [selectedSheetEmp, setSelectedSheetEmp] = useState<Employee | null>(null);
  const [selectedPaymentEmp, setSelectedPaymentEmp] = useState<Employee | null>(null);
  const [confirmArchiveEmp, setConfirmArchiveEmp] = useState<Employee | null>(null);

  useEffect(() => {
    loadEmployees();
  }, []);

  const loadEmployees = async () => {
    const list = await db.employees.toArray();
    setEmployees(list.sort((a, b) => a.name.localeCompare(b.name)));
  };

  const handleOpenAddForm = () => {
    setEditingEmployee(null);
    setName('');
    setPhone('');
    setCommissionRate('20');
    setStartDate(toISODate(new Date()));
    setNote('');
    setFormError('');
    setIsFormOpen(true);
  };

  const handleOpenEditForm = (emp: Employee) => {
    setEditingEmployee(emp);
    setName(emp.name);
    setPhone(emp.phone || '');
    setCommissionRate(formatNumber(emp.commissionRate));
    setStartDate(emp.startDate || toISODate(new Date()));
    setNote(emp.note || '');
    setFormError('');
    setIsFormOpen(true);
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!name.trim()) {
      setFormError('Le nom du/de la vendeur(se) est obligatoire.');
      return;
    }

    const rateNum = parseLocaleNumber(commissionRate);
    if (isNaN(rateNum) || rateNum < 0 || rateNum > 100) {
      setFormError('Le taux de commission doit être compris entre 0 et 100 %.');
      return;
    }

    try {
      if (editingEmployee) {
        // Edit existing
        const updated: Employee = {
          ...editingEmployee,
          name: name.trim(),
          phone: phone.trim() || undefined,
          commissionRate: rateNum,
          startDate,
          note: note.trim() || undefined,
        };
        await db.employees.put(updated);
        onShowToast('success', `Vendeur(se) ${updated.name} mis(e) à jour.`);
      } else {
        // Add new
        const newEmp: Employee = {
          id: 'emp_' + Date.now().toString(),
          name: name.trim(),
          phone: phone.trim() || undefined,
          commissionRate: rateNum,
          startDate,
          note: note.trim() || undefined,
          isArchived: false,
          createdAt: Date.now(),
        };
        await db.employees.put(newEmp);
        onShowToast('success', `Nouveau/nouvelle vendeur(se) ${newEmp.name} ajouté(e).`);
      }

      setIsFormOpen(false);
      await loadEmployees();
    } catch (err: any) {
      setFormError('Erreur d’enregistrement : ' + err.message);
    }
  };

  const handleToggleArchive = async (emp: Employee) => {
    try {
      const nextState = !emp.isArchived;
      await db.employees.update(emp.id, { isArchived: nextState });
      onShowToast(
        'info',
        nextState
          ? `${emp.name} a été archivée (historique conservé).`
          : `${emp.name} a été réactivée.`
      );
      setConfirmArchiveEmp(null);
      await loadEmployees();
    } catch (err: any) {
      onShowToast('error', 'Erreur lors de la mise à jour : ' + err.message);
    }
  };

  const filteredEmployees = employees.filter((emp) =>
    viewArchived ? emp.isArchived : !emp.isArchived
  );

  return (
    <div className="pb-24 pt-3 px-4 max-w-lg mx-auto space-y-4">
      {/* Top action row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">
            Vendeurs(ses)
          </h2>
          <p className="text-xs text-slate-500">
            Gestion de l'équipe de vente, commissions et fiches
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenAddForm}
          className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold shadow-xs active:scale-95 transition-all min-h-[44px]"
        >
          <Plus className="w-4 h-4" />
          <span>Ajouter</span>
        </button>
      </div>

      {/* Filter Tabs: Actifs(ves) vs Archivés(es) */}
      <div className="flex items-center p-1 bg-slate-200/70 rounded-2xl">
        <button
          type="button"
          onClick={() => setViewArchived(false)}
          className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all min-h-[38px] ${
            !viewArchived
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Actifs(ves) ({employees.filter((e) => !e.isArchived).length})
        </button>
        <button
          type="button"
          onClick={() => setViewArchived(true)}
          className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all min-h-[38px] ${
            viewArchived
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Archivés(es) ({employees.filter((e) => e.isArchived).length})
        </button>
      </div>

      {/* Employee List */}
      {filteredEmployees.length === 0 ? (
        <EmptyState
          icon={<Users className="w-7 h-7 text-teal-700" />}
          title={viewArchived ? 'Aucun(e) vendeur(se) archivé(e)' : 'Aucun(e) vendeur(se) actif(ve)'}
          description={
            viewArchived
              ? 'Les vendeurs(ses) archivé(e)s apparaîtront ici sans perte d’historique.'
              : 'Ajoutez votre premier(ère) vendeur(se) pour commencer les saisies journalières et le suivi des commissions.'
          }
          actionLabel={viewArchived ? undefined : 'Ajouter un(e) vendeur(se)'}
          onAction={viewArchived ? undefined : handleOpenAddForm}
        />
      ) : (
        <div className="space-y-3">
          {filteredEmployees.map((emp) => (
            <div
              key={emp.id}
              className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col gap-3"
            >
              {/* Info Row */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">{emp.name}</h3>
                    <span className="text-xs font-extrabold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-lg border border-teal-200/60">
                      {formatNumber(emp.commissionRate)} %
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-slate-500">
                    {emp.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        {emp.phone}
                      </span>
                    )}
                    {emp.startDate && (
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        Début : {formatDate(emp.startDate)}
                      </span>
                    )}
                  </div>

                  {emp.note && (
                    <p className="text-xs text-slate-500 mt-1 italic">"{emp.note}"</p>
                  )}
                </div>

                {/* Edit & Archive Buttons */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleOpenEditForm(emp)}
                    title="Modifier"
                    className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 min-w-[40px] min-h-[40px] flex items-center justify-center"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmArchiveEmp(emp)}
                    title={emp.isArchived ? 'Réactiver' : 'Archiver'}
                    className="p-2 rounded-xl text-slate-500 hover:text-rose-600 hover:bg-slate-100 min-w-[40px] min-h-[40px] flex items-center justify-center"
                  >
                    {emp.isArchived ? (
                      <ArchiveRestore className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Archive className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Action Buttons: Fiche & Paiement */}
              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSelectedSheetEmp(emp)}
                  className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200/70 text-slate-800 text-xs font-bold flex items-center justify-center gap-1.5 min-h-[44px]"
                >
                  <FileSpreadsheet className="w-4 h-4 text-teal-700" />
                  <span>Fiche du mois</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPaymentEmp(emp)}
                  className="py-2.5 px-3 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-800 text-xs font-bold border border-teal-200/50 flex items-center justify-center gap-1.5 min-h-[44px]"
                >
                  <Banknote className="w-4 h-4 text-teal-700" />
                  <span>Paiement / Avance</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      {isFormOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
        >
          <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 flex flex-col overflow-hidden max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50/70">
              <h3 className="text-base font-bold text-slate-900">
                {editingEmployee ? 'Modifier le/la vendeur(se)' : 'Nouveau/Nouvelle vendeur(se)'}
              </h3>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 min-w-[40px] min-h-[40px] flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEmployee} className="p-5 overflow-y-auto space-y-4">
              {formError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nom complet du/de la vendeur(se) *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex : Maman Leave ou Mima"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Taux de commission (%) *
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={commissionRate}
                    onChange={(e) => setCommissionRate(e.target.value.replace(/[^0-9.,]/g, ''))}
                    placeholder="20 ou 11,5"
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 pr-10"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">
                    %
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Ex : 20 % pour Mima, 25 % pour Maman Leave. L'historique des anciennes saisies reste intact si vous le modifiez plus tard.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Numéro de téléphone (optionnel)
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Ex : +243 ..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Date de début
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Note ou observation (optionnel)
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ex : Point de vente marché central"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div className="pt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="flex-1 py-3 px-4 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 min-h-[44px]"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold shadow-xs active:scale-95 transition-all flex items-center justify-center gap-1.5 min-h-[44px]"
                >
                  <Check className="w-4 h-4" />
                  <span>{editingEmployee ? 'Enregistrer' : 'Créer'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Monthly Sheet Modal */}
      <MonthlySheetModal
        isOpen={Boolean(selectedSheetEmp)}
        employee={selectedSheetEmp}
        onClose={() => setSelectedSheetEmp(null)}
        onOpenPaymentModal={(emp) => {
          setSelectedPaymentEmp(emp);
        }}
        settings={settings}
      />

      {/* Payment Modal */}
      <PaymentModal
        isOpen={Boolean(selectedPaymentEmp)}
        employee={selectedPaymentEmp}
        onClose={() => setSelectedPaymentEmp(null)}
        onPaymentSaved={() => {
          onShowToast('success', 'Paiement enregistré avec succès.');
        }}
      />

      {/* Confirm Archive / Restore Modal */}
      <ConfirmModal
        isOpen={Boolean(confirmArchiveEmp)}
        title={
          confirmArchiveEmp?.isArchived
            ? `Réactiver ${confirmArchiveEmp?.name} ?`
            : `Archiver ${confirmArchiveEmp?.name} ?`
        }
        message={
          confirmArchiveEmp?.isArchived
            ? 'Le/la vendeur(se) réapparaîtra dans la liste des vendeurs(ses) actif(ve)s et dans la sélection des saisies.'
            : 'Le/la vendeur(se) n’apparaîtra plus dans la liste active pour les nouvelles saisies, mais tout son historique de ventes et commissions est conservé.'
        }
        confirmLabel={confirmArchiveEmp?.isArchived ? 'Réactiver' : 'Archiver'}
        cancelLabel="Annuler"
        isDanger={!confirmArchiveEmp?.isArchived}
        onConfirm={() => {
          if (confirmArchiveEmp) handleToggleArchive(confirmArchiveEmp);
        }}
        onCancel={() => setConfirmArchiveEmp(null)}
      />
    </div>
  );
};
