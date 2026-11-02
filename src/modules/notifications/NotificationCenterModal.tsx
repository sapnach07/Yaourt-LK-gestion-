import React, { useState, useMemo } from 'react';
import {
  Bell,
  X,
  CheckCheck,
  Trash2,
  Settings,
  Search,
  Check,
  MailOpen,
  ArrowUpRight,
  RefreshCw,
} from 'lucide-react';
import {
  NotificationGlyph,
  getStyledNotificationClasses,
} from '../../components/NotificationIcon';
import { NOTIFICATION_CATEGORY_LABELS } from '../../utils/notificationDefaults';
import {
  toggleNotificationRead,
  markAllNotificationsAsRead,
  deleteSingleNotification,
  deleteReadNotifications,
  clearAllNotifications,
  runSmartNotificationEvaluation,
} from '../../utils/notificationEngine';
import type {
  AppNotification,
  AppSettings,
  NotificationActionTarget,
  NotificationCategory,
} from '../../types';

interface NotificationCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: AppNotification[];
  settings: AppSettings;
  onNavigateTarget: (target: NotificationActionTarget) => void;
  onOpenNotificationSettings: () => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
}

type FilterTab = 'all' | 'unread' | NotificationCategory;

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: 'all', label: 'Toutes' },
  { id: 'unread', label: 'Non lues' },
  { id: 'stock', label: 'Stocks' },
  { id: 'debts', label: 'Dettes & Paie' },
  { id: 'finance', label: 'Finances' },
  { id: 'reports', label: 'Rapports' },
  { id: 'backup', label: 'Sauvegardes' },
  { id: 'custom', label: 'Personnalisées' },
];

