import Dexie, { type Table } from 'dexie';
import type {
  Employee,
  Product,
  DailyEntry,
  ProductionEntry,
  Expense,
  ReserveMovement,
  Payment,
  AppSettings,
} from '../types';

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Lait concentré',
  'Sucre vanillé',
  'Essence ananas',
  'Baobab',
  'Bouteilles & Bouchons',
  'Sachets d’emballage',
  'Gaz / Charbon / Électricité',
  'Transport & Livraison',
  'Entretien & Hygiène',
  'Autre dépense',
];

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'app_settings',
  businessName: 'Yaourt Gestion',
  currency: 'FC',
  expenseReservePct: 50,
  monthlySalesTargetFC: 1000000,
  lossAlertThresholdPct: 5.0,
  pinCode: '',
  expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
  lastBackupDate: null,
};

export class YaourtDatabase extends Dexie {
  employees!: Table<Employee, string>;
  products!: Table<Product, string>;
  dailyEntries!: Table<DailyEntry, string>;
  productionEntries!: Table<ProductionEntry, string>;
  expenses!: Table<Expense, string>;
  reserveMovements!: Table<ReserveMovement, string>;
  payments!: Table<Payment, string>;
  settings!: Table<AppSettings, string>;

  constructor() {
    super('YaourtGestionDB');
    this.version(1).stores({
      employees: 'id, name, isArchived, startDate',
      products: 'id, name, isActive, sortOrder',
      dailyEntries: 'id, date, employeeId, createdAt',
      productionEntries: 'id, date, createdAt',
      expenses: 'id, date, category, createdAt',
      payments: 'id, employeeId, month, date, createdAt',
      settings: 'id',
    });
    this.version(2).stores({
      reserveMovements: 'id, date, type, createdAt',
    });
  }
}

export const db = new YaourtDatabase();

/**
 * Initializes the database.
 * Seeds initial products (Bouteille = 1000 FC, Sachet 03 = 500 FC)
 * and settings if they don't exist yet.
 * No dummy sales, expenses or employees are created.
 */
export async function initializeDatabase(): Promise<void> {
  try {
    // 1. Request storage persistence so Android/browser never drops offline data
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      const isPersisted = await navigator.storage.persisted();
      if (!isPersisted) {
        await navigator.storage.persist();
      }
    }

    // 2. Initialize default settings if not exists
    const existingSettings = await db.settings.get('app_settings');
    if (!existingSettings) {
      await db.settings.put(DEFAULT_SETTINGS);
    }

    // 3. Initialize default products if none exist
    const productsCount = await db.products.count();
    if (productsCount === 0) {
      const initialProducts: Product[] = [
        {
          id: 'prod_bouteille',
          name: 'Bouteille',
          defaultPrice: 1000,
          isActive: true,
          sortOrder: 1,
          createdAt: Date.now(),
        },
        {
          id: 'prod_sachet_03',
          name: 'Sachet 03',
          defaultPrice: 500,
          isActive: true,
          sortOrder: 2,
          createdAt: Date.now() + 1,
        },
      ];
      await db.products.bulkPut(initialProducts);
    }
  } catch (error) {
    console.error('Erreur lors de l’initialisation de la base de données:', error);
  }
}

/**
 * Helper to fetch the previous rest for an employee before a target date.
 * Looks for the most recent entry for this employee strictly before `targetDate`.
 */
export async function getPreviousRestForEmployee(
  employeeId: string,
  targetDate: string
): Promise<Record<string, number>> {
  const previousRests: Record<string, number> = {};
  if (!employeeId) return previousRests;

  try {
    const entries = await db.dailyEntries
      .where('employeeId')
      .equals(employeeId)
      .filter((entry) => entry.date < targetDate)
      .sortBy('date');

    if (entries.length > 0) {
      const lastEntry = entries[entries.length - 1];
      if (lastEntry && lastEntry.items) {
        for (const item of lastEntry.items) {
          previousRests[item.productId] = Number(item.rest) || 0;
        }
      }
    }
  } catch (e) {
    console.error('Erreur lors de la récupération du reste précédent:', e);
  }

  return previousRests;
}
