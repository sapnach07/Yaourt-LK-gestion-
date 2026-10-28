import { jsPDF } from 'jspdf';
import { formatDate, formatFC, formatNumber, toISODate } from './formatters';
import type {
  AppSettings,
  PersonalSale,
  Product,
  ReceiptPaymentMode,
  ReceiptSettings,
  WholesaleTier,
} from '../types';

export const DEFAULT_RECEIPT_MAIN_COLOR = '#B88714';
export const DEFAULT_RECEIPT_THANK_YOU = 'Merci pour votre confiance';
export const DEFAULT_RECEIPT_FOOTER =
  'Marchandise vendue : ni reprise ni échangée. Produit frais : à conserver entre 2 et 6 °C.';

export const RECEIPT_PAYMENT_MODE_LABELS: Record<ReceiptPaymentMode, string> = {
  especes: 'Espèces',
  mobile_money: 'Mobile money',
  credit: 'À crédit',
};

const TEXT_RGB: [number, number, number] = [36, 26, 15]; // #241A0F
const GRAY_RGB: [number, number, number] = [115, 107, 97]; // #736B61
const LINE_RGB: [number, number, number] = [140, 133, 122]; // #8C857A
const HEADER_FILL_RGB: [number, number, number] = [252, 242, 214]; // #FCF2D6

function ptToMm(pt: number): number {
  return (pt * 25.4) / 72;
}

function formatAmountPlain(amount: number): string {
  if (!Number.isFinite(amount)) return '0';
  return Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function formatDateSpacedSlash(dateStr: string): string {
  const parts = (dateStr || '').split('-');
  if (parts.length === 3) {
    return `${parts[2]} / ${parts[1]} / ${parts[0]}`;
  }
  return formatDate(dateStr);
}

export function hexToRgbTuple(
  hex: string | undefined,
  fallback: [number, number, number] = [184, 135, 20]
): [number, number, number] {
  if (!hex) return fallback;
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return fallback;
    return [r, g, b];
  }
  if (clean.length !== 6) return fallback;
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return fallback;
  return [r, g, b];
}

export function formatReceiptNumber(num: number): string {
  const safe = Math.max(1, Math.floor(num));
  return String(safe).padStart(4, '0');
}

export function resolvePrintedProducts(
  products: Product[],
  printedProductIds?: string[]
): Product[] {
  if (printedProductIds === undefined) {
    return products.filter((p) => p.isActive).slice(0, 2);
  }
  const byId = new Map<string, Product>(products.map((p) => [p.id, p]));
  const result: Product[] = [];
  for (const id of printedProductIds) {
    const found = byId.get(id);
    if (found && result.length < 4) {
      result.push(found);
    }
  }
  return result;
}

/**
 * Calcule le prix unitaire automatique d'un produit selon la quantité et les paliers de gros (wholesaleTiers).
 */
export function resolveWholesaleUnitPrice(
  defaultPrice: number,
  tiers: WholesaleTier[] | undefined,
  qty: number
): { unitPrice: number; isWholesaleApplied: boolean; matchedMinQty?: number } {
  if (!tiers || tiers.length === 0 || !Number.isFinite(qty) || qty <= 0) {
    return { unitPrice: defaultPrice, isWholesaleApplied: false };
  }
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  let matched: WholesaleTier | null = null;
  for (const tier of sorted) {
    if (qty >= tier.minQty && tier.minQty >= 1 && tier.priceFC > 0) {
      matched = tier;
    }
  }
  if (!matched) {
    return { unitPrice: defaultPrice, isWholesaleApplied: false };
  }
  return {
    unitPrice: matched.priceFC,
    isWholesaleApplied: true,
    matchedMinQty: matched.minQty,
  };
}

/**
 * Retourne le prochain numéro de reçu suggéré pour une vente personnelle :
 * 1) Le plus petit numéro déjà imprimé (<= printedUpTo) qui n'a pas encore de reçu et n'est pas annulé ;
 * 2) Sinon le dernier numéro utilisé + 1 (en sautant les éventuels numéros annulés).
 */
export function computeSuggestedSaleReceiptNo(
  personalSales: PersonalSale[],
  r?: ReceiptSettings,
  excludeSaleId?: string
): number {
  const usedSet = new Set<number>();
  for (const s of personalSales) {
    if (s.id === excludeSaleId) continue;
    if (s.receipt && Number.isFinite(s.receipt.no) && s.receipt.no >= 1) {
      usedSet.add(Math.floor(s.receipt.no));
    }
  }

  const voidedSet = new Set<number>(
    (r?.voidedNumbers || []).map((n) => Math.floor(n)).filter((n) => n >= 1)
  );

  const printedUpTo = r?.printedUpTo && r.printedUpTo > 0 ? Math.floor(r.printedUpTo) : 0;
  const startNumber = r?.startNumber && r.startNumber >= 1 ? Math.floor(r.startNumber) : 1;

  if (printedUpTo > 0) {
    const fromN = printedUpTo >= startNumber ? startNumber : 1;
    for (let n = fromN; n <= printedUpTo; n++) {
      if (!usedSet.has(n) && !voidedSet.has(n)) {
        return n;
      }
    }
  }

  const maxUsed = usedSet.size > 0 ? Math.max(...Array.from(usedSet)) : 0;
  let candidate = Math.max(maxUsed, printedUpTo, startNumber - 1) + 1;
  while (usedSet.has(candidate) || voidedSet.has(candidate)) {
    candidate += 1;
  }
  return candidate;
}

