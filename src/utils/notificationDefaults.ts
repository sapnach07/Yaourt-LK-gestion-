import type {
  AppSettings,
  InAppNotificationModeSettings,
  NotificationActionTarget,
  NotificationCategory,
  NotificationFrequency,
  NotificationIconName,
  NotificationRule,
  NotificationSettings,
  NotificationStyleVariant,
  NotificationTriggerType,
  SystemNotificationModeSettings,
} from '../types';

export interface NotificationColorTheme {
  id: string;
  label: string;
  hex: string;
  swatchBg: string;
  // Style 'soft' (teinté doux)
  softCard: string;
  softIconBox: string;
  softTitle: string;
  softBody: string;
  softBadge: string;
  // Style 'outlined' (bordure franche sur fond blanc)
  outlinedCard: string;
  outlinedIconBox: string;
  outlinedTitle: string;
  outlinedBody: string;
  // Style 'solid' (fond contrasté foncé/plein)
  solidCard: string;
  solidIconBox: string;
  solidTitle: string;
  solidBody: string;
  // Style 'minimal' (épuré neutre avec icône colorée)
  minimalCard: string;
  minimalIconBox: string;
  minimalTitle: string;
  minimalBody: string;
  // Bouton d'action contextuel
  actionBtn: string;
  actionBtnSolid: string;
  unreadDot: string;
}

