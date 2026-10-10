import React, { useState, useRef } from 'react';
import {
  FileSpreadsheet,
  Image as ImageIcon,
  Palette,
  Eye,
  RotateCcw,
  Trash2,
  Upload,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Check,
} from 'lucide-react';
import { db } from '../../db/db';
import { toISOMonth } from '../../utils/formatters';
import { generateEmployeeMonthlyPDF } from '../../utils/pdfGenerator';
import type { AppSettings, PayslipSettings, Employee, DailyEntry, Payment } from '../../types';

interface PayslipSettingsSectionProps {
  settings: AppSettings;
  onSettingsUpdated: (newSettings: AppSettings) => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
}

const PRESET_COLORS = [
  { name: 'Teal (Défaut)', hex: '#0d9488' },
  { name: 'Émeraude', hex: '#059669' },
  { name: 'Bleu', hex: '#2563eb' },
  { name: 'Indigo', hex: '#4f46e5' },
  { name: 'Violet', hex: '#7c3aed' },
  { name: 'Ardoise', hex: '#334155' },
  { name: 'Ambre', hex: '#d97706' },
  { name: 'Rose', hex: '#e11d48' },
];

/**
 * Compresses and resizes an image client-side before storing in IndexedDB.
 */
function compressImage(file: File, maxDim: number, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas non supporté'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        resolve(canvas.toDataURL(mime, quality));
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export const PayslipSettingsSection: React.FC<PayslipSettingsSectionProps> = ({
  settings,
  onSettingsUpdated,
  onShowToast,
}) => {
  const p = settings.payslipSettings || {};

  // Form states
  const [logoBase64, setLogoBase64] = useState<string | undefined>(p.logoBase64);
  const [logoPosition, setLogoPosition] = useState<'left' | 'center' | 'right'>(
    p.logoPosition || 'left'
  );
  const [bgImageBase64, setBgImageBase64] = useState<string | undefined>(p.bgImageBase64);
  const [bgOpacityPct, setBgOpacityPct] = useState<number>(p.bgOpacityPct ?? 15);
  const [businessName, setBusinessName] = useState<string>(p.businessName || '');
  const [documentTitle, setDocumentTitle] = useState<string>(
    p.documentTitle || 'Document officiel de décompte mensuel'
  );
  const [headerContact, setHeaderContact] = useState<string>(p.headerContact || '');
  const [footerNote, setFooterNote] = useState<string>(p.footerNote || '');
  const [primaryColorHex, setPrimaryColorHex] = useState<string>(p.primaryColorHex || '#0d9488');

  // Signatures
  const [employeeSignatureLabel, setEmployeeSignatureLabel] = useState<string>(
    p.employeeSignatureLabel || 'Signature du/de la vendeur(se)'
  );
  const [employeeSignatureSubtext, setEmployeeSignatureSubtext] = useState<string>(
    p.employeeSignatureSubtext || '(Précédé de la mention "Bon pour accord")'
  );
  const [ownerSignatureLabel, setOwnerSignatureLabel] = useState<string>(
    p.ownerSignatureLabel || 'Signature du gérant / propriétaire'
  );
  const [ownerSignatureSubtext, setOwnerSignatureSubtext] = useState<string>(
    p.ownerSignatureSubtext || '(Précédé de la mention "Payé / Validé")'
  );

  // Column visibility
  const [showDeliveryCol, setShowDeliveryCol] = useState<boolean>(p.showDeliveryCol ?? true);
  const [showDamagedCol, setShowDamagedCol] = useState<boolean>(p.showDamagedCol ?? true);
  const [showEmployeePhone, setShowEmployeePhone] = useState<boolean>(
    p.showEmployeePhone ?? true
  );
  const [showCommissionRate, setShowCommissionRate] = useState<boolean>(
    p.showCommissionRate ?? true
  );
  const [showSignatureZones, setShowSignatureZones] = useState<boolean>(
    p.showSignatureZones ?? true
  );

  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const bgInputRef = useRef<HTMLInputElement | null>(null);

  // Logo upload
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const resized = await compressImage(file, 600, 0.7);
      setLogoBase64(resized);
      onShowToast('info', 'Logo chargé et optimisé avec succès.');
    } catch (err: any) {
      onShowToast('error', 'Erreur chargement logo : ' + err.message);
    }
  };

  // Background upload
  const handleBgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const resized = await compressImage(file, 1200, 0.7);
      setBgImageBase64(resized);
      onShowToast('info', 'Photo d’arrière-plan chargée et optimisée avec succès.');
    } catch (err: any) {
      onShowToast('error', 'Erreur chargement photo : ' + err.message);
    }
  };

  const buildPayslipSettings = (): PayslipSettings => ({
    logoBase64,
    logoPosition,
    bgImageBase64,
    bgOpacityPct,
    businessName: businessName.trim() || undefined,
    documentTitle: documentTitle.trim() || 'Document officiel de décompte mensuel',
    headerContact: headerContact.trim() || undefined,
    footerNote: footerNote.trim() || undefined,
    primaryColorHex,
    employeeSignatureLabel: employeeSignatureLabel.trim() || 'Signature du/de la vendeur(se)',
    employeeSignatureSubtext:
      employeeSignatureSubtext.trim() || '(Précédé de la mention "Bon pour accord")',
    ownerSignatureLabel: ownerSignatureLabel.trim() || 'Signature du gérant / propriétaire',
    ownerSignatureSubtext:
      ownerSignatureSubtext.trim() || '(Précédé de la mention "Payé / Validé")',
    showDeliveryCol,
    showDamagedCol,
    showEmployeePhone,
    showCommissionRate,
    showSignatureZones,
  });

  // Save Settings
  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updatedPayslip = buildPayslipSettings();
      const updatedSettings: AppSettings = {
        ...settings,
        payslipSettings: updatedPayslip,
      };
      await db.settings.put(updatedSettings);
      onSettingsUpdated(updatedSettings);
      onShowToast('success', 'Paramètres de la fiche de paie enregistrés.');
    } catch (err: any) {
      onShowToast('error', 'Erreur enregistrement : ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Reset to default
  const handleResetToDefault = async () => {
    setLogoBase64(undefined);
    setLogoPosition('left');
    setBgImageBase64(undefined);
    setBgOpacityPct(15);
    setBusinessName('');
    setDocumentTitle('Document officiel de décompte mensuel');
    setHeaderContact('');
    setFooterNote('');
    setPrimaryColorHex('#0d9488');
    setEmployeeSignatureLabel('Signature du/de la vendeur(se)');
    setEmployeeSignatureSubtext('(Précédé de la mention "Bon pour accord")');
    setOwnerSignatureLabel('Signature du gérant / propriétaire');
    setOwnerSignatureSubtext('(Précédé de la mention "Payé / Validé")');
    setShowDeliveryCol(true);
    setShowDamagedCol(true);
    setShowEmployeePhone(true);
    setShowCommissionRate(true);
    setShowSignatureZones(true);

    const updatedSettings: AppSettings = {
      ...settings,
      payslipSettings: undefined,
    };
    await db.settings.put(updatedSettings);
    onSettingsUpdated(updatedSettings);
    onShowToast('info', 'Paramètres de la fiche réinitialisés par défaut.');
  };

  // Preview with real seller data (or '-' if no entries)
  const handlePreviewPDF = async () => {
    setIsPreviewing(true);
    try {
      const emps = await db.employees.toArray();
      const targetEmp: Employee =
        emps.find((e) => !e.isArchived) ||
        emps[0] || {
          id: 'preview_emp',
          name: 'Vendeur(se) Exemple',
          phone: '0990000000',
          commissionRate: 20,
          isArchived: false,
          createdAt: Date.now(),
        };

      const month = toISOMonth(new Date());
      let entries: DailyEntry[] = [];
      let payments: Payment[] = [];

      if (targetEmp.id !== 'preview_emp') {
        const allEntries = await db.dailyEntries
          .where('employeeId')
          .equals(targetEmp.id)
          .toArray();
        entries = allEntries.filter((e) => e.date.startsWith(month));

        const allPayments = await db.payments
          .where('employeeId')
          .equals(targetEmp.id)
          .toArray();
        payments = allPayments.filter((p) => p.month === month);
      }

      const previewSettings: AppSettings = {
        ...settings,
        payslipSettings: buildPayslipSettings(),
      };

      await generateEmployeeMonthlyPDF(
        {
          employee: targetEmp,
          month,
          entries,
          payments,
          settings: previewSettings,
        },
        'download'
      );
      onShowToast('success', 'Aperçu de la fiche généré avec succès.');
    } catch (err: any) {
      onShowToast('error', 'Erreur aperçu fiche : ' + err.message);
    } finally {
      setIsPreviewing(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
          <FileSpreadsheet className="w-4 h-4 text-teal-700" />
          <span>Personnalisation : Fiche de Paie (PDF)</span>
        </h3>
        <span className="text-[10px] text-teal-800 bg-teal-50 px-2 py-0.5 rounded-md font-bold">
          Optionnel
        </span>
      </div>

      {/* 1. LOGO */}
      <div className="space-y-2">
        <label className="text-xs font-bold text-slate-800 flex items-center justify-between">
          <span>Logo de l'entreprise</span>
          {logoBase64 && (
            <span className="text-[10px] text-emerald-700 font-normal">Logo configuré (600px max)</span>
          )}
        </label>

        <input
          ref={logoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleLogoUpload}
        />

        {logoBase64 ? (
          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-200">
            <div className="w-16 h-12 rounded-xl bg-white border border-slate-200 p-1 flex items-center justify-center overflow-hidden shrink-0">
              <img src={logoBase64} alt="Aperçu logo" className="max-w-full max-h-full object-contain" />
            </div>

            <div className="flex-1 space-y-1">
              <span className="text-xs font-bold text-slate-800 block">Position du logo :</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setLogoPosition('left')}
                  className={`p-1.5 rounded-lg border text-xs flex items-center gap-1 ${
                    logoPosition === 'left'
                      ? 'bg-teal-700 text-white border-teal-700'
                      : 'bg-white text-slate-600 border-slate-200'
                  }`}
                  title="Gauche"
                >
                  <AlignLeft className="w-3.5 h-3.5" />
                  <span className="text-[10px]">Gauche</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLogoPosition('center')}
                  className={`p-1.5 rounded-lg border text-xs flex items-center gap-1 ${
                    logoPosition === 'center'
                      ? 'bg-teal-700 text-white border-teal-700'
                      : 'bg-white text-slate-600 border-slate-200'
                  }`}
                  title="Centre"
                >
                  <AlignCenter className="w-3.5 h-3.5" />
                  <span className="text-[10px]">Centre</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLogoPosition('right')}
                  className={`p-1.5 rounded-lg border text-xs flex items-center gap-1 ${
                    logoPosition === 'right'
                      ? 'bg-teal-700 text-white border-teal-700'
                      : 'bg-white text-slate-600 border-slate-200'
                  }`}
                  title="Droite"
                >
                  <AlignRight className="w-3.5 h-3.5" />
                  <span className="text-[10px]">Droite</span>
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setLogoBase64(undefined)}
              aria-label="Supprimer logo"
              className="p-2 rounded-xl bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => logoInputRef.current?.click()}
            className="w-full py-3 px-3 rounded-2xl border-2 border-dashed border-slate-200 hover:border-teal-400 bg-slate-50/60 hover:bg-teal-50/30 text-xs font-bold text-slate-600 flex items-center justify-center gap-2 transition-all min-h-[46px]"
          >
            <Upload className="w-4 h-4 text-teal-700" />
            <span>Choisir un logo dans le téléphone</span>
          </button>
        )}
      </div>

      {/* 2. PHOTO D'ARRIÈRE-PLAN (WATERMARK / FOND) */}
      <div className="space-y-2 pt-1 border-t border-slate-100">
        <label className="text-xs font-bold text-slate-800 flex items-center justify-between">
          <span>Photo d'arrière-plan (sur chaque page)</span>
          {bgImageBase64 && (
            <span className="text-[10px] text-emerald-700 font-normal">Active (1200px max)</span>
          )}
        </label>

        <input
          ref={bgInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleBgUpload}
        />

        {bgImageBase64 ? (
          <div className="space-y-2 p-3 bg-slate-50 rounded-2xl border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-16 h-12 rounded-xl bg-white border border-slate-200 p-0.5 flex items-center justify-center overflow-hidden shrink-0 relative">
                <img
                  src={bgImageBase64}
                  alt="Aperçu fond"
                  className="w-full h-full object-cover"
                  style={{ opacity: bgOpacityPct / 100 }}
                />
              </div>

              <div className="flex-1">
                <span className="text-xs font-bold text-slate-800 block">
                  Opacité : {bgOpacityPct} %
                </span>
                <span className="text-[10px] text-slate-400 block">
                  Filigrane discret en fond
                </span>
              </div>

              <button
                type="button"
                onClick={() => setBgImageBase64(undefined)}
                aria-label="Supprimer photo arrière-plan"
                className="p-2 rounded-xl bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Opacity Slider */}
            <div className="pt-1">
              <div className="flex items-center justify-between text-[10px] text-slate-500 font-medium mb-1">
                <span>Très discret (5%)</span>
                <span>Actuel : {bgOpacityPct}%</span>
                <span>Visible (40%)</span>
              </div>
              <input
                type="range"
                min={5}
                max={40}
                step={1}
                value={bgOpacityPct}
                onChange={(e) => setBgOpacityPct(Number(e.target.value))}
                className="w-full accent-teal-700 h-2 bg-slate-200 rounded-lg cursor-pointer"
              />
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => bgInputRef.current?.click()}
            className="w-full py-3 px-3 rounded-2xl border-2 border-dashed border-slate-200 hover:border-teal-400 bg-slate-50/60 hover:bg-teal-50/30 text-xs font-bold text-slate-600 flex items-center justify-center gap-2 transition-all min-h-[46px]"
          >
            <ImageIcon className="w-4 h-4 text-teal-700" />
            <span>Choisir une photo d'arrière-plan</span>
          </button>
        )}
      </div>

      {/* 3. COULEUR PRINCIPALE */}
      <div className="space-y-2 pt-1 border-t border-slate-100">
        <label className="text-xs font-bold text-slate-800 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5 text-teal-700" />
            <span>Couleur principale (en-têtes et titres)</span>
          </span>
          <span className="text-[11px] font-mono font-bold text-slate-700">
            {primaryColorHex}
          </span>
        </label>

        {/* 8 Preset buttons */}
        <div className="grid grid-cols-4 gap-2">
          {PRESET_COLORS.map((color) => {
            const isSelected = primaryColorHex.toLowerCase() === color.hex.toLowerCase();
            return (
              <button
                key={color.hex}
                type="button"
                onClick={() => setPrimaryColorHex(color.hex)}
                className={`flex items-center gap-1.5 p-2 rounded-xl border text-[11px] font-bold transition-all min-h-[38px] ${
                  isSelected
                    ? 'border-slate-800 bg-slate-50 shadow-2xs scale-[1.02]'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <span
                  className="w-3.5 h-3.5 rounded-full shrink-0 border border-black/10"
                  style={{ backgroundColor: color.hex }}
                />
                <span className="truncate text-slate-800">{color.name.split(' ')[0]}</span>
              </button>
            );
          })}
        </div>

        {/* Custom color picker */}
        <div className="flex items-center gap-2 pt-1">
          <input
            type="color"
            value={primaryColorHex}
            onChange={(e) => setPrimaryColorHex(e.target.value)}
            className="w-9 h-9 rounded-xl border border-slate-200 cursor-pointer p-0.5 bg-white"
          />
          <span className="text-xs text-slate-600">
            Ou choisir une couleur personnalisée
          </span>
        </div>
      </div>

      {/* 4. EN-TÊTE & TEXTES DU DOCUMENT */}
      <div className="space-y-3 pt-1 border-t border-slate-100">
        <div className="text-xs font-bold text-slate-800">En-tête du document</div>

        <div>
          <label className="text-[11px] font-bold text-slate-600 block mb-1">
            Nom du business affiché (laisser vide pour nom par défaut) :
          </label>
          <input
            type="text"
            placeholder={settings.businessName || 'Yaourt Gestion'}
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-slate-50 focus:bg-white focus:outline-teal-700 min-h-[42px]"
          />
        </div>

        <div>
          <label className="text-[11px] font-bold text-slate-600 block mb-1">
            Titre officiel du document :
          </label>
          <input
            type="text"
            value={documentTitle}
            onChange={(e) => setDocumentTitle(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-slate-50 focus:bg-white focus:outline-teal-700 min-h-[42px]"
          />
        </div>

        <div>
          <label className="text-[11px] font-bold text-slate-600 block mb-1">
            Téléphone / Adresse / Contact en sous-titre (optionnel) :
          </label>
          <input
            type="text"
            placeholder="Ex : Kinshasa / Gombe - Tél : +243 81 000 0000"
            value={headerContact}
            onChange={(e) => setHeaderContact(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-slate-50 focus:bg-white focus:outline-teal-700 min-h-[42px]"
          />
        </div>
      </div>

      {/* 5. NOTE LIBRE EN BAS */}
      <div className="space-y-1.5 pt-1 border-t border-slate-100">
        <label className="text-xs font-bold text-slate-800 block">
          Note libre en bas de page (multi-ligne)
        </label>
        <p className="text-[10px] text-slate-400">
          Message de remerciement, conditions de validation ou mentions spécifiques.
        </p>
        <textarea
          rows={2}
          placeholder="Ex : Merci pour votre dévouement ce mois-ci. Bon pour accord des deux parties."
          value={footerNote}
          onChange={(e) => setFooterNote(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 bg-slate-50 focus:bg-white focus:outline-teal-700 resize-none"
        />
      </div>

      {/* 6. COLONNES & ÉLÉMENTS VISIBLES */}
      <div className="space-y-2 pt-1 border-t border-slate-100">
        <label className="text-xs font-bold text-slate-800 block">
          Affichage des colonnes & éléments sur la fiche
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <label className="flex items-center gap-2 p-2 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={showDeliveryCol}
              onChange={(e) => setShowDeliveryCol(e.target.checked)}
              className="accent-teal-700 w-4 h-4 rounded"
            />
            <span className="font-semibold text-slate-700">Colonne Livraison</span>
          </label>

          <label className="flex items-center gap-2 p-2 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={showDamagedCol}
              onChange={(e) => setShowDamagedCol(e.target.checked)}
              className="accent-teal-700 w-4 h-4 rounded"
            />
            <span className="font-semibold text-slate-700">Colonne Abîmé</span>
          </label>

          <label className="flex items-center gap-2 p-2 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={showEmployeePhone}
              onChange={(e) => setShowEmployeePhone(e.target.checked)}
              className="accent-teal-700 w-4 h-4 rounded"
            />
            <span className="font-semibold text-slate-700">Téléphone du/de la vendeur(se)</span>
          </label>

          <label className="flex items-center gap-2 p-2 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={showCommissionRate}
              onChange={(e) => setShowCommissionRate(e.target.checked)}
              className="accent-teal-700 w-4 h-4 rounded"
            />
            <span className="font-semibold text-slate-700">Taux de commission %</span>
          </label>

          <label className="flex items-center gap-2 p-2 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer sm:col-span-2">
            <input
              type="checkbox"
              checked={showSignatureZones}
              onChange={(e) => setShowSignatureZones(e.target.checked)}
              className="accent-teal-700 w-4 h-4 rounded"
            />
            <span className="font-semibold text-slate-700">Zones de signatures (Vendeur(se) & Gérant)</span>
          </label>
        </div>
      </div>

      {/* 7. TEXTES DES SIGNATURES */}
      {showSignatureZones && (
        <div className="space-y-2 pt-1 border-t border-slate-100">
          <label className="text-xs font-bold text-slate-800 block">
            Textes personnalisés des signatures
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <span className="font-bold text-slate-700 block">Zone Vendeur(se) :</span>
              <input
                type="text"
                value={employeeSignatureLabel}
                onChange={(e) => setEmployeeSignatureLabel(e.target.value)}
                placeholder="Signature du/de la vendeur(se)"
                className="w-full px-2 py-1 rounded-lg border border-slate-200 text-xs font-medium bg-white"
              />
              <input
                type="text"
                value={employeeSignatureSubtext}
                onChange={(e) => setEmployeeSignatureSubtext(e.target.value)}
                placeholder='(Précédé de la mention "Bon pour accord")'
                className="w-full px-2 py-1 rounded-lg border border-slate-200 text-[11px] text-slate-500 bg-white"
              />
            </div>

            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <span className="font-bold text-slate-700 block">Zone Gérant / Propriétaire :</span>
              <input
                type="text"
                value={ownerSignatureLabel}
                onChange={(e) => setOwnerSignatureLabel(e.target.value)}
                placeholder="Signature du gérant / propriétaire"
                className="w-full px-2 py-1 rounded-lg border border-slate-200 text-xs font-medium bg-white"
              />
              <input
                type="text"
                value={ownerSignatureSubtext}
                onChange={(e) => setOwnerSignatureSubtext(e.target.value)}
                placeholder='(Précédé de la mention "Payé / Validé")'
                className="w-full px-2 py-1 rounded-lg border border-slate-200 text-[11px] text-slate-500 bg-white"
              />
            </div>
          </div>
        </div>
      )}

      {/* 8. BOUTONS D'ACTION */}
      <div className="pt-2 border-t border-slate-100 space-y-2">
        <div className="flex items-center gap-2">
          {/* Aperçu PDF */}
          <button
            type="button"
            disabled={isPreviewing}
            onClick={handlePreviewPDF}
            className="flex-1 py-3 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-all min-h-[46px]"
          >
            <Eye className="w-4 h-4 text-teal-400" />
            <span>{isPreviewing ? 'Génération...' : 'Aperçu de la fiche'}</span>
          </button>

          {/* Rétablir par défaut */}
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

        {/* Enregistrer les paramètres de fiche */}
        <button
          type="button"
          disabled={isSaving}
          onClick={handleSave}
          className="w-full py-3 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs font-bold shadow-xs flex items-center justify-center gap-1.5 active:scale-95 transition-all min-h-[46px]"
        >
          <Check className="w-4 h-4" />
          <span>{isSaving ? 'Enregistrement...' : 'Enregistrer les réglages de la fiche de paie'}</span>
        </button>
      </div>
    </div>
  );
};
