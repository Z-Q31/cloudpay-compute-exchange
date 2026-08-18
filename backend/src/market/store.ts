import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import type { Database } from '../database.js';
import type { ListingCursor } from './cursor.js';
import type {
  ComputeDemand, ComputeResource, MarketListing, OrderRecord, PublicResource, ResourceKind, SupplierListing, SupplierProfile, SupplierResource,
} from './types.js';

export type CreateOrderResult =
  | Readonly<{ status: 'created' | 'replayed'; order: OrderRecord }>
  | Readonly<{ status: 'idempotency_conflict' }>
  | Readonly<{ status: 'in_progress' }>
  | Readonly<{ status: 'listing_unavailable' }>;

export type CreateResourceResult =
  | Readonly<{ status: 'created' | 'replayed' | 'existing'; resource: ComputeResource }>
  | Readonly<{ status: 'idempotency_conflict' | 'identity_claimed' }>;

export type ResubmitResourceResult =
  | Readonly<{ status: 'created' | 'replayed'; resource: SupplierResource }>
  | Readonly<{ status: 'not_found' | 'invalid_state' | 'idempotency_conflict' }>;

export interface MarketStore {
  listVerifiedResources(input: Readonly<{ kind?: ResourceKind; region?: string; query?: string; cursor: ListingCursor | null; limit: number }>): Promise<PublicResource[]>;
  listListings(input: Readonly<{ kind?: ResourceKind; region?: string; query?: string; cursor: ListingCursor | null; limit: number }>): Promise<MarketListing[]>;
  getSupplierBySubject(subjectId: string): Promise<SupplierProfile | null>;
  submitSupplier(input: Readonly<{ subjectId: string; userId: string; legalName: string; creditCode: string; contactName: string }>): Promise<SupplierProfile>;
  reviewSupplier(input: Readonly<{ supplierId: string; reviewerId: string; approved: boolean; reason?: string }>): Promise<SupplierProfile | null>;
  listSupplierResources(subjectId: string): Promise<SupplierResource[]>;
  listSupplierListings(subjectId: string): Promise<SupplierListing[]>;
  createResource(input: Readonly<{
    id: string; subjectId: string; requestedByUserId: string; kind: ResourceKind; productCode: string; region: string;
    specifications: Record<string, unknown>; capacityTotal: string; capacityUnit: string;
    assetFingerprint: string; assetIdentityKind: 'hardware_serial' | 'cloud_resource_id' | 'internal_asset_id';
    clientRequestId: string; payloadDigest: string;
  }>): Promise<CreateResourceResult | null>;
  resubmitResourceVerification(input: Readonly<{
    id: string; resourceId: string; subjectId: string; requestedByUserId: string; clientRequestId: string;
  }>): Promise<ResubmitResourceResult>;
  completeResourceVerification(input: Readonly<{
    resourceId: string; reviewerId: string; passed: boolean; evidenceDigest: string; checks: Record<string, unknown>; failureReason?: string;
  }>): Promise<ComputeResource | null>;
  createListing(input: Readonly<{
    id: string; subjectId: string; publishedByUserId: string; resourceId: string; capacityTotal: string; unitPriceCents: number;
    minimumQuantity: string; startsAt: Date; expiresAt: Date; sla: Record<string, unknown>;
  }>): Promise<MarketListing | null>;
  createDemand(input: Readonly<{
    id: string; buyerId: string; kind: ResourceKind; title: string; productHint: string; region: string;
    quantity: string; capacityUnit: string; budgetMaxCents: number | null;
    desiredStartAt: Date; deadlineAt: Date; description: string;
  }>): Promise<ComputeDemand>;
  listDemands(userId: string): Promise<ComputeDemand[]>;
  cancelDemand(userId: string, demandId: string): Promise<ComputeDemand | null>;
  createOrder(input: Readonly<{
    id: string; orderNumber: string; buyerId: string; listingId: string; quantity: string;
    reservationExpiresAt: Date;
    idempotencyKey: string; payloadHash: string;
  }>): Promise<CreateOrderResult>;
  listOrders(userId: string): Promise<OrderRecord[]>;
  getOrder(userId: string, orderId: string): Promise<OrderRecord | null>;
  cancelOrder(userId: string, orderId: string): Promise<OrderRecord | null>;
  startDelivery(userId: string, orderId: string): Promise<OrderRecord | null>;
  markDeliveryReady(userId: string, orderId: string, metadataCiphertext: string): Promise<OrderRecord | null>;
  acceptDelivery(userId: string, orderId: string, evidenceDigest?: string): Promise<OrderRecord | null>;
  markOrderPaid(orderId: string, paymentIntentId: string): Promise<OrderRecord | null>;
  expireReservations(now: Date, limit: number): Promise<number>;
}

type ListingRow = QueryResultRow & {
  id: string; product_code: string; kind: ResourceKind; region: string; specifications: Record<string, unknown>;
  available_quantity: string; capacity_unit: string; unit_price_cents: string; currency: 'CNY'; minimum_quantity: string;
  sla: Record<string, unknown>; expires_at: Date; created_at: Date;
};

type OrderRow = QueryResultRow & {
  id: string; order_number: string; buyer_id: string; supplier_id: string; listing_id: string; status: OrderRecord['status'];
  quantity: string; capacity_unit: string; unit_price_cents: string; subtotal_cents: string; fee_cents: string; total_cents: string;
  currency: 'CNY'; reservation_expires_at: Date; created_at: Date; updated_at: Date;
};

type ResourceRow = QueryResultRow & {
  id: string; supplier_id: string; kind: ResourceKind; product_code: string; region: string;
  specifications: Record<string, unknown>; capacity_total: string; capacity_unit: string; status: ComputeResource['status'];
};

type SupplierResourceRow = ResourceRow & {
  verification_status: 'pending' | 'running' | 'passed' | 'failed' | null;
  requested_at: Date | null;
  completed_at: Date | null;
  failure_reason: string | null;
};