export const NOTIFICATION_COLOR_THEMES: NotificationColorTheme[] = [
  {
    id: 'teal',
    label: 'Sarcelle',
    hex: '#0f766e',
    swatchBg: 'bg-teal-700',
    softCard: 'bg-teal-50/90 border-teal-200',
    softIconBox: 'bg-teal-100 text-teal-800 border-teal-200/80',
    softTitle: 'text-teal-950',
    softBody: 'text-teal-900/85',
    softBadge: 'bg-teal-100 text-teal-800 border-teal-200',
    outlinedCard: 'bg-white border-teal-500 ring-1 ring-teal-500/20',
    outlinedIconBox: 'bg-teal-50 text-teal-700 border-teal-200',
    outlinedTitle: 'text-slate-900',
    outlinedBody: 'text-slate-600',
    solidCard: 'bg-teal-900 border-teal-800 text-white',
    solidIconBox: 'bg-teal-800 text-teal-100 border-teal-700',
    solidTitle: 'text-white',
    solidBody: 'text-teal-100',
    minimalCard: 'bg-white border-slate-200/90',
    minimalIconBox: 'bg-slate-100 text-teal-700 border-slate-200/80',
    minimalTitle: 'text-slate-900',
    minimalBody: 'text-slate-600',
    actionBtn: 'bg-teal-700 hover:bg-teal-800 text-white',
    actionBtnSolid: 'bg-white/15 hover:bg-white/25 text-white border border-white/20',
    unreadDot: 'bg-teal-600',
  },
  {
    id: 'emerald',
    label: 'Émeraude',
    hex: '#059669',
    swatchBg: 'bg-emerald-600',
    softCard: 'bg-emerald-50/90 border-emerald-200',
    softIconBox: 'bg-emerald-100 text-emerald-800 border-emerald-200/80',
    softTitle: 'text-emerald-950',
    softBody: 'text-emerald-900/85',
    softBadge: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    outlinedCard: 'bg-white border-emerald-500 ring-1 ring-emerald-500/20',
    outlinedIconBox: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    outlinedTitle: 'text-slate-900',
    outlinedBody: 'text-slate-600',
    solidCard: 'bg-emerald-950 border-emerald-800 text-white',
    solidIconBox: 'bg-emerald-900 text-emerald-200 border-emerald-700',
    solidTitle: 'text-white',
    solidBody: 'text-emerald-100',
    minimalCard: 'bg-white border-slate-200/90',
    minimalIconBox: 'bg-slate-100 text-emerald-700 border-slate-200/80',
    minimalTitle: 'text-slate-900',
    minimalBody: 'text-slate-600',
    actionBtn: 'bg-emerald-700 hover:bg-emerald-800 text-white',
    actionBtnSolid: 'bg-white/15 hover:bg-white/25 text-white border border-white/20',
    unreadDot: 'bg-emerald-600',
  },
  {
    id: 'amber',
    label: 'Ambre',
    hex: '#d97706',
    swatchBg: 'bg-amber-600',
    softCard: 'bg-amber-50/95 border-amber-200',
    softIconBox: 'bg-amber-100 text-amber-800 border-amber-200/80',
    softTitle: 'text-amber-950',
    softBody: 'text-amber-900/85',
    softBadge: 'bg-amber-100 text-amber-800 border-amber-200',
    outlinedCard: 'bg-white border-amber-500 ring-1 ring-amber-500/20',
    outlinedIconBox: 'bg-amber-50 text-amber-700 border-amber-200',
    outlinedTitle: 'text-slate-900',
    outlinedBody: 'text-slate-600',
    solidCard: 'bg-amber-950 border-amber-800 text-white',
    solidIconBox: 'bg-amber-900 text-amber-200 border-amber-700',
    solidTitle: 'text-white',
    solidBody: 'text-amber-100',
    minimalCard: 'bg-white border-slate-200/90',
    minimalIconBox: 'bg-slate-100 text-amber-700 border-slate-200/80',
    minimalTitle: 'text-slate-900',
    minimalBody: 'text-slate-600',
    actionBtn: 'bg-amber-700 hover:bg-amber-800 text-white',
    actionBtnSolid: 'bg-white/15 hover:bg-white/25 text-white border border-white/20',
    unreadDot: 'bg-amber-600',
  },
  {
    id: 'orange',
    label: 'Orange',
    hex: '#ea580c',
    swatchBg: 'bg-orange-600',
    softCard: 'bg-orange-50/95 border-orange-200',
    softIconBox: 'bg-orange-100 text-orange-800 border-orange-200/80',
    softTitle: 'text-orange-950',
    softBody: 'text-orange-900/85',
    softBadge: 'bg-orange-100 text-orange-800 border-orange-200',
    outlinedCard: 'bg-white border-orange-500 ring-1 ring-orange-500/20',
    outlinedIconBox: 'bg-orange-50 text-orange-700 border-orange-200',
    outlinedTitle: 'text-slate-900',
    outlinedBody: 'text-slate-600',
    solidCard: 'bg-orange-950 border-orange-800 text-white',
    solidIconBox: 'bg-orange-900 text-orange-200 border-orange-700',
    solidTitle: 'text-white',
    solidBody: 'text-orange-100',
    minimalCard: 'bg-white border-slate-200/90',
    minimalIconBox: 'bg-slate-100 text-orange-700 border-slate-200/80',
    minimalTitle: 'text-slate-900',
    minimalBody: 'text-slate-600',
    actionBtn: 'bg-orange-700 hover:bg-orange-800 text-white',
    actionBtnSolid: 'bg-white/15 hover:bg-white/25 text-white border border-white/20',
    unreadDot: 'bg-orange-600',
  },
  {
    id: 'rose',
    label: 'Rouge corail',
    hex: '#e11d48',
    swatchBg: 'bg-rose-600',
    softCard: 'bg-rose-50/95 border-rose-200',
    softIconBox: 'bg-rose-100 text-rose-800 border-rose-200/80',
    softTitle: 'text-rose-950',
    softBody: 'text-rose-900/85',
    softBadge: 'bg-rose-100 text-rose-800 border-rose-200',
    outlinedCard: 'bg-white border-rose-500 ring-1 ring-rose-500/20',
    outlinedIconBox: 'bg-rose-50 text-rose-700 border-rose-200',
    outlinedTitle: 'text-slate-900',
    outlinedBody: 'text-slate-600',
    solidCard: 'bg-rose-950 border-rose-800 text-white',
    solidIconBox: 'bg-rose-900 text-rose-200 border-rose-700',
    solidTitle: 'text-white',
    solidBody: 'text-rose-100',
    minimalCard: 'bg-white border-slate-200/90',
    minimalIconBox: 'bg-slate-100 text-rose-700 border-slate-200/80',
    minimalTitle: 'text-slate-900',
    minimalBody: 'text-slate-600',
    actionBtn: 'bg-rose-700 hover:bg-rose-800 text-white',
    actionBtnSolid: 'bg-white/15 hover:bg-white/25 text-white border border-white/20',
    unreadDot: 'bg-rose-600',
  },
  {
    id: 'blue',
    label: 'Bleu océan',
    hex: '#2563eb',
    swatchBg: 'bg-blue-600',
    softCard: 'bg-blue-50/95 border-blue-200',
    softIconBox: 'bg-blue-100 text-blue-800 border-blue-200/80',
    softTitle: 'text-blue-950',
    softBody: 'text-blue-900/85',
    softBadge: 'bg-blue-100 text-blue-800 border-blue-200',
    outlinedCard: 'bg-white border-blue-500 ring-1 ring-blue-500/20',
    outlinedIconBox: 'bg-blue-50 text-blue-700 border-blue-200',
    outlinedTitle: 'text-slate-900',
    outlinedBody: 'text-slate-600',
    solidCard: 'bg-blue-950 border-blue-800 text-white',
    solidIconBox: 'bg-blue-900 text-blue-200 border-blue-700',
    solidTitle: 'text-white',
    solidBody: 'text-blue-100',
    minimalCard: 'bg-white border-slate-200/90',
    minimalIconBox: 'bg-slate-100 text-blue-700 border-slate-200/80',
    minimalTitle: 'text-slate-900',
    minimalBody: 'text-slate-600',
    actionBtn: 'bg-blue-700 hover:bg-blue-800 text-white',
    actionBtnSolid: 'bg-white/15 hover:bg-white/25 text-white border border-white/20',
    unreadDot: 'bg-blue-600',
  },
  {
    id: 'indigo',
    label: 'Indigo',
    hex: '#4f46e5',
    swatchBg: 'bg-indigo-600',
    softCard: 'bg-indigo-50/95 border-indigo-200',
    softIconBox: 'bg-indigo-100 text-indigo-800 border-indigo-200/80',
    softTitle: 'text-indigo-950',
    softBody: 'text-indigo-900/85',
    softBadge: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    outlinedCard: 'bg-white border-indigo-500 ring-1 ring-indigo-500/20',
    outlinedIconBox: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    outlinedTitle: 'text-slate-900',
    outlinedBody: 'text-slate-600',
    solidCard: 'bg-indigo-950 border-indigo-800 text-white',
    solidIconBox: 'bg-indigo-900 text-indigo-200 border-indigo-700',
    solidTitle: 'text-white',
    solidBody: 'text-indigo-100',
    minimalCard: 'bg-white border-slate-200/90',
    minimalIconBox: 'bg-slate-100 text-indigo-700 border-slate-200/80',
    minimalTitle: 'text-slate-900',
    minimalBody: 'text-slate-600',
    actionBtn: 'bg-indigo-700 hover:bg-indigo-800 text-white',
    actionBtnSolid: 'bg-white/15 hover:bg-white/25 text-white border border-white/20',
    unreadDot: 'bg-indigo-600',
  },
  {
    id: 'violet',
    label: 'Violet',
    hex: '#7c3aed',
    swatchBg: 'bg-violet-600',
    softCard: 'bg-violet-50/95 border-violet-200',
    softIconBox: 'bg-violet-100 text-violet-800 border-violet-200/80',
    softTitle: 'text-violet-950',
    softBody: 'text-violet-900/85',
    softBadge: 'bg-violet-100 text-violet-800 border-violet-200',
    outlinedCard: 'bg-white border-violet-500 ring-1 ring-violet-500/20',
    outlinedIconBox: 'bg-violet-50 text-violet-700 border-violet-200',
    outlinedTitle: 'text-slate-900',
    outlinedBody: 'text-slate-600',
    solidCard: 'bg-violet-950 border-violet-800 text-white',
    solidIconBox: 'bg-violet-900 text-violet-200 border-violet-700',
    solidTitle: 'text-white',
    solidBody: 'text-violet-100',
    minimalCard: 'bg-white border-slate-200/90',
    minimalIconBox: 'bg-slate-100 text-violet-700 border-slate-200/80',
    minimalTitle: 'text-slate-900',
    minimalBody: 'text-slate-600',
    actionBtn: 'bg-violet-700 hover:bg-violet-800 text-white',
    actionBtnSolid: 'bg-white/15 hover:bg-white/25 text-white border border-white/20',
    unreadDot: 'bg-violet-600',
  },
  {
    id: 'sky',
    label: 'Bleu ciel',
    hex: '#0284c7',
    swatchBg: 'bg-sky-600',
    softCard: 'bg-sky-50/95 border-sky-200',
    softIconBox: 'bg-sky-100 text-sky-800 border-sky-200/80',
    softTitle: 'text-sky-950',
    softBody: 'text-sky-900/85',
    softBadge: 'bg-sky-100 text-sky-800 border-sky-200',
    outlinedCard: 'bg-white border-sky-500 ring-1 ring-sky-500/20',
    outlinedIconBox: 'bg-sky-50 text-sky-700 border-sky-200',
    outlinedTitle: 'text-slate-900',
    outlinedBody: 'text-slate-600',
    solidCard: 'bg-sky-950 border-sky-800 text-white',
    solidIconBox: 'bg-sky-900 text-sky-200 border-sky-700',
    solidTitle: 'text-white',
    solidBody: 'text-sky-100',
    minimalCard: 'bg-white border-slate-200/90',
    minimalIconBox: 'bg-slate-100 text-sky-700 border-slate-200/80',
    minimalTitle: 'text-slate-900',
    minimalBody: 'text-slate-600',
    actionBtn: 'bg-sky-700 hover:bg-sky-800 text-white',
    actionBtnSolid: 'bg-white/15 hover:bg-white/25 text-white border border-white/20',
    unreadDot: 'bg-sky-600',
  },
  {
    id: 'slate',
    label: 'Ardoise',
    hex: '#334155',
    swatchBg: 'bg-slate-700',
    softCard: 'bg-slate-100/95 border-slate-300',
    softIconBox: 'bg-slate-200 text-slate-800 border-slate-300',
    softTitle: 'text-slate-900',
    softBody: 'text-slate-700',
    softBadge: 'bg-slate-200 text-slate-800 border-slate-300',
    outlinedCard: 'bg-white border-slate-600 ring-1 ring-slate-600/20',
    outlinedIconBox: 'bg-slate-100 text-slate-800 border-slate-300',
    outlinedTitle: 'text-slate-900',
    outlinedBody: 'text-slate-600',
    solidCard: 'bg-slate-900 border-slate-700 text-white',
    solidIconBox: 'bg-slate-800 text-slate-100 border-slate-700',
    solidTitle: 'text-white',
    solidBody: 'text-slate-300',
    minimalCard: 'bg-white border-slate-200/90',
    minimalIconBox: 'bg-slate-100 text-slate-700 border-slate-200/80',
    minimalTitle: 'text-slate-900',
    minimalBody: 'text-slate-600',
    actionBtn: 'bg-slate-800 hover:bg-slate-900 text-white',
    actionBtnSolid: 'bg-white/15 hover:bg-white/25 text-white border border-white/20',
    unreadDot: 'bg-slate-700',
  },
];

