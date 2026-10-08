import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatDate, formatFC, formatPercent, formatMonthName, toISODate, formatNumber } from './formatters';
import type { DailyEntry, Employee, Payment, AppSettings } from '../types';

export interface MonthlyEmployeeSheetData {
  employee: Employee;
  month: string; // YYYY-MM
  entries: DailyEntry[];
  payments: Payment[];
  settings: AppSettings;
}

/**
 * Generates the official monthly verification sheet for an employee.
 * Includes complete daily breakdown, products, commissions, advances/payments,
 * remaining balance to pay, and dual signature zones (Employee & Owner).
 * Returns the jsPDF doc instance or triggers share / download.
 */
export async function generateEmployeeMonthlyPDF(
  data: MonthlyEmployeeSheetData,
  action: 'download' | 'share' = 'download'
): Promise<boolean> {
  const { employee, month, entries, payments, settings } = data;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const currency = settings?.currency || 'FC';
  const monthName = formatMonthName(month);

  // Colors
  const primaryColor: [number, number, number] = [13, 148, 136]; // Teal #0d9488
  const darkTextColor: [number, number, number] = [30, 41, 59];
  const mutedTextColor: [number, number, number] = [100, 116, 139];

  // Header
  doc.setFontSize(18);
  doc.setTextColor(...primaryColor);
  doc.setFont('helvetica', 'bold');
  doc.text(settings?.businessName || 'Yaourt Gestion', 14, 18);

  doc.setFontSize(10);
  doc.setTextColor(...mutedTextColor);
  doc.setFont('helvetica', 'normal');
  doc.text(`Document officiel de décompte mensuel - ${monthName}`, 14, 24);

  // Employee Card Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, 28, 182, 24, 2, 2, 'FD');

  doc.setFontSize(11);
  doc.setTextColor(...darkTextColor);
  doc.setFont('helvetica', 'bold');
  doc.text(`Employée : ${employee.name}`, 18, 36);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...mutedTextColor);
  const phoneText = employee.phone ? `Tél : ${employee.phone}` : 'Tél : Non renseigné';
  doc.text(`${phoneText}  |  Taux commission : ${formatNumber(employee.commissionRate)} %`, 18, 42);
  doc.text(`Date d'émission : ${formatDate(toISODate(new Date()))}`, 18, 48);

  // Prepare table data
  // Group or list by day
  const tableRows: any[] = [];
  let sumDelivered = 0;
  let sumSold = 0;
  let sumDamaged = 0;
  let sumRest = 0;
  let sumSalesFC = 0;
  let sumDamagedFC = 0;
  let sumCommissionFC = 0;

  // Sort entries by date ascending
  const sortedEntries = [...entries].sort((a, b) => a.date.localeCompare(b.date));

  for (const entry of sortedEntries) {
    let dayDelivered = 0;
    let daySold = 0;
    let dayDamaged = 0;
    let dayRest = 0;

    for (const item of entry.items) {
      dayDelivered += item.delivered;
      daySold += item.sold;
      dayDamaged += item.damaged;
      dayRest += item.rest;
    }

    sumDelivered += dayDelivered;
    sumSold += daySold;
    sumDamaged += dayDamaged;
    sumRest += dayRest;
    sumSalesFC += entry.totalSalesFC;
    sumDamagedFC += entry.totalDamagedFC;
    sumCommissionFC += entry.employeeCommissionFC;

    tableRows.push([
      formatDate(entry.date),
      formatNumber(dayDelivered),
      formatNumber(daySold),
      formatNumber(dayRest),
      formatNumber(dayDamaged),
      formatFC(entry.totalSalesFC, currency),
      formatFC(entry.employeeCommissionFC, currency),
    ]);
  }

  // Calculate payments
  const totalPaidFC = payments.reduce((acc, p) => acc + (p.amountFC || 0), 0);
  const netDueFC = sumCommissionFC - totalPaidFC;

  // Add Table using autoTable
  autoTable(doc, {
    startY: 56,
    head: [['Date', 'Livraison', 'Vente', 'Reste', 'Abîmé', 'Ventes (FC)', 'Commission']],
    body: tableRows.length > 0 ? tableRows : [['-', '-', '-', '-', '-', '-', '-']],
    theme: 'grid',
    headStyles: {
      fillColor: primaryColor,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9,
      halign: 'center',
    },
    styles: {
      fontSize: 8.5,
      textColor: darkTextColor,
      cellPadding: 2.2,
      halign: 'center',
    },
    columnStyles: {
      0: { halign: 'left' },
      5: { halign: 'right' },
      6: { halign: 'right', fontStyle: 'bold' },
    },
    foot: [
      [
        'TOTAUX',
        formatNumber(sumDelivered),
        formatNumber(sumSold),
        '-',
        formatNumber(sumDamaged),
        formatFC(sumSalesFC, currency),
        formatFC(sumCommissionFC, currency),
      ],
    ],
    footStyles: {
      fillColor: [241, 245, 249],
      textColor: darkTextColor,
      fontStyle: 'bold',
      fontSize: 9,
      halign: 'center',
    },
  });

  // Summary and Payment Box
  // @ts-ignore
  let finalY = (doc as any).lastAutoTable?.finalY || 180;
  if (finalY > 220) {
    doc.addPage();
    finalY = 20;
  } else {
    finalY += 8;
  }

  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(14, finalY, 182, 34, 2, 2, 'FD');

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...darkTextColor);
  doc.text('RÉSUMÉ DES RÈGLEMENTS DU MOIS', 18, finalY + 7);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...mutedTextColor);
  doc.text(`Total commission gagnée :`, 18, finalY + 14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...darkTextColor);
  doc.text(formatFC(sumCommissionFC, currency), 90, finalY + 14);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...mutedTextColor);
  doc.text(`Avances ou montants déjà versés :`, 18, finalY + 20);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...darkTextColor);
  doc.text(`- ${formatFC(totalPaidFC, currency)}`, 90, finalY + 20);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  if (netDueFC > 0) {
    doc.setTextColor(185, 28, 28); // Red
  } else {
    doc.setTextColor(21, 128, 61); // Green
  }
  doc.text(`RESTE NET À PAYER :`, 18, finalY + 28);
  doc.text(formatFC(netDueFC, currency), 90, finalY + 28);

  // Signatures Section
  const signatureY = finalY + 44;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...darkTextColor);

  // Employee signature box
  doc.text(`Signature de l'employée`, 20, signatureY);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...mutedTextColor);
  doc.text(`(Précédé de la mention "Bon pour accord")`, 20, signatureY + 5);
  doc.setDrawColor(148, 163, 184);
  doc.line(20, signatureY + 24, 85, signatureY + 24);

  // Owner signature box
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...darkTextColor);
  doc.text(`Signature du gérant / propriétaire`, 115, signatureY);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...mutedTextColor);
  doc.text(`(Précédé de la mention "Payé / Validé")`, 115, signatureY + 5);
  doc.setDrawColor(148, 163, 184);
  doc.line(115, signatureY + 24, 180, signatureY + 24);

  const cleanEmpName = employee.name.replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `Fiche_${cleanEmpName}_${month}.pdf`;

  if (action === 'share' && typeof navigator !== 'undefined' && navigator.share) {
    try {
      const pdfBlob = doc.output('blob');
      const file = new File([pdfBlob], filename, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Fiche de paie - ${employee.name} (${monthName})`,
          text: `Bonjour ${employee.name}, voici ton décompte pour le mois de ${monthName}. Reste à payer : ${formatFC(netDueFC, currency)}.`,
        });
        return true;
      }
    } catch (e) {
      console.warn('Share non supporté ou annulé, téléchargement direct:', e);
    }
  }

  // Fallback to direct download
  doc.save(filename);
  return true;
}

export interface MonthlyManagerReportData {
  month: string;
  settings: AppSettings;
  stats: {
    totalSalesFC: number;
    totalCommissionFC: number;
    totalExpensesFC: number;
    realProfitFC: number;
    profitMarginPct: number;
    soldQty: number;
    damagedQty: number;
    damagedValueFC: number;
    totalToSellQty: number;
    sellRatePct: number;
    lossRatePct: number;
    expenseReserveFC: number;
    expenseVsReserveBalanceFC: number;
  };
  employeeBreakdown: Array<{
    name: string;
    salesFC: number;
    commissionFC: number;
    sellRatePct: number;
    lossRatePct: number;
  }>;
  categoryExpenses: Array<{
    category: string;
    amountFC: number;
  }>;
}

/**
 * Generates the official Monthly Management Report PDF (Rapport de gestion du mois).
 */
export async function generateMonthlyManagementReportPDF(
  data: MonthlyManagerReportData
): Promise<void> {
  const { month, settings, stats, employeeBreakdown, categoryExpenses } = data;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const currency = settings.currency || 'FC';
  const monthName = formatMonthName(month);
  const primaryColor: [number, number, number] = [13, 148, 136];
  const darkTextColor: [number, number, number] = [30, 41, 59];
  const mutedTextColor: [number, number, number] = [100, 116, 139];

  // Header
  doc.setFontSize(20);
  doc.setTextColor(...primaryColor);
  doc.setFont('helvetica', 'bold');
  doc.text(settings.businessName, 14, 18);

  doc.setFontSize(12);
  doc.setTextColor(...darkTextColor);
  doc.setFont('helvetica', 'bold');
  doc.text(`RAPPORT DE GESTION MENSUEL - ${monthName.toUpperCase()}`, 14, 26);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...mutedTextColor);
  doc.text(`Généré le ${formatDate(toISODate(new Date()))} | 100% Hors ligne`, 14, 32);

  // KPI Grid
  autoTable(doc, {
    startY: 38,
    head: [['Indicateur Clé', 'Valeur', 'Commentaire / Règle']],
    body: [
      ['Ventes Totales', formatFC(stats.totalSalesFC, currency), 'Chiffre d’affaires brut'],
      ['Commissions Employées', formatFC(stats.totalCommissionFC, currency), 'Rémunérations dues'],
      ['Dépenses Totales', formatFC(stats.totalExpensesFC, currency), 'Achats & charges du mois'],
      ['BÉNÉFICE RÉEL', formatFC(stats.realProfitFC, currency), 'Ventes - Commissions - Dépenses'],
      ['Marge Bénéficiaire', formatPercent(stats.profitMarginPct), 'Bénéfice réel ÷ Ventes'],
      ['Taux de Vente', formatPercent(stats.sellRatePct), 'Quantités vendues ÷ Total'],
      ['Taux de Perte (Abîmé)', `${formatPercent(stats.lossRatePct)} (${formatFC(stats.damagedValueFC, currency)})`, 'Perte nette à ma charge'],
      ['Réserve Dépenses (50%)', formatFC(stats.expenseReserveFC, currency), `Solde réserve : ${formatFC(stats.expenseVsReserveBalanceFC, currency)}`],
    ],
    theme: 'striped',
    headStyles: {
      fillColor: primaryColor,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9,
    },
    styles: {
      fontSize: 8.5,
      textColor: darkTextColor,
      cellPadding: 2.2,
    },
    columnStyles: {
      1: { fontStyle: 'bold' },
    },
  });

  // @ts-ignore
  let nextY = (doc as any).lastAutoTable?.finalY || 100;
  nextY += 8;

  // Breakdown by employee
  doc.setFontSize(11);
  doc.setTextColor(...darkTextColor);
  doc.setFont('helvetica', 'bold');
  doc.text('Performance par Employée', 14, nextY);

  const empRows = employeeBreakdown.map((emp) => [
    emp.name,
    formatFC(emp.salesFC, currency),
    formatFC(emp.commissionFC, currency),
    formatPercent(emp.sellRatePct),
    formatPercent(emp.lossRatePct),
  ]);

  autoTable(doc, {
    startY: nextY + 3,
    head: [['Employée', 'Ventes (FC)', 'Commission (FC)', 'Taux Vente', 'Taux Perte']],
    body: empRows.length > 0 ? empRows : [['Aucune donnée', '-', '-', '-', '-']],
    theme: 'grid',
    headStyles: {
      fillColor: [51, 65, 85],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
    },
    styles: {
      fontSize: 8,
      cellPadding: 2,
    },
  });

  // @ts-ignore
  let expY = (doc as any).lastAutoTable?.finalY || 160;
  if (expY > 210) {
    doc.addPage();
    expY = 20;
  } else {
    expY += 8;
  }

  doc.setFontSize(11);
  doc.setTextColor(...darkTextColor);
  doc.setFont('helvetica', 'bold');
  doc.text('Répartition des Dépenses par Catégorie', 14, expY);

  const catRows = categoryExpenses.map((cat) => [
    cat.category,
    formatFC(cat.amountFC, currency),
    formatPercent(safePercentage(cat.amountFC, stats.totalExpensesFC)),
  ]);

  autoTable(doc, {
    startY: expY + 3,
    head: [['Catégorie', 'Montant (FC)', 'Part des Dépenses']],
    body: catRows.length > 0 ? catRows : [['Aucune dépense', '-', '-']],
    theme: 'grid',
    headStyles: {
      fillColor: [71, 85, 105],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
    },
    styles: {
      fontSize: 8,
      cellPadding: 2,
    },
  });

  doc.save(`Rapport_Gestion_${month}.pdf`);
}

function safePercentage(num: number, den: number): number {
  if (!den || den === 0) return 0;
  return (num / den) * 100;
}
