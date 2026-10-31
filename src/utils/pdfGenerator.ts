import { jsPDF, GState } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  formatDate,
  formatDateWithTime,
  formatDeliveryReturnTimes,
  formatFC,
  formatPercent,
  formatMonthName,
  normalizeTimeStr,
  toISODate,
  toLocalTimeStr,
  formatNumber,
} from './formatters';
import {
  formatPaymentModeLabel,
  formatPaymentTypeLabel,
  getPaymentShareForMonth,
} from './sellerPayroll';
import type { DailyEntry, Employee, Payment, AppSettings, PayslipSettings } from '../types';

export interface MonthlyEmployeeSheetData {
  employee: Employee;
  month: string; // YYYY-MM
  entries: DailyEntry[];
  payments: Payment[];
  settings: AppSettings;
}

export interface PaymentByDaysSheetData {
  employee: Employee;
  payment: Payment;
  dailyEntries: DailyEntry[];
  settings: AppSettings;
}

interface ResolvedPayslipTheme {
  currency: string;
  payslip: PayslipSettings;
  primaryColor: [number, number, number];
  darkTextColor: [number, number, number];
  mutedTextColor: [number, number, number];
}

function resolvePayslipTheme(settings: AppSettings): ResolvedPayslipTheme {
  const currency = settings?.currency || 'FC';
  const payslip = settings?.payslipSettings || {};

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

  return {
    currency,
    payslip,
    primaryColor,
    darkTextColor: [30, 41, 59],
    mutedTextColor: [100, 116, 139],
  };
}

function createPayslipBackgroundDrawer(doc: jsPDF, payslip: PayslipSettings): () => void {
  return () => {
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
}

function drawPayslipHeaderAndSellerCard(
  doc: jsPDF,
  params: {
    employee: Employee;
    settings: AppSettings;
    theme: ResolvedPayslipTheme;
    displayTitle: string;
    extraCardLine?: string;
  }
): number {
  const { employee, settings, theme, displayTitle, extraCardLine } = params;
  const { payslip, primaryColor, darkTextColor, mutedTextColor } = theme;

  let headerStartY = 18;
  const effectiveLogo = payslip.logoBase64 || settings?.appLogoBase64;
  if (effectiveLogo) {
    try {
      const logoW = 28;
      const logoH = 14;
      let logoX = 14;
      if (payslip.logoPosition === 'center') {
        logoX = (210 - logoW) / 2;
      } else if (payslip.logoPosition === 'right') {
        logoX = 210 - 14 - logoW;
      }
      doc.addImage(effectiveLogo, 'PNG', logoX, 8, logoW, logoH, undefined, 'FAST');
      if (payslip.logoPosition === 'center') {
        headerStartY = 27;
      }
    } catch (err) {
      console.warn('Erreur rendu logo PDF:', err);
    }
  }

  const displayName = payslip.businessName || settings?.businessName || 'Yaourt Gestion';

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

  const cardBoxY = headerStartY + 10;
  const cardHeight = extraCardLine ? 30 : 24;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, cardBoxY, 182, cardHeight, 2, 2, 'FD');

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
    ? employee.phone
      ? `Tél : ${employee.phone}`
      : 'Tél : Non renseigné'
    : '';
  const commPart = showCommission
    ? `Taux commission : ${formatNumber(employee.commissionRate)} %`
    : '';
  const subInfo = [phonePart, commPart].filter(Boolean).join('  |  ');

  if (subInfo) {
    doc.text(subInfo, 18, cardBoxY + 14);
  }
  const now = new Date();
  doc.text(
    `Date d'émission : ${formatDateWithTime(toISODate(now), toLocalTimeStr(now))}`,
    18,
    cardBoxY + 20
  );

  if (extraCardLine) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...darkTextColor);
    doc.text(extraCardLine, 18, cardBoxY + 26);
  }

  return cardBoxY + cardHeight;
}

