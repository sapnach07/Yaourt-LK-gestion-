import React, { useState, useEffect, useMemo } from 'react';
import {
  Bell,
  Smartphone,
  Plus,
  Copy,
  Trash2,
  Edit2,
  RotateCcw,
  Volume2,
  Play,
  Check,
  X,
  Search,
  ShieldCheck,
  AlertTriangle,
  Clock,
  Sliders,
} from 'lucide-react';
import { db } from '../../db/db';
import {
  NotificationGlyph,
  getStyledNotificationClasses,
} from '../../components/NotificationIcon';
import {
  NOTIFICATION_ACTION_LABELS,
  NOTIFICATION_CATEGORY_LABELS,
  NOTIFICATION_COLOR_THEMES,
  NOTIFICATION_FREQUENCY_OPTIONS,
  NOTIFICATION_ICON_OPTIONS,
  NOTIFICATION_STYLE_OPTIONS,
  TRIGGER_METADATA,
  getDefaultNotificationRules,
  playNotificationChime,
  resolveNotificationSettings,
} from '../../utils/notificationDefaults';
import {
  buildLiveRulePreview,
  getSystemNotificationSupportInfo,
  requestSystemNotificationPermission,
  runSmartNotificationEvaluation,
  syncBackgroundNotificationWorker,
  triggerTestNotification,
  type SystemNotificationSupportInfo,
} from '../../utils/notificationEngine';
import { parseLocaleNumber, formatNumber } from '../../utils/formatters';
import type {
  AppSettings,
  NotificationActionTarget,
  NotificationCategory,
  NotificationFrequency,
  NotificationIconName,
  NotificationRule,
  NotificationSettings,
  NotificationStyleVariant,
  NotificationTriggerType,
} from '../../types';

interface NotificationSettingsSectionProps {
  settings: AppSettings;
  onSettingsUpdated: (newSettings: AppSettings) => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
}

const WEEK_DAYS: { day: number; short: string; full: string }[] = [
  { day: 1, short: 'Lun', full: 'Lundi' },
  { day: 2, short: 'Mar', full: 'Mardi' },
  { day: 3, short: 'Mer', full: 'Mercredi' },
  { day: 4, short: 'Jeu', full: 'Jeudi' },
  { day: 5, short: 'Ven', full: 'Vendredi' },
  { day: 6, short: 'Sam', full: 'Samedi' },
  { day: 0, short: 'Dim', full: 'Dimanche' },
];

const CUSTOM_TRIGGERS_LIST = Object.values(TRIGGER_METADATA).filter((m) => m.isCustomOption);

