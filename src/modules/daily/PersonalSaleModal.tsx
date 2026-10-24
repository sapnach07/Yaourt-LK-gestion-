import React, { useState, useEffect, useMemo } from 'react';
import { X, Check, AlertTriangle, Calculator, UserCheck, Package, Search, UserPlus, Clock } from 'lucide-react';
import { db } from '../../db/db';
import { toISODate, formatFC, parseLocaleNumber, formatNumber } from '../../utils/formatters';
import { findCustomerByNormalizedName } from '../../utils/debtCalculator';
import type { Product, PersonalSale, PersonalSaleItem, AppSettings, Customer } from '../../types';

interface PersonalSaleModalProps {
  isOpen: boolean;
  saleToEdit?: PersonalSale | null;
  alreadyPaidFC?: number;
  initialKind?: 'vente' | 'consommation';
  products: Product[];
  settings: AppSettings;
  stockMap: Record<string, number>; // houseStock per productId
  onClose: () => void;
  onSaved: (savedKind?: 'vente' | 'consommation') => void;
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
  alreadyPaidFC = 0,
  initialKind = 'vente',
  products,
  settings,
  stockMap,
  onClose,
  onSaved,
  onOpenCalculator,
}) => {
  const [kind, setKind] = useState<'vente' | 'consommation'>(initialKind);
  const [date, setDate] = useState(toISODate(new Date()));
  const [commissionRateStr, setCommissionRateStr] = useState('0');
  const defaultConsumptionPaidPct =
    settings.consumptionPaidPct !== undefined
      ? settings.consumptionPaidPct
      : (settings.expenseReservePct ?? 50);
  const [consumptionPaidPctStr, setConsumptionPaidPctStr] = useState(
    formatNumber(defaultConsumptionPaidPct)
  );
  const [productRows, setProductRows] = useState<ProductSaleRow[]>([]);
  const [openingDebtAmountStr, setOpeningDebtAmountStr] = useState('');
  const [notes, setNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [stockWarningAcknowledged, setStockWarningAcknowledged] = useState(false);

  // Paiement : 'paid' (par défaut) | 'credit'
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'credit'>('paid');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');

  const isEditing = Boolean(saleToEdit);
  const isOpeningDebtEdit = Boolean(saleToEdit?.isOpeningDebt);

  const activeProducts = products.filter((p) => p.isActive);
  const currency = settings.currency || 'FC';
  const reserveRate = settings.expenseReservePct ?? 50;

  const handleKindChange = (newKind: 'vente' | 'consommation') => {
    if (newKind === 'consommation') {
      if (alreadyPaidFC > 0) {
        setErrorMsg(
          'Impossible de transformer en consommation une vente qui a déjà reçu des paiements.'
        );
        return;
      }
      if (isOpeningDebtEdit) {
        setErrorMsg('Une ancienne dette ne peut pas être transformée en consommation.');
        return;
      }
      if (saleToEdit?.paymentStatus === 'credit') {
        setErrorMsg('Une vente enregistrée à crédit ne peut pas être transformée en consommation.');
        return;
      }
    }

    setKind(newKind);
    setErrorMsg('');
    if (newKind === 'consommation') {
      setPaymentStatus('paid');
    }
    if (newKind === 'vente' && (parseLocaleNumber(commissionRateStr) === 0 || !commissionRateStr.trim())) {
      if ((settings.ownerCommissionPct ?? 0) > 0) {
        setCommissionRateStr(formatNumber(settings.ownerCommissionPct ?? 0));
      }
    }
    if (newKind === 'consommation' && (!consumptionPaidPctStr.trim() || parseLocaleNumber(consumptionPaidPctStr) === 0)) {
      setConsumptionPaidPctStr(formatNumber(defaultConsumptionPaidPct));
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    setStockWarningAcknowledged(false);
    setErrorMsg('');
    setCustomerSearch('');
    setNewCustomerName('');
    setNewCustomerPhone('');

    db.customers
      .toArray()
      .then((list) => {
        const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
        setCustomers(sorted);
        if (!saleToEdit && sorted.length === 0) {
          setIsCreatingCustomer(true);
        }
      })
      .catch((err) => console.error('Erreur chargement clients:', err));

    if (saleToEdit) {
      setKind(saleToEdit.kind || 'vente');
      setDate(saleToEdit.date);
      setCommissionRateStr(formatNumber(saleToEdit.ownerCommissionRate));
      setNotes(saleToEdit.notes || '');
      setPaymentStatus(
        saleToEdit.kind !== 'consommation' && saleToEdit.paymentStatus === 'credit'
          ? 'credit'
          : 'paid'
      );
      setSelectedCustomerId(saleToEdit.customerId || '');
      setIsCreatingCustomer(false);
      setOpeningDebtAmountStr(
        saleToEdit.isOpeningDebt ? formatNumber(saleToEdit.totalSalesFC || 0) : ''
      );

      if (
        saleToEdit.consumptionPaidFC !== undefined &&
        saleToEdit.consumptionValueFC &&
        saleToEdit.consumptionValueFC > 0
      ) {
        setConsumptionPaidPctStr(
          formatNumber(
            Math.round(
              (saleToEdit.consumptionPaidFC * 100) / saleToEdit.consumptionValueFC
            )
          )
        );
      } else {
        setConsumptionPaidPctStr(formatNumber(defaultConsumptionPaidPct));
      }

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
      setKind(initialKind || 'vente');
      setDate(toISODate(new Date()));
      setCommissionRateStr(formatNumber(settings.ownerCommissionPct ?? 0));
      setConsumptionPaidPctStr(formatNumber(defaultConsumptionPaidPct));
      setNotes('');
      setPaymentStatus('paid');
      setSelectedCustomerId('');
      setIsCreatingCustomer(false);
      setOpeningDebtAmountStr('');

      const rows: ProductSaleRow[] = activeProducts.map((p) => ({
        productId: p.id,
        productName: p.name,
        unitPrice: p.defaultPrice,
        soldQtyStr: '',
      }));
      setProductRows(rows);
    }
  }, [isOpen, saleToEdit, initialKind, products, settings, defaultConsumptionPaidPct]);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLocaleLowerCase('fr');
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLocaleLowerCase('fr').includes(q) ||
        (c.phone || '').toLocaleLowerCase('fr').includes(q)
    );
  }, [customers, customerSearch]);

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

  if (isOpeningDebtEdit) {
    const parsedOd = parseLocaleNumber(openingDebtAmountStr);
    totalSalesFC = !isNaN(parsedOd) && parsedOd > 0 ? Math.round(parsedOd) : 0;
  } else {
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
  }

  const effectiveReserveRate = saleToEdit && !isOpeningDebtEdit
    ? (saleToEdit.expenseReserveRate ?? reserveRate)
    : reserveRate;

  const consumptionValueFC = totalSalesFC; // somme (quantité × prix unitaire)
  const consumptionPaidPctNum = parseLocaleNumber(consumptionPaidPctStr);
  const validConsumptionPaidPct = isNaN(consumptionPaidPctNum)
    ? 0
    : Math.max(0, Math.min(100, consumptionPaidPctNum));
  const consumptionPaidFC = Math.round((consumptionValueFC * validConsumptionPaidPct) / 100);

  const commissionRateNum = isOpeningDebtEdit ? 0 : parseLocaleNumber(commissionRateStr);
  const ownerCommissionFC = Math.round((totalSalesFC * commissionRateNum) / 100);
  const expenseReserveFC = Math.round((totalSalesFC * effectiveReserveRate) / 100);
  const ownerShareRate = Math.max(0, 100 - effectiveReserveRate - commissionRateNum);
  const ownerShareFC = Math.round((totalSalesFC * ownerShareRate) / 100);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!date.trim()) {
      setErrorMsg('Veuillez sélectionner une date valide.');
      return;
    }

    if (kind === 'consommation' && (alreadyPaidFC > 0 || saleToEdit?.paymentStatus === 'credit' || isOpeningDebtEdit)) {
      setErrorMsg(
        'Impossible de transformer en consommation une vente à crédit ou ayant déjà des paiements.'
      );
      return;
    }

    if (kind === 'vente') {
      if (isNaN(commissionRateNum) || commissionRateNum < 0 || commissionRateNum > (100 - effectiveReserveRate)) {
        setErrorMsg(
          `La commission (%) doit être comprise entre 0 et ${100 - effectiveReserveRate} % (pour laisser la réserve de ${effectiveReserveRate} %).`
        );
        return;
      }
    } else {
      if (isNaN(consumptionPaidPctNum) || consumptionPaidPctNum < 0 || consumptionPaidPctNum > 100) {
        setErrorMsg('La part payée (%) doit être comprise entre 0 et 100 %.');
        return;
      }
    }

    if (isOpeningDebtEdit) {
      if (totalSalesFC <= 0) {
        setErrorMsg('Veuillez entrer un montant supérieur à 0 FC.');
        return;
      }
    } else if (itemsWithQty.length === 0) {
      setErrorMsg('Veuillez renseigner au moins une quantité supérieure à 0.');
      return;
    }

    // Refuser de réduire le total en dessous de ce qui a déjà été payé
    if (kind === 'vente' && alreadyPaidFC > 0 && totalSalesFC < alreadyPaidFC) {
      setErrorMsg(
        `Impossible de réduire le total (${formatFC(totalSalesFC, currency)}) en dessous du montant déjà payé (${formatFC(alreadyPaidFC, currency)}).`
      );
      return;
    }

    const finalPaymentStatus: 'paid' | 'credit' | undefined =
      kind === 'consommation'
        ? undefined
        : saleToEdit
        ? saleToEdit.paymentStatus === 'credit'
          ? 'credit'
          : 'paid'
        : paymentStatus;

    let finalCustomer: Customer | null = null;
    let needsCustomerInsert = false;

    if (finalPaymentStatus === 'credit') {
      if (saleToEdit && alreadyPaidFC > 0 && saleToEdit.customerId) {
        finalCustomer =
          customers.find((c) => c.id === saleToEdit.customerId) || {
            id: saleToEdit.customerId,
            name: saleToEdit.customerName || 'Client',
            createdAt: saleToEdit.createdAt || Date.now(),
          };
      } else if (isCreatingCustomer) {
        const cleanName = newCustomerName.trim().replace(/\s+/g, ' ');
        if (!cleanName) {
          setErrorMsg('Veuillez saisir le nom du client pour cette vente à crédit.');
          return;
        }
        const duplicate = findCustomerByNormalizedName(customers, cleanName);
        if (duplicate) {
          setErrorMsg(
            `Un client nommé « ${duplicate.name} » existe déjà. Sélectionnez-le dans la liste.`
          );
          return;
        }
        finalCustomer = {
          id: crypto.randomUUID(),
          name: cleanName,
          phone: newCustomerPhone.trim() || undefined,
          createdAt: Date.now(),
        };
        needsCustomerInsert = true;
      } else {
        const found = customers.find((c) => c.id === selectedCustomerId);
        if (found) {
          finalCustomer = found;
        } else if (saleToEdit?.customerId && selectedCustomerId === saleToEdit.customerId) {
          finalCustomer = {
            id: saleToEdit.customerId,
            name: saleToEdit.customerName || 'Client',
            createdAt: saleToEdit.createdAt || Date.now(),
          };
        } else {
          setErrorMsg('Veuillez sélectionner un client ou créer un « Nouveau client ».');
          return;
        }
      }
    }

    // Avertissement de dépassement de stock (sans bloquer)
    if (!isOpeningDebtEdit && hasAnyExceedingStock && !stockWarningAcknowledged) {
      setStockWarningAcknowledged(true);
      return;
    }

    try {
      const saleItems: PersonalSaleItem[] = isOpeningDebtEdit
        ? []
        : itemsWithQty.map((item) => ({
            productId: item.row.productId,
            productName: item.row.productName,
            unitPrice: item.row.unitPrice,
            soldQty: item.soldQty,
          }));

      const isConsommation = kind === 'consommation';

      const prevWrittenOff = saleToEdit?.writtenOffFC
        ? Math.min(Math.max(0, totalSalesFC - alreadyPaidFC), Math.round(saleToEdit.writtenOffFC))
        : undefined;

      const personalSaleData: PersonalSale = {
        id: saleToEdit ? saleToEdit.id : crypto.randomUUID(),
        date: date.trim(),
        items: saleItems,
        totalSalesFC: isConsommation ? 0 : totalSalesFC,
        ownerCommissionRate: isConsommation ? 0 : commissionRateNum,
        ownerCommissionFC: isConsommation ? 0 : ownerCommissionFC,
        expenseReserveRate: isConsommation ? 0 : effectiveReserveRate,
        expenseReserveFC: isConsommation ? 0 : expenseReserveFC,
        ownerShareRate: isConsommation ? 0 : ownerShareRate,
        ownerShareFC: isConsommation ? 0 : ownerShareFC,
        kind,
        consumptionValueFC: isConsommation ? consumptionValueFC : 0,
        consumptionPaidFC: isConsommation ? consumptionPaidFC : 0,
        paymentStatus: isConsommation ? undefined : finalPaymentStatus,
        customerId: !isConsommation && finalPaymentStatus === 'credit' ? finalCustomer?.id : undefined,
        customerName: !isConsommation && finalPaymentStatus === 'credit' ? finalCustomer?.name : undefined,
        isOpeningDebt: saleToEdit?.isOpeningDebt || undefined,
        writtenOffFC: prevWrittenOff && prevWrittenOff > 0 ? prevWrittenOff : undefined,
        writtenOffAt: prevWrittenOff && prevWrittenOff > 0 ? saleToEdit?.writtenOffAt : undefined,
        notes: notes.trim() || undefined,
        createdAt: saleToEdit ? saleToEdit.createdAt : Date.now(),
      };

      await db.transaction('rw', [db.customers, db.personalSales], async () => {
        if (needsCustomerInsert && finalCustomer) {
          await db.customers.put(finalCustomer);
        }
        await db.personalSales.put(personalSaleData);
      });

      onSaved(kind);
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
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${
              kind === 'consommation' ? 'bg-amber-100 text-amber-800' : 'bg-teal-50 text-teal-700'
            }`}>
              {kind === 'consommation' ? (
                <span className="text-lg">🍽</span>
              ) : (
                <UserCheck className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
                {kind === 'consommation'
                  ? (saleToEdit ? 'Modifier la consommation' : 'Nouvelle consommation personnelle')
                  : (saleToEdit ? 'Modifier la vente personnelle' : 'Nouvelle vente personnelle')}
              </h3>
              <p className="text-xs text-slate-500">
                {kind === 'consommation'
                  ? 'Sortie de yaourts pour ma consommation (payée par mes bénéfices)'
                  : 'Vente directe du gérant (sans vendeur/se)'}
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
          {/* Choix à deux boutons : Vente à un client vs Pour ma consommation */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              {saleToEdit
                ? 'Type d’enregistrement (laisser en vente ou mettre en consommation)'
                : 'Type d’enregistrement'}
            </label>
            <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-2xl gap-1 border border-slate-200/60">
              <button
                type="button"
                onClick={() => handleKindChange('vente')}
                className={`py-2.5 px-3 text-xs font-bold rounded-xl transition-all min-h-[42px] flex items-center justify-center gap-1.5 ${
                  kind === 'vente'
                    ? 'bg-teal-700 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <UserCheck className="w-4 h-4" />
                <span>Vente à un client</span>
              </button>
              <button
                type="button"
                disabled={alreadyPaidFC > 0 || saleToEdit?.paymentStatus === 'credit' || isOpeningDebtEdit}
                onClick={() => handleKindChange('consommation')}
                className={`py-2.5 px-3 text-xs font-bold rounded-xl transition-all min-h-[42px] flex items-center justify-center gap-1.5 disabled:opacity-45 disabled:cursor-not-allowed ${
                  kind === 'consommation'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <span className="text-base">🍽</span>
                <span>Ma consommation</span>
              </button>
            </div>

            {/* Message explicatif en cas de modification */}
            {saleToEdit && (
              <div
                className={`p-2.5 rounded-xl border text-xs flex items-center gap-2 ${
                  kind === 'consommation'
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-teal-50 border-teal-200 text-teal-900'
                }`}
              >
                {kind === 'consommation' ? (
                  <>
                    <span className="text-base">🍽</span>
                    <div className="leading-snug">
                      <span className="font-bold">Enregistré comme consommation : </span>
                      <span>
                        payée par vos bénéfices ({formatFC(consumptionPaidFC, currency)}), déduite de vos bénéfices et versée à la réserve, sans commission.
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <UserCheck className="w-4 h-4 text-teal-700 shrink-0" />
                    <div className="leading-snug">
                      <span className="font-bold">Enregistré comme vente client : </span>
                      <span>
                        vente directe avec calcul de votre commission et part de réserve.
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

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
                  Certaines quantités dépassent le stock actuellement disponible à la maison. Vous pouvez tout de même enregistrer si vous avez produit ou vendu en direct.
                </p>
                {stockWarningAcknowledged && (
                  <p className="text-[11px] font-extrabold text-amber-900 pt-1">
                    👉 Cliquez à nouveau sur &laquo; Enregistrer &raquo; ci-dessous pour confirmer et sauvegarder.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Date & Commission % (masquée en mode consommation) */}
          {kind === 'consommation' ? (
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
          ) : (
            <div className="space-y-3">
              {/* Choix du mode de paiement : Payé maintenant vs À crédit */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Mode de règlement
                </label>
                <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-2xl gap-1 border border-slate-200/60">
                  <button
                    type="button"
                    disabled={isEditing}
                    onClick={() => {
                      if (!isEditing) {
                        setPaymentStatus('paid');
                        setErrorMsg('');
                      }
                    }}
                    className={`py-2 px-3 text-xs font-bold rounded-xl transition-all min-h-[40px] flex items-center justify-center gap-1.5 disabled:cursor-not-allowed ${
                      paymentStatus === 'paid'
                        ? 'bg-emerald-700 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 disabled:opacity-50'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Payé maintenant</span>
                  </button>
                  <button
                    type="button"
                    disabled={isEditing}
                    onClick={() => {
                      if (!isEditing) {
                        setPaymentStatus('credit');
                        if (customers.length === 0) setIsCreatingCustomer(true);
                        setErrorMsg('');
                      }
                    }}
                    className={`py-2 px-3 text-xs font-bold rounded-xl transition-all min-h-[40px] flex items-center justify-center gap-1.5 disabled:cursor-not-allowed ${
                      paymentStatus === 'credit'
                        ? 'bg-amber-600 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 disabled:opacity-50'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>À crédit</span>
                  </button>
                </div>

                {isEditing && (
                  <p className="text-[11px] text-slate-500">
                    Le mode de paiement ne peut pas être modifié ici (passez par l'écran Dettes pour les paiements).
                    {alreadyPaidFC > 0 && (
                      <span className="font-bold text-emerald-700">
                        {' '}Déjà payé : {formatFC(alreadyPaidFC, currency)}.
                      </span>
                    )}
                  </p>
                )}
              </div>

              {/* Sélection / création du client si À crédit */}
              {paymentStatus === 'credit' && (
                <div className="p-3 rounded-2xl bg-amber-50/60 border border-amber-200 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-extrabold text-amber-950">
                      Client à crédit *
                    </label>
                    {!(isEditing && alreadyPaidFC > 0) && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsCreatingCustomer((prev) => !prev);
                          setErrorMsg('');
                        }}
                        className="text-xs font-bold text-teal-800 hover:text-teal-950 inline-flex items-center gap-1"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>
                          {isCreatingCustomer ? 'Choisir dans la liste' : '+ Nouveau client'}
                        </span>
                      </button>
                    )}
                  </div>

                  {isEditing && alreadyPaidFC > 0 ? (
                    <div className="p-2.5 rounded-xl bg-white border border-amber-200 text-xs font-bold text-slate-800">
                      Client : {saleToEdit?.customerName || 'Client'} (verrouillé car un paiement a déjà été reçu)
                    </div>
                  ) : isCreatingCustomer ? (
                    <div className="space-y-2 bg-white p-2.5 rounded-xl border border-amber-200">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          Nom du client *
                        </label>
                        <input
                          type="text"
                          placeholder="Ex : Papa Jean"
                          value={newCustomerName}
                          onChange={(e) => {
                            setNewCustomerName(e.target.value);
                            setErrorMsg('');
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
                          placeholder="Ex : 081..."
                          value={newCustomerPhone}
                          onChange={(e) => setNewCustomerPhone(e.target.value)}
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
                          value={customerSearch}
                          onChange={(e) => setCustomerSearch(e.target.value)}
                          className="w-full pl-8 pr-3 py-2 rounded-xl border border-amber-200 text-xs font-semibold text-slate-900 bg-white"
                        />
                      </div>
                      <div className="max-h-36 overflow-y-auto rounded-xl border border-amber-200/80 divide-y divide-slate-100 bg-white">
                        {filteredCustomers.length === 0 ? (
                          <div className="p-2.5 text-center text-xs text-slate-400">
                            Aucun client trouvé. Cliquez sur « + Nouveau client ».
                          </div>
                        ) : (
                          filteredCustomers.map((c) => {
                            const isSelected = c.id === selectedCustomerId;
                            return (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => {
                                  setSelectedCustomerId(c.id);
                                  setErrorMsg('');
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

                  <p className="text-[10px] text-amber-900 leading-snug">
                    Le stock baisse immédiatement. L'argent n'entrera dans les caisses qu'au fur et à mesure des paiements du client.
                  </p>
                </div>
              )}

              <div className={isOpeningDebtEdit ? '' : 'grid grid-cols-2 gap-3'}>
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

                {!isOpeningDebtEdit && (
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
                )}
              </div>
            </div>
          )}

          {/* Product Rows or Opening Debt Amount */}
          {isOpeningDebtEdit ? (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Montant de l'ancienne dette ({currency}) *
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={openingDebtAmountStr}
                onChange={(e) => setOpeningDebtAmountStr(e.target.value.replace(/[^0-9.,]/g, ''))}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-extrabold font-mono text-slate-900 bg-white"
              />
            </div>
          ) : (
          <div className="space-y-2.5">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
              {kind === 'consommation'
                ? 'Quantités consommées par produit *'
                : 'Quantités vendues par produit *'}
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
                          ? kind === 'consommation'
                            ? 'bg-amber-50/40 border-amber-200'
                            : 'bg-teal-50/40 border-teal-200'
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
                            placeholder={
                              kind === 'consommation'
                                ? 'Quantité consommée (ex : 2)'
                                : 'Quantité vendue (ex : 15 ou 2,5)'
                            }
                            value={row.soldQtyStr}
                            onChange={(e) => handleRowChange(row.productId, e.target.value)}
                            className={`w-full px-3 py-2 rounded-xl border text-xs font-bold text-slate-900 bg-white ${
                              isOverStock ? 'border-amber-400 focus:ring-amber-400' : 'border-slate-200'
                            }`}
                          />
                        </div>

                        {qtyNum > 0 && (
                          <div className={`text-right min-w-[90px] font-mono text-xs font-black ${
                            kind === 'consommation' ? 'text-amber-900' : 'text-teal-800'
                          }`}>
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
          )}

          {/* Live Calculations Breakdown */}
          {kind === 'consommation' ? (
            <div className="bg-amber-50/90 rounded-2xl border border-amber-200 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs font-bold text-amber-950 pb-2 border-b border-amber-200/80">
                <span>Valeur au prix complet :</span>
                <span className="font-mono text-sm font-black text-amber-950">
                  {formatFC(consumptionValueFC, currency)}
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-amber-900 mb-1">
                  Part payée (%)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={consumptionPaidPctStr}
                    onChange={(e) => {
                      setConsumptionPaidPctStr(e.target.value.replace(/[^0-9.,]/g, ''));
                      setErrorMsg('');
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-amber-300 text-xs font-bold text-slate-900 bg-white pr-7 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    placeholder="50"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-amber-700">
                    %
                  </span>
                </div>
                <p className="text-[10px] text-amber-800 mt-1">
                  Par défaut égale à la part de la Réserve : je ne paie que le coût, pas ma propre marge.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                <div className="bg-white p-2.5 rounded-xl border border-amber-200 shadow-xs">
                  <span className="text-[10px] text-amber-800 block font-semibold">
                    Payé par mes bénéfices :
                  </span>
                  <span className="text-sm font-black text-amber-950 font-mono">
                    {formatFC(consumptionPaidFC, currency)}
                  </span>
                </div>

                <div className="bg-white p-2.5 rounded-xl border border-amber-200 shadow-xs">
                  <span className="text-[10px] text-teal-800 block font-semibold">
                    Reçu par la Caisse Réserve :
                  </span>
                  <span className="text-sm font-black text-teal-900 font-mono">
                    {formatFC(consumptionPaidFC, currency)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
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
          )}

          {/* Notes facultatives */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Note facultative
            </label>
            <input
              type="text"
              placeholder={
                kind === 'consommation'
                  ? 'Ex : Goûter maison, dégustation, famille...'
                  : 'Ex : Vente au marché, client particulier...'
              }
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
                  : kind === 'consommation'
                  ? 'bg-amber-700 hover:bg-amber-800'
                  : 'bg-teal-700 hover:bg-teal-800'
              }`}
            >
              <Check className="w-4 h-4" />
              <span>
                {stockWarningAcknowledged
                  ? 'Confirmer et enregistrer malgré le stock'
                  : saleToEdit
                  ? kind === 'consommation'
                    ? saleToEdit.kind === 'consommation'
                      ? 'Mettre à jour la consommation'
                      : 'Enregistrer comme consommation'
                    : saleToEdit.kind === 'consommation'
                    ? 'Convertir en vente client'
                    : 'Mettre à jour la vente client'
                  : kind === 'consommation'
                  ? 'Enregistrer la consommation'
                  : 'Enregistrer la vente personnelle'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
