import { db } from '../db/db';
import { formatDate, formatFC, formatNumber, toISODate } from './formatters';
import {
  calculateIngredientsStock,
  calculateItemsPriceAnalytics,
} from './ingredientStockCalculator';
import { calculateDaysBetweenDates, computeDebtAllocations } from './debtCalculator';
import { computeUnpaidDaysReminder } from './sellerPayroll';
import { calculateReserveBalance } from './reserveCalculator';
import {
  NOTIFICATION_ACTION_LABELS,
  playNotificationChime,
  renderNotificationTemplate,
  resolveNotificationSettings,
} from './notificationDefaults';
import type {
  AppNotification,
  AppSettings,
  Customer,
  DailyEntry,
  DebtPayment,
  Employee,
  Expense,
  NotificationActionTarget,
  NotificationFrequency,
  NotificationRule,
  Payment,
  PersonalSale,
  ProductionEntry,
  ReserveMovement,
  StockAdjustment,
} from '../types';

export interface InAppBannerEvent {
  notification: AppNotification;
  durationSeconds: number;
}

type BannerListener = (event: InAppBannerEvent) => void;
const bannerListeners = new Set<BannerListener>();

type NavigationListener = (actionTarget: NotificationActionTarget, notificationId?: string) => void;
const navigationListeners = new Set<NavigationListener>();

export function subscribeInAppNotificationBanners(listener: BannerListener): () => void {
  bannerListeners.add(listener);
  return () => {
    bannerListeners.delete(listener);
  };
}

export function subscribeNotificationNavigation(listener: NavigationListener): () => void {
  navigationListeners.add(listener);
  return () => {
    navigationListeners.delete(listener);
  };
}

export function emitNotificationNavigation(
  actionTarget: NotificationActionTarget,
  notificationId?: string
): void {
  for (const fn of navigationListeners) {
    fn(actionTarget, notificationId);
  }
}

interface DomainSnapshot {
  settings: AppSettings;
  currency: string;
  businessName: string;
  todayStr: string;
  currentMonthStr: string;
  nowTimeStr: string;
  nowDayOfWeek: number;
  dailyEntries: DailyEntry[];
  personalSales: PersonalSale[];
  expenses: Expense[];
  productionEntries: ProductionEntry[];
  stockAdjustments: StockAdjustment[];
  customers: Customer[];
  debtPayments: DebtPayment[];
  payments: Payment[];
  employees: Employee[];
  reserveMovements: ReserveMovement[];
  soldeReserveFC: number;
  soldeBeneficesFC: number;
  todaySalesFC: number;
  todayExpensesFC: number;
  todayEntriesCount: number;
  monthSalesFC: number;
  monthDamagedFC: number;
  monthLossPct: number;
  weekSalesFC: number;
  weekExpensesFC: number;
  incompleteEntries: DailyEntry[];
  hasAnyBusinessData: boolean;
}

function getCurrentHHMM(d = new Date()): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function isWithinQuietHours(
  nowHHMM: string,
  quietEnabled: boolean,
  startHHMM: string,
  endHHMM: string
): boolean {
  if (!quietEnabled || !startHHMM || !endHHMM) return false;
  if (startHHMM === endHHMM) return false;
  if (startHHMM < endHHMM) {
    return nowHHMM >= startHHMM && nowHHMM < endHHMM;
  }
  // Plage chevauchant minuit (ex. 22:00 -> 06:30)
  return nowHHMM >= startHHMM || nowHHMM < endHHMM;
}

