export interface Employee {
  id: string;
  name: string;
  phone?: string;
  commissionRate: number; // e.g. 20 for 20%
  startDate: string; // YYYY-MM-DD
  note?: string;
  isArchived: boolean;
  createdAt: number;
}

export interface Product {
  id: string;
  name: string;
  defaultPrice: number; // in FC, e.g. 1000 for Bouteille, 500 for Sachet 03
  isActive: boolean;
  sortOrder: number;
  createdAt: number;
}

export interface DailyEntryItem {
  productId: string;
  productName: string;
  unitPrice: number; // frozen at time of entry
  previousRest: number; // Reste veille (repris automatiquement ou saisi)
  delivered: number; // Nouvelles livraisons
  totalToSell: number; // previousRest + delivered
  sold: number; // Quantité vendue
  damaged: number; // Quantité abîmée
  rest: number; // totalToSell - sold - damaged
}

export interface DailyEntry {
  id: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:mm (heure locale 24h)
  deliveryTime?: string; // HH:mm (heure de livraison optionnelle)
  returnTime?: string; // HH:mm (heure de retour optionnelle)
  employeeId: string;
  employeeName: string;
  employeeCommissionRate: number; // frozen at entry time (e.g. 25%)
  items: DailyEntryItem[];
  totalSalesFC: number; // Sum of sold * unitPrice
  totalDamagedFC: number; // Sum of damaged * unitPrice
  employeeCommissionFC: number; // employeeCommissionRate% * totalSalesFC
  expenseReserveRate: number; // e.g. 50%
  expenseReserveFC: number; // expenseReserveRate% * totalSalesFC
  ownerShareRate: number; // 100% - expenseReserveRate - employeeCommissionRate
  ownerShareFC: number; // ownerShareRate% * totalSalesFC
  notes?: string;
  status?: 'validated' | 'incomplete';
  missingFields?: ('sold' | 'damaged')[];
  createdAt: number;
}

export interface ProductionItem {
  productId: string;
  productName: string;
  producedQty: number;
}

export interface ProductionCostLine {
  itemId: string;
  name: string;
  qty: number;
  usageUnit: string;
  unitCostFC: number;
  totalFC: number;
}

export interface ProductionPackagingLineSnapshot {
  itemId: string;
  name: string;
  qtyPerUnit: number;
  totalQty: number;
  usageUnit: string;
  unitCostFC: number;
  totalFC: number;
}

export interface ProductionProductCostSnapshot {
  productId: string;
  productName: string;
  producedQty: number;
  volumeWeight: number;
  packagingUnitCostFC: number;
  packagingTotalFC: number;
  packagingLines?: ProductionPackagingLineSnapshot[];
  ingredientShareFC: number;
  unitCostFC: number;
  sellPriceFC: number;
  revenueFC: number;
}

export interface ProductionCostPackagingLine {
  itemId: string;
  name: string;
  qty: number;
}

export interface ProductionCosting {
  lines: ProductionCostLine[];
  packagingLines?: ProductionCostPackagingLine[];
  ingredientsFC: number;
  packagingFC: number;
  totalCostFC: number;
  sellPrices: Record<string, number>; // par productId
  revenueFC: number;
  gainFC: number;
  commissionLabel: string;
  commissionPct: number;
  netGainFC: number;
  sellerId?: string;
  productBreakdown?: ProductionProductCostSnapshot[];
}

export interface ProductionEntry {
  id: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:mm (heure locale 24h)
  items: ProductionItem[];
  notes?: string;
  costing?: ProductionCosting;
  createdAt: number;
}

export interface ExpenseIngredientLine {
  itemId: string;
  name: string;
  purchaseQty: number; // unités d'achat
  usageQty: number; // unités d'utilisation = purchaseQty × usageUnitsPerPurchase au moment de l'achat
  amountFC: number;
}

export interface Expense {
  id: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:mm (heure locale 24h)
  amountFC: number;
  category: string;
  detail: string;
  ingredientLines?: ExpenseIngredientLine[];
  otherFeesFC?: number;
  supplier?: string;
  createdAt: number;
}