/**
 * Retourne la liste des numéros imprimés (<= printedUpTo) qui n'ont pas de reçu enregistré et ne sont pas annulés.
 */
export function computeMissingPrintedReceiptNumbers(
  personalSales: PersonalSale[],
  r?: ReceiptSettings
): number[] {
  const printedUpTo = r?.printedUpTo && r.printedUpTo > 0 ? Math.floor(r.printedUpTo) : 0;
  if (printedUpTo <= 0) return [];

  const startNumber = r?.startNumber && r.startNumber >= 1 ? Math.floor(r.startNumber) : 1;
  const fromN = printedUpTo >= startNumber ? startNumber : 1;

  const usedSet = new Set<number>();
  for (const s of personalSales) {
    if (s.receipt && Number.isFinite(s.receipt.no) && s.receipt.no >= 1) {
      usedSet.add(Math.floor(s.receipt.no));
    }
  }

  const voidedSet = new Set<number>(
    (r?.voidedNumbers || []).map((n) => Math.floor(n)).filter((n) => n >= 1)
  );

  const missing: number[] = [];
  for (let n = fromN; n <= printedUpTo; n++) {
    if (!usedSet.has(n) && !voidedSet.has(n)) {
      missing.push(n);
    }
  }
  return missing;
}

export interface FilledReceiptLine {
  designation: string;
  unitPriceFC?: number;
  qty?: number;
  totalFC: number;
}

export interface FilledReceiptData {
  dateStr: string; // YYYY-MM-DD
  clientName: string;
  phone?: string;
  lines: FilledReceiptLine[];
  paymentMode: ReceiptPaymentMode;
  totalFC: number;
  paidNotedFC: number;
  remainingFC: number;
}

/**
 * Ordonne les lignes d'une vente dans l'ordre des produits imprimés sur le reçu papier (puis les autres produits).
 */
export function orderSaleItemsForReceipt(
  sale: PersonalSale,
  products: Product[],
  printedProductIds?: string[]
): FilledReceiptLine[] {
  if (sale.isOpeningDebt || !sale.items || sale.items.length === 0) {
    return [
      {
        designation: sale.isOpeningDebt ? 'Ancienne dette' : 'Vente',
        totalFC: Math.round(sale.totalSalesFC || 0),
      },
    ];
  }

  const printed = resolvePrintedProducts(products, printedProductIds);
  const printedOrder = new Map<string, number>();
  printed.forEach((p, idx) => printedOrder.set(p.id, idx));

  const sortedItems = [...sale.items]
    .filter((it) => it.soldQty > 0)
    .sort((a, b) => {
      const oa = printedOrder.has(a.productId) ? printedOrder.get(a.productId)! : 999;
      const ob = printedOrder.has(b.productId) ? printedOrder.get(b.productId)! : 999;
      return oa - ob;
    });

  return sortedItems.map((it) => ({
    designation: it.productName,
    unitPriceFC: it.unitPrice,
    qty: it.soldQty,
    totalFC: Math.round(it.soldQty * it.unitPrice),
  }));
}

/**
 * Génère le texte simple d'un reçu (prêt à copier pour WhatsApp).
 */
export function buildReceiptPlainText(
  sale: PersonalSale,
  products: Product[],
  settings: AppSettings
): string {
  const receipt = sale.receipt;
  if (!receipt) return '';
  const currency = settings.currency || 'FC';
  const r = settings.receiptSettings || {};
  const businessTitle = (
    (r.businessName && r.businessName.trim()) ||
    settings.businessName ||
    'Yaourt Gestion'
  ).trim();

  const lines = orderSaleItemsForReceipt(sale, products, r.printedProductIds);
  const totalFC = Math.round(sale.totalSalesFC || 0);
  const paidNotedFC = Math.round(receipt.paidNotedFC || 0);
  const remainingFC = Math.max(0, totalFC - paidNotedFC);
  const modeLabel = RECEIPT_PAYMENT_MODE_LABELS[receipt.paymentMode] || 'Espèces';

  const out: string[] = [];
  out.push(`*${businessTitle.toUpperCase()} — REÇU N° ${formatReceiptNumber(receipt.no)}*`);
  out.push(`Date : ${formatDate(receipt.date)}`);
  out.push(`Client : ${sale.customerName || 'Client'}`);
  if (receipt.phone && receipt.phone.trim()) {
    out.push(`Téléphone : ${receipt.phone.trim()}`);
  }
  out.push('');
  for (const l of lines) {
    if (l.qty !== undefined && l.unitPriceFC !== undefined) {
      out.push(
        `• ${l.designation} : ${formatFC(l.unitPriceFC, currency)} × ${formatNumber(
          l.qty
        )} = ${formatFC(l.totalFC, currency)}`
      );
    } else {
      out.push(`• ${l.designation} : ${formatFC(l.totalFC, currency)}`);
    }
  }
  out.push('');
  out.push(`Mode de paiement : ${modeLabel}`);
  out.push(`TOTAL À PAYER : ${formatFC(totalFC, currency)}`);
  out.push(`PAYÉ : ${formatFC(paidNotedFC, currency)}`);
  out.push(`RESTE À PAYER : ${formatFC(remainingFC, currency)}`);

  return out.join('\n');
}