type SupplierListingRow = QueryResultRow & {
  id: string; resource_id: string; product_code: string; region: string; total_quantity: string;
  reserved_quantity: string; sold_quantity: string; capacity_unit: string; unit_price_cents: string;
  currency: 'CNY'; minimum_quantity: string; status: SupplierListing['status']; starts_at: Date; expires_at: Date; created_at: Date;
};

type DemandRow = QueryResultRow & {
  id: string; buyer_id: string; kind: ResourceKind; title: string; product_hint: string; region: string;
  quantity: string; capacity_unit: string; budget_max_cents: string | null; currency: 'CNY';
  desired_start_at: Date; deadline_at: Date; description: string; status: ComputeDemand['status']; created_at: Date; updated_at: Date;
};

function mapListing(row: ListingRow): MarketListing {
  return {
    id: row.id, productCode: row.product_code, kind: row.kind, region: row.region,
    specifications: row.specifications, availableQuantity: row.available_quantity,
    capacityUnit: row.capacity_unit, unitPriceCents: Number(row.unit_price_cents), currency: row.currency,
    minimumQuantity: row.minimum_quantity, sla: row.sla, expiresAt: new Date(row.expires_at), createdAt: new Date(row.created_at),
  };
}

function mapOrder(row: OrderRow): OrderRecord {
  return {
    id: row.id, orderNumber: row.order_number, buyerId: row.buyer_id, supplierId: row.supplier_id,
    listingId: row.listing_id, status: row.status, quantity: row.quantity, capacityUnit: row.capacity_unit,
    unitPriceCents: Number(row.unit_price_cents), subtotalCents: Number(row.subtotal_cents), feeCents: Number(row.fee_cents),
    totalCents: Number(row.total_cents), currency: row.currency, reservationExpiresAt: new Date(row.reservation_expires_at),
    createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at),
  };
}

function mapDemand(row: DemandRow): ComputeDemand {
  return {
    id: row.id, buyerId: row.buyer_id, kind: row.kind, title: row.title, productHint: row.product_hint,
    region: row.region, quantity: row.quantity, capacityUnit: row.capacity_unit,
    budgetMaxCents: row.budget_max_cents === null ? null : Number(row.budget_max_cents), currency: row.currency,
    desiredStartAt: new Date(row.desired_start_at), deadlineAt: new Date(row.deadline_at), description: row.description,
    status: row.status, createdAt: new Date(row.created_at), updatedAt: new Date(row.updated_at),
  };
}

const orderColumns = `id, order_number, buyer_id, supplier_id, listing_id, status, quantity, capacity_unit,
  unit_price_cents, subtotal_cents, fee_cents, total_cents, currency, reservation_expires_at, created_at, updated_at`;

function scaledQuantity(quantity: string) {
  const [whole = '0', fraction = ''] = quantity.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}

function calculateSubtotalCents(quantity: string, unitPriceCents: string) {
  const scaled = scaledQuantity(quantity);
  const cents = (scaled * BigInt(unitPriceCents) + 999_999n) / 1_000_000n;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('order amount exceeds safe range');
  return Number(cents);
}

export class PostgresMarketStore implements MarketStore {
  constructor(private readonly database: Database) {}

  async listVerifiedResources(input: { kind?: ResourceKind; region?: string; query?: string; cursor: ListingCursor | null; limit: number }) {
    const conditions = ["r.status = 'verified'", "s.status = 'approved'"];
    const values: unknown[] = [];
    const parameter = (value: unknown) => { values.push(value); return `$${values.length}`; };
    if (input.kind) conditions.push(`r.kind = ${parameter(input.kind)}`);
    if (input.region) conditions.push(`r.region = ${parameter(input.region)}`);
    if (input.query) {
      const value = parameter(`%${input.query}%`);
      conditions.push(`(r.product_code ILIKE ${value} OR r.region ILIKE ${value})`);
    }
    if (input.cursor) {
      const created = parameter(input.cursor.createdAt);
      const id = parameter(input.cursor.id);
      conditions.push(`(r.created_at < ${created} OR (r.created_at = ${created} AND r.id < ${id}))`);
    }
    const limit = parameter(input.limit);
    const result = await this.database.query<{
      id: string; product_code: string; kind: ResourceKind; region: string; specifications: Record<string, unknown>;
      capacity_total: string; capacity_unit: string; created_at: Date;
    }>(`SELECT r.id, r.product_code, r.kind, r.region, r.specifications,
          r.capacity_total::text, r.capacity_unit, r.created_at
        FROM compute_resources r JOIN supplier_profiles s ON s.id = r.supplier_id
        WHERE ${conditions.join(' AND ')} ORDER BY r.created_at DESC, r.id DESC LIMIT ${limit}`, values);
    return result.rows.map((row) => ({
      id: row.id, productCode: row.product_code, kind: row.kind, region: row.region,
      specifications: row.specifications, capacityTotal: row.capacity_total,
      capacityUnit: row.capacity_unit, createdAt: new Date(row.created_at),
    }));
  }

  async listListings(input: { kind?: ResourceKind; region?: string; query?: string; cursor: ListingCursor | null; limit: number }) {
    const conditions = [`l.status = 'active'`, 'l.starts_at <= now()', 'l.expires_at > now()', '(l.capacity_total - l.capacity_reserved - l.capacity_sold) > 0'];
    const values: unknown[] = [];
    const parameter = (value: unknown) => { values.push(value); return `$${values.length}`; };
    if (input.kind) conditions.push(`r.kind = ${parameter(input.kind)}`);
    if (input.region) conditions.push(`l.region = ${parameter(input.region)}`);
    if (input.query) {
      const value = parameter(`%${input.query}%`);
      conditions.push(`(l.product_code ILIKE ${value} OR l.region ILIKE ${value})`);
    }
    if (input.cursor) {
      const created = parameter(input.cursor.createdAt);
      const id = parameter(input.cursor.id);
      conditions.push(`(l.created_at < ${created} OR (l.created_at = ${created} AND l.id < ${id}))`);
    }
    const limit = parameter(input.limit);
    const result = await this.database.query<ListingRow>(
      `SELECT l.id, l.product_code, r.kind, l.region, r.specifications,
        (l.capacity_total - l.capacity_reserved - l.capacity_sold)::text AS available_quantity,
        l.capacity_unit, l.unit_price_cents::text, l.currency, l.minimum_quantity::text,
        l.sla, l.expires_at, l.created_at
       FROM market_listings l JOIN compute_resources r ON r.id = l.resource_id
       WHERE ${conditions.join(' AND ')} ORDER BY l.created_at DESC, l.id DESC LIMIT ${limit}`,
      values,
    );
    return result.rows.map(mapListing);
  }

