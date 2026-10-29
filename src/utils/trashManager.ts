import type { Table } from 'dexie';
import { db } from '../db/db';
import { formatDate, formatFC, formatNumber, toISODate } from './formatters';
import { normalizeCustomerName } from './debtCalculator';
import type {
  DailyEntry,
  PersonalSale,
  ProductionEntry,
  Expense,
  Payment,
  ReserveMovement,
  DebtPayment,
  Customer,
  StockAdjustment,
  TrashKind,
  TrashItem,
} from '../types';

export interface TrashPayloadMap {
  dailyEntry: DailyEntry;
  personalSale: PersonalSale;
  production: ProductionEntry;
  expense: Expense;
  payment: Payment;
  reserveMovement: ReserveMovement;
  debtPayment: DebtPayment;
  customer: Customer;
  stockAdjustment: StockAdjustment;
}

export const ALL_TRASH_KINDS: TrashKind[] = [
  'dailyEntry',
  'personalSale',
  'production',
  'expense',
  'payment',
  'reserveMovement',
  'debtPayment',
  'customer',
  'stockAdjustment',
];

export const TRASH_KIND_LABELS: Record<TrashKind, string> = {
  dailyEntry: 'Saisie de vente',
  personalSale: 'Vente / Consommation',
  production: 'Production',
  expense: 'Dépense',
  payment: 'Paiement vendeur(se)',
  reserveMovement: 'Mouvement de caisse',
  debtPayment: 'Paiement de dette',
  customer: 'Client',
  stockAdjustment: 'Ajustement de stock',
};

export function isValidTrashKind(val: unknown): val is TrashKind {
  return typeof val === 'string' && (ALL_TRASH_KINDS as string[]).includes(val);
}