export function getNotificationColorTheme(colorOrId?: string): NotificationColorTheme {
  if (!colorOrId) return NOTIFICATION_COLOR_THEMES[0];
  const lower = colorOrId.trim().toLowerCase();
  const byId = NOTIFICATION_COLOR_THEMES.find(
    (c) => c.id === lower || c.hex.toLowerCase() === lower
  );
  if (byId) return byId;
  return NOTIFICATION_COLOR_THEMES[0];
}

export const NOTIFICATION_ICON_OPTIONS: { id: NotificationIconName; label: string }[] = [
  { id: 'Bell', label: 'Cloche' },
  { id: 'Package', label: 'Stock / Colis' },
  { id: 'AlertTriangle', label: 'Attention' },
  { id: 'Users', label: 'Clients / Équipe' },
  { id: 'Wallet', label: 'Caisse' },
  { id: 'TrendingUp', label: 'Croissance' },
  { id: 'Target', label: 'Objectif' },
  { id: 'BarChart3', label: 'Rapport' },
  { id: 'Cloud', label: 'Google Drive' },
  { id: 'Download', label: 'Sauvegarde' },
  { id: 'Clock', label: 'Horaire' },
  { id: 'CheckCircle2', label: 'Succès' },
  { id: 'Flame', label: 'Urgent' },
  { id: 'ShieldAlert', label: 'Sécurité' },
  { id: 'Sparkles', label: 'Félicitations' },
  { id: 'Calendar', label: 'Calendrier' },
];

export const NOTIFICATION_STYLE_OPTIONS: {
  id: NotificationStyleVariant;
  label: string;
  hint: string;
}[] = [
  { id: 'soft', label: 'Teinté doux', hint: 'Fond pastel léger assorti à la couleur' },
  { id: 'outlined', label: 'Bordure nette', hint: 'Fond blanc pur avec contour coloré' },
  { id: 'solid', label: 'Plein contrasté', hint: 'Fond foncé soutenu à haute visibilité' },
  { id: 'minimal', label: 'Épuré', hint: 'Carte sobre avec icône colorée' },
];

export const NOTIFICATION_FREQUENCY_OPTIONS: {
  id: NotificationFrequency;
  label: string;
}[] = [
  { id: 'instant', label: 'Dès changement d’état' },
  { id: 'every_6h', label: 'Au plus toutes les 6 h' },
  { id: 'daily', label: 'Une fois par jour maximum' },
  { id: 'weekly', label: 'Une fois par semaine maximum' },
];

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  stock: 'Stocks',
  debts: 'Dettes & Paie',
  finance: 'Finances & Objectifs',
  reports: 'Rapports',
  backup: 'Sauvegardes',
  custom: 'Personnalisées',
};

