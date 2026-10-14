import React, { useState } from 'react';
import {
  X,
  CalendarCheck,
  ChevronDown,
  ChevronUp,
  Package,
  ArrowRight,
  CheckCircle2,
  Clock,
  Warehouse,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
} from 'lucide-react';
import { formatNumber, formatDate, formatFC } from '../../utils/formatters';
import type { MonthlyStockClosure } from '../../utils/stockCalculator';

interface MonthlyStockClosureModalProps {
  isOpen: boolean;
  onClose: () => void;
  closures: MonthlyStockClosure[];
  currency: string;
  onSelectMonth?: (month: string) => void;
}

export const MonthlyStockClosureModal: React.FC<MonthlyStockClosureModalProps> = ({
  isOpen,
  onClose,
  closures,
  currency,
  onSelectMonth,
}) => {
  const [expandedMonth, setExpandedMonth] = useState<string | null>(
    closures[0]?.month || null
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-teal-900 via-teal-800 to-slate-900 text-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/10 backdrop-blur-md flex items-center justify-center text-teal-300">
              <CalendarCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-tight flex items-center gap-2">
                Clôtures mensuelles des stocks
              </h2>
              <p className="text-xs text-teal-200/80">
                Bilan et clôture des stocks mois par mois — aucun mélange entre les mois
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-teal-200 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content list */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 bg-slate-50/60">
          {closures.length === 0 ? (
            <div className="p-8 text-center text-slate-400 bg-white rounded-2xl border border-slate-200">
              Aucune activité enregistrée.
            </div>
          ) : (
            closures.map((closure) => {
              const isExpanded = expandedMonth === closure.month;
              const isPositiveChange = closure.totals.netChange >= 0;

              return (
                <div
                  key={closure.month}
                  className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden transition-all"
                >
                  {/* Month summary card header */}
                  <div
                    className="p-4 cursor-pointer hover:bg-slate-50/80 transition-colors"
                    onClick={() => setExpandedMonth(isExpanded ? null : closure.month)}
                  >
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center font-black text-xs font-mono">
                          {closure.month.split('-')[1]}
                        </div>
                        <div>
                          <h3 className="text-sm sm:text-base font-extrabold text-slate-900">
                            {closure.monthLabel}
                          </h3>
                          <span className="text-[11px] text-slate-500 font-mono">
                            Du {formatDate(closure.startDate)} au {formatDate(closure.endDate)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {closure.isClosed ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Mois clôturé
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-amber-50 text-amber-700 border border-amber-200 text-[11px] font-bold">
                            <Clock className="w-3.5 h-3.5" />
                            Mois en cours (provisoire)
                          </span>
                        )}

                        <button
                          type="button"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700"
                        >
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* High-level KPI pill row */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-3 border-t border-slate-100 text-xs">
                      <div className="bg-slate-50 p-2.5 rounded-xl">
                        <span className="text-[10px] text-slate-500 uppercase font-semibold block truncate">
                          Stock au 1er du mois
                        </span>
                        <span className="text-sm font-extrabold font-mono text-slate-800">
                          {formatNumber(closure.totals.initialStock)}
                        </span>
                      </div>

                      <div className="bg-teal-50/70 p-2.5 rounded-xl border border-teal-100">
                        <span className="text-[10px] text-teal-800 uppercase font-semibold block truncate">
                          Produits + Retours
                        </span>
                        <span className="text-sm font-extrabold font-mono text-teal-900">
                          +{formatNumber(closure.totals.produced + closure.totals.rest)}
                        </span>
                        <span className="text-[9px] text-teal-700 block truncate">
                          {formatNumber(closure.totals.produced)} p. + {formatNumber(closure.totals.rest)} restes
                        </span>
                      </div>

                      <div className="bg-sky-50/70 p-2.5 rounded-xl border border-sky-100">
                        <span className="text-[10px] text-sky-800 uppercase font-semibold block truncate">
                          Livrés + Ventes directes
                        </span>
                        <span className="text-sm font-extrabold font-mono text-sky-900">
                          -{formatNumber(closure.totals.delivered + closure.totals.soldOwner)}
                        </span>
                        <span className="text-[9px] text-sky-700 block truncate">
                          {formatNumber(closure.totals.delivered)} liv. + {formatNumber(closure.totals.soldOwner)} moi
                        </span>
                      </div>

                      <div className="bg-slate-900 text-white p-2.5 rounded-xl shadow-xs">
                        <span className="text-[10px] text-slate-300 uppercase font-bold block truncate">
                          Stock Clôture
                        </span>
                        <span
                          className={`text-sm sm:text-base font-black font-mono ${
                            closure.totals.closingStock < 0
                              ? 'text-rose-400'
                              : 'text-teal-300'
                          }`}
                        >
                          {formatNumber(closure.totals.closingStock)}
                        </span>
                        <span className="text-[9px] text-slate-400 block truncate">
                          Flux net : {isPositiveChange ? '+' : ''}
                          {formatNumber(closure.totals.netChange)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Product Breakdown */}
                  {isExpanded && (
                    <div className="p-4 pt-1 bg-slate-50/80 border-t border-slate-100 space-y-3 animate-in fade-in duration-150">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-black uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                          <Package className="w-3.5 h-3.5 text-teal-700" />
                          Détail par produit pour {closure.monthLabel}
                        </h4>

                        {onSelectMonth && (
                          <button
                            type="button"
                            onClick={() => onSelectMonth(closure.month)}
                            className="inline-flex items-center gap-1 text-xs font-bold text-teal-700 hover:text-teal-900 bg-white px-2.5 py-1 rounded-lg border border-teal-200 shadow-2xs hover:bg-teal-50"
                          >
                            <span>Inspecter ce mois</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Responsive Table / Card View */}
                      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-slate-100 text-[10px] uppercase font-extrabold text-slate-600 border-b border-slate-200">
                              <th className="py-2.5 px-3">Produit</th>
                              <th className="py-2.5 px-2 text-right">Stock 1er</th>
                              <th className="py-2.5 px-2 text-right text-teal-700">Produit</th>
                              <th className="py-2.5 px-2 text-right text-sky-700">Livré</th>
                              <th className="py-2.5 px-2 text-right text-indigo-700">Vendu moi</th>
                              <th className="py-2.5 px-2 text-right text-teal-800">Reste ram.</th>
                              <th className="py-2.5 px-2 text-right text-rose-600">Abîmé</th>
                              <th className="py-2.5 px-3 text-right bg-slate-150 font-black">
                                Stock Clôturé
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-mono">
                            {closure.items.map((item) => (
                              <tr key={item.product.id} className="hover:bg-slate-50/60">
                                <td className="py-2 px-3 font-sans font-bold text-slate-900 whitespace-nowrap">
                                  {item.product.name}
                                </td>
                                <td className="py-2 px-2 text-right text-slate-600">
                                  {formatNumber(item.initialStock)}
                                </td>
                                <td className="py-2 px-2 text-right text-teal-700 font-bold">
                                  +{formatNumber(item.producedInPeriod)}
                                </td>
                                <td className="py-2 px-2 text-right text-sky-700">
                                  -{formatNumber(item.deliveredInPeriod)}
                                </td>
                                <td className="py-2 px-2 text-right text-indigo-700">
                                  -{formatNumber(item.soldByOwnerInPeriod)}
                                </td>
                                <td className="py-2 px-2 text-right text-teal-800 font-bold">
                                  +{formatNumber(item.restInPeriod)}
                                </td>
                                <td className="py-2 px-2 text-right text-rose-600">
                                  {formatNumber(item.damagedInPeriod)}
                                </td>
                                <td
                                  className={`py-2 px-3 text-right font-black ${
                                    item.closingStock < 0
                                      ? 'text-rose-600 bg-rose-50/40'
                                      : 'text-slate-900 bg-slate-50'
                                  }`}
                                >
                                  {formatNumber(item.closingStock)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="bg-slate-100 font-extrabold text-slate-900 border-t border-slate-200">
                              <td className="py-2.5 px-3 uppercase text-[10px] font-sans">Total</td>
                              <td className="py-2.5 px-2 text-right font-mono">
                                {formatNumber(closure.totals.initialStock)}
                              </td>
                              <td className="py-2.5 px-2 text-right text-teal-700 font-mono">
                                +{formatNumber(closure.totals.produced)}
                              </td>
                              <td className="py-2.5 px-2 text-right text-sky-700 font-mono">
                                -{formatNumber(closure.totals.delivered)}
                              </td>
                              <td className="py-2.5 px-2 text-right text-indigo-700 font-mono">
                                -{formatNumber(closure.totals.soldOwner)}
                              </td>
                              <td className="py-2.5 px-2 text-right text-teal-800 font-mono">
                                +{formatNumber(closure.totals.rest)}
                              </td>
                              <td className="py-2.5 px-2 text-right text-rose-600 font-mono">
                                {formatNumber(closure.totals.damaged)}
                              </td>
                              <td className="py-2.5 px-3 text-right text-teal-900 font-mono font-black bg-slate-200">
                                {formatNumber(closure.totals.closingStock)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-3 sm:p-4 border-t border-slate-100 bg-white flex items-center justify-between shrink-0">
          <span className="text-[11px] text-slate-500">
            {closures.length} clôture{closures.length > 1 ? 's' : ''} mensuelle{closures.length > 1 ? 's' : ''} disponible{closures.length > 1 ? 's' : ''}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 text-white font-bold text-xs hover:bg-slate-900 transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