function formatNotificationTimestamp(createdAt: number): string {
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - createdAt) / 1000));
  if (diffSec < 60) return 'À l’instant';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Il y a ${diffMin} min`;

  const d = new Date(createdAt);
  const nowDate = new Date(now);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');

  if (
    d.getDate() === nowDate.getDate() &&
    d.getMonth() === nowDate.getMonth() &&
    d.getFullYear() === nowDate.getFullYear()
  ) {
    return `Aujourd’hui · ${hh}:${mm}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear()
  ) {
    return `Hier · ${hh}:${mm}`;
  }

  const dd = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mo}/${yyyy} · ${hh}:${mm}`;
}

export const NotificationCenterModal: React.FC<NotificationCenterModalProps> = ({
  isOpen,
  onClose,
  notifications,
  settings,
  onNavigateTarget,
  onOpenNotificationSettings,
  onShowToast,
}) => {
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications]
  );

  const readCount = notifications.length - unreadCount;

  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return notifications.filter((item) => {
      if (activeFilter === 'unread' && item.isRead) return false;
      if (
        activeFilter !== 'all' &&
        activeFilter !== 'unread' &&
        item.category !== activeFilter
      ) {
        return false;
      }
      if (q) {
        const hay = `${item.title} ${item.message} ${NOTIFICATION_CATEGORY_LABELS[item.category] || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [notifications, activeFilter, searchQuery]);

  if (!isOpen) return null;

  const handleRefreshChecks = async () => {
    setIsRefreshing(true);
    try {
      const added = await runSmartNotificationEvaluation(settings);
      if (added > 0) {
        onShowToast('info', `${added} nouvelle(s) alerte(s) détectée(s).`);
      } else {
        onShowToast('success', 'Toutes les alertes sont à jour.');
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleMarkAllRead = async () => {
    await markAllNotificationsAsRead();
  };

  const handleDeleteRead = async () => {
    await deleteReadNotifications();
    onShowToast('info', 'Notifications lues supprimées.');
  };

  const handleClearAllConfirmed = async () => {
    await clearAllNotifications();
    setConfirmClearAll(false);
    onShowToast('info', 'Historique des notifications vidé.');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Centre de notifications"
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full sm:max-w-md h-full bg-slate-50 sm:border-l border-slate-200 shadow-2xl flex flex-col overflow-hidden">
        {/* En-tête du centre */}
        <div className="bg-white border-b border-slate-200/90 px-4 py-3 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-200/80 text-teal-800 flex items-center justify-center shrink-0">
              <Bell className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-extrabold text-slate-900 tracking-tight truncate">
                  Centre de notifications
                </h2>
                <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[11px] font-extrabold font-mono tabular-nums text-slate-800 shrink-0">
                  {unreadCount} non {unreadCount > 1 ? 'lues' : 'lue'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                {notifications.length} au total dans l’historique
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={handleRefreshChecks}
              disabled={isRefreshing}
              title="Vérifier les alertes maintenant"
              aria-label="Vérifier les alertes maintenant"
              className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenNotificationSettings();
              }}
              title="Paramètres des notifications"
              aria-label="Paramètres des notifications"
              className="p-2 rounded-xl text-slate-500 hover:text-teal-800 hover:bg-teal-50 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Fermer"
              aria-label="Fermer"
              className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Recherche & filtres par catégorie */}
        <div className="bg-white border-b border-slate-200/80 px-4 pt-2.5 pb-2.5 space-y-2.5 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher dans l’historique…"
              aria-label="Rechercher dans les notifications"
              className="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-800 placeholder:text-slate-400 focus:outline-teal-700 min-h-[40px]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Effacer la recherche"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            {FILTER_TABS.map((tab) => {
              const isSelected = activeFilter === tab.id;
              const count =
                tab.id === 'all'
                  ? notifications.length
                  : tab.id === 'unread'
                  ? unreadCount
                  : notifications.filter((n) => n.category === tab.id).length;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-colors border min-h-[36px] inline-flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <span>{tab.label}</span>
                  {count > 0 && (
                    <span
                      className={`text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded-md ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-slate-200/80 text-slate-700'
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Barre d'actions groupées */}
        {notifications.length > 0 && (
          <div className="px-4 py-2 bg-slate-100/90 border-b border-slate-200/80 flex items-center justify-between gap-2 flex-wrap shrink-0">
            {confirmClearAll ? (
              <div className="w-full flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-rose-800">
                  Vider tout l’historique ?
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setConfirmClearAll(false)}
                    className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-700 min-h-[34px]"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={handleClearAllConfirmed}
                    className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-xs font-bold text-white min-h-[34px]"
                  >
                    Confirmer
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  disabled={unreadCount === 0}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200/90 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap min-h-[34px]"
                >
                  <CheckCheck className="w-3.5 h-3.5 text-teal-700" />
                  <span>Tout marquer lu</span>
                </button>

                <div className="flex items-center gap-1.5">
                  {readCount > 0 && (
                    <button
                      type="button"
                      onClick={handleDeleteRead}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200/90 text-[11px] font-bold text-slate-600 hover:text-rose-700 hover:border-rose-200 whitespace-nowrap min-h-[34px]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Effacer lues</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setConfirmClearAll(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200/90 text-[11px] font-bold text-rose-700 hover:bg-rose-50 whitespace-nowrap min-h-[34px]"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Tout vider</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Liste des notifications */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
          {filteredList.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-8 text-center space-y-3 my-4">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 border border-slate-200/80 text-slate-500 flex items-center justify-center mx-auto">
                <Bell className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-extrabold text-slate-900">
                  {notifications.length === 0
                    ? 'Aucune notification pour le moment'
                    : 'Aucun résultat pour ce filtre'}
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed max-w-xs mx-auto">
                  {notifications.length === 0
                    ? 'Les alertes intelligentes (stocks, dettes, caisses, objectifs, sauvegardes) apparaîtront automatiquement ici.'
                    : 'Essayez une autre catégorie ou effacez le texte recherché.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenNotificationSettings();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold transition-colors min-h-[42px]"
              >
                <Settings className="w-4 h-4" />
                <span>Personnaliser ou tester</span>
              </button>
            </div>
          ) : (
            filteredList.map((item) => {
              const styled = getStyledNotificationClasses(item.color, item.styleVariant);
              const catLabel =
                NOTIFICATION_CATEGORY_LABELS[item.category] || 'Notification';

              return (
                <div
                  key={item.id}
                  className={`rounded-2xl border p-3.5 transition-all ${styled.cardClass} ${
                    item.isRead ? 'opacity-80' : 'shadow-xs'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 mt-0.5 ${styled.iconBoxClass}`}
                    >
                      <NotificationGlyph icon={item.icon} className="w-4 h-4" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {!item.isRead && (
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${styled.unreadDotClass}`}
                              aria-label="Non lue"
                            />
                          )}
                          <span
                            className={`text-[10px] font-extrabold uppercase tracking-wider truncate ${
                              styled.isSolid ? 'text-white/75' : 'text-slate-500'
                            }`}
                          >
                            {catLabel}
                            {item.isTest ? ' · Test' : ''}
                          </span>
                        </div>
                        <span
                          className={`text-[10px] font-mono tabular-nums shrink-0 ${
                            styled.isSolid ? 'text-white/70' : 'text-slate-400'
                          }`}
                        >
                          {formatNotificationTimestamp(item.createdAt)}
                        </span>
                      </div>

                      <h4
                        className={`text-xs font-extrabold leading-snug mt-0.5 ${styled.titleClass}`}
                      >
                        {item.title}
                      </h4>
                      <p className={`text-xs leading-relaxed mt-0.5 ${styled.bodyClass}`}>
                        {item.message}
                      </p>

                      <div className="mt-2.5 flex items-center justify-between gap-2 flex-wrap">
                        {item.actionTarget ? (
                          <button
                            type="button"
                            onClick={async () => {
                              if (!item.isRead) {
                                await toggleNotificationRead(item.id, true);
                              }
                              onClose();
                              onNavigateTarget(item.actionTarget!);
                            }}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors whitespace-nowrap min-h-[32px] ${styled.actionBtnClass}`}
                          >
                            <span>{item.actionLabel || 'Ouvrir'}</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <span />
                        )}

                        <div className="flex items-center gap-1 ml-auto">
                          <button
                            type="button"
                            onClick={() => toggleNotificationRead(item.id, !item.isRead)}
                            title={item.isRead ? 'Marquer comme non lue' : 'Marquer comme lue'}
                            aria-label={
                              item.isRead ? 'Marquer comme non lue' : 'Marquer comme lue'
                            }
                            className={`p-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 min-h-[34px] min-w-[34px] justify-center transition-colors ${
                              styled.isSolid
                                ? 'text-white/80 hover:text-white hover:bg-white/10'
                                : 'text-slate-600 hover:text-slate-900 hover:bg-black/5'
                            }`}
                          >
                            {item.isRead ? (
                              <MailOpen className="w-3.5 h-3.5" />
                            ) : (
                              <Check className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteSingleNotification(item.id)}
                            title="Supprimer cette notification"
                            aria-label="Supprimer cette notification"
                            className={`p-1.5 rounded-lg min-h-[34px] min-w-[34px] flex items-center justify-center transition-colors ${
                              styled.isSolid
                                ? 'text-white/75 hover:text-rose-200 hover:bg-white/10'
                                : 'text-slate-500 hover:text-rose-600 hover:bg-rose-50'
                            }`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Pied de tiroir : accès rapide aux réglages */}
        <div className="bg-white border-t border-slate-200/90 p-3 shrink-0">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenNotificationSettings();
            }}
            className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors min-h-[44px]"
          >
            <Settings className="w-4 h-4" />
            <span>Paramètres des notifications & Règles personnalisées</span>
          </button>
        </div>
      </div>
    </div>
  );
};
