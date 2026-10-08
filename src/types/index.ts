export interface Employee {
  id: string;
  name: string;
  phone?: string;
  commissionRate: number; // e.g. 20 for 20%
  startDate: string; // YYYY-MM-DD
  note?: string;
  isArchived: boolean;
  createdAt: number;
}

export interface Product {
  id: string;
  name: string;
  defaultPrice: number; // in FC, e.g. 1000 for Bouteille, 500 for Sachet 03
  isActive: boolean;
  sortOrder: number;
  createdAt: number;
}

export interface DailyEntryItem {
  productId: string;
  productName: string;
  unitPrice: number; // frozen at time of entry
  previousRest: number; // Reste veille (repris automatiquement ou saisi)
  delivered: number; // Nouvelles livraisons
  totalToSell: number; // previousRest + delivered
  sold: number; // Quantité vendue
  damaged: number; // Quantité abîmée
  rest: number; // totalToSell - sold - damaged
}

export interface DailyEntry {
  id: string;
  date: string; // YYYY-MM-DD
  employeeId: string;
  employeeName: string;
  employeeCommissionRate: number; // frozen at entry time (e.g. 25%)
  items: DailyEntryItem[];
  totalSalesFC: number; // Sum of sold * unitPrice
  totalDamagedFC: number; // Sum of damaged * unitPrice
  employeeCommissionFC: number; // employeeCommissionRate% * totalSalesFC
  expenseReserveRate: number; // e.g. 50%
  expenseReserveFC: number; // expenseReserveRate% * totalSalesFC
  ownerShareRate: number; // 100% - expenseReserveRate - employeeCommissionRate
  ownerShareFC: number; // ownerShareRate% * totalSalesFC
  notes?: string;
  createdAt: number;
}

export interface ProductionItem {
  productId: string;
  productName: string;
  producedQty: number;
}

export interface ProductionEntry {
  id: string;
  date: string; // YYYY-MM-DD
  items: ProductionItem[];
  notes?: string;
  createdAt: number;
}

export interface Expense {
  id: string;
  date: string; // YYYY-MM-DD
  amountFC: number;
  category: string;
  detail: string;
  createdAt: number;
}

export interface Payment {
  id: string;
  employeeId: string;
  employeeName: string;
  month: string; // YYYY-MM
  date: string; // YYYY-MM-DD
  amountFC: number;
  paymentType: 'advance' | 'salary' | 'final'; // Avance ou Règlement complet
  notes?: string;
  createdAt: number;
}

export interface AppSettings {
  id: string; // 'app_settings'
  businessName: string; // Default: 'Yaourt Gestion'
  currency: string; // Default: 'FC'
  expenseReservePct: number; // Default: 50
  monthlySalesTargetFC: number; // Default: 1000000 FC
  lossAlertThresholdPct: number; // Default: 5.0%
  pinCode: string; // 4 digits or empty string if disabled
  expenseCategories: string[];
  lastBackupDate: string | null;
}

export type PeriodFilterType = 'today' | 'this_week' | 'this_month' | 'last_month' | 'custom';

export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}