  async getSupplierBySubject(subjectId: string) {
    const result = await this.database.query<{
      id: string; subject_id: string; legal_name: string; credit_code: string; contact_name: string;
      status: SupplierProfile['status']; rejection_reason: string | null;
    }>('SELECT id, subject_id, legal_name, credit_code, contact_name, status, rejection_reason FROM supplier_profiles WHERE subject_id = $1', [subjectId]);
    const row = result.rows[0];
    return row ? { id: row.id, subjectId: row.subject_id, legalName: row.legal_name, creditCode: row.credit_code, contactName: row.contact_name, status: row.status, rejectionReason: row.rejection_reason } : null;
  }

  async submitSupplier(input: { subjectId: string; userId: string; legalName: string; creditCode: string; contactName: string }) {
    const result = await this.database.query<{
      id: string; subject_id: string; legal_name: string; credit_code: string; contact_name: string;
      status: SupplierProfile['status']; rejection_reason: string | null;
    }>(`INSERT INTO supplier_profiles(id, created_by_user_id, subject_id, legal_name, credit_code, contact_name, status, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'submitted', now())
       ON CONFLICT (subject_id) DO UPDATE SET legal_name = EXCLUDED.legal_name, credit_code = EXCLUDED.credit_code,
         contact_name = EXCLUDED.contact_name, status = 'submitted', submitted_at = now(), rejection_reason = NULL
       WHERE supplier_profiles.status IN ('draft', 'rejected')
       RETURNING id, subject_id, legal_name, credit_code, contact_name, status, rejection_reason`,
    [randomUUID(), input.userId, input.subjectId, input.legalName, input.creditCode, input.contactName]);
    const row = result.rows[0];
    if (row) {
      return {
        id: row.id, subjectId: row.subject_id, legalName: row.legal_name,
        creditCode: row.credit_code, contactName: row.contact_name, status: row.status, rejectionReason: row.rejection_reason,
      };
    }
    const existing = await this.getSupplierBySubject(input.subjectId);
    if (!existing) throw new Error('supplier upsert failed');
    return existing;
  }

  async reviewSupplier(input: { supplierId: string; reviewerId: string; approved: boolean; reason?: string }) {
    const result = await this.database.query<{
      id: string; subject_id: string; legal_name: string; credit_code: string; contact_name: string;
      status: SupplierProfile['status']; rejection_reason: string | null;
    }>(`UPDATE supplier_profiles SET status = $2, rejection_reason = $3, reviewed_at = now(), reviewed_by = $4
       WHERE id = $1 AND status = 'submitted'
       RETURNING id, subject_id, legal_name, credit_code, contact_name, status, rejection_reason`,
    [input.supplierId, input.approved ? 'approved' : 'rejected', input.approved ? null : input.reason ?? '资料未通过审核', input.reviewerId]);
    const row = result.rows[0];
    return row ? { id: row.id, subjectId: row.subject_id, legalName: row.legal_name, creditCode: row.credit_code, contactName: row.contact_name, status: row.status, rejectionReason: row.rejection_reason } : null;
  }

  async listSupplierResources(subjectId: string) {
    const result = await this.database.query<SupplierResourceRow>(
      `SELECT r.id, r.supplier_id, r.kind, r.product_code, r.region, r.specifications,
        r.capacity_total::text, r.capacity_unit, r.status, v.status AS verification_status,
        v.requested_at, v.completed_at,
        CASE WHEN v.status IN ('pending', 'running') THEN previous.failure_reason ELSE v.failure_reason END AS failure_reason
       FROM compute_resources r JOIN supplier_profiles s ON s.id = r.supplier_id
       LEFT JOIN LATERAL (
         SELECT status, requested_at, completed_at, failure_reason FROM resource_verification_runs
         WHERE resource_id = r.id ORDER BY requested_at DESC LIMIT 1
       ) v ON true
       LEFT JOIN LATERAL (
         SELECT failure_reason FROM resource_verification_runs
         WHERE resource_id = r.id AND status = 'failed' AND failure_reason IS NOT NULL
         ORDER BY requested_at DESC LIMIT 1
       ) previous ON true
       WHERE s.subject_id = $1 ORDER BY r.created_at DESC LIMIT 100`, [subjectId],
    );
    return result.rows.map((row) => this.mapSupplierResource(row));
  }

  async listSupplierListings(subjectId: string) {
    const result = await this.database.query<SupplierListingRow>(
      `SELECT l.id, l.resource_id, l.product_code, l.region, l.capacity_total::text AS total_quantity,
        l.capacity_reserved::text AS reserved_quantity, l.capacity_sold::text AS sold_quantity,
        l.capacity_unit, l.unit_price_cents::text, l.currency, l.minimum_quantity::text,
        l.status, l.starts_at, l.expires_at, l.created_at
       FROM market_listings l JOIN supplier_profiles s ON s.id = l.supplier_id
       WHERE s.subject_id = $1 ORDER BY l.created_at DESC LIMIT 100`, [subjectId],
    );
    return result.rows.map((row) => ({
      id: row.id, resourceId: row.resource_id, productCode: row.product_code, region: row.region,
      totalQuantity: row.total_quantity, reservedQuantity: row.reserved_quantity, soldQuantity: row.sold_quantity,
      capacityUnit: row.capacity_unit, unitPriceCents: Number(row.unit_price_cents), currency: row.currency,
      minimumQuantity: row.minimum_quantity, status: row.status, startsAt: new Date(row.starts_at),
      expiresAt: new Date(row.expires_at), createdAt: new Date(row.created_at),
    }));
  }