function drawPayslipFooterAndSignatures(
  doc: jsPDF,
  currentBottomY: number,
  theme: ResolvedPayslipTheme,
  drawPageBackground: () => void
): void {
  const { payslip, darkTextColor, mutedTextColor } = theme;
  let bottomY = currentBottomY;

  if (payslip.footerNote?.trim()) {
    if (bottomY > 265) {
      doc.addPage();
      drawPageBackground();
      bottomY = 20;
    }
    bottomY += 4;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...mutedTextColor);
    const splitNote = doc.splitTextToSize(payslip.footerNote.trim(), 180);
    doc.text(splitNote, 15, bottomY);
    bottomY += splitNote.length * 4;
  }

  const showSignatures = payslip.showSignatureZones ?? true;
  if (showSignatures) {
    let signatureY = bottomY + 6;
    if (signatureY > 260) {
      doc.addPage();
      drawPageBackground();
      signatureY = 25;
    }

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...darkTextColor);

    const empLabel = payslip.employeeSignatureLabel || 'Signature du/de la vendeur(se)';
    const empSub =
      payslip.employeeSignatureSubtext || '(Précédé de la mention "Bon pour accord")';
    doc.text(empLabel, 20, signatureY);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...mutedTextColor);
    doc.text(empSub, 20, signatureY + 5);
    doc.setDrawColor(148, 163, 184);
    doc.line(20, signatureY + 24, 85, signatureY + 24);

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
}

async function deliverPayslipPDF(
  doc: jsPDF,
  filename: string,
  action: 'download' | 'share',
  shareMeta: { title: string; text: string }
): Promise<boolean> {
  if (action === 'share' && typeof navigator !== 'undefined' && navigator.share) {
    try {
      const pdfBlob = doc.output('blob');
      const file = new File([pdfBlob], filename, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: shareMeta.title,
          text: shareMeta.text,
        });
        return true;
      }
    } catch (e) {
      console.warn('Share non supporté ou annulé, téléchargement direct:', e);
    }
  }

  doc.save(filename);
  return true;
}

function formatPaymentCoveredPeriod(p: Payment): string {
  if (p.periodFrom && p.periodTo) {
    const daysCount = p.coveredItems?.length || 0;
    const suffix = daysCount > 0 ? ` (${daysCount} j.)` : '';
    if (p.periodFrom === p.periodTo) {
      return `Le ${formatDate(p.periodFrom)}${suffix}`;
    }
    return `Du ${formatDate(p.periodFrom)} au ${formatDate(p.periodTo)}${suffix}`;
  }
  return `${formatMonthName(p.month)} (${formatPaymentTypeLabel(p.paymentType)})`;
}