async function loadDomainSnapshot(settingsOverride?: AppSettings): Promise<DomainSnapshot> {
  const [
    storedSettings,
    dailyEntries,
    personalSales,
    expenses,
    productionEntries,
    stockAdjustments,
    customers,
    debtPayments,
    payments,
    employees,
    reserveMovements,
  ] = await Promise.all([
    settingsOverride ? Promise.resolve(settingsOverride) : db.settings.get('app_settings'),
    db.dailyEntries.toArray(),
    db.personalSales.toArray(),
    db.expenses.toArray(),
    db.productionEntries.toArray(),
    db.stockAdjustments.toArray(),
    db.customers.toArray(),
    db.debtPayments.toArray(),
    db.payments.toArray(),
    db.employees.toArray(),
    db.reserveMovements.toArray(),
  ]);

  const settings = (storedSettings || {
    id: 'app_settings',
    businessName: 'Yaourt Gestion',
    currency: 'FC',
    expenseReservePct: 50,
    monthlySalesTargetFC: 1000000,
    lossAlertThresholdPct: 5,
    pinCode: '',
    expenseCategories: [],
    lastBackupDate: null,
  }) as AppSettings;

  const now = new Date();
  const todayStr = toISODate(now);
  const currentMonthStr = todayStr.slice(0, 7);
  const nowTimeStr = getCurrentHHMM(now);
  const nowDayOfWeek = now.getDay();
  const currency = settings.currency || 'FC';
  const businessName = settings.businessName || 'Yaourt Gestion';

  const startingPoint = settings.caisseStartDate
    ? {
        startDate: settings.caisseStartDate,
        startReserveFC: settings.caisseStartReserveFC,
        startBeneficesFC: settings.caisseStartBeneficesFC,
        startVendeursFC: settings.caisseStartVendeursFC,
        startNormaleFC: settings.caisseStartNormaleFC,
        startCapitalFC: settings.caisseStartCapitalFC,
      }
    : null;

  const reserveDetails = calculateReserveBalance(
    reserveMovements,
    dailyEntries,
    expenses,
    settings.expenseReservePct ?? 50,
    startingPoint,
    null,
    personalSales,
    payments,
    employees,
    debtPayments
  );

  // Ventes & dépenses du jour
  const todayEntries = dailyEntries.filter(
    (e) => e.date === todayStr && (e.status || 'validated') !== 'incomplete'
  );
  const todayPersonalSales = personalSales.filter(
    (s) => s.date === todayStr && s.kind !== 'consommation' && !s.isOpeningDebt
  );
  const todaySalesFC =
    todayEntries.reduce((s, e) => s + (e.totalSalesFC || 0), 0) +
    todayPersonalSales.reduce((s, p) => s + (p.totalSalesFC || 0), 0);
  const todayExpensesFC = expenses
    .filter((ex) => ex.date === todayStr)
    .reduce((s, ex) => s + (ex.amountFC || 0), 0);

  // Ventes & pertes du mois en cours
  const monthEntries = dailyEntries.filter(
    (e) => e.date?.startsWith(currentMonthStr) && (e.status || 'validated') !== 'incomplete'
  );
  const monthPersonal = personalSales.filter(
    (s) => s.date?.startsWith(currentMonthStr) && s.kind !== 'consommation' && !s.isOpeningDebt
  );
  const monthSalesFC =
    monthEntries.reduce((s, e) => s + (e.totalSalesFC || 0), 0) +
    monthPersonal.reduce((s, p) => s + (p.totalSalesFC || 0), 0);
  const monthDamagedFC = monthEntries.reduce((s, e) => s + (e.totalDamagedFC || 0), 0);
  const monthBaseForLoss = monthSalesFC + monthDamagedFC;
  const monthLossPct = monthBaseForLoss > 0 ? (monthDamagedFC / monthBaseForLoss) * 100 : 0;

  // Fenêtre des 7 derniers jours
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  const sevenDaysStartStr = toISODate(sevenDaysAgo);

  const weekSalesFC =
    dailyEntries
      .filter(
        (e) =>
          e.date >= sevenDaysStartStr &&
          e.date <= todayStr &&
          (e.status || 'validated') !== 'incomplete'
      )
      .reduce((s, e) => s + (e.totalSalesFC || 0), 0) +
    personalSales
      .filter(
        (p) =>
          p.date >= sevenDaysStartStr &&
          p.date <= todayStr &&
          p.kind !== 'consommation' &&
          !p.isOpeningDebt
      )
      .reduce((s, p) => s + (p.totalSalesFC || 0), 0);

  const weekExpensesFC = expenses
    .filter((ex) => ex.date >= sevenDaysStartStr && ex.date <= todayStr)
    .reduce((s, ex) => s + (ex.amountFC || 0), 0);

  const incompleteEntries = dailyEntries
    .filter((e) => e.status === 'incomplete')
    .sort((a, b) => b.date.localeCompare(a.date));

  const hasAnyBusinessData =
    dailyEntries.length > 0 ||
    personalSales.length > 0 ||
    expenses.length > 0 ||
    productionEntries.length > 0;

  return {
    settings,
    currency,
    businessName,
    todayStr,
    currentMonthStr,
    nowTimeStr,
    nowDayOfWeek,
    dailyEntries,
    personalSales,
    expenses,
    productionEntries,
    stockAdjustments,
    customers,
    debtPayments,
    payments,
    employees,
    reserveMovements,
    soldeReserveFC: reserveDetails.soldeReserveFC,
    soldeBeneficesFC: reserveDetails.soldeBeneficesFC,
    todaySalesFC,
    todayExpensesFC,
    todayEntriesCount: todayEntries.length + todayPersonalSales.length,
    monthSalesFC,
    monthDamagedFC,
    monthLossPct,
    weekSalesFC,
    weekExpensesFC,
    incompleteEntries,
    hasAnyBusinessData,
  };
}

export interface EvaluatedNotificationPayload {
  title: string;
  message: string;
  dedupKey: string;
  actionTarget?: NotificationActionTarget;
  actionLabel?: string;
}

