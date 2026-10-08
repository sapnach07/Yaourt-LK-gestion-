import React, { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import { db } from '../../db/db';
import { toISODate, parseLocaleNumber, formatNumber } from '../../utils/formatters';
import type { Product, ProductionEntry, ProductionItem } from '../../types';

interface ProductionStockModalProps {
  isOpen: boolean;
  entryToEdit?: ProductionEntry | null;
  products: Product[];
  onClose: () => void;
  onSaved: () => void;
}

export const ProductionStockModal: React.FC<ProductionStockModalProps> = ({
  isOpen,
  entryToEdit,
  products,
  onClose,
  onSaved,
}) => {
  const [date, setDate] = useState(toISODate(new Date()));
  const [items, setItems] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const activeProducts = products.filter((p) => p.isActive);

  useEffect(() => {
    if (!isOpen) return;

    if (entryToEdit) {
      setDate(entryToEdit.date);
      setNotes(entryToEdit.notes || '');
      const stateObj: Record<string, string> = {};
      entryToEdit.items.forEach((item) => {
        stateObj[item.productId] = item.producedQty > 0 ? formatNumber(item.producedQty) : '';
      });
      setItems(stateObj);
    } else {
      setDate(toISODate(new Date()));
      setNotes('');
      const stateObj: Record<string, string> = {};
      activeProducts.forEach((p) => {
        stateObj[p.id] = '';
      });
      setItems(stateObj);
    }
  }, [isOpen, entryToEdit]);

  if (!isOpen) return null;

  const handleQtyChange = (productId: string, val: string) => {
    const sanitized = val.replace(/[^0-9.,]/g, '');
    setItems((prev) => ({
      ...prev,
      [productId]: sanitized,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const productionItems: ProductionItem[] = activeProducts.map((p) => ({
      productId: p.id,
      productName: p.name,
      producedQty: parseLocaleNumber(items[p.id]),
    }));

    const totalProduced = productionItems.reduce((acc, i) => acc + i.producedQty, 0);
    if (totalProduced <= 0) {
      setErrorMsg('Veuillez saisir au moins une quantité produite supérieure à 0.');
      return;
    }

    const newEntry: ProductionEntry = {
      id: entryToEdit ? entryToEdit.id : 'prod_entry_' + Date.now().toString(),
      date,
      items: productionItems,
      notes: notes.trim() || undefined,
      createdAt: entryToEdit ? entryToEdit.createdAt : Date.now(),
    };

    try {
      await db.productionEntries.put(newEntry);
      onSaved();
      onClose();
    } catch (err: any) {
      setErrorMsg('Erreur lors de l’enregistrement de la production : ' + err.message);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 flex flex-col overflow-hidden max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50/70">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {entryToEdit ? 'Modifier la Production' : 'Enregistrer la Production'}
            </h2>
            <p className="text-xs text-slate-500 font-medium">
              Yaourts fabriqués à la maison (virgules acceptées, ex : 11,5)
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

        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
              {errorMsg}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Date de production *
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div className="space-y-2.5">
            <label className="block text-xs font-bold text-slate-700">
              Quantités produites par produit (ex : 11,5)
            </label>
            {activeProducts.map((prod) => (
              <div
                key={prod.id}
                className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 border border-slate-200"
              >
                <div>
                  <span className="text-sm font-bold text-slate-900 block">{prod.name}</span>
                  <span className="text-xs text-slate-500">Unité</span>
                </div>
                <div className="w-32">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={items[prod.id] || ''}
                    onChange={(e) => handleQtyChange(prod.id, e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-base font-bold font-mono text-center text-slate-900 bg-white focus:ring-2 focus:ring-teal-500"
                  />
                </div>
              </div>
            ))}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Notes / Lot (optionnel)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex : Fabrication du matin, 25L de lait"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div className="pt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 min-h-[44px]"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="flex-1 py-3 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold shadow-xs active:scale-95 transition-all flex items-center justify-center gap-1.5 min-h-[44px]"
            >
              <Check className="w-4 h-4" />
              <span>{entryToEdit ? 'Mettre à jour' : 'Enregistrer la production'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
