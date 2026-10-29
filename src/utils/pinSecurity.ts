import type { AppSettings } from '../types';

const HASH_PREFIX = 'sha256$';
// 32 caractères non ambigus (majuscules sans I ni O, chiffres sans 0 ni 1)
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_CODE_LENGTH = 12;

export const MAX_FAILED_ATTEMPTS_BEFORE_LOCKOUT = 5;
const LOCKOUT_DURATIONS_MINUTES = [1, 5, 15]; // 1 min, puis 5 min, puis 15 min pour les suivants

export const MAX_DELETE_FAILED_ATTEMPTS = 3;
export const DELETE_LOCKOUT_DURATION_SECONDS = 30;

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function generateSaltHex(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function hashSecretWithSalt(secret: string, existingSaltHex?: string): Promise<string> {
  const saltHex = existingSaltHex || generateSaltHex(16);
  const encoder = new TextEncoder();
  const data = encoder.encode(`${saltHex}:${secret}`);
  const digestBuffer = await crypto.subtle.digest('SHA-256', data);
  const digestHex = bytesToHex(new Uint8Array(digestBuffer));
  return `${HASH_PREFIX}${saltHex}$${digestHex}`;
}

export function isHashedSecret(stored?: string): boolean {
  if (!stored || !stored.startsWith(HASH_PREFIX)) return false;
  const parts = stored.split('$');
  return parts.length === 3 && parts[1].length >= 16 && parts[2].length === 64;
}

export function hasActivePin(settings?: Pick<AppSettings, 'pinCode'> | null): boolean {
  return Boolean(settings?.pinCode && settings.pinCode.trim().length > 0);
}

export function isLegacyPlaintextPin(pinCode?: string): boolean {
  if (!pinCode || !pinCode.trim()) return false;
  return !isHashedSecret(pinCode);
}

export async function verifyPinValue(
  candidatePin: string,
  storedPinCode?: string
): Promise<boolean> {
  if (!storedPinCode || !storedPinCode.trim()) return false;
  const cleanCandidate = candidatePin.trim();
  if (!/^\d{4}$/.test(cleanCandidate)) return false;

  if (isHashedSecret(storedPinCode)) {
    const parts = storedPinCode.split('$');
    const saltHex = parts[1];
    const computed = await hashSecretWithSalt(cleanCandidate, saltHex);
    return timingSafeEqual(computed, storedPinCode);
  }

  // Rétro-compatibilité avant migration automatique : PIN en clair à 4 chiffres
  return timingSafeEqual(cleanCandidate, storedPinCode.trim());
}

/**
 * Génère un code de récupération aléatoire de 12 caractères (majuscules + chiffres, sans 0, O, 1, I)
 * avec crypto.getRandomValues (32 symboles = puissance de 2, aucun biais modulo).
 */
export function generateRecoveryCode(): string {
  const randomBytes = new Uint8Array(RECOVERY_CODE_LENGTH);
  crypto.getRandomValues(randomBytes);
  let code = '';
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) {
    code += RECOVERY_ALPHABET[randomBytes[i] & 31];
  }
  return code;
}

export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]+/g, '').toUpperCase();
}

export async function hashRecoveryCode(rawCode: string): Promise<string> {
  return hashSecretWithSalt(normalizeRecoveryCode(rawCode));
}

export async function verifyRecoveryCode(
  candidateInput: string,
  storedRecoveryHash?: string
): Promise<boolean> {
  if (!storedRecoveryHash || !isHashedSecret(storedRecoveryHash)) return false;
  const normalized = normalizeRecoveryCode(candidateInput);
  if (normalized.length !== RECOVERY_CODE_LENGTH) return false;
  const parts = storedRecoveryHash.split('$');
  const saltHex = parts[1];
  const computed = await hashSecretWithSalt(normalized, saltHex);
  return timingSafeEqual(computed, storedRecoveryHash);
}

