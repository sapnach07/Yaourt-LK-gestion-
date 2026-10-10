import { jsPDF, GState } from 'jspdf';
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
  const payslip = settings?.payslipSettings || {};

  // Custom primary color or default teal [13, 148, 136]
  let primaryColor: [number, number, number] = [13, 148, 136];
  if (payslip.primaryColorHex) {
    const hex = payslip.primaryColorHex.replace('#', '');
    if (hex.length === 6) {
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        primaryColor = [r, g, b];
      }
    }
  }

  const darkTextColor: [number, number, number] = [30, 41, 59];
  const mutedTextColor: [number, number, number] = [100, 116, 139];

  // Helper to draw background image on any page if configured
  const drawPageBackground = () => {
    if (payslip.bgImageBase64) {
      try {
        const opacity = Math.min(0.4, Math.max(0.05, (payslip.bgOpacityPct ?? 15) / 100));
        doc.saveGraphicsState?.();
        doc.setGState(new GState({ opacity }));
        doc.addImage(payslip.bgImageBase64, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
        doc.restoreGraphicsState?.();
        doc.setGState(new GState({ opacity: 1.0 }));
      } catch (err) {
        console.warn('Erreur rendu photo arrière-plan PDF:', err);
      }
    }
  };

  // Draw background on page 1
  drawPageBackground();

  // Logo rendering if provided
  let headerStartY = 18;
  if (payslip.logoBase64) {
    try {
      const logoW = 28;
      const logoH = 14;
      let logoX = 14;
      if (payslip.logoPosition === 'center') {
        logoX = (210 - logoW) / 2;
      } else if (payslip.logoPosition === 'right') {
        logoX = 210 - 14 - logoW;
      }
      doc.addImage(payslip.logoBase64, 'PNG', logoX, 8, logoW, logoH, undefined, 'FAST');
      if (payslip.logoPosition === 'center') {
        headerStartY = 27;
      }
    } catch (err) {
      console.warn('Erreur rendu logo PDF:', err);
    }
  }

  // Header texts
  const displayName = payslip.businessName || settings?.businessName || 'Yaourt Gestion';
  const displayTitle = `${payslip.documentTitle || 'Document officiel de décompte mensuel'} - ${monthName}`;

  doc.setFontSize(18);
  doc.setTextColor(...primaryColor);
  doc.setFont('helvetica', 'bold');
  doc.text(displayName, 14, headerStartY);

  doc.setFontSize(9.5);
  doc.setTextColor(...mutedTextColor);
  doc.setFont('helvetica', 'normal');
  doc.text(displayTitle, 14, headerStartY + 6);

  if (payslip.headerContact?.trim()) {
    doc.setFontSize(8);
    doc.text(payslip.headerContact.trim(), 14, headerStartY + 11);
    headerStartY += 5;
  }

  // Employee Card Box
  const cardBoxY = headerStartY + 10;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, cardBoxY, 182, 24, 2, 2, 'FD');

  doc.setFontSize(11);
  doc.setTextColor(...darkTextColor);
  doc.setFont('helvetica', 'bold');
  doc.text(`Vendeur(se) : ${employee.name}`, 18, cardBoxY + 8);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...mutedTextColor);

  const showPhone = payslip.showEmployeePhone ?? true;
  const showCommission = payslip.showCommissionRate ?? true;

  const phonePart = showPhone
    ? employee.phone ? `Tél : ${employee.phone}` : 'Tél : Non renseigné'
    : '';
  const commPart = showCommission
    ? `Taux commission : ${formatNumber(employee.commissionRate)} %`
    : '';
  const subInfo = [phonePart, commPart].filter(Boolean).join('  |  ');

  if (subInfo) {
    doc.text(subInfo, 18, cardBoxY + 14);
  }
  doc.text(`Date d'émission : ${formatDate(toISODate(new Date()))}`, 18, cardBoxY + 20);

  // Column visibility options
  const showDelivery = payslip.showDeliveryCol ?? true;
  const showDamaged = payslip.showDamagedCol ?? true;

  // Build columns dynamically
  const headCols: string[] = ['Date'];
  if (showDelivery) headCols.push('Livraison (FC)');
  headCols.push('Ventes (FC)');
  headCols.push('Reste (FC)');
  if (showDamaged) headCols.push('Abîmé (FC)');
  headCols.push('Commission (FC)');

  // Prepare table data
  const tableRows: any[] = [];
  let sumDeliveredFC = 0;
  let sumSoldFC = 0;
  let sumDamagedFC = 0;
  let sumRestFC = 0;
  let sumCommissionFC = 0;

  // Sort entries by date ascending
  const sortedEntries = [...entries].sort((a, b) => a.date.localeCompare(b.date));

  for (const entry of sortedEntries) {
    let dayDeliveredFC = 0;
    let dayDamagedFC = 0;
    let dayRestFC = 0;

    for (const item of entry.items) {
      dayDeliveredFC += item.delivered * (item.unitPrice || 0);
      dayDamagedFC += item.damaged * (item.unitPrice || 0);
      dayRestFC += item.rest * (item.unitPrice || 0);
    }

    sumDeliveredFC += dayDeliveredFC;
    sumSoldFC += entry.totalSalesFC;
    sumDamagedFC += dayDamagedFC;
    sumRestFC += dayRestFC;
    sumCommissionFC += entry.employeeCommissionFC;

    const row: string[] = [formatDate(entry.date)];
    if (showDelivery) row.push(formatFC(dayDeliveredFC, currency));
    row.push(formatFC(entry.totalSalesFC, currency));
    row.push(formatFC(dayRestFC, currency));
    if (showDamaged) row.push(dayDamagedFC > 0 ? formatFC(dayDamagedFC, currency) : '0 FC');
    row.push(formatFC(entry.employeeCommissionFC, currency));

    tableRows.push(row);
  }

  // Calculate payments
  const totalPaidFC = payments.reduce((acc, p) => acc + (p.amountFC || 0), 0);
  const netDueFC = sumCommissionFC - totalPaidFC;

  // Table Totals row
  const totalsRow: string[] = ['TOTAUX'];
  if (showDelivery) totalsRow.push(formatFC(sumDeliveredFC, currency));
  totalsRow.push(formatFC(sumSoldFC, currency));
  totalsRow.push(formatFC(sumRestFC, currency));
  if (showDamaged) totalsRow.push(formatFC(sumDamagedFC, currency));
  totalsRow.push(formatFC(sumCommissionFC, currency));

  // Build columnStyles
  const colStyles: Record<number, any> = { 0: { halign: 'left' } };
  for (let c = 1; c < headCols.length; c++) {
    colStyles[c] = {
      halign: 'right',
      fontStyle: c === headCols.length - 1 || c === (showDelivery ? 2 : 1) ? 'bold' : 'normal',
    };
  }

  // Empty fallback row if no entries
  const emptyRow: string[] = headCols.map(() => '-');

  // Add Table using autoTable with hook for background on subsequent pages
  autoTable(doc, {
    startY: cardBoxY + 28,
    head: [headCols],
    body: tableRows.length > 0 ? tableRows : [emptyRow],
    theme: 'grid',
    headStyles: {
      fillColor: primaryColor,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
      halign: 'center',
    },
    styles: {
      fontSize: 8,
      textColor: darkTextColor,
      cellPadding: 2,
      halign: 'center',
    },
    columnStyles: colStyles,
    foot: [totalsRow],
    footStyles: {
      fillColor: [241, 245, 249],
      textColor: darkTextColor,
      fontStyle: 'bold',
      fontSize: 8.5,
      halign: 'center',
    },
    didDrawPage: (dataHook) => {
      // Draw background if page number > 1
      if (dataHook.pageNumber > 1) {
        drawPageBackground();
      }
    },
  });

  // Summary and Payment Box
  // @ts-ignore
  let finalY = (doc as any).lastAutoTable?.finalY || 180;
  if (finalY > 215) {
    doc.addPage();
    drawPageBackground();
    finalY = 20;
  } else {
    finalY += 8;
  }

  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(14, finalY, 182, 42, 2, 2, 'FD');

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...darkTextColor);
  doc.text('RÉSUMÉ DES RÈGLEMENTS DU MOIS', 18, finalY + 7);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...mutedTextColor);
  doc.text(`Total livraisons du mois :`, 18, finalY + 13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...darkTextColor);
  doc.text(formatFC(sumDeliveredFC, currency), 95, finalY + 13);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...mutedTextColor);
  doc.text(`Total ventes réalisées :`, 18, finalY + 19);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...darkTextColor);
  doc.text(formatFC(sumSoldFC, currency), 95, finalY + 19);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...mutedTextColor);
  doc.text(`Total commission gagnée :`, 18, finalY + 25);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...darkTextColor);
  doc.text(formatFC(sumCommissionFC, currency), 95, finalY + 25);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...mutedTextColor);
  doc.text(`Avances ou montants déjà versés :`, 18, finalY + 31);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...darkTextColor);
  doc.text(`- ${formatFC(totalPaidFC, currency)}`, 95, finalY + 31);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(21, 128, 61); // Vert
  doc.text(`RESTE NET À PAYER :`, 18, finalY + 38);
  doc.text(formatFC(netDueFC, currency), 95, finalY + 38);

  // Footer Note if specified
  let currentBottomY = finalY + 44;
  if (payslip.footerNote?.trim()) {
    currentBottomY += 4;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...mutedTextColor);
    const splitNote = doc.splitTextToSize(payslip.footerNote.trim(), 180);
    doc.text(splitNote, 15, currentBottomY);
    currentBottomY += splitNote.length * 4;
  }

  // Signatures Section (can be hidden)
  const showSignatures = payslip.showSignatureZones ?? true;
  if (showSignatures) {
    let signatureY = currentBottomY + 6;
    if (signatureY > 260) {
      doc.addPage();
      drawPageBackground();
      signatureY = 25;
    }

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...darkTextColor);

    // Employee signature box
    const empLabel = payslip.employeeSignatureLabel || 'Signature du/de la vendeur(se)';
    const empSub = payslip.employeeSignatureSubtext || '(Précédé de la mention "Bon pour accord")';
    doc.text(empLabel, 20, signatureY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...mutedTextColor);
    doc.text(empSub, 20, signatureY + 5);
    doc.setDrawColor(148, 163, 184);
    doc.line(20, signatureY + 24, 85, signatureY + 24);

    // Owner signature box
    const ownerLabel = payslip.ownerSignatureLabel || 'Signature du gérant / propriétaire';
    const ownerSub = payslip.ownerSignatureSubtext || '(Précédé de la mention "Payé / Validé")';
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...darkTextColor);
    doc.text(ownerLabel, 115, signatureY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...mutedTextColor);
    doc.text(ownerSub, 115, signatureY + 5);
    doc.setDrawColor(148, 163, 184);
    doc.line(115, signatureY + 24, 180, signatureY + 24);
  }

  const cleanEmpName = employee.name.replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `Fiche_${cleanEmpName}_${month}.pdf`;

  if (action === 'share' && typeof navigator !== 'undefined' && navigator.share) {
    try {
      const pdfBlob = doc.output('blob');
      const file = new File([pdfBlob], filename, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Fiche de paie vendeur(se) - ${employee.name} (${monthName})`,
          text: `Bonjour ${employee.name}, voici ton décompte pour le mois de ${monthName}. Livraisons : ${formatFC(sumDeliveredFC, currency)} | Ventes : ${formatFC(sumSoldFC, currency)} | Commission : ${formatFC(sumCommissionFC, currency)} | Reste à payer : ${formatFC(netDueFC, currency)}.`,
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
      ['Commissions Vendeurs(ses)', formatFC(stats.totalCommissionFC, currency), 'Rémunérations dues'],
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
  doc.text('Performance par Vendeur(se)', 14, nextY);

  const empRows = employeeBreakdown.map((emp) => [
    emp.name,
    formatFC(emp.salesFC, currency),
    formatFC(emp.commissionFC, currency),
    formatPercent(emp.sellRatePct),
    formatPercent(emp.lossRatePct),
  ]);

  autoTable(doc, {
    startY: nextY + 3,
    head: [['Vendeur(se)', 'Ventes (FC)', 'Commission (FC)', 'Taux Vente', 'Taux Perte']],
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
