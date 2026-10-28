import React, { useState } from 'react';
import {
  X,
  Copy,
  Printer,
  Share2,
  Edit2,
  Trash2,
  Check,
  FileText,
} from 'lucide-react';
import { formatDate, formatFC, formatNumber } from '../../utils/formatters';
import {
  formatReceiptNumber,
  orderSaleItemsForReceipt,
  buildReceiptPlainText,
  generateFilledReceiptPDF,
  RECEIPT_PAYMENT_MODE_LABELS,
} from '../../utils/receiptPdfGenerator';
import type { AppSettings, PersonalSale, Product, ReceiptPaymentMode } from '../../types';

interface ReceiptViewModalProps {
  sale: PersonalSale | null;
  products: Product[];
  settings: AppSettings;
  onClose: () => void;
  onEditReceipt: (sale: PersonalSale) => void;
  onDeleteReceipt: (sale: PersonalSale) => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
}

async function copyTextSafe(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below
    }
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.className = 'fixed -left-[9999px] top-0 opacity-0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export const ReceiptViewModal: React.FC<ReceiptViewModalProps> = ({
  sale,
  products,
  settings,
  onClose,
  onEditReceipt,
  onDeleteReceipt,
  onShowToast,
}) => {
  const [copied, setCopied] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  if (!sale || !sale.receipt) return null;

  const receipt = sale.receipt;
  const currency = settings.currency || 'FC';
  const rSettings = settings.receiptSettings || {};
  const lines = orderSaleItemsForReceipt(sale, products, rSettings.printedProductIds);

  const totalFC = Math.round(sale.totalSalesFC || 0);
  const paidNotedFC = Math.round(receipt.paidNotedFC || 0);
  const remainingFC = Math.max(0, totalFC - paidNotedFC);
  const formattedNo = formatReceiptNumber(receipt.no);

  const handleCopyText = async () => {
    const text = buildReceiptPlainText(sale, products, settings);
    const ok = await copyTextSafe(text);
    if (ok) {
      setCopied(true);
      onShowToast('success', 'Texte du reçu copié (prêt à coller dans WhatsApp).');
      setTimeout(() => setCopied(false), 2000);
    } else {
      onShowToast('error', 'Impossible de copier automatiquement sur cet appareil.');
    }
  };

  const handlePrintPdf = async () => {
    setIsBusy(true);
    try {
      await generateFilledReceiptPDF({
        sale,
        settings,
        products,
        action: 'download',
      });
      onShowToast('success', `PDF du reçu N° ${formattedNo} téléchargé.`);
    } catch (err: any) {
      onShowToast('error', 'Erreur génération PDF : ' + err.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleShare = async () => {
    setIsBusy(true);
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await generateFilledReceiptPDF({
          sale,
          settings,
          products,
          action: 'share',
        });
      } else {
        await generateFilledReceiptPDF({
          sale,
          settings,
          products,
          action: 'download',
        });
        onShowToast(
          'info',
          'Partage direct non disponible sur cet écran : le PDF a été téléchargé.'
        );
      }
    } catch (err: any) {
      onShowToast('error', 'Erreur lors du partage : ' + err.message);
    } finally {
      setIsBusy(false);
    }
  };

  const allModes: ReceiptPaymentMode[] = ['especes', 'mobile_money', 'credit'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/70 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[94vh] flex flex-col">
        {/* En-tête */}
        <div className="px-5 py-4 border-b border-slate-100 bg-amber-50/70 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-amber-600 text-white flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-800 block">
                Aide à la recopie sur reçu papier
              </span>
              <h3 className="text-xl font-black text-slate-900 font-mono leading-tight">
                REÇU N° {formattedNo}
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-white/80 min-h-[42px] min-w-[42px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corps en grandes lettres dans l'ordre exact du reçu papier */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* 1. N° du reçu & Date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-900 block">
                N° du reçu
              </span>
              <span className="text-2xl font-black font-mono text-amber-950 block mt-0.5">
                {formattedNo}
              </span>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                Date
              </span>
              <span className="text-xl font-black font-mono text-slate-900 block mt-0.5">
                {formatDate(receipt.date)}
              </span>
            </div>
          </div>

          {/* 2. Client & Téléphone */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                Client
              </span>
              <span className="text-xl font-black text-slate-900 block leading-snug">
                {sale.customerName || 'Client'}
              </span>
            </div>

            <div className="pt-2 border-t border-slate-200/80">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                Téléphone
              </span>
              <span className="text-lg font-extrabold font-mono text-slate-800 block">
                {receipt.phone && receipt.phone.trim() ? receipt.phone.trim() : '—'}
              </span>
            </div>
          </div>

          {/* 3. Lignes du tableau : Désignation / Prix unitaire / Quantité prise / Total */}
          <div className="space-y-2">
            <span className="text-xs font-extrabold uppercase tracking-wider text-slate-600 block">
              Lignes du reçu (dans l’ordre du tableau)
            </span>

            <div className="space-y-2.5">
              {lines.map((line, idx) => (
                <div
                  key={`${line.designation}_${idx}`}
                  className="p-4 rounded-2xl bg-white border-2 border-slate-200 shadow-2xs space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Désignation (Ligne {idx + 1})
                    </span>
                    <span className="text-lg font-black text-slate-900">
                      {line.designation}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2 rounded-xl bg-slate-50">
                      <span className="text-[11px] font-bold text-slate-500 block">
                        Prix unitaire
                      </span>
                      <span className="text-base font-black font-mono text-slate-900 block mt-0.5">
                        {line.unitPriceFC !== undefined
                          ? formatFC(line.unitPriceFC, currency)
                          : '—'}
                      </span>
                    </div>

                    <div className="p-2 rounded-xl bg-slate-50">
                      <span className="text-[11px] font-bold text-slate-500 block">
                        Quantité prise
                      </span>
                      <span className="text-lg font-black font-mono text-teal-800 block mt-0.5">
                        {line.qty !== undefined ? formatNumber(line.qty) : '—'}
                      </span>
                    </div>

                    <div className="p-2 rounded-xl bg-amber-50/70 border border-amber-200/70">
                      <span className="text-[11px] font-bold text-amber-900 block">
                        Total
                      </span>
                      <span className="text-base font-black font-mono text-amber-950 block mt-0.5">
                        {formatFC(line.totalFC, currency)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 4. Mode de paiement */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
              Mode de paiement à cocher
            </span>
            <div className="grid grid-cols-3 gap-2">
              {allModes.map((m) => {
                const isChecked = receipt.paymentMode === m;
                return (
                  <div
                    key={m}
                    className={`p-2.5 rounded-xl border text-center flex items-center justify-center gap-1.5 ${
                      isChecked
                        ? 'bg-slate-900 text-white border-slate-900 font-black'
                        : 'bg-white text-slate-400 border-slate-200 font-semibold'
                    }`}
                  >
                    <span className="text-sm font-mono">{isChecked ? '☑' : '☐'}</span>
                    <span className="text-xs">{RECEIPT_PAYMENT_MODE_LABELS[m]}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 5. TOTAL À PAYER / PAYÉ / RESTE À PAYER */}
          <div className="space-y-2">
            <div className="p-4 rounded-2xl bg-amber-700 text-white flex items-center justify-between gap-3">
              <span className="text-sm font-extrabold uppercase tracking-wider">
                TOTAL À PAYER
              </span>
              <span className="text-2xl font-black font-mono">
                {formatFC(totalFC, currency)}
              </span>
            </div>

            <div className="p-3.5 rounded-2xl bg-white border-2 border-slate-200 flex items-center justify-between gap-3">
              <span className="text-sm font-extrabold uppercase tracking-wider text-slate-700">
                PAYÉ
              </span>
              <span className="text-xl font-black font-mono text-emerald-800">
                {formatFC(paidNotedFC, currency)}
              </span>
            </div>

            <div className="p-3.5 rounded-2xl bg-white border-2 border-slate-200 flex items-center justify-between gap-3">
              <span className="text-sm font-extrabold uppercase tracking-wider text-slate-700">
                RESTE À PAYER
              </span>
              <span
                className={`text-xl font-black font-mono ${
                  remainingFC > 0 ? 'text-rose-700' : 'text-slate-900'
                }`}
              >
                {formatFC(remainingFC, currency)}
              </span>
            </div>
          </div>
        </div>

        {/* Barre d'actions en bas */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={handleCopyText}
              className="py-3 px-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-all min-h-[44px]"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Copié !' : 'Copier le texte'}</span>
            </button>

            <button
              type="button"
              disabled={isBusy}
              onClick={handlePrintPdf}
              className="py-3 px-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-all min-h-[44px]"
            >
              <Printer className="w-4 h-4 text-amber-400" />
              <span>Imprimer le reçu</span>
            </button>

            <button
              type="button"
              disabled={isBusy}
              onClick={handleShare}
              className="py-3 px-2 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-all min-h-[44px]"
            >
              <Share2 className="w-4 h-4" />
              <span>Partager</span>
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                onClose();
                onEditReceipt(sale);
              }}
              className="flex-1 py-2.5 px-3 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-bold flex items-center justify-center gap-1.5 min-h-[40px]"
            >
              <Edit2 className="w-3.5 h-3.5" />
              <span>Modifier le reçu</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                onDeleteReceipt(sale);
              }}
              className="py-2.5 px-3 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold flex items-center justify-center gap-1.5 min-h-[40px]"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Supprimer le reçu</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
