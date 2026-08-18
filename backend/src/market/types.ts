export type ResourceKind = 'gpu' | 'token_capacity' | 'token_usage' | 'rack' | 'storage' | 'apple_silicon';

export type PublicResource = Readonly<{
  id: string;
  productCode: string;
  kind: ResourceKind;
  region: string;
  specifications: Record<string, unknown>;
  capacityTotal: string;
  capacityUnit: string;
  createdAt: Date;
}>;

export type MarketListing = Readonly<{
  id: string;
  productCode: string;
  kind: ResourceKind;
  region: string;
  specifications: Record<string, unknown>;
  availableQuantity: string;
  capacityUnit: string;
  unitPriceCents: number;
  currency: 'CNY';
  minimumQuantity: string;
  sla: Record<string, unknown>;
  expiresAt: Date;
  createdAt: Date;
}>;

export type SupplierProfile = Readonly<{
  id: string;
  subjectId: string;
  legalName: string;
  creditCode: string;
  contactName: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'suspended';
  rejectionReason: string | null;
}>;

export type ComputeResource = Readonly<{
  id: string;
  supplierId: string;
  kind: ResourceKind;
  productCode: string;
  region: string;
  specifications: Record<string, unknown>;
  capacityTotal: string;
  capacityUnit: string;
  status: 'draft' | 'pending_verification' | 'verified' | 'rejected' | 'suspended' | 'retired';
}>;

export type SupplierResource = ComputeResource & Readonly<{
  verification: null | Readonly<{
    status: 'pending' | 'running' | 'passed' | 'failed';
    requestedAt: Date;
    completedAt: Date | null;
    failureReason: string | null;
  }>;
}>;

export type SupplierListing = Readonly<{
  id: string;
  resourceId: string;
  productCode: string;
  region: string;
  totalQuantity: string;
  reservedQuantity: string;
  soldQuantity: string;
  capacityUnit: string;
  unitPriceCents: number;
  currency: 'CNY';
  minimumQuantity: string;
  status: 'draft' | 'active' | 'paused' | 'sold_out' | 'expired' | 'withdrawn';
  startsAt: Date;
  expiresAt: Date;
  createdAt: Date;
}>;

export type ComputeDemand = Readonly<{
  id: string;
  buyerId: string;
  kind: ResourceKind;
  title: string;
  productHint: string;
  region: string;
  quantity: string;
  capacityUnit: string;
  budgetMaxCents: number | null;
  currency: 'CNY';
  desiredStartAt: Date;
  deadlineAt: Date;
  description: string;
  status: 'open' | 'matched' | 'cancelled' | 'expired' | 'closed';
  createdAt: Date;
  updatedAt: Date;
}>;

export type OrderRecord = Readonly<{
  id: string;
  orderNumber: string;
  buyerId: string;
  supplierId: string;
  listingId: string;
  status: 'reserved' | 'payment_pending' | 'paid' | 'delivery_pending' | 'delivering' | 'acceptance_pending' | 'accepted' | 'cancelled' | 'refund_pending' | 'refunded' | 'disputed' | 'closed';
  quantity: string;
  capacityUnit: string;
  unitPriceCents: number;
  subtotalCents: number;
  feeCents: number;
  totalCents: number;
  currency: 'CNY';
  reservationExpiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}>;
