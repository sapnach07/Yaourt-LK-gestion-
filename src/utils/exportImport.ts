import { db } from '../db/db';
import { formatDate, formatFC, toISODate } from './formatters';
import type { AppSettings } from '../types';

export interface BackupData {
  version: number;
  exportDate: string;
  businessName: string;
  employees: any[];
  products: any[];
  dailyEntries: any[];
  productionEntries: any[];
  expenses: any[];
  payments: any[];
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
    payments,
    settingsList,
  ] = await Promise.all([
    db.employees.toArray(),
    db.products.toArray(),
    db.dailyEntries.toArray(),
    db.productionEntries.toArray(),
    db.expenses.toArray(),
    db.payments.toArray(),
    db.settings.toArray(),
  ]);

  const currentSettings = settingsList[0] || (await db.settings.get('app_settings'));
  const now = new Date();
  const dateStr = toISODate(now);

  const backup: BackupData = {
    version: 1,
    exportDate: now.toISOString(),
    businessName: currentSettings?.businessName || 'Yaourt Gestion',
    employees,
    products,
    dailyEntries,
    productionEntries,
    expenses,
    payments,
    settings: {
      ...currentSettings,
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
        db.payments.clear(),
      ]);
    }

    if (data.employees?.length) await db.employees.bulkPut(data.employees);
    if (data.products?.length) await db.products.bulkPut(data.products);
    if (data.dailyEntries?.length) await db.dailyEntries.bulkPut(data.dailyEntries);
    if (data.productionEntries?.length) await db.productionEntries.bulkPut(data.productionEntries);
    if (data.expenses?.length) await db.expenses.bulkPut(data.expenses);
    if (data.payments?.length) await db.payments.bulkPut(data.payments);
    if (data.settings) await db.settings.put(data.settings);

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
