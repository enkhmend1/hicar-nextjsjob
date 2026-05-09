export interface Car {
  id: string; plate?: string; vin?: string;
  make: string; model: string; year: number; engine: string; chassis: string;
}
export interface Product {
  id: string; name: string; oem: string; price: number; originalPrice?: number;
  category: string; brand: string; source: "amayama"|"partsouq"|"local";
  inStock: boolean; description: string; compatible: string[];
  deliveryDays: { fast: number; normal: number; cheap: number };
  iconPath: string; badge?: string;
}
export interface CartItem { product: Product; quantity: number; deliveryType: "fast"|"normal"|"cheap"; }
export interface User { id: string; name: string; email: string; phone: string; walletBalance: number; }
export interface Order {
  id: string; items: CartItem[]; total: number;
  status: "pending"|"paid"|"processing"|"shipped"|"delivered"|"cancelled";
  paymentMethod: "qpay"|"wallet"|"card"; createdAt: string; address: string;
}