/**
 * Generates the official monthly verification sheet for an employee.
 * Includes complete daily breakdown, products, commissions, advances/payments,
 * remaining balance to pay, list of payments of the month, and dual signature zones.
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

  const theme = resolvePayslipTheme(settings);
  const { currency, payslip, primaryColor, darkTextColor, mutedTextColor } = theme;
  const monthName = formatMonthName(month);

  const drawPageBackground = createPayslipBackgroundDrawer(doc, payslip);
  drawPageBackground();

  const displayTitle = `${
    payslip.documentTitle || 'Document officiel de décompte mensuel'
  } - ${monthName}`;

  const cardBottomY = drawPayslipHeaderAndSellerCard(doc, {
    employee,
    settings,
    theme,
    displayTitle,
  });

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
  const entryDateCells: Array<{ main: string; sub: string | null }> = [];
  let sumDeliveredFC = 0;
  let sumSoldFC = 0;
  let sumDamagedFC = 0;
  let sumRestFC = 0;
  let sumCommissionFC = 0;

  // Sort entries chronologically by date, then time (if present), then createdAt
  const sortedEntries = [...entries].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (normalizeTimeStr(a.time) || '99:99').localeCompare(normalizeTimeStr(b.time) || '99:99') ||
      (a.createdAt || 0) - (b.createdAt || 0)
  );

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

    const shortDate = formatDate(entry.date).slice(0, 5);
    const deliveryReturnSubline = formatDeliveryReturnTimes(
      entry.deliveryTime,
      entry.returnTime
    );
    entryDateCells.push({ main: shortDate, sub: deliveryReturnSubline });

    const row: string[] = [shortDate];
    if (showDelivery) row.push(formatFC(dayDeliveredFC, currency));
    row.push(formatFC(entry.totalSalesFC, currency));
    row.push(formatFC(dayRestFC, currency));
    if (showDamaged) row.push(dayDamagedFC > 0 ? formatFC(dayDamagedFC, currency) : '0 FC');
    row.push(formatFC(entry.employeeCommissionFC, currency));

    tableRows.push(row);
  }

  // Calculate payments for this month (prorated when coveredItems spans multiple months)
  const totalPaidFC = payments.reduce((acc, p) => acc + getPaymentShareForMonth(p, month), 0);
  const netDueFC = sumCommissionFC - totalPaidFC;

  // Table Totals row
  const totalsRow: string[] = ['TOTAUX'];
  if (showDelivery) totalsRow.push(formatFC(sumDeliveredFC, currency));
  totalsRow.push(formatFC(sumSoldFC, currency));
  totalsRow.push(formatFC(sumRestFC, currency));
  if (showDamaged) totalsRow.push(formatFC(sumDamagedFC, currency));
  totalsRow.push(formatFC(sumCommissionFC, currency));

  const hasAnyDeliveryReturnSubline = entryDateCells.some((c) => Boolean(c.sub));

  // Build columnStyles
  const colStyles: Record<number, any> = {
    0: hasAnyDeliveryReturnSubline ? { halign: 'left', cellWidth: 34 } : { halign: 'left' },
  };
  for (let c = 1; c < headCols.length; c++) {
    colStyles[c] = {
      halign: 'right',
      fontStyle: c === headCols.length - 1 || c === (showDelivery ? 2 : 1) ? 'bold' : 'normal',
    };
  }

  const emptyRow: string[] = headCols.map(() => '-');

  autoTable(doc, {
    startY: cardBottomY + 4,
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
      valign: 'middle',
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
    didParseCell: (dataHook) => {
      if (
        dataHook.section === 'body' &&
        dataHook.column.index === 0 &&
        tableRows.length > 0 &&
        entryDateCells[dataHook.row.index]?.sub
      ) {
        dataHook.cell.styles.minCellHeight = 8.6;
      }
    },
    willDrawCell: (dataHook) => {
      if (
        dataHook.section === 'body' &&
        dataHook.column.index === 0 &&
        tableRows.length > 0 &&
        entryDateCells[dataHook.row.index]?.sub
      ) {
        dataHook.cell.text = [''];
      }
    },
    didDrawCell: (dataHook) => {
      if (dataHook.section === 'body' && dataHook.column.index === 0 && tableRows.length > 0) {
        const meta = entryDateCells[dataHook.row.index];
        if (meta?.sub) {
          const padLeft = dataHook.cell.padding('left');
          const cellX = dataHook.cell.x + padLeft;
          const centerY = dataHook.cell.y + dataHook.cell.height / 2;

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(...darkTextColor);
          doc.text(meta.main, cellX, centerY - 0.6);

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(6.2);
          doc.setTextColor(...mutedTextColor);
          doc.text(meta.sub, cellX, centerY + 2.5);
        }
      }
    },
    didDrawPage: (dataHook) => {
      if (dataHook.pageNumber > 1) {
        drawPageBackground();
      }
    },
  });

  // Summary and Payment Box
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
  doc.setTextColor(21, 128, 61);
  doc.text(`RESTE NET À PAYER :`, 18, finalY + 38);
  doc.text(formatFC(netDueFC, currency), 95, finalY + 38);

  let currentBottomY = finalY + 44;

  // Liste des paiements du mois en bas de la fiche mensuelle : date, période couverte, montant
  if (payments.length > 0) {
    if (currentBottomY > 235) {
      doc.addPage();
      drawPageBackground();
      currentBottomY = 20;
    } else {
      currentBottomY += 6;
    }

    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...darkTextColor);
    doc.text('LISTE DES PAIEMENTS DU MOIS', 14, currentBottomY);

    const sortedPayments = [...payments].sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (normalizeTimeStr(a.time) || '99:99').localeCompare(normalizeTimeStr(b.time) || '99:99') ||
        (a.createdAt || 0) - (b.createdAt || 0)
    );

    const paymentRows = sortedPayments.map((p) => {
      const shareFC = getPaymentShareForMonth(p, month);
      const amountCell =
        shareFC !== p.amountFC
          ? `${formatFC(shareFC, currency)} (sur ${formatFC(p.amountFC, currency)})`
          : formatFC(p.amountFC, currency);
      return [formatDateWithTime(p.date, p.time), formatPaymentCoveredPeriod(p), amountCell];
    });

    autoTable(doc, {
      startY: currentBottomY + 2.5,
      head: [['Date', 'Période couverte', 'Montant']],
      body: paymentRows,
      theme: 'grid',
      headStyles: {
        fillColor: [71, 85, 105],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
        halign: 'left',
      },
      styles: {
        fontSize: 8,
        textColor: darkTextColor,
        cellPadding: 1.8,
      },
      columnStyles: {
        0: { halign: 'left', cellWidth: 36 },
        1: { halign: 'left' },
        2: { halign: 'right', fontStyle: 'bold', cellWidth: 48 },
      },
      didDrawPage: (dataHook) => {
        if (dataHook.pageNumber > 1) {
          drawPageBackground();
        }
      },
    });

    currentBottomY = ((doc as any).lastAutoTable?.finalY || currentBottomY + 18) + 2;
  }

  drawPayslipFooterAndSignatures(doc, currentBottomY, theme, drawPageBackground);

  const cleanEmpName = employee.name.replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `Fiche_${cleanEmpName}_${month}.pdf`;

  return deliverPayslipPDF(doc, filename, action, {
    title: `Fiche de paie vendeur(se) - ${employee.name} (${monthName})`,
    text: `Bonjour ${employee.name}, voici ton décompte pour le mois de ${monthName}. Livraisons : ${formatFC(sumDeliveredFC, currency)} | Ventes : ${formatFC(sumSoldFC, currency)} | Commission : ${formatFC(sumCommissionFC, currency)} | Reste à payer : ${formatFC(netDueFC, currency)}.`,
  });
}

/**
 * Génère la fiche de paiement PDF d'un paiement par jours (avec coveredItems),
 * en réutilisant exactement le même style et la même personnalisation (PayslipSettings)
 * que la fiche de paie mensuelle.
 */