function evaluateRuleWithSnapshot(
  rule: NotificationRule,
  snap: DomainSnapshot,
  isPreview = false
): EvaluatedNotificationPayload | null {
  if (!isPreview) {
    if (!rule.enabled) return null;
    if (Array.isArray(rule.activeDays) && rule.activeDays.length > 0) {
      if (!rule.activeDays.includes(snap.nowDayOfWeek)) {
        return null;
      }
    }
    if (rule.preferredTime && rule.preferredTime.trim()) {
      if (snap.nowTimeStr < rule.preferredTime.trim()) {
        return null;
      }
    }
  }

  const baseVars: Record<string, string | number> = {
    entreprise: snap.businessName,
    date: formatDate(snap.todayStr),
    heure: snap.nowTimeStr,
    nb: 0,
    montant: formatFC(0, snap.currency),
    seuil: rule.thresholdValue !== undefined ? formatNumber(rule.thresholdValue, 2) : '0',
    detail: '—',
    progression: '0',
  };

  let matched = false;
  let dedupSuffix = snap.todayStr;

  switch (rule.triggerType) {
    case 'builtin_stock_low':
    case 'custom_low_stock_count': {
      const lowBatches =
        rule.triggerType === 'builtin_stock_low'
          ? (rule.thresholdValue ?? snap.settings.stockLowBatches ?? 1)
          : (snap.settings.stockLowBatches ?? 1);
      const minCount =
        rule.triggerType === 'custom_low_stock_count'
          ? Math.max(1, Math.floor(rule.thresholdValue ?? 1))
          : 1;

      const stockRes = calculateIngredientsStock({
        costItems: snap.settings.costItems ?? [],
        expenses: snap.expenses,
        productionEntries: snap.productionEntries,
        stockAdjustments: snap.stockAdjustments,
        productCosting: snap.settings.productCosting,
        stockStartDate: snap.settings.stockStartDate,
        stockStart: snap.settings.stockStart,
        stockLowBatches: lowBatches,
      });

      const lowItems = stockRes.items.filter((it) => it.needsPurchase);
      const names = lowItems.slice(0, 3).map((it) => it.item.name);
      const moreCount = Math.max(0, lowItems.length - 3);
      const detailStr =
        names.length > 0
          ? `${names.join(', ')}${moreCount > 0 ? ` (+${moreCount})` : ''}`
          : 'Lait concentré, Sachets (exemple)';

      baseVars.nb = lowItems.length || (isPreview ? 2 : 0);
      baseVars.seuil = formatNumber(lowBatches, 2);
      baseVars.detail = detailStr;

      matched = lowItems.length >= minCount;
      dedupSuffix = lowItems.map((i) => i.item.id).sort().join(',');
      break;
    }

    case 'builtin_stock_price_rise': {
      const pctThreshold = rule.thresholdValue ?? snap.settings.priceRiseAlertPct ?? 5;
      const analytics = calculateItemsPriceAnalytics({
        costItems: snap.settings.costItems ?? [],
        expenses: snap.expenses,
        productionEntries: snap.productionEntries,
        productCosting: snap.settings.productCosting,
        priceRiseAlertPct: pctThreshold,
      });

      const dismissed = snap.settings.dismissedPriceAlertKeys ?? {};
      const risen = analytics.filter((a) => {
        if (!a.isPriceRiseAboveThreshold || a.purchases.length === 0) return false;
        const lastP = a.purchases[a.purchases.length - 1];
        const alertKey = `${lastP.expenseId}_${Math.round(lastP.unitPurchasePriceFC)}`;
        return dismissed[a.item.id] !== alertKey;
      });

      const summaryParts = risen.slice(0, 2).map((r) => {
        const pct = r.lastVariationPct !== null ? `+${formatNumber(r.lastVariationPct, 1)} %` : '';
        return `${r.item.name} (${pct})`;
      });

      baseVars.nb = risen.length || (isPreview ? 1 : 0);
      baseVars.seuil = formatNumber(pctThreshold, 1);
      baseVars.detail =
        summaryParts.length > 0 ? summaryParts.join(', ') : 'Lait concentré (+8,5 %)';

      matched = risen.length > 0;
      dedupSuffix = risen
        .map((r) => `${r.item.id}:${r.purchases[r.purchases.length - 1]?.expenseId || ''}`)
        .sort()
        .join('|');
      break;
    }

    case 'builtin_debts_overdue':
    case 'custom_overdue_debts_count': {
      const daysThreshold =
        rule.triggerType === 'builtin_debts_overdue'
          ? (rule.thresholdValue ?? snap.settings.debtReminderDays ?? 2)
          : (snap.settings.debtReminderDays ?? 2);
      const minOverdueClients =
        rule.triggerType === 'custom_overdue_debts_count'
          ? Math.max(1, Math.floor(rule.thresholdValue ?? 2))
          : 1;

      const debtRes = computeDebtAllocations(
        snap.personalSales,
        snap.debtPayments,
        snap.settings.expenseReservePct ?? 50,
        snap.customers,
        daysThreshold,
        snap.todayStr
      );

      const overdueCustomers = debtRes.customerSummaries.filter((c) => c.isOverdue);
      const overdueTotalFC = overdueCustomers.reduce((s, c) => s + c.remainingFC, 0);
      const clientNames = overdueCustomers
        .slice(0, 3)
        .map((c) => `${c.customer.name} (${c.daysOverdue}j)`);

      baseVars.nb = overdueCustomers.length || (isPreview ? 2 : 0);
      baseVars.montant = formatFC(
        overdueTotalFC || (isPreview ? 18500 : 0),
        snap.currency
      );
      baseVars.seuil = formatNumber(daysThreshold, 0);
      baseVars.detail =
        clientNames.length > 0 ? clientNames.join(', ') : 'Client A (4j), Client B (3j)';

      matched = overdueCustomers.length >= minOverdueClients;
      dedupSuffix = `${snap.todayStr}:${overdueCustomers.map((c) => `${c.customer.id}_${c.remainingFC}`).join(',')}`;
      break;
    }

    case 'custom_total_debts_above': {
      const maxCreditFC = rule.thresholdValue ?? 100000;
      const debtRes = computeDebtAllocations(
        snap.personalSales,
        snap.debtPayments,
        snap.settings.expenseReservePct ?? 50,
        snap.customers,
        snap.settings.debtReminderDays ?? 2,
        snap.todayStr
      );
      baseVars.montant = formatFC(
        debtRes.totalRemainingFC || (isPreview ? maxCreditFC + 15000 : 0),
        snap.currency
      );
      baseVars.nb = debtRes.debtorCount || (isPreview ? 3 : 0);
      baseVars.seuil = formatFC(maxCreditFC, snap.currency);

      matched = debtRes.totalRemainingFC > maxCreditFC;
      dedupSuffix = `${snap.todayStr}:${Math.round(debtRes.totalRemainingFC)}`;
      break;
    }

    case 'builtin_sellers_unpaid': {
      const daysThreshold = rule.thresholdValue ?? snap.settings.unpaidDaysReminder ?? 7;
      const unpaidRes = computeUnpaidDaysReminder({
        dailyEntries: snap.dailyEntries,
        payments: snap.payments,
        employees: snap.employees,
        unpaidDaysReminder: daysThreshold,
        payrollClosures: snap.settings.payrollClosures,
        caisseStartDate: snap.settings.caisseStartDate,
        todayStr: snap.todayStr,
      });

      const sellerNames = unpaidRes
        ? unpaidRes.sellers.slice(0, 3).map((s) => `${s.employeeName} (${s.daysCount}j)`)
        : [];

      baseVars.nb = unpaidRes?.totalDays || (isPreview ? 5 : 0);
      baseVars.montant = formatFC(
        unpaidRes?.totalAmountFC || (isPreview ? 25000 : 0),
        snap.currency
      );
      baseVars.seuil = formatNumber(daysThreshold, 0);
      baseVars.detail = sellerNames.length > 0 ? sellerNames.join(', ') : 'Vendeur(se) (exemple)';

      matched = Boolean(unpaidRes && unpaidRes.totalDays > 0);
      dedupSuffix = unpaidRes
        ? `${snap.todayStr}:${unpaidRes.sellers.map((s) => `${s.employeeId}_${s.daysCount}`).join(',')}`
        : snap.todayStr;
      break;
    }

    case 'builtin_sales_target':
    case 'custom_monthly_sales_pct': {
      const targetFC = snap.settings.monthlySalesTargetFC || 1000000;
      const pctThreshold = rule.thresholdValue ?? 100;
      const currentPct = targetFC > 0 ? (snap.monthSalesFC / targetFC) * 100 : 0;

      baseVars.progression = formatNumber(
        snap.monthSalesFC > 0 ? currentPct : isPreview ? pctThreshold : 0,
        1
      );
      baseVars.montant = formatFC(
        snap.monthSalesFC > 0 ? snap.monthSalesFC : isPreview ? Math.round((targetFC * pctThreshold) / 100) : 0,
        snap.currency
      );
      baseVars.seuil = formatNumber(pctThreshold, 0);
      baseVars.detail = formatFC(targetFC, snap.currency);

      matched = targetFC > 0 && currentPct >= pctThreshold;
      dedupSuffix = `${snap.currentMonthStr}:tier_${pctThreshold}`;
      break;
    }

    case 'custom_daily_sales_above': {
      const targetDailyFC = rule.thresholdValue ?? 50000;
      baseVars.montant = formatFC(
        snap.todaySalesFC > 0 ? snap.todaySalesFC : isPreview ? targetDailyFC + 5000 : 0,
        snap.currency
      );
      baseVars.seuil = formatFC(targetDailyFC, snap.currency);

      matched = snap.todaySalesFC >= targetDailyFC;
      dedupSuffix = `${snap.todayStr}:daily_above_${targetDailyFC}`;
      break;
    }

    case 'builtin_reserve_low':
    case 'custom_reserve_below': {
      const minReserveFC = rule.thresholdValue ?? 0;
      baseVars.montant = formatFC(snap.soldeReserveFC, snap.currency);
      baseVars.seuil = formatFC(minReserveFC, snap.currency);

      matched = snap.hasAnyBusinessData && snap.soldeReserveFC < minReserveFC;
      dedupSuffix = `${snap.todayStr}:res_${Math.floor(snap.soldeReserveFC / 1000)}`;
      break;
    }

    case 'custom_benefices_above': {
      const targetBenefFC = rule.thresholdValue ?? 100000;
      baseVars.montant = formatFC(
        snap.soldeBeneficesFC > 0 ? snap.soldeBeneficesFC : isPreview ? targetBenefFC : 0,
        snap.currency
      );
      baseVars.seuil = formatFC(targetBenefFC, snap.currency);

      matched = snap.soldeBeneficesFC >= targetBenefFC;
      dedupSuffix = `${snap.currentMonthStr}:benef_${targetBenefFC}`;
      break;
    }

    case 'builtin_loss_rate':
    case 'custom_loss_rate_above': {
      const maxLossPct = rule.thresholdValue ?? snap.settings.lossAlertThresholdPct ?? 5;
      baseVars.progression = formatNumber(
        snap.monthLossPct > 0 ? snap.monthLossPct : isPreview ? maxLossPct + 1.2 : 0,
        1
      );
      baseVars.montant = formatFC(
        snap.monthDamagedFC > 0 ? snap.monthDamagedFC : isPreview ? 12000 : 0,
        snap.currency
      );
      baseVars.seuil = formatNumber(maxLossPct, 1);

      matched = snap.monthSalesFC > 0 && snap.monthLossPct > maxLossPct;
      dedupSuffix = `${snap.currentMonthStr}:loss_${Math.round(snap.monthLossPct * 10)}`;
      break;
    }

    case 'builtin_incomplete_entries':
    case 'custom_incomplete_entries': {
      const minCount = Math.max(1, Math.floor(rule.thresholdValue ?? 1));
      const inc = snap.incompleteEntries;
      const labels = inc
        .slice(0, 3)
        .map((e) => `${e.employeeName} (${formatDate(e.date).slice(0, 5)})`);

      baseVars.nb = inc.length || (isPreview ? minCount : 0);
      baseVars.detail =
        labels.length > 0 ? labels.join(', ') : 'Mima (aujourd’hui)';

      matched = inc.length >= minCount;
      dedupSuffix = inc.map((e) => e.id).sort().join(',');
      break;
    }

    case 'builtin_report_daily': {
      baseVars.montant = formatFC(snap.todaySalesFC, snap.currency);
      baseVars.detail = `Dépenses : ${formatFC(snap.todayExpensesFC, snap.currency)} · ${snap.todayEntriesCount} vente(s) saisie(s)`;
      matched = snap.hasAnyBusinessData;
      dedupSuffix = `daily_report:${snap.todayStr}`;
      break;
    }

    case 'builtin_report_weekly': {
      baseVars.montant = formatFC(snap.weekSalesFC, snap.currency);
      baseVars.detail = `Dépenses 7j : ${formatFC(snap.weekExpensesFC, snap.currency)} · Caisse Réserve : ${formatFC(snap.soldeReserveFC, snap.currency)}`;
      matched = snap.hasAnyBusinessData;
      // Clé hebdomadaire basée sur l'année + semaine
      const weekBucket = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
      dedupSuffix = `weekly_report:${weekBucket}`;
      break;
    }

    case 'builtin_backup_local': {
      const maxDays = Math.max(1, Math.floor(rule.thresholdValue ?? 7));
      const lastDate = snap.settings.lastBackupDate;
      const elapsed = lastDate
        ? calculateDaysBetweenDates(lastDate, snap.todayStr)
        : 999;

      baseVars.nb = lastDate ? elapsed : maxDays;
      baseVars.seuil = formatNumber(maxDays, 0);
      baseVars.detail = lastDate
        ? `Dernière sauvegarde JSON il y a ${elapsed} jour(s) (${formatDate(lastDate)})`
        : 'Aucune sauvegarde JSON locale encore téléchargée';

      matched = snap.hasAnyBusinessData && elapsed >= maxDays;
      dedupSuffix = `local_backup:${snap.todayStr}`;
      break;
    }

    case 'builtin_backup_drive': {
      const maxHours = Math.max(1, Math.floor(rule.thresholdValue ?? 24));
      const drive = snap.settings.driveBackup;
      let driveIssue: string | null = null;
      let stateKey = 'ok';

      if (drive?.connected) {
        if (drive.lastError) {
          driveIssue = drive.lastError;
          stateKey = `err_${drive.lastError.slice(0, 32)}`;
        } else if (drive.lastSuccessAt) {
          const hoursSince = (Date.now() - drive.lastSuccessAt) / (60 * 60 * 1000);
          if (hoursSince >= maxHours) {
            driveIssue = `Aucune sauvegarde Google Drive réussie depuis ${Math.floor(hoursSince)} h (seuil : ${maxHours} h).`;
            stateKey = `stale_${snap.todayStr}`;
          }
        }
      }

      baseVars.seuil = formatNumber(maxHours, 0);
      baseVars.detail =
        driveIssue ||
        (drive?.connected
          ? 'Google Drive est connecté et à jour.'
          : 'Sauvegarde Google Drive : vérification de l’état de synchronisation.');

      matched = Boolean(driveIssue);
      dedupSuffix = `drive:${stateKey}`;
      break;
    }

    case 'custom_scheduled_reminder': {
      baseVars.montant = formatFC(snap.todaySalesFC, snap.currency);
      matched = true;
      dedupSuffix = `sched:${snap.todayStr}:${rule.preferredTime || 'any'}`;
      break;
    }

    default:
      return null;
  }

  if (!isPreview && !matched) {
    return null;
  }

  const title = renderNotificationTemplate(rule.titleTemplate, baseVars).trim() || rule.name;
  const message = renderNotificationTemplate(rule.messageTemplate, baseVars).trim();
  const actionTarget = rule.actionTarget;
  const actionLabel = actionTarget ? NOTIFICATION_ACTION_LABELS[actionTarget] : undefined;

  return {
    title,
    message,
    dedupKey: `${rule.id}::${dedupSuffix}`,
    actionTarget,
    actionLabel,
  };
}