export function getRemainingLockoutSeconds(
  settings?: Pick<AppSettings, 'pinLockoutUntil'> | null,
  nowMs = Date.now()
): number {
  if (!settings?.pinLockoutUntil || settings.pinLockoutUntil <= nowMs) {
    return 0;
  }
  return Math.ceil((settings.pinLockoutUntil - nowMs) / 1000);
}

export function getRemainingDeleteBlockSeconds(
  settings?: Pick<AppSettings, 'pinDeleteLockoutUntil' | 'pinLockoutUntil'> | null,
  nowMs = Date.now()
): number {
  const deleteRem =
    settings?.pinDeleteLockoutUntil && settings.pinDeleteLockoutUntil > nowMs
      ? Math.ceil((settings.pinDeleteLockoutUntil - nowMs) / 1000)
      : 0;
  const globalRem = getRemainingLockoutSeconds(settings, nowMs);
  return Math.max(deleteRem, globalRem);
}

export function formatLockoutCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function recordFailedPinOrRecoveryAttempt(
  settings: AppSettings,
  nowMs = Date.now()
): {
  updatedSettings: AppSettings;
  isNowLockedOut: boolean;
  lockoutDurationMinutes?: number;
  remainingAttemptsBeforeLockout: number;
} {
  const nextFailed = (settings.pinFailedAttempts ?? 0) + 1;

  if (nextFailed >= MAX_FAILED_ATTEMPTS_BEFORE_LOCKOUT) {
    const nextLockoutCount = (settings.pinLockoutCount ?? 0) + 1;
    const durationIdx = Math.min(nextLockoutCount - 1, LOCKOUT_DURATIONS_MINUTES.length - 1);
    const durationMinutes = LOCKOUT_DURATIONS_MINUTES[durationIdx];
    const lockoutUntil = nowMs + durationMinutes * 60 * 1000;

    return {
      updatedSettings: {
        ...settings,
        pinFailedAttempts: 0,
        pinLockoutCount: nextLockoutCount,
        pinLockoutUntil: lockoutUntil,
      },
      isNowLockedOut: true,
      lockoutDurationMinutes: durationMinutes,
      remainingAttemptsBeforeLockout: 0,
    };
  }

  return {
    updatedSettings: {
      ...settings,
      pinFailedAttempts: nextFailed,
    },
    isNowLockedOut: false,
    remainingAttemptsBeforeLockout: MAX_FAILED_ATTEMPTS_BEFORE_LOCKOUT - nextFailed,
  };
}

export function recordFailedProtectedDeletePinAttempt(
  settings: AppSettings,
  nowMs = Date.now()
): {
  updatedSettings: AppSettings;
  shouldCloseAndBlock: boolean;
} {
  // Partage le système global de limite d'essais (5 essais -> 1m / 5m / 15m)
  const globalResult = recordFailedPinOrRecoveryAttempt(settings, nowMs);
  const nextDeleteFailed = (settings.pinDeleteFailedAttempts ?? 0) + 1;

  if (nextDeleteFailed >= MAX_DELETE_FAILED_ATTEMPTS || globalResult.isNowLockedOut) {
    const deleteLockoutUntil = nowMs + DELETE_LOCKOUT_DURATION_SECONDS * 1000;
    const effectiveDeleteUntil = Math.max(
      deleteLockoutUntil,
      globalResult.updatedSettings.pinLockoutUntil ?? 0
    );

    return {
      updatedSettings: {
        ...globalResult.updatedSettings,
        pinDeleteFailedAttempts: 0,
        pinDeleteLockoutUntil: effectiveDeleteUntil,
      },
      shouldCloseAndBlock: true,
    };
  }

  return {
    updatedSettings: {
      ...globalResult.updatedSettings,
      pinDeleteFailedAttempts: nextDeleteFailed,
    },
    shouldCloseAndBlock: false,
  };
}

export function clearPinLockoutFields(settings: AppSettings): AppSettings {
  const cleaned: AppSettings = {
    ...settings,
    pinFailedAttempts: 0,
    pinLockoutCount: 0,
    pinDeleteFailedAttempts: 0,
  };
  delete cleaned.pinLockoutUntil;
  delete cleaned.pinDeleteLockoutUntil;
  return cleaned;
}