export const NOTIFICATION_ACTION_LABELS: Record<NotificationActionTarget, string> = {
  stock: 'Voir le stock',
  stock_prices: 'Voir les prix d’achat',
  debts: 'Ouvrir les dettes',
  earnings: 'Ouvrir la paie vendeurs',
  reserve: 'Ouvrir les caisses',
  owner_profit: 'Voir mon bénéfice',
  daily_incomplete: 'Compléter les saisies',
  daily_sales: 'Ouvrir les saisies',
  dashboard: 'Voir le tableau de bord',
  backup_settings: 'Ouvrir les sauvegardes',
  notification_settings: 'Paramètres notifications',
};

export interface TriggerTypeMetadata {
  triggerType: NotificationTriggerType;
  label: string;
  isCustomOption: boolean;
  defaultCategory: NotificationCategory;
  hasThreshold: boolean;
  thresholdLabel?: string;
  thresholdUnit?: string;
  defaultThreshold?: number;
  usesSchedule: boolean;
  defaultActionTarget: NotificationActionTarget;
  availableVars: { token: string; desc: string }[];
}

export const TRIGGER_METADATA: Record<NotificationTriggerType, TriggerTypeMetadata> = {
  builtin_stock_low: {
    triggerType: 'builtin_stock_low',
    label: 'Stock d’ingrédients ou emballages faible',
    isCustomOption: false,
    defaultCategory: 'stock',
    hasThreshold: true,
    thresholdLabel: 'Alerter en dessous de (fournées restantes)',
    thresholdUnit: 'fournées',
    defaultThreshold: 1,
    usesSchedule: false,
    defaultActionTarget: 'stock',
    availableVars: [
      { token: '{nb}', desc: 'Nombre d’articles bas' },
      { token: '{detail}', desc: 'Noms des articles concernés' },
      { token: '{seuil}', desc: 'Seuil en fournées' },
      { token: '{entreprise}', desc: 'Nom du business' },
    ],
  },
  builtin_stock_price_rise: {
    triggerType: 'builtin_stock_price_rise',
    label: 'Hausse du prix d’achat d’un ingrédient',
    isCustomOption: false,
    defaultCategory: 'stock',
    hasThreshold: true,
    thresholdLabel: 'Hausse minimale par rapport à l’achat précédent',
    thresholdUnit: '%',
    defaultThreshold: 5,
    usesSchedule: false,
    defaultActionTarget: 'stock_prices',
    availableVars: [
      { token: '{nb}', desc: 'Nombre d’articles en hausse' },
      { token: '{detail}', desc: 'Article et % de hausse' },
      { token: '{seuil}', desc: 'Seuil (%)' },
    ],
  },
  builtin_debts_overdue: {
    triggerType: 'builtin_debts_overdue',
    label: 'Dettes clients en retard',
    isCustomOption: false,
    defaultCategory: 'debts',
    hasThreshold: true,
    thresholdLabel: 'Retard supérieur à (jours)',
    thresholdUnit: 'jours',
    defaultThreshold: 2,
    usesSchedule: false,
    defaultActionTarget: 'debts',
    availableVars: [
      { token: '{nb}', desc: 'Nombre de clients en retard' },
      { token: '{montant}', desc: 'Montant total en retard (FC)' },
      { token: '{detail}', desc: 'Principaux clients concernés' },
      { token: '{seuil}', desc: 'Délai en jours' },
    ],
  },
  builtin_sellers_unpaid: {
    triggerType: 'builtin_sellers_unpaid',
    label: 'Commissions vendeur(se)s en attente',
    isCustomOption: false,
    defaultCategory: 'debts',
    hasThreshold: true,
    thresholdLabel: 'Jours non payés depuis plus de',
    thresholdUnit: 'jours',
    defaultThreshold: 7,
    usesSchedule: false,
    defaultActionTarget: 'earnings',
    availableVars: [
      { token: '{nb}', desc: 'Nombre total de jours non payés' },
      { token: '{montant}', desc: 'Total commissions dues (FC)' },
      { token: '{detail}', desc: 'Vendeur(se)s concerné(e)s' },
      { token: '{seuil}', desc: 'Seuil en jours' },
    ],
  },
  builtin_sales_target: {
    triggerType: 'builtin_sales_target',
    label: 'Progression de l’objectif mensuel de ventes',
    isCustomOption: false,
    defaultCategory: 'finance',
    hasThreshold: true,
    thresholdLabel: 'Alerter dès que l’objectif atteint',
    thresholdUnit: '%',
    defaultThreshold: 100,
    usesSchedule: false,
    defaultActionTarget: 'dashboard',
    availableVars: [
      { token: '{progression}', desc: '% atteint ce mois' },
      { token: '{montant}', desc: 'Ventes réalisées ce mois (FC)' },
      { token: '{seuil}', desc: 'Objectif mensuel (%)' },
      { token: '{detail}', desc: 'Cible mensuelle en FC' },
    ],
  },
  builtin_reserve_low: {
    triggerType: 'builtin_reserve_low',
    label: 'Alerte solde Caisse Réserve',
    isCustomOption: false,
    defaultCategory: 'finance',
    hasThreshold: true,
    thresholdLabel: 'Alerter si le solde descend sous',
    thresholdUnit: 'FC',
    defaultThreshold: 0,
    usesSchedule: false,
    defaultActionTarget: 'reserve',
    availableVars: [
      { token: '{montant}', desc: 'Solde actuel de la Réserve' },
      { token: '{seuil}', desc: 'Seuil minimal configuré' },
      { token: '{entreprise}', desc: 'Nom du business' },
    ],
  },
  builtin_loss_rate: {
    triggerType: 'builtin_loss_rate',
    label: 'Taux de pertes (abîmés) élevé ce mois',
    isCustomOption: false,
    defaultCategory: 'finance',
    hasThreshold: true,
    thresholdLabel: 'Taux de pertes maximal toléré',
    thresholdUnit: '%',
    defaultThreshold: 5,
    usesSchedule: false,
    defaultActionTarget: 'dashboard',
    availableVars: [
      { token: '{progression}', desc: 'Taux de pertes actuel (%)' },
      { token: '{montant}', desc: 'Valeur des abîmés ce mois (FC)' },
      { token: '{seuil}', desc: 'Seuil maximal (%)' },
    ],
  },
  builtin_incomplete_entries: {
    triggerType: 'builtin_incomplete_entries',
    label: 'Saisies journalières incomplètes',
    isCustomOption: false,
    defaultCategory: 'finance',
    hasThreshold: true,
    thresholdLabel: 'Nombre minimal de saisies à compléter',
    thresholdUnit: 'saisies',
    defaultThreshold: 1,
    usesSchedule: false,
    defaultActionTarget: 'daily_incomplete',
    availableVars: [
      { token: '{nb}', desc: 'Nombre de saisies incomplètes' },
      { token: '{detail}', desc: 'Vendeur(se)s et dates' },
    ],
  },
  builtin_report_daily: {
    triggerType: 'builtin_report_daily',
    label: 'Rapport quotidien des activités',
    isCustomOption: false,
    defaultCategory: 'reports',
    hasThreshold: false,
    usesSchedule: true,
    defaultActionTarget: 'dashboard',
    availableVars: [
      { token: '{montant}', desc: 'Ventes totales du jour' },
      { token: '{detail}', desc: 'Dépenses et saisies du jour' },
      { token: '{date}', desc: 'Date du jour' },
      { token: '{entreprise}', desc: 'Nom du business' },
    ],
  },
  builtin_report_weekly: {
    triggerType: 'builtin_report_weekly',
    label: 'Bilan hebdomadaire (7 derniers jours)',
    isCustomOption: false,
    defaultCategory: 'reports',
    hasThreshold: false,
    usesSchedule: true,
    defaultActionTarget: 'owner_profit',
    availableVars: [
      { token: '{montant}', desc: 'Ventes sur 7 jours' },
      { token: '{detail}', desc: 'Dépenses et solde Réserve' },
      { token: '{date}', desc: 'Date du bilan' },
    ],
  },
  builtin_backup_local: {
    triggerType: 'builtin_backup_local',
    label: 'Rappel de sauvegarde fichier JSON',
    isCustomOption: false,
    defaultCategory: 'backup',
    hasThreshold: true,
    thresholdLabel: 'Rappeler après N jours sans sauvegarde locale',
    thresholdUnit: 'jours',
    defaultThreshold: 7,
    usesSchedule: false,
    defaultActionTarget: 'backup_settings',
    availableVars: [
      { token: '{nb}', desc: 'Jours écoulés depuis la dernière sauvegarde' },
      { token: '{seuil}', desc: 'Seuil en jours' },
      { token: '{detail}', desc: 'Date de la dernière sauvegarde' },
    ],
  },
  builtin_backup_drive: {
    triggerType: 'builtin_backup_drive',
    label: 'Synchronisation Google Drive',
    isCustomOption: false,
    defaultCategory: 'backup',
    hasThreshold: true,
    thresholdLabel: 'Alerter si Drive n’a pas synchronisé depuis',
    thresholdUnit: 'heures',
    defaultThreshold: 24,
    usesSchedule: false,
    defaultActionTarget: 'backup_settings',
    availableVars: [
      { token: '{detail}', desc: 'État détaillé de Google Drive' },
      { token: '{date}', desc: 'Date / heure' },
      { token: '{seuil}', desc: 'Délai en heures' },
    ],
  },

  // --- RÈGLES PERSONNALISÉES DISPONIBLES ---
  custom_reserve_below: {
    triggerType: 'custom_reserve_below',
    label: 'Solde Caisse Réserve inférieur à un montant',
    isCustomOption: true,
    defaultCategory: 'custom',
    hasThreshold: true,
    thresholdLabel: 'Seuil minimal Caisse Réserve',
    thresholdUnit: 'FC',
    defaultThreshold: 50000,
    usesSchedule: false,
    defaultActionTarget: 'reserve',
    availableVars: [
      { token: '{montant}', desc: 'Solde actuel Réserve' },
      { token: '{seuil}', desc: 'Seuil configuré' },
      { token: '{entreprise}', desc: 'Nom du business' },
    ],
  },
  custom_benefices_above: {
    triggerType: 'custom_benefices_above',
    label: 'Solde Bénéfices personnels supérieur à un montant',
    isCustomOption: true,
    defaultCategory: 'custom',
    hasThreshold: true,
    thresholdLabel: 'Montant cible Bénéfices disponibles',
    thresholdUnit: 'FC',
    defaultThreshold: 100000,
    usesSchedule: false,
    defaultActionTarget: 'owner_profit',
    availableVars: [
      { token: '{montant}', desc: 'Solde Bénéfices actuel' },
      { token: '{seuil}', desc: 'Montant cible' },
    ],
  },
  custom_monthly_sales_pct: {
    triggerType: 'custom_monthly_sales_pct',
    label: 'Palier d’objectif mensuel atteint (%)',
    isCustomOption: true,
    defaultCategory: 'custom',
    hasThreshold: true,
    thresholdLabel: 'Palier de l’objectif mensuel',
    thresholdUnit: '%',
    defaultThreshold: 50,
    usesSchedule: false,
    defaultActionTarget: 'dashboard',
    availableVars: [
      { token: '{progression}', desc: '% atteint' },
      { token: '{montant}', desc: 'Ventes du mois' },
      { token: '{seuil}', desc: 'Palier (%)' },
    ],
  },
  custom_daily_sales_above: {
    triggerType: 'custom_daily_sales_above',
    label: 'Ventes du jour supérieures à un montant',
    isCustomOption: true,
    defaultCategory: 'custom',
    hasThreshold: true,
    thresholdLabel: 'Montant de ventes journalières',
    thresholdUnit: 'FC',
    defaultThreshold: 50000,
    usesSchedule: false,
    defaultActionTarget: 'daily_sales',
    availableVars: [
      { token: '{montant}', desc: 'Ventes du jour' },
      { token: '{seuil}', desc: 'Objectif du jour' },
      { token: '{date}', desc: 'Date du jour' },
    ],
  },
  custom_overdue_debts_count: {
    triggerType: 'custom_overdue_debts_count',
    label: 'Nombre de clients en retard ≥ N',
    isCustomOption: true,
    defaultCategory: 'custom',
    hasThreshold: true,
    thresholdLabel: 'Nombre minimal de clients en retard',
    thresholdUnit: 'clients',
    defaultThreshold: 3,
    usesSchedule: false,
    defaultActionTarget: 'debts',
    availableVars: [
      { token: '{nb}', desc: 'Nombre de clients en retard' },
      { token: '{montant}', desc: 'Montant dû en retard' },
      { token: '{detail}', desc: 'Noms des clients' },
    ],
  },
  custom_total_debts_above: {
    triggerType: 'custom_total_debts_above',
    label: 'Encours total des dettes clients supérieur à un montant',
    isCustomOption: true,
    defaultCategory: 'custom',
    hasThreshold: true,
    thresholdLabel: 'Plafond total des crédits clients',
    thresholdUnit: 'FC',
    defaultThreshold: 100000,
    usesSchedule: false,
    defaultActionTarget: 'debts',
    availableVars: [
      { token: '{montant}', desc: 'Total dettes en cours' },
      { token: '{nb}', desc: 'Nombre de débiteurs' },
      { token: '{seuil}', desc: 'Plafond configuré' },
    ],
  },
  custom_low_stock_count: {
    triggerType: 'custom_low_stock_count',
    label: 'Nombre d’ingrédients en stock faible ≥ N',
    isCustomOption: true,
    defaultCategory: 'custom',
    hasThreshold: true,
    thresholdLabel: 'Nombre d’articles en alerte stock',
    thresholdUnit: 'articles',
    defaultThreshold: 2,
    usesSchedule: false,
    defaultActionTarget: 'stock',
    availableVars: [
      { token: '{nb}', desc: 'Articles en stock faible' },
      { token: '{detail}', desc: 'Liste des articles' },
    ],
  },
  custom_loss_rate_above: {
    triggerType: 'custom_loss_rate_above',
    label: 'Taux de pertes mensuel supérieur à X %',
    isCustomOption: true,
    defaultCategory: 'custom',
    hasThreshold: true,
    thresholdLabel: 'Seuil de pertes',
    thresholdUnit: '%',
    defaultThreshold: 3,
    usesSchedule: false,
    defaultActionTarget: 'dashboard',
    availableVars: [
      { token: '{progression}', desc: 'Taux de pertes (%)' },
      { token: '{montant}', desc: 'Valeur pertes (FC)' },
      { token: '{seuil}', desc: 'Seuil (%)' },
    ],
  },
  custom_incomplete_entries: {
    triggerType: 'custom_incomplete_entries',
    label: 'Saisies incomplètes ≥ N',
    isCustomOption: true,
    defaultCategory: 'custom',
    hasThreshold: true,
    thresholdLabel: 'Nombre minimal de saisies à compléter',
    thresholdUnit: 'saisies',
    defaultThreshold: 2,
    usesSchedule: false,
    defaultActionTarget: 'daily_incomplete',
    availableVars: [
      { token: '{nb}', desc: 'Saisies incomplètes' },
      { token: '{detail}', desc: 'Vendeur(se)s concerné(e)s' },
    ],
  },
  custom_scheduled_reminder: {
    triggerType: 'custom_scheduled_reminder',
    label: 'Rappel programmé à heure fixe (inventaire, point caisse…)',
    isCustomOption: true,
    defaultCategory: 'custom',
    hasThreshold: false,
    usesSchedule: true,
    defaultActionTarget: 'dashboard',
    availableVars: [
      { token: '{entreprise}', desc: 'Nom du business' },
      { token: '{date}', desc: 'Date du jour' },
      { token: '{heure}', desc: 'Heure actuelle' },
      { token: '{montant}', desc: 'Ventes du jour' },
    ],
  },
};