function getFrequencyCooldownMs(freq: NotificationFrequency): number {
  switch (freq) {
    case 'every_6h':
      return 6 * 60 * 60 * 1000;
    case 'daily':
      return 20 * 60 * 60 * 1000;
    case 'weekly':
      return 6.5 * 24 * 60 * 60 * 1000;
    case 'instant':
    default:
      return 0;
  }
}

export interface SystemNotificationSupportInfo {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  serviceWorkerReady: boolean;
  periodicSyncSupported: boolean;
  isIOS: boolean;
  isStandalonePWA: boolean;
}

export async function getSystemNotificationSupportInfo(): Promise<SystemNotificationSupportInfo> {
  if (typeof window === 'undefined') {
    return {
      supported: false,
      permission: 'unsupported',
      serviceWorkerReady: false,
      periodicSyncSupported: false,
      isIOS: false,
      isStandalonePWA: false,
    };
  }

  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isStandalonePWA =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    Boolean((navigator as unknown as { standalone?: boolean }).standalone);

  const hasNotificationApi = 'Notification' in window;
  let serviceWorkerReady = false;
  let periodicSyncSupported = false;

  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.active) {
        serviceWorkerReady = true;
        periodicSyncSupported = 'periodicSync' in reg;
      }
    } catch {
      serviceWorkerReady = false;
    }
  }

  return {
    supported: hasNotificationApi,
    permission: hasNotificationApi ? Notification.permission : 'unsupported',
    serviceWorkerReady,
    periodicSyncSupported,
    isIOS,
    isStandalonePWA,
  };
}