export const NotificationSettingsSection: React.FC<NotificationSettingsSectionProps> = ({
  settings,
  onSettingsUpdated,
  onShowToast,
}) => {
  const notifSettings = useMemo(() => resolveNotificationSettings(settings), [settings]);

  const [supportInfo, setSupportInfo] = useState<SystemNotificationSupportInfo | null>(null);
  const [ruleCategoryFilter, setRuleCategoryFilter] = useState<'all' | NotificationCategory>('all');
  const [ruleSearch, setRuleSearch] = useState('');

  // Rule Editor Modal State
  const [editingRule, setEditingRule] = useState<NotificationRule | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [thresholdInput, setThresholdInput] = useState('');
  const [livePreview, setLivePreview] = useState<{
    title: string;
    message: string;
    actionLabel?: string;
  } | null>(null);
  const [ruleToDeleteId, setRuleToDeleteId] = useState<string | null>(null);

  useEffect(() => {
    void refreshSupportInfo();
  }, []);

  const refreshSupportInfo = async () => {
    const info = await getSystemNotificationSupportInfo();
    setSupportInfo(info);
  };

  const persistNotificationSettings = async (nextNotifSettings: NotificationSettings) => {
    const updated: AppSettings = {
      ...settings,
      notificationSettings: nextNotifSettings,
    };
    await db.settings.put(updated);
    onSettingsUpdated(updated);
    void syncBackgroundNotificationWorker(updated);
    void runSmartNotificationEvaluation(updated);
  };

  // Live preview recalculation whenever editingRule changes
  useEffect(() => {
    if (!editingRule) {
      setLivePreview(null);
      return;
    }
    let cancelled = false;
    const parsedThreshold = thresholdInput.trim() !== '' ? parseLocaleNumber(thresholdInput) : undefined;
    const draftRule: NotificationRule = {
      ...editingRule,
      thresholdValue:
        parsedThreshold !== undefined && Number.isFinite(parsedThreshold)
          ? parsedThreshold
          : editingRule.thresholdValue,
    };
    void buildLiveRulePreview(draftRule, settings).then((res) => {
      if (!cancelled) {
        setLivePreview({
          title: res.title,
          message: res.message,
          actionLabel: res.actionLabel,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [editingRule, thresholdInput, settings]);

  const handleToggleInAppGlobal = async (enabled: boolean) => {
    await persistNotificationSettings({
      ...notifSettings,
      inAppMode: { ...notifSettings.inAppMode, enabled },
    });
    onShowToast(
      'info',
      enabled
        ? 'Mode 1 (Notifications internes) activé.'
        : 'Mode 1 (Notifications internes) désactivé.'
    );
  };

  const handleUpdateInAppField = async (
    patch: Partial<NotificationSettings['inAppMode']>
  ) => {
    await persistNotificationSettings({
      ...notifSettings,
      inAppMode: { ...notifSettings.inAppMode, ...patch },
    });
  };

  const handleToggleSystemGlobal = async (enabled: boolean) => {
    if (enabled && supportInfo && supportInfo.permission === 'default') {
      const perm = await requestSystemNotificationPermission();
      await refreshSupportInfo();
      if (perm !== 'granted') {
        onShowToast(
          'error',
          perm === 'denied'
            ? 'Autorisation refusée dans le navigateur. Autorisez les notifications dans les paramètres du site.'
            : 'Autorisation requise pour afficher les notifications système.'
        );
        return;
      }
    }
    await persistNotificationSettings({
      ...notifSettings,
      systemMode: { ...notifSettings.systemMode, enabled },
    });
    onShowToast(
      'info',
      enabled
        ? 'Mode 2 (Notifications système appareil) activé.'
        : 'Mode 2 (Notifications système appareil) désactivé.'
    );
  };

  const handleRequestPermissionClick = async () => {
    const perm = await requestSystemNotificationPermission();
    await refreshSupportInfo();
    if (perm === 'granted') {
      await persistNotificationSettings({
        ...notifSettings,
        systemMode: { ...notifSettings.systemMode, enabled: true },
      });
      onShowToast('success', 'Notifications système autorisées et activées.');
    } else if (perm === 'denied') {
      onShowToast(
        'error',
        'Permission bloquée par le navigateur. Ouvrez les réglages du cadenas d’adresse pour l’autoriser.'
      );
    }
  };

  const handleUpdateSystemField = async (
    patch: Partial<NotificationSettings['systemMode']>
  ) => {
    await persistNotificationSettings({
      ...notifSettings,
      systemMode: { ...notifSettings.systemMode, ...patch },
    });
  };

  const handleToggleRuleEnabled = async (ruleId: string) => {
    const nextRules = notifSettings.rules.map((r) =>
      r.id === ruleId ? { ...r, enabled: !r.enabled, updatedAt: Date.now() } : r
    );
    await persistNotificationSettings({
      ...notifSettings,
      rules: nextRules,
    });
  };

  const openCreateCustomRule = () => {
    const now = Date.now();
    const newRule: NotificationRule = {
      id: `custom_${now}_${Math.random().toString(36).slice(2, 6)}`,
      isCustom: true,
      enabled: true,
      name: 'Ma règle personnalisée',
      description: 'Règle créée sur mesure',
      category: 'custom',
      triggerType: 'custom_daily_sales_above',
      titleTemplate: 'Cap du jour franchi ({montant})',
      messageTemplate: 'Les ventes du jour ({date}) ont dépassé {seuil} chez {entreprise} !',
      color: 'emerald',
      icon: 'Sparkles',
      styleVariant: 'soft',
      channels: { inApp: true, system: true },
      thresholdValue: 50000,
      frequency: 'daily',
      activeDays: [0, 1, 2, 3, 4, 5, 6],
      actionTarget: 'daily_sales',
      createdAt: now,
      updatedAt: now,
    };
    setThresholdInput('50000');
    setIsCreatingNew(true);
    setEditingRule(newRule);
  };

  const openEditRule = (rule: NotificationRule) => {
    setThresholdInput(
      rule.thresholdValue !== undefined ? formatNumber(rule.thresholdValue, 2) : ''
    );
    setIsCreatingNew(false);
    setEditingRule({
      ...rule,
      channels: { ...rule.channels },
      activeDays: rule.activeDays ? [...rule.activeDays] : [0, 1, 2, 3, 4, 5, 6],
    });
  };

  const handleDuplicateRule = async (rule: NotificationRule) => {
    const now = Date.now();
    // Si on duplique une règle intégrée ayant un déclencheur builtin_*, on conserve son comportement exact mais avec isCustom = true
    const copy: NotificationRule = {
      ...rule,
      id: `custom_copy_${now}_${Math.random().toString(36).slice(2, 6)}`,
      isCustom: true,
      name: `${rule.name} (Copie)`,
      channels: { ...rule.channels },
      activeDays: rule.activeDays ? [...rule.activeDays] : [0, 1, 2, 3, 4, 5, 6],
      createdAt: now,
      updatedAt: now,
    };
    await persistNotificationSettings({
      ...notifSettings,
      rules: [...notifSettings.rules, copy],
    });
    onShowToast('success', `Règle « ${copy.name} » dupliquée.`);
  };

  const handleResetBuiltInRule = async (ruleId: string) => {
    const defaults = getDefaultNotificationRules(settings);
    const factory = defaults.find((d) => d.id === ruleId);
    if (!factory) return;
    const nextRules = notifSettings.rules.map((r) =>
      r.id === ruleId ? { ...factory, updatedAt: Date.now() } : r
    );
    await persistNotificationSettings({
      ...notifSettings,
      rules: nextRules,
    });
    onShowToast('info', `Règle « ${factory.name} » rétablie par défaut.`);
  };

  const handleConfirmDeleteCustomRule = async () => {
    if (!ruleToDeleteId) return;
    const target = notifSettings.rules.find((r) => r.id === ruleToDeleteId);
    if (!target || !target.isCustom) {
      setRuleToDeleteId(null);
      return;
    }
    const nextRules = notifSettings.rules.filter((r) => r.id !== ruleToDeleteId);
    await persistNotificationSettings({
      ...notifSettings,
      rules: nextRules,
    });
    if (editingRule?.id === ruleToDeleteId) {
      setEditingRule(null);
    }
    setRuleToDeleteId(null);
    onShowToast('info', `Règle « ${target.name} » supprimée.`);
  };

  const handleSaveEditedRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRule) return;

    const cleanName = editingRule.name.trim() || 'Règle sans nom';
    const cleanTitle = editingRule.titleTemplate.trim() || cleanName;
    const cleanMessage = editingRule.messageTemplate.trim() || '{detail}';

    const meta = TRIGGER_METADATA[editingRule.triggerType];
    let finalThreshold = editingRule.thresholdValue;
    if (meta?.hasThreshold) {
      const num = parseLocaleNumber(thresholdInput);
      if (!Number.isFinite(num)) {
        onShowToast('error', 'Veuillez saisir une valeur numérique valide pour le seuil.');
        return;
      }
      finalThreshold = num;
    } else {
      finalThreshold = undefined;
    }

    if (!editingRule.channels.inApp && !editingRule.channels.system) {
      onShowToast('error', 'Activez au moins un canal (Interne ou Système) pour cette règle.');
      return;
    }

    const updatedRule: NotificationRule = {
      ...editingRule,
      name: cleanName,
      titleTemplate: cleanTitle,
      messageTemplate: cleanMessage,
      thresholdValue: finalThreshold,
      updatedAt: Date.now(),
    };

    const exists = notifSettings.rules.some((r) => r.id === updatedRule.id);
    const nextRules = exists
      ? notifSettings.rules.map((r) => (r.id === updatedRule.id ? updatedRule : r))
      : [...notifSettings.rules, updatedRule];

    await persistNotificationSettings({
      ...notifSettings,
      rules: nextRules,
    });

    setEditingRule(null);
    onShowToast(
      'success',
      isCreatingNew ? 'Nouvelle règle créée et enregistrée.' : 'Modifications enregistrées.'
    );
  };

  const handleQuickTest = async (
    rule: NotificationRule,
    channel: 'inApp' | 'system' | 'both'
  ) => {
    if ((channel === 'system' || channel === 'both') && supportInfo?.permission === 'default') {
      await requestSystemNotificationPermission();
      await refreshSupportInfo();
    }
    const res = await triggerTestNotification({ rule, channel, settings });
    onShowToast(res.ok ? 'success' : 'error', res.message);
  };

  const filteredRules = useMemo(() => {
    const q = ruleSearch.trim().toLowerCase();
    return notifSettings.rules.filter((r) => {
      if (ruleCategoryFilter !== 'all' && r.category !== ruleCategoryFilter) {
        return false;
      }
      if (q) {
        const hay = `${r.name} ${r.titleTemplate} ${r.messageTemplate} ${r.description || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [notifSettings.rules, ruleCategoryFilter, ruleSearch]);

  const activeRulesCount = notifSettings.rules.filter((r) => r.enabled).length;

  return (
    <div className="space-y-4">
      {/* ===================================================================== */}
      {/* BLOC 1 : DEUX MODES INDÉPENDANTS ET COMBINABLES                       */}
      {/* ===================================================================== */}
      <div className="grid grid-cols-1 gap-3">
        {/* MODE 1 : INTERNE */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-200/80 text-teal-800 flex items-center justify-center shrink-0">
                <Bell className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <span className="text-xs font-extrabold text-slate-900 block">
                  Mode 1 — Notifications internes à l’application
                </span>
                <span className="text-[11px] text-slate-500 block">
                  Cloche d’historique, compteur non lu et bannières dans l’app
                </span>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={notifSettings.inAppMode.enabled}
              onClick={() => handleToggleInAppGlobal(!notifSettings.inAppMode.enabled)}
              className={`px-3 py-1.5 rounded-xl text-xs font-extrabold border transition-colors shrink-0 min-h-[40px] ${
                notifSettings.inAppMode.enabled
                  ? 'bg-teal-700 text-white border-teal-700'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}
            >
              {notifSettings.inAppMode.enabled ? 'Activé' : 'Désactivé'}
            </button>
          </div>

          {notifSettings.inAppMode.enabled && (
            <div className="pt-2 border-t border-slate-100 space-y-3">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Position des bannières
                  </label>
                  <select
                    value={notifSettings.inAppMode.position}
                    onChange={(e) =>
                      handleUpdateInAppField({
                        position: e.target.value === 'bottom' ? 'bottom' : 'top',
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-800 min-h-[40px]"
                  >
                    <option value="top">En haut de l’écran</option>
                    <option value="bottom">En bas de l’écran</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Durée d’affichage
                  </label>
                  <select
                    value={notifSettings.inAppMode.durationSeconds}
                    onChange={(e) =>
                      handleUpdateInAppField({ durationSeconds: Number(e.target.value) || 5 })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-800 min-h-[40px]"
                  >
                    <option value={3}>3 secondes</option>
                    <option value={5}>5 secondes</option>
                    <option value={8}>8 secondes</option>
                    <option value={12}>12 secondes</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer min-h-[38px]">
                  <input
                    type="checkbox"
                    checked={notifSettings.inAppMode.showToasts}
                    onChange={(e) => handleUpdateInAppField({ showToasts: e.target.checked })}
                    className="w-4 h-4 rounded accent-teal-700"
                  />
                  <span>Afficher les bannières flottantes</span>
                </label>

                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer min-h-[38px]">
                    <input
                      type="checkbox"
                      checked={notifSettings.inAppMode.soundEnabled}
                      onChange={(e) => handleUpdateInAppField({ soundEnabled: e.target.checked })}
                      className="w-4 h-4 rounded accent-teal-700"
                    />
                    <span>Son discret</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => playNotificationChime()}
                    title="Écouter le son"
                    className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold inline-flex items-center gap-1 min-h-[34px]"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Tester le son</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* MODE 2 : SYSTÈME (TÉLÉPHONE / NAVIGATEUR) */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200/80 text-blue-800 flex items-center justify-center shrink-0">
                <Smartphone className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <span className="text-xs font-extrabold text-slate-900 block">
                  Mode 2 — Notifications système (Téléphone / Navigateur)
                </span>
                <span className="text-[11px] text-slate-500 block">
                  Barre d’état de l’appareil via Web Notification & Service Worker PWA
                </span>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={notifSettings.systemMode.enabled}
              onClick={() => handleToggleSystemGlobal(!notifSettings.systemMode.enabled)}
              className={`px-3 py-1.5 rounded-xl text-xs font-extrabold border transition-colors shrink-0 min-h-[40px] ${
                notifSettings.systemMode.enabled
                  ? 'bg-blue-700 text-white border-blue-700'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}
            >
              {notifSettings.systemMode.enabled ? 'Activé' : 'Désactivé'}
            </button>
          </div>

          {/* État de la permission navigateur */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              {supportInfo?.permission === 'granted' ? (
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              )}
              <div className="text-xs">
                <span className="font-bold text-slate-800">
                  Permission navigateur :{' '}
                  {!supportInfo || supportInfo.permission === 'unsupported'
                    ? 'Non disponible ici'
                    : supportInfo.permission === 'granted'
                    ? 'Autorisée'
                    : supportInfo.permission === 'denied'
                    ? 'Bloquée dans le navigateur'
                    : 'Non demandée'}
                </span>
                <span className="text-[11px] text-slate-500 block">
                  {supportInfo?.periodicSyncSupported
                    ? 'Synchronisation périodique PWA en arrière-plan prise en charge.'
                    : supportInfo?.isIOS && !supportInfo?.isStandalonePWA
                    ? 'Sur iPhone/iPad, installez d’abord l’app sur l’écran d’accueil.'
                    : 'Fonctionne quand l’application ou l’arrière-plan PWA est actif sur l’appareil.'}
                </span>
              </div>
            </div>

            {supportInfo?.supported && supportInfo.permission !== 'granted' && (
              <button
                type="button"
                onClick={handleRequestPermissionClick}
                className="px-3 py-1.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold whitespace-nowrap min-h-[38px]"
              >
                Autoriser sur cet appareil
              </button>
            )}
          </div>

          {notifSettings.systemMode.enabled && (
            <div className="pt-1 space-y-3">
              <div className="flex items-center gap-4 flex-wrap">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer min-h-[36px]">
                  <input
                    type="checkbox"
                    checked={notifSettings.systemMode.vibrate}
                    onChange={(e) => handleUpdateSystemField({ vibrate: e.target.checked })}
                    className="w-4 h-4 rounded accent-blue-700"
                  />
                  <span>Vibration téléphone</span>
                </label>

                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer min-h-[36px]">
                  <input
                    type="checkbox"
                    checked={notifSettings.systemMode.requireInteraction}
                    onChange={(e) =>
                      handleUpdateSystemField({ requireInteraction: e.target.checked })
                    }
                    className="w-4 h-4 rounded accent-blue-700"
                  />
                  <span>Maintenir visible jusqu’au clic</span>
                </label>

                <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer min-h-[36px]">
                  <input
                    type="checkbox"
                    checked={notifSettings.systemMode.backgroundSyncEnabled}
                    onChange={(e) =>
                      handleUpdateSystemField({ backgroundSyncEnabled: e.target.checked })
                    }
                    className="w-4 h-4 rounded accent-blue-700"
                  />
                  <span>Vérification périodique PWA</span>
                </label>
              </div>

              {/* Heures calmes */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-800 inline-flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    <span>Heures calmes (ne pas déranger)</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={notifSettings.systemMode.quietHoursEnabled}
                    onChange={(e) =>
                      handleUpdateSystemField({ quietHoursEnabled: e.target.checked })
                    }
                    className="w-4 h-4 rounded accent-blue-700"
                  />
                </div>
                {notifSettings.systemMode.quietHoursEnabled && (
                  <div className="grid grid-cols-2 gap-2.5 pt-1">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">
                        Début du silence
                      </label>
                      <input
                        type="time"
                        value={notifSettings.systemMode.quietHoursStart}
                        onChange={(e) =>
                          handleUpdateSystemField({ quietHoursStart: e.target.value })
                        }
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-mono font-bold text-slate-800 min-h-[38px]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 mb-1">
                        Fin du silence
                      </label>
                      <input
                        type="time"
                        value={notifSettings.systemMode.quietHoursEnd}
                        onChange={(e) =>
                          handleUpdateSystemField({ quietHoursEnd: e.target.value })
                        }
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-mono font-bold text-slate-800 min-h-[38px]"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===================================================================== */}
      {/* BLOC 2 : LISTE DES RÈGLES INTELLIGENTES & PERSONNALISÉES              */}
      {/* ===================================================================== */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs space-y-3.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
              <Sliders className="w-4 h-4 text-teal-700" />
              <span>Règles d’alertes ({activeRulesCount} actives)</span>
            </h3>
            <p className="text-[11px] text-slate-500">
              Modifiez les textes, couleurs, icônes, seuils et horaires ou créez vos propres règles
            </p>
          </div>

          <button
            type="button"
            onClick={openCreateCustomRule}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-extrabold transition-colors whitespace-nowrap min-h-[42px]"
          >
            <Plus className="w-4 h-4" />
            <span>Nouvelle règle</span>
          </button>
        </div>

        {/* Recherche & filtres */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={ruleSearch}
              onChange={(e) => setRuleSearch(e.target.value)}
              placeholder="Chercher une règle (stock, dette, rapport…)"
              className="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-800 placeholder:text-slate-400 min-h-[40px]"
            />
            {ruleSearch && (
              <button
                type="button"
                onClick={() => setRuleSearch('')}
                aria-label="Effacer"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            <button
              type="button"
              onClick={() => setRuleCategoryFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 border min-h-[36px] ${
                ruleCategoryFilter === 'all'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              Toutes ({notifSettings.rules.length})
            </button>
            {(Object.keys(NOTIFICATION_CATEGORY_LABELS) as NotificationCategory[]).map((cat) => {
              const count = notifSettings.rules.filter((r) => r.category === cat).length;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setRuleCategoryFilter(cat)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 border min-h-[36px] ${
                    ruleCategoryFilter === cat
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {NOTIFICATION_CATEGORY_LABELS[cat]} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {/* Cartes des règles */}
        <div className="divide-y divide-slate-100">
          {filteredRules.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-6">
              Aucune règle ne correspond à cette recherche.
            </p>
          ) : (
            filteredRules.map((rule) => {
              const styled = getStyledNotificationClasses(rule.color, 'soft');
              const meta = TRIGGER_METADATA[rule.triggerType];
              const freqLabel =
                NOTIFICATION_FREQUENCY_OPTIONS.find((f) => f.id === rule.frequency)?.label ||
                rule.frequency;

              return (
                <div
                  key={rule.id}
                  className={`py-3.5 first:pt-1 last:pb-0 space-y-2.5 ${
                    rule.enabled ? '' : 'opacity-65'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <div
                        className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 mt-0.5 ${styled.iconBoxClass}`}
                      >
                        <NotificationGlyph icon={rule.icon} className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-extrabold text-slate-900">
                            {rule.name}
                          </span>
                          {rule.isCustom && (
                            <span className="px-1.5 py-0.5 rounded-md bg-violet-50 text-violet-800 border border-violet-200 text-[10px] font-bold">
                              Personnalisée
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-600 truncate mt-0.5">
                          <span className="font-bold text-slate-800">{rule.titleTemplate}</span> —{' '}
                          {rule.messageTemplate}
                        </p>
                        <div className="flex items-center gap-2 flex-wrap mt-1 text-[10px] font-semibold text-slate-500">
                          <span>
                            Canaux :{' '}
                            {rule.channels.inApp && rule.channels.system
                              ? 'Interne + Système'
                              : rule.channels.inApp
                              ? 'Interne seul'
                              : 'Système seul'}
                          </span>
                          <span>·</span>
                          <span>{freqLabel}</span>
                          {meta?.hasThreshold && rule.thresholdValue !== undefined && (
                            <>
                              <span>·</span>
                              <span className="font-mono tabular-nums text-slate-700">
                                Seuil : {formatNumber(rule.thresholdValue, 2)}{' '}
                                {meta.thresholdUnit || ''}
                              </span>
                            </>
                          )}
                          {rule.preferredTime && (
                            <>
                              <span>·</span>
                              <span className="font-mono tabular-nums text-teal-800">
                                {rule.preferredTime}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={rule.enabled}
                      onClick={() => handleToggleRuleEnabled(rule.id)}
                      className={`px-2.5 py-1.5 rounded-xl text-[11px] font-extrabold border shrink-0 min-h-[38px] transition-colors ${
                        rule.enabled
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}
                    >
                      {rule.enabled ? 'Active' : 'Inactive'}
                    </button>
                  </div>

                  {/* Barre d'actions par règle */}
                  <div className="flex items-center gap-1.5 flex-wrap pl-11">
                    <button
                      type="button"
                      onClick={() => openEditRule(rule)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-bold min-h-[34px]"
                    >
                      <Edit2 className="w-3 h-3" />
                      <span>Personnaliser</span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        handleQuickTest(
                          rule,
                          rule.channels.inApp && rule.channels.system && notifSettings.systemMode.enabled
                            ? 'both'
                            : rule.channels.system && !rule.channels.inApp
                            ? 'system'
                            : 'inApp'
                        )
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200/80 text-[11px] font-bold min-h-[34px]"
                    >
                      <Play className="w-3 h-3" />
                      <span>Tester</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDuplicateRule(rule)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold min-h-[34px]"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Dupliquer</span>
                    </button>

                    {rule.isCustom ? (
                      <button
                        type="button"
                        onClick={() => setRuleToDeleteId(rule.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/70 text-[11px] font-bold min-h-[34px]"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Supprimer</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleResetBuiltInRule(rule.id)}
                        title="Rétablir le texte, la couleur et le seuil par défaut"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-500 border border-slate-200/80 text-[11px] font-semibold min-h-[34px]"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Par défaut</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ===================================================================== */}
      {/* MODALE DE CONFIRMATION DE SUPPRESSION D'UNE RÈGLE PERSONNALISÉE       */}
      {/* ===================================================================== */}
      {ruleToDeleteId && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
        >
          <div className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl border border-slate-200 space-y-4">
            <h3 className="text-sm font-extrabold text-slate-900">
              Supprimer cette règle personnalisée ?
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Cette règle ne générera plus de nouvelles notifications. Vos données de gestion ne sont pas affectées.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRuleToDeleteId(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 min-h-[44px]"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteCustomRule}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold min-h-[44px]"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODALE D'ÉDITION / CRÉATION / PRÉVISUALISATION D'UNE RÈGLE           */}
      {/* ===================================================================== */}
      {editingRule && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Personnaliser la notification"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-slate-900/60 backdrop-blur-xs"
        >
          <div className="w-full sm:max-w-lg max-h-[92vh] bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
            {/* En-tête modale */}
            <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2 shrink-0">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">
                  {isCreatingNew
                    ? 'Nouvelle règle personnalisée'
                    : `Personnaliser : ${editingRule.name}`}
                </h3>
                <p className="text-[11px] text-slate-500">
                  Modifications appliquées immédiatement sans toucher au code
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingRule(null)}
                aria-label="Fermer"
                className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 min-h-[42px] min-w-[42px] flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              id="notification-rule-editor-form"
              onSubmit={handleSaveEditedRule}
              className="flex-1 overflow-y-auto p-4 space-y-4"
            >
              {/* APERÇU EN DIRECT */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                    Aperçu en direct (données réelles)
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const parsed = parseLocaleNumber(thresholdInput);
                        void handleQuickTest(
                          {
                            ...editingRule,
                            thresholdValue: Number.isFinite(parsed)
                              ? parsed
                              : editingRule.thresholdValue,
                          },
                          'inApp'
                        );
                      }}
                      className="px-2.5 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 text-[11px] font-bold min-h-[32px]"
                    >
                      Tester (Interne)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const parsed = parseLocaleNumber(thresholdInput);
                        void handleQuickTest(
                          {
                            ...editingRule,
                            thresholdValue: Number.isFinite(parsed)
                              ? parsed
                              : editingRule.thresholdValue,
                          },
                          'system'
                        );
                      }}
                      className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 text-[11px] font-bold min-h-[32px]"
                    >
                      Tester (Système)
                    </button>
                  </div>
                </div>

                {(() => {
                  const previewStyled = getStyledNotificationClasses(
                    editingRule.color,
                    editingRule.styleVariant
                  );
                  return (
                    <div
                      className={`rounded-2xl border p-3.5 flex items-start gap-3 transition-all ${previewStyled.cardClass}`}
                    >
                      <div
                        className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${previewStyled.iconBoxClass}`}
                      >
                        <NotificationGlyph icon={editingRule.icon} className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4
                          className={`text-xs font-extrabold leading-snug ${previewStyled.titleClass}`}
                        >
                          {livePreview?.title || editingRule.titleTemplate}
                        </h4>
                        <p className={`text-xs leading-relaxed mt-0.5 ${previewStyled.bodyClass}`}>
                          {livePreview?.message || editingRule.messageTemplate}
                        </p>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Nom et Déclencheur */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Nom de la règle
                  </label>
                  <input
                    type="text"
                    value={editingRule.name}
                    onChange={(e) => setEditingRule({ ...editingRule, name: e.target.value })}
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 min-h-[40px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Catégorie
                  </label>
                  <select
                    value={editingRule.category}
                    onChange={(e) =>
                      setEditingRule({
                        ...editingRule,
                        category: e.target.value as NotificationCategory,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-900 min-h-[40px]"
                  >
                    {(Object.keys(NOTIFICATION_CATEGORY_LABELS) as NotificationCategory[]).map(
                      (cat) => (
                        <option key={cat} value={cat}>
                          {NOTIFICATION_CATEGORY_LABELS[cat]}
                        </option>
                      )
                    )}
                  </select>
                </div>
              </div>

              {/* Sélection de la condition pour une règle personnalisée */}
              {editingRule.isCustom && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Condition de déclenchement
                  </label>
                  <select
                    value={editingRule.triggerType}
                    onChange={(e) => {
                      const nextTrigger = e.target.value as NotificationTriggerType;
                      const meta = TRIGGER_METADATA[nextTrigger];
                      if (meta?.defaultThreshold !== undefined) {
                        setThresholdInput(String(meta.defaultThreshold));
                      } else {
                        setThresholdInput('');
                      }
                      setEditingRule({
                        ...editingRule,
                        triggerType: nextTrigger,
                        thresholdValue: meta?.defaultThreshold,
                        actionTarget: meta?.defaultActionTarget || editingRule.actionTarget,
                        preferredTime:
                          meta?.usesSchedule && !editingRule.preferredTime
                            ? '08:00'
                            : editingRule.preferredTime,
                      });
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-900 min-h-[40px]"
                  >
                    {!TRIGGER_METADATA[editingRule.triggerType]?.isCustomOption && (
                      <option value={editingRule.triggerType}>
                        {TRIGGER_METADATA[editingRule.triggerType]?.label || editingRule.triggerType}
                      </option>
                    )}
                    {CUSTOM_TRIGGERS_LIST.map((opt) => (
                      <option key={opt.triggerType} value={opt.triggerType}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Titre et Message personnalisables */}
              <div className="space-y-2.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Titre de la notification
                  </label>
                  <input
                    type="text"
                    value={editingRule.titleTemplate}
                    onChange={(e) =>
                      setEditingRule({ ...editingRule, titleTemplate: e.target.value })
                    }
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-900 min-h-[40px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Message détaillé
                  </label>
                  <textarea
                    rows={2}
                    value={editingRule.messageTemplate}
                    onChange={(e) =>
                      setEditingRule({ ...editingRule, messageTemplate: e.target.value })
                    }
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-medium text-slate-900"
                  />
                </div>

                {/* Variables dynamiques cliquables */}
                {TRIGGER_METADATA[editingRule.triggerType]?.availableVars.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-500 block">
                      Insérer une donnée automatique dans le message :
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {TRIGGER_METADATA[editingRule.triggerType].availableVars.map((v) => (
                        <button
                          key={v.token}
                          type="button"
                          onClick={() =>
                            setEditingRule({
                              ...editingRule,
                              messageTemplate: `${editingRule.messageTemplate} ${v.token}`.trim(),
                            })
                          }
                          title={v.desc}
                          className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-teal-50 hover:text-teal-800 border border-slate-200 text-[11px] font-mono font-bold text-slate-700 transition-colors"
                        >
                          {v.token} <span className="font-sans font-normal text-slate-500">({v.desc})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Couleur, Icône et Style visuel */}
              <div className="space-y-3 pt-1 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Couleur
                  </label>
                  <div className="flex items-center gap-2 flex-wrap">
                    {NOTIFICATION_COLOR_THEMES.map((theme) => {
                      const selected = editingRule.color === theme.id;
                      return (
                        <button
                          key={theme.id}
                          type="button"
                          onClick={() => setEditingRule({ ...editingRule, color: theme.id })}
                          title={theme.label}
                          aria-label={theme.label}
                          className={`w-9 h-9 rounded-xl flex items-center justify-center transition-transform ${
                            theme.swatchBg
                          } ${selected ? 'ring-2 ring-offset-2 ring-slate-900 scale-105' : 'opacity-85 hover:opacity-100'}`}
                        >
                          {selected && <Check className="w-4 h-4 text-white" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Icône
                  </label>
                  <div className="grid grid-cols-8 gap-1.5">
                    {NOTIFICATION_ICON_OPTIONS.map((ic) => {
                      const selected = editingRule.icon === ic.id;
                      return (
                        <button
                          key={ic.id}
                          type="button"
                          onClick={() =>
                            setEditingRule({
                              ...editingRule,
                              icon: ic.id as NotificationIconName,
                            })
                          }
                          title={ic.label}
                          aria-label={ic.label}
                          className={`h-10 rounded-xl border flex items-center justify-center transition-colors ${
                            selected
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          <NotificationGlyph icon={ic.id} className="w-4 h-4" />
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Style d’affichage
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {NOTIFICATION_STYLE_OPTIONS.map((st) => {
                      const selected = editingRule.styleVariant === st.id;
                      return (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() =>
                            setEditingRule({
                              ...editingRule,
                              styleVariant: st.id as NotificationStyleVariant,
                            })
                          }
                          className={`p-2.5 rounded-xl border text-left transition-colors min-h-[44px] ${
                            selected
                              ? 'bg-teal-50 border-teal-600 text-teal-950'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <span className="text-xs font-extrabold block">{st.label}</span>
                          <span className="text-[10px] text-slate-500 block leading-tight">
                            {st.hint}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Canaux, Seuils, Horaires et Fréquence */}
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div>
                  <span className="block text-xs font-bold text-slate-700 mb-1.5">
                    Modes d’envoi pour cette règle
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-800 cursor-pointer min-h-[42px]">
                      <input
                        type="checkbox"
                        checked={editingRule.channels.inApp}
                        onChange={(e) =>
                          setEditingRule({
                            ...editingRule,
                            channels: { ...editingRule.channels, inApp: e.target.checked },
                          })
                        }
                        className="w-4 h-4 rounded accent-teal-700"
                      />
                      <span>Interne (App)</span>
                    </label>
                    <label className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-800 cursor-pointer min-h-[42px]">
                      <input
                        type="checkbox"
                        checked={editingRule.channels.system}
                        onChange={(e) =>
                          setEditingRule({
                            ...editingRule,
                            channels: { ...editingRule.channels, system: e.target.checked },
                          })
                        }
                        className="w-4 h-4 rounded accent-blue-700"
                      />
                      <span>Système (Appareil)</span>
                    </label>
                  </div>
                </div>

                {TRIGGER_METADATA[editingRule.triggerType]?.hasThreshold && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      {TRIGGER_METADATA[editingRule.triggerType].thresholdLabel || 'Seuil'}{' '}
                      {TRIGGER_METADATA[editingRule.triggerType].thresholdUnit
                        ? `(${TRIGGER_METADATA[editingRule.triggerType].thresholdUnit})`
                        : ''}
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={thresholdInput}
                      onChange={(e) =>
                        setThresholdInput(e.target.value.replace(/[^0-9.,-]/g, ''))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-mono font-extrabold text-slate-900 min-h-[40px]"
                    />
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Fréquence maximale
                    </label>
                    <select
                      value={editingRule.frequency}
                      onChange={(e) =>
                        setEditingRule({
                          ...editingRule,
                          frequency: e.target.value as NotificationFrequency,
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-900 min-h-[40px]"
                    >
                      {NOTIFICATION_FREQUENCY_OPTIONS.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Horaire préféré (optionnel)
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="time"
                        value={editingRule.preferredTime || ''}
                        onChange={(e) =>
                          setEditingRule({
                            ...editingRule,
                            preferredTime: e.target.value || undefined,
                          })
                        }
                        className="flex-1 px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-mono font-bold text-slate-900 min-h-[40px]"
                      />
                      {editingRule.preferredTime && (
                        <button
                          type="button"
                          onClick={() =>
                            setEditingRule({ ...editingRule, preferredTime: undefined })
                          }
                          title="Effacer l’horaire"
                          className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-100 min-h-[40px]"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Jours actifs */}
                <div>
                  <span className="block text-xs font-bold text-slate-700 mb-1.5">
                    Jours autorisés
                  </span>
                  <div className="grid grid-cols-7 gap-1">
                    {WEEK_DAYS.map((wd) => {
                      const activeDays = editingRule.activeDays ?? [0, 1, 2, 3, 4, 5, 6];
                      const isDayOn = activeDays.includes(wd.day);
                      return (
                        <button
                          key={wd.day}
                          type="button"
                          onClick={() => {
                            const nextDays = isDayOn
                              ? activeDays.filter((d) => d !== wd.day)
                              : [...activeDays, wd.day];
                            if (nextDays.length === 0) return;
                            setEditingRule({ ...editingRule, activeDays: nextDays });
                          }}
                          title={wd.full}
                          className={`py-2 rounded-xl text-[11px] font-extrabold border transition-colors min-h-[38px] ${
                            isDayOn
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-slate-50 text-slate-500 border-slate-200'
                          }`}
                        >
                          {wd.short}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Écran ouvert au clic */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Action à l’ouverture de la notification
                  </label>
                  <select
                    value={editingRule.actionTarget || 'dashboard'}
                    onChange={(e) =>
                      setEditingRule({
                        ...editingRule,
                        actionTarget: e.target.value as NotificationActionTarget,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-900 min-h-[40px]"
                  >
                    {(Object.keys(NOTIFICATION_ACTION_LABELS) as NotificationActionTarget[]).map(
                      (target) => (
                        <option key={target} value={target}>
                          {NOTIFICATION_ACTION_LABELS[target]}
                        </option>
                      )
                    )}
                  </select>
                </div>
              </div>
            </form>

            {/* Pied de modale */}
            <div className="p-3.5 border-t border-slate-200 bg-slate-50 flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setEditingRule(null)}
                className="flex-1 py-2.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 min-h-[44px]"
              >
                Annuler
              </button>
              <button
                type="submit"
                form="notification-rule-editor-form"
                className="flex-1 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-extrabold min-h-[44px]"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
