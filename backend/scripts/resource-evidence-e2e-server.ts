import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PGlite, type Results, type Transaction } from '@electric-sql/pglite';
import type { PoolClient } from 'pg';
import { buildApp } from '../src/app.js';
import { encryptPii, lookupHash, secretHash } from '../src/account/crypto.js';
import { AccountService } from '../src/account/service.js';
import type { SmsProvider } from '../src/account/sms.js';
import { PostgresAccountStore } from '../src/account/store.js';
import { loadConfig } from '../src/config.js';
import type { Database } from '../src/database.js';
import type { MalwareScanner } from '../src/evidence/scanner.js';
import { EvidenceScanWorker } from '../src/evidence/worker.js';
import { MarketService } from '../src/market/service.js';
import { PostgresMarketStore } from '../src/market/store.js';
import { ListingAuditService } from '../src/listings/service.js';
import { PostgresListingAuditStore } from '../src/listings/store.js';
import { creditMicrosFromCnyMicros, KAI_CNY_MICROS_PER_CREDIT } from '../src/listings/types.js';
import { NotificationService } from '../src/notifications/service.js';
import { PostgresNotificationStore } from '../src/notifications/store.js';
import { ResourceEvidenceScanStore } from '../src/resource-evidence/scan-store.js';
import { ResourceEvidenceService } from '../src/resource-evidence/service.js';
import { ResourceEvidenceStore } from '../src/resource-evidence/store.js';
import { migrationManifest } from '../src/schema.js';
import type { PrivateObjectStore, StoredObjectMetadata, UploadGrant } from '../src/storage/object-store.js';
import { SubjectService } from '../src/subjects/service.js';
import { PostgresSubjectStore } from '../src/subjects/store.js';
import { CreditLedgerService } from '../src/credits/service.js';
import { PostgresCreditLedgerStore } from '../src/credits/store.js';
import { KAI_CREDIT_PLATFORM_ACCOUNTS } from '../src/credits/types.js';
import { CreditOrderService } from '../src/credit-orders/service.js';
import { PostgresCreditOrderStore } from '../src/credit-orders/store.js';
import { CreditTopupService } from '../src/topups/service.js';
import { PostgresCreditTopupStore } from '../src/topups/store.js';

const apiPort = 4100;
const objectPort = 4101;
const testPhone = '13800138000';

function pgResult<T>(value: Results<T>) {
  return { ...value, rowCount: value.rows.length || value.affectedRows || 0, command: '', oid: 0, rowAsArray: false };
}

function adapter(pglite: PGlite): Database {
  return {
    health: async () => true,
    schemaReadiness: async () => ({ ready: true, expected: 'e2e', applied: 'e2e', missing: [], mismatched: [] }),
    query: async (text: string, values?: unknown[]) => pgResult(await pglite.query(text, values)),
    transaction: async <T>(work: (client: PoolClient) => Promise<T>) => pglite.transaction(async (transaction: Transaction) => work({
      query: async (text: string, values?: unknown[]) => pgResult(await transaction.query(text, values)),
    } as unknown as PoolClient)),
    close: () => pglite.close(),
  } as unknown as Database;
}

class CapturingSms implements SmsProvider {
  latest: { phone: string; code: string } | null = null;
  async sendOtp(phone: string, code: string) { this.latest = { phone, code }; }
}

class LocalObjects implements PrivateObjectStore {
  readonly bodies = new Map<string, Uint8Array>();
  readonly metadata = new Map<string, StoredObjectMetadata>();

  async createUploadGrant(input: { objectKey: string; mimeType: string; sizeBytes: number; sha256Hex: string; expiresAt: Date }): Promise<UploadGrant> {
    return {
      url: `http://10.0.2.2:${objectPort}/upload/${encodeURIComponent(input.objectKey)}`,
      method: 'PUT', expiresAt: input.expiresAt,
      headers: {
        'content-type': input.mimeType,
        'content-length': String(input.sizeBytes),
        'x-kai-sha256': input.sha256Hex,
      },
    };
  }
  async head(objectKey: string) {
    const found = this.metadata.get(objectKey);
    if (!found) throw new Error('E2E_OBJECT_NOT_FOUND');
    return found;
  }
  async createDownloadUrl(objectKey: string) { return `http://10.0.2.2:${objectPort}/download/${encodeURIComponent(objectKey)}`; }
  async readBytes(objectKey: string) {
    const found = this.bodies.get(objectKey);
    if (!found) throw new Error('E2E_OBJECT_NOT_FOUND');
    return found;
  }
  async delete(objectKey: string) { this.bodies.delete(objectKey); this.metadata.delete(objectKey); }
}

const pglite = new PGlite();
for (const migration of await migrationManifest()) await pglite.exec(migration.sql);
const database = adapter(pglite);
const config = loadConfig({
  NODE_ENV: 'test', PUBLIC_ORIGIN: `http://127.0.0.1:${apiPort}`,
  ACCESS_TOKEN_SECRET: 'e2e-access-'.padEnd(64, 'a'), REFRESH_TOKEN_PEPPER: 'e2e-refresh-'.padEnd(32, 'b'),
  OTP_PEPPER: 'e2e-otp-'.padEnd(32, 'c'), AUDIT_PEPPER: 'e2e-audit-'.padEnd(32, 'd'),
  CURSOR_SECRET: 'e2e-cursor-'.padEnd(32, 'e'), PII_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
});
const accounts = new PostgresAccountStore(database);
const subjectsStore = new PostgresSubjectStore(database);
const listingStore = new PostgresListingAuditStore(database);
const subjects = new SubjectService(subjectsStore, accounts, config, listingStore);
const marketStore = new PostgresMarketStore(database);
const sms = new CapturingSms();
const accountService = new AccountService(accounts, sms, config);
const marketService = new MarketService(marketStore, accounts, config, subjects);
const listingAuditService = new ListingAuditService(listingStore, accounts, config, subjects);
const notificationService = new NotificationService(new PostgresNotificationStore(database), accounts, config);
const objects = new LocalObjects();
const evidenceService = new ResourceEvidenceService(new ResourceEvidenceStore(database), accounts, subjects, objects, config);
const creditLedgerStore = new PostgresCreditLedgerStore(database);
const creditLedgerService = new CreditLedgerService(creditLedgerStore, subjects);
const creditOrderStore = new PostgresCreditOrderStore(database);
const creditOrderService = new CreditOrderService(creditOrderStore, subjects, config);
const creditTopupService = new CreditTopupService(
  new PostgresCreditTopupStore(database), accounts, subjects, new Map(), config,
);