export async function requestSystemNotificationPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return Notification.permission;
  }
}

export async function syncBackgroundNotificationWorker(
  appSettings?: AppSettings
): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg || !('periodicSync' in reg)) return false;

    const notifCfg = resolveNotificationSettings(appSettings);
    const periodicSync = (
      reg as unknown as {
        periodicSync: {
          register: (tag: string, opts: { minInterval: number }) => Promise<void>;
          unregister: (tag: string) => Promise<void>;
        };
      }
    ).periodicSync;

    if (
      notifCfg.systemMode.enabled &&
      notifCfg.systemMode.backgroundSyncEnabled &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      await periodicSync.register('yaourt-smart-notifications', {
        minInterval: 6 * 60 * 60 * 1000, // 6 heures
      });
      return true;
    } else {
      await periodicSync.unregister('yaourt-smart-notifications').catch(() => {});
      return false;
    }
  } catch {
    return false;
  }
}

export async function sendBrowserOrSWNotification(params: {
  title: string;
  body: string;
  tag: string;
  actionTarget?: NotificationActionTarget;
  notificationId?: string;
  vibrate?: boolean;
  requireInteraction?: boolean;
  logoUrl?: string;
}): Promise<{ delivered: boolean; reason?: string }> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return {
      delivered: false,
      reason: 'Ce navigateur ne prend pas en charge les notifications système.',
    };
  }

  if (Notification.permission !== 'granted') {
    return {
      delivered: false,
      reason:
        Notification.permission === 'denied'
          ? 'Les notifications système sont bloquées dans les réglages du navigateur.'
          : 'Autorisez d’abord les notifications système.',
    };
  }

  const iconUrl = params.logoUrl || '/pwa-192x192.png';

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.active) {
        const swOptions: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
          body: params.body,
          icon: iconUrl,
          badge: '/pwa-192x192.png',
          tag: params.tag,
          renotify: false,
          requireInteraction: Boolean(params.requireInteraction),
          data: {
            actionTarget: params.actionTarget || 'dashboard',
            notificationId: params.notificationId,
          },
        };
        if (params.vibrate !== false) {
          swOptions.vibrate = [180, 80, 180];
        }
        await reg.showNotification(params.title, swOptions);
        return { delivered: true };
      }
    }

    // Repli direct via l'objet Notification du navigateur (mode onglet / dev sans SW actif)
    const n = new Notification(params.title, {
      body: params.body,
      icon: iconUrl,
      tag: params.tag,
      requireInteraction: Boolean(params.requireInteraction),
    });
    n.onclick = () => {
      window.focus();
      if (params.actionTarget) {
        emitNotificationNavigation(params.actionTarget, params.notificationId);
      }
      n.close();
    };
    return { delivered: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Erreur d’envoi système';
    return { delivered: false, reason: msg };
  }
}