export async function generatePaymentByDaysPDF(
  data: PaymentByDaysSheetData,
  action: 'download' | 'share' = 'download'
): Promise<boolean> {
  const { employee, payment, dailyEntries, settings } = data;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const theme = resolvePayslipTheme(settings);
  const { currency, payslip, primaryColor, darkTextColor, mutedTextColor } = theme;
  const drawPageBackground = createPayslipBackgroundDrawer(doc, payslip);
  drawPageBackground();

  const coveredItems = [...(payment.coveredItems || [])].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  const periodFrom =
    payment.periodFrom || (coveredItems.length > 0 ? coveredItems[0].date : payment.date);
  const periodTo =
    payment.periodTo ||
    (coveredItems.length > 0 ? coveredItems[coveredItems.length - 1].date : payment.date);

  const periodLabel =
    periodFrom === periodTo
      ? `Le ${formatDate(periodFrom)}`
      : `Du ${formatDate(periodFrom)} au ${formatDate(periodTo)}`;

  const displayTitle = `Fiche de paiement (${coveredItems.length} ${
    coveredItems.length > 1 ? 'jours payés' : 'jour payé'
  }) - ${periodLabel}`;

  const cardBottomY = drawPayslipHeaderAndSellerCard(doc, {
    employee,
    settings,
    theme,
    displayTitle,
    extraCardLine: `Période payée : ${periodLabel} (${coveredItems.length} ${
      coveredItems.length > 1 ? 'jours' : 'jour'
    })  |  Payé le ${formatDateWithTime(payment.date, payment.time)}`,
  });

  const entriesById = new Map<string, DailyEntry>();
  for (const e of dailyEntries) {
    entriesById.set(e.id, e);
  }

  let sumSalesFC = 0;
  let sumCommissionFC = 0;
  const dayDateCells: Array<{ main: string; sub: string | null }> = [];

  const tableRows = coveredItems.map((item) => {
    const entry = entriesById.get(item.entryId);
    const salesFC = entry ? entry.totalSalesFC || 0 : 0;
    const rate = entry ? entry.employeeCommissionRate : employee.commissionRate;
    const commFC = item.commissionFC || 0;

    sumSalesFC += salesFC;
    sumCommissionFC += commFC;

    const entryTime = normalizeTimeStr(entry?.time);
    const mainDate = entryTime
      ? `${formatDate(item.date)} · ${entryTime}`
      : formatDate(item.date);
    const deliveryReturnSub = formatDeliveryReturnTimes(
      entry?.deliveryTime,
      entry?.returnTime
    );
    dayDateCells.push({ main: mainDate, sub: deliveryReturnSub });

    return [
      mainDate,
      entry ? formatFC(salesFC, currency) : '-',
      `${formatNumber(rate)} %`,
      formatFC(commFC, currency),
    ];
  });

  const totalsRow = [
    'TOTAUX',
    formatFC(sumSalesFC, currency),
    '-',
    formatFC(sumCommissionFC, currency),
  ];

  autoTable(doc, {
    startY: cardBottomY + 4,
    head: [['Date', 'Ventes (FC)', 'Taux (%)', 'Commission (FC)']],
    body: tableRows.length > 0 ? tableRows : [['-', '-', '-', '-']],
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
      cellPadding: 2.2,
      halign: 'center',
      valign: 'middle',
    },
    columnStyles: {
      0: { halign: 'left' },
      1: { halign: 'right', fontStyle: 'bold' },
      2: { halign: 'center' },
      3: { halign: 'right', fontStyle: 'bold' },
    },
    foot: [totalsRow],
    footStyles: {
      fillColor: [241, 245, 249],
      textColor: darkTextColor,
      fontStyle: 'bold',
      fontSize: 8.5,
      halign: 'right',
    },
    didParseCell: (dataHook) => {
      if (
        dataHook.section === 'body' &&
        dataHook.column.index === 0 &&
        tableRows.length > 0 &&
        dayDateCells[dataHook.row.index]?.sub
      ) {
        dataHook.cell.styles.minCellHeight = 8.6;
      }
    },
    willDrawCell: (dataHook) => {
      if (
        dataHook.section === 'body' &&
        dataHook.column.index === 0 &&
        tableRows.length > 0 &&
        dayDateCells[dataHook.row.index]?.sub
      ) {
        dataHook.cell.text = [''];
      }
    },
    didDrawCell: (dataHook) => {
      if (dataHook.section === 'body' && dataHook.column.index === 0 && tableRows.length > 0) {
        const meta = dayDateCells[dataHook.row.index];
        if (meta?.sub) {
          const padLeft = dataHook.cell.padding('left');
          const cellX = dataHook.cell.x + padLeft;
          const centerY = dataHook.cell.y + dataHook.cell.height / 2;

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(...darkTextColor);
          doc.text(meta.main, cellX, centerY - 0.6);

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(6.2);
          doc.setTextColor(...mutedTextColor);
          doc.text(meta.sub, cellX, centerY + 2.5);
        }
      }
    },
    didDrawPage: (dataHook) => {
      if (dataHook.pageNumber > 1) {
        drawPageBackground();
      }
    },
  });

  let finalY = (doc as any).lastAutoTable?.finalY || 160;
  const hasGap = Math.round(payment.amountFC) !== Math.round(sumCommissionFC);
  const hasNote = Boolean(payment.notes?.trim());
  const boxHeight = 36 + (hasGap ? 6 : 0) + (hasNote ? 6 : 0);

  if (finalY + boxHeight > 240) {
    doc.addPage();
    drawPageBackground();
    finalY = 20;
  } else {
    finalY += 8;
  }

  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(14, finalY, 182, boxHeight, 2, 2, 'FD');

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...darkTextColor);
  doc.text('DÉTAIL DU RÈGLEMENT PAR JOURS', 18, finalY + 7);

  let rowY = finalY + 13;
  doc.setFontSize(8.5);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...mutedTextColor);
  doc.text('Total commissions des jours payés :', 18, rowY);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...darkTextColor);
  doc.text(formatFC(sumCommissionFC, currency), 100, rowY);

  rowY += 6;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...mutedTextColor);
  doc.text('Date, heure et mode de paiement :', 18, rowY);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...darkTextColor);
  doc.text(
    `${formatDateWithTime(payment.date, payment.time)} — ${formatPaymentModeLabel(payment.paymentMode)}`,
    100,
    rowY
  );

  if (hasGap) {
    rowY += 6;
    const diffFC = Math.round(sumCommissionFC) - Math.round(payment.amountFC);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...mutedTextColor);
    doc.text('Écart (compté dans le reste dû) :', 18, rowY);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(180, 83, 9);
    doc.text(`${diffFC > 0 ? '+' : ''}${formatFC(diffFC, currency)}`, 100, rowY);
  }

  if (hasNote) {
    rowY += 6;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...mutedTextColor);
    doc.text('Note :', 18, rowY);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...darkTextColor);
    const cleanNote = (payment.notes || '').trim().slice(0, 75);
    doc.text(cleanNote, 100, rowY);
  }

  rowY += 7;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(21, 128, 61);
  doc.text('MONTANT PAYÉ :', 18, rowY);
  doc.text(formatFC(payment.amountFC, currency), 100, rowY);

  drawPayslipFooterAndSignatures(doc, finalY + boxHeight + 2, theme, drawPageBackground);

  const cleanEmpName = employee.name.replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `Fiche_Paiement_${cleanEmpName}_${payment.date}.pdf`;

  return deliverPayslipPDF(doc, filename, action, {
    title: `Fiche de paiement - ${employee.name} (${periodLabel})`,
    text: `Bonjour ${employee.name}, voici ta fiche de paiement (${periodLabel}). Montant payé : ${formatFC(payment.amountFC, currency)} le ${formatDateWithTime(payment.date, payment.time)} (${formatPaymentModeLabel(payment.paymentMode)}).`,
  });
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
  let startHeaderX = 14;
  if (settings.appLogoBase64) {
    try {
      doc.addImage(settings.appLogoBase64, 'PNG', 210 - 14 - 24, 10, 24, 24, undefined, 'FAST');
    } catch (e) {
      console.warn('Erreur logo rapport PDF:', e);
    }
  }

  doc.setFontSize(20);
  doc.setTextColor(...primaryColor);
  doc.setFont('helvetica', 'bold');
  doc.text(settings.businessName, startHeaderX, 18);

  doc.setFontSize(12);
  doc.setTextColor(...darkTextColor);
  doc.setFont('helvetica', 'bold');
  doc.text(`RAPPORT DE GESTION MENSUEL - ${monthName.toUpperCase()}`, startHeaderX, 26);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...mutedTextColor);
  const now = new Date();
  doc.text(
    `Généré le ${formatDateWithTime(toISODate(now), toLocalTimeStr(now))} | 100% Hors ligne`,
    startHeaderX,
    32
  );

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
