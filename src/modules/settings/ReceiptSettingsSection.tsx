import React, { useState, useEffect } from 'react';
import {
  FileText,
  Palette,
  Printer,
  RotateCcw,
  Trash2,
  Plus,
  Check,
  X,
  ArrowUp,
  ArrowDown,
  Share2,
} from 'lucide-react';
import { db } from '../../db/db';
import { formatFC, formatNumber, parseLocaleNumber } from '../../utils/formatters';
import {
  DEFAULT_RECEIPT_MAIN_COLOR,
  DEFAULT_RECEIPT_THANK_YOU,
  DEFAULT_RECEIPT_FOOTER,
  formatReceiptNumber,
  resolvePrintedProducts,
  buildReceiptContactsLine,
  buildReceiptIdsLine,
  computeNextStartNumber,
  computeSequentialReceiptNumbers,
  generateBlankReceiptsPDF,
} from '../../utils/receiptPdfGenerator';
import type { AppSettings, Product, ReceiptSettings, WholesaleTier } from '../../types';

interface ReceiptSettingsSectionProps {
  settings: AppSettings;
  products: Product[];
  onSettingsUpdated: (newSettings: AppSettings) => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
}

const RECEIPT_PRESET_COLORS = [
  { name: 'Or (Défaut)', hex: '#B88714' },
  { name: 'Teal', hex: '#0d9488' },
  { name: 'Émeraude', hex: '#059669' },
  { name: 'Ambre', hex: '#d97706' },
  { name: 'Bleu', hex: '#2563eb' },
  { name: 'Bordeaux', hex: '#9f1239' },
  { name: 'Brun', hex: '#78350f' },
  { name: 'Ardoise', hex: '#334155' },
];

function clampPreviewText(str: string, maxChars: number): string {
  if (!str) return '';
  if (str.length <= maxChars) return str;
  return str.slice(0, Math.max(1, maxChars - 3)).trimEnd() + '...';
}