  async createResource(input: {
    id: string; subjectId: string; requestedByUserId: string; kind: ResourceKind; productCode: string; region: string; specifications: Record<string, unknown>;
    capacityTotal: string; capacityUnit: string; assetFingerprint: string;
    assetIdentityKind: 'hardware_serial' | 'cloud_resource_id' | 'internal_asset_id'; clientRequestId: string; payloadDigest: string;
  }): Promise<CreateResourceResult | null> {
    return this.database.transaction(async (client) => {
      const supplier = await client.query<{ id: string }>(
        `SELECT id FROM supplier_profiles WHERE subject_id = $1 AND status = 'approved' FOR UPDATE`, [input.subjectId],
      );
      const supplierId = supplier.rows[0]?.id;
      if (!supplierId) return null;
      const replay = await client.query<ResourceRow & { payload_digest: string }>(
        `SELECT id, supplier_id, kind, product_code, region, specifications, capacity_total::text, capacity_unit,
          status, payload_digest FROM compute_resources
         WHERE supplier_id = $1 AND client_request_id = $2 FOR UPDATE`, [supplierId, input.clientRequestId],
      );
      if (replay.rows[0]) return replay.rows[0].payload_digest === input.payloadDigest
        ? { status: 'replayed', resource: this.mapResource(replay.rows[0]) }
        : { status: 'idempotency_conflict' };

      const identity = await client.query<ResourceRow>(
        `SELECT id, supplier_id, kind, product_code, region, specifications, capacity_total::text, capacity_unit, status
         FROM compute_resources WHERE asset_identity_kind = $1 AND asset_fingerprint = $2
           AND ($1 <> 'internal_asset_id' OR supplier_id = $3) FOR UPDATE`,
        [input.assetIdentityKind, input.assetFingerprint, supplierId],
      );
      if (identity.rows[0]) return identity.rows[0].supplier_id === supplierId
        ? { status: 'existing', resource: this.mapResource(identity.rows[0]) }
        : { status: 'identity_claimed' };

      const result = await client.query<{
        id: string; supplier_id: string; kind: ResourceKind; product_code: string; region: string;
        specifications: Record<string, unknown>; capacity_total: string; capacity_unit: string; status: ComputeResource['status'];
      }>(`INSERT INTO compute_resources(id, supplier_id, kind, product_code, region, specifications,
          capacity_total, capacity_unit, status, asset_fingerprint, asset_identity_kind, client_request_id, payload_digest)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'pending_verification', $9, $10, $11, $12)
         ON CONFLICT DO NOTHING
         RETURNING id, supplier_id, kind, product_code, region, specifications, capacity_total::text, capacity_unit, status`,
      [input.id, supplierId, input.kind, input.productCode, input.region, JSON.stringify(input.specifications),
        input.capacityTotal, input.capacityUnit, input.assetFingerprint, input.assetIdentityKind, input.clientRequestId, input.payloadDigest]);
      if (!result.rows[0]) {
        const concurrentRequest = await client.query<ResourceRow & { payload_digest: string }>(
          `SELECT id, supplier_id, kind, product_code, region, specifications, capacity_total::text, capacity_unit,
            status, payload_digest FROM compute_resources
           WHERE supplier_id = $1 AND client_request_id = $2`, [supplierId, input.clientRequestId],
        );
        if (concurrentRequest.rows[0]) return concurrentRequest.rows[0].payload_digest === input.payloadDigest
          ? { status: 'replayed', resource: this.mapResource(concurrentRequest.rows[0]) }
          : { status: 'idempotency_conflict' };
        const concurrentIdentity = await client.query<ResourceRow>(
          `SELECT id, supplier_id, kind, product_code, region, specifications, capacity_total::text, capacity_unit, status
           FROM compute_resources WHERE asset_identity_kind = $1 AND asset_fingerprint = $2
             AND ($1 <> 'internal_asset_id' OR supplier_id = $3)`, [input.assetIdentityKind, input.assetFingerprint, supplierId],
        );
        if (!concurrentIdentity.rows[0]) throw new Error('resource identity conflict could not be resolved');
        return concurrentIdentity.rows[0].supplier_id === supplierId
          ? { status: 'existing', resource: this.mapResource(concurrentIdentity.rows[0]) }
          : { status: 'identity_claimed' };
      }
      await client.query(
        `INSERT INTO resource_verification_runs(id, resource_id, requested_by, status) VALUES ($1, $2, $3, 'pending')`,
        [randomUUID(), input.id, input.requestedByUserId],
      );
      return { status: 'created', resource: this.mapResource(result.rows[0]) };
    });
  }