export const DEFAULT_IN_APP_MODE: InAppNotificationModeSettings = {
  enabled: true,
  durationSeconds: 5,
  position: 'top',
  soundEnabled: false,
  showToasts: true,
};

export const DEFAULT_SYSTEM_MODE: SystemNotificationModeSettings = {
  enabled: false,
  vibrate: true,
  requireInteraction: false,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '06:30',
  backgroundSyncEnabled: true,
};

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export function getDefaultNotificationRules(appSettings?: Partial<AppSettings>): NotificationRule[] {
  const now = 1730000000000;
  return [
    {
      id: 'rule_stock_low',
      isCustom: false,
      enabled: true,
      name: 'Stock d’ingrédients faible',
      description: 'Prévient dès qu’un ingrédient ou emballage suivi passe sous le seuil de fournées.',
      category: 'stock',
      triggerType: 'builtin_stock_low',
      titleTemplate: 'Stock faible ({nb} article(s))',
      messageTemplate: 'À réapprovisionner : {detail} (moins de {seuil} fournée(s) restante(s)).',
      color: 'amber',
      icon: 'Package',
      styleVariant: 'soft',
      channels: { inApp: true, system: true },
      thresholdValue: appSettings?.stockLowBatches ?? 1,
      frequency: 'daily',
      activeDays: ALL_DAYS,
      actionTarget: 'stock',
      createdAt: now + 1,
      updatedAt: now + 1,
    },
    {
      id: 'rule_stock_price_rise',
      isCustom: false,
      enabled: true,
      name: 'Hausse de prix d’achat',
      description: 'Signale une augmentation inhabituelle du prix d’achat d’un ingrédient ou emballage.',
      category: 'stock',
      triggerType: 'builtin_stock_price_rise',
      titleTemplate: 'Hausse de prix détectée',
      messageTemplate: '{detail} dépasse le seuil de +{seuil} % par rapport au dernier achat.',
      color: 'orange',
      icon: 'TrendingUp',
      styleVariant: 'soft',
      channels: { inApp: true, system: false },
      thresholdValue: appSettings?.priceRiseAlertPct ?? 5,
      frequency: 'instant',
      activeDays: ALL_DAYS,
      actionTarget: 'stock_prices',
      createdAt: now + 2,
      updatedAt: now + 2,
    },
    {
      id: 'rule_debts_overdue',
      isCustom: false,
      enabled: true,
      name: 'Dettes clients en retard',
      description: 'Rappelle les crédits clients non réglés après le délai autorisé.',
      category: 'debts',
      triggerType: 'builtin_debts_overdue',
      titleTemplate: '{nb} dette(s) client en retard',
      messageTemplate: 'Total en retard : {montant} ({detail}) — délai dépassé de plus de {seuil} jour(s).',
      color: 'rose',
      icon: 'Users',
      styleVariant: 'soft',
      channels: { inApp: true, system: true },
      thresholdValue: appSettings?.debtReminderDays ?? 2,
      frequency: 'daily',
      activeDays: ALL_DAYS,
      actionTarget: 'debts',
      createdAt: now + 3,
      updatedAt: now + 3,
    },
    {
      id: 'rule_sellers_unpaid',
      isCustom: false,
      enabled: true,
      name: 'Jours vendeur(se)s à payer',
      description: 'Rappelle les commissions vendeur(se)s en attente depuis plus de N jours.',
      category: 'debts',
      triggerType: 'builtin_sellers_unpaid',
      titleTemplate: 'Paie vendeur(se)s en attente ({nb} j)',
      messageTemplate: '{montant} à régler pour {detail} (plus de {seuil} jours écoulés).',
      color: 'indigo',
      icon: 'Wallet',
      styleVariant: 'soft',
      channels: { inApp: true, system: false },
      thresholdValue: appSettings?.unpaidDaysReminder ?? 7,
      frequency: 'daily',
      activeDays: ALL_DAYS,
      actionTarget: 'earnings',
      createdAt: now + 4,
      updatedAt: now + 4,
    },
    {
      id: 'rule_sales_target',
      isCustom: false,
      enabled: true,
      name: 'Objectif mensuel atteint',
      description: 'Célèbre le franchissement du pourcentage cible des ventes mensuelles.',
      category: 'finance',
      triggerType: 'builtin_sales_target',
      titleTemplate: 'Objectif mensuel à {progression} %',
      messageTemplate: 'Bravo ! Les ventes du mois atteignent {montant} sur l’objectif de {detail}.',
      color: 'emerald',
      icon: 'Target',
      styleVariant: 'solid',
      channels: { inApp: true, system: true },
      thresholdValue: 100,
      frequency: 'instant',
      activeDays: ALL_DAYS,
      actionTarget: 'dashboard',
      createdAt: now + 5,
      updatedAt: now + 5,
    },
    {
      id: 'rule_reserve_low',
      isCustom: false,
      enabled: true,
      name: 'Caisse Réserve négative ou basse',
      description: 'Alerte lorsque la Caisse Réserve passe sous le seuil de sécurité.',
      category: 'finance',
      triggerType: 'builtin_reserve_low',
      titleTemplate: 'Attention : Caisse Réserve à {montant}',
      messageTemplate: 'Le solde de la Caisse Réserve est passé sous le seuil de {seuil}.',
      color: 'rose',
      icon: 'AlertTriangle',
      styleVariant: 'outlined',
      channels: { inApp: true, system: true },
      thresholdValue: 0,
      frequency: 'daily',
      activeDays: ALL_DAYS,
      actionTarget: 'reserve',
      createdAt: now + 6,
      updatedAt: now + 6,
    },
    {
      id: 'rule_loss_rate',
      isCustom: false,
      enabled: true,
      name: 'Taux de pertes (abîmés) élevé',
      description: 'Prévient si la part de produits abîmés du mois dépasse la limite fixée.',
      category: 'finance',
      triggerType: 'builtin_loss_rate',
      titleTemplate: 'Pertes du mois à {progression} %',
      messageTemplate: 'Les produits abîmés représentent {montant} ce mois (seuil : {seuil} %).',
      color: 'orange',
      icon: 'Flame',
      styleVariant: 'soft',
      channels: { inApp: true, system: false },
      thresholdValue: appSettings?.lossAlertThresholdPct ?? 5,
      frequency: 'daily',
      activeDays: ALL_DAYS,
      actionTarget: 'dashboard',
      createdAt: now + 7,
      updatedAt: now + 7,
    },
    {
      id: 'rule_incomplete_entries',
      isCustom: false,
      enabled: true,
      name: 'Saisies journalières à compléter',
      description: 'Rappelle les feuilles de route enregistrées sans les retours ou invendus.',
      category: 'finance',
      triggerType: 'builtin_incomplete_entries',
      titleTemplate: '{nb} saisie(s) à compléter',
      messageTemplate: 'Pensez à finaliser les retours de : {detail}.',
      color: 'amber',
      icon: 'Clock',
      styleVariant: 'minimal',
      channels: { inApp: true, system: false },
      thresholdValue: 1,
      frequency: 'daily',
      activeDays: ALL_DAYS,
      actionTarget: 'daily_incomplete',
      createdAt: now + 8,
      updatedAt: now + 8,
    },
    {
      id: 'rule_report_daily',
      isCustom: false,
      enabled: false,
      name: 'Rapport récapitulatif du soir',
      description: 'Envoie chaque soir le résumé automatique des ventes et dépenses du jour.',
      category: 'reports',
      triggerType: 'builtin_report_daily',
      titleTemplate: 'Bilan du jour ({date})',
      messageTemplate: 'Ventes du jour : {montant} · {detail}.',
      color: 'teal',
      icon: 'BarChart3',
      styleVariant: 'soft',
      channels: { inApp: true, system: true },
      frequency: 'daily',
      preferredTime: '19:30',
      activeDays: ALL_DAYS,
      actionTarget: 'dashboard',
      createdAt: now + 9,
      updatedAt: now + 9,
    },
    {
      id: 'rule_report_weekly',
      isCustom: false,
      enabled: false,
      name: 'Bilan hebdomadaire',
      description: 'Synthèse des 7 derniers jours (ventes, dépenses et solde Réserve).',
      category: 'reports',
      triggerType: 'builtin_report_weekly',
      titleTemplate: 'Bilan des 7 derniers jours',
      messageTemplate: 'Ventes 7j : {montant} · {detail}.',
      color: 'blue',
      icon: 'Calendar',
      styleVariant: 'soft',
      channels: { inApp: true, system: true },
      frequency: 'weekly',
      preferredTime: '18:00',
      activeDays: [0], // Dimanche par défaut
      actionTarget: 'owner_profit',
      createdAt: now + 10,
      updatedAt: now + 10,
    },
    {
      id: 'rule_backup_local',
      isCustom: false,
      enabled: true,
      name: 'Rappel de sauvegarde JSON',
      description: 'Prévient si aucune sauvegarde locale JSON n’a été téléchargée récemment.',
      category: 'backup',
      triggerType: 'builtin_backup_local',
      titleTemplate: 'Sauvegarde locale recommandée',
      messageTemplate: '{detail}. Exportez un fichier JSON pour sécuriser vos données.',
      color: 'sky',
      icon: 'Download',
      styleVariant: 'soft',
      channels: { inApp: true, system: true },
      thresholdValue: 7,
      frequency: 'daily',
      activeDays: ALL_DAYS,
      actionTarget: 'backup_settings',
      createdAt: now + 11,
      updatedAt: now + 11,
    },
    {
      id: 'rule_backup_drive',
      isCustom: false,
      enabled: true,
      name: 'Suivi Google Drive',
      description: 'Alerte en cas de reconnexion requise ou de retard de synchronisation Drive.',
      category: 'backup',
      triggerType: 'builtin_backup_drive',
      titleTemplate: 'Synchronisation Google Drive',
      messageTemplate: '{detail}',
      color: 'blue',
      icon: 'Cloud',
      styleVariant: 'outlined',
      channels: { inApp: true, system: true },
      thresholdValue: 24,
      frequency: 'every_6h',
      activeDays: ALL_DAYS,
      actionTarget: 'backup_settings',
      createdAt: now + 12,
      updatedAt: now + 12,
    },
  ];
}