export const ReceiptSettingsSection: React.FC<ReceiptSettingsSectionProps> = ({
  settings,
  products,
  onSettingsUpdated,
  onShowToast,
}) => {
  const r = settings.receiptSettings || {};
  const currency = settings.currency || 'FC';

  // Form states for receiptSettings
  const [businessName, setBusinessName] = useState<string>(r.businessName || '');
  const [tagline, setTagline] = useState<string>(r.tagline || '');
  const [address, setAddress] = useState<string>(r.address || '');
  const [phone, setPhone] = useState<string>(r.phone || '');
  const [email, setEmail] = useState<string>(r.email || '');
  const [idNat, setIdNat] = useState<string>(r.idNat || '');
  const [rccm, setRccm] = useState<string>(r.rccm || '');
  const [taxId, setTaxId] = useState<string>(r.taxId || '');
  const [mainColor, setMainColor] = useState<string>(r.mainColor || DEFAULT_RECEIPT_MAIN_COLOR);
  const [thankYouMessage, setThankYouMessage] = useState<string>(
    r.thankYouMessage !== undefined ? r.thankYouMessage : DEFAULT_RECEIPT_THANK_YOU
  );
  const [footerMention, setFooterMention] = useState<string>(
    r.footerMention !== undefined ? r.footerMention : DEFAULT_RECEIPT_FOOTER
  );
  // undefined = use default (first 2 active products)
  const [printedProductIds, setPrintedProductIds] = useState<string[] | undefined>(
    r.printedProductIds
  );
  const [startNumberInput, setStartNumberInput] = useState<string>(
    String(r.startNumber !== undefined && r.startNumber >= 1 ? r.startNumber : 1)
  );
  const [printedUpTo, setPrintedUpTo] = useState<number>(r.printedUpTo ?? 0);
  const [voidedNumbers, setVoidedNumbers] = useState<number[]>(r.voidedNumbers || []);
  const [newVoidNumberInput, setNewVoidNumberInput] = useState<string>('');

  // Wholesale tiers state
  const [wholesaleTiers, setWholesaleTiers] = useState<Record<string, WholesaleTier[]>>(
    settings.wholesaleTiers || {}
  );
  const [tierDraftQty, setTierDraftQty] = useState<Record<string, string>>({});
  const [tierDraftPrice, setTierDraftPrice] = useState<Record<string, string>>({});

  // Saving state
  const [isSaving, setIsSaving] = useState(false);

  // Print modal state
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [sheetCountInput, setSheetCountInput] = useState<string>('1');
  const [printStartNumberInput, setPrintStartNumberInput] = useState<string>('1');
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [pendingConfirmRange, setPendingConfirmRange] = useState<{
    firstNumber: number;
    lastNumber: number;
    totalReceipts: number;
  } | null>(null);

  // Keep local state synced when settings are restored from backup
  useEffect(() => {
    const nextR = settings.receiptSettings || {};
    setBusinessName(nextR.businessName || '');
    setTagline(nextR.tagline || '');
    setAddress(nextR.address || '');
    setPhone(nextR.phone || '');
    setEmail(nextR.email || '');
    setIdNat(nextR.idNat || '');
    setRccm(nextR.rccm || '');
    setTaxId(nextR.taxId || '');
    setMainColor(nextR.mainColor || DEFAULT_RECEIPT_MAIN_COLOR);
    setThankYouMessage(
      nextR.thankYouMessage !== undefined ? nextR.thankYouMessage : DEFAULT_RECEIPT_THANK_YOU
    );
    setFooterMention(
      nextR.footerMention !== undefined ? nextR.footerMention : DEFAULT_RECEIPT_FOOTER
    );
    setPrintedProductIds(nextR.printedProductIds);
    setStartNumberInput(
      String(nextR.startNumber !== undefined && nextR.startNumber >= 1 ? nextR.startNumber : 1)
    );
    setPrintedUpTo(nextR.printedUpTo ?? 0);
    setVoidedNumbers(nextR.voidedNumbers || []);
    setWholesaleTiers(settings.wholesaleTiers || {});
  }, [settings.receiptSettings, settings.wholesaleTiers]);

  // Effective list of selected product IDs (max 4; defaults to first 2 active products)
  const effectivePrintedProducts = resolvePrintedProducts(products, printedProductIds);
  const effectivePrintedIds = effectivePrintedProducts.map((p) => p.id);

  const parsedStartNumber = Math.max(1, Math.floor(Number(startNumberInput) || 1));

  const buildCurrentReceiptSettings = (
    overridePrintedUpTo?: number,
    overrideVoided?: number[]
  ): ReceiptSettings => ({
    businessName: businessName.trim() || undefined,
    tagline: tagline.trim() || undefined,
    address: address.trim() || undefined,
    phone: phone.trim() || undefined,
    email: email.trim() || undefined,
    idNat: idNat.trim() || undefined,
    rccm: rccm.trim() || undefined,
    taxId: taxId.trim() || undefined,
    mainColor: mainColor || DEFAULT_RECEIPT_MAIN_COLOR,
    thankYouMessage,
    footerMention,
    printedProductIds,
    startNumber: parsedStartNumber,
    printedUpTo: overridePrintedUpTo !== undefined ? overridePrintedUpTo : printedUpTo,
    voidedNumbers:
      (overrideVoided !== undefined ? overrideVoided : voidedNumbers).length > 0
        ? [...(overrideVoided !== undefined ? overrideVoided : voidedNumbers)].sort((a, b) => a - b)
        : undefined,
  });

  const cleanWholesaleTiers = (
    raw: Record<string, WholesaleTier[]>
  ): Record<string, WholesaleTier[]> | undefined => {
    const cleaned: Record<string, WholesaleTier[]> = {};
    for (const [prodId, list] of Object.entries(raw)) {
      if (Array.isArray(list) && list.length > 0) {
        cleaned[prodId] = [...list].sort((a, b) => a.minQty - b.minQty);
      }
    }
    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updatedSettings: AppSettings = {
        ...settings,
        receiptSettings: buildCurrentReceiptSettings(),
        wholesaleTiers: cleanWholesaleTiers(wholesaleTiers),
      };
      await db.settings.put(updatedSettings);
      onSettingsUpdated(updatedSettings);
      onShowToast('success', 'Réglages des reçus et prix de gros enregistrés.');
    } catch (err: any) {
      onShowToast('error', 'Erreur enregistrement : ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetToDefault = async () => {
    setBusinessName('');
    setTagline('');
    setAddress('');
    setPhone('');
    setEmail('');
    setIdNat('');
    setRccm('');
    setTaxId('');
    setMainColor(DEFAULT_RECEIPT_MAIN_COLOR);
    setThankYouMessage(DEFAULT_RECEIPT_THANK_YOU);
    setFooterMention(DEFAULT_RECEIPT_FOOTER);
    setPrintedProductIds(undefined);
    setStartNumberInput('1');

    // Conserver printedUpTo et voidedNumbers pour ne jamais réimprimer un numéro déjà utilisé
    const preservedSettings: ReceiptSettings | undefined =
      printedUpTo > 0 || voidedNumbers.length > 0
        ? {
            printedUpTo,
            voidedNumbers: voidedNumbers.length > 0 ? voidedNumbers : undefined,
          }
        : undefined;

    const updatedSettings: AppSettings = {
      ...settings,
      receiptSettings: preservedSettings,
      wholesaleTiers: cleanWholesaleTiers(wholesaleTiers),
    };
    await db.settings.put(updatedSettings);
    onSettingsUpdated(updatedSettings);
    onShowToast('info', 'Mise en forme des reçus rétablie par défaut.');
  };

  // Toggle product in printedProductIds (up to 4)
  const handleTogglePrintedProduct = (productId: string) => {
    const currentIds = [...effectivePrintedIds];
    const idx = currentIds.indexOf(productId);
    if (idx >= 0) {
      currentIds.splice(idx, 1);
      setPrintedProductIds(currentIds);
    } else {
      if (currentIds.length >= 4) {
        onShowToast('info', 'Vous pouvez sélectionner au maximum 4 produits sur le reçu.');
        return;
      }
      currentIds.push(productId);
      setPrintedProductIds(currentIds);
    }
  };

  const handleMovePrintedProduct = (productId: string, direction: -1 | 1) => {
    const currentIds = [...effectivePrintedIds];
    const idx = currentIds.indexOf(productId);
    if (idx < 0) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= currentIds.length) return;
    const temp = currentIds[idx];
    currentIds[idx] = currentIds[targetIdx];
    currentIds[targetIdx] = temp;
    setPrintedProductIds(currentIds);
  };

  // Voided numbers management
  const handleAddVoidNumber = () => {
    const num = Math.floor(Number(newVoidNumberInput));
    if (!Number.isFinite(num) || num < 1) {
      onShowToast('error', 'Veuillez entrer un numéro de reçu valide (>= 1).');
      return;
    }
    if (voidedNumbers.includes(num)) {
      onShowToast('info', `Le reçu N° ${formatReceiptNumber(num)} est déjà marqué annulé.`);
      return;
    }
    const next = [...voidedNumbers, num].sort((a, b) => a - b);
    setVoidedNumbers(next);
    setNewVoidNumberInput('');
  };

  const handleRemoveVoidNumber = (num: number) => {
    setVoidedNumbers(voidedNumbers.filter((n) => n !== num));
  };

  // Wholesale tier add / delete (persists immediately as well)
  const handleAddWholesaleTier = async (productId: string) => {
    const rawQty = tierDraftQty[productId] || '';
    const rawPrice = tierDraftPrice[productId] || '';
    const minQty = Math.floor(parseLocaleNumber(rawQty));
    const priceFC = Math.round(parseLocaleNumber(rawPrice));

    if (!Number.isFinite(minQty) || minQty < 1) {
      onShowToast('error', 'Veuillez saisir une quantité minimale valide (entier >= 1).');
      return;
    }
    if (!Number.isFinite(priceFC) || priceFC <= 0) {
      onShowToast('error', 'Veuillez saisir un prix unitaire valide (> 0).');
      return;
    }

    const existingList = wholesaleTiers[productId] || [];
    const filtered = existingList.filter((t) => t.minQty !== minQty);
    const updatedList = [...filtered, { minQty, priceFC }].sort((a, b) => a.minQty - b.minQty);

    const nextWholesale = {
      ...wholesaleTiers,
      [productId]: updatedList,
    };
    setWholesaleTiers(nextWholesale);
    setTierDraftQty((prev) => ({ ...prev, [productId]: '' }));
    setTierDraftPrice((prev) => ({ ...prev, [productId]: '' }));

    const updatedSettings: AppSettings = {
      ...settings,
      receiptSettings: buildCurrentReceiptSettings(),
      wholesaleTiers: cleanWholesaleTiers(nextWholesale),
    };
    await db.settings.put(updatedSettings);
    onSettingsUpdated(updatedSettings);
  };

  const handleDeleteWholesaleTier = async (productId: string, minQty: number) => {
    const existingList = wholesaleTiers[productId] || [];
    const updatedList = existingList.filter((t) => t.minQty !== minQty);
    const nextWholesale = { ...wholesaleTiers };
    if (updatedList.length > 0) {
      nextWholesale[productId] = updatedList;
    } else {
      delete nextWholesale[productId];
    }
    setWholesaleTiers(nextWholesale);

    const updatedSettings: AppSettings = {
      ...settings,
      receiptSettings: buildCurrentReceiptSettings(),
      wholesaleTiers: cleanWholesaleTiers(nextWholesale),
    };
    await db.settings.put(updatedSettings);
    onSettingsUpdated(updatedSettings);
  };

  // Open Print Modal
  const handleOpenPrintModal = () => {
    const draftR = buildCurrentReceiptSettings();
    const suggestedStart = computeNextStartNumber(draftR);
    setSheetCountInput('1');
    setPrintStartNumberInput(String(suggestedStart));
    setPendingConfirmRange(null);
    setIsPrintModalOpen(true);
  };

  const minAllowedStartNumber = printedUpTo > 0 ? printedUpTo + 1 : 1;
  const parsedSheetCount = Math.max(1, Math.floor(Number(sheetCountInput) || 1));
  const parsedPrintStart = Math.floor(Number(printStartNumberInput) || 0);
  const isPrintStartValid =
    Number.isFinite(parsedPrintStart) && parsedPrintStart >= minAllowedStartNumber;

  const previewNumbers = isPrintStartValid
    ? computeSequentialReceiptNumbers(parsedSheetCount, parsedPrintStart, voidedNumbers)
    : [];

  const handleGenerateReceipts = async (action: 'download' | 'share') => {
    if (!Number.isFinite(parsedSheetCount) || parsedSheetCount < 1) {
      onShowToast('error', 'Le nombre de feuilles doit être au moins 1.');
      return;
    }
    if (!isPrintStartValid) {
      onShowToast(
        'error',
        `Le numéro de départ doit être au moins ${formatReceiptNumber(
          minAllowedStartNumber
        )} pour ne répéter aucun numéro déjà imprimé.`
      );
      return;
    }

    setIsGeneratingPdf(true);
    try {
      const currentReceiptCfg = buildCurrentReceiptSettings();
      const updatedSettingsBeforePrint: AppSettings = {
        ...settings,
        receiptSettings: currentReceiptCfg,
        wholesaleTiers: cleanWholesaleTiers(wholesaleTiers),
      };
      await db.settings.put(updatedSettingsBeforePrint);
      onSettingsUpdated(updatedSettingsBeforePrint);

      const result = await generateBlankReceiptsPDF({
        settings: updatedSettingsBeforePrint,
        products,
        sheetCount: parsedSheetCount,
        startNumber: parsedPrintStart,
        action,
      });

      setPendingConfirmRange({
        firstNumber: result.firstNumber,
        lastNumber: result.lastNumber,
        totalReceipts: result.numbers.length,
      });
    } catch (err: any) {
      onShowToast('error', 'Erreur génération PDF : ' + err.message);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleConfirmPrintedUpTo = async () => {
    if (!pendingConfirmRange) return;
    const newPrintedUpTo = Math.max(printedUpTo, pendingConfirmRange.lastNumber);
    setPrintedUpTo(newPrintedUpTo);

    const updatedSettings: AppSettings = {
      ...settings,
      receiptSettings: buildCurrentReceiptSettings(newPrintedUpTo),
      wholesaleTiers: cleanWholesaleTiers(wholesaleTiers),
    };
    await db.settings.put(updatedSettings);
    onSettingsUpdated(updatedSettings);
    setPendingConfirmRange(null);
    setIsPrintModalOpen(false);
    onShowToast(
      'success',
      `Compteur mis à jour : dernier reçu imprimé N° ${formatReceiptNumber(newPrintedUpTo)}.`
    );
  };

  // Live preview computed strings
  const liveReceiptCfg = buildCurrentReceiptSettings();
  const previewNumberStr = formatReceiptNumber(computeNextStartNumber(liveReceiptCfg));
  const previewBusinessUpper = (
    businessName.trim() ||
    settings.businessName ||
    'Yaourt Gestion'
  ).toUpperCase();
  const previewContacts = buildReceiptContactsLine(liveReceiptCfg);
  const previewIds = buildReceiptIdsLine(liveReceiptCfg);
  const previewLogoSrc = settings.appLogoBase64 || '/pwa-512x512.png';

  const catalogueProducts = products.filter(
    (p) => p.isActive || (wholesaleTiers[p.id] && wholesaleTiers[p.id].length > 0)
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
          <FileText className="w-4 h-4 text-amber-700" />
          <span>Reçus & Prix de gros (PDF)</span>
        </h3>
        <span className="text-[10px] text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md font-bold">
          4 reçus / A4
        </span>
      </div>

      {/* Bouton principal : Imprimer des reçus */}
      <div className="p-3 rounded-2xl bg-amber-50/70 border border-amber-200/80 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-xs font-extrabold text-slate-900 block">
            Feuilles de reçus vierges
          </span>
          <span className="text-[11px] text-slate-600 block">
            {printedUpTo > 0
              ? `Dernier imprimé : N° ${formatReceiptNumber(printedUpTo)} · Prochain : N° ${previewNumberStr}`
              : `Aucun reçu imprimé · Départ : N° ${previewNumberStr}`}
          </span>
        </div>
        <button
          type="button"
          onClick={handleOpenPrintModal}
          className="py-2.5 px-3.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold shadow-xs flex items-center gap-1.5 shrink-0 active:scale-95 transition-all min-h-[42px]"
        >
          <Printer className="w-4 h-4" />
          <span>Imprimer des reçus</span>
        </button>
      </div>

      {/* APERÇU VISUEL EN DIRECT D'UN REÇU */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-800">Aperçu en direct d’un reçu</span>
          <span className="text-[10px] text-slate-400">200 × 70 mm (Souche + Reçu)</span>
        </div>

        <div className="p-2 rounded-xl bg-slate-100 border border-slate-200/80 overflow-hidden">
          <svg
            viewBox="0 0 200 70"
            className="w-full h-auto block bg-white rounded-md shadow-2xs select-none"
            role="img"
            aria-label="Aperçu du reçu"
          >
            {/* Cadre arrondi */}
            <rect
              x="0.4"
              y="0.4"
              width="199.2"
              height="69.2"
              rx="3"
              ry="3"
              fill="#FFFFFF"
              stroke={mainColor}
              strokeWidth="0.45"
            />

            {/* Trait vertical pointillé à x = 50 */}
            <line
              x1="50"
              y1="1"
              x2="50"
              y2="69"
              stroke="#736B61"
              strokeWidth="0.25"
              strokeDasharray="2 2"
            />

            {/* SOUCHE (0..50) */}
            <image
              href={previewLogoSrc}
              x="4"
              y="2"
              width="13"
              height="13"
              preserveAspectRatio="xMidYMid meet"
            />
            <text
              x="20"
              y="8"
              fill={mainColor}
              fontSize="2.8"
              fontWeight="700"
              fontFamily="Helvetica, Arial, sans-serif"
            >
              SOUCHE
            </text>
            <text
              x="20"
              y="12"
              fill="#736B61"
              fontSize="2.05"
              fontStyle="italic"
              fontFamily="Helvetica, Arial, sans-serif"
            >
              à conserver
            </text>

            {/* Pilule souche */}
            <rect x="4" y="17.5" width="42" height="6" rx="1.5" ry="1.5" fill={mainColor} />
            <text
              x="25"
              y="21.65"
              fill="#FFFFFF"
              fontSize="3.35"
              fontWeight="700"
              textAnchor="middle"
              fontFamily="Helvetica, Arial, sans-serif"
            >
              {`N° ${previewNumberStr}`}
            </text>

            {/* Champs souche */}
            {[
              { label: 'Date :', y: 30, fc: false, lineStart: 13.5 },
              { label: 'Client :', y: 37.6, fc: false, lineStart: 14.5 },
              { label: 'Total :', y: 45.2, fc: true, lineStart: 13.5 },
              { label: 'Payé :', y: 52.8, fc: true, lineStart: 13.5 },
              { label: 'Reste :', y: 60.4, fc: true, lineStart: 14.2 },
            ].map((sf) => (
              <g key={sf.label}>
                <text
                  x="4"
                  y={sf.y}
                  fill="#241A0F"
                  fontSize="2.4"
                  fontWeight="700"
                  fontFamily="Helvetica, Arial, sans-serif"
                >
                  {sf.label}
                </text>
                {sf.fc && (
                  <text
                    x="46"
                    y={sf.y}
                    fill="#736B61"
                    fontSize="2.05"
                    textAnchor="end"
                    fontFamily="Helvetica, Arial, sans-serif"
                  >
                    FC
                  </text>
                )}
                <line
                  x1={sf.lineStart}
                  y1={sf.y + 0.65}
                  x2="46"
                  y2={sf.y + 0.65}
                  stroke="#8C857A"
                  strokeWidth="0.16"
                />
              </g>
            ))}

            {/* REÇU (50..200) */}
            <image
              href={previewLogoSrc}
              x="54"
              y="2"
              width="15"
              height="15"
              preserveAspectRatio="xMidYMid meet"
            />
            <text
              x="71"
              y="6.8"
              fill="#241A0F"
              fontSize="3.5"
              fontWeight="700"
              fontFamily="Helvetica, Arial, sans-serif"
            >
              {clampPreviewText(previewBusinessUpper, 38)}
            </text>

            {tagline.trim() && (
              <text
                x="71"
                y="10.3"
                fill={mainColor}
                fontSize="2.05"
                fontStyle="italic"
                fontFamily="Helvetica, Arial, sans-serif"
              >
                {clampPreviewText(tagline.trim(), 68)}
              </text>
            )}

            {previewContacts && (
              <text
                x="71"
                y="13.6"
                fill="#736B61"
                fontSize="2.05"
                fontFamily="Helvetica, Arial, sans-serif"
              >
                {clampPreviewText(previewContacts, 70)}
              </text>
            )}

            {previewIds && (
              <text
                x="71"
                y="16.6"
                fill="#736B61"
                fontSize="1.87"
                fontFamily="Helvetica, Arial, sans-serif"
              >
                {clampPreviewText(previewIds, 95)}
              </text>
            )}

            {/* Pilule reçu */}
            <rect x="156" y="2.5" width="40" height="8" rx="1.8" ry="1.8" fill={mainColor} />
            <text
              x="176"
              y="7.6"
              fill="#FFFFFF"
              fontSize="3.15"
              fontWeight="700"
              textAnchor="middle"
              fontFamily="Helvetica, Arial, sans-serif"
            >
              {`REÇU N° ${previewNumberStr}`}
            </text>

            {/* Date */}
            <text
              x="196"
              y="14.3"
              fill="#241A0F"
              fontSize="2.3"
              textAnchor="end"
              fontFamily="Helvetica, Arial, sans-serif"
            >
              Date : ___ / ___ / 20___
            </text>

            {/* Client & Tél */}
            <text
              x="54"
              y="23.2"
              fill="#241A0F"
              fontSize="2.45"
              fontWeight="700"
              fontFamily="Helvetica, Arial, sans-serif"
            >
              Client :
            </text>
            <line x1="65" y1="23.9" x2="128" y2="23.9" stroke="#8C857A" strokeWidth="0.16" />
            <text
              x="131"
              y="23.2"
              fill="#241A0F"
              fontSize="2.45"
              fontWeight="700"
              fontFamily="Helvetica, Arial, sans-serif"
            >
              Tél :
            </text>
            <line x1="138" y1="23.9" x2="196" y2="23.9" stroke="#8C857A" strokeWidth="0.16" />

            {/* TABLEAU */}
            <rect x="54" y="26.5" width="142" height="5" fill="#FCF2D6" />
            <rect
              x="54"
              y="26.5"
              width="142"
              height="25.8"
              fill="none"
              stroke="#8C857A"
              strokeWidth="0.16"
            />
            {[0, 1, 2, 3].map((idx) => {
              const ly = 31.5 + idx * 5.2;
              return (
                <line
                  key={idx}
                  x1="54"
                  y1={ly}
                  x2="196"
                  y2={ly}
                  stroke="#8C857A"
                  strokeWidth="0.16"
                />
              );
            })}
            <line x1="96" y1="26.5" x2="96" y2="52.3" stroke="#8C857A" strokeWidth="0.16" />
            <line x1="130" y1="26.5" x2="130" y2="52.3" stroke="#8C857A" strokeWidth="0.16" />
            <line x1="164" y1="26.5" x2="164" y2="52.3" stroke="#8C857A" strokeWidth="0.16" />

            <text
              x="56"
              y="29.9"
              fill="#241A0F"
              fontSize="2.33"
              fontWeight="700"
              fontFamily="Helvetica, Arial, sans-serif"
            >
              Désignation
            </text>
            <text
              x="113"
              y="29.9"
              fill="#241A0F"
              fontSize="2.33"
              fontWeight="700"
              textAnchor="middle"
              fontFamily="Helvetica, Arial, sans-serif"
            >
              Prix unitaire
            </text>
            <text
              x="147"
              y="29.9"
              fill="#241A0F"
              fontSize="2.33"
              fontWeight="700"
              textAnchor="middle"
              fontFamily="Helvetica, Arial, sans-serif"
            >
              Quantité prise
            </text>
            <text
              x="180"
              y="29.9"
              fill="#241A0F"
              fontSize="2.33"
              fontWeight="700"
              textAnchor="middle"
              fontFamily="Helvetica, Arial, sans-serif"
            >
              Total
            </text>

            {[0, 1, 2, 3].map((idx) => {
              const rowY = 31.5 + idx * 5.2 + 3.9;
              const prod = effectivePrintedProducts[idx];
              return (
                <g key={idx}>
                  {prod && (
                    <text
                      x="56"
                      y={rowY}
                      fill="#241A0F"
                      fontSize="2.45"
                      fontFamily="Helvetica, Arial, sans-serif"
                    >
                      {clampPreviewText(prod.name, 26)}
                    </text>
                  )}
                  <text
                    x="128.5"
                    y={rowY}
                    fill="#736B61"
                    fontSize="1.98"
                    textAnchor="end"
                    fontFamily="Helvetica, Arial, sans-serif"
                  >
                    FC
                  </text>
                  <text
                    x="194.5"
                    y={rowY}
                    fill="#736B61"
                    fontSize="1.98"
                    textAnchor="end"
                    fontFamily="Helvetica, Arial, sans-serif"
                  >
                    FC
                  </text>
                </g>
              );
            })}

            {/* SOUS LE TABLEAU (by = 52.3) */}
            <text
              x="54"
              y="56.5"
              fill="#241A0F"
              fontSize="2.26"
              fontWeight="700"
              fontFamily="Helvetica, Arial, sans-serif"
            >
              Paiement :
            </text>

            {[
              { x: 70, label: 'Espèces' },
              { x: 89, label: 'Mobile money' },
              { x: 111, label: 'À crédit' },
            ].map((pb) => (
              <g key={pb.label}>
                <rect
                  x={pb.x}
                  y="54.2"
                  width="2.6"
                  height="2.6"
                  fill="none"
                  stroke="#8C857A"
                  strokeWidth="0.16"
                />
                <text
                  x={pb.x + 3.6}
                  y="56.35"
                  fill="#241A0F"
                  fontSize="2.12"
                  fontFamily="Helvetica, Arial, sans-serif"
                >
                  {pb.label}
                </text>
              </g>
            ))}

            {thankYouMessage.trim() && (
              <text
                x="54"
                y="60.5"
                fill={mainColor}
                fontSize="2.33"
                fontWeight="700"
                fontStyle="italic"
                fontFamily="Helvetica, Arial, sans-serif"
              >
                {clampPreviewText(thankYouMessage.trim(), 56)}
              </text>
            )}

            {/* Signatures */}
            <line x1="54" y1="64.3" x2="92" y2="64.3" stroke="#8C857A" strokeWidth="0.16" />
            <line x1="98" y1="64.3" x2="134" y2="64.3" stroke="#8C857A" strokeWidth="0.16" />
            <text
              x="73"
              y="66.6"
              fill="#736B61"
              fontSize="1.83"
              textAnchor="middle"
              fontFamily="Helvetica, Arial, sans-serif"
            >
              Signature du client
            </text>
            <text
              x="116"
              y="66.6"
              fill="#736B61"
              fontSize="1.83"
              textAnchor="middle"
              fontFamily="Helvetica, Arial, sans-serif"
            >
              Signature du vendeur
            </text>

            {/* TOTAUX */}
            <rect x="140" y="52.9" width="56" height="4.5" fill={mainColor} />
            <text
              x="142"
              y="56"
              fill="#FFFFFF"
              fontSize="2.26"
              fontWeight="700"
              fontFamily="Helvetica, Arial, sans-serif"
            >
              TOTAL À PAYER
            </text>
            <text
              x="194"
              y="56"
              fill="#FFFFFF"
              fontSize="2.12"
              fontWeight="700"
              textAnchor="end"
              fontFamily="Helvetica, Arial, sans-serif"
            >
              FC
            </text>

            <rect
              x="140"
              y="57.4"
              width="56"
              height="4.5"
              fill="none"
              stroke="#8C857A"
              strokeWidth="0.16"
            />
            <text
              x="142"
              y="60.5"
              fill="#241A0F"
              fontSize="2.26"
              fontWeight="700"
              fontFamily="Helvetica, Arial, sans-serif"
            >
              PAYÉ
            </text>
            <text
              x="194"
              y="60.5"
              fill="#736B61"
              fontSize="2.05"
              textAnchor="end"
              fontFamily="Helvetica, Arial, sans-serif"
            >
              FC
            </text>

            <rect
              x="140"
              y="61.9"
              width="56"
              height="4.5"
              fill="none"
              stroke="#8C857A"
              strokeWidth="0.16"
            />
            <text
              x="142"
              y="65"
              fill="#241A0F"
              fontSize="2.26"
              fontWeight="700"
              fontFamily="Helvetica, Arial, sans-serif"
            >
              RESTE À PAYER
            </text>
            <text
              x="194"
              y="65"
              fill="#736B61"
              fontSize="2.05"
              textAnchor="end"
              fontFamily="Helvetica, Arial, sans-serif"
            >
              FC
            </text>

            {/* PIED DE PAGE */}
            {footerMention.trim() && (
              <text
                x="54"
                y="69"
                fill="#736B61"
                fontSize="1.69"
                fontFamily="Helvetica, Arial, sans-serif"
              >
                {clampPreviewText(footerMention.trim(), 120)}
              </text>
            )}
          </svg>
        </div>
        <p className="text-[10px] text-slate-400">
          Le logo utilisé est automatiquement celui de l’application (modifiable plus haut dans Paramètres).
        </p>
      </div>

      {/* 1. COULEUR PRINCIPALE */}
      <div className="space-y-2 pt-2 border-t border-slate-100">
        <label className="text-xs font-bold text-slate-800 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5 text-amber-700" />
            <span>Couleur principale du reçu</span>
          </span>
          <span className="text-[11px] font-mono font-bold text-slate-700">{mainColor}</span>
        </label>

        <div className="grid grid-cols-4 gap-2">
          {RECEIPT_PRESET_COLORS.map((color) => {
            const isSelected = mainColor.toLowerCase() === color.hex.toLowerCase();
            return (
              <button
                key={color.hex}
                type="button"
                onClick={() => setMainColor(color.hex)}
                className={`flex items-center gap-1.5 p-2 rounded-xl border text-[11px] font-bold transition-all min-h-[38px] ${
                  isSelected
                    ? 'border-slate-800 bg-slate-50 shadow-2xs scale-[1.02]'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" aria-hidden="true">
                  <circle
                    cx="8"
                    cy="8"
                    r="7"
                    fill={color.hex}
                    stroke="rgba(0,0,0,0.12)"
                    strokeWidth="1"
                  />
                </svg>
                <span className="truncate text-slate-800">{color.name.split(' ')[0]}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <input
            type="color"
            value={mainColor}
            onChange={(e) => setMainColor(e.target.value)}
            className="w-9 h-9 rounded-xl border border-slate-200 cursor-pointer p-0.5 bg-white"
          />
          <span className="text-xs text-slate-600">Ou choisir une couleur personnalisée</span>
        </div>
      </div>

      {/* 2. COORDONNÉES & IDENTIFIANTS DE L'ENTREPRISE */}
      <div className="space-y-2.5 pt-2 border-t border-slate-100">
        <div className="text-xs font-bold text-slate-800">En-tête & coordonnées du reçu</div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="text-[11px] font-bold text-slate-600 block mb-1">
              Nom du business (défaut : Paramètres)
            </label>
            <input
              type="text"
              placeholder={settings.businessName || 'Yaourt Gestion'}
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-slate-50 focus:bg-white focus:outline-teal-700 min-h-[40px]"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-600 block mb-1">
              Accroche / slogan (optionnel)
            </label>
            <input
              type="text"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-slate-50 focus:bg-white focus:outline-teal-700 min-h-[40px]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div>
            <label className="text-[11px] font-bold text-slate-600 block mb-1">
              Adresse (optionnel)
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-slate-50 focus:bg-white focus:outline-teal-700 min-h-[40px]"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-600 block mb-1">
              Téléphone WhatsApp (optionnel)
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-slate-50 focus:bg-white focus:outline-teal-700 min-h-[40px]"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-600 block mb-1">
              E-mail (optionnel)
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-slate-50 focus:bg-white focus:outline-teal-700 min-h-[40px]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div>
            <label className="text-[11px] font-bold text-slate-600 block mb-1">
              ID NAT (optionnel)
            </label>
            <input
              type="text"
              value={idNat}
              onChange={(e) => setIdNat(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-slate-50 focus:bg-white focus:outline-teal-700 min-h-[40px]"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-600 block mb-1">
              RCCM (optionnel)
            </label>
            <input
              type="text"
              value={rccm}
              onChange={(e) => setRccm(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-slate-50 focus:bg-white focus:outline-teal-700 min-h-[40px]"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-600 block mb-1">
              N° impôt (optionnel)
            </label>
            <input
              type="text"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-slate-50 focus:bg-white focus:outline-teal-700 min-h-[40px]"
            />
          </div>
        </div>
      </div>

      {/* 3. MESSAGES (REMERCIEMENT & PIED DE PAGE) */}
      <div className="space-y-2.5 pt-2 border-t border-slate-100">
        <div>
          <label className="text-[11px] font-bold text-slate-700 block mb-1">
            Message de remerciement :
          </label>
          <input
            type="text"
            value={thankYouMessage}
            onChange={(e) => setThankYouMessage(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-slate-50 focus:bg-white focus:outline-teal-700 min-h-[40px]"
          />
        </div>

        <div>
          <label className="text-[11px] font-bold text-slate-700 block mb-1">
            Mention en pied de reçu :
          </label>
          <input
            type="text"
            value={footerMention}
            onChange={(e) => setFooterMention(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-slate-50 focus:bg-white focus:outline-teal-700 min-h-[40px]"
          />
        </div>
      </div>

      {/* 4. PRODUITS IMPRIMÉS DANS LE TABLEAU (JUSQU'À 4) */}
      <div className="space-y-2 pt-2 border-t border-slate-100">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-slate-800">
            Produits imprimés dans le tableau (max 4)
          </label>
          <span className="text-[10px] font-bold text-slate-500">
            {effectivePrintedIds.length} / 4 sélectionnés
          </span>
        </div>
        <p className="text-[10px] text-slate-400">
          Les lignes restantes restent vierges pour pouvoir écrire un autre produit à la main.
        </p>

        <div className="space-y-1.5">
          {products
            .filter((p) => p.isActive || effectivePrintedIds.includes(p.id))
            .map((prod) => {
              const orderIdx = effectivePrintedIds.indexOf(prod.id);
              const isSelected = orderIdx >= 0;
              return (
                <div
                  key={prod.id}
                  className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border text-xs ${
                    isSelected
                      ? 'bg-amber-50/50 border-amber-300'
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleTogglePrintedProduct(prod.id)}
                      className="accent-amber-700 w-4 h-4 rounded shrink-0"
                    />
                    <span className="font-bold text-slate-800 truncate">{prod.name}</span>
                    {isSelected && (
                      <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 shrink-0">
                        Ligne {orderIdx + 1}
                      </span>
                    )}
                  </label>

                  {isSelected && effectivePrintedIds.length > 1 && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={orderIdx === 0}
                        onClick={() => handleMovePrintedProduct(prod.id, -1)}
                        className="p-1 rounded-lg bg-white border border-slate-200 text-slate-600 disabled:opacity-30"
                        title="Monter"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={orderIdx === effectivePrintedIds.length - 1}
                        onClick={() => handleMovePrintedProduct(prod.id, 1)}
                        className="p-1 rounded-lg bg-white border border-slate-200 text-slate-600 disabled:opacity-30"
                        title="Descendre"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {/* 5. NUMÉROTATION & NUMÉROS ANNULÉS */}
      <div className="space-y-2.5 pt-2 border-t border-slate-100">
        <div className="text-xs font-bold text-slate-800">Numérotation des reçus</div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="text-[11px] font-bold text-slate-600 block mb-1">
              Premier numéro du carnet
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={startNumberInput}
              onChange={(e) => setStartNumberInput(e.target.value.replace(/[^0-9]/g, ''))}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold font-mono text-slate-800 bg-slate-50 focus:bg-white min-h-[40px]"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-600 block mb-1">
              Dernier numéro imprimé
            </label>
            <div className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold font-mono text-slate-700 bg-slate-100 min-h-[40px] flex items-center">
              {printedUpTo > 0 ? `N° ${formatReceiptNumber(printedUpTo)}` : 'Aucun (0)'}
            </div>
          </div>
        </div>

        {/* Numéros annulés */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-slate-600 block">
            Numéros annulés (reçus abîmés ou annulés)
          </label>
          {voidedNumbers.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {voidedNumbers.map((vn) => (
                <span
                  key={vn}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-50 text-rose-800 border border-rose-200 text-[11px] font-mono font-bold"
                >
                  <span>N° {formatReceiptNumber(vn)}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveVoidNumber(vn)}
                    className="text-rose-500 hover:text-rose-800 p-0.5"
                    title="Retirer des annulés"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              placeholder="Ex : 12"
              value={newVoidNumberInput}
              onChange={(e) => setNewVoidNumberInput(e.target.value.replace(/[^0-9]/g, ''))}
              className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-xs font-mono font-semibold text-slate-800 bg-slate-50 focus:bg-white min-h-[38px]"
            />
            <button
              type="button"
              onClick={handleAddVoidNumber}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold min-h-[38px]"
            >
              Annuler ce N°
            </button>
          </div>
        </div>
      </div>

      {/* 6. TABLEAU "PRIX DE GROS" PAR PRODUIT */}
      <div className="space-y-2.5 pt-2 border-t border-slate-100">
        <div>
          <span className="text-xs font-bold text-slate-800 block">Prix de gros par produit</span>
          <span className="text-[10px] text-slate-400 block">
            Paliers dégressifs selon la quantité prise (vide par défaut).
          </span>
        </div>

        {catalogueProducts.length === 0 ? (
          <p className="text-xs text-slate-400 italic">Aucun produit actif dans le catalogue.</p>
        ) : (
          <div className="space-y-2.5">
            {catalogueProducts.map((prod) => {
              const tiers = wholesaleTiers[prod.id] || [];
              return (
                <div
                  key={prod.id}
                  className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-slate-900">{prod.name}</span>
                    <span className="text-[11px] font-mono text-slate-500">
                      Prix normal : {formatFC(prod.defaultPrice, currency)}
                    </span>
                  </div>

                  {tiers.length > 0 && (
                    <div className="space-y-1">
                      {tiers.map((tier) => (
                        <div
                          key={tier.minQty}
                          className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-xs"
                        >
                          <span className="text-slate-800 font-semibold">
                            à partir de <strong className="font-mono">{formatNumber(tier.minQty)}</strong> :{' '}
                            <strong className="font-mono text-teal-800">
                              {formatFC(tier.priceFC, currency)}
                            </strong>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDeleteWholesaleTier(prod.id, tier.minQty)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded"
                            title="Supprimer ce palier"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Ligne d'ajout : à partir de [quantité] : [prix unitaire] FC */}
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <span className="text-[11px] text-slate-600 font-semibold shrink-0">
                      à partir de
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Qté"
                      value={tierDraftQty[prod.id] || ''}
                      onChange={(e) =>
                        setTierDraftQty((prev) => ({
                          ...prev,
                          [prod.id]: e.target.value.replace(/[^0-9]/g, ''),
                        }))
                      }
                      className="w-16 px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold font-mono text-center text-slate-800 min-h-[34px]"
                    />
                    <span className="text-[11px] text-slate-600 font-semibold shrink-0">:</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="Prix"
                      value={tierDraftPrice[prod.id] || ''}
                      onChange={(e) =>
                        setTierDraftPrice((prev) => ({
                          ...prev,
                          [prod.id]: e.target.value.replace(/[^0-9.,]/g, ''),
                        }))
                      }
                      className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold font-mono text-slate-800 min-h-[34px]"
                    />
                    <span className="text-[11px] text-slate-500 font-bold shrink-0">
                      {currency}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleAddWholesaleTier(prod.id)}
                      className="p-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white shrink-0 min-h-[34px] min-w-[34px] flex items-center justify-center"
                      title="Ajouter ce prix de gros"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 7. BOUTONS D'ENREGISTREMENT */}
      <div className="pt-2 border-t border-slate-100 space-y-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleOpenPrintModal}
            className="flex-1 py-3 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-all min-h-[46px]"
          >
            <Printer className="w-4 h-4 text-amber-400" />
            <span>Imprimer des reçus</span>
          </button>

          <button
            type="button"
            onClick={handleResetToDefault}
            className="py-3 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center gap-1 active:scale-95 transition-all min-h-[46px]"
            title="Rétablir les valeurs par défaut"
          >
            <RotateCcw className="w-4 h-4" />
            <span className="hidden sm:inline">Rétablir par défaut</span>
          </button>
        </div>

        <button
          type="button"
          disabled={isSaving}
          onClick={handleSave}
          className="w-full py-3 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs font-bold shadow-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all min-h-[46px]"
        >
          <Check className="w-4 h-4" />
          <span>{isSaving ? 'Enregistrement...' : 'Enregistrer les réglages des reçus'}</span>
        </button>
      </div>

      {/* MODALE : IMPRIMER DES REÇUS */}
      {isPrintModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                <Printer className="w-4 h-4 text-amber-700" />
                <span>Imprimer des reçus vierges</span>
              </h4>
              <button
                type="button"
                onClick={() => {
                  setIsPrintModalOpen(false);
                  setPendingConfirmRange(null);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {!pendingConfirmRange ? (
              <div className="space-y-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Nombre de feuilles A4 (1 feuille = 4 reçus)
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setSheetCountInput(String(Math.max(1, parsedSheetCount - 1)))
                      }
                      className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-extrabold text-sm"
                    >
                      −
                    </button>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={sheetCountInput}
                      onChange={(e) =>
                        setSheetCountInput(e.target.value.replace(/[^0-9]/g, ''))
                      }
                      className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-center text-sm font-extrabold font-mono text-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => setSheetCountInput(String(parsedSheetCount + 1))}
                      className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-extrabold text-sm"
                    >
                      +
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Total : <strong>{parsedSheetCount * 4} reçus</strong> sur {parsedSheetCount}{' '}
                    {parsedSheetCount > 1 ? 'feuilles' : 'feuille'} A4.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Numéro de départ
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={printStartNumberInput}
                    onChange={(e) =>
                      setPrintStartNumberInput(e.target.value.replace(/[^0-9]/g, ''))
                    }
                    className={`w-full px-3 py-2 rounded-xl border text-sm font-extrabold font-mono ${
                      isPrintStartValid
                        ? 'border-slate-200 text-slate-900'
                        : 'border-rose-400 bg-rose-50 text-rose-800'
                    }`}
                  />
                  {!isPrintStartValid ? (
                    <p className="text-[11px] text-rose-600 font-semibold mt-1">
                      Minimum autorisé : N° {formatReceiptNumber(minAllowedStartNumber)} (les numéros déjà imprimés ne peuvent jamais être répétés).
                    </p>
                  ) : (
                    previewNumbers.length > 0 && (
                      <p className="text-[11px] text-teal-800 font-semibold mt-1">
                        Numéros générés :{' '}
                        <strong className="font-mono">
                          N° {formatReceiptNumber(previewNumbers[0])}
                        </strong>{' '}
                        à{' '}
                        <strong className="font-mono">
                          N° {formatReceiptNumber(previewNumbers[previewNumbers.length - 1])}
                        </strong>
                      </p>
                    )
                  )}
                </div>

                <div className="pt-2 space-y-2">
                  <button
                    type="button"
                    disabled={!isPrintStartValid || isGeneratingPdf}
                    onClick={() => handleGenerateReceipts('download')}
                    className="w-full py-3 px-4 rounded-xl bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5 min-h-[44px]"
                  >
                    <Printer className="w-4 h-4" />
                    <span>
                      {isGeneratingPdf ? 'Génération du PDF...' : 'Télécharger le PDF (A4)'}
                    </span>
                  </button>

                  {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
                    <button
                      type="button"
                      disabled={!isPrintStartValid || isGeneratingPdf}
                      onClick={() => handleGenerateReceipts('share')}
                      className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-800 text-xs font-bold flex items-center justify-center gap-1.5 min-h-[42px]"
                    >
                      <Share2 className="w-4 h-4 text-teal-700" />
                      <span>Partager / Imprimer sur téléphone</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 space-y-1">
                  <span className="text-xs font-extrabold text-emerald-900 block">
                    PDF généré ({pendingConfirmRange.totalReceipts} reçus)
                  </span>
                  <p className="text-xs text-emerald-800 leading-relaxed">
                    Reçus{' '}
                    <strong className="font-mono">
                      N° {formatReceiptNumber(pendingConfirmRange.firstNumber)}
                    </strong>{' '}
                    à{' '}
                    <strong className="font-mono">
                      N° {formatReceiptNumber(pendingConfirmRange.lastNumber)}
                    </strong>
                    . Confirmez-vous l’impression pour enregistrer{' '}
                    <strong className="font-mono">
                      N° {formatReceiptNumber(pendingConfirmRange.lastNumber)}
                    </strong>{' '}
                    comme dernier numéro imprimé ?
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={handleConfirmPrintedUpTo}
                    className="w-full py-3 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold flex items-center justify-center gap-1.5 min-h-[44px]"
                  >
                    <Check className="w-4 h-4" />
                    <span>
                      Oui, enregistrer jusqu’au N°{' '}
                      {formatReceiptNumber(pendingConfirmRange.lastNumber)}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPendingConfirmRange(null);
                      setIsPrintModalOpen(false);
                    }}
                    className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold min-h-[40px]"
                  >
                    Non, ne pas modifier le compteur
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
