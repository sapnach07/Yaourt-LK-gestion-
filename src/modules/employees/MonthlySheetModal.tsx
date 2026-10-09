import React, { useState, useEffect } from 'react';
import {
  X,
  FileDown,
  Share2,
  Calendar,
  DollarSign,
  Plus,
  Trash2,
} from 'lucide-react';
import { db } from '../../db/db';
import {
  formatDate,
  formatFC,
  formatMonthName,
  toISOMonth,
  formatNumber,
} from '../../utils/formatters';
import { generateEmployeeMonthlyPDF } from '../../utils/pdfGenerator';
import type { DailyEntry, Employee, Payment, AppSettings } from '../../types';

interface MonthlySheetModalProps {
  isOpen: boolean;
  employee: Employee | null;
  onClose: () => void;
  onOpenPaymentModal: (emp: Employee) => void;
  settings: AppSettings;
}

export const MonthlySheetModal: React.FC<MonthlySheetModalProps> = ({
  isOpen,
  employee,
  onClose,
  onOpenPaymentModal,
  settings,
}) => {
  const [selectedMonth, setSelectedMonth] = useState(toISOMonth(new Date()));
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  useEffect(() => {
    if (!isOpen || !employee) return;
    loadMonthData();
  }, [isOpen, employee, selectedMonth]);

  const loadMonthData = async () => {
    if (!employee) return;

    // Load entries for this employee where date starts with selectedMonth
    const allEntries = await db.dailyEntries
      .where('employeeId')
      .equals(employee.id)
      .toArray();

    const monthEntries = allEntries
      .filter((e) => e.date.startsWith(selectedMonth))
      .sort((a, b) => a.date.localeCompare(b.date));
    setEntries(monthEntries);

    // Load payments for this employee for this month
    const allPayments = await db.payments
      .where('employeeId')
      .equals(employee.id)
      .toArray();

    const monthPayments = allPayments.filter((p) => p.month === selectedMonth);
    setPayments(monthPayments);
  };

  if (!isOpen || !employee) return null;

  // Totals calculations
  let sumDelivered = 0;
  let sumDeliveredFC = 0;
  let sumSold = 0;
  let sumDamaged = 0;
  let sumDamagedFC = 0;
  let sumRest = 0;
  let sumRestFC = 0;
  let sumSalesFC = 0;
  let sumCommissionFC = 0;

  for (const entry of entries) {
    for (const item of entry.items) {
      sumDelivered += item.delivered;
      sumDeliveredFC += item.delivered * (item.unitPrice || 0);
      sumSold += item.sold;
      sumDamaged += item.damaged;
      sumDamagedFC += item.damaged * (item.unitPrice || 0);
      sumRest += item.rest;
      sumRestFC += item.rest * (item.unitPrice || 0);
    }
    sumSalesFC += entry.totalSalesFC;
    sumCommissionFC += entry.employeeCommissionFC;
  }

  const totalPaidFC = payments.reduce((acc, p) => acc + (p.amountFC || 0), 0);
  const remainingDueFC = sumCommissionFC - totalPaidFC;
  const currency = settings.currency || 'FC';

  const handleGeneratePDF = async (action: 'download' | 'share') => {
    setIsGeneratingPdf(true);
    try {
      await generateEmployeeMonthlyPDF(
        {
          employee,
          month: selectedMonth,
          entries,
          payments,
          settings,
        },
        action
      );
    } catch (e) {
      console.error('Erreur génération PDF:', e);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleDeletePayment = async (paymentId: string) => {
    await db.payments.delete(paymentId);
    await loadMonthData();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="w-full sm:max-w-2xl bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 flex flex-col overflow-hidden max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50/70">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Fiche de paie vendeur(se) : {employee.name}
            </h2>
            <p className="text-xs text-slate-500 font-medium">
              Vérification des ventes et décompte de commission du/de la vendeur(se)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 min-w-[40px] min-h-[40px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Month Selector Bar */}
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200/60 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-teal-700" />
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <span className="text-xs font-bold text-slate-600">
            {formatMonthName(selectedMonth)}
          </span>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 overflow-y-auto space-y-4">
          {/* Summary Cards with Livraisons in FC */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            <div className="p-3 rounded-2xl bg-teal-50/70 border border-teal-200/80">
              <span className="text-[11px] font-semibold text-teal-800 block">Livraisons</span>
              <span className="text-sm font-extrabold text-teal-950 font-mono block">
                {formatFC(sumDeliveredFC, currency)}
              </span>
            </div>
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/70">
              <span className="text-[11px] font-semibold text-slate-500 block">Ventes Totales</span>
              <span className="text-sm font-extrabold text-slate-900 font-mono block">
                {formatFC(sumSalesFC, currency)}
              </span>
            </div>
            <div className="p-3 rounded-2xl bg-teal-50/80 border border-teal-200/70">
              <span className="text-[11px] font-semibold text-teal-700 block">Commission Due</span>
              <span className="text-sm font-extrabold text-teal-900 font-mono block">
                {formatFC(sumCommissionFC, currency)}
              </span>
              <span className="text-[10px] text-teal-700 font-mono block">
                Taux {formatNumber(employee.commissionRate)} %
              </span>
            </div>
            <div className="p-3 rounded-2xl bg-amber-50/80 border border-amber-200/70">
              <span className="text-[11px] font-semibold text-amber-700 block">Déjà Versé</span>
              <span className="text-sm font-extrabold text-amber-900 font-mono block">
                {formatFC(totalPaidFC, currency)}
              </span>
              <span className="text-[10px] text-amber-700/80 font-mono block">
                {payments.length} versements
              </span>
            </div>
            <div
              className={`p-3 rounded-2xl border ${
                remainingDueFC > 0
                  ? 'bg-rose-50/80 border-rose-200/70 text-rose-900'
                  : 'bg-emerald-50/80 border-emerald-200/70 text-emerald-900'
              }`}
            >
              <span className="text-[11px] font-semibold block">Reste à Payer</span>
              <span className="text-sm font-extrabold font-mono block">
                {formatFC(remainingDueFC, currency)}
              </span>
              <span className="text-[10px] opacity-80 font-mono block">Solde net</span>
            </div>
          </div>

          {/* Daily Table with amounts in Francs */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="px-3.5 py-2.5 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800">
                Détail journalier en Francs ({entries.length} jours)
              </h3>
              <span className="text-[11px] text-slate-500 font-medium">
                Livraisons, ventes et restes valorisés en {currency}
              </span>
            </div>

            {entries.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                Aucune saisie de vente pour {employee.name} en {formatMonthName(selectedMonth)}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-2.5 text-right">Livraison</th>
                      <th className="py-2.5 px-2.5 text-right">Ventes</th>
                      <th className="py-2.5 px-2.5 text-right">Reste</th>
                      <th className="py-2.5 px-2.5 text-right">Abîmé</th>
                      <th className="py-2.5 px-3 text-right">Commission</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {entries.map((entry) => {
                      const dayDeliveredFC = entry.items.reduce((acc, i) => acc + (i.delivered * (i.unitPrice || 0)), 0);
                      const dayRestFC = entry.items.reduce((acc, i) => acc + (i.rest * (i.unitPrice || 0)), 0);
                      const dayDamagedFC = entry.items.reduce((acc, i) => acc + (i.damaged * (i.unitPrice || 0)), 0);

                      return (
                        <tr key={entry.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-2.5 px-3 font-medium text-slate-900 whitespace-nowrap">
                            {formatDate(entry.date)}
                          </td>
                          <td className="py-2.5 px-2.5 text-right font-mono whitespace-nowrap font-extrabold text-slate-900 text-xs">
                            {formatFC(dayDeliveredFC, currency)}
                          </td>
                          <td className="py-2.5 px-2.5 text-right font-mono whitespace-nowrap font-extrabold text-emerald-700 text-xs">
                            {formatFC(entry.totalSalesFC, currency)}
                          </td>
                          <td className="py-2.5 px-2.5 text-right font-mono whitespace-nowrap font-bold text-slate-700 text-xs">
                            {formatFC(dayRestFC, currency)}
                          </td>
                          <td className="py-2.5 px-2.5 text-right font-mono whitespace-nowrap text-xs">
                            {dayDamagedFC > 0 ? (
                              <span className="font-bold text-rose-600">
                                {formatFC(dayDamagedFC, currency)}
                              </span>
                            ) : (
                              <span className="text-slate-400">0 FC</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-extrabold text-teal-700 whitespace-nowrap text-xs">
                            {formatFC(entry.employeeCommissionFC, currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-slate-50 font-bold border-t border-slate-200">
                    <tr>
                      <td className="py-3 px-3 text-slate-900 font-extrabold">TOTAUX</td>
                      <td className="py-3 px-2.5 text-right font-mono whitespace-nowrap text-slate-900 font-extrabold text-xs">
                        {formatFC(sumDeliveredFC, currency)}
                      </td>
                      <td className="py-3 px-2.5 text-right font-mono whitespace-nowrap text-emerald-700 font-extrabold text-xs">
                        {formatFC(sumSalesFC, currency)}
                      </td>
                      <td className="py-3 px-2.5 text-right font-mono whitespace-nowrap text-slate-700 font-extrabold text-xs">
                        {formatFC(sumRestFC, currency)}
                      </td>
                      <td className="py-3 px-2.5 text-right font-mono whitespace-nowrap text-rose-600 font-extrabold text-xs">
                        {formatFC(sumDamagedFC, currency)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-teal-800 whitespace-nowrap font-extrabold text-xs">
                        {formatFC(sumCommissionFC, currency)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Payments Section */}
          <div className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-xs">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-1.5">
                <DollarSign className="w-4 h-4 text-teal-700" />
                <h3 className="text-xs font-bold text-slate-800">
                  Versements et Avances du mois ({payments.length})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onOpenPaymentModal(employee)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 text-xs font-bold min-h-[36px]"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Nouveau versement</span>
              </button>
            </div>

            {payments.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">
                Aucun versement enregistré pour ce mois.
              </p>
            ) : (
              <div className="space-y-1.5">
                {payments.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200/60 text-xs"
                  >
                    <div>
                      <span className="font-bold text-slate-800">
                        {formatDate(p.date)}
                      </span>
                      <span className="text-slate-500 ml-2">
                        {p.paymentType === 'advance'
                          ? 'Avance'
                          : p.paymentType === 'final'
                          ? 'Solde final'
                          : 'Règlement'}
                      </span>
                      {p.notes && <span className="text-slate-400 block text-[11px]">{p.notes}</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-bold font-mono text-slate-900">
                        {formatFC(p.amountFC, currency)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeletePayment(p.id)}
                        className="text-slate-400 hover:text-rose-600 p-1 rounded-lg min-w-[32px] min-h-[32px] flex items-center justify-center"
                        title="Supprimer ce versement"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions: PDF and WhatsApp Share */}
        <div className="p-4 border-t border-slate-200/80 bg-slate-50/70 flex items-center gap-2.5">
          <button
            type="button"
            disabled={isGeneratingPdf || entries.length === 0}
            onClick={() => handleGeneratePDF('download')}
            className="flex-1 py-3 px-3 rounded-xl bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-xs font-bold shadow-xs active:scale-95 transition-all flex items-center justify-center gap-1.5 min-h-[44px]"
          >
            <FileDown className="w-4 h-4" />
            <span>Télécharger PDF</span>
          </button>
          <button
            type="button"
            disabled={isGeneratingPdf || entries.length === 0}
            onClick={() => handleGeneratePDF('share')}
            className="flex-1 py-3 px-3 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs font-bold shadow-xs active:scale-95 transition-all flex items-center justify-center gap-1.5 min-h-[44px]"
          >
            <Share2 className="w-4 h-4" />
            <span>Partager (WhatsApp)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