export function resolveNotificationSettings(appSettings?: Partial<AppSettings>): NotificationSettings {
  const raw = appSettings?.notificationSettings;
  const defaults = getDefaultNotificationRules(appSettings);

  const inAppMode: InAppNotificationModeSettings = {
    enabled: raw?.inAppMode?.enabled ?? DEFAULT_IN_APP_MODE.enabled,
    durationSeconds:
      typeof raw?.inAppMode?.durationSeconds === 'number' &&
      raw.inAppMode.durationSeconds >= 2 &&
      raw.inAppMode.durationSeconds <= 15
        ? raw.inAppMode.durationSeconds
        : DEFAULT_IN_APP_MODE.durationSeconds,
    position: raw?.inAppMode?.position === 'bottom' ? 'bottom' : 'top',
    soundEnabled: Boolean(raw?.inAppMode?.soundEnabled),
    showToasts: raw?.inAppMode?.showToasts !== false,
  };

  const systemMode: SystemNotificationModeSettings = {
    enabled: Boolean(raw?.systemMode?.enabled),
    vibrate: raw?.systemMode?.vibrate !== false,
    requireInteraction: Boolean(raw?.systemMode?.requireInteraction),
    quietHoursEnabled: Boolean(raw?.systemMode?.quietHoursEnabled),
    quietHoursStart:
      typeof raw?.systemMode?.quietHoursStart === 'string' && raw.systemMode.quietHoursStart
        ? raw.systemMode.quietHoursStart
        : DEFAULT_SYSTEM_MODE.quietHoursStart,
    quietHoursEnd:
      typeof raw?.systemMode?.quietHoursEnd === 'string' && raw.systemMode.quietHoursEnd
        ? raw.systemMode.quietHoursEnd
        : DEFAULT_SYSTEM_MODE.quietHoursEnd,
    backgroundSyncEnabled: raw?.systemMode?.backgroundSyncEnabled !== false,
  };

  if (!raw || !Array.isArray(raw.rules)) {
    return {
      inAppMode,
      systemMode,
      rules: defaults,
    };
  }

  const savedById = new Map<string, NotificationRule>();
  for (const r of raw.rules) {
    if (r && typeof r === 'object' && r.id) {
      savedById.set(r.id, r);
    }
  }

  // Conserver toutes les règles système (avec les personnalisations enregistrées) + règles personnalisées
  const mergedBuiltIns = defaults.map((defRule) => {
    const saved = savedById.get(defRule.id);
    if (!saved) return defRule;
    return {
      ...defRule,
      ...saved,
      id: defRule.id,
      isCustom: false,
      triggerType: defRule.triggerType,
      channels: {
        inApp: saved.channels?.inApp ?? defRule.channels.inApp,
        system: saved.channels?.system ?? defRule.channels.system,
      },
    };
  });

  const customRules = raw.rules.filter(
    (r) => r && typeof r === 'object' && r.isCustom && !defaults.some((d) => d.id === r.id)
  );

  return {
    inAppMode,
    systemMode,
    rules: [...mergedBuiltIns, ...customRules],
  };
}

export function sanitizeNotificationSettings(
  raw: unknown,
  appSettings?: Partial<AppSettings>
): NotificationSettings | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  return resolveNotificationSettings({
    ...(appSettings || {}),
    notificationSettings: raw as NotificationSettings,
  });
}

export function renderNotificationTemplate(
  template: string,
  vars: Record<string, string | number>
): string {
  if (!template) return '';
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return String(vars[key]);
    }
    return match;
  });
}

/**
 * Petit carillon synthétisé localement via Web Audio API (100 % hors ligne, aucun fichier audio externe).
 */
export function playNotificationChime(): void {
  try {
    if (typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.setValueAtTime(880, now + 0.09); // A5
    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.34);

    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 500);
  } catch {
    // Ignorer si l'audio est bloqué avant geste utilisateur
  }
}
