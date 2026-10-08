import React, { useState, useEffect } from 'react';
import {
  ClipboardEdit,
  Plus,
  Package,
  Calendar,
  AlertTriangle,
  Edit2,
  Trash2,
  Warehouse,
  Users,
} from 'lucide-react';
import { db } from '../../db/db';
import { formatDate, formatFC, toISODate } from '../../utils/formatters';
import { DailyEntryModal } from './DailyEntryModal';
import { ProductionStockModal } from './ProductionStockModal';
import { ConfirmModal } from '../../components/ConfirmModal';
import { EmptyState } from '../../components/EmptyState';
import type {
  DailyEntry,
  ProductionEntry,
  Employee,
  Product,
  AppSettings,
} from '../../types';

interface DailyEntryViewProps {
  settings: AppSettings;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
  onOpenCalculator?: () => void;
}

export const DailyEntryView: React.FC<DailyEntryViewProps> = ({
  settings,
  onShowToast,
  onOpenCalculator,
}) => {
  const [subTab, setSubTab] = useState<'sales' | 'production'>('sales');

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [dailyEntries, setDailyEntries] = useState<DailyEntry[]>([]);
  const [productionEntries, setProductionEntries] = useState<ProductionEntry[]>([]);

  // Filters for sales
  const [filterEmployeeId, setFilterEmployeeId] = useState<string>('all');
  const [filterDate, setFilterDate] = useState<string>('');

  // Modals
  const [isDailyModalOpen, setIsDailyModalOpen] = useState(false);
  const [entryToEdit, setEntryToEdit] = useState<DailyEntry | null>(null);

  const [isProdModalOpen, setIsProdModalOpen] = useState(false);
  const [prodToEdit, setProdToEdit] = useState<ProductionEntry | null>(null);

  const [entryToDelete, setEntryToDelete] = useState<DailyEntry | null>(null);
  const [prodToDelete, setProdToDelete] = useState<ProductionEntry | null>(null);

  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    const [emps, prods, dEntries, pEntries] = await Promise.all([
      db.employees.toArray(),
      db.products.orderBy('sortOrder').toArray(),
      db.dailyEntries.orderBy('date').reverse().toArray(),
      db.productionEntries.orderBy('date').reverse().toArray(),
    ]);

    setEmployees(emps);
    setProducts(prods);
    setDailyEntries(dEntries);
    setProductionEntries(pEntries);
  };

  // Stock calculations
  // House stock per product: total produced - total delivered to employees
  const stockData = products.map((prod) => {
    let totalProduced = 0;
    for (const p of productionEntries) {
      const item = p.items.find((i) => i.productId === prod.id);
      if (item) totalProduced += item.producedQty || 0;
    }

    let totalDelivered = 0;
    for (const d of dailyEntries) {
      const item = d.items.find((i) => i.productId === prod.id);
      if (item) totalDelivered += item.delivered || 0;
    }

    const houseStock = totalProduced - totalDelivered;

    // Current stock held by all active employees (latest rest)
    let totalEmployeesRest = 0;
    employees
      .filter((e) => !e.isArchived)
      .forEach((emp) => {
        // find latest entry for this employee
        const empEntries = dailyEntries.filter((e) => e.employeeId === emp.id);
        if (empEntries.length > 0) {
          const latest = empEntries[0]; // already reversed by date
          const it = latest.items.find((i) => i.productId === prod.id);
          if (it) totalEmployeesRest += it.rest || 0;
        }
      });

    return {
      product: prod,
      totalProduced,
      totalDelivered,
      houseStock,
      totalEmployeesRest,
    };
  });

  const handleDeleteDailyEntry = async () => {
    if (!entryToDelete) return;
    try {
      await db.dailyEntries.delete(entryToDelete.id);
      onShowToast('info', 'Saisie de vente supprimée avec succès.');
      setEntryToDelete(null);
      await loadAllData();
    } catch (e: any) {
      onShowToast('error', 'Erreur lors de la suppression : ' + e.message);
    }
  };

  const handleDeleteProdEntry = async () => {
    if (!prodToDelete) return;
    try {
      await db.productionEntries.delete(prodToDelete.id);
      onShowToast('info', 'Saisie de production supprimée avec succès.');
      setProdToDelete(null);
      await loadAllData();
    } catch (e: any) {
      onShowToast('error', 'Erreur lors de la suppression : ' + e.message);
    }
  };

  // Filtered sales entries
  const filteredDailyEntries = dailyEntries.filter((entry) => {
    if (filterEmployeeId !== 'all' && entry.employeeId !== filterEmployeeId) return false;
    if (filterDate && entry.date !== filterDate) return false;
    return true;
  });

  const currency = settings.currency || 'FC';

  return (
    <div className="pb-24 pt-3 px-4 max-w-lg mx-auto space-y-4">
      {/* Top Header & Sub-Tabs */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">
            Saisies & Stocks
          </h2>
          <p className="text-xs text-slate-500">
            Enregistrement des ventes, productions et inventaire
          </p>
        </div>

        {subTab === 'sales' ? (
          <button
            type="button"
            onClick={() => {
              setEntryToEdit(null);
              setIsDailyModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold shadow-xs active:scale-95 transition-all min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            <span>Nouvelle saisie</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setProdToEdit(null);
              setIsProdModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold shadow-xs active:scale-95 transition-all min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            <span>Production</span>
          </button>
        )}
      </div>

      {/* Sub-tab Navigation */}
      <div className="flex items-center p-1 bg-slate-200/70 rounded-2xl">
        <button
          type="button"
          onClick={() => setSubTab('sales')}
          className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all min-h-[38px] ${
            subTab === 'sales'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Ventes du jour ({dailyEntries.length})
        </button>
        <button
          type="button"
          onClick={() => setSubTab('production')}
          className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all min-h-[38px] ${
            subTab === 'production'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Production & Stocks ({productionEntries.length})
        </button>
      </div>

      {/* SUB-TAB 1: SALES ENTRIES */}
      {subTab === 'sales' && (
        <div className="space-y-3">
          {/* Filter Bar */}
          <div className="p-3 bg-white rounded-2xl border border-slate-200/80 shadow-xs flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[130px]">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Employée
              </label>
              <select
                value={filterEmployeeId}
                onChange={(e) => setFilterEmployeeId(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-white"
              >
                <option value="all">Toutes les employées</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1 min-w-[120px]">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Date
              </label>
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-white"
              />
            </div>

            {filterDate && (
              <button
                type="button"
                onClick={() => setFilterDate('')}
                className="text-xs font-bold text-teal-700 hover:underline self-end pb-2 min-h-[36px] flex items-center"
              >
                Effacer date
              </button>
            )}
          </div>

          {/* List of Entries */}
          {filteredDailyEntries.length === 0 ? (
            <EmptyState
              icon={<ClipboardEdit className="w-7 h-7 text-teal-700" />}
              title="Aucune saisie de vente enregistrée"
              description="Créez votre première saisie journalière pour calculer automatiquement les ventes, les restes et la commission de l’employée."
              actionLabel="Nouvelle saisie"
              onAction={() => {
                setEntryToEdit(null);
                setIsDailyModalOpen(true);
              }}
            />
          ) : (
            <div className="space-y-3">
              {filteredDailyEntries.map((entry) => {
                const totalSoldQty = entry.items.reduce((acc, i) => acc + i.sold, 0);
                const totalDamagedQty = entry.items.reduce((acc, i) => acc + i.damaged, 0);

                return (
                  <div
                    key={entry.id}
                    className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col gap-3"
                  >
                    {/* Top Row: Date, Employee, Commission % */}
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-extrabold text-slate-900">
                            {formatDate(entry.date)}
                          </span>
                          <span className="text-xs font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded-lg border border-teal-200/50">
                            {entry.employeeName}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 font-mono">
                          <span>Commission : {entry.employeeCommissionRate} %</span>
                          <span>·</span>
                          <span>{totalSoldQty} vendus</span>
                          {totalDamagedQty > 0 && (
                            <>
                              <span>·</span>
                              <span className="text-rose-600 font-bold">
                                {totalDamagedQty} abîmés
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEntryToEdit(entry);
                            setIsDailyModalOpen(true);
                          }}
                          className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 min-w-[40px] min-h-[40px] flex items-center justify-center"
                          title="Modifier"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEntryToDelete(entry)}
                          className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-slate-100 min-w-[40px] min-h-[40px] flex items-center justify-center"
                          title="Supprimer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Products details pill grid */}
                    <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-200/60 divide-y divide-slate-200/60 text-xs">
                      {entry.items.map((item) => (
                        <div
                          key={item.productId}
                          className="py-1 first:pt-0 last:pb-0 flex items-center justify-between"
                        >
                          <span className="font-semibold text-slate-800">
                            {item.productName}
                          </span>
                          <div className="flex items-center gap-3 font-mono text-[11px]">
                            <span className="text-slate-500">
                              Livr : <strong className="text-slate-700">{item.delivered}</strong>
                            </span>
                            <span className="text-emerald-700 font-bold">
                              Vendu : {item.sold}
                            </span>
                            <span className="text-slate-600">
                              Reste : <strong className="text-teal-800">{item.rest}</strong>
                            </span>
                            {item.damaged > 0 && (
                              <span className="text-rose-600 font-bold">
                                Perte : {item.damaged}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Financial summary row */}
                    <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-100 text-center">
                      <div className="bg-slate-50 p-2 rounded-xl">
                        <span className="text-[10px] text-slate-500 block font-semibold">
                          Total Ventes
                        </span>
                        <span className="text-xs font-extrabold text-slate-900 font-mono">
                          {formatFC(entry.totalSalesFC, currency)}
                        </span>
                      </div>
                      <div className="bg-teal-50/70 p-2 rounded-xl">
                        <span className="text-[10px] text-teal-700 block font-semibold">
                          Commission
                        </span>
                        <span className="text-xs font-extrabold text-teal-800 font-mono">
                          {formatFC(entry.employeeCommissionFC, currency)}
                        </span>
                      </div>
                      <div className="bg-emerald-50/70 p-2 rounded-xl">
                        <span className="text-[10px] text-emerald-700 block font-semibold">
                          Part Gérant
                        </span>
                        <span className="text-xs font-extrabold text-emerald-800 font-mono">
                          {formatFC(entry.ownerShareFC, currency)}
                        </span>
                      </div>
                    </div>

                    {entry.notes && (
                      <p className="text-xs text-slate-500 italic bg-slate-50 p-2 rounded-lg">
                        Note : {entry.notes}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: PRODUCTION & STOCK */}
      {subTab === 'production' && (
        <div className="space-y-4">
          {/* Stock Dashboard Cards */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Warehouse className="w-4 h-4 text-teal-700" />
              <span>État des stocks en temps réel</span>
            </h3>

            <div className="grid grid-cols-1 gap-2.5">
              {stockData.map((item) => {
                const isHouseNegative = item.houseStock < 0;
                const isHouseLow = item.houseStock >= 0 && item.houseStock <= 10;

                return (
                  <div
                    key={item.product.id}
                    className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center">
                          <Package className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-slate-900 leading-tight">
                            {item.product.name}
                          </h4>
                          <span className="text-[11px] text-slate-500 font-mono">
                            Prix : {formatFC(item.product.defaultPrice, currency)}
                          </span>
                        </div>
                      </div>

                      {/* House stock badge */}
                      <div className="text-right">
                        <span className="text-[10px] uppercase font-bold text-slate-500 block">
                          Stock maison
                        </span>
                        <span
                          className={`text-base font-extrabold font-mono inline-flex items-center gap-1 ${
                            isHouseNegative
                              ? 'text-rose-600'
                              : isHouseLow
                              ? 'text-amber-600'
                              : 'text-emerald-700'
                          }`}
                        >
                          {isHouseNegative && <AlertTriangle className="w-4 h-4" />}
                          {item.houseStock}
                        </span>
                      </div>
                    </div>

                    {/* Stock Details */}
                    <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-xl text-center text-xs">
                      <div>
                        <span className="text-[10px] text-slate-500 block">Total Produit</span>
                        <span className="font-bold text-slate-800 font-mono">
                          {item.totalProduced}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">Total Livré</span>
                        <span className="font-bold text-slate-800 font-mono">
                          {item.totalDelivered}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">Chez employées</span>
                        <span className="font-bold text-teal-800 font-mono">
                          {item.totalEmployeesRest}
                        </span>
                      </div>
                    </div>

                    {isHouseNegative && (
                      <div className="mt-2.5 p-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>
                          Alerte : Stock maison négatif ({item.houseStock}) ! Enregistrez la production réalisée.
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Production History List */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                Historique des productions ({productionEntries.length})
              </h3>
            </div>

            {productionEntries.length === 0 ? (
              <EmptyState
                icon={<Package className="w-7 h-7 text-teal-700" />}
                title="Aucune production enregistrée"
                description="Saisissez votre première fournée de yaourts pour alimenter le stock disponible à la maison."
                actionLabel="Enregistrer une production"
                onAction={() => {
                  setProdToEdit(null);
                  setIsProdModalOpen(true);
                }}
              />
            ) : (
              <div className="space-y-2.5">
                {productionEntries.map((prod) => {
                  const totalProduced = prod.items.reduce((acc, i) => acc + i.producedQty, 0);

                  return (
                    <div
                      key={prod.id}
                      className="bg-white rounded-2xl border border-slate-200/80 p-3.5 shadow-xs flex items-center justify-between gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-xs font-bold text-slate-900">
                            {formatDate(prod.date)}
                          </span>
                          <span className="text-xs font-extrabold text-teal-700 font-mono bg-teal-50 px-2 py-0.5 rounded-md">
                            {totalProduced} unités
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-2 mt-1.5 text-xs text-slate-600 font-mono">
                          {prod.items.map((i) => (
                            <span key={i.productId}>
                              {i.productName} : <strong>{i.producedQty}</strong>
                            </span>
                          ))}
                        </div>

                        {prod.notes && (
                          <p className="text-[11px] text-slate-400 italic mt-1">
                            {prod.notes}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setProdToEdit(prod);
                            setIsProdModalOpen(true);
                          }}
                          className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 min-w-[36px] min-h-[36px] flex items-center justify-center"
                          title="Modifier"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setProdToDelete(prod)}
                          className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-slate-100 min-w-[36px] min-h-[36px] flex items-center justify-center"
                          title="Supprimer"
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
        </div>
      )}

      {/* Daily Entry Modal */}
      <DailyEntryModal
        isOpen={isDailyModalOpen}
        entryToEdit={entryToEdit}
        employees={employees}
        products={products}
        settings={settings}
        onClose={() => {
          setIsDailyModalOpen(false);
          setEntryToEdit(null);
        }}
        onSaved={async () => {
          onShowToast('success', 'Saisie journalière enregistrée.');
          await loadAllData();
        }}
        onOpenCalculator={onOpenCalculator}
      />

      {/* Production Modal */}
      <ProductionStockModal
        isOpen={isProdModalOpen}
        entryToEdit={prodToEdit}
        products={products}
        onClose={() => {
          setIsProdModalOpen(false);
          setProdToEdit(null);
        }}
        onSaved={async () => {
          onShowToast('success', 'Production enregistrée.');
          await loadAllData();
        }}
      />

      {/* Delete Daily Entry Confirm */}
      <ConfirmModal
        isOpen={Boolean(entryToDelete)}
        title="Supprimer cette saisie journalière ?"
        message={`Voulez-vous supprimer la saisie du ${formatDate(
          entryToDelete?.date
        )} pour ${entryToDelete?.employeeName} ? Cette action est irréversible.`}
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        isDanger={true}
        onConfirm={handleDeleteDailyEntry}
        onCancel={() => setEntryToDelete(null)}
      />

      {/* Delete Production Confirm */}
      <ConfirmModal
        isOpen={Boolean(prodToDelete)}
        title="Supprimer cette production ?"
        message={`Voulez-vous supprimer la production du ${formatDate(
          prodToDelete?.date
        )} ? Les stocks à la maison seront recalculés automatiquement.`}
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        isDanger={true}
        onConfirm={handleDeleteProdEntry}
        onCancel={() => setProdToDelete(null)}
      />
    </div>
  );
};