export interface ReserveMovement {
  id: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:mm (heure locale 24h)
  amountFC: number; // nombre positif
  type: 'ajout' | 'retrait';
  reason: string; // motif, texte libre
  caisse?: 'reserve' | 'benefices'; // défaut 'reserve' si absent
  source?: 'personnel' | 'benefices'; // pour les ajouts à la Réserve, défaut 'personnel' si absent
  createdAt: number;
}

export type SellerPaymentType = 'advance' | 'salary' | 'final' | 'by_days';

export type SellerPaymentMode = 'especes' | 'mobile_money' | 'autre';

export interface PaymentCoveredItem {
  entryId: string;
  date: string; // YYYY-MM-DD
  commissionFC: number; // commission de la saisie figée au moment du paiement
}

export interface PayrollClosure {
  employeeId: string;
  month: string; // YYYY-MM
  closedAt: number;
  forgivenFC?: number;
}

export interface Payment {
  id: string;
  employeeId: string;
  employeeName: string;
  month: string; // YYYY-MM
  date: string; // YYYY-MM-DD
  time?: string; // HH:mm (heure locale 24h)
  amountFC: number;
  paymentType: SellerPaymentType; // Avance, Règlement, Solde final ou Paiement par jours
  paymentMode?: SellerPaymentMode; // Espèces, Mobile money, Autre (optionnel)
  coveredItems?: PaymentCoveredItem[]; // Saisies payées par ce paiement
  periodFrom?: string; // YYYY-MM-DD (première date couverte)
  periodTo?: string; // YYYY-MM-DD (dernière date couverte)
  notes?: string;
  createdAt: number;
}

export interface PersonalSaleItem {
  productId: string;
  productName: string;
  unitPrice: number;
  soldQty: number;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  note?: string;
  createdAt: number;
}

export interface DebtPayment {
  id: string;
  customerId: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:mm (heure locale 24h)
  amountFC: number;
  note?: string;
  createdAt: number;
}

export type ReceiptPaymentMode = 'especes' | 'mobile_money' | 'credit';

export interface PersonalSaleReceipt {
  no: number;
  date: string; // YYYY-MM-DD
  time?: string; // HH:mm (heure locale 24h)
  phone?: string;
  paymentMode: ReceiptPaymentMode; // Espèces, Mobile money, À crédit (information seulement)
  paidNotedFC: number; // Payé noté sur le reçu (information seulement)
  createdAt: number;
}

export interface PersonalSale {
  id: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:mm (heure locale 24h)
  items: PersonalSaleItem[];
  totalSalesFC: number;
  ownerCommissionRate: number; // ma commission %
  ownerCommissionFC: number; // ma commission de vendeur FC
  expenseReserveRate: number; // part réserve %
  expenseReserveFC: number; // part réserve FC
  ownerShareRate: number; // part gérant % (= 100 - réserve - commission)
  ownerShareFC: number; // part gérant FC
  kind?: 'vente' | 'consommation'; // Défaut 'vente' si absent
  consumptionValueFC?: number; // Valeur de la consommation au prix complet (somme des quantité × prix unitaire)
  consumptionPaidFC?: number; // Montant payé par mes bénéfices (et reçu par la Caisse Réserve)
  paymentStatus?: 'paid' | 'credit'; // absent = 'paid' (jamais 'credit' pour une consommation)
  customerId?: string;
  customerName?: string;
  isOpeningDebt?: boolean;
  writtenOffFC?: number; // reste abandonné
  writtenOffAt?: number;
  receipt?: PersonalSaleReceipt; // Reçu attaché (information uniquement)
  notes?: string;
  createdAt: number;
}

export type StockAdjustmentReason =
  | 'renverse'
  | 'perime'
  | 'erreur_comptage'
  | 'don'
  | 'autre';