let isEvaluatingFlag = false;

/**
 * Évalue toutes les règles intelligentes et personnalisées actives sans jamais créer de doublons.
 */
export async function runSmartNotificationEvaluation(
  settingsOverride?: AppSettings
): Promise<number> {
  if (isEvaluatingFlag) return 0;
  isEvaluatingFlag = true;

  try {
    const snap = await loadDomainSnapshot(settingsOverride);
    const notifSettings = resolveNotificationSettings(snap.settings);

    const globalInApp = notifSettings.inAppMode.enabled;
    const globalSystem = notifSettings.systemMode.enabled;
    if (!globalInApp && !globalSystem) {
      return 0;
    }

    const quietNow = isWithinQuietHours(
      snap.nowTimeStr,
      notifSettings.systemMode.quietHoursEnabled,
      notifSettings.systemMode.quietHoursStart,
      notifSettings.systemMode.quietHoursEnd
    );

    const existingNotifications = await db.notifications.toArray();
    const existingByRule = new Map<string, AppNotification[]>();
    const existingDedupKeys = new Set<string>();

    for (const item of existingNotifications) {
      if (item.isTest) continue;
      existingDedupKeys.add(item.dedupKey);
      const list = existingByRule.get(item.ruleId) || [];
      list.push(item);
      existingByRule.set(item.ruleId, list);
    }

    let createdCount = 0;
    const nowMs = Date.now();

    for (const rule of notifSettings.rules) {
      if (!rule.enabled) continue;

      const wantInApp = globalInApp && rule.channels.inApp;
      const wantSystem = globalSystem && rule.channels.system;
      if (!wantInApp && !wantSystem) continue;

      const evaluated = evaluateRuleWithSnapshot(rule, snap, false);
      if (!evaluated) continue;

      // 1. Dédoublonnage exact par état (dedupKey)
      if (existingDedupKeys.has(evaluated.dedupKey)) {
        continue;
      }

      // 2. Respect de la fréquence / anti-spam sur la même règle
      const cooldownMs = getFrequencyCooldownMs(rule.frequency);
      const historyForRule = existingByRule.get(rule.id) || [];
      if (historyForRule.length > 0) {
        const latestAt = Math.max(...historyForRule.map((h) => h.createdAt));
        if (cooldownMs > 0 && nowMs - latestAt < cooldownMs) {
          continue;
        }
        // Même en mode 'instant', éviter plus d'une alerte identique en moins de 2 minutes
        if (nowMs - latestAt < 120_000) {
          continue;
        }
      }

      const notifId = `notif_${nowMs}_${Math.random().toString(36).slice(2, 8)}`;
      const record: AppNotification = {
        id: notifId,
        ruleId: rule.id,
        category: rule.category,
        title: evaluated.title,
        message: evaluated.message,
        color: rule.color,
        icon: rule.icon,
        styleVariant: rule.styleVariant,
        // Si seul le canal Système est actif, on marque l'entrée comme déjà lue côté cloche interne
        isRead: !wantInApp,
        ...(wantInApp ? {} : { readAt: nowMs }),
        createdAt: nowMs + createdCount,
        dedupKey: evaluated.dedupKey,
        actionTarget: evaluated.actionTarget,
        actionLabel: evaluated.actionLabel,
      };

      await db.notifications.put(record);
      existingDedupKeys.add(evaluated.dedupKey);
      createdCount += 1;

      if (wantInApp && !quietNow) {
        if (notifSettings.inAppMode.soundEnabled) {
          playNotificationChime();
        }
        if (notifSettings.inAppMode.showToasts) {
          for (const fn of bannerListeners) {
            fn({
              notification: record,
              durationSeconds: notifSettings.inAppMode.durationSeconds,
            });
          }
        }
      }

      if (wantSystem && !quietNow) {
        await sendBrowserOrSWNotification({
          title: record.title,
          body: record.message,
          tag: record.dedupKey,
          actionTarget: record.actionTarget,
          notificationId: record.id,
          vibrate: notifSettings.systemMode.vibrate,
          requireInteraction: notifSettings.systemMode.requireInteraction,
          logoUrl: snap.settings.appLogoBase64,
        });
      }
    }

    // Nettoyage doux si l'historique dépasse 250 entrées (conserve les plus récentes)
    if (existingNotifications.length + createdCount > 250) {
      const allSorted = await db.notifications.orderBy('createdAt').reverse().toArray();
      const staleIds = allSorted.slice(250).map((n) => n.id);
      if (staleIds.length > 0) {
        await db.notifications.bulkDelete(staleIds);
      }
    }

    return createdCount;
  } catch (err) {
    console.error('Erreur évaluation des notifications intelligentes:', err);
    return 0;
  } finally {
    isEvaluatingFlag = false;
  }
}