export function buildReceiptContactsLine(r: ReceiptSettings): string {
  const parts: string[] = [];
  if (r.address && r.address.trim()) {
    parts.push(r.address.trim());
  }
  if (r.phone && r.phone.trim()) {
    const ph = r.phone.trim();
    parts.push(/^whatsapp/i.test(ph) ? ph : `WhatsApp ${ph}`);
  }
  if (r.email && r.email.trim()) {
    parts.push(r.email.trim());
  }
  return parts.join(' · ');
}

export function buildReceiptIdsLine(r: ReceiptSettings): string {
  const parts: string[] = [];
  if (r.idNat && r.idNat.trim()) {
    const v = r.idNat.trim();
    parts.push(/^id\s*nat/i.test(v) ? v : `ID NAT : ${v}`);
  }
  if (r.rccm && r.rccm.trim()) {
    const v = r.rccm.trim();
    parts.push(/^rccm/i.test(v) ? v : `RCCM : ${v}`);
  }
  if (r.taxId && r.taxId.trim()) {
    const v = r.taxId.trim();
    parts.push(/^(n°|num|imp)/i.test(v) ? v : `N° impôt : ${v}`);
  }
  return parts.join(' · ');
}

export function computeNextStartNumber(r?: ReceiptSettings): number {
  const printedUpTo = r?.printedUpTo && r.printedUpTo > 0 ? Math.floor(r.printedUpTo) : 0;
  const startNum = r?.startNumber && r.startNumber >= 1 ? Math.floor(r.startNumber) : 1;
  const voidedSet = new Set<number>(
    (r?.voidedNumbers || []).map((n) => Math.floor(n)).filter((n) => n >= 1)
  );
  let candidate = printedUpTo > 0 ? printedUpTo + 1 : startNum;
  while (voidedSet.has(candidate)) {
    candidate += 1;
  }
  return candidate;
}

export function computeSequentialReceiptNumbers(
  sheetCount: number,
  startNumber: number,
  voidedNumbers?: number[]
): number[] {
  const totalReceipts = Math.max(1, Math.floor(sheetCount)) * 4;
  const voidedSet = new Set<number>(
    (voidedNumbers || []).map((n) => Math.floor(n)).filter((n) => n >= 1)
  );
  const numbers: number[] = [];
  let candidate = Math.max(1, Math.floor(startNumber));
  while (numbers.length < totalReceipts) {
    if (!voidedSet.has(candidate)) {
      numbers.push(candidate);
    }
    candidate += 1;
  }
  return numbers;
}

interface LoadedLogo {
  dataUrl: string;
  width: number;
  height: number;
}

function loadLogoAsPng(src: string): Promise<LoadedLogo | null> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const w = img.naturalWidth || img.width || 512;
          const h = img.naturalHeight || img.height || 512;
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/png');
          resolve({ dataUrl, width: w, height: h });
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    } catch {
      resolve(null);
    }
  });
}

function drawLogoInBox(
  doc: jsPDF,
  logo: LoadedLogo | null,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number
) {
  if (!logo) return;
  const scale = Math.min(boxW / logo.width, boxH / logo.height);
  const drawW = logo.width * scale;
  const drawH = logo.height * scale;
  const drawX = boxX + (boxW - drawW) / 2;
  const drawY = boxY + (boxH - drawH) / 2;
  try {
    doc.addImage(logo.dataUrl, 'PNG', drawX, drawY, drawW, drawH);
  } catch {
    // Ignore image errors to never block PDF generation
  }
}

function fitTextToWidth(doc: jsPDF, text: string, maxWidthMm: number): string {
  if (!text) return '';
  if (doc.getTextWidth(text) <= maxWidthMm) return text;
  const ellipsis = '...';
  let trimmed = text;
  while (trimmed.length > 0 && doc.getTextWidth(trimmed + ellipsis) > maxWidthMm) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed.trimEnd() + ellipsis;
}

