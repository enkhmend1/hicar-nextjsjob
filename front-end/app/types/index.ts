export interface Car {
  id: string; plate?: string; vin?: string;
  make: string; model: string; year: number; engine: string; chassis: string;
}
export interface SellerSummary {
  _id?: string;
  name: string;
  email?: string;
  sellerProfile?: {
    shopName?: string;
    rating?: number;
    ratingCount?: number;
  };
}

export interface Product {
  _id?: string;
  id?: string;
  seller?: SellerSummary | string | null;
  status?: "pending" | "approved" | "rejected";
  rejectedReason?: string;
  name: string;
  /** OEM code is optional. Empty string for aftermarket/universal/accessory parts. */
  oem: string;
  price: number;
  originalPrice?: number;
  /** Free-form lowercase. Use /api/seller/facets for autocomplete. */
  category: string;
  brand: string;
  /** Free-form (was enum). Examples: "amayama","yahoo auction","alibaba","personal import". */
  source: string;
  /** Free-form keyword bag. */
  tags?: string[];
  inStock: boolean;
  stockQty?: number;
  /** -1 = use seller default. */
  lowStockThreshold?: number;
  description: string;
  compatible: string[];
  deliveryDays: { fast: number; normal: number; cheap: number };
  iconPath: string;
  badge?: string;
  images?: string[];
  rating?: number;
  ratingCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface Review {
  _id?: string;
  product: string;
  user: { _id: string; name: string } | string;
  rating: number;
  comment: string;
  verifiedPurchase: boolean;
  createdAt: string;
}

export interface Vehicle {
  _id?: string;
  user?: string;
  plate?: string;
  vin?: string;
  make: string;
  model: string;
  year: number;
  engine?: string;
  chassis?: string;
  color?: string;
  isDefault?: boolean;
  createdAt?: string;
}
export interface CartItem { product: Product; quantity: number; deliveryType: "fast"|"normal"|"cheap"; }
export interface SellerProfile {
  shopName?: string;
  description?: string;
  logo?: string;
  bankAccount?: string;
  commissionRate?: number;
  rating?: number;
  ratingCount?: number;
  totalSales?: number;
  appliedAt?: string;
  approvedAt?: string;
  rejectedReason?: string;
  defaultLowStockThreshold?: number;
  emailAlertsEnabled?: boolean;
  customSources?: string[];
  customCategories?: string[];
  customBrands?: string[];
  customTags?: string[];
}
export interface User {
  _id?: string;
  id?: string;
  name: string; email: string; phone: string;
  walletBalance: number;
  role?: "user" | "seller" | "admin";
  sellerStatus?: "none" | "pending" | "approved" | "rejected";
  sellerProfile?: SellerProfile;
  createdAt?: string;
}
export interface OrderItem {
  product: string;
  name: string; oem: string; price: number;
  quantity: number; deliveryType: "fast"|"normal"|"cheap";
}
export interface Order {
  _id?: string;
  id?: string;
  user?: User | string;
  items: OrderItem[] | CartItem[];
  total: number;
  deliveryFee?: number;
  status: "pending"|"paid"|"processing"|"shipped"|"delivered"|"cancelled";
  paymentMethod: "qpay"|"wallet"|"card";
  createdAt: string;
  address: string;
  phone?: string;
}