export function formatDateTimeFR(timestampMs: number): string {
  const d = new Date(timestampMs);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} à ${hh}:${min}`;
}

function getTargetTable(kind: TrashKind): Table<any, string> {
  switch (kind) {
    case 'dailyEntry':
      return db.dailyEntries;
    case 'personalSale':
      return db.personalSales;
    case 'production':
      return db.productionEntries;
    case 'expense':
      return db.expenses;
    case 'payment':
      return db.payments;
    case 'reserveMovement':
      return db.reserveMovements;
    case 'debtPayment':
      return db.debtPayments;
    case 'customer':
      return db.customers;
    case 'stockAdjustment':
      return db.stockAdjustments;
  }
}

function clonePayload<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

async function buildTrashMetadata<K extends TrashKind>(
  kind: K,
  record: TrashPayloadMap[K],
  currency: string
): Promise<{ label: string; originalDate: string; amountFC?: number }> {
  switch (kind) {
    case 'dailyEntry': {
      const r = record as DailyEntry;
      return {
        label: `Saisie de ${r.employeeName} – ${formatDate(r.date)} – ventes ${formatFC(
          r.totalSalesFC,
          currency
        )}`,
        originalDate: r.date,
        amountFC: r.totalSalesFC,
      };
    }

    case 'personalSale': {
      const r = record as PersonalSale;
      if (r.kind === 'consommation') {
        const paidFC =
          r.consumptionPaidFC !== undefined ? r.consumptionPaidFC : r.consumptionValueFC || 0;
        return {
          label: `Consommation personnelle – ${formatDate(r.date)} – ${formatFC(
            paidFC,
            currency
          )}`,
          originalDate: r.date,
          amountFC: paidFC,
        };
      }
      if (r.isOpeningDebt) {
        return {
          label: `Ancienne dette${r.customerName ? ` (${r.customerName})` : ''} – ${formatDate(
            r.date
          )} – ${formatFC(r.totalSalesFC, currency)}`,
          originalDate: r.date,
          amountFC: r.totalSalesFC,
        };
      }
      return {
        label: `Vente personnelle${r.customerName ? ` (${r.customerName})` : ''} – ${formatDate(
          r.date
        )} – ${formatFC(r.totalSalesFC, currency)}`,
        originalDate: r.date,
        amountFC: r.totalSalesFC,
      };
    }

    case 'production': {
      const r = record as ProductionEntry;
      const itemsSummary = (r.items || [])
        .filter((it) => it.producedQty > 0)
        .map((it) => `${it.productName} × ${formatNumber(it.producedQty)}`)
        .join(', ');
      return {
        label: `Production – ${formatDate(r.date)}${itemsSummary ? ` – ${itemsSummary}` : ''}`,
        originalDate: r.date,
        amountFC: undefined,
      };
    }

    case 'expense': {
      const r = record as Expense;
      return {
        label: `Dépense (${r.category}) – ${formatDate(r.date)} – ${formatFC(
          r.amountFC,
          currency
        )}${r.detail ? ` – ${r.detail}` : ''}`,
        originalDate: r.date,
        amountFC: r.amountFC,
      };
    }

    case 'payment': {
      const r = record as Payment;
      const typeName =
        r.paymentType === 'advance'
          ? 'Avance'
          : r.paymentType === 'final'
          ? 'Solde final'
          : 'Règlement';
      return {
        label: `${typeName} de ${r.employeeName} – ${formatDate(r.date)} – ${formatFC(
          r.amountFC,
          currency
        )}`,
        originalDate: r.date,
        amountFC: r.amountFC,
      };
    }

    case 'reserveMovement': {
      const r = record as ReserveMovement;
      const caisseLabel = r.caisse === 'benefices' ? 'Bénéfices personnels' : 'Réserve';
      const mvLabel = r.type === 'ajout' ? 'Ajout' : 'Retrait';
      return {
        label: `${mvLabel} (${caisseLabel}) – ${formatDate(r.date)} – ${formatFC(
          r.amountFC,
          currency
        )}${r.reason ? ` – ${r.reason}` : ''}`,
        originalDate: r.date,
        amountFC: r.amountFC,
      };
    }

    case 'debtPayment': {
      const r = record as DebtPayment;
      const cust = r.customerId ? await db.customers.get(r.customerId) : undefined;
      return {
        label: `Paiement de dette${cust?.name ? ` de ${cust.name}` : ''} – ${formatDate(
          r.date
        )} – ${formatFC(r.amountFC, currency)}`,
        originalDate: r.date,
        amountFC: r.amountFC,
      };
    }

    case 'customer': {
      const r = record as Customer;
      const createdDate = toISODate(new Date(r.createdAt || Date.now()));
      return {
        label: `Client : ${r.name}${r.phone ? ` – ${r.phone}` : ''}`,
        originalDate: createdDate,
        amountFC: undefined,
      };
    }

    case 'stockAdjustment': {
      const r = record as StockAdjustment;
      const settings = await db.settings.get('app_settings');
      const costItem = settings?.costItems?.find((it) => it.id === r.itemId);
      const itemName = costItem?.name || 'Ingrédient';
      const unitLabel = costItem?.usageUnit || 'u.';
      const sign = r.qtyDelta > 0 ? '+' : '';
      return {
        label: `Ajustement stock (${itemName}) – ${formatDate(r.date)} – ${sign}${formatNumber(
          r.qtyDelta,
          4
        )} ${unitLabel}`,
        originalDate: r.date,
        amountFC: undefined,
      };
    }
  }
}

/**
 * Suppression douce commune : dans une seule transaction IndexedDB,
 * enregistre une copie complète dans "trash" puis supprime l'enregistrement d'origine.
 */
export async function moveToTrash<K extends TrashKind>(
  kind: K,
  record: TrashPayloadMap[K]
): Promise<TrashItem<TrashPayloadMap[K]>> {
  const targetTable = getTargetTable(kind);

  return db.transaction(
    'rw',
    [targetTable, db.trash, db.settings, db.customers],
    async () => {
      const settings = await db.settings.get('app_settings');
      const currency = settings?.currency || 'FC';
      const meta = await buildTrashMetadata(kind, record, currency);
      const now = Date.now();

      const trashEntry: TrashItem<TrashPayloadMap[K]> = {
        id: `trash_${now}_${Math.random().toString(36).slice(2, 8)}`,
        kind,
        originalId: record.id,
        label: meta.label,
        originalDate: meta.originalDate,
        amountFC: meta.amountFC,
        payload: clonePayload(record),
        deletedAt: now,
      };

      if (trashEntry.amountFC === undefined) {
        delete trashEntry.amountFC;
      }

      await db.trash.add(trashEntry);
      await targetTable.delete(record.id);

      return trashEntry;
    }
  );
}

/**
 * Restaure un élément depuis la corbeille vers sa table d'origine avec le même id,
 * dans une transaction unique, et marque restoredAt sur l'élément de la corbeille.
 */
export async function restoreFromTrash(
  trashId: string
): Promise<{ success: boolean; message: string }> {
  try {
    return await db.transaction(
      'rw',
      [
        db.trash,
        db.dailyEntries,
        db.personalSales,
        db.productionEntries,
        db.expenses,
        db.payments,
        db.reserveMovements,
        db.debtPayments,
        db.customers,
        db.stockAdjustments,
      ],
      async () => {
        const item = await db.trash.get(trashId);
        if (!item) {
          return {
            success: false,
            message: 'Cet élément est introuvable dans la corbeille.',
          };
        }

        if (item.restoredAt) {
          return {
            success: false,
            message: 'Cet élément a déjà été restauré.',
          };
        }

        const targetTable = getTargetTable(item.kind);
        const existingWithSameId = await targetTable.get(item.originalId);
        if (existingWithSameId) {
          return {
            success: false,
            message:
              'Restauration refusée : un enregistrement avec le même identifiant existe déjà.',
          };
        }

        // Vérification d'unicité du nom si on restaure un client
        if (item.kind === 'customer') {
          const customerPayload = item.payload as Customer;
          const normTarget = normalizeCustomerName(customerPayload?.name || '');
          if (normTarget) {
            const allCustomers = await db.customers.toArray();
            const duplicate = allCustomers.find(
              (c) => normalizeCustomerName(c.name) === normTarget
            );
            if (duplicate) {
              return {
                success: false,
                message: `Restauration refusée : un client nommé « ${duplicate.name} » existe déjà.`,
              };
            }
          }
        }

        // Vérification du client rattaché pour un paiement de dette ou une vente client
        if (item.kind === 'debtPayment') {
          const dp = item.payload as DebtPayment;
          if (dp?.customerId) {
            const existingCustomer = await db.customers.get(dp.customerId);
            if (!existingCustomer) {
              const trashedCustomers = await db.trash
                .where('kind')
                .equals('customer')
                .toArray();
              const matchingDeletedCustomer = trashedCustomers.find(
                (t) => t.originalId === dp.customerId && !t.restoredAt
              );
              const custHint = matchingDeletedCustomer?.payload?.name
                ? ` (${matchingDeletedCustomer.payload.name})`
                : '';
              return {
                success: false,
                message: `Ce paiement de dette est rattaché à un client supprimé${custHint}. Veuillez restaurer le client d’abord.`,
              };
            }
          }
        }

        if (item.kind === 'personalSale') {
          const sale = item.payload as PersonalSale;
          if (sale?.customerId) {
            const existingCustomer = await db.customers.get(sale.customerId);
            if (!existingCustomer) {
              const custHint = sale.customerName ? ` (${sale.customerName})` : '';
              return {
                success: false,
                message: `Cette vente est rattachée à un client supprimé${custHint}. Veuillez restaurer le client d’abord.`,
              };
            }
          }
        }

        const payloadToRestore = {
          ...clonePayload(item.payload),
          id: item.originalId,
        };

        const restoredAt = Date.now();
        await targetTable.add(payloadToRestore);
        await db.trash.update(trashId, { restoredAt });

        return {
          success: true,
          message: `Élément restauré avec succès (${TRASH_KIND_LABELS[item.kind]}).`,
        };
      }
    );
  } catch (err: any) {
    return {
      success: false,
      message: 'Erreur lors de la restauration : ' + (err?.message || String(err)),
    };
  }
}

export async function permanentlyDeleteTrashItem(trashId: string): Promise<void> {
  await db.trash.delete(trashId);
}

export async function emptyTrash(): Promise<void> {
  await db.trash.clear();
}
