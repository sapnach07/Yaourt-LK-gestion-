import React, { useState, useEffect } from 'react';
import { X, Check, AlertTriangle, Calculator, UserCheck, Package } from 'lucide-react';
import { db } from '../../db/db';
import { toISODate, formatFC, parseLocaleNumber, formatNumber } from '../../utils/formatters';
import type { Product, PersonalSale, PersonalSaleItem, AppSettings } from '../../types';

interface PersonalSaleModalProps {
  isOpen: boolean;
  saleToEdit?: PersonalSale | null;
  products: Product[];
  settings: AppSettings;
  stockMap: Record<string, number>; // houseStock per productId
  onClose: () => void;
  onSaved: () => void;
  onOpenCalculator?: () => void;
}

interface ProductSaleRow {
  productId: string;
  productName: string;
  unitPrice: number;
  soldQtyStr: string;
}

export const PersonalSaleModal: React.FC<PersonalSaleModalProps> = ({
  isOpen,
  saleToEdit,
  products,
  settings,
  stockMap,
  onClose,
  onSaved,
  onOpenCalculator,
}) => {
  const [date, setDate] = useState(toISODate(new Date()));
  const [commissionRateStr, setCommissionRateStr] = useState('0');
  const [productRows, setProductRows] = useState<ProductSaleRow[]>([]);
  const [notes, setNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [stockWarningAcknowledged, setStockWarningAcknowledged] = useState(false);

  const activeProducts = products.filter((p) => p.isActive);
  const currency = settings.currency || 'FC';
  const reserveRate = settings.expenseReservePct ?? 50;

  useEffect(() => {
    if (!isOpen) return;

    setStockWarningAcknowledged(false);
    setErrorMsg('');

    if (saleToEdit) {
      setDate(saleToEdit.date);
      setCommissionRateStr(formatNumber(saleToEdit.ownerCommissionRate));
      setNotes(saleToEdit.notes || '');

      const rows: ProductSaleRow[] = activeProducts.map((p) => {
        const existing = saleToEdit.items.find((it) => it.productId === p.id);
        return {
          productId: p.id,
          productName: p.name,
          unitPrice: existing ? existing.unitPrice : p.defaultPrice,
          soldQtyStr: existing && existing.soldQty > 0 ? formatNumber(existing.soldQty) : '',
        };
      });
      setProductRows(rows);
    } else {
      setDate(toISODate(new Date()));
      setCommissionRateStr(formatNumber(settings.ownerCommissionPct ?? 0));
      setNotes('');

      const rows: ProductSaleRow[] = activeProducts.map((p) => ({
        productId: p.id,
        productName: p.name,
        unitPrice: p.defaultPrice,
        soldQtyStr: '',
      }));
      setProductRows(rows);
    }
  }, [isOpen, saleToEdit, products, settings]);

  if (!isOpen) return null;

  const handleRowChange = (productId: string, val: string) => {
    setProductRows((prev) =>
      prev.map((r) =>
        r.productId === productId
          ? { ...r, soldQtyStr: val.replace(/[^0-9.,]/g, '') }
          : r
      )
    );
    setStockWarningAcknowledged(false);
  };

  // Live calculations
  let totalSalesFC = 0;
  const itemsWithQty: { row: ProductSaleRow; soldQty: number; lineTotalFC: number; stock: number; exceedsStock: boolean }[] = [];
  let hasAnyExceedingStock = false;

  for (const row of productRows) {
    const qty = parseLocaleNumber(row.soldQtyStr);
    if (qty > 0) {
      const lineTotal = Math.round(qty * row.unitPrice);
      totalSalesFC += lineTotal;

      // Check against house stock
      // If editing, add back what was originally sold in this entry
      const originalSold = saleToEdit?.items.find((it) => it.productId === row.productId)?.soldQty || 0;
      const currentHouseStock = (stockMap[row.productId] ?? 0) + originalSold;
      const exceeds = qty > currentHouseStock;
      if (exceeds) hasAnyExceedingStock = true;

      itemsWithQty.push({
        row,
        soldQty: qty,
        lineTotalFC: lineTotal,
        stock: currentHouseStock,
        exceedsStock: exceeds,
      });
    }
  }

  const commissionRateNum = parseLocaleNumber(commissionRateStr);
  const ownerCommissionFC = Math.round((totalSalesFC * commissionRateNum) / 100);
  const expenseReserveFC = Math.round((totalSalesFC * reserveRate) / 100);
  const ownerShareRate = Math.max(0, 100 - reserveRate - commissionRateNum);
  const ownerShareFC = Math.round((totalSalesFC * ownerShareRate) / 100);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!date.trim()) {
      setErrorMsg('Veuillez sélectionner une date valide.');
      return;
    }

    if (isNaN(commissionRateNum) || commissionRateNum < 0 || commissionRateNum > (100 - reserveRate)) {
      setErrorMsg(
        `La commission (%) doit être comprise entre 0 et ${100 - reserveRate} % (pour laisser la réserve de ${reserveRate} %).`
      );
      return;
    }

    if (itemsWithQty.length === 0) {
      setErrorMsg('Veuillez renseigner au moins une quantité vendue supérieure à 0.');
      return;
    }

    // Avertissement de dépassement de stock (sans bloquer)
    if (hasAnyExceedingStock && !stockWarningAcknowledged) {
      setStockWarningAcknowledged(true);
      return;
    }

    try {
      const saleItems: PersonalSaleItem[] = itemsWithQty.map((item) => ({
        productId: item.row.productId,
        productName: item.row.productName,
        unitPrice: item.row.unitPrice,
        soldQty: item.soldQty,
      }));

      const personalSaleData: PersonalSale = {
        id: saleToEdit ? saleToEdit.id : crypto.randomUUID(),
        date: date.trim(),
        items: saleItems,
        totalSalesFC,
        ownerCommissionRate: commissionRateNum,
        ownerCommissionFC,
        expenseReserveRate: reserveRate,
        expenseReserveFC,
        ownerShareRate,
        ownerShareFC,
        notes: notes.trim() || undefined,
        createdAt: saleToEdit ? saleToEdit.createdAt : Date.now(),
      };

      await db.personalSales.put(personalSaleData);
      onSaved();
      onClose();
    } catch (err: any) {
      console.error('Erreur enregistrement vente personnelle:', err);
      setErrorMsg('Erreur lors de l’enregistrement : ' + err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-teal-50 text-teal-700 flex items-center justify-center">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
                {saleToEdit ? 'Modifier la vente personnelle' : 'Nouvelle vente personnelle'}
              </h3>
              <p className="text-xs text-slate-500">
                Vente directe du gérant (sans vendeur/se)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {onOpenCalculator && (
              <button
                type="button"
                onClick={onOpenCalculator}
                className="p-2 rounded-xl text-slate-500 hover:text-teal-700 hover:bg-slate-100 min-h-[40px] min-w-[40px] flex items-center justify-center"
                title="Calculatrice"
              >
                <Calculator className="w-5 h-5" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 min-h-[40px] min-w-[40px] flex items-center justify-center"
              aria-label="Fermer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Warning banner if exceeding stock */}
          {hasAnyExceedingStock && (
            <div className={`p-3.5 rounded-2xl border flex items-start gap-2.5 text-xs ${
              stockWarningAcknowledged
                ? 'bg-amber-100 border-amber-300 text-amber-900 font-bold'
                : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}>
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-extrabold">
                  Attention : quantité supérieure au stock maison disponible !
                </p>
                <p className="text-[11px] font-normal leading-relaxed">
                  Certaines quantités vendues dépassent le stock actuellement disponible à la maison. Vous pouvez tout de même enregistrer si vous avez produit ou vendu en direct.
                </p>
                {stockWarningAcknowledged && (
                  <p className="text-[11px] font-extrabold text-amber-900 pt-1">
                    👉 Cliquez à nouveau sur &laquo; Enregistrer &raquo; ci-dessous pour confirmer et sauvegarder.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Date & Commission % */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Date *
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Ma commission (%)
              </label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={commissionRateStr}
                  onChange={(e) => setCommissionRateStr(e.target.value.replace(/[^0-9.,]/g, ''))}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 bg-white pr-7"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                  %
                </span>
              </div>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                Modifiable pour cette vente
              </span>
            </div>
          </div>

          {/* Product Rows */}
          <div className="space-y-2.5">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
              Quantités vendues par produit *
            </label>

            {activeProducts.length === 0 ? (
              <p className="text-xs text-slate-400 italic">Aucun produit actif configuré.</p>
            ) : (
              <div className="space-y-2">
                {productRows.map((row) => {
                  const qtyNum = parseLocaleNumber(row.soldQtyStr);
                  const originalSold = saleToEdit?.items.find((it) => it.productId === row.productId)?.soldQty || 0;
                  const availableStock = (stockMap[row.productId] ?? 0) + originalSold;
                  const isOverStock = qtyNum > availableStock;

                  return (
                    <div
                      key={row.productId}
                      className={`p-3 rounded-2xl border transition-all ${
                        isOverStock
                          ? 'bg-amber-50/60 border-amber-300'
                          : qtyNum > 0
                          ? 'bg-teal-50/40 border-teal-200'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <Package className="w-4 h-4 text-teal-700" />
                          <span className="text-xs font-extrabold text-slate-900">
                            {row.productName}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-right">
                          <span className="text-[11px] font-mono text-slate-500 font-bold">
                            {formatFC(row.unitPrice, currency)} / u
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600 font-mono">
                            Stock : {formatNumber(availableStock)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="Quantité vendue (ex : 15 ou 2,5)"
                            value={row.soldQtyStr}
                            onChange={(e) => handleRowChange(row.productId, e.target.value)}
                            className={`w-full px-3 py-2 rounded-xl border text-xs font-bold text-slate-900 bg-white ${
                              isOverStock ? 'border-amber-400 focus:ring-amber-400' : 'border-slate-200'
                            }`}
                          />
                        </div>

                        {qtyNum > 0 && (
                          <div className="text-right min-w-[90px] font-mono text-xs font-black text-teal-800">
                            = {formatFC(qtyNum * row.unitPrice, currency)}
                          </div>
                        )}
                      </div>

                      {isOverStock && (
                        <p className="text-[10px] font-bold text-amber-700 mt-1 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span>Dépasse le stock maison disponible ({formatNumber(availableStock)} en stock)</span>
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Live Calculations Breakdown */}
          <div className="bg-slate-50 rounded-2xl border border-slate-200/80 p-3.5 space-y-2.5">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 block">
              Calculs en direct
            </span>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                <span className="text-[10px] text-slate-500 block font-semibold">Total des ventes</span>
                <span className="text-sm font-extrabold text-slate-900 font-mono">
                  {formatFC(totalSalesFC, currency)}
                </span>
              </div>

              <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                <span className="text-[10px] text-teal-700 block font-semibold">
                  Part Caisse ({reserveRate} %)
                </span>
                <span className="text-sm font-extrabold text-teal-800 font-mono">
                  {formatFC(expenseReserveFC, currency)}
                </span>
              </div>

              <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                <span className="text-[10px] text-indigo-700 block font-semibold">
                  Ma commission vendeur ({formatNumber(commissionRateNum)} %)
                </span>
                <span className="text-sm font-extrabold text-indigo-800 font-mono">
                  {formatFC(ownerCommissionFC, currency)}
                </span>
              </div>

              <div className="bg-emerald-50/80 p-2.5 rounded-xl border border-emerald-200">
                <span className="text-[10px] text-emerald-800 block font-semibold">
                  Ma part gérant ({formatNumber(ownerShareRate)} %)
                </span>
                <span className="text-sm font-extrabold text-emerald-900 font-mono">
                  {formatFC(ownerShareFC, currency)}
                </span>
              </div>
            </div>

            <div className="pt-1 border-t border-slate-200/60 flex items-center justify-between text-xs">
              <span className="font-bold text-slate-700">Mon gain total direct :</span>
              <span className="font-extrabold font-mono text-emerald-800 text-sm">
                {formatFC(ownerCommissionFC + ownerShareFC, currency)}
              </span>
            </div>
          </div>

          {/* Notes facultatives */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Note facultative
            </label>
            <input
              type="text"
              placeholder="Ex : Vente au marché, client particulier..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-900 bg-white"
            />
          </div>

          {/* Footer Submit */}
          <div className="pt-2">
            <button
              type="submit"
              className={`w-full py-3 px-4 rounded-xl text-white text-xs font-extrabold shadow-xs active:scale-95 transition-all min-h-[46px] flex items-center justify-center gap-2 ${
                stockWarningAcknowledged
                  ? 'bg-amber-600 hover:bg-amber-700'
                  : 'bg-teal-700 hover:bg-teal-800'
              }`}
            >
              <Check className="w-4 h-4" />
              <span>
                {stockWarningAcknowledged
                  ? 'Confirmer et enregistrer malgré le stock'
                  : saleToEdit
                  ? 'Mettre à jour la vente personnelle'
                  : 'Enregistrer la vente personnelle'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
