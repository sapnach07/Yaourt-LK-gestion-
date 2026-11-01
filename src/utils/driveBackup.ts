import { useEffect, useState } from 'react';
import { db, DEFAULT_SETTINGS } from '../db/db';
import { buildBackupJSON, parseBackupSummary, type BackupData, type BackupSummaryInfo } from './exportImport';
import type { AppSettings, DriveBackupSettings } from '../types';

export const GOOGLE_CLIENT_ID =
  '813774193368-b162uju190rc8t3k32f5lp8fp2se5od9.apps.googleusercontent.com';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';

export const ROOT_FOLDER_NAME = 'Sauvegardes Yaourt Gestion';
export const LATEST_BACKUP_FILENAME = '00_DERNIERE_SAUVEGARDE.json';
export const AUTH_RENEWAL_PREFIX = 'Connexion Google à renouveler';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GoogleTokenClientError {
  type?: string;
  message?: string;
}

interface GoogleTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

interface GoogleOAuth2Namespace {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    prompt?: string;
    callback: (response: GoogleTokenResponse) => void;
    error_callback?: (error: GoogleTokenClientError) => void;
  }) => GoogleTokenClient;
  revoke?: (token: string, done?: () => void) => void;
}

interface WindowWithGoogle extends Window {
  google?: {
    accounts?: {
      oauth2?: GoogleOAuth2Namespace;
    };
  };
}

export type DriveErrorKind =
  | 'OFFLINE'
  | 'AUTH_REQUIRED'
  | 'USER_CANCELLED'
  | 'FOLDER_NOT_FOUND'
  | 'QUOTA_EXCEEDED'
  | 'TRANSIENT'
  | 'UNKNOWN';

export class DriveBackupError extends Error {
  kind: DriveErrorKind;
  retryable: boolean;

  constructor(kind: DriveErrorKind, message: string, retryable = false) {
    super(message);
    this.name = 'DriveBackupError';
    this.kind = kind;
    this.retryable = retryable;
  }
}

export function isDriveAuthError(lastError?: string | null): boolean {
  if (!lastError) return false;
  return lastError.startsWith(AUTH_RENEWAL_PREFIX);
}

// ============================================================================
// JETON OAUTH STRICTEMENT EN MÉMOIRE (JAMAIS PERSISTÉ EN BASE OU LOCALSTORAGE)
// ============================================================================
let inMemoryAccessToken: string | null = null;
let inMemoryTokenExpiresAt = 0;
let gsiLoadPromise: Promise<GoogleOAuth2Namespace> | null = null;

function hasValidInMemoryToken(): boolean {
  return Boolean(inMemoryAccessToken && Date.now() < inMemoryTokenExpiresAt - 45_000);
}

function isBrowserOnline(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.onLine !== false;
}

/**
 * Charge https://accounts.google.com/gsi/client uniquement à la demande
 * et seulement s'il y a internet (jamais au démarrage).
 */
async function loadGsiScript(): Promise<GoogleOAuth2Namespace> {
  if (!isBrowserOnline()) {
    throw new DriveBackupError(
      'OFFLINE',
      'Pas d’internet — vérifiez votre connexion réseau.',
      false
    );
  }

  const win = window as WindowWithGoogle;
  if (win.google?.accounts?.oauth2) {
    return win.google.accounts.oauth2;
  }

  if (gsiLoadPromise) {
    return gsiLoadPromise;
  }

  gsiLoadPromise = new Promise<GoogleOAuth2Namespace>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${GSI_SCRIPT_SRC}"]`
    );

    const script = existingScript || document.createElement('script');
    let settled = false;

    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      gsiLoadPromise = null;
      if (!existingScript && script.parentNode) {
        script.parentNode.removeChild(script);
      }
      reject(
        new DriveBackupError(
          'TRANSIENT',
          'Délai dépassé lors du chargement du service Google.',
          true
        )
      );
    }, 15_000);

    const handleLoad = () => {
      if (settled) return;
      window.clearTimeout(timeoutId);
      const oauth2 = (window as WindowWithGoogle).google?.accounts?.oauth2;
      if (oauth2) {
        settled = true;
        resolve(oauth2);
      } else {
        settled = true;
        gsiLoadPromise = null;
        reject(
          new DriveBackupError(
            'TRANSIENT',
            'Service d’authentification Google indisponible.',
            true
          )
        );
      }
    };

    const handleError = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      gsiLoadPromise = null;
      if (!existingScript && script.parentNode) {
        script.parentNode.removeChild(script);
      }
      reject(
        new DriveBackupError(
          isBrowserOnline() ? 'TRANSIENT' : 'OFFLINE',
          isBrowserOnline()
            ? 'Impossible de joindre Google (connexion instable).'
            : 'Pas d’internet — vérifiez votre connexion réseau.',
          isBrowserOnline()
        )
      );
    };

    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });

    if (!existingScript) {
      script.src = GSI_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    } else if ((window as WindowWithGoogle).google?.accounts?.oauth2) {
      handleLoad();
    }
  });

  return gsiLoadPromise;
}

/**
 * Demande un jeton d'accès OAuth2 :
 * - Réutilise le jeton en mémoire s'il est encore valide
 * - Essaie en silencieux (prompt: '') pour un renouvellement
 * - Ne sollicite l'utilisateur que si Google l'exige
 */
