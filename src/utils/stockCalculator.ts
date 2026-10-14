import type { Product, ProductionEntry, DailyEntry, PersonalSale } from '../types';

export interface ProductStockResult {
  product: Product;
  totalProduced: number;
  totalDelivered: number;
  totalRest: number; // Somme des restes ramenés au stock maison
  totalSoldByOwner: number;
  houseStock: number; // total produit − total livré + total restes − total vendu en ventes personnelles
}

/**
 * Calcule le stock maison pour un produit donné selon la règle :
 * stock maison = total produit − total livré (somme des "delivered" des saisies) + total des restes (somme des "rest" des saisies) − total vendu en ventes personnelles.
 */
export function calculateProductStock(
  productId: string,
  productionEntries: ProductionEntry[],
  dailyEntries: DailyEntry[],
  personalSales: PersonalSale[] = []
): {
  totalProduced: number;
  totalDelivered: number;
  totalRest: number;
  totalSoldByOwner: number;
  houseStock: number;
} {
  let totalProduced = 0;
  for (const p of productionEntries) {
    const item = p.items.find((i) => i.productId === productId);
    if (item) totalProduced += item.producedQty || 0;
  }

  let totalDelivered = 0;
  let totalRest = 0;
  for (const d of dailyEntries) {
    const item = d.items.find((i) => i.productId === productId);
    if (item) {
      totalDelivered += item.delivered || 0;
      totalRest += item.rest || 0;
    }
  }

  let totalSoldByOwner = 0;
  for (const ps of personalSales) {
    const item = ps.items.find((i) => i.productId === productId);
    if (item) totalSoldByOwner += item.soldQty || 0;
  }

  const houseStock = totalProduced - totalDelivered + totalRest - totalSoldByOwner;

  return {
    totalProduced,
    totalDelivered,
    totalRest,
    totalSoldByOwner,
    houseStock,
  };
}

/**
 * Calcule le stock maison pour tous les produits d'une liste
 */
export function calculateAllProductsStock(
  products: Product[],
  productionEntries: ProductionEntry[],
  dailyEntries: DailyEntry[],
  personalSales: PersonalSale[] = []
): ProductStockResult[] {
  return products.map((prod) => {
    const stock = calculateProductStock(prod.id, productionEntries, dailyEntries, personalSales);
    return {
      product: prod,
      ...stock,
    };
  });
}
