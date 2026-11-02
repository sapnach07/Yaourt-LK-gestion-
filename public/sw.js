const CACHE_NAME = 'yaourt-gestion-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
];

// Installation : mise en cache initiale et skipWaiting
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Activation : suppression des anciens caches et prise de contrôle immédiate
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Interception des requêtes
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Traiter uniquement les requêtes GET
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Ignorer les requêtes externes (conserver strict même origine)
  if (url.origin !== self.location.origin) {
    return;
  }

  // 1. Pour les navigations (mode navigate) :
  // Réseau d'abord, mise en cache sous /index.html, et repli sur le cache en cas d'échec
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put('/index.html', responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 2. Pour les autres requêtes GET de même origine :
  // Répondre depuis le cache si disponible et mettre à jour le cache en arrière-plan
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      });
    })
  );
});

// ============================================================================
// NOTIFICATIONS SYSTÈME & VÉRIFICATION PÉRIODIQUE EN ARRIÈRE-PLAN (PWA)
// ============================================================================

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const actionTarget = data.actionTarget || 'dashboard';
  const notificationId = data.notificationId || '';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.startsWith(self.location.origin) && 'focus' in client) {
            client.postMessage({
              type: 'YAOURT_NOTIFICATION_CLICK',
              actionTarget,
              notificationId,
            });
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          const targetUrl =
            actionTarget && actionTarget !== 'dashboard'
              ? `/?notifAction=${encodeURIComponent(actionTarget)}`
              : '/';
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});

function readIndexedDBBackgroundState() {
  return new Promise((resolve) => {
    try {
      const openReq = indexedDB.open('YaourtGestionDB');
      openReq.onerror = () => resolve(null);
      openReq.onsuccess = () => {
        const idb = openReq.result;
        const storeNames = Array.from(idb.objectStoreNames);
        if (!storeNames.includes('settings')) {
          idb.close();
          resolve(null);
          return;
        }
        const txStores = storeNames.includes('notifications')
          ? ['settings', 'notifications']
          : ['settings'];
        const tx = idb.transaction(txStores, 'readonly');
        const settingsReq = tx.objectStore('settings').get('app_settings');
        const notifsReq = storeNames.includes('notifications')
          ? tx.objectStore('notifications').getAll()
          : null;

        tx.oncomplete = () => {
          idb.close();
          resolve({
            settings: settingsReq.result || null,
            notifications: notifsReq ? notifsReq.result || [] : [],
          });
        };
        tx.onerror = () => {
          idb.close();
          resolve(null);
        };
      };
    } catch {
      resolve(null);
    }
  });
}

function saveBackgroundNotificationToIDB(record) {
  return new Promise((resolve) => {
    try {
      const openReq = indexedDB.open('YaourtGestionDB');
      openReq.onerror = () => resolve(false);
      openReq.onsuccess = () => {
        const idb = openReq.result;
        if (!idb.objectStoreNames.contains('notifications')) {
          idb.close();
          resolve(false);
          return;
        }
        const tx = idb.transaction(['notifications'], 'readwrite');
        tx.objectStore('notifications').put(record);
        tx.oncomplete = () => {
          idb.close();
          resolve(true);
        };
        tx.onerror = () => {
          idb.close();
          resolve(false);
        };
      };
    } catch {
      resolve(false);
    }
  });
}

async function runBackgroundPeriodicNotificationCheck() {
  if (!self.Notification || self.Notification.permission !== 'granted') return;

  const state = await readIndexedDBBackgroundState();
  if (!state || !state.settings) return;

  const settings = state.settings;
  const notifCfg = settings.notificationSettings;
  if (!notifCfg || !notifCfg.systemMode || !notifCfg.systemMode.enabled) return;

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const nowHHMM = `${hh}:${mm}`;
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const dateFr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

  // Respect des heures calmes
  if (notifCfg.systemMode.quietHoursEnabled) {
    const qs = notifCfg.systemMode.quietHoursStart || '22:00';
    const qe = notifCfg.systemMode.quietHoursEnd || '06:30';
    const inQuiet =
      qs < qe ? nowHHMM >= qs && nowHHMM < qe : nowHHMM >= qs || nowHHMM < qe;
    if (inQuiet) return;
  }

  const existingKeys = new Set(
    (state.notifications || []).map((n) => n && n.dedupKey).filter(Boolean)
  );
  const rules = Array.isArray(notifCfg.rules) ? notifCfg.rules : [];

  for (const rule of rules) {
    if (!rule || !rule.enabled || !rule.channels || !rule.channels.system) continue;
    if (Array.isArray(rule.activeDays) && rule.activeDays.length > 0) {
      if (!rule.activeDays.includes(now.getDay())) continue;
    }
    if (rule.preferredTime && nowHHMM < rule.preferredTime) continue;

    let candidate = null;

    if (rule.triggerType === 'custom_scheduled_reminder') {
      const dedupKey = `${rule.id}::sched:${todayStr}:${rule.preferredTime || 'any'}`;
      if (!existingKeys.has(dedupKey)) {
        const title = (rule.titleTemplate || rule.name)
          .replace(/\{entreprise\}/g, settings.businessName || 'Yaourt Gestion')
          .replace(/\{date\}/g, dateFr)
          .replace(/\{heure\}/g, nowHHMM);
        const body = (rule.messageTemplate || '')
          .replace(/\{entreprise\}/g, settings.businessName || 'Yaourt Gestion')
          .replace(/\{date\}/g, dateFr)
          .replace(/\{heure\}/g, nowHHMM);
        candidate = { title, body, dedupKey, actionTarget: rule.actionTarget || 'dashboard' };
      }
    } else if (rule.triggerType === 'builtin_backup_local' && settings.lastBackupDate) {
      const maxDays = Math.max(1, Math.floor(rule.thresholdValue || 7));
      const parts = String(settings.lastBackupDate).split('-').map(Number);
      if (parts.length === 3) {
        const elapsed = Math.floor(
          (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
            Date.UTC(parts[0], parts[1] - 1, parts[2])) /
            86400000
        );
        const dedupKey = `${rule.id}::local_backup:${todayStr}`;
        if (elapsed >= maxDays && !existingKeys.has(dedupKey)) {
          candidate = {
            title: rule.titleTemplate || 'Sauvegarde locale recommandée',
            body: `Dernière sauvegarde JSON il y a ${elapsed} jour(s). Pensez à exporter vos données.`,
            dedupKey,
            actionTarget: 'backup_settings',
          };
        }
      }
    }

    if (candidate) {
      const notifId = `sw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await saveBackgroundNotificationToIDB({
        id: notifId,
        ruleId: rule.id,
        category: rule.category || 'custom',
        title: candidate.title,
        message: candidate.body,
        color: rule.color || 'teal',
        icon: rule.icon || 'Bell',
        styleVariant: rule.styleVariant || 'soft',
        isRead: !(notifCfg.inAppMode && notifCfg.inAppMode.enabled && rule.channels.inApp),
        createdAt: Date.now(),
        dedupKey: candidate.dedupKey,
        actionTarget: candidate.actionTarget,
      });
      await self.registration.showNotification(candidate.title, {
        body: candidate.body,
        icon: settings.appLogoBase64 || '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag: candidate.dedupKey,
        vibrate: notifCfg.systemMode.vibrate !== false ? [180, 80, 180] : undefined,
        requireInteraction: Boolean(notifCfg.systemMode.requireInteraction),
        data: {
          actionTarget: candidate.actionTarget,
          notificationId: notifId,
        },
      });
    }
  }
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'yaourt-smart-notifications') {
    event.waitUntil(runBackgroundPeriodicNotificationCheck());
  }
});