async function ensureAccessToken(options: {
  interactive: boolean;
  forceSelectAccount?: boolean;
}): Promise<string> {
  if (!options.forceSelectAccount && hasValidInMemoryToken()) {
    return inMemoryAccessToken!;
  }

  if (!isBrowserOnline()) {
    throw new DriveBackupError(
      'OFFLINE',
      'Pas d’internet — la sauvegarde reprendra dès le retour de la connexion.',
      false
    );
  }

  const oauth2 = await loadGsiScript();
  const promptMode = options.forceSelectAccount ? 'select_account' : '';
  const timeoutMs = options.interactive ? 90_000 : 20_000;

  return new Promise<string>((resolve, reject) => {
    let settled = false;

    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new DriveBackupError(
          options.interactive ? 'USER_CANCELLED' : 'AUTH_REQUIRED',
          options.interactive
            ? 'Délai d’attente dépassé pour la fenêtre Google.'
            : `${AUTH_RENEWAL_PREFIX} — appuyez sur « Se reconnecter ».`,
          false
        )
      );
    }, timeoutMs);

    try {
      const client = oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: (response) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);

          if (response.error || !response.access_token) {
            const code = response.error || 'unknown';
            if (code === 'access_denied') {
              reject(
                new DriveBackupError(
                  options.interactive ? 'USER_CANCELLED' : 'AUTH_REQUIRED',
                  options.interactive
                    ? 'Autorisation Google Drive refusée ou annulée.'
                    : `${AUTH_RENEWAL_PREFIX} — appuyez sur « Se reconnecter ».`,
                  false
                )
              );
              return;
            }
            reject(
              new DriveBackupError(
                'AUTH_REQUIRED',
                `${AUTH_RENEWAL_PREFIX} — appuyez sur « Se reconnecter ».`,
                false
              )
            );
            return;
          }

          const expiresInSec = Number(response.expires_in) || 3600;
          inMemoryAccessToken = response.access_token;
          inMemoryTokenExpiresAt = Date.now() + expiresInSec * 1000;
          resolve(response.access_token);
        },
        error_callback: (err) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);

          if (err?.type === 'popup_closed') {
            reject(
              new DriveBackupError(
                options.interactive ? 'USER_CANCELLED' : 'AUTH_REQUIRED',
                options.interactive
                  ? 'Fenêtre Google fermée avant la fin de la connexion.'
                  : `${AUTH_RENEWAL_PREFIX} — appuyez sur « Se reconnecter ».`,
                false
              )
            );
            return;
          }

          if (err?.type === 'popup_failed_to_open') {
            reject(
              new DriveBackupError(
                'AUTH_REQUIRED',
                options.interactive
                  ? 'La fenêtre Google a été bloquée par le navigateur. Réessayez.'
                  : `${AUTH_RENEWAL_PREFIX} — appuyez sur « Se reconnecter ».`,
                false
              )
            );
            return;
          }

          reject(
            new DriveBackupError(
              'AUTH_REQUIRED',
              `${AUTH_RENEWAL_PREFIX} — appuyez sur « Se reconnecter ».`,
              false
            )
          );
        },
      });

      client.requestAccessToken({ prompt: promptMode });
    } catch (e: any) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(
        new DriveBackupError(
          'AUTH_REQUIRED',
          `${AUTH_RENEWAL_PREFIX} — ${e?.message || 'erreur d’initialisation Google.'}`,
          false
        )
      );
    }
  });
}

// ============================================================================
// ÉTAT RÉACTIF EN COURS D'EXÉCUTION & ÉVÉNEMENTS DE SUCCÈS
// ============================================================================
let isDriveBusyFlag = false;
const busyListeners = new Set<(busy: boolean) => void>();
const successListeners = new Set<() => void>();

function setDriveBusy(busy: boolean) {
  isDriveBusyFlag = busy;
  for (const fn of busyListeners) {
    fn(busy);
  }
}

export function subscribeDriveBackupSuccess(listener: () => void): () => void {
  successListeners.add(listener);
  return () => {
    successListeners.delete(listener);
  };
}

function notifyDriveBackupSuccess() {
  for (const fn of successListeners) {
    fn();
  }
}

export function useDriveBusy(): boolean {
  const [busy, setBusy] = useState(isDriveBusyFlag);
  useEffect(() => {
    const handler = (next: boolean) => setBusy(next);
    busyListeners.add(handler);
    return () => {
      busyListeners.delete(handler);
    };
  }, []);
  return busy;
}

// ============================================================================
// MISE À JOUR INTERNE DE settings.driveBackup SANS REDÉCLENCHER LE MINUTEUR
// ============================================================================
let internalSettingsWriteDepth = 0;

export function isInternalDriveSettingsWrite(): boolean {
  return internalSettingsWriteDepth > 0;
}

export async function updateDriveBackupSettings(
  patch: Partial<DriveBackupSettings>
): Promise<AppSettings> {
  internalSettingsWriteDepth += 1;
  try {
    const current = (await db.settings.get('app_settings')) || DEFAULT_SETTINGS;
    const prevDrive: DriveBackupSettings = current.driveBackup || {
      connected: false,
      autoEnabled: true,
    };
    const nextDrive: DriveBackupSettings = {
      ...prevDrive,
      autoEnabled: prevDrive.autoEnabled ?? true,
      ...patch,
    };
    const updated: AppSettings = {
      ...current,
      driveBackup: nextDrive,
    };
    await db.settings.put(updated);
    return updated;
  } finally {
    internalSettingsWriteDepth = Math.max(0, internalSettingsWriteDepth - 1);
  }
}

// ============================================================================
// EMPREINTE SHA-256 DÉTERMINISTE DU CONTENU MÉTIER
// ============================================================================
function canonicalizeValue(val: unknown): unknown {
  if (val === null || val === undefined || typeof val !== 'object') {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(canonicalizeValue);
  }
  const obj = val as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    if (obj[k] !== undefined) {
      out[k] = canonicalizeValue(obj[k]);
    }
  }
  return out;
}