const phone = `+86${testPhone}`;
const user = await accounts.createUser({
  phoneCiphertext: encryptPii(phone, config.PII_ENCRYPTION_KEY!),
  phoneLookupHash: lookupHash(phone, config.OTP_PEPPER!), displayName: '安卓验收资源方',
});
await database.query(`UPDATE users SET role = 'supplier' WHERE id = $1`, [user.id]);
const personal = await subjectsStore.ensurePersonal(user.id);
await subjectsStore.select(user.id, personal.subjectId);
const buyer = await accounts.createUser({
  phoneCiphertext: encryptPii('+8613800138001', config.PII_ENCRYPTION_KEY!),
  phoneLookupHash: lookupHash('+8613800138001', config.OTP_PEPPER!), displayName: '安卓验收购买方',
});
const buyerPersonal = await subjectsStore.ensurePersonal(buyer.id);
await subjectsStore.select(buyer.id, buyerPersonal.subjectId);
const profile = await marketStore.submitSupplier({
  subjectId: personal.subjectId, userId: user.id, legalName: 'KAI 安卓验收资源方',
  creditCode: '91310000E2E0000001', contactName: '验收员',
});
const operator = await accounts.createUser({
  phoneCiphertext: encryptPii('+8613900139000', config.PII_ENCRYPTION_KEY!),
  phoneLookupHash: lookupHash('+8613900139000', config.OTP_PEPPER!), displayName: '验收运营',
});
await database.query(`UPDATE users SET role = 'operator' WHERE id = $1`, [operator.id]);
const priceOperator = await accounts.createUser({
  phoneCiphertext: encryptPii('+8613900139001', config.PII_ENCRYPTION_KEY!),
  phoneLookupHash: lookupHash('+8613900139001', config.OTP_PEPPER!), displayName: '验收价格审核员',
});
await database.query(`UPDATE users SET role = 'operator' WHERE id = $1`, [priceOperator.id]);
await marketStore.reviewSupplier({ supplierId: profile.id, reviewerId: operator.id, approved: true });

