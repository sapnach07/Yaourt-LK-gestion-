import React, { useState, useEffect } from 'react';
import {
  Cloud,
  RefreshCw,
  ArrowLeft,
  X,
  FileJson,
  Calendar,
  Users,
  ClipboardList,
  Wallet,
  Upload,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
} from 'lucide-react';
import {
  listDriveBackups,
  downloadDriveBackupContent,
  formatDriveFileSize,
  formatIsoDateTimeFr,
  isDriveAuthError,
  type DriveBackupFileEntry,
  type DriveBackupMonthGroup,
} from '../../utils/driveBackup';
import { restoreDataFromJSON, type BackupSummaryInfo } from '../../utils/exportImport';
import { formatMonthName } from '../../utils/formatters';
import { ConfirmModal } from '../../components/ConfirmModal';

interface DriveBackupsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRestored: (message: string) => Promise<void> | void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
}

export const DriveBackupsModal: React.FC<DriveBackupsModalProps> = ({
  isOpen,
  onClose,
  onRestored,
  onShowToast,
}) => {
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [latestFile, setLatestFile] = useState<DriveBackupFileEntry | null>(null);
  const [monthGroups, setMonthGroups] = useState<DriveBackupMonthGroup[]>([]);

  // Détail / résumé d'un fichier sélectionné
  const [selectedFile, setSelectedFile] = useState<DriveBackupFileEntry | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [downloadedJson, setDownloadedJson] = useState<string | null>(null);
  const [fileSummary, setFileSummary] = useState<BackupSummaryInfo | null>(null);

  // Choix Fusionner / Remplacer + Confirmation PIN ou SUPPRIMER
  const [isModeModalOpen, setIsModeModalOpen] = useState(false);
  const [pendingMode, setPendingMode] = useState<'merge' | 'replace' | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedFile(null);
      setDownloadedJson(null);
      setFileSummary(null);
      setFileError(null);
      setIsModeModalOpen(false);
      setPendingMode(null);
      void loadBackups(false);
    }
  }, [isOpen]);

  const loadBackups = async (forceSelectAccount = false) => {
    setIsLoadingList(true);
    setListError(null);
    try {
      const res = await listDriveBackups({ forceSelectAccount });
      setLatestFile(res.latestFile);
      setMonthGroups(res.monthGroups);
    } catch (err: any) {
      setListError(err?.message || 'Impossible de charger les sauvegardes Google Drive.');
    } finally {
      setIsLoadingList(false);
    }
  };

  const handleSelectFile = async (file: DriveBackupFileEntry) => {
    setSelectedFile(file);
    setDownloadedJson(null);
    setFileSummary(null);
    setFileError(null);
    setIsLoadingFile(true);

    try {
      const { rawJson, summary } = await downloadDriveBackupContent(file.id);
      setDownloadedJson(rawJson);
      setFileSummary(summary);
    } catch (err: any) {
      setFileError(err?.message || 'Erreur lors du téléchargement de cette sauvegarde.');
    } finally {
      setIsLoadingFile(false);
    }
  };

  const handleConfirmSecurityRestore = async () => {
    if (!downloadedJson || !pendingMode) return;
    const modeToApply = pendingMode;
    setPendingMode(null);
    setIsRestoring(true);

    try {
      const res = await restoreDataFromJSON(downloadedJson, modeToApply);
      if (res.success) {
        await onRestored(res.message);
        onClose();
      } else {
        onShowToast('error', res.message);
      }
    } finally {
      setIsRestoring(false);
    }
  };

  if (!isOpen) return null;

  const totalArchivesCount = monthGroups.reduce((acc, g) => acc + g.files.length, 0);
  const hasAnyBackup = Boolean(latestFile) || totalArchivesCount > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex flex-col bg-slate-50 animate-in fade-in duration-150"
    >
      {/* Top Bar */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-2 shadow-2xs shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => {
              if (selectedFile) {
                setSelectedFile(null);
                setDownloadedJson(null);
                setFileSummary(null);
                setFileError(null);
              } else {
                onClose();
              }
            }}
            className="p-2 -ml-1 rounded-xl text-slate-600 hover:bg-slate-100 active:scale-95 transition-all min-h-[40px] min-w-[40px] flex items-center justify-center"
            aria-label="Retour"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h2 className="text-sm font-extrabold text-slate-900 truncate">
              {selectedFile ? 'Résumé de la sauvegarde' : 'Mes sauvegardes Drive'}
            </h2>
            <p className="text-[11px] text-slate-500 truncate">
              {selectedFile
                ? selectedFile.name
                : 'Dossier « Sauvegardes Yaourt Gestion »'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!selectedFile && (
            <button
              type="button"
              disabled={isLoadingList}
              onClick={() => loadBackups(false)}
              className="p-2 rounded-xl text-teal-700 hover:bg-teal-50 disabled:opacity-50 min-h-[40px] min-w-[40px] flex items-center justify-center"
              title="Actualiser"
              aria-label="Actualiser"
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingList ? 'animate-spin' : ''}`} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 min-h-[40px] min-w-[40px] flex items-center justify-center"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-4 max-w-lg w-full mx-auto space-y-4 pb-10">
        {selectedFile ? (
          /* ============================================================= */
          /* VUE DÉTAIL & RÉSUMÉ D'UN FICHIER SÉLECTIONNÉ                  */
          /* ============================================================= */
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-200/70 flex items-center justify-center shrink-0">
                  <FileJson className="w-5 h-5 text-teal-700" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-extrabold text-slate-900 block break-all">
                    {selectedFile.name}
                  </span>
                  <span className="text-[11px] text-slate-500 block mt-0.5">
                    {selectedFile.displayDate} à {selectedFile.displayTime} ·{' '}
                    {formatDriveFileSize(selectedFile.sizeBytes)}
                  </span>
                </div>
              </div>

              {isLoadingFile && (
                <div className="py-8 text-center space-y-2">
                  <RefreshCw className="w-6 h-6 text-teal-700 animate-spin mx-auto" />
                  <p className="text-xs font-semibold text-slate-600">
                    Lecture du contenu depuis Google Drive...
                  </p>
                </div>
              )}

              {fileError && !isLoadingFile && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 space-y-2.5">
                  <div className="flex items-start gap-2 text-rose-800 text-xs font-semibold">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                    <span>{fileError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSelectFile(selectedFile)}
                    className="w-full py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold min-h-[38px]"
                  >
                    Réessayer
                  </button>
                </div>
              )}

              {fileSummary && !isLoadingFile && (
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-600 flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 text-teal-700" />
                      <span>Date de la sauvegarde</span>
                    </span>
                    <span className="font-extrabold text-slate-900 font-mono">
                      {fileSummary.exportDate
                        ? formatIsoDateTimeFr(fileSummary.exportDate)
                        : `${selectedFile.displayDate} à ${selectedFile.displayTime}`}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-center space-y-1">
                      <Users className="w-4 h-4 text-teal-700 mx-auto" />
                      <span className="text-base font-extrabold text-slate-900 font-mono block">
                        {fileSummary.employeesCount}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500 block">
                        Vendeur(se){fileSummary.employeesCount > 1 ? 's' : ''}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-center space-y-1">
                      <ClipboardList className="w-4 h-4 text-teal-700 mx-auto" />
                      <span className="text-base font-extrabold text-slate-900 font-mono block">
                        {fileSummary.dailyEntriesCount}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500 block">
                        Saisie{fileSummary.dailyEntriesCount > 1 ? 's' : ''}
                      </span>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-center space-y-1">
                      <Wallet className="w-4 h-4 text-teal-700 mx-auto" />
                      <span className="text-base font-extrabold text-slate-900 font-mono block">
                        {fileSummary.expensesCount}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500 block">
                        Dépense{fileSummary.expensesCount > 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isRestoring}
                    onClick={() => setIsModeModalOpen(true)}
                    className="w-full py-3 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-extrabold flex items-center justify-center gap-2 shadow-xs active:scale-[0.99] transition-all min-h-[46px] disabled:opacity-50"
                  >
                    <Upload className="w-4 h-4" />
                    <span>{isRestoring ? 'Restauration en cours...' : 'Restaurer'}</span>
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setSelectedFile(null);
                setDownloadedJson(null);
                setFileSummary(null);
                setFileError(null);
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 min-h-[42px]"
            >
              Retour à la liste des sauvegardes
            </button>
          </div>
        ) : (
          /* ============================================================= */
          /* VUE LISTE DES SAUVEGARDES DRIVE                               */
          /* ============================================================= */
          <>
            {isLoadingList && (
              <div className="bg-white rounded-2xl border border-slate-200/80 p-8 text-center space-y-2.5 shadow-2xs">
                <RefreshCw className="w-6 h-6 text-teal-700 animate-spin mx-auto" />
                <p className="text-xs font-bold text-slate-700">
                  Chargement des sauvegardes depuis Google Drive...
                </p>
              </div>
            )}

            {listError && !isLoadingList && (
              <div className="bg-white rounded-2xl border border-rose-200 p-4 shadow-xs space-y-3">
                <div className="flex items-start gap-2.5 text-rose-800">
                  <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div className="text-xs space-y-1">
                    <span className="font-extrabold block">Accès Google Drive impossible</span>
                    <p className="text-rose-700 leading-relaxed">{listError}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => loadBackups(isDriveAuthError(listError))}
                  className="w-full py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold min-h-[42px]"
                >
                  {isDriveAuthError(listError) ? 'Se reconnecter' : 'Réessayer'}
                </button>
              </div>
            )}

            {!isLoadingList && !listError && !hasAnyBackup && (
              <div className="bg-white rounded-2xl border border-slate-200/80 p-8 text-center space-y-2 shadow-2xs">
                <Cloud className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-xs font-bold text-slate-700">
                  Aucune sauvegarde trouvée dans Google Drive
                </p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Appuyez sur « Sauvegarder maintenant » dans Paramètres &gt; Sauvegarde pour créer
                  votre première sauvegarde dans Google Drive.
                </p>
              </div>
            )}

            {!isLoadingList && !listError && hasAnyBackup && (
              <div className="space-y-4">
                {/* 00_DERNIERE_SAUVEGARDE en haut */}
                {latestFile && (
                  <div className="space-y-1.5">
                    <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-teal-800 px-1">
                      Dernière sauvegarde rapide
                    </h3>
                    <button
                      type="button"
                      onClick={() => handleSelectFile(latestFile)}
                      className="w-full p-3.5 rounded-2xl bg-teal-50/80 hover:bg-teal-100/70 active:scale-[0.99] border border-teal-300/80 shadow-xs flex items-center justify-between gap-3 text-left transition-all"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-teal-700 text-white flex items-center justify-center shrink-0">
                          <CheckCircle2 className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <span className="text-xs font-extrabold text-teal-950 block truncate font-mono">
                            00_DERNIERE_SAUVEGARDE
                          </span>
                          <span className="text-[11px] font-semibold text-teal-800 block mt-0.5">
                            {latestFile.displayDate} · {latestFile.displayTime} ·{' '}
                            {formatDriveFileSize(latestFile.sizeBytes)}
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-teal-800 shrink-0" />
                    </button>
                  </div>
                )}

                {/* Dossiers mensuels du plus récent au plus ancien */}
                {monthGroups.map((group) => {
                  const monthTitle =
                    /^\d{4}-\d{2}$/.test(group.monthKey)
                      ? `${formatMonthName(group.monthKey)} (${group.monthKey})`
                      : group.monthKey;

                  return (
                    <div key={group.monthKey} className="space-y-1.5">
                      <div className="flex items-center justify-between px-1">
                        <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                          {monthTitle}
                        </h3>
                        <span className="text-[11px] font-bold text-slate-400">
                          {group.files.length} fichier{group.files.length > 1 ? 's' : ''}
                        </span>
                      </div>

                      <div className="bg-white rounded-2xl border border-slate-200/90 divide-y divide-slate-100 overflow-hidden shadow-2xs">
                        {group.files.map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => handleSelectFile(f)}
                            className="w-full p-3.5 hover:bg-slate-50 active:bg-slate-100 flex items-center justify-between gap-3 text-left transition-colors"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-extrabold text-slate-900">
                                  {f.displayDate} à {f.displayTime}
                                </span>
                                <span className="px-2 py-0.5 rounded-md bg-slate-100 text-[10px] font-bold text-slate-600 font-mono">
                                  {formatDriveFileSize(f.sizeBytes)}
                                </span>
                              </div>
                              <span className="text-[11px] text-slate-400 font-mono block truncate mt-0.5">
                                {f.name}
                              </span>
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Modale de choix Fusionner / Remplacer */}
      {isModeModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[55] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in"
        >
          <div className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl border border-slate-100 space-y-4">
            <div className="flex items-center gap-2 text-teal-800">
              <Upload className="w-5 h-5 text-teal-700" />
              <h3 className="text-base font-bold text-slate-900">Mode de Restauration</h3>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Comment souhaitez-vous restaurer cette sauvegarde depuis Google Drive ?
            </p>

            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setIsModeModalOpen(false);
                  setPendingMode('merge');
                }}
                className="w-full text-left p-3 rounded-2xl border border-teal-200 bg-teal-50/70 hover:bg-teal-100 transition-all min-h-[44px]"
              >
                <span className="text-xs font-bold text-teal-900 block">
                  1. Fusionner avec les données actuelles
                </span>
                <span className="text-[11px] text-teal-700">
                  Conserve vos données existantes et ajoute les nouveaux enregistrements.
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsModeModalOpen(false);
                  setPendingMode('replace');
                }}
                className="w-full text-left p-3 rounded-2xl border border-rose-200 bg-rose-50/70 hover:bg-rose-100 transition-all min-h-[44px]"
              >
                <span className="text-xs font-bold text-rose-900 block">
                  2. Remplacer totalement
                </span>
                <span className="text-[11px] text-rose-700">
                  Efface les données actuelles pour restaurer exactement le fichier de sauvegarde.
                </span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setIsModeModalOpen(false)}
              className="w-full py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 min-h-[44px]"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Même confirmation de sécurité (PIN ou mot SUPPRIMER) */}
      <ConfirmModal
        isOpen={pendingMode !== null}
        title={
          pendingMode === 'replace'
            ? 'Remplacer toutes les données ?'
            : 'Fusionner cette sauvegarde Drive ?'
        }
        message={
          pendingMode === 'replace'
            ? 'Efface les données actuelles pour restaurer exactement le fichier sélectionné depuis Google Drive. Cette action est irréversible.'
            : 'Les données de cette sauvegarde Google Drive seront fusionnées avec vos données actuelles.'
        }
        confirmLabel={
          pendingMode === 'replace' ? 'Remplacer totalement' : 'Confirmer la fusion'
        }
        cancelLabel="Annuler"
        isDanger={true}
        onConfirm={handleConfirmSecurityRestore}
        onCancel={() => setPendingMode(null)}
      />
    </div>
  );
};