function sortByIdIfPossible(arr: unknown[] | undefined): unknown[] {
  if (!Array.isArray(arr)) return [];
  return [...arr]
    .sort((a: any, b: any) => String(a?.id ?? '').localeCompare(String(b?.id ?? '')))
    .map(canonicalizeValue);
}

export async function computeBackupContentHash(backup: BackupData): Promise<string> {
  const { lastBackupDate: _volatileBackupDate, ...stableSettings } = backup.settings || ({} as any);
  const canonicalPayload = {
    version: backup.version,
    businessName: backup.businessName,
    employees: sortByIdIfPossible(backup.employees),
    products: sortByIdIfPossible(backup.products),
    dailyEntries: sortByIdIfPossible(backup.dailyEntries),
    productionEntries: sortByIdIfPossible(backup.productionEntries),
    expenses: sortByIdIfPossible(backup.expenses),
    reserveMovements: sortByIdIfPossible(backup.reserveMovements),
    payments: sortByIdIfPossible(backup.payments),
    personalSales: sortByIdIfPossible(backup.personalSales),
    customers: sortByIdIfPossible(backup.customers),
    debtPayments: sortByIdIfPossible(backup.debtPayments),
    stockAdjustments: sortByIdIfPossible(backup.stockAdjustments),
    trash: sortByIdIfPossible(backup.trash),
    settings: canonicalizeValue(stableSettings),
  };

  const rawText = JSON.stringify(canonicalPayload);
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(rawText);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Fallback hors WebCrypto (très rare)
  let h = 2166136261;
  for (let i = 0; i < rawText.length; i++) {
    h ^= rawText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv1a_${(h >>> 0).toString(16)}_${rawText.length}`;
}

async function hasAnyLocalBusinessData(): Promise<boolean> {
  const counts = await Promise.all([
    db.dailyEntries.count(),
    db.productionEntries.count(),
    db.expenses.count(),
    db.payments.count(),
    db.personalSales.count(),
    db.employees.count(),
    db.customers.count(),
  ]);
  return counts.some((c) => c > 0);
}

// ============================================================================
// REQUÊTES GOOGLE DRIVE REST API v3 AVEC FETCH
// ============================================================================
function escapeDriveQuery(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function driveFetch(
  url: string,
  token: string,
  init: RequestInit = {}
): Promise<Response> {
  if (!isBrowserOnline()) {
    throw new DriveBackupError(
      'OFFLINE',
      'Pas d’internet — la sauvegarde reprendra dès le retour de la connexion.',
      false
    );
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
    });
  } catch {
    throw new DriveBackupError(
      isBrowserOnline() ? 'TRANSIENT' : 'OFFLINE',
      isBrowserOnline()
        ? 'Connexion réseau interrompue pendant l’accès à Google Drive.'
        : 'Pas d’internet — vérifiez votre connexion réseau.',
      isBrowserOnline()
    );
  }

  if (res.ok) {
    return res;
  }

  if (res.status === 401) {
    inMemoryAccessToken = null;
    inMemoryTokenExpiresAt = 0;
    throw new DriveBackupError(
      'AUTH_REQUIRED',
      `${AUTH_RENEWAL_PREFIX} — votre session Google a expiré.`,
      false
    );
  }

  let errorReason = '';
  let errorMessage = '';
  try {
    const errJson = await res.json();
    errorReason = errJson?.error?.errors?.[0]?.reason || '';
    errorMessage = errJson?.error?.message || '';
  } catch {
    // ignore JSON parse failure
  }

  if (res.status === 404) {
    throw new DriveBackupError(
      'FOLDER_NOT_FOUND',
      'Dossier ou fichier introuvable dans Google Drive.',
      false
    );
  }

  if (res.status === 403) {
    if (errorReason === 'storageQuotaExceeded') {
      throw new DriveBackupError(
        'QUOTA_EXCEEDED',
        'Espace de stockage Google Drive plein.',
        false
      );
    }
    if (
      errorReason === 'rateLimitExceeded' ||
      errorReason === 'userRateLimitExceeded' ||
      errorReason === 'sharingRateLimitExceeded'
    ) {
      throw new DriveBackupError(
        'TRANSIENT',
        'Limite temporaire Google Drive atteinte — nouvelle tentative...',
        true
      );
    }
    inMemoryAccessToken = null;
    inMemoryTokenExpiresAt = 0;
    throw new DriveBackupError(
      'AUTH_REQUIRED',
      `${AUTH_RENEWAL_PREFIX} — autorisation Google Drive requise.`,
      false
    );
  }

  if (res.status === 429 || res.status >= 500) {
    throw new DriveBackupError(
      'TRANSIENT',
      `Erreur temporaire Google Drive (${res.status}).`,
      true
    );
  }

  throw new DriveBackupError(
    'UNKNOWN',
    errorMessage
      ? `Erreur Google Drive : ${errorMessage}`
      : `Erreur Google Drive (code ${res.status}).`,
    false
  );
}

interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType?: string;
  trashed?: boolean;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
  parents?: string[];
}

async function findNonTrashedFoldersByName(
  token: string,
  folderName: string,
  parentId?: string
): Promise<DriveFileMetadata[]> {
  const parentClause = parentId ? `'${escapeDriveQuery(parentId)}' in parents and ` : '';
  const q = `${parentClause}mimeType = 'application/vnd.google-apps.folder' and name = '${escapeDriveQuery(
    folderName
  )}' and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,createdTime,parents)',
    orderBy: 'createdTime asc',
    spaces: 'drive',
    pageSize: '20',
  });
  const res = await driveFetch(`${DRIVE_FILES_API}?${params.toString()}`, token);
  const data = (await res.json()) as { files?: DriveFileMetadata[] };
  return data.files || [];
}

