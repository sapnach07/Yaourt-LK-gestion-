import { db } from '../db/db';
import { formatDate, formatFC, toISODate } from './formatters';
import { normalizeCustomerName } from './debtCalculator';
import type { AppSettings, Customer } from '../types';

export interface BackupData {
  version: number;
  exportDate: string;
  businessName: string;
  employees: any[];
  products: any[];
  dailyEntries: any[];
  productionEntries: any[];
  expenses: any[];
  reserveMovements?: any[];
  payments: any[];
  personalSales?: any[];
  customers?: any[];
  debtPayments?: any[];
  settings: AppSettings;
}

/**
 * Exports all IndexedDB data to a downloadable JSON file.
 * Updates lastBackupDate in settings.
 */
export async function exportAllDataToJSON(): Promise<void> {
  const [
    employees,
    products,
    dailyEntries,
    productionEntries,
    expenses,
    reserveMovements,
    payments,
    personalSales,
    customers,
    debtPayments,
    settingsList,
  ] = await Promise.all([
    db.employees.toArray(),
    db.products.toArray(),
    db.dailyEntries.toArray(),
    db.productionEntries.toArray(),
    db.expenses.toArray(),
    db.reserveMovements.toArray(),
    db.payments.toArray(),
    db.personalSales.toArray(),
    db.customers.toArray(),
    db.debtPayments.toArray(),
    db.settings.toArray(),
  ]);

  const currentSettings = settingsList[0] || (await db.settings.get('app_settings'));
  const now = new Date();
  const dateStr = toISODate(now);

  const backup: BackupData = {
    version: 4,
    exportDate: now.toISOString(),
    businessName: currentSettings?.businessName || 'Yaourt Gestion',
    employees,
    products,
    dailyEntries,
    productionEntries,
    expenses,
    reserveMovements,
    payments,
    personalSales,
    customers,
    debtPayments,
    settings: {
      ...currentSettings,
      debtReminderDays: currentSettings?.debtReminderDays ?? 2,
      lastBackupDate: dateStr,
    },
  };

  // Update last backup date in database
  if (currentSettings) {
    await db.settings.put({
      ...currentSettings,
      lastBackupDate: dateStr,
    });
  }

  const jsonStr = JSON.stringify(backup, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const filename = `Sauvegarde_YaourtGestion_${dateStr}.json`;

  downloadBlob(blob, filename);
}

/**
 * Restores data from JSON backup.
 * Mode: 'replace' deletes existing records; 'merge' updates or adds.
 */
export async function restoreDataFromJSON(
  fileContent: string,
  mode: 'replace' | 'merge'
): Promise<{ success: boolean; message: string }> {
  try {
    const data: BackupData = JSON.parse(fileContent);

    if (!data.version || !Array.isArray(data.employees)) {
      return {
        success: false,
        message: 'Le fichier sélectionné n’est pas une sauvegarde valide de Yaourt Gestion.',
      };
    }

    if (mode === 'replace') {
      await Promise.all([
        db.employees.clear(),
        db.products.clear(),
        db.dailyEntries.clear(),
        db.productionEntries.clear(),
        db.expenses.clear(),
        db.reserveMovements.clear(),
        db.payments.clear(),
        db.personalSales.clear(),
        db.customers.clear(),
        db.debtPayments.clear(),
      ]);
    }

    // Dédoublonnage insensible à la casse des clients lors d'une fusion (ou d'un import)
    const existingCustomers: Customer[] = mode === 'merge' ? await db.customers.toArray() : [];
    const byNormalizedName = new Map<string, Customer>();
    for (const c of existingCustomers) {
      byNormalizedName.set(normalizeCustomerName(c.name), c);
    }

    const customerIdRemap = new Map<string, string>();
    if (Array.isArray(data.customers) && data.customers.length > 0) {
      const customersToPut: Customer[] = [];
      for (const rawC of data.customers) {
        if (!rawC || !rawC.id || !rawC.name) continue;
        const norm = normalizeCustomerName(String(rawC.name));
        if (!norm) continue;
        const already = byNormalizedName.get(norm);
        if (already && already.id !== rawC.id) {
          // Même nom (insensible à la casse) mais ID différent : conserver le client existant et remapper l'ID
          customerIdRemap.set(rawC.id, already.id);
          const merged: Customer = {
            ...already,
            phone: already.phone || rawC.phone || undefined,
            note: already.note || rawC.note || undefined,
          };
          byNormalizedName.set(norm, merged);
          customersToPut.push(merged);
        } else {
          const cleanC: Customer = {
            id: String(rawC.id),
            name: String(rawC.name).trim(),
            phone: rawC.phone ? String(rawC.phone).trim() : undefined,
            note: rawC.note ? String(rawC.note).trim() : undefined,
            createdAt: Number(rawC.createdAt) || Date.now(),
          };
          byNormalizedName.set(norm, cleanC);
          customersToPut.push(cleanC);
        }
      }
      if (customersToPut.length > 0) {
        await db.customers.bulkPut(customersToPut);
      }
    }

    if (data.employees?.length) await db.employees.bulkPut(data.employees);
    if (data.products?.length) await db.products.bulkPut(data.products);
    if (data.dailyEntries?.length) await db.dailyEntries.bulkPut(data.dailyEntries);
    if (data.productionEntries?.length) await db.productionEntries.bulkPut(data.productionEntries);
    if (data.expenses?.length) await db.expenses.bulkPut(data.expenses);
    if (data.reserveMovements?.length) await db.reserveMovements.bulkPut(data.reserveMovements);
    if (data.payments?.length) await db.payments.bulkPut(data.payments);
    if (data.personalSales?.length) {
      const sanitizedSales = data.personalSales.map((ps: any) => {
        const kind = ps.kind || 'vente';
        const isConsommation = kind === 'consommation';
        const remappedCustomerId = ps.customerId
          ? customerIdRemap.get(ps.customerId) || ps.customerId
          : undefined;
        return {
          ...ps,
          kind,
          consumptionValueFC: ps.consumptionValueFC ?? 0,
          consumptionPaidFC: ps.consumptionPaidFC,
          // Une consommation ne peut jamais être à crédit ; une vente existante sans statut reste payée
          paymentStatus: isConsommation
            ? undefined
            : ps.paymentStatus === 'credit'
            ? 'credit'
            : ps.paymentStatus === 'paid'
            ? 'paid'
            : undefined,
          customerId: isConsommation ? undefined : remappedCustomerId,
          customerName: isConsommation ? undefined : ps.customerName,
          isOpeningDebt: isConsommation ? undefined : Boolean(ps.isOpeningDebt) || undefined,
          writtenOffFC:
            !isConsommation && ps.writtenOffFC !== undefined ? Number(ps.writtenOffFC) : undefined,
          writtenOffAt:
            !isConsommation && ps.writtenOffAt !== undefined ? Number(ps.writtenOffAt) : undefined,
        };
      });
      await db.personalSales.bulkPut(sanitizedSales);
    }
    if (Array.isArray(data.debtPayments) && data.debtPayments.length > 0) {
      const sanitizedDebtPayments = data.debtPayments
        .filter((dp: any) => dp && dp.id && dp.customerId && dp.date)
        .map((dp: any) => ({
          id: String(dp.id),
          customerId: customerIdRemap.get(String(dp.customerId)) || String(dp.customerId),
          date: String(dp.date),
          amountFC: Math.max(0, Math.round(Number(dp.amountFC) || 0)),
          note: dp.note ? String(dp.note).trim() : undefined,
          createdAt: Number(dp.createdAt) || Date.now(),
        }));
      if (sanitizedDebtPayments.length > 0) {
        await db.debtPayments.bulkPut(sanitizedDebtPayments);
      }
    }
    if (data.settings) {
      await db.settings.put({
        ...data.settings,
        debtReminderDays:
          data.settings.debtReminderDays !== undefined ? data.settings.debtReminderDays : 2,
      });
    }

    return {
      success: true,
      message: `Restauration réussie (${mode === 'replace' ? 'Remplacement' : 'Fusion'}).`,
    };
  } catch (err: any) {
    console.error('Erreur restauration:', err);
    return {
      success: false,
      message: `Erreur lors de la lecture du fichier : ${err.message || 'Format invalide'}`,
    };
  }
}

/**
 * Exports daily sales entries to CSV format.
 */
export async function exportSalesToCSV(): Promise<void> {
  const entries = await db.dailyEntries.orderBy('date').reverse().toArray();
  const settings = await db.settings.get('app_settings');
  const currency = settings?.currency || 'FC';

  let csv = '\uFEFF'; // UTF-8 BOM for Excel
  csv += 'Date;Vendeur(se);Produit;Prix Unitaire;Reste Veille;Livraison;Total à Vendre;Vendu;Abîmé;Reste;Ventes (FC);Perte (FC);Commission (%);Commission (FC);Réserve Dépenses (FC);Part Gérant (FC)\r\n';

  for (const entry of entries) {
    for (const item of entry.items) {
      const soldFC = item.sold * item.unitPrice;
      const damagedFC = item.damaged * item.unitPrice;
      const commFC = Math.round((soldFC * entry.employeeCommissionRate) / 100);
      const reserveFC = Math.round((soldFC * entry.expenseReserveRate) / 100);
      const ownerFC = Math.round((soldFC * entry.ownerShareRate) / 100);

      const row = [
        formatDate(entry.date),
        escapeCsv(entry.employeeName),
        escapeCsv(item.productName),
        item.unitPrice,
        item.previousRest,
        item.delivered,
        item.totalToSell,
        item.sold,
        item.damaged,
        item.rest,
        soldFC,
        damagedFC,
        entry.employeeCommissionRate,
        commFC,
        reserveFC,
        ownerFC,
      ];
      csv += row.join(';') + '\r\n';
    }
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `Ventes_YaourtGestion_${toISODate(new Date())}.csv`);
}

/**
 * Exports expenses to CSV format.
 */
export async function exportExpensesToCSV(): Promise<void> {
  const expenses = await db.expenses.orderBy('date').reverse().toArray();

  let csv = '\uFEFF';
  csv += 'Date;Catégorie;Détail;Montant (FC)\r\n';

  for (const exp of expenses) {
    const row = [
      formatDate(exp.date),
      escapeCsv(exp.category),
      escapeCsv(exp.detail),
      exp.amountFC,
    ];
    csv += row.join(';') + '\r\n';
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `Depenses_YaourtGestion_${toISODate(new Date())}.csv`);
}

function escapeCsv(str: string = ''): string {
  if (str.includes(';') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