/**
 * Fonction unique partagée pour dessiner un reçu (vierge en Partie 1, ou rempli en Partie 2).
 */
function drawReceipt(
  doc: jsPDF,
  rx: number,
  ry: number,
  receiptNumber: number,
  settings: AppSettings,
  printedProducts: Product[],
  logo: LoadedLogo | null,
  filledData?: FilledReceiptData
) {
  const r: ReceiptSettings = settings.receiptSettings || {};
  const goldHex = r.mainColor || DEFAULT_RECEIPT_MAIN_COLOR;
  const goldRgb = hexToRgbTuple(goldHex);
  const formattedNo = formatReceiptNumber(receiptNumber);

  const effectiveBusinessName = (
    (r.businessName && r.businessName.trim()) ||
    settings.businessName ||
    'Yaourt Gestion'
  ).toUpperCase();

  const tagline = (r.tagline || '').trim();
  const contactsLine = buildReceiptContactsLine(r);
  const idsLine = buildReceiptIdsLine(r);
  const thankYouMessage =
    r.thankYouMessage !== undefined ? r.thankYouMessage : DEFAULT_RECEIPT_THANK_YOU;
  const footerMention =
    r.footerMention !== undefined ? r.footerMention : DEFAULT_RECEIPT_FOOTER;

  // --- CADRE DU REÇU : rectangle arrondi (rayon 3) de 200 × 70, contour or de 0,8 pt ---
  doc.setLineDashPattern([], 0);
  doc.setDrawColor(...goldRgb);
  doc.setLineWidth(ptToMm(0.8));
  doc.roundedRect(rx, ry, 200, 70, 3, 3, 'S');

  // Trait vertical pointillé (2/2, gris) à x = 50, de y = 1 à y = 69
  doc.setDrawColor(...GRAY_RGB);
  doc.setLineWidth(ptToMm(0.5));
  doc.setLineDashPattern([2, 2], 0);
  doc.line(rx + 50, ry + 1, rx + 50, ry + 69);
  doc.setLineDashPattern([], 0);

  // --- SOUCHE (x de 0 à 50) ---
  // Logo 13 × 13 à (4, 2)
  drawLogoInBox(doc, logo, rx + 4, ry + 2, 13, 13);

  // "SOUCHE" gras 8 pt or à (20, 8)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...goldRgb);
  doc.text('SOUCHE', rx + 20, ry + 8);

  // "à conserver" italique 5,8 pt gris à (20, 12)
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(5.8);
  doc.setTextColor(...GRAY_RGB);
  doc.text('à conserver', rx + 20, ry + 12);

  // Pilule dorée arrondie (rayon 1,5) à (4, 17,5) de 42 × 6 avec "N° 0001" gras 9,5 pt blanc centré
  doc.setFillColor(...goldRgb);
  doc.roundedRect(rx + 4, ry + 17.5, 42, 6, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(255, 255, 255);
  doc.text(`N° ${formattedNo}`, rx + 25, ry + 17.5 + 4.15, { align: 'center' });

  // Champs Date, Client, Total, Payé, Reste demi-gras 6,8 pt à x = 4, y = 30 ; 37,6 ; 45,2 ; 52,8 ; 60,4
  const stubFields: Array<{
    key: 'date' | 'client' | 'total' | 'paid' | 'rest';
    label: string;
    y: number;
    hasFC: boolean;
  }> = [
    { key: 'date', label: 'Date :', y: 30, hasFC: false },
    { key: 'client', label: 'Client :', y: 37.6, hasFC: false },
    { key: 'total', label: 'Total :', y: 45.2, hasFC: true },
    { key: 'paid', label: 'Payé :', y: 52.8, hasFC: true },
    { key: 'rest', label: 'Reste :', y: 60.4, hasFC: true },
  ];

  for (const sf of stubFields) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(...TEXT_RGB);
    doc.text(sf.label, rx + 4, ry + sf.y);
    const labelW = doc.getTextWidth(sf.label);

    let fcW = 0;
    if (sf.hasFC) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.8);
      doc.setTextColor(...GRAY_RGB);
      fcW = doc.getTextWidth('FC');
      doc.text('FC', rx + 46, ry + sf.y, { align: 'right' });
    }

    doc.setDrawColor(...LINE_RGB);
    doc.setLineWidth(ptToMm(0.4));
    doc.line(rx + 4 + labelW + 1, ry + sf.y + 0.65, rx + 46, ry + sf.y + 0.65);

    if (filledData) {
      const startValX = rx + 4 + labelW + 1.4;
      if (sf.key === 'date') {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.5);
        doc.setTextColor(...TEXT_RGB);
        doc.text(
          fitTextToWidth(doc, formatDate(filledData.dateStr), rx + 45.5 - startValX),
          startValX,
          ry + sf.y
        );
      } else if (sf.key === 'client') {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.5);
        doc.setTextColor(...TEXT_RGB);
        doc.text(
          fitTextToWidth(doc, filledData.clientName, rx + 45.5 - startValX),
          startValX,
          ry + sf.y
        );
      } else {
        const valNum =
          sf.key === 'total'
            ? filledData.totalFC
            : sf.key === 'paid'
            ? filledData.paidNotedFC
            : filledData.remainingFC;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.6);
        doc.setTextColor(...TEXT_RGB);
        const endValX = rx + 46 - fcW - 1.1;
        doc.text(
          fitTextToWidth(doc, formatAmountPlain(valNum), Math.max(8, endValX - startValX)),
          endValX,
          ry + sf.y,
          { align: 'right' }
        );
      }
    }
  }

  // --- REÇU (x de 50 à 200) ---
  // Logo 15 × 15 à (54, 2)
  drawLogoInBox(doc, logo, rx + 54, ry + 2, 15, 15);

  // Nom du business en MAJUSCULES, gras 10 pt, à (71, 6,8)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...TEXT_RGB);
  doc.text(fitTextToWidth(doc, effectiveBusinessName, 83), rx + 71, ry + 6.8);

  // Accroche italique 5,8 pt or à (71, 10,3)
  if (tagline) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(5.8);
    doc.setTextColor(...goldRgb);
    doc.text(fitTextToWidth(doc, tagline, 83), rx + 71, ry + 10.3);
  }

  // Ligne "adresse · WhatsApp téléphone · e-mail" 5,8 pt gris à (71, 13,6)
  if (contactsLine) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.8);
    doc.setTextColor(...GRAY_RGB);
    doc.text(fitTextToWidth(doc, contactsLine, 87), rx + 71, ry + 13.6);
  }

  // Ligne "ID NAT · RCCM · N° impôt" 5,3 pt gris à (71, 16,6)
  if (idsLine) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.3);
    doc.setTextColor(...GRAY_RGB);
    doc.text(fitTextToWidth(doc, idsLine, 123), rx + 71, ry + 16.6);
  }

  // Pilule dorée arrondie (rayon 1,8) à (156, 2,5) de 40 × 8 avec "REÇU N° 0001" gras 9 pt blanc centré
  doc.setFillColor(...goldRgb);
  doc.roundedRect(rx + 156, ry + 2.5, 40, 8, 1.8, 1.8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text(`REÇU N° ${formattedNo}`, rx + 176, ry + 2.5 + 5.1, { align: 'center' });

  // Sous la pilule, aligné à droite en x = 196, y = 14,3 : "Date : ___ / ___ / 20___" (6,5 pt)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...TEXT_RGB);
  doc.text(
    filledData
      ? `Date : ${formatDateSpacedSlash(filledData.dateStr)}`
      : 'Date : ___ / ___ / 20___',
    rx + 196,
    ry + 14.3,
    { align: 'right' }
  );

  // "Client :" à (54, 23,2) 7 pt avec trait de x = 65 à 128 à y = 23,9 ; "Tél :" à (131, 23,2) avec trait de x = 138 à 196
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...TEXT_RGB);
  doc.text('Client :', rx + 54, ry + 23.2);
  doc.text('Tél :', rx + 131, ry + 23.2);

  doc.setDrawColor(...LINE_RGB);
  doc.setLineWidth(ptToMm(0.4));
  doc.line(rx + 65, ry + 23.9, rx + 128, ry + 23.9);
  doc.line(rx + 138, ry + 23.9, rx + 196, ry + 23.9);

  if (filledData) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...TEXT_RGB);
    if (filledData.clientName) {
      doc.text(fitTextToWidth(doc, filledData.clientName, 61), rx + 66, ry + 23.2);
    }
    if (filledData.phone && filledData.phone.trim()) {
      doc.text(fitTextToWidth(doc, filledData.phone.trim(), 56), rx + 139, ry + 23.2);
    }
  }

  // --- TABLEAU : x de 54 à 196 (largeur 142), haut à y = 26,5 ---
  const tableX = rx + 54;
  const tableY = ry + 26.5;
  const tableW = 142;
  const headerH = 5;
  const rowH = 5.2;
  const totalTableH = headerH + 4 * rowH; // 25.8 -> bas à y = 52.3

  // Fond d'en-tête #FCF2D6
  doc.setFillColor(...HEADER_FILL_RGB);
  doc.rect(tableX, tableY, tableW, headerH, 'F');

  // Cadre extérieur et lignes du tableau
  doc.setDrawColor(...LINE_RGB);
  doc.setLineWidth(ptToMm(0.4));
  doc.rect(tableX, tableY, tableW, totalTableH, 'S');

  // Lignes horizontales internes
  for (let i = 0; i < 4; i++) {
    const lineY = tableY + headerH + i * rowH;
    doc.line(rx + 54, lineY, rx + 196, lineY);
  }

  // Traits verticaux sur toute la hauteur : colonnes x = 54, 96, 130, 164, 196
  doc.line(rx + 96, tableY, rx + 96, tableY + totalTableH);
  doc.line(rx + 130, tableY, rx + 130, tableY + totalTableH);
  doc.line(rx + 164, tableY, rx + 164, tableY + totalTableH);

  // Textes d'en-tête gras 6,6 pt
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.6);
  doc.setTextColor(...TEXT_RGB);
  const headerTextY = tableY + 3.4;
  doc.text('Désignation', rx + 56, headerTextY);
  doc.text('Prix unitaire', rx + 113, headerTextY, { align: 'center' });
  doc.text('Quantité prise', rx + 147, headerTextY, { align: 'center' });
  doc.text('Total', rx + 180, headerTextY, { align: 'center' });

  // Préparer jusqu'à 4 lignes si filledData est fourni (regroupe le surplus éventuel sur la 4e ligne)
  let displayFilledLines: FilledReceiptLine[] = [];
  if (filledData) {
    if (filledData.lines.length <= 4) {
      displayFilledLines = filledData.lines;
    } else {
      const firstThree = filledData.lines.slice(0, 3);
      const rest = filledData.lines.slice(3);
      const restTotal = rest.reduce((acc, l) => acc + l.totalFC, 0);
      const restQty = rest.reduce((acc, l) => acc + (l.qty || 0), 0);
      displayFilledLines = [
        ...firstThree,
        {
          designation: `Autres (${rest.length})`,
          qty: restQty > 0 ? restQty : undefined,
          totalFC: restTotal,
        },
      ];
    }
  }

  // Lignes 1 à 4
  for (let i = 0; i < 4; i++) {
    const rowTop = tableY + headerH + i * rowH;
    const rowBaseline = rowTop + 3.9;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.6);
    doc.setTextColor(...GRAY_RGB);
    const fcColW = doc.getTextWidth('FC');
    doc.text('FC', rx + 128.5, rowBaseline, { align: 'right' });
    doc.text('FC', rx + 194.5, rowBaseline, { align: 'right' });

    if (filledData) {
      const fl = displayFilledLines[i];
      if (fl) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_RGB);
        doc.text(fitTextToWidth(doc, fl.designation, 38.5), rx + 56, rowBaseline);

        if (fl.unitPriceFC !== undefined) {
          doc.text(
            fitTextToWidth(doc, formatAmountPlain(fl.unitPriceFC), 26),
            rx + 128.5 - fcColW - 1.2,
            rowBaseline,
            { align: 'right' }
          );
        }
        if (fl.qty !== undefined) {
          doc.text(fitTextToWidth(doc, formatNumber(fl.qty), 30), rx + 147, rowBaseline, {
            align: 'center',
          });
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.text(
          fitTextToWidth(doc, formatAmountPlain(fl.totalFC), 24),
          rx + 194.5 - fcColW - 1.2,
          rowBaseline,
          { align: 'right' }
        );
      }
    } else {
      const prod = printedProducts[i];
      if (prod) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...TEXT_RGB);
        doc.text(fitTextToWidth(doc, prod.name, 38.5), rx + 56, rowBaseline);
      }
    }
  }

  // --- SOUS LE TABLEAU (by = 26,5 + 5 + 4 × 5,2 = 52,3) ---
  const by = 52.3;

  // "Paiement :" gras 6,4 pt à (54, by + 4,2)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.4);
  doc.setTextColor(...TEXT_RGB);
  doc.text('Paiement :', rx + 54, ry + by + 4.2);

  // Trois cases carrées de 2,6 × 2,6 à x = 70, 89 et 111, y = by + 1,9, libellés 6 pt à +3,6 à droite
  const paymentBoxes: Array<{ mode: ReceiptPaymentMode; x: number; label: string }> = [
    { mode: 'especes', x: 70, label: 'Espèces' },
    { mode: 'mobile_money', x: 89, label: 'Mobile money' },
    { mode: 'credit', x: 111, label: 'À crédit' },
  ];

  for (const pb of paymentBoxes) {
    const bx = rx + pb.x;
    const byBox = ry + by + 1.9;
    doc.setDrawColor(...LINE_RGB);
    doc.setLineWidth(ptToMm(0.4));
    doc.rect(bx, byBox, 2.6, 2.6, 'S');

    if (filledData && filledData.paymentMode === pb.mode) {
      doc.setDrawColor(...TEXT_RGB);
      doc.setLineWidth(ptToMm(1.0));
      doc.line(bx + 0.45, byBox + 1.35, bx + 1.05, byBox + 2.05);
      doc.line(bx + 1.05, byBox + 2.05, bx + 2.15, byBox + 0.45);
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(...TEXT_RGB);
    doc.text(pb.label, bx + 3.6, ry + by + 4.05);
  }

  // thankYouMessage en gras italique 6,6 pt or à (54, by + 8,2)
  if (thankYouMessage.trim()) {
    doc.setFont('helvetica', 'bolditalic');
    doc.setFontSize(6.6);
    doc.setTextColor(...goldRgb);
    doc.text(fitTextToWidth(doc, thankYouMessage.trim(), 83), rx + 54, ry + by + 8.2);
  }

  // Deux traits de signature : x = 54 à 92 et x = 98 à 134 à y = by + 12
  doc.setDrawColor(...LINE_RGB);
  doc.setLineWidth(ptToMm(0.4));
  doc.line(rx + 54, ry + by + 12, rx + 92, ry + by + 12);
  doc.line(rx + 98, ry + by + 12, rx + 134, ry + by + 12);

  // "Signature du client" et "Signature du vendeur" en 5,2 pt gris à y = by + 14,3
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.2);
  doc.setTextColor(...GRAY_RGB);
  doc.text('Signature du client', rx + 73, ry + by + 14.3, { align: 'center' });
  doc.text('Signature du vendeur', rx + 116, ry + by + 14.3, { align: 'center' });

  // --- TOTAUX : trois boîtes de 56 × 4,5 à x = 140, aux y = by + 0,6 ; by + 5,1 ; by + 9,6 ---
  const totalBoxes: Array<{
    key: 'total' | 'paid' | 'rest';
    label: string;
    offsetY: number;
    filled: boolean;
  }> = [
    { key: 'total', label: 'TOTAL À PAYER', offsetY: 0.6, filled: true },
    { key: 'paid', label: 'PAYÉ', offsetY: 5.1, filled: false },
    { key: 'rest', label: 'RESTE À PAYER', offsetY: 9.6, filled: false },
  ];

  for (const tb of totalBoxes) {
    const boxY = ry + by + tb.offsetY;
    const valAmount = filledData
      ? tb.key === 'total'
        ? filledData.totalFC
        : tb.key === 'paid'
        ? filledData.paidNotedFC
        : filledData.remainingFC
      : null;

    if (tb.filled) {
      doc.setFillColor(...goldRgb);
      doc.rect(rx + 140, boxY, 56, 4.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.4);
      doc.setTextColor(255, 255, 255);
      doc.text(tb.label, rx + 142, boxY + 3.1);
      doc.setFontSize(6.0);
      const fcW = doc.getTextWidth('FC');
      doc.text('FC', rx + 194, boxY + 3.1, { align: 'right' });

      if (valAmount !== null) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.8);
        doc.setTextColor(255, 255, 255);
        doc.text(
          fitTextToWidth(doc, formatAmountPlain(valAmount), 24),
          rx + 194 - fcW - 1.2,
          boxY + 3.1,
          { align: 'right' }
        );
      }
    } else {
      doc.setDrawColor(...LINE_RGB);
      doc.setLineWidth(ptToMm(0.4));
      doc.rect(rx + 140, boxY, 56, 4.5, 'S');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.4);
      doc.setTextColor(...TEXT_RGB);
      doc.text(tb.label, rx + 142, boxY + 3.1);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.8);
      doc.setTextColor(...GRAY_RGB);
      const fcW = doc.getTextWidth('FC');
      doc.text('FC', rx + 194, boxY + 3.1, { align: 'right' });

      if (valAmount !== null) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.8);
        doc.setTextColor(...TEXT_RGB);
        doc.text(
          fitTextToWidth(doc, formatAmountPlain(valAmount), 24),
          rx + 194 - fcW - 1.2,
          boxY + 3.1,
          { align: 'right' }
        );
      }
    }
  }

  // --- PIED DE PAGE : footerMention en 4,8 pt gris à (54, 69) ---
  if (footerMention.trim()) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(4.8);
    doc.setTextColor(...GRAY_RGB);
    doc.text(fitTextToWidth(doc, footerMention.trim(), 142), rx + 54, ry + 69);
  }
}