async function createDriveFolder(
  token: string,
  folderName: string,
  parentId?: string
): Promise<string> {
  const body: Record<string, unknown> = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) {
    body.parents = [parentId];
  }
  const res = await driveFetch(`${DRIVE_FILES_API}?fields=id,name`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
  });
  const created = (await res.json()) as DriveFileMetadata;
  return created.id;
}

/**
 * Trouve ou crée le dossier racine "Sauvegardes Yaourt Gestion" sans jamais créer de doublon.
 */
async function resolveRootFolderId(
  token: string,
  savedFolderId: string | undefined,
  allowCreateIfMissing: boolean
): Promise<string> {
  if (savedFolderId) {
    try {
      const checkRes = await driveFetch(
        `${DRIVE_FILES_API}/${encodeURIComponent(
          savedFolderId
        )}?fields=id,name,mimeType,trashed`,
        token
      );
      const meta = (await checkRes.json()) as DriveFileMetadata;
      if (
        meta &&
        meta.id &&
        !meta.trashed &&
        meta.mimeType === 'application/vnd.google-apps.folder'
      ) {
        return meta.id;
      }
    } catch (err) {
      if (!(err instanceof DriveBackupError && err.kind === 'FOLDER_NOT_FOUND')) {
        throw err;
      }
      // Si 404 sur l'ancien ID, on cherche par nom ci-dessous avant toute décision
    }
  }

  const existingFolders = await findNonTrashedFoldersByName(token, ROOT_FOLDER_NAME);
  if (existingFolders.length > 0) {
    return existingFolders[0].id;
  }

  if (!allowCreateIfMissing) {
    throw new DriveBackupError(
      'FOLDER_NOT_FOUND',
      `Dossier « ${ROOT_FOLDER_NAME} » introuvable dans Google Drive (supprimé ou déplacé dans la corbeille).`,
      false
    );
  }

  return createDriveFolder(token, ROOT_FOLDER_NAME);
}

async function resolveMonthFolderId(
  token: string,
  rootFolderId: string,
  yearMonth: string
): Promise<string> {
  const existing = await findNonTrashedFoldersByName(token, yearMonth, rootFolderId);
  if (existing.length > 0) {
    return existing[0].id;
  }
  return createDriveFolder(token, yearMonth, rootFolderId);
}

async function createJsonFileInFolder(
  token: string,
  fileName: string,
  parentId: string,
  jsonContent: string
): Promise<DriveFileMetadata> {
  const boundary = '-------yaourt_gestion_drive_' + Date.now().toString(36);
  const metadata = {
    name: fileName,
    mimeType: 'application/json',
    parents: [parentId],
  };

  const multipartBody =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    jsonContent +
    `\r\n--${boundary}--`;

  const res = await driveFetch(
    `${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,name,size,modifiedTime`,
    token,
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    }
  );

  return (await res.json()) as DriveFileMetadata;
}

/**
 * Met à jour "00_DERNIERE_SAUVEGARDE.json" à la racine sur le MÊME fichier (sans doublon ni suppression).
 */