/**
 * Calcule un aperçu fidèle avec les données réelles actuelles de l'application.
 */
export async function buildLiveRulePreview(
  rule: NotificationRule,
  settingsOverride?: AppSettings
): Promise<EvaluatedNotificationPayload> {
  const snap = await loadDomainSnapshot(settingsOverride);
  const res = evaluateRuleWithSnapshot(rule, snap, true);
  if (res) return res;
  return {
    title: rule.titleTemplate || rule.name,
    message: rule.messageTemplate || 'Aperçu de la notification.',
    dedupKey: `preview_${rule.id}`,
    actionTarget: rule.actionTarget,
    actionLabel: rule.actionTarget ? NOTIFICATION_ACTION_LABELS[rule.actionTarget] : undefined,
  };
}

/**
 * Envoie immédiatement une notification de test (interne, système ou les deux).
 */
export async function triggerTestNotification(params: {
  rule: NotificationRule;
  channel: 'inApp' | 'system' | 'both';
  settings?: AppSettings;
}): Promise<{ ok: boolean; message: string }> {
  const { rule, channel, settings } = params;
  const notifSettings = resolveNotificationSettings(settings);
  const preview = await buildLiveRulePreview(rule, settings);
  const nowMs = Date.now();
  const notifId = `test_${nowMs}_${Math.random().toString(36).slice(2, 7)}`;

  const doInApp = channel === 'inApp' || channel === 'both';
  const doSystem = channel === 'system' || channel === 'both';

  const record: AppNotification = {
    id: notifId,
    ruleId: rule.id,
    category: rule.category,
    title: preview.title,
    message: preview.message,
    color: rule.color,
    icon: rule.icon,
    styleVariant: rule.styleVariant,
    isRead: false,
    createdAt: nowMs,
    dedupKey: `test_${notifId}`,
    actionTarget: preview.actionTarget,
    actionLabel: preview.actionLabel,
    isTest: true,
  };

  if (doInApp) {
    await db.notifications.put(record);
    if (notifSettings.inAppMode.soundEnabled) {
      playNotificationChime();
    }
    for (const fn of bannerListeners) {
      fn({
        notification: record,
        durationSeconds: notifSettings.inAppMode.durationSeconds,
      });
    }
  }

  if (doSystem) {
    const sysRes = await sendBrowserOrSWNotification({
      title: preview.title,
      body: preview.message,
      tag: `test_${nowMs}`,
      actionTarget: preview.actionTarget,
      notificationId: doInApp ? notifId : undefined,
      vibrate: notifSettings.systemMode.vibrate,
      requireInteraction: notifSettings.systemMode.requireInteraction,
      logoUrl: settings?.appLogoBase64,
    });
    if (!sysRes.delivered) {
      return {
        ok: false,
        message: sysRes.reason || 'Impossible d’afficher la notification système.',
      };
    }
  }

  return {
    ok: true,
    message:
      channel === 'both'
        ? 'Notification de test envoyée en interne et sur l’appareil.'
        : channel === 'system'
        ? 'Notification système envoyée sur votre appareil.'
        : 'Notification de test affichée et ajoutée au centre de notifications.',
  };
}