  async resubmitResourceVerification(input: {
    id: string; resourceId: string; subjectId: string; requestedByUserId: string; clientRequestId: string;
  }): Promise<ResubmitResourceResult> {
    return this.database.transaction(async (client) => {
      const resource = await client.query<ResourceRow>(
        `SELECT r.id, r.supplier_id, r.kind, r.product_code, r.region, r.specifications,
          r.capacity_total::text, r.capacity_unit, r.status
         FROM compute_resources r JOIN supplier_profiles s ON s.id = r.supplier_id
         WHERE r.id = $1 AND s.subject_id = $2 FOR UPDATE OF r`, [input.resourceId, input.subjectId],
      );
      const row = resource.rows[0];
      if (!row) return { status: 'not_found' };
      const replay = await client.query<{ resource_id: string }>(
        `SELECT resource_id FROM resource_verification_resubmissions
         WHERE supplier_id = $1 AND client_request_id = $2 FOR UPDATE`, [row.supplier_id, input.clientRequestId],
      );
      if (replay.rows[0]) return replay.rows[0].resource_id === input.resourceId
        ? { status: 'replayed', resource: await this.loadSupplierResource(client, input.resourceId) }
        : { status: 'idempotency_conflict' };
      if (row.status !== 'rejected') return { status: 'invalid_state' };
      const latest = await client.query<{ status: string }>(
        `SELECT status FROM resource_verification_runs WHERE resource_id = $1 ORDER BY requested_at DESC LIMIT 1 FOR UPDATE`,
        [input.resourceId],
      );
      if (latest.rows[0]?.status !== 'failed') return { status: 'invalid_state' };
      const runId = randomUUID();
      await client.query(
        `INSERT INTO resource_verification_runs(id, resource_id, requested_by, status) VALUES ($1, $2, $3, 'pending')`,
        [runId, input.resourceId, input.requestedByUserId],
      );
      await client.query(
        `INSERT INTO resource_verification_resubmissions(id, resource_id, supplier_id, verification_run_id, requested_by, client_request_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [input.id, input.resourceId, row.supplier_id, runId, input.requestedByUserId, input.clientRequestId],
      );
      await client.query(
        `UPDATE compute_resources SET status = 'pending_verification', verification_digest = NULL, verified_at = NULL,
          updated_at = now(), version = version + 1 WHERE id = $1`, [input.resourceId],
      );
      return { status: 'created', resource: await this.loadSupplierResource(client, input.resourceId) };
    });
  }

  async completeResourceVerification(input: {
    resourceId: string; reviewerId: string; passed: boolean; evidenceDigest: string; checks: Record<string, unknown>; failureReason?: string;
  }) {
    return this.database.transaction(async (client) => {
      const run = await client.query<{ id: string; requested_by: string }>(
        `SELECT id, requested_by FROM resource_verification_runs WHERE resource_id = $1 AND status = 'running'
         ORDER BY requested_at DESC LIMIT 1 FOR UPDATE`, [input.resourceId],
      );
      if (!run.rows[0]) return null;
      await client.query(
        `UPDATE resource_verification_runs SET status = $2, reviewed_by = $3, checks = $4::jsonb,
          evidence_digest = $5, failure_reason = $6, completed_at = now() WHERE id = $1`,
        [run.rows[0].id, input.passed ? 'passed' : 'failed', input.reviewerId, JSON.stringify(input.checks), input.evidenceDigest, input.failureReason ?? null],
      );
      const result = await client.query<{
        id: string; supplier_id: string; kind: ResourceKind; product_code: string; region: string;
        specifications: Record<string, unknown>; capacity_total: string; capacity_unit: string; status: ComputeResource['status'];
      }>(`UPDATE compute_resources SET status = $2, verification_digest = $3, verified_at = CASE WHEN $2 = 'verified' THEN now() ELSE NULL END
         WHERE id = $1 RETURNING id, supplier_id, kind, product_code, region, specifications, capacity_total::text, capacity_unit, status`,
      [input.resourceId, input.passed ? 'verified' : 'rejected', input.evidenceDigest]);
      if (result.rows[0]) {
        const supplier = await client.query<{ subject_id: string }>(
          `SELECT subject_id FROM supplier_profiles WHERE id = $1`, [result.rows[0].supplier_id],
        );
        const notificationId = randomUUID();
        const title = input.passed ? '资源验真已通过' : '资源审核需要补充';
        const body = input.passed
          ? '资源事实已通过审核，可以继续填写上架方案。'
          : `审核意见：${(input.failureReason?.trim() || '请按审核意见更换对应材料后重新提交。').slice(0, 1_000)}`;
        await client.query(
          `INSERT INTO notifications(id, user_id, category, title, body, data)
           VALUES ($1, $2, 'market', $3, $4, $5::jsonb)`,
          [notificationId, run.rows[0].requested_by, title, body,
            JSON.stringify({
              route: 'provider_resource', subjectId: supplier.rows[0]?.subject_id,
              resourceId: input.resourceId, verificationRunId: run.rows[0].id, passed: input.passed,
            })],
        );
        await client.query(
          `INSERT INTO outbox_events(id, topic, aggregate_type, aggregate_id, payload)
           VALUES ($1, 'notification.created', 'NOTIFICATION', $2, $3::jsonb)`,
          [randomUUID(), notificationId, JSON.stringify({ notificationId, userId: run.rows[0].requested_by })],
        );
      }
      return result.rows[0] ? this.mapResource(result.rows[0]) : null;
    });
  }

  async createListing(input: {
    id: string; subjectId: string; publishedByUserId: string; resourceId: string; capacityTotal: string; unitPriceCents: number;
    minimumQuantity: string; startsAt: Date; expiresAt: Date; sla: Record<string, unknown>;
  }) {
    return this.database.transaction(async (client) => {
      const resource = await client.query<{
        supplier_id: string; kind: ResourceKind; product_code: string; region: string; specifications: Record<string, unknown>; capacity_total: string; capacity_unit: string;
      }>(`SELECT r.supplier_id, r.kind, r.product_code, r.region, r.specifications, r.capacity_total::text, r.capacity_unit
         FROM compute_resources r JOIN supplier_profiles s ON s.id = r.supplier_id
         WHERE r.id = $1 AND s.subject_id = $2 AND s.status = 'approved' AND r.status = 'verified' FOR UPDATE OF r`,
      [input.resourceId, input.subjectId]);
      const row = resource.rows[0];
      if (!row || scaledQuantity(input.capacityTotal) > scaledQuantity(row.capacity_total)) return null;
      const result = await client.query<ListingRow>(
        `INSERT INTO market_listings(id, resource_id, supplier_id, product_code, region, capacity_total,
          capacity_unit, unit_price_cents, minimum_quantity, status, starts_at, expires_at, sla)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10, $11, $12::jsonb)
         RETURNING id, product_code, $13::text AS kind, region, $14::jsonb AS specifications,
          capacity_total::text AS available_quantity, capacity_unit, unit_price_cents::text, currency,
          minimum_quantity::text, sla, expires_at, created_at`,
      [input.id, input.resourceId, row.supplier_id, row.product_code, row.region, input.capacityTotal, row.capacity_unit,
        input.unitPriceCents, input.minimumQuantity, input.startsAt, input.expiresAt, JSON.stringify(input.sla), row.kind, JSON.stringify(row.specifications)]);
      return mapListing(result.rows[0]!);
    });
  }

  async createDemand(input: {
    id: string; buyerId: string; kind: ResourceKind; title: string; productHint: string; region: string;
    quantity: string; capacityUnit: string; budgetMaxCents: number | null;
    desiredStartAt: Date; deadlineAt: Date; description: string;
  }) {
    const result = await this.database.query<DemandRow>(
      `INSERT INTO compute_demands(id, buyer_id, kind, title, product_hint, region, quantity, capacity_unit,
        budget_max_cents, desired_start_at, deadline_at, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, buyer_id, kind, title, product_hint, region, quantity::text, capacity_unit,
        budget_max_cents::text, currency, desired_start_at, deadline_at, description, status, created_at, updated_at`,
      [input.id, input.buyerId, input.kind, input.title, input.productHint, input.region, input.quantity,
        input.capacityUnit, input.budgetMaxCents, input.desiredStartAt, input.deadlineAt, input.description],
    );
    return mapDemand(result.rows[0]!);
  }

  async listDemands(userId: string) {
    const result = await this.database.query<DemandRow>(
      `SELECT id, buyer_id, kind, title, product_hint, region, quantity::text, capacity_unit,
        budget_max_cents::text, currency, desired_start_at, deadline_at, description, status, created_at, updated_at
       FROM compute_demands WHERE buyer_id = $1 ORDER BY created_at DESC LIMIT 100`, [userId],
    );
    return result.rows.map(mapDemand);
  }

  async cancelDemand(userId: string, demandId: string) {
    const result = await this.database.query<DemandRow>(
      `UPDATE compute_demands SET status = 'cancelled', updated_at = now()
       WHERE id = $1 AND buyer_id = $2 AND status = 'open'
       RETURNING id, buyer_id, kind, title, product_hint, region, quantity::text, capacity_unit,
        budget_max_cents::text, currency, desired_start_at, deadline_at, description, status, created_at, updated_at`,
      [demandId, userId],
    );
    return result.rows[0] ? mapDemand(result.rows[0]) : null;
  }

  async createOrder(input: {
    id: string; orderNumber: string; buyerId: string; listingId: string; quantity: string;
    reservationExpiresAt: Date;
    idempotencyKey: string; payloadHash: string;
  }): Promise<CreateOrderResult> {
    return this.database.transaction(async (client) => {
      const existing = await client.query<{ payload_hash: string; state: string; response_body: { orderId?: string } | null }>(
        `SELECT payload_hash, state, response_body FROM idempotency_records
         WHERE actor_id = $1 AND scope = 'CREATE_ORDER' AND idempotency_key = $2 FOR UPDATE`,
        [input.buyerId, input.idempotencyKey],
      );
      const record = existing.rows[0];
      if (record) {
        if (record.payload_hash !== input.payloadHash) return { status: 'idempotency_conflict' };
        if (record.state !== 'completed' || !record.response_body?.orderId) return { status: 'in_progress' };
        const replayed = await client.query<OrderRow>(`SELECT ${orderColumns} FROM orders WHERE id = $1`, [record.response_body.orderId]);
        return { status: 'replayed', order: mapOrder(replayed.rows[0]!) };
      }
      await client.query(
        `INSERT INTO idempotency_records(id, actor_id, scope, idempotency_key, payload_hash, state, expires_at)
         VALUES ($1, $2, 'CREATE_ORDER', $3, $4, 'processing', now() + interval '24 hours')`,
        [randomUUID(), input.buyerId, input.idempotencyKey, input.payloadHash],
      );
      const listing = await client.query<{
        supplier_id: string; product_code: string; region: string; capacity_unit: string; unit_price_cents: string;
        minimum_quantity: string; available: string; snapshot: Record<string, unknown>;
      }>(`SELECT l.supplier_id, l.product_code, l.region, l.capacity_unit, l.unit_price_cents::text,
          l.minimum_quantity::text, (l.capacity_total - l.capacity_reserved - l.capacity_sold)::text AS available,
          jsonb_build_object('productCode', l.product_code, 'region', l.region, 'unitPriceCents', l.unit_price_cents,
            'capacityUnit', l.capacity_unit, 'sla', l.sla, 'resourceId', l.resource_id) AS snapshot
         FROM market_listings l WHERE l.id = $1 AND l.status = 'active' AND l.starts_at <= now() AND l.expires_at > now()
         FOR UPDATE`, [input.listingId]);
      const offer = listing.rows[0];
      if (!offer || scaledQuantity(offer.available) < scaledQuantity(input.quantity)
        || scaledQuantity(input.quantity) < scaledQuantity(offer.minimum_quantity)) {
        await client.query(`UPDATE idempotency_records SET state = 'failed', response_status = 409 WHERE actor_id = $1 AND scope = 'CREATE_ORDER' AND idempotency_key = $2`, [input.buyerId, input.idempotencyKey]);
        return { status: 'listing_unavailable' };
      }
      const subtotalCents = calculateSubtotalCents(input.quantity, offer.unit_price_cents);
      const feeCents = 0;
      const totalCents = subtotalCents + feeCents;
      await client.query('UPDATE market_listings SET capacity_reserved = capacity_reserved + $2 WHERE id = $1', [input.listingId, input.quantity]);
      const order = await client.query<OrderRow>(
        `INSERT INTO orders(id, order_number, buyer_id, supplier_id, listing_id, status, quantity,
          capacity_unit, unit_price_cents, subtotal_cents, fee_cents, total_cents, listing_snapshot, reservation_expires_at)
         VALUES ($1, $2, $3, $4, $5, 'payment_pending', $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
         RETURNING ${orderColumns}`,
        [input.id, input.orderNumber, input.buyerId, offer.supplier_id, input.listingId, input.quantity,
          offer.capacity_unit, Number(offer.unit_price_cents), subtotalCents, feeCents, totalCents,
          JSON.stringify(offer.snapshot), input.reservationExpiresAt],
      );
      await client.query(
        `INSERT INTO capacity_reservations(id, order_id, listing_id, buyer_id, quantity, status, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'active', $6)`,
        [randomUUID(), input.id, input.listingId, input.buyerId, input.quantity, input.reservationExpiresAt],
      );
      await this.appendOrderEvent(client, input.id, input.buyerId, 'ORDER_CREATED', null, 'payment_pending', {});
      await this.enqueue(client, 'order.created', 'ORDER', input.id, { orderId: input.id, buyerId: input.buyerId });
      await client.query(
        `UPDATE idempotency_records SET state = 'completed', response_status = 201,
          response_body = $3::jsonb WHERE actor_id = $1 AND scope = 'CREATE_ORDER' AND idempotency_key = $2`,
        [input.buyerId, input.idempotencyKey, JSON.stringify({ orderId: input.id })],
      );
      return { status: 'created', order: mapOrder(order.rows[0]!) };
    });
  }

  async listOrders(userId: string) {
    const result = await this.database.query<OrderRow>(
      `SELECT DISTINCT o.${orderColumns.replaceAll(', ', ', o.')} FROM orders o
       LEFT JOIN supplier_profiles s ON s.id = o.supplier_id
       WHERE o.buyer_id = $1 OR s.user_id = $1 ORDER BY o.created_at DESC LIMIT 100`, [userId],
    );
    return result.rows.map(mapOrder);
  }

  async getOrder(userId: string, orderId: string) {
    const result = await this.database.query<OrderRow>(
      `SELECT o.${orderColumns.replaceAll(', ', ', o.')} FROM orders o LEFT JOIN supplier_profiles s ON s.id = o.supplier_id
       WHERE o.id = $1 AND (o.buyer_id = $2 OR s.user_id = $2)`, [orderId, userId],
    );
    return result.rows[0] ? mapOrder(result.rows[0]) : null;
  }

  async cancelOrder(userId: string, orderId: string) {
    return this.database.transaction(async (client) => {
      const current = await client.query<OrderRow>(`SELECT ${orderColumns} FROM orders WHERE id = $1 AND buyer_id = $2 FOR UPDATE`, [orderId, userId]);
      const order = current.rows[0];
      if (!order || !['reserved', 'payment_pending'].includes(order.status)) return null;
      await this.releaseReservation(client, orderId, 'released', 'buyer_cancelled');
      const updated = await client.query<OrderRow>(
        `UPDATE orders SET status = 'cancelled', cancelled_at = now() WHERE id = $1 RETURNING ${orderColumns}`, [orderId],
      );
      await this.appendOrderEvent(client, orderId, userId, 'ORDER_CANCELLED', order.status, 'cancelled', {});
      await this.enqueue(client, 'order.cancelled', 'ORDER', orderId, { orderId, buyerId: userId });
      return mapOrder(updated.rows[0]!);
    });
  }

  async startDelivery(userId: string, orderId: string) {
    return this.deliveryTransition(userId, orderId, ['paid', 'delivery_pending'], 'delivering', 'DELIVERY_STARTED');
  }

  async markDeliveryReady(userId: string, orderId: string, metadataCiphertext: string) {
    return this.database.transaction(async (client) => {
      const current = await this.lockSupplierOrder(client, userId, orderId);
      if (!current || current.status !== 'delivering') return null;
      await client.query(
        `INSERT INTO delivery_tasks(id, order_id, supplier_id, status, delivery_metadata_ciphertext, ready_at)
         VALUES ($1, $2, $3, 'ready', $4, now())
         ON CONFLICT (order_id) DO UPDATE SET status = 'ready', delivery_metadata_ciphertext = EXCLUDED.delivery_metadata_ciphertext, ready_at = now()`,
        [randomUUID(), orderId, current.supplier_id, metadataCiphertext],
      );
      const updated = await client.query<OrderRow>(
        `UPDATE orders SET status = 'acceptance_pending' WHERE id = $1 RETURNING ${orderColumns}`, [orderId],
      );
      await this.appendOrderEvent(client, orderId, userId, 'DELIVERY_READY', 'delivering', 'acceptance_pending', {});
      await this.enqueue(client, 'delivery.ready', 'ORDER', orderId, { orderId, buyerId: current.buyer_id });
      return mapOrder(updated.rows[0]!);
    });
  }

  async acceptDelivery(userId: string, orderId: string, evidenceDigest?: string) {
    return this.database.transaction(async (client) => {
      const current = await client.query<OrderRow>(`SELECT ${orderColumns} FROM orders WHERE id = $1 AND buyer_id = $2 FOR UPDATE`, [orderId, userId]);
      const order = current.rows[0];
      if (!order || order.status !== 'acceptance_pending') return null;
      await client.query(
        `INSERT INTO acceptance_records(id, order_id, buyer_id, result, evidence_digest) VALUES ($1, $2, $3, 'accepted', $4)`,
        [randomUUID(), orderId, userId, evidenceDigest ?? null],
      );
      await client.query(`UPDATE capacity_reservations SET status = 'captured' WHERE order_id = $1 AND status = 'active'`, [orderId]);
      await client.query(
        `UPDATE market_listings SET capacity_reserved = capacity_reserved - $2, capacity_sold = capacity_sold + $2 WHERE id = $1`,
        [order.listing_id, order.quantity],
      );
      const updated = await client.query<OrderRow>(
        `UPDATE orders SET status = 'accepted', accepted_at = now() WHERE id = $1 RETURNING ${orderColumns}`, [orderId],
      );
      await this.appendOrderEvent(client, orderId, userId, 'DELIVERY_ACCEPTED', 'acceptance_pending', 'accepted', { evidenceDigest });
      await this.enqueue(client, 'delivery.accepted', 'ORDER', orderId, { orderId, buyerId: userId });
      return mapOrder(updated.rows[0]!);
    });
  }

  async markOrderPaid(orderId: string, paymentIntentId: string) {
    return this.database.transaction(async (client) => {
      const current = await client.query<OrderRow>(`SELECT ${orderColumns} FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
      const order = current.rows[0];
      if (!order) return null;
      if (order.status === 'paid') return mapOrder(order);
      if (order.status !== 'payment_pending' || order.reservation_expires_at <= new Date()) return null;
      const updated = await client.query<OrderRow>(
        `UPDATE orders SET status = 'paid', paid_at = now() WHERE id = $1 RETURNING ${orderColumns}`, [orderId],
      );
      await this.appendOrderEvent(client, orderId, null, 'PAYMENT_CONFIRMED', 'payment_pending', 'paid', { paymentIntentId });
      await this.enqueue(client, 'payment.confirmed', 'ORDER', orderId, { orderId, paymentIntentId });
      return mapOrder(updated.rows[0]!);
    });
  }

  async expireReservations(now: Date, limit: number) {
    return this.database.transaction(async (client) => {
      const result = await client.query<{ order_id: string }>(
        `SELECT order_id FROM capacity_reservations WHERE status = 'active' AND expires_at <= $1::timestamptz
         ORDER BY expires_at LIMIT $2::integer FOR UPDATE SKIP LOCKED`, [now, limit],
      );
      for (const row of result.rows) {
        await this.releaseReservation(client, row.order_id, 'expired', 'reservation_expired');
        await client.query(`UPDATE orders SET status = 'cancelled', cancelled_at = $2::timestamptz WHERE id = $1 AND status = 'payment_pending'`, [row.order_id, now]);
        await this.appendOrderEvent(client, row.order_id, null, 'RESERVATION_EXPIRED', 'payment_pending', 'cancelled', {});
      }
      return result.rows.length;
    });
  }

  private mapResource(row: ResourceRow): ComputeResource {
    return {
      id: row.id, supplierId: row.supplier_id, kind: row.kind, productCode: row.product_code, region: row.region,
      specifications: row.specifications, capacityTotal: row.capacity_total, capacityUnit: row.capacity_unit, status: row.status,
    };
  }

  private mapSupplierResource(row: SupplierResourceRow): SupplierResource {
    return {
      ...this.mapResource(row),
      verification: row.verification_status && row.requested_at ? {
        status: row.verification_status, requestedAt: new Date(row.requested_at),
        completedAt: row.completed_at ? new Date(row.completed_at) : null,
        failureReason: row.failure_reason,
      } : null,
    };
  }

  private async loadSupplierResource(client: PoolClient, resourceId: string) {
    const result = await client.query<SupplierResourceRow>(
      `SELECT r.id, r.supplier_id, r.kind, r.product_code, r.region, r.specifications,
        r.capacity_total::text, r.capacity_unit, r.status, v.status AS verification_status,
        v.requested_at, v.completed_at,
        CASE WHEN v.status IN ('pending', 'running') THEN previous.failure_reason ELSE v.failure_reason END AS failure_reason
       FROM compute_resources r
       LEFT JOIN LATERAL (
         SELECT status, requested_at, completed_at, failure_reason FROM resource_verification_runs
         WHERE resource_id = r.id ORDER BY requested_at DESC LIMIT 1
       ) v ON true
       LEFT JOIN LATERAL (
         SELECT failure_reason FROM resource_verification_runs
         WHERE resource_id = r.id AND status = 'failed' AND failure_reason IS NOT NULL
         ORDER BY requested_at DESC LIMIT 1
       ) previous ON true WHERE r.id = $1`, [resourceId],
    );
    if (!result.rows[0]) throw new Error('resource disappeared during verification resubmission');
    return this.mapSupplierResource(result.rows[0]);
  }

  private async deliveryTransition(userId: string, orderId: string, allowed: OrderRecord['status'][], next: OrderRecord['status'], event: string) {
    return this.database.transaction(async (client) => {
      const current = await this.lockSupplierOrder(client, userId, orderId);
      if (!current || !allowed.includes(current.status)) return null;
      await client.query(
        `INSERT INTO delivery_tasks(id, order_id, supplier_id, status, started_at)
         VALUES ($1, $2, $3, 'provisioning', now())
         ON CONFLICT (order_id) DO UPDATE SET status = 'provisioning', started_at = COALESCE(delivery_tasks.started_at, now())`,
        [randomUUID(), orderId, current.supplier_id],
      );
      const updated = await client.query<OrderRow>(`UPDATE orders SET status = $2 WHERE id = $1 RETURNING ${orderColumns}`, [orderId, next]);
      await this.appendOrderEvent(client, orderId, userId, event, current.status, next, {});
      return mapOrder(updated.rows[0]!);
    });
  }

  private lockSupplierOrder(client: PoolClient, userId: string, orderId: string) {
    return client.query<OrderRow>(
      `SELECT o.${orderColumns.replaceAll(', ', ', o.')} FROM orders o JOIN supplier_profiles s ON s.id = o.supplier_id
       WHERE o.id = $1 AND s.user_id = $2 FOR UPDATE OF o`, [orderId, userId],
    ).then((result) => result.rows[0] ?? null);
  }

  private async releaseReservation(client: PoolClient, orderId: string, status: 'released' | 'expired', reason: string) {
    const reservation = await client.query<{ listing_id: string; quantity: string }>(
      `UPDATE capacity_reservations SET status = $2::text, released_at = now(), release_reason = $3
       WHERE order_id = $1 AND status = 'active' RETURNING listing_id, quantity::text`, [orderId, status, reason],
    );
    const row = reservation.rows[0];
    if (row) await client.query('UPDATE market_listings SET capacity_reserved = capacity_reserved - $2::numeric WHERE id = $1', [row.listing_id, row.quantity]);
  }

  private appendOrderEvent(
    client: PoolClient, orderId: string, actorId: string | null, eventType: string,
    fromStatus: string | null, toStatus: string, payload: Record<string, unknown>,
  ) {
    return client.query(
      `INSERT INTO order_events(id, order_id, actor_id, event_type, from_status, to_status, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [randomUUID(), orderId, actorId, eventType, fromStatus, toStatus, JSON.stringify(payload)],
    ).then(() => undefined);
  }

  private enqueue(client: PoolClient, topic: string, aggregateType: string, aggregateId: string, payload: Record<string, unknown>) {
    return client.query(
      `INSERT INTO outbox_events(id, topic, aggregate_type, aggregate_id, payload) VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [randomUUID(), topic, aggregateType, aggregateId, JSON.stringify(payload)],
    ).then(() => undefined);
  }
}