export interface StockAdjustment {
  id: string;
  itemId: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:mm (heure locale 24h)
  qtyDelta: number; // en unités d'utilisation, positif ou négatif
  reason: StockAdjustmentReason;
  note?: string;
  createdAt: number;
}

export interface CostItem {
  id: string;
  kind: 'ingredient' | 'packaging';
  name: string;
  purchaseUnit: string; // texte libre, ex. "paquet", "bouteille"
  purchasePriceFC: number;
  usageUnit: string; // texte libre, ex. "boîte", "sachet", "bouchon"
  usageUnitsPerPurchase: number; // nombre > 0 : combien d'unités d'utilisation contient un achat
  allowDecimals: boolean; // accepte ou non les quantités avec virgule
  trackStock?: boolean; // true par défaut
  expenseCategory?: string; // catégorie de dépense associée
  autoUpdateRefPrice?: boolean; // false par défaut
  isActive: boolean;
  createdAt: number;
}

export interface ProductPackagingLine {
  itemId: string;
  qtyPerUnit: number;
}

export interface ProductCostConfig {
  volumeWeight: number; // nombre > 0, 1 par défaut : volume relatif, ex. sachet = 1, bouteille = 2
  packaging: ProductPackagingLine[];
}

export interface AppSettings {
  id: string; // 'app_settings'
  businessName: string; // Default: 'Yaourt Gestion'
  currency: string; // Default: 'FC'
  expenseReservePct: number; // Default: 50
  monthlySalesTargetFC: number; // Default: 1000000 FC
  lossAlertThresholdPct: number; // Default: 5.0%
  pinCode: string; // Salted SHA-256 hash ('sha256$<salt>$<hash>'), '' if disabled (or legacy 4 digits before migration)
  recoveryCodeHash?: string; // Salted SHA-256 hash of 12-char recovery code (never plaintext)
  pinFailedAttempts?: number; // Consecutive wrong PIN or recovery attempts
  pinLockoutCount?: number; // Escalating lockout tier (1 -> 1 min, 2 -> 5 min, >=3 -> 15 min)
  pinLockoutUntil?: number; // Timestamp (ms) until which PIN/recovery input is blocked
  pinDeleteFailedAttempts?: number; // Consecutive wrong PIN attempts in protected deletions (max 3)
  pinDeleteLockoutUntil?: number; // Timestamp (ms) until which protected deletions are blocked (30s)
  expenseCategories: string[];
  lastBackupDate: string | null;
  payslipSettings?: PayslipSettings;
  // Point de départ des caisses (optionnel)
  caisseStartDate?: string; // YYYY-MM-DD
  caisseStartReserveFC?: number; // Solde de départ Caisse Réserve
  caisseStartBeneficesFC?: number; // Solde de départ Caisse Bénéfices personnels
  caisseStartVendeursFC?: number; // Solde de départ Caisse Vendeurs
  caisseStartNormaleFC?: number; // Rétro-compatibilité
  caisseStartCapitalFC?: number; // Rétro-compatibilité
  // Commission sur ventes personnelles (optionnel, 0 par défaut)
  ownerCommissionPct?: number;
  // Part payée pour ma consommation (optionnel, égal à expenseReservePct par défaut)
  consumptionPaidPct?: number;
  // Délai avant rappel de dette en jours (par défaut 2)
  debtReminderDays?: number;
  // Rappel : jours non payés des vendeur(se)s depuis plus de N jours (par défaut 7)
  unpaidDaysReminder?: number;
  // Clôtures mensuelles de paie des vendeur(se)s (optionnel)
  payrollClosures?: Record<string, PayrollClosure> | PayrollClosure[];
  // Logo personnalisé de l'application (base64)
  appLogoBase64?: string;
  // Coût de revient : ingrédients et emballages (estimation uniquement, optionnel)
  costItems?: CostItem[];
  productCosting?: Record<string, ProductCostConfig>;
  // Suivi du stock d'ingrédients et emballages (optionnel)
  stockStartDate?: string; // YYYY-MM-DD
  stockStart?: Record<string, number>; // { [itemId]: quantité en unités d'utilisation }
  stockLowBatches?: number; // 1 par défaut
  priceRiseAlertPct?: number; // 5 par défaut
  dismissedPriceAlertKeys?: Record<string, string>; // alertes de hausse de prix ignorées par itemId
  // Réglages des reçus et prix de gros (optionnel)
  receiptSettings?: ReceiptSettings;
  wholesaleTiers?: Record<string, WholesaleTier[]>;
  // Sauvegarde automatique Google Drive (optionnel, jamais exporté ni écrasé à l'import)
  driveBackup?: DriveBackupSettings;
  // Paramètres personnalisés du système de notifications (optionnel)
  notificationSettings?: NotificationSettings;
}