/**
 * Enregistre un événement ponctuel de sauvegarde Google Drive réussie si l'utilisateur l'a activé,
 * ou réévalue la règle Drive.
 */
export async function recordDriveSyncSuccessNotification(
  settings?: AppSettings
): Promise<void> {
  const current = settings || (await db.settings.get('app_settings'));
  if (!current) return;
  const notifCfg = resolveNotificationSettings(current);
  const driveRule = notifCfg.rules.find((r) => r.triggerType === 'builtin_backup_drive');
  if (!driveRule || !driveRule.enabled) return;

  // Marquer comme lues les éventuelles anciennes alertes d'erreur Google Drive résolues
  const unreadDriveAlerts = await db.notifications
    .where('ruleId')
    .equals(driveRule.id)
    .filter((n) => !n.isRead)
    .toArray();

  if (unreadDriveAlerts.length > 0) {
    const now = Date.now();
    await db.notifications.bulkPut(
      unreadDriveAlerts.map((n) => ({ ...n, isRead: true, readAt: now }))
    );
  }
}

// ============================================================================
// ACTIONS DU CENTRE DE NOTIFICATIONS
// ============================================================================

export async function toggleNotificationRead(id: string, isRead: boolean): Promise<void> {
  await db.notifications.update(id, {
    isRead,
    readAt: isRead ? Date.now() : undefined,
  });
}

export async function markAllNotificationsAsRead(): Promise<void> {
  const unread = await db.notifications.filter((n) => !n.isRead).toArray();
  if (unread.length === 0) return;
  const now = Date.now();
  await db.notifications.bulkPut(
    unread.map((n) => ({
      ...n,
      isRead: true,
      readAt: now,
    }))
  );
}

export async function deleteSingleNotification(id: string): Promise<void> {
  await db.notifications.delete(id);
}

export async function deleteReadNotifications(): Promise<void> {
  const readItems = await db.notifications.filter((n) => Boolean(n.isRead)).toArray();
  if (readItems.length === 0) return;
  await db.notifications.bulkDelete(readItems.map((n) => n.id));
}

export async function clearAllNotifications(): Promise<void> {
  await db.notifications.clear();
}
