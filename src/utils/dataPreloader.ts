import { db } from '../db/db';
import type {
  DailyEntry,
  Expense,
  Employee,
  Product,
  ProductionEntry,
  Payment,
  ReserveMovement,
  PersonalSale,
  Customer,
  DebtPayment,
  StockAdjustment,
  AppSettings,
} from '../types';

export interface PreloadedAppData {
  dailyEntries: DailyEntry[];
  expenses: Expense[];
  employees: Employee[];
  products: Product[];
  productionEntries: ProductionEntry[];
  payments: Payment[];
  reserveMovements: ReserveMovement[];
  personalSales: PersonalSale[];
  customers: Customer[];
  debtPayments: DebtPayment[];
  stockAdjustments: StockAdjustment[];
  settings?: AppSettings;
  loadedAt: number;
}

let cachedAppData: PreloadedAppData | null = null;
let inFlightPreloadPromise: Promise<PreloadedAppData> | null = null;
const listeners = new Set<(data: PreloadedAppData) => void>();

/**
 * Lance le préchargement complet en arrière-plan des tables et réglages de l'application.
 * S'exécute dès l'ouverture de la base (pendant que l'utilisateur est sur l'écran PIN).
 */
export function startAppDataPreload(): Promise<PreloadedAppData> {
  if (inFlightPreloadPromise) {
    return inFlightPreloadPromise;
  }

  const startTime = performance.now();

  inFlightPreloadPromise = (async () => {
    try {
      const [
        dList,
        eList,
        empList,
        prodList,
        pList,
        payList,
        movList,
        psList,
        custList,
        dpList,
        adjList,
        settingsObj,
      ] = await Promise.all([
        db.dailyEntries.toArray(),
        db.expenses.toArray(),
        db.employees.toArray(),
        db.products.orderBy('sortOrder').toArray(),
        db.productionEntries.toArray(),
        db.payments.toArray(),
        db.reserveMovements.toArray(),
        db.personalSales.toArray(),
        db.customers.toArray(),
        db.debtPayments.toArray(),
        db.stockAdjustments.toArray(),
        db.settings.get('app_settings'),
      ]);

      const data: PreloadedAppData = {
        dailyEntries: dList,
        expenses: eList,
        employees: empList,
        products: prodList,
        productionEntries: pList,
        payments: payList,
        reserveMovements: movList,
        personalSales: psList,
        customers: custList,
        debtPayments: dpList,
        stockAdjustments: adjList,
        settings: settingsObj,
        loadedAt: Date.now(),
      };

      cachedAppData = data;
      const elapsed = performance.now() - startTime;
      if (process.env.NODE_ENV !== 'production') {
        console.info(`[Preloader] Données de l'app préchargées en ${elapsed.toFixed(1)} ms`);
      }

      listeners.forEach((fn) => {
        try {
          fn(data);
        } catch (err) {
          console.error('[Preloader] Erreur listener:', err);
        }
      });

      return data;
    } catch (err) {
      console.error('[Preloader] Erreur lors du préchargement des données:', err);
      throw err;
    } finally {
      inFlightPreloadPromise = null;
    }
  })();

  return inFlightPreloadPromise;
}

/**
 * Retourne les données préchargées en mémoire si déjà disponibles.
 */
export function getPreloadedAppData(): PreloadedAppData | null {
  return cachedAppData;
}

/**
 * Indique si les données sont prêtes en mémoire.
 */
export function isAppDataPreloaded(): boolean {
  return cachedAppData !== null;
}

/**
 * Permet d'attendre les données préchargées (ou les retourne directement si déjà prêtes).
 */
export async function getOrWaitPreloadedAppData(): Promise<PreloadedAppData> {
  if (cachedAppData) {
    return cachedAppData;
  }
  if (inFlightPreloadPromise) {
    return inFlightPreloadPromise;
  }
  return startAppDataPreload();
}

/**
 * Invalide ou actualise le cache en mémoire lors d'une écriture importante.
 */
export function invalidateAppDataCache(): void {
  cachedAppData = null;
  inFlightPreloadPromise = null;
}

/**
 * Permet à un composant de s'abonner à l'arrivée des données préchargées.
 */
export function subscribeAppDataPreloaded(fn: (data: PreloadedAppData) => void): () => void {
  listeners.add(fn);
  if (cachedAppData) {
    fn(cachedAppData);
  }
  return () => {
    listeners.delete(fn);
  };
}