export interface DriveBackupSettings {
  connected: boolean;
  folderId?: string;
  lastSuccessAt?: number | null;
  lastAttemptAt?: number | null;
  lastError?: string | null;
  lastContentHash?: string | null;
  autoEnabled?: boolean; // true par défaut
}

export interface WholesaleTier {
  minQty: number;
  priceFC: number;
}

export interface ReceiptSettings {
  businessName?: string; // Défaut : settings.businessName
  tagline?: string;
  address?: string;
  phone?: string;
  email?: string;
  idNat?: string;
  rccm?: string;
  taxId?: string;
  mainColor?: string; // Défaut : '#B88714'
  thankYouMessage?: string; // Défaut : 'Merci pour votre confiance'
  footerMention?: string; // Défaut : 'Marchandise vendue : ni reprise ni échangée. Produit frais : à conserver entre 2 et 6 °C.'
  printedProductIds?: string[]; // Jusqu'à 4 produits imprimés dans le tableau, par défaut les 2 premiers produits actifs
  startNumber?: number; // Défaut : 1
  printedUpTo?: number; // Dernier numéro imprimé, défaut : 0
  voidedNumbers?: number[]; // Liste de numéros annulés
}

export interface PayslipSettings {
  logoBase64?: string; // image/png or image/jpeg base64
  logoPosition?: 'left' | 'center' | 'right'; // Default: left
  bgImageBase64?: string; // image/png or image/jpeg base64
  bgOpacityPct?: number; // 5 to 40, Default: 15
  businessName?: string; // Default: settings.businessName
  documentTitle?: string; // Default: 'Document officiel de décompte mensuel'
  headerContact?: string; // Tél / adresse / contact optionnels
  footerNote?: string; // Note libre multi-ligne en bas
  primaryColorHex?: string; // Hex color code e.g. '#0d9488'
  employeeSignatureLabel?: string; // Default: 'Signature du/de la vendeur(se)'
  employeeSignatureSubtext?: string; // Default: '(Précédé de la mention "Bon pour accord")'
  ownerSignatureLabel?: string; // Default: 'Signature du gérant / propriétaire'
  ownerSignatureSubtext?: string; // Default: '(Précédé de la mention "Payé / Validé")'
  showDeliveryCol?: boolean; // Default: true
  showDamagedCol?: boolean; // Default: true
  showEmployeePhone?: boolean; // Default: true
  showCommissionRate?: boolean; // Default: true
  showSignatureZones?: boolean; // Default: true
}

export type PeriodFilterType = 'today' | 'this_week' | 'this_month' | 'last_month' | 'custom';

export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

export type TrashKind =
  | 'dailyEntry'
  | 'personalSale'
  | 'production'
  | 'expense'
  | 'payment'
  | 'reserveMovement'
  | 'debtPayment'
  | 'customer'
  | 'stockAdjustment';

export interface TrashItem<T = any> {
  id: string;
  kind: TrashKind;
  originalId: string;
  label: string;
  originalDate: string; // YYYY-MM-DD
  time?: string; // HH:mm calculé à partir de deletedAt (affichage seulement)
  amountFC?: number;
  payload: T;
  deletedAt: number;
  restoredAt?: number;
}