const app = await buildApp({
  config, database, accountService, subjectService: subjects, marketService,
  listingAuditService, notificationService, resourceEvidenceService: evidenceService, creditLedgerService, creditOrderService,
  creditTopupService,
  logger: process.env.E2E_LOG_ERRORS === '1',
});
let lastListingRequest: { body: unknown; receivedAt: string } | null = null;
app.addHook('preHandler', async (request) => {
  if (request.method === 'POST' && request.url === '/mobile/v1/provider/listings') {
    lastListingRequest = { body: request.body, receivedAt: new Date().toISOString() };
  }
});
app.get('/__e2e/otp', async () => ({ ok: true, phone: sms.latest?.phone ?? null, code: sms.latest?.code ?? null }));
app.post('/__e2e/approve-subject-supplier', async (request, reply) => {
  if (request.ip !== '127.0.0.1' && request.ip !== '::1') return reply.status(403).send({ ok: false });
  const requested = request.body && typeof request.body === 'object' && 'subjectId' in request.body
    ? String(request.body.subjectId) : '';
  if (!/^[0-9a-f-]{36}$/iu.test(requested)) return reply.status(400).send({ ok: false, reason: 'SUBJECT_ID_REQUIRED' });
  const target = await marketStore.getSupplierBySubject(requested);
  if (!target) return reply.status(404).send({ ok: false, reason: 'SUPPLIER_NOT_FOUND' });
  const reviewed = target.status === 'submitted'
    ? await marketStore.reviewSupplier({ supplierId: target.id, reviewerId: operator.id, approved: true })
    : target;
  if (!reviewed || reviewed.status !== 'approved') {
    return reply.status(409).send({ ok: false, reason: 'SUPPLIER_REVIEW_STATE_INVALID', status: reviewed?.status ?? null });
  }
  return { ok: true, profile: reviewed };
});
app.post('/__e2e/reject-subject-supplier', async (request, reply) => {
  if (request.ip !== '127.0.0.1' && request.ip !== '::1') return reply.status(403).send({ ok: false });
  const body = request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : {};
  const requested = typeof body.subjectId === 'string' ? body.subjectId : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!/^[0-9a-f-]{36}$/iu.test(requested) || reason.length < 2 || reason.length > 1_000) {
    return reply.status(400).send({ ok: false, reason: 'SUBJECT_ID_AND_REASON_REQUIRED' });
  }
  const target = await marketStore.getSupplierBySubject(requested);
  if (!target) return reply.status(404).send({ ok: false, reason: 'SUPPLIER_NOT_FOUND' });
  const reviewed = target.status === 'submitted'
    ? await marketStore.reviewSupplier({ supplierId: target.id, reviewerId: operator.id, approved: false, reason })
    : target;
  if (!reviewed || reviewed.status !== 'rejected') {
    return reply.status(409).send({ ok: false, reason: 'SUPPLIER_REVIEW_STATE_INVALID', status: reviewed?.status ?? null });
  }
  return { ok: true, profile: reviewed };
});
app.post('/__e2e/approve-pending-supplier', async (request, reply) => {
  if (request.ip !== '127.0.0.1' && request.ip !== '::1') return reply.status(403).send({ ok: false });
  const pending = await database.query<{ id: string; subject_id: string }>(
    `SELECT id, subject_id FROM supplier_profiles WHERE status = 'submitted' ORDER BY submitted_at DESC LIMIT 1`,
  );
  const target = pending.rows[0];
  if (!target) return reply.status(409).send({ ok: false, reason: 'NO_PENDING_SUPPLIER' });
  const reviewed = await marketStore.reviewSupplier({ supplierId: target.id, reviewerId: operator.id, approved: true });
  return { ok: true, subjectId: target.subject_id, profile: reviewed };
});
app.post('/__e2e/reject-pending-supplier', async (request, reply) => {
  if (request.ip !== '127.0.0.1' && request.ip !== '::1') return reply.status(403).send({ ok: false });
  const body = request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : {};
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 2 || reason.length > 1_000) return reply.status(400).send({ ok: false, reason: 'REASON_REQUIRED' });
  const pending = await database.query<{ id: string; subject_id: string }>(
    `SELECT id, subject_id FROM supplier_profiles WHERE status = 'submitted' ORDER BY submitted_at DESC LIMIT 1`,
  );
  const target = pending.rows[0];
  if (!target) return reply.status(409).send({ ok: false, reason: 'NO_PENDING_SUPPLIER' });
  const reviewed = await marketStore.reviewSupplier({
    supplierId: target.id, reviewerId: operator.id, approved: false, reason,
  });
  return { ok: true, subjectId: target.subject_id, profile: reviewed };
});
app.get('/__e2e/state', async () => {
  const resources = await marketStore.listSupplierResources(personal.subjectId);
  const drafts = await database.query<{ id: string; resource_id: string; current_step: string; status: string }>(
    `SELECT id, resource_id, current_step, status FROM offer_wizard_drafts ORDER BY created_at`,
  );
  const offers = await database.query<{ id: string; resource_id: string; title: string; status: string }>(
    `SELECT id, resource_id, title, status FROM offer_templates ORDER BY created_at`,
  );
  const audits = await database.query<{ offer_id: string; submission_version: number; kind: string; status: string; return_step: string | null }>(
    `SELECT offer_id, submission_version, kind, status, return_step FROM offer_audit_versions
     ORDER BY offer_id, submission_version, kind`,
  );
  const revisions = await database.query<{ offer_id: string; current_step: string; status: string; version: number }>(
    `SELECT offer_id, current_step, status, version FROM offer_revision_drafts ORDER BY created_at`,
  );
  const listings = await database.query<{ id: string; offer_id: string; capacity_total: string; capacity_unit: string; unit_credit_micros: string; status: string; starts_at: Date; expires_at: Date }>(
    `SELECT id, offer_id, capacity_total::text, capacity_unit, unit_credit_micros::text, status, starts_at, expires_at
     FROM credit_market_listings ORDER BY created_at`,
  );
  const evidence = await database.query<{ status: string; count: string }>(
    `SELECT status, count(*)::text AS count FROM resource_verification_evidence GROUP BY status ORDER BY status`,
  );
  const notifications = await database.query<{
    id: string; user_id: string; title: string; body: string; data: Record<string, unknown>; read_at: Date | null;
  }>(`SELECT id, user_id, title, body, data, read_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC`, [user.id]);
  const orders = await creditOrderStore.listForSubject(personal.subjectId, 50);
  const creditBalances = await database.query<{ subject_id: string; account_kind: string; amount_micros: string }>(
    `SELECT a.subject_id, a.account_kind,
       COALESCE(sum(e.amount_micros) FILTER (WHERE t.status = 'posted'), 0)::text AS amount_micros
     FROM kai_credit_accounts a
     LEFT JOIN kai_credit_entries e ON e.account_id = a.id
     LEFT JOIN kai_credit_transactions t ON t.id = e.transaction_id
     WHERE a.subject_id IN ($1, $2)
     GROUP BY a.subject_id, a.account_kind ORDER BY a.subject_id, a.account_kind`,
    [personal.subjectId, buyerPersonal.subjectId],
  );
  return { ok: true, userId: user.id, subjectId: personal.subjectId, buyerSubjectId: buyerPersonal.subjectId,
    resources, drafts: drafts.rows,
    offers: offers.rows, audits: audits.rows, revisions: revisions.rows, listings: listings.rows,
    orders: orders.map((order) => ({ id: order.id, orderNumber: order.orderNumber, status: order.status })),
    creditBalances: creditBalances.rows, lastListingRequest, evidence: evidence.rows, notifications: notifications.rows };
});
app.post('/__e2e/seed-verified', async (request, reply) => {
  if (request.ip !== '127.0.0.1' && request.ip !== '::1') return reply.status(403).send({ ok: false });
  const existing = (await marketStore.listSupplierResources(personal.subjectId)).find((item) => item.productCode === 'H100-E2E-OFFER');
  let resourceId = existing?.id;
  if (!resourceId) {
    const created = await marketStore.createResource({
      id: randomUUID(), subjectId: personal.subjectId, requestedByUserId: user.id, kind: 'gpu',
      productCode: 'H100-E2E-OFFER', region: '上海', specifications: { memory: '80GB', interconnect: 'NVLink' },
      capacityTotal: '8', capacityUnit: 'GPU时', assetFingerprint: `e2e-offer-${randomUUID()}`,
      assetIdentityKind: 'hardware_serial', clientRequestId: `e2e-offer-${randomUUID()}`, payloadDigest: `e2e-${randomUUID()}`,
    });
    if (!created || !('resource' in created)) return reply.status(500).send({ ok: false, reason: 'CREATE_FAILED' });
    resourceId = created.resource.id;
  }
  if (!resourceId) return reply.status(500).send({ ok: false, reason: 'RESOURCE_ID_MISSING' });
  let resource = (await marketStore.listSupplierResources(personal.subjectId)).find((item) => item.id === resourceId);
  if (!resource) return reply.status(500).send({ ok: false, reason: 'RESOURCE_NOT_FOUND' });
  if (resource.status !== 'verified') {
    await database.query(
      `UPDATE resource_verification_runs SET status = 'running',
        materials_submitted_at = COALESCE(materials_submitted_at, now()) WHERE resource_id = $1`, [resource.id],
    );
    const completed = await marketStore.completeResourceVerification({
      resourceId: resource.id, reviewerId: operator.id, passed: true,
      evidenceDigest: `sha256:${'a'.repeat(64)}`,
      checks: { ownership: true, configuration: true, availability: true },
    });
    if (!completed) return reply.status(500).send({ ok: false, reason: 'VERIFY_FAILED' });
    resource = (await marketStore.listSupplierResources(personal.subjectId)).find((item) => item.id === resourceId)!;
  }
  return { ok: true, resource, replayed: Boolean(existing) };
});
app.post('/__e2e/fill-offer-draft', async (request, reply) => {
  if (request.ip !== '127.0.0.1' && request.ip !== '::1') return reply.status(403).send({ ok: false });
  let draft = (await database.query<{ id: string; resource_id: string; version: number }>(
    `SELECT id, resource_id, version FROM offer_wizard_drafts WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1`,
  )).rows[0];
  if (!draft) {
    const resource = (await marketStore.listSupplierResources(personal.subjectId)).find((item) => item.status === 'verified');
    if (!resource) return reply.status(409).send({ ok: false, reason: 'NO_VERIFIED_RESOURCE' });
    const created = await listingStore.createWizardDraft({
      id: randomUUID(), subjectId: personal.subjectId, userId: user.id, resourceId: resource.id,
      clientRequestId: `e2e-wizard-${randomUUID()}`, payloadDigest: `e2e-${randomUUID()}`,
    });
    if (!created || created.status === 'conflict') return reply.status(409).send({ ok: false, reason: 'DRAFT_CREATE_FAILED' });
    draft = { id: created.draft.id, resource_id: created.draft.resourceId, version: created.draft.version };
  }
  const resource = (await marketStore.listSupplierResources(personal.subjectId)).find((item) => item.id === draft.resource_id);
  if (!resource) return reply.status(409).send({ ok: false, reason: 'RESOURCE_NOT_FOUND' });
  const payload = {
    title: 'H100 80G 整卡独享', serviceMode: 'dedicated', nativeUnit: resource.capacityUnit, minimumQuantity: '1',
    sla: { availability: '月可用性 99.9%，故障 15 分钟内响应' },
    deliveryTerms: { summary: '平台工作区交付，开通后通过消息通知' },
    acceptanceTerms: { summary: '按 H100 80G、NVLink 与可用时长验收' },
    refundTerms: { summary: '归责资源方的中断按分钟退还 KAI 卡时' },
    cleanupTerms: { summary: '任务结束后 2 小时内清理工作数据' },
    suggestedPriceCny: '31.20', priceComponents: { summary: '包含设备折旧、电力、网络和运维，不含税' },
    priceEvidence: [{ type: 'contract', source: '近三个月同型号成交合同', summary: '上海地区 H100 80G 整卡独享成交记录' }],
  };
  await database.query(
    `UPDATE offer_wizard_drafts SET current_step = 'review', payload = $2::jsonb, version = version + 1,
      updated_at = now() WHERE id = $1`, [draft.id, JSON.stringify(payload)],
  );
  return { ok: true, draftId: draft.id, previousVersion: draft.version };
});
app.post('/__e2e/seed-approved-offer', async (request, reply) => {
  if (request.ip !== '127.0.0.1' && request.ip !== '::1') return reply.status(403).send({ ok: false });
  const existing = (await listingStore.listSupplierOffers(personal.subjectId)).find((item) => item.offer.status === 'approved');
  if (existing) return { ok: true, offer: { id: existing.offer.id, status: existing.offer.status }, replayed: true };
  const resource = (await marketStore.listSupplierResources(personal.subjectId)).find((item) => item.status === 'verified');
  if (!resource) return reply.status(409).send({ ok: false, reason: 'NO_VERIFIED_RESOURCE' });
  const created = await listingStore.createOffer({
    id: randomUUID(), subjectId: personal.subjectId, userId: user.id, resourceId: resource.id,
    clientRequestId: `e2e-approved-offer-${randomUUID()}`, payloadDigest: `e2e-approved-${randomUUID()}`,
    title: 'H100 80G 整卡独享', serviceMode: 'dedicated', nativeUnit: resource.capacityUnit, minimumQuantity: '1',
    sla: { availability: '99.9%' }, deliveryTerms: { mode: '平台工作区' },
    acceptanceTerms: { summary: '型号、显存与可用时长' }, refundTerms: { outage: '按分钟退还卡时' },
    cleanupTerms: { summary: '结束后两小时清理' }, suggestedPriceCnyMicros: 31_200_000n,
    priceComponents: { included: '设备、电力、网络与运维' },
    priceEvidence: [{ type: 'contract', source: '同地区近期合同', summary: 'H100 80G 独享成交依据' }],
  });
  if (!created || created.status === 'conflict') return reply.status(409).send({ ok: false, reason: 'OFFER_CREATE_FAILED' });
  const submitted = await listingStore.submitOffer(personal.subjectId, user.id, created.offer.id, created.offer.version);
  if (!submitted) return reply.status(409).send({ ok: false, reason: 'OFFER_SUBMIT_FAILED' });
  const validUntil = new Date(Date.now() + 180 * 86_400_000);
  const resourceDecision = await listingStore.decideAudit({
    reviewerId: operator.id, offerId: created.offer.id, kind: 'resource', approved: true, changesRequested: false,
    decisionReason: '配置、控制权与可用容量一致。', evidenceSummary: 'H100 80G，8 GPU时可售。',
    evidenceDigest: `sha256:${'8'.repeat(64)}`, decisionDigest: `e2e-resource-${randomUUID()}`, validUntil,
  });
  if (!resourceDecision || typeof resourceDecision === 'string') return reply.status(409).send({ ok: false, reason: 'RESOURCE_AUDIT_FAILED' });
  const approvedReferenceCnyMicros = 31_200_000n;
  const priceDecision = await listingStore.decideAudit({
    reviewerId: priceOperator.id, offerId: created.offer.id, kind: 'price', approved: true, changesRequested: false,
    decisionReason: '同地区同型号合同可比。', evidenceSummary: '核准每 GPU时人民币依据 31.20 元。',
    evidenceDigest: `sha256:${'9'.repeat(64)}`, decisionDigest: `e2e-price-${randomUUID()}`, validUntil,
    approvedReferenceCnyMicros, conversionCnyMicrosPerCredit: KAI_CNY_MICROS_PER_CREDIT,
    approvedUnitCreditMicros: creditMicrosFromCnyMicros(approvedReferenceCnyMicros),
  });
  if (!priceDecision || typeof priceDecision === 'string') return reply.status(409).send({ ok: false, reason: 'PRICE_AUDIT_FAILED' });
  return { ok: true, offer: { id: priceDecision.offer.id, status: priceDecision.offer.status }, replayed: false };
});
app.post('/__e2e/seed-alternate-approved-offer', async (request, reply) => {
  if (request.ip !== '127.0.0.1' && request.ip !== '::1') return reply.status(403).send({ ok: false });
  const existing = (await listingStore.listSupplierOffers(personal.subjectId))
    .find((item) => item.offer.title === 'H100 80G 夜间专享' && item.offer.status === 'approved');
  if (existing) return { ok: true, offer: { id: existing.offer.id, status: existing.offer.status }, replayed: true };
  const resource = (await marketStore.listSupplierResources(personal.subjectId)).find((item) => item.status === 'verified');
  if (!resource) return reply.status(409).send({ ok: false, reason: 'NO_VERIFIED_RESOURCE' });
  const created = await listingStore.createOffer({
    id: randomUUID(), subjectId: personal.subjectId, userId: user.id, resourceId: resource.id,
    clientRequestId: `e2e-alternate-offer-${randomUUID()}`, payloadDigest: `e2e-alternate-${randomUUID()}`,
    title: 'H100 80G 夜间专享', serviceMode: 'reserved', nativeUnit: resource.capacityUnit, minimumQuantity: '1',
    sla: { availability: '99.9%' }, deliveryTerms: { mode: '平台工作区' },
    acceptanceTerms: { summary: '型号、显存与可用时长' }, refundTerms: { outage: '按分钟退还卡时' },
    cleanupTerms: { summary: '结束后两小时清理' }, suggestedPriceCnyMicros: 28_000_000n,
    priceComponents: { included: '设备、电力、网络与夜间运维' },
    priceEvidence: [{ type: 'contract', source: '同地区夜间合同', summary: 'H100 80G 夜间专享成交依据' }],
  });
  if (!created || created.status === 'conflict') return reply.status(409).send({ ok: false, reason: 'OFFER_CREATE_FAILED' });
  const submitted = await listingStore.submitOffer(personal.subjectId, user.id, created.offer.id, created.offer.version);
  if (!submitted) return reply.status(409).send({ ok: false, reason: 'OFFER_SUBMIT_FAILED' });
  const validUntil = new Date(Date.now() + 180 * 86_400_000);
  const resourceDecision = await listingStore.decideAudit({
    reviewerId: operator.id, offerId: created.offer.id, kind: 'resource', approved: true, changesRequested: false,
    decisionReason: '同一资源的备用时段复核通过。', evidenceSummary: '控制权、配置与容量保持一致。',
    evidenceDigest: `sha256:${'3'.repeat(64)}`, decisionDigest: `e2e-alternate-resource-${randomUUID()}`, validUntil,
  });
  if (!resourceDecision || typeof resourceDecision === 'string') return reply.status(409).send({ ok: false, reason: 'RESOURCE_AUDIT_FAILED' });
  const approvedReferenceCnyMicros = 28_000_000n;
  const priceDecision = await listingStore.decideAudit({
    reviewerId: priceOperator.id, offerId: created.offer.id, kind: 'price', approved: true, changesRequested: false,
    decisionReason: '夜间同地区合同可比。', evidenceSummary: '核准每 GPU时人民币依据 28.00 元。',
    evidenceDigest: `sha256:${'4'.repeat(64)}`, decisionDigest: `e2e-alternate-price-${randomUUID()}`, validUntil,
    approvedReferenceCnyMicros, conversionCnyMicrosPerCredit: KAI_CNY_MICROS_PER_CREDIT,
    approvedUnitCreditMicros: creditMicrosFromCnyMicros(approvedReferenceCnyMicros),
  });
  if (!priceDecision || typeof priceDecision === 'string') return reply.status(409).send({ ok: false, reason: 'PRICE_AUDIT_FAILED' });
  return { ok: true, offer: { id: priceDecision.offer.id, status: priceDecision.offer.status }, replayed: false };
});
app.post('/__e2e/seed-offer-changes', async (request, reply) => {
  if (request.ip !== '127.0.0.1' && request.ip !== '::1') return reply.status(403).send({ ok: false });
  const existing = (await listingStore.listSupplierOffers(personal.subjectId))
    .find((item) => item.offer.status === 'changes_requested');
  if (existing) return { ok: true, offer: { id: existing.offer.id, status: existing.offer.status }, replayed: true };
  const resource = (await marketStore.listSupplierResources(personal.subjectId)).find((item) => item.status === 'verified');
  if (!resource) return reply.status(409).send({ ok: false, reason: 'NO_VERIFIED_RESOURCE' });
  const created = await listingStore.createOffer({
    id: randomUUID(), subjectId: personal.subjectId, userId: user.id, resourceId: resource.id,
    clientRequestId: `e2e-changes-offer-${randomUUID()}`, payloadDigest: `e2e-changes-${randomUUID()}`,
    title: 'H100 80G 整卡独享', serviceMode: 'dedicated', nativeUnit: resource.capacityUnit, minimumQuantity: '1',
    sla: { availability: '月可用性 99.9%，故障 15 分钟内响应' },
    deliveryTerms: { summary: '平台工作区交付，开通后通过消息通知' },
    acceptanceTerms: { summary: '按 H100 80G、NVLink 与可用时长验收' },
    refundTerms: { summary: '归责资源方的中断按分钟退还 KAI 卡时' },
    cleanupTerms: { summary: '任务结束后 2 小时内清理工作数据' },
    suggestedPriceCnyMicros: 31_200_000n,
    priceComponents: { summary: '包含设备折旧、电力、网络和运维，不含税' },
    priceEvidence: [{ type: 'market_quote', source: '公开报价截图', summary: '上海地区 H100 80G 报价截图' }],
  });
  if (!created || created.status === 'conflict') return reply.status(409).send({ ok: false, reason: 'OFFER_CREATE_FAILED' });
  const submitted = await listingStore.submitOffer(personal.subjectId, user.id, created.offer.id, created.offer.version);
  if (!submitted) return reply.status(409).send({ ok: false, reason: 'OFFER_SUBMIT_FAILED' });
  const decision = await listingStore.decideAudit({
    reviewerId: priceOperator.id, offerId: created.offer.id, kind: 'price', approved: false, changesRequested: true,
    decisionReason: '请换成近三个月的成交合同，并注明合同日期。',
    evidenceSummary: '当前只有公开报价截图，暂时不能核定成交价。',
    evidenceDigest: `sha256:${'5'.repeat(64)}`, decisionDigest: `e2e-price-changes-${randomUUID()}`,
    returnStep: 'price',
  });
  if (!decision || typeof decision === 'string') return reply.status(409).send({ ok: false, reason: 'CHANGES_REQUEST_FAILED' });
  return { ok: true, offer: { id: decision.offer.id, status: decision.offer.status }, replayed: false };
});
app.post('/__e2e/seed-listing', async (request, reply) => {
  if (request.ip !== '127.0.0.1' && request.ip !== '::1') return reply.status(403).send({ ok: false });
  const existing = (await listingStore.listSupplierListings(personal.subjectId)).find((item) => item.status === 'active');
  if (existing) return { ok: true, listing: { id: existing.id, status: existing.status }, replayed: true };
  const approved = (await listingStore.listSupplierOffers(personal.subjectId)).find((item) => item.offer.status === 'approved');
  if (!approved) return reply.status(409).send({ ok: false, reason: 'NO_APPROVED_OFFER' });
  const now = new Date();
  const created = await listingStore.publishListing({
    id: randomUUID(), subjectId: personal.subjectId, userId: user.id, offerId: approved.offer.id,
    clientRequestId: `e2e-listing-${randomUUID()}`, payloadDigest: `e2e-listing-${randomUUID()}`,
    capacityTotal: '8', startsAt: now, expiresAt: new Date(now.getTime() + 7 * 86_400_000),
  });
  if (created.status !== 'created' && created.status !== 'replayed') {
    return reply.status(409).send({ ok: false, reason: created.status });
  }
  return { ok: true, listing: { id: created.listing.id, status: created.listing.status }, replayed: created.status === 'replayed' };
});
app.post('/__e2e/seed-scheduled-listing', async (request, reply) => {
  if (request.ip !== '127.0.0.1' && request.ip !== '::1') return reply.status(403).send({ ok: false });
  const offers = await listingStore.listSupplierOffers(personal.subjectId);
  const listings = await listingStore.listSupplierListings(personal.subjectId);
  const approved = offers.find((item) => item.offer.status === 'approved'
    && !listings.some((listing) => listing.offerId === item.offer.id));
  if (!approved) return reply.status(409).send({ ok: false, reason: 'NO_UNUSED_APPROVED_OFFER' });
  const lastEnd = listings.filter((item) => ['active', 'paused', 'sold_out'].includes(item.status))
    .reduce((latest, item) => item.expiresAt > latest ? item.expiresAt : latest, new Date());
  const created = await listingStore.publishListing({
    id: randomUUID(), subjectId: personal.subjectId, userId: user.id, offerId: approved.offer.id,
    clientRequestId: `e2e-scheduled-listing-${randomUUID()}`, payloadDigest: `e2e-scheduled-listing-${randomUUID()}`,
    capacityTotal: '8', startsAt: lastEnd, expiresAt: new Date(lastEnd.getTime() + 7 * 86_400_000),
  });
  if (created.status !== 'created' && created.status !== 'replayed') {
    return reply.status(409).send({ ok: false, reason: created.status });
  }
  return { ok: true, listing: { id: created.listing.id, status: created.listing.status,
    startsAt: created.listing.startsAt, expiresAt: created.listing.expiresAt }, replayed: created.status === 'replayed' };
});
app.post('/__e2e/seed-order', async (request, reply) => {
  if (request.ip !== '127.0.0.1' && request.ip !== '::1') return reply.status(403).send({ ok: false });
  const rawScenario = request.body && typeof request.body === 'object' && 'scenario' in request.body
    ? String(request.body.scenario) : 'first';
  const scenario = rawScenario.replace(/[^a-z0-9]/giu, '').slice(0, 10).toLowerCase() || 'first';
  const existing = (await creditOrderStore.listForSubject(personal.subjectId, 50)).find((item) => item.status === 'reserved');
  if (existing) return { ok: true, order: { id: existing.id, orderNumber: existing.orderNumber, status: existing.status }, replayed: true };
  const selectionTime = new Date();
  const listing = (await listingStore.listSupplierListings(personal.subjectId)).find((item) =>
    item.status === 'active' && item.startsAt <= selectionTime && item.expiresAt > selectionTime,
  );
  if (!listing) return reply.status(409).send({ ok: false, reason: 'NO_ACTIVE_LISTING' });
  const buyerAccounts = await creditLedgerStore.ensureSubjectAccounts(buyerPersonal.subjectId);
  const available = buyerAccounts.find((account) => account.kind === 'available');
  if (!available) return reply.status(500).send({ ok: false, reason: 'BUYER_AVAILABLE_ACCOUNT_MISSING' });
  const funded = await creditLedgerStore.post({
    id: randomUUID(), idempotencyOwner: 'platform:e2e', scope: 'E2E_FUND_BUYER',
    idempotencyKey: 'e2e-provider-order-buyer-funding', payloadDigest: 'e2e-provider-order-buyer-funding',
    referenceType: 'adjustment', description: '安卓订单验收卡时', entries: [
      { accountId: available.accountId, amountMicros: 200_000_000n, memo: '安卓验收入账' },
      { accountId: KAI_CREDIT_PLATFORM_ACCOUNTS.issuance, amountMicros: -200_000_000n, memo: '安卓验收发行' },
    ],
  });
  if (funded.status === 'conflict' || funded.status === 'in_progress') {
    return reply.status(409).send({ ok: false, reason: `FUND_${funded.status.toUpperCase()}` });
  }
  const now = new Date();
  const created = await creditOrderStore.createReservation({
    id: randomUUID(), orderNumber: `KC${now.toISOString().slice(0, 10).replaceAll('-', '')}${scenario.toUpperCase()}`,
    buyerSubjectId: buyerPersonal.subjectId, userId: buyer.id, listingId: listing.id,
    quantity: '2.000000', quantityScaled: 2_000_000n, clientRequestId: `e2e-provider-order-reservation:${scenario}`,
    payloadDigest: secretHash(`e2e-provider-order:${listing.id}:${scenario}`, config.AUDIT_PEPPER!),
    expiresAt: new Date(now.getTime() + 30 * 60_000), now, requestId: `e2e-provider-order:${scenario}`,
    ipHash: secretHash('127.0.0.1', config.AUDIT_PEPPER!),
  });
  if (created.status !== 'created' && created.status !== 'replayed') {
    return reply.status(409).send({ ok: false, reason: created.status });
  }
  return { ok: true, order: { id: created.order.id, orderNumber: created.order.orderNumber, status: created.order.status }, replayed: created.status === 'replayed' };
});
app.post('/__e2e/submit-provider-delivery', async (request, reply) => {
  if (request.ip !== '127.0.0.1' && request.ip !== '::1') return reply.status(403).send({ ok: false });
  const order = (await creditOrderStore.listForSubject(personal.subjectId, 50))
    .find((item) => ['reserved', 'confirmed', 'provisioning'].includes(item.status));
  if (!order) return reply.status(409).send({ ok: false, reason: 'NO_OPEN_ORDER' });
  try {
    const principal = { userId: user.id, sessionId: 'e2e-direct', role: 'supplier' as const };
    const context = { requestId: 'e2e-direct-delivery', ip: '127.0.0.1' };
    let status = order.status;
    if (order.status === 'reserved') {
      status = (await creditOrderService.confirm(principal, order.id, `e2e-confirm:${randomUUID()}`, context)).order.status;
    }
    if (status === 'confirmed') {
      status = (await creditOrderService.startDelivery(principal, order.id, `e2e-start:${randomUUID()}`, context)).order.status;
    }
    if ((request.body as { prepareOnly?: unknown } | null)?.prepareOnly === true) {
      return { ok: true, prepared: true, order: { id: order.id, status } };
    }
    const result = await creditOrderService.deliveryReady(
      principal, order.id,
      { endpoint: 'https://console.kai.test', instructions: 'Login then check GPU status.' },
      `e2e-delivery-ready:${randomUUID()}`, context,
    );
    return { ok: true, ...result };
  } catch (error) {
    return reply.status(500).send({ ok: false, error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error) });
  }
});
app.post('/__e2e/settle-due-orders', async (request, reply) => {
  if (request.ip !== '127.0.0.1' && request.ip !== '::1') return reply.status(403).send({ ok: false });
  const pending = (await creditOrderStore.listForSubject(buyerPersonal.subjectId, 50))
    .find((item) => item.status === 'acceptance_pending');
  if (pending) {
    await creditOrderService.accept(
      { userId: buyer.id, sessionId: 'e2e-buyer', role: 'member' }, pending.id, undefined,
      `e2e-accept:${randomUUID()}`, { requestId: 'e2e-direct-accept', ip: '127.0.0.1' },
    );
  }
  const settled = await creditOrderStore.settleDueSupplierOrders(new Date(Date.now() + 8 * 86_400_000), 50);
  return { ok: true, settled };
});
app.post('/__e2e/seed-partial-aftercare', async (request, reply) => {
  if (request.ip !== '127.0.0.1' && request.ip !== '::1') return reply.status(403).send({ ok: false });
  const pending = (await creditOrderStore.listForSubject(buyerPersonal.subjectId, 50))
    .find((item) => item.status === 'acceptance_pending');
  const accepted = pending
    ? (await creditOrderService.accept(
      { userId: buyer.id, sessionId: 'e2e-buyer', role: 'member' }, pending.id, undefined,
      `e2e-accept:${randomUUID()}`, { requestId: 'e2e-partial-accept', ip: '127.0.0.1' },
    )).order
    : (await creditOrderStore.listForSubject(buyerPersonal.subjectId, 50)).find((item) => item.status === 'accepted');
  if (!accepted) return reply.status(409).send({ ok: false, reason: 'NO_ACCEPTED_ORDER' });
  const result = await creditOrderService.requestPostAcceptanceRefund(
    { userId: buyer.id, sessionId: 'e2e-buyer', role: 'member' }, accepted.id,
    '连续运行时出现服务中断，申请按实际受影响时长补偿。', '20.000000',
    `e2e-partial:${randomUUID()}`, { requestId: 'e2e-partial-request', ip: '127.0.0.1' },
  );
  return { ok: true, ...result };
});
app.post('/__e2e/expire-offer', async (request, reply) => {
  if (request.ip !== '127.0.0.1' && request.ip !== '::1') return reply.status(403).send({ ok: false });
  const approved = (await listingStore.listSupplierOffers(personal.subjectId)).find((item) => item.offer.status === 'approved');
  if (!approved) return reply.status(409).send({ ok: false, reason: 'NO_APPROVED_OFFER' });
  await database.query(`UPDATE offer_templates SET audit_valid_until = now() - interval '1 minute' WHERE id = $1`, [approved.offer.id]);
  const expired = (await listingStore.listSupplierOffers(personal.subjectId)).find((item) => item.offer.id === approved.offer.id);
  const listings = (await listingStore.listSupplierListings(personal.subjectId)).filter((item) => item.offerId === approved.offer.id);
  const notifications = await database.query<{ count: string }>(
    `SELECT count(*)::text FROM notifications WHERE user_id = $1 AND title = '审核已到期，请重新提交'`, [user.id],
  );
  return {
    ok: true, offer: expired ? { id: expired.offer.id, status: expired.offer.status, version: expired.offer.version } : null,
    listings: listings.map((item) => ({ id: item.id, status: item.status })), expiryNotifications: notifications.rows[0]?.count ?? '0',
  };
});
app.post('/__e2e/approve-pending-offer', async (request, reply) => {
  if (request.ip !== '127.0.0.1' && request.ip !== '::1') return reply.status(403).send({ ok: false });
  const target = await database.query<{ id: string; subject_id: string }>(
    `SELECT o.id, s.subject_id FROM offer_templates o
     JOIN supplier_profiles s ON s.id = o.supplier_id
     WHERE o.status = 'under_review' ORDER BY o.updated_at DESC LIMIT 1`,
  );
  const subjectId = target.rows[0]?.subject_id;
  const offerId = target.rows[0]?.id;
  const pending = subjectId && offerId
    ? (await listingStore.listSupplierOffers(subjectId)).find((item) => item.offer.id === offerId)
    : undefined;
  if (!pending) return reply.status(409).send({ ok: false, reason: 'NO_PENDING_OFFER' });
  const validUntil = new Date(Date.now() + 20 * 86_400_000);
  const resourceAudit = pending.audits.find((item) => item.kind === 'resource');
  if (resourceAudit?.status === 'pending') {
    const decision = await listingStore.decideAudit({
      reviewerId: operator.id, offerId: pending.offer.id, kind: 'resource', approved: true, changesRequested: false,
      decisionReason: '复审资源通过。', evidenceSummary: '配置、控制权与可售容量复核一致。',
      evidenceDigest: `sha256:${'6'.repeat(64)}`, decisionDigest: `e2e-resource-reaudit-${randomUUID()}`, validUntil,
    });
    if (!decision || typeof decision === 'string') return reply.status(409).send({ ok: false, reason: 'RESOURCE_REAUDIT_FAILED' });
  }
  const latest = (await listingStore.listSupplierOffers(subjectId!)).find((item) => item.offer.id === pending.offer.id)!;
  const priceAudit = latest.audits.find((item) => item.kind === 'price');
  if (priceAudit?.status === 'pending') {
    const approvedReferenceCnyMicros = 31_200_000n;
    const decision = await listingStore.decideAudit({
      reviewerId: priceOperator.id, offerId: pending.offer.id, kind: 'price', approved: true, changesRequested: false,
      decisionReason: '复审价格通过。', evidenceSummary: '近期合同与成本材料复核一致。',
      evidenceDigest: `sha256:${'7'.repeat(64)}`, decisionDigest: `e2e-price-reaudit-${randomUUID()}`, validUntil,
      approvedReferenceCnyMicros, conversionCnyMicrosPerCredit: KAI_CNY_MICROS_PER_CREDIT,
      approvedUnitCreditMicros: creditMicrosFromCnyMicros(approvedReferenceCnyMicros),
    });
    if (!decision || typeof decision === 'string') return reply.status(409).send({ ok: false, reason: 'PRICE_REAUDIT_FAILED' });
  }
  const approved = (await listingStore.listSupplierOffers(subjectId!)).find((item) => item.offer.id === pending.offer.id)!;
  const listings = (await listingStore.listSupplierListings(subjectId!)).filter((item) => item.offerId === pending.offer.id);
  return {
    ok: true, offer: { id: approved.offer.id, status: approved.offer.status, submissionVersion: approved.offer.submissionVersion },
    listings: listings.map((item) => ({ id: item.id, status: item.status })),
  };
});
app.post('/__e2e/seed-review', async (request, reply) => {
  if (request.ip !== '127.0.0.1' && request.ip !== '::1') return reply.status(403).send({ ok: false });
  const existing = (await marketStore.listSupplierResources(personal.subjectId)).find((item) => item.productCode === 'H100-E2E-REVIEW');
  if (existing) return { ok: true, resource: existing, replayed: true };
  const created = await marketStore.createResource({
    id: randomUUID(), subjectId: personal.subjectId, requestedByUserId: user.id, kind: 'gpu',
    productCode: 'H100-E2E-REVIEW', region: '上海', specifications: { memory: '80GB' },
    capacityTotal: '8', capacityUnit: 'GPU时', assetFingerprint: `e2e-${randomUUID()}`,
    assetIdentityKind: 'hardware_serial', clientRequestId: `e2e-seed-${randomUUID()}`, payloadDigest: `e2e-${randomUUID()}`,
  });
  if (!created || !('resource' in created)) return reply.status(500).send({ ok: false, reason: 'CREATE_FAILED' });
  const run = (await database.query<{ id: string }>(
    `SELECT id FROM resource_verification_runs WHERE resource_id = $1 ORDER BY requested_at DESC LIMIT 1`, [created.resource.id],
  )).rows[0]!;
  const submissionId = randomUUID();
  await database.query(
    `INSERT INTO resource_verification_material_submissions(id, resource_id, supplier_id, verification_run_id,
      submitted_by, client_request_id, payload_digest, submitted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
    [submissionId, created.resource.id, created.resource.supplierId, run.id, user.id, `e2e-submit-${randomUUID()}`, `e2e-${randomUUID()}`],
  );
  for (const [index, category] of ['ownership', 'configuration', 'availability'].entries()) {
    const evidenceId = randomUUID();
    const digest = `sha256:${String(index + 1).repeat(64)}`;
    await database.query(
      `INSERT INTO resource_verification_evidence(id, resource_id, supplier_id, submitted_by, category, object_key,
        file_name, mime_type, size_bytes, sha256_digest, status, client_request_id, payload_digest, retention_until,
        uploaded_at, verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'application/pdf', 128, $8, 'verified', $9, $10,
        now() + interval '1 year', now(), now())`,
      [evidenceId, created.resource.id, created.resource.supplierId, user.id, category,
        `quarantine/e2e/${evidenceId}.pdf`, `${category}.pdf`, digest, `e2e-upload-${randomUUID()}`, `e2e-${randomUUID()}`],
    );
    await database.query(
      `INSERT INTO resource_verification_material_items(submission_id, evidence_id, category, sha256_digest)
       VALUES ($1, $2, $3, $4)`, [submissionId, evidenceId, category, digest],
    );
  }
  await database.query(
    `UPDATE resource_verification_runs SET status = 'running', materials_submitted_at = now() WHERE id = $1`, [run.id],
  );
  return { ok: true, resource: (await marketStore.listSupplierResources(personal.subjectId)).find((item) => item.id === created.resource.id) };
});
app.post('/__e2e/reject', async (request, reply) => {
  if (request.ip !== '127.0.0.1' && request.ip !== '::1') return reply.status(403).send({ ok: false });
  const resources = await marketStore.listSupplierResources(personal.subjectId);
  const resource = resources.find((item) => item.verification?.status === 'running');
  if (!resource) return reply.status(409).send({ ok: false, reason: 'NO_RUNNING_RESOURCE' });
  const rejected = await marketStore.completeResourceVerification({
    resourceId: resource.id, reviewerId: operator.id, passed: false,
    evidenceDigest: `sha256:${'e'.repeat(64)}`,
    checks: { ownership: true, configuration: false, availability: true },
    failureReason: '配置截图缺少设备序列号，请更换配置材料后重新提交。',
  });
  return { ok: true, resource: rejected };
});
app.post('/__e2e/approve-pending-resource', async (request, reply) => {
  if (request.ip !== '127.0.0.1' && request.ip !== '::1') return reply.status(403).send({ ok: false });
  const running = await database.query<{ resource_id: string }>(
    `SELECT resource_id FROM resource_verification_runs WHERE status = 'running' ORDER BY materials_submitted_at DESC LIMIT 1`,
  );
  const target = running.rows[0];
  if (!target) return reply.status(409).send({ ok: false, reason: 'NO_RUNNING_RESOURCE' });
  const approved = await marketStore.completeResourceVerification({
    resourceId: target.resource_id, reviewerId: operator.id, passed: true,
    evidenceDigest: `sha256:${'b'.repeat(64)}`,
    checks: { ownership: true, configuration: true, availability: true },
  });
  return { ok: true, resource: approved };
});
app.post('/__e2e/submit-pending-evidence', async (request, reply) => {
  if (request.ip !== '127.0.0.1' && request.ip !== '::1') return reply.status(403).send({ ok: false });
  const target = await database.query<{ id: string; resource_id: string; supplier_id: string; user_id: string }>(
    `SELECT r.id, r.id AS resource_id, r.supplier_id, s.created_by_user_id AS user_id
     FROM compute_resources r JOIN supplier_profiles s ON s.id = r.supplier_id
     JOIN resource_verification_runs v ON v.resource_id = r.id
     WHERE r.status = 'pending_verification' AND v.status = 'pending'
     ORDER BY r.created_at DESC LIMIT 1`,
  );
  const row = target.rows[0];
  if (!row) return reply.status(409).send({ ok: false, reason: 'NO_PENDING_RESOURCE' });
  const categories = ['ownership', 'configuration', 'availability'] as const;
  const run = await database.query<{ id: string }>(
    `SELECT id FROM resource_verification_runs WHERE resource_id = $1 ORDER BY requested_at DESC LIMIT 1`, [row.resource_id],
  );
  const submissionId = randomUUID();
  await database.query(
    `INSERT INTO resource_verification_material_submissions(id, resource_id, supplier_id, verification_run_id,
       submitted_by, client_request_id, payload_digest, submitted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
    [submissionId, row.resource_id, row.supplier_id, run.rows[0]!.id, row.user_id, `e2e-submit-${randomUUID()}`, `e2e-${randomUUID()}`],
  );
  for (const category of categories) {
    const evidenceId = randomUUID();
    const digest = `sha256:${category === 'ownership' ? '1' : category === 'configuration' ? '2' : '3'}`.padEnd(71, category === 'ownership' ? '1' : category === 'configuration' ? '2' : '3');
    await database.query(
      `INSERT INTO resource_verification_evidence(id, resource_id, supplier_id, submitted_by, category, object_key,
         file_name, mime_type, size_bytes, sha256_digest, status, client_request_id, payload_digest, retention_until,
         uploaded_at, verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'image/png', 1024, $8, 'verified', $9, $10, now() + interval '3 years', now(), now())`,
      [evidenceId, row.resource_id, row.supplier_id, row.user_id, category, `e2e/${row.resource_id}/${category}.png`,
        `${category}.png`, digest, `e2e-upload-${randomUUID()}`, `e2e-${randomUUID()}`],
    );
    await database.query(
      `INSERT INTO resource_verification_material_items(submission_id, evidence_id, category, sha256_digest)
       VALUES ($1, $2, $3, $4)`, [submissionId, evidenceId, category, digest],
    );
  }
  await database.query(
    `UPDATE resource_verification_runs SET status = 'running', materials_submitted_at = now() WHERE id = $1`, [run.rows[0]!.id],
  );
  return { ok: true, resourceId: row.resource_id };
});

const uploadServer = createServer((request, response) => {
  const match = /^\/upload\/(.+)$/u.exec(request.url ?? '');
  if (request.method !== 'PUT' || !match?.[1]) { response.writeHead(404).end(); return; }
  const objectKey = decodeURIComponent(match[1]);
  const chunks: Buffer[] = [];
  let total = 0;
  request.on('data', (chunk: Buffer) => {
    total += chunk.length;
    if (total > 20 * 1024 * 1024) request.destroy(new Error('E2E_OBJECT_TOO_LARGE'));
    else chunks.push(chunk);
  });
  request.on('end', () => {
    const bytes = Buffer.concat(chunks);
    const sha256Hex = createHash('sha256').update(bytes).digest('hex');
    if (request.headers['x-kai-sha256'] !== sha256Hex) { response.writeHead(409).end('digest mismatch'); return; }
    objects.bodies.set(objectKey, bytes);
    objects.metadata.set(objectKey, {
      sizeBytes: bytes.length, mimeType: request.headers['content-type'] ?? 'application/octet-stream',
      metadataSha256: sha256Hex, sha256Base64: Buffer.from(sha256Hex, 'hex').toString('base64'),
    });
    response.writeHead(200).end();
  });
});
await new Promise<void>((resolve) => uploadServer.listen(objectPort, '0.0.0.0', resolve));
await app.listen({ host: '0.0.0.0', port: apiPort });
const scanner: MalwareScanner = { scan: async () => ({ clean: true, signature: null }) };
const worker = new EvidenceScanWorker(
  new ResourceEvidenceScanStore(database), objects, scanner,
  { info: () => undefined, error: (fields) => process.stderr.write(`${JSON.stringify(fields)}\n`) }, 150,
);
worker.start();

process.stdout.write(`${JSON.stringify({ ready: true, apiPort, objectPort, phone: testPhone, objectAddress: (uploadServer.address() as AddressInfo).address })}\n`);

const shutdown = async () => {
  await worker.stop();
  await app.close();
  await new Promise<void>((resolve, reject) => uploadServer.close((error) => error ? reject(error) : resolve()));
  await database.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