async function upsertLatestBackupAtRoot(
  token: string,
  rootFolderId: string,
  jsonContent: string
): Promise<void> {
  const q = `'${escapeDriveQuery(rootFolderId)}' in parents and name = '${escapeDriveQuery(
    LATEST_BACKUP_FILENAME
  )}' and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,modifiedTime)',
    orderBy: 'modifiedTime desc',
    spaces: 'drive',
    pageSize: '5',
  });
  const listRes = await driveFetch(`${DRIVE_FILES_API}?${params.toString()}`, token);
  const listData = (await listRes.json()) as { files?: DriveFileMetadata[] };
  const existing = listData.files?.[0];

  if (existing?.id) {
    try {
      await driveFetch(
        `${DRIVE_UPLOAD_API}/${encodeURIComponent(existing.id)}?uploadType=media&fields=id,name,size,modifiedTime`,
        token,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
          },
          body: jsonContent,
        }
      );
      return;
    } catch (err) {
      if (!(err instanceof DriveBackupError && err.kind === 'FOLDER_NOT_FOUND')) {
        throw err;
      }
      // Si le fichier a disparu entre-temps, on le recrée ci-dessous
    }
  }

  await createJsonFileInFolder(token, LATEST_BACKUP_FILENAME, rootFolderId, jsonContent);
}

function buildArchiveParts(now: Date): { yearMonth: string; archiveFileName: string } {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return {
    yearMonth: `${y}-${m}`,
    archiveFileName: `Yaourt_${y}-${m}-${d}_${hh}h${mm}.json`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// ============================================================================
// EXÉCUTION D'UNE SAUVEGARDE DRIVE (AVEC MAX 2 RÉESSAIS SUR ERREUR TRANSITOIRE)
// ============================================================================
export type BackupTriggerKind = 'manual' | 'startup_auto' | 'change_auto';

export interface DriveBackupRunResult {
  success: boolean;
  skippedUnchanged?: boolean;
  errorMessage?: string;
}

export async function performDriveBackup(options: {
  trigger: BackupTriggerKind;
  forceSelectAccount?: boolean;
}): Promise<DriveBackupRunResult> {
  if (isDriveBusyFlag) {
    return {
      success: false,
      errorMessage: 'Une opération Google Drive est déjà en cours.',
    };
  }

  const isManual = options.trigger === 'manual';
  setDriveBusy(true);

  try {
    const currentSettings = (await db.settings.get('app_settings')) || DEFAULT_SETTINGS;
    const driveCfg = currentSettings.driveBackup;

    // Construire le JSON exact via la fonction d'export existante
    const { backup, json } = await buildBackupJSON({ updateLocalLastBackupDate: false });
    const contentHash = await computeBackupContentHash(backup);

    // En mode automatique après modification, ne jamais sauvegarder si l'empreinte est identique
    if (
      options.trigger === 'change_auto' &&
      driveCfg?.lastContentHash &&
      driveCfg.lastContentHash === contentHash
    ) {
      return { success: true, skippedUnchanged: true };
    }

    const attemptTimestamp = Date.now();
    await updateDriveBackupSettings({
      lastAttemptAt: attemptTimestamp,
    });

    if (!isBrowserOnline()) {
      const msg = 'Pas d’internet — la sauvegarde reprendra dès le retour de la connexion.';
      await updateDriveBackupSettings({
        lastAttemptAt: attemptTimestamp,
        lastError: msg,
      });
      return { success: false, errorMessage: msg };
    }

    // Réessayer au plus 2 fois avec délai croissant (total max = 3 essais)
    const retryDelaysMs = [2000, 6000];
    let lastErr: unknown = null;

    for (let attemptIndex = 0; attemptIndex <= retryDelaysMs.length; attemptIndex++) {
      if (attemptIndex > 0) {
        await sleep(retryDelaysMs[attemptIndex - 1]);
        if (!isBrowserOnline()) {
          lastErr = new DriveBackupError(
            'OFFLINE',
            'Pas d’internet — la sauvegarde reprendra dès le retour de la connexion.',
            false
          );
          break;
        }
      }

      try {
        const token = await ensureAccessToken({
          interactive: isManual && attemptIndex === 0,
          forceSelectAccount: Boolean(options.forceSelectAccount && attemptIndex === 0),
        });

        const latestSettings = (await db.settings.get('app_settings')) || currentSettings;
        const savedFolderId = latestSettings.driveBackup?.folderId;
        // En mode manuel (ou 1re sauvegarde sans folderId), créer le dossier s'il n'existe pas ;
        // en mode automatique, signaler si le dossier enregistré a été supprimé.
        const allowCreateRoot = isManual || !savedFolderId;

        const rootFolderId = await resolveRootFolderId(token, savedFolderId, allowCreateRoot);
        const now = new Date();
        const { yearMonth, archiveFileName } = buildArchiveParts(now);
        const monthFolderId = await resolveMonthFolderId(token, rootFolderId, yearMonth);

        // 1. Créer l'archive horodatée dans AAAA-MM (ne jamais rien supprimer)
        await createJsonFileInFolder(token, archiveFileName, monthFolderId, json);

        // 2. Remplacer le contenu sur le même fichier 00_DERNIERE_SAUVEGARDE.json à la racine
        await upsertLatestBackupAtRoot(token, rootFolderId, json);

        const successAt = Date.now();
        await updateDriveBackupSettings({
          connected: true,
          folderId: rootFolderId,
          lastSuccessAt: successAt,
          lastAttemptAt: successAt,
          lastError: null,
          lastContentHash: contentHash,
          autoEnabled: latestSettings.driveBackup?.autoEnabled ?? true,
        });

        notifyDriveBackupSuccess();
        return { success: true };
      } catch (err) {
        lastErr = err;
        const isRetryable = err instanceof DriveBackupError && err.retryable;
        if (!isRetryable || attemptIndex >= retryDelaysMs.length) {
          break;
        }
      }
    }

    const errorMessage =
      lastErr instanceof DriveBackupError
        ? lastErr.message
        : 'Échec de la sauvegarde Google Drive.';

    // Si l'utilisateur a simplement fermé la popup lors d'un clic manuel alors qu'il n'était pas connecté,
    // ne pas écraser un état déconnecté propre
    const afterSettings = (await db.settings.get('app_settings')) || currentSettings;
    if (afterSettings.driveBackup?.connected) {
      await updateDriveBackupSettings({
        lastAttemptAt: Date.now(),
        lastError: errorMessage,
      });
    }

    return {
      success: false,
      errorMessage,
    };
  } finally {
    setDriveBusy(false);
  }
}

/**
 * Connecte Google Drive à la demande de l'utilisateur :
 * - Ouvre la popup Google Identity Services
 * - Cherche d'abord "Sauvegardes Yaourt Gestion" avant de le créer (zéro doublon)
 * - Si l'application vient d'être réinstallée (base locale vide) et que des sauvegardes
 *   existent déjà dans Drive, n'écrase PAS 00_DERNIERE_SAUVEGARDE.json et invite à restaurer.
 * - Sinon, lance immédiatement la première sauvegarde.
 */
export async function connectGoogleDrive(): Promise<{
  success: boolean;
  existingBackupsPreserved?: boolean;
  errorMessage?: string;
}> {
  if (isDriveBusyFlag) {
    return {
      success: false,
      errorMessage: 'Une opération Google Drive est déjà en cours.',
    };
  }

  if (!isBrowserOnline()) {
    return {
      success: false,
      errorMessage: 'Pas d’internet — connectez-vous à internet pour lier votre Google Drive.',
    };
  }

  setDriveBusy(true);
  let readyForImmediateBackup = false;

  try {
    const token = await ensureAccessToken({
      interactive: true,
      forceSelectAccount: true,
    });

    const existingFolders = await findNonTrashedFoldersByName(token, ROOT_FOLDER_NAME);
    let rootFolderId: string;
    let hasExistingLatestInDrive = false;

    if (existingFolders.length > 0) {
      rootFolderId = existingFolders[0].id;
      const q = `'${escapeDriveQuery(rootFolderId)}' in parents and trashed = false`;
      const params = new URLSearchParams({
        q,
        fields: 'files(id,name)',
        pageSize: '5',
        spaces: 'drive',
      });
      const checkRes = await driveFetch(`${DRIVE_FILES_API}?${params.toString()}`, token);
      const checkData = (await checkRes.json()) as { files?: DriveFileMetadata[] };
      hasExistingLatestInDrive = (checkData.files?.length ?? 0) > 0;
    } else {
      rootFolderId = await createDriveFolder(token, ROOT_FOLDER_NAME);
    }

    const currentSettings = (await db.settings.get('app_settings')) || DEFAULT_SETTINGS;
    await updateDriveBackupSettings({
      connected: true,
      folderId: rootFolderId,
      lastError: null,
      autoEnabled: currentSettings.driveBackup?.autoEnabled ?? true,
    });

    const localHasData = await hasAnyLocalBusinessData();
    if (hasExistingLatestInDrive && !localHasData) {
      return {
        success: true,
        existingBackupsPreserved: true,
      };
    }

    readyForImmediateBackup = true;
  } catch (err) {
    const msg =
      err instanceof DriveBackupError
        ? err.message
        : 'Impossible de connecter Google Drive.';
    return {
      success: false,
      errorMessage: msg,
    };
  } finally {
    setDriveBusy(false);
  }

  if (readyForImmediateBackup) {
    const backupRes = await performDriveBackup({ trigger: 'manual' });
    if (!backupRes.success) {
      return {
        success: false,
        errorMessage: backupRes.errorMessage,
      };
    }
  }

  return { success: true };
}

/**
 * Reconnecte le compte Google (quand la session doit être renouvelée) puis lance la sauvegarde.
 */
export async function reconnectAndBackupDrive(): Promise<DriveBackupRunResult> {
  inMemoryAccessToken = null;
  inMemoryTokenExpiresAt = 0;
  return performDriveBackup({
    trigger: 'manual',
    forceSelectAccount: true,
  });
}

/**
 * Déconnecte Google Drive dans l'application tout en gardant tous les fichiers dans Drive.
 */
export async function disconnectGoogleDrive(): Promise<AppSettings> {
  const tokenToRevoke = inMemoryAccessToken;
  inMemoryAccessToken = null;
  inMemoryTokenExpiresAt = 0;

  if (tokenToRevoke && isBrowserOnline()) {
    try {
      const oauth2 = (window as WindowWithGoogle).google?.accounts?.oauth2;
      oauth2?.revoke?.(tokenToRevoke, () => {});
    } catch {
      // Révocation best-effort sans bloquer la déconnexion locale
    }
  }

  if (debounceTimerId !== null) {
    window.clearTimeout(debounceTimerId);
    debounceTimerId = null;
  }
  pendingOfflineModification = false;

  return updateDriveBackupSettings({
    connected: false,
    lastError: null,
  });
}

// ============================================================================
// LISTE ET TÉLÉCHARGEMENT POUR "MES SAUVEGARDES DRIVE"
// ============================================================================
export interface DriveBackupFileEntry {
  id: string;
  name: string;
  sizeBytes: number | null;
  modifiedTime: string | null;
  displayDate: string;
  displayTime: string;
  sortKey: string;
  monthKey: string; // 'AAAA-MM'
  isLatestRootFile: boolean;
}

export interface DriveBackupMonthGroup {
  monthKey: string; // 'AAAA-MM'
  files: DriveBackupFileEntry[];
}

export interface DriveBackupsListResult {
  latestFile: DriveBackupFileEntry | null;
  monthGroups: DriveBackupMonthGroup[];
}

function parseArchiveNameInfo(
  name: string,
  modifiedTime?: string
): { displayDate: string; displayTime: string; monthKey: string; sortKey: string } {
  // Format attendu : Yaourt_AAAA-MM-JJ_HHhMM.json
  const match = /^Yaourt_(\d{4})-(\d{2})-(\d{2})_(\d{2})h(\d{2})\.json$/i.exec(name.trim());
  if (match) {
    const [, yyyy, mm, dd, hh, min] = match;
    return {
      displayDate: `${dd}/${mm}/${yyyy}`,
      displayTime: `${hh}:${min}`,
      monthKey: `${yyyy}-${mm}`,
      sortKey: `${yyyy}-${mm}-${dd}T${hh}:${min}:00`,
    };
  }

  if (modifiedTime) {
    const dt = new Date(modifiedTime);
    if (!isNaN(dt.getTime())) {
      const yyyy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      const hh = String(dt.getHours()).padStart(2, '0');
      const min = String(dt.getMinutes()).padStart(2, '0');
      return {
        displayDate: `${dd}/${mm}/${yyyy}`,
        displayTime: `${hh}:${min}`,
        monthKey: `${yyyy}-${mm}`,
        sortKey: dt.toISOString(),
      };
    }
  }

  return {
    displayDate: '—',
    displayTime: '—',
    monthKey: 'Autres',
    sortKey: name,
  };
}

async function fetchAllPages(
  token: string,
  q: string,
  fields: string
): Promise<DriveFileMetadata[]> {
  const all: DriveFileMetadata[] = [];
  let pageToken: string | undefined = undefined;

  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({
      q,
      fields: `nextPageToken,files(${fields})`,
      spaces: 'drive',
      pageSize: '500',
    });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }
    const res = await driveFetch(`${DRIVE_FILES_API}?${params.toString()}`, token);
    const data = (await res.json()) as {
      nextPageToken?: string;
      files?: DriveFileMetadata[];
    };
    if (data.files?.length) {
      all.push(...data.files);
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return all;
}

/**
 * Liste toutes les sauvegardes créées par l'application dans Google Drive.
 * Fonctionne aussi après réinstallation de l'app (même GOOGLE_CLIENT_ID + drive.file).
 */
export async function listDriveBackups(options?: {
  forceSelectAccount?: boolean;
}): Promise<DriveBackupsListResult> {
  const token = await ensureAccessToken({
    interactive: true,
    forceSelectAccount: options?.forceSelectAccount,
  });

  const [allFolders, allJsonFiles] = await Promise.all([
    fetchAllPages(
      token,
      "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      'id,name,parents,createdTime'
    ),
    fetchAllPages(
      token,
      "(mimeType = 'application/json' or name contains '.json') and trashed = false",
      'id,name,size,createdTime,modifiedTime,parents'
    ),
  ]);

  const rootFolders = allFolders
    .filter((f) => f.name === ROOT_FOLDER_NAME)
    .sort((a, b) => String(a.createdTime || '').localeCompare(String(b.createdTime || '')));

  // Si l'app vient d'être réinstallée et retrouve son dossier Drive, rattacher proprement l'état connecté
  const currentSettings = (await db.settings.get('app_settings')) || DEFAULT_SETTINGS;
  if (rootFolders.length > 0 && !currentSettings.driveBackup?.connected) {
    await updateDriveBackupSettings({
      connected: true,
      folderId: rootFolders[0].id,
      lastError: null,
      autoEnabled: currentSettings.driveBackup?.autoEnabled ?? true,
    });
  } else if (currentSettings.driveBackup?.lastError && isDriveAuthError(currentSettings.driveBackup.lastError)) {
    await updateDriveBackupSettings({
      lastError: null,
    });
  }

  const folderNameById = new Map<string, string>();
  for (const folder of allFolders) {
    folderNameById.set(folder.id, folder.name);
  }

  let latestFile: DriveBackupFileEntry | null = null;
  const byMonth = new Map<string, DriveBackupFileEntry[]>();

  for (const file of allJsonFiles) {
    if (!file.id || !file.name) continue;
    const sizeNum = file.size !== undefined ? Number(file.size) : NaN;
    const sizeBytes = Number.isFinite(sizeNum) ? sizeNum : null;
    const parsedInfo = parseArchiveNameInfo(file.name, file.modifiedTime || file.createdTime);

    if (file.name === LATEST_BACKUP_FILENAME) {
      const candidate: DriveBackupFileEntry = {
        id: file.id,
        name: file.name,
        sizeBytes,
        modifiedTime: file.modifiedTime || file.createdTime || null,
        displayDate: parsedInfo.displayDate,
        displayTime: parsedInfo.displayTime,
        sortKey: file.modifiedTime || file.createdTime || '',
        monthKey: parsedInfo.monthKey,
        isLatestRootFile: true,
      };
      if (!latestFile || candidate.sortKey > latestFile.sortKey) {
        latestFile = candidate;
      }
      continue;
    }

    // Déterminer le mois AAAA-MM via le dossier parent s'il correspond, sinon via le nom / la date
    let monthKey = parsedInfo.monthKey;
    const parentId = file.parents?.[0];
    if (parentId) {
      const parentName = folderNameById.get(parentId);
      if (parentName && /^\d{4}-\d{2}$/.test(parentName)) {
        monthKey = parentName;
      }
    }

    const entry: DriveBackupFileEntry = {
      id: file.id,
      name: file.name,
      sizeBytes,
      modifiedTime: file.modifiedTime || file.createdTime || null,
      displayDate: parsedInfo.displayDate,
      displayTime: parsedInfo.displayTime,
      sortKey: parsedInfo.sortKey,
      monthKey,
      isLatestRootFile: false,
    };

    const existingList = byMonth.get(monthKey) || [];
    existingList.push(entry);
    byMonth.set(monthKey, existingList);
  }

  const monthGroups: DriveBackupMonthGroup[] = Array.from(byMonth.entries())
    .sort(([mA], [mB]) => {
      if (mA === 'Autres') return 1;
      if (mB === 'Autres') return -1;
      return mB.localeCompare(mA); // Du mois le plus récent au plus ancien
    })
    .map(([monthKey, files]) => ({
      monthKey,
      files: files.sort((a, b) => b.sortKey.localeCompare(a.sortKey)),
    }));

  return {
    latestFile,
    monthGroups,
  };
}

export async function downloadDriveBackupContent(fileId: string): Promise<{
  rawJson: string;
  summary: BackupSummaryInfo;
}> {
  const token = await ensureAccessToken({ interactive: true });
  const res = await driveFetch(
    `${DRIVE_FILES_API}/${encodeURIComponent(fileId)}?alt=media`,
    token
  );
  const rawJson = await res.text();
  const parsed = parseBackupSummary(rawJson);
  if (!parsed.valid) {
    throw new DriveBackupError('UNKNOWN', parsed.message, false);
  }
  return {
    rawJson,
    summary: parsed.summary,
  };
}

// ============================================================================
// MOTEUR DE DÉCLENCHEMENT AUTOMATIQUE (OUVERTURE > 24H & MODIF ~5 MIN MAX 1/H)
// ============================================================================
let hooksInstalled = false;
let startupCheckDone = false;
let debounceTimerId: number | null = null;
let pendingOfflineModification = false;
let lastAutoChangeAttemptAt = 0;

function isOnlySecurityOrDriveSettingsDiff(
  oldSettings: AppSettings | undefined,
  modifications: Record<string, unknown>
): boolean {
  if (!oldSettings) return false;
  const ignoredKeys = new Set([
    'driveBackup',
    'lastBackupDate',
    'pinFailedAttempts',
    'pinLockoutCount',
    'pinLockoutUntil',
    'pinDeleteFailedAttempts',
    'pinDeleteLockoutUntil',
  ]);
  const modKeys = Object.keys(modifications);
  if (modKeys.length === 0) return true;
  return modKeys.every((k) => ignoredKeys.has(k));
}

function scheduleModificationBackup(delayMs = FIVE_MINUTES_MS) {
  if (debounceTimerId !== null) {
    window.clearTimeout(debounceTimerId);
  }
  debounceTimerId = window.setTimeout(() => {
    debounceTimerId = null;
    void executeScheduledModificationBackup();
  }, delayMs);
}

async function executeScheduledModificationBackup(): Promise<void> {
  try {
    const settings = await db.settings.get('app_settings');
    const driveCfg = settings?.driveBackup;
    if (!driveCfg?.connected || driveCfg.autoEnabled === false) {
      pendingOfflineModification = false;
      return;
    }

    const now = Date.now();
    const lastRef = Math.max(driveCfg.lastSuccessAt ?? 0, lastAutoChangeAttemptAt);
    const elapsed = lastRef > 0 ? now - lastRef : Infinity;

    // Au maximum UNE fois par heure
    if (elapsed < ONE_HOUR_MS) {
      const remainingMs = ONE_HOUR_MS - elapsed + 1000;
      scheduleModificationBackup(remainingMs);
      return;
    }

    // Vérifier d'abord l'empreinte avant tout appel réseau
    const { backup } = await buildBackupJSON({ updateLocalLastBackupDate: false });
    const contentHash = await computeBackupContentHash(backup);
    if (driveCfg.lastContentHash && driveCfg.lastContentHash === contentHash) {
      pendingOfflineModification = false;
      return;
    }

    if (!isBrowserOnline()) {
      pendingOfflineModification = true;
      await updateDriveBackupSettings({
        lastAttemptAt: now,
        lastError: 'Pas d’internet — la sauvegarde automatique reprendra dès le retour de la connexion.',
      });
      return;
    }

    pendingOfflineModification = false;
    lastAutoChangeAttemptAt = Date.now();
    await performDriveBackup({ trigger: 'change_auto' });
  } catch (e) {
    console.error('Erreur déclencheur auto Drive:', e);
  }
}

export function installDriveAutoBackupHooks(): void {
  if (hooksInstalled || typeof window === 'undefined') return;
  hooksInstalled = true;

  for (const table of db.tables) {
    if (table.name === 'settings') {
      table.hook('creating', function () {
        if (isInternalDriveSettingsWrite()) return;
        this.onsuccess = () => {
          if (!isInternalDriveSettingsWrite()) {
            scheduleModificationBackup(FIVE_MINUTES_MS);
          }
        };
      });
      table.hook('updating', function (modifications, _primKey, obj) {
        if (isInternalDriveSettingsWrite()) return;
        if (isOnlySecurityOrDriveSettingsDiff(obj as AppSettings, modifications as Record<string, unknown>)) {
          return;
        }
        this.onsuccess = () => {
          if (!isInternalDriveSettingsWrite()) {
            scheduleModificationBackup(FIVE_MINUTES_MS);
          }
        };
      });
    } else {
      table.hook('creating', function () {
        this.onsuccess = () => {
          scheduleModificationBackup(FIVE_MINUTES_MS);
        };
      });
      table.hook('updating', function () {
        this.onsuccess = () => {
          scheduleModificationBackup(FIVE_MINUTES_MS);
        };
      });
      table.hook('deleting', function () {
        this.onsuccess = () => {
          scheduleModificationBackup(FIVE_MINUTES_MS);
        };
      });
    }
  }

  window.addEventListener('online', () => {
    if (pendingOfflineModification) {
      scheduleModificationBackup(5000);
    }
  });
}

/**
 * Vérification automatique non bloquante à l'ouverture de l'app :
 * seulement s'il y a internet, si Drive est connecté (et autoEnabled !== false),
 * et si la dernière sauvegarde réussie date de plus de 24 h.
 */
export function triggerStartupDriveBackupCheck(): void {
  if (startupCheckDone || typeof window === 'undefined') return;
  startupCheckDone = true;

  window.setTimeout(async () => {
    try {
      if (!isBrowserOnline()) return;
      const settings = await db.settings.get('app_settings');
      const driveCfg = settings?.driveBackup;
      if (!driveCfg?.connected || driveCfg.autoEnabled === false) return;

      const lastSuccess = driveCfg.lastSuccessAt;
      const needsStartupBackup =
        !lastSuccess || Date.now() - lastSuccess > TWENTY_FOUR_HOURS_MS;

      if (!needsStartupBackup) return;

      if (!lastSuccess) {
        const hasData = await hasAnyLocalBusinessData();
        if (!hasData) return;
      }

      await performDriveBackup({ trigger: 'startup_auto' });
    } catch (e) {
      console.error('Erreur vérification sauvegarde Drive au démarrage:', e);
    }
  }, 1500);
}

// ============================================================================
// UTILITAIRES D'AFFICHAGE EN FRANÇAIS
// ============================================================================
export function formatDriveDateTime(timestampMs?: number | null): string | null {
  if (!timestampMs || !Number.isFinite(timestampMs)) return null;
  const d = new Date(timestampMs);
  if (isNaN(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} à ${hh}:${min}`;
}

export function formatIsoDateTimeFr(isoStr?: string | null): string {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return formatDriveDateTime(d.getTime()) || '—';
}

export function formatDriveFileSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} o`;
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(kb < 10 ? 1 : 0).replace('.', ',')} Ko`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(1).replace('.', ',')} Mo`;
}

export function formatDurationSinceLastBackup(
  lastSuccessAt?: number | null,
  nowMs = Date.now()
): string {
  if (!lastSuccessAt || !Number.isFinite(lastSuccessAt)) {
    return 'plus de 24 h';
  }
  const diffMs = Math.max(0, nowMs - lastSuccessAt);
  const hours = Math.floor(diffMs / ONE_HOUR_MS);
  const days = Math.floor(hours / 24);
  if (days >= 2) {
    return `${days} jours`;
  }
  if (hours >= 24) {
    return `${hours} h`;
  }
  return 'plus de 24 h';
}