// ============================================================================
// SYSTÈME DE NOTIFICATIONS INTELLIGENTES & PERSONNALISABLES
// ============================================================================

export type NotificationCategory =
  | 'stock'
  | 'debts'
  | 'finance'
  | 'reports'
  | 'backup'
  | 'custom';

export type NotificationStyleVariant = 'soft' | 'outlined' | 'solid' | 'minimal';

export type NotificationFrequency = 'instant' | 'every_6h' | 'daily' | 'weekly';

export type NotificationIconName =
  | 'Bell'
  | 'Package'
  | 'AlertTriangle'
  | 'Users'
  | 'Wallet'
  | 'TrendingUp'
  | 'Target'
  | 'BarChart3'
  | 'Cloud'
  | 'Download'
  | 'Clock'
  | 'CheckCircle2'
  | 'Flame'
  | 'ShieldAlert'
  | 'Sparkles'
  | 'Calendar';

export type NotificationActionTarget =
  | 'stock'
  | 'stock_prices'
  | 'debts'
  | 'earnings'
  | 'reserve'
  | 'owner_profit'
  | 'daily_incomplete'
  | 'daily_sales'
  | 'dashboard'
  | 'backup_settings'
  | 'notification_settings';

export type NotificationTriggerType =
  | 'builtin_stock_low'
  | 'builtin_stock_price_rise'
  | 'builtin_debts_overdue'
  | 'builtin_sellers_unpaid'
  | 'builtin_sales_target'
  | 'builtin_reserve_low'
  | 'builtin_loss_rate'
  | 'builtin_incomplete_entries'
  | 'builtin_report_daily'
  | 'builtin_report_weekly'
  | 'builtin_backup_local'
  | 'builtin_backup_drive'
  | 'custom_reserve_below'
  | 'custom_benefices_above'
  | 'custom_monthly_sales_pct'
  | 'custom_daily_sales_above'
  | 'custom_overdue_debts_count'
  | 'custom_total_debts_above'
  | 'custom_low_stock_count'
  | 'custom_loss_rate_above'
  | 'custom_incomplete_entries'
  | 'custom_scheduled_reminder';

export interface NotificationRule {
  id: string;
  isCustom: boolean;
  enabled: boolean;
  name: string;
  description?: string;
  category: NotificationCategory;
  triggerType: NotificationTriggerType;
  titleTemplate: string;
  messageTemplate: string;
  color: string; // Code hexadécimal (ex. '#0f766e')
  icon: NotificationIconName;
  styleVariant: NotificationStyleVariant;
  channels: {
    inApp: boolean;
    system: boolean;
  };
  thresholdValue?: number;
  frequency: NotificationFrequency;
  preferredTime?: string; // 'HH:mm'
  activeDays?: number[]; // 0 = Dimanche ... 6 = Samedi
  actionTarget?: NotificationActionTarget;
  createdAt: number;
  updatedAt: number;
}

export interface InAppNotificationModeSettings {
  enabled: boolean;
  durationSeconds: number; // 3 à 12
  position: 'top' | 'bottom';
  soundEnabled: boolean;
  showToasts: boolean;
}

export interface SystemNotificationModeSettings {
  enabled: boolean;
  vibrate: boolean;
  requireInteraction: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string; // 'HH:mm' (ex. '22:00')
  quietHoursEnd: string; // 'HH:mm' (ex. '06:30')
  backgroundSyncEnabled: boolean;
}

export interface NotificationSettings {
  inAppMode: InAppNotificationModeSettings;
  systemMode: SystemNotificationModeSettings;
  rules: NotificationRule[];
}

export interface AppNotification {
  id: string;
  ruleId: string;
  category: NotificationCategory;
  title: string;
  message: string;
  color: string;
  icon: NotificationIconName;
  styleVariant: NotificationStyleVariant;
  isRead: boolean;
  readAt?: number;
  createdAt: number;
  dedupKey: string;
  actionTarget?: NotificationActionTarget;
  actionLabel?: string;
  isTest?: boolean;
}


