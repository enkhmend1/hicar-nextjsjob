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

  // Platform economics (replaces the old wallet-era `commissionRate`)
  platformFeePercent?: number;
  bankName?: string;
  bankAccount?: string;
  bankHolderName?: string;

  trustScore?: number;
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
  role?: "user" | "seller" | "admin";
  sellerStatus?: "none" | "pending" | "approved" | "rejected";
  sellerProfile?: SellerProfile;
  createdAt?: string;
}
export interface OrderItemBankSnapshot {
  bankName?: string;
  bankAccount?: string;
  bankHolderName?: string;
}
export interface OrderItem {
  product: string;
  seller?: string;
  name: string; oem: string; price: number;
  quantity: number; deliveryType: "fast"|"normal"|"cheap";
  // Escrow split (filled by QPay callback). Optional on the client because
  // pre-payment orders won't have them yet.
  lineRevenue?: number;
  platformFee?: number;
  sellerPayout?: number;
  sellerFeePercent?: number;
  bankSnapshot?: OrderItemBankSnapshot;
}
export type PaymentStatus =
  | "PENDING"
  | "PAID"
  | "DISPUTED"        // escrow LOCKED — there is an open dispute on this order
  | "REFUNDED"
  | "PARTIAL_REFUND"
  | "PAID_OUT"
  | "FAILED";

export type DisputeStatus =
  | "open"
  | "awaiting_seller"
  | "ai_analyzing"
  | "awaiting_buyer"
  | "escalated_admin"
  | "resolved_refund"
  | "resolved_release"
  | "resolved_partial"
  | "cancelled";

export type DisputeReason =
  | "not_received"
  | "wrong_item"
  | "damaged"
  | "defective"
  | "not_as_described"
  | "counterfeit"
  | "other";

export interface DisputeMessage {
  _id?: string;
  author: "buyer" | "seller" | "admin" | "ai" | "system";
  text: string;
  images?: string[];
  createdAt: string;
}
export interface DisputeAI {
  fraudScore?: number;
  confidence?: number;
  recommendedAction?: "refund_full" | "refund_partial" | "release_seller" | "reject_claim" | "escalate";
  reasoning?: string;
  flags?: string[];
  analyzedAt?: string;
  model?: string;
  buyerHistory?: Record<string, unknown>;
  sellerHistory?: Record<string, unknown>;
}
export interface Dispute {
  _id?: string;
  order: string | Order;
  buyer: string | User;
  seller: string | User;
  itemProductIds?: string[];
  reason: DisputeReason;
  description: string;
  evidenceImages?: string[];
  requestedRefundAmount: number;
  status: DisputeStatus;
  messages: DisputeMessage[];
  responseDeadline?: string;
  sellerResponse?: {
    action?: "refund_offered" | "rejected" | "partial_refund_offered";
    offeredAmount?: number;
    message?: string;
    respondedAt?: string;
  };
  aiAnalysis?: DisputeAI;
  resolution?: {
    action?: "refund_full" | "refund_partial" | "release_seller" | "reject_claim";
    amount?: number;
    returnShippingPenalty?: number;
    notes?: string;
    resolvedBy?: string;
    resolvedAt?: string;
    refundTxId?: string;
  };
  createdAt?: string;
  updatedAt?: string;
}
export interface Order {
  _id?: string;
  id?: string;
  user?: User | string;
  items: OrderItem[] | CartItem[];
  total: number;
  deliveryFee?: number;
  status: "pending"|"paid"|"processing"|"shipped"|"delivered"|"cancelled";
  /** Wallet removed in Phase 1 — QPay + card only. */
  paymentMethod: "qpay"|"card";
  paymentStatus?: PaymentStatus;
  escrowAmount?: number;
  platformFeeTotal?: number;
  sellerPayoutTotal?: number;
  refundedAmount?: number;
  hasOpenDispute?: boolean;
  paidAt?: string;
  deliveredAt?: string;
  escrowReleaseScheduledAt?: string;
  escrowReleasedAt?: string;
  createdAt: string;
  address: string;
  phone?: string;
}