export interface GenerateBlankReceiptsParams {
  settings: AppSettings;
  products: Product[];
  sheetCount: number;
  startNumber: number;
  action?: 'download' | 'share';
}

export async function generateBlankReceiptsPDF({
  settings,
  products,
  sheetCount,
  startNumber,
  action = 'download',
}: GenerateBlankReceiptsParams): Promise<{
  firstNumber: number;
  lastNumber: number;
  numbers: number[];
}> {
  const safeSheets = Math.max(1, Math.floor(sheetCount));
  const r = settings.receiptSettings || {};
  const numbers = computeSequentialReceiptNumbers(safeSheets, startNumber, r.voidedNumbers);
  const firstNumber = numbers[0];
  const lastNumber = numbers[numbers.length - 1];

  const logoSrc = settings.appLogoBase64 || '/pwa-512x512.png';
  const logo = await loadLogoAsPng(logoSrc);
  const printedProducts = resolvePrintedProducts(products, r.printedProductIds);

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const ryPositions = [8.5, 78.5, 148.5, 218.5];
  const cutYPositions = [78.5, 148.5, 218.5];

  for (let pageIdx = 0; pageIdx < safeSheets; pageIdx++) {
    if (pageIdx > 0) {
      doc.addPage('a4', 'portrait');
    }

    for (let slot = 0; slot < 4; slot++) {
      const num = numbers[pageIdx * 4 + slot];
      drawReceipt(doc, 5, ryPositions[slot], num, settings, printedProducts, logo);
    }

    // Traits de découpe en pointillés (3/3) de x = 2 à x = 208 aux y = 78,5 ; 148,5 et 218,5
    doc.setDrawColor(...LINE_RGB);
    doc.setLineWidth(ptToMm(0.5));
    doc.setLineDashPattern([3, 3], 0);
    for (const cy of cutYPositions) {
      doc.line(2, cy, 208, cy);
    }
    doc.setLineDashPattern([], 0);
  }

  const filename = `Recus_Vierges_${formatReceiptNumber(firstNumber)}_a_${formatReceiptNumber(
    lastNumber
  )}.pdf`;

  if (action === 'share' && typeof navigator !== 'undefined' && navigator.share) {
    try {
      const pdfBlob = doc.output('blob');
      const file = new File([pdfBlob], filename, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Feuilles de reçus (${formatReceiptNumber(firstNumber)} à ${formatReceiptNumber(
            lastNumber
          )})`,
        });
        return { firstNumber, lastNumber, numbers };
      }
    } catch {
      // Fallback to direct download below
    }
  }

  doc.save(filename);
  return { firstNumber, lastNumber, numbers };
}

export interface GenerateFilledReceiptParams {
  sale: PersonalSale;
  settings: AppSettings;
  products: Product[];
  action?: 'download' | 'share';
}

/**
 * Génère un PDF A4 avec UN SEUL reçu rempli, en haut de la page (rx = 5, ry = 8,5),
 * réutilisant drawReceipt (souche remplie comprise) et ajoutant sous le cadre :
 * "Duplicata — imprimé le jj/mm/aaaa".
 */
export async function generateFilledReceiptPDF({
  sale,
  settings,
  products,
  action = 'download',
}: GenerateFilledReceiptParams): Promise<boolean> {
  const receipt = sale.receipt;
  if (!receipt) return false;

  const r = settings.receiptSettings || {};
  const logoSrc = settings.appLogoBase64 || '/pwa-512x512.png';
  const logo = await loadLogoAsPng(logoSrc);
  const printedProducts = resolvePrintedProducts(products, r.printedProductIds);

  const totalFC = Math.round(sale.totalSalesFC || 0);
  const paidNotedFC = Math.round(receipt.paidNotedFC || 0);
  const remainingFC = Math.max(0, totalFC - paidNotedFC);
  const lines = orderSaleItemsForReceipt(sale, products, r.printedProductIds);

  const filledData: FilledReceiptData = {
    dateStr: receipt.date || sale.date,
    clientName: sale.customerName || 'Client',
    phone: receipt.phone,
    lines,
    paymentMode: receipt.paymentMode,
    totalFC,
    paidNotedFC,
    remainingFC,
  };

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  drawReceipt(doc, 5, 8.5, receipt.no, settings, printedProducts, logo, filledData);

  // Mention en petit sous le cadre (8,5 + 70 = 78,5 mm)
  const printedDateStr = formatDate(toISODate(new Date()));
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(5.8);
  doc.setTextColor(...GRAY_RGB);
  doc.text(`Duplicata — imprimé le ${printedDateStr}`, 205, 82.2, { align: 'right' });

  const formattedNo = formatReceiptNumber(receipt.no);
  const cleanClient = (sale.customerName || 'Client').replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `Recu_${formattedNo}_${cleanClient}.pdf`;

  if (action === 'share' && typeof navigator !== 'undefined' && navigator.share) {
    try {
      const pdfBlob = doc.output('blob');
      const file = new File([pdfBlob], filename, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Reçu N° ${formattedNo} — ${sale.customerName || 'Client'}`,
          text: buildReceiptPlainText(sale, products, settings),
        });
        return true;
      }
      // Si le partage de fichier PDF n'est pas supporté sur l'appareil, partager le texte puis télécharger le PDF
      await navigator.share({
        title: `Reçu N° ${formattedNo} — ${sale.customerName || 'Client'}`,
        text: buildReceiptPlainText(sale, products, settings),
      });
      doc.save(filename);
      return true;
    } catch {
      // Si l'utilisateur annule la feuille de partage native, ne pas forcer un téléchargement inattendu
      return false;
    }
  }

  doc.save(filename);
  return true;
}
