import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  draftAbandonAccepted, draftSaveAccepted, isAmbiguousMutationFailure, listingPublicationAccepted, listingStatusChangeAccepted,
  offerReauditAccepted, providerOrderActionAccepted, resourceSubmissionAccepted, resourceUploadAccepted, revisionSubmissionAccepted,
  supplierSubmissionAccepted, wizardSubmissionAccepted,
} from '../src/mutation-recovery.ts';
import { localE2EOtpForPhone } from '../src/local-e2e-auth.ts';

test('only transport and gateway failures have an unknown mutation result', () => {
  for (const status of [0, 502, 503, 504]) assert.equal(isAmbiguousMutationFailure({ status }), true);
  for (const status of [400, 401, 409, 422, 500]) assert.equal(isAmbiguousMutationFailure({ status }), false);
  assert.equal(isAmbiguousMutationFailure(new Error('plain error')), false);
});

test('local Android acceptance fills only the OTP issued for the requested phone', () => {
  assert.equal(localE2EOtpForPhone('13800138000', { phone: '+8613800138000', code: '123456' }), '123456');
  assert.equal(localE2EOtpForPhone('13800138000', { phone: '+8613900139000', code: '123456' }), null);
  assert.equal(localE2EOtpForPhone('13800138000', { phone: '+8613800138000', code: '12345' }), null);
  assert.equal(localE2EOtpForPhone('13800138000', null), null);
});

test('local OTP retrieval stays behind the build-time local E2E flag', async () => {
  const auth = await readFile(new URL('../src/AuthSheet.tsx', import.meta.url), 'utf8');
  assert.match(auth, /allowInsecureApiForLocalE2e === true/u);
  assert.match(auth, /if \(localE2E\)/u);
  assert.match(auth, /\/__e2e\/otp/u);
  assert.match(auth, /本地预览不会发送短信，验证码会在这里自动填入。/u);
  assert.match(auth, /localE2E \? '获取本机验证码' : '获取验证码'/u);
});

test('resource review reconciliation distinguishes accepted submission from an untouched checklist', () => {
  assert.equal(resourceSubmissionAccepted({ review: { status: 'collecting' } }), false);
  assert.equal(resourceSubmissionAccepted({ review: { status: 'under_review' } }), true);
  assert.equal(resourceSubmissionAccepted({ review: { status: 'failed' } }), true);
});

test('supplier onboarding recovery requires the same submitted or approved profile', () => {
  const input = { legalName: '凯云算力有限公司', creditCode: '91310101MA1ABCDEF0', contactName: '凯' };
  const profile = { legalName: input.legalName, creditCode: '9131**********DEF0', contactName: '凯', status: 'submitted' };
  assert.equal(supplierSubmissionAccepted(input, profile), true);
  assert.equal(supplierSubmissionAccepted(input, { ...profile, status: 'approved' }), true);
  assert.equal(supplierSubmissionAccepted(input, { ...profile, status: 'rejected' }), false);
  assert.equal(supplierSubmissionAccepted(input, { ...profile, legalName: '其他公司' }), false);
  assert.equal(supplierSubmissionAccepted(input, null), false);
});

test('resource upload reconciliation requires the exact file and a server-owned post-upload state', () => {
  const checklist = { categories: { ownership: { evidence: { fileName: 'proof.pdf', sizeBytes: 120, status: 'pending_scan' } } } };
  assert.equal(resourceUploadAccepted(checklist, 'ownership', 'proof.pdf', 120), true);
  assert.equal(resourceUploadAccepted(checklist, 'ownership', 'other.pdf', 120), false);
  assert.equal(resourceUploadAccepted({ categories: { ownership: { evidence: { fileName: 'proof.pdf', sizeBytes: 120, status: 'pending_upload' } } } }, 'ownership', 'proof.pdf', 120), false);
});

test('wizard and revision reconciliation requires authoritative server progress', () => {
  assert.equal(wizardSubmissionAccepted({ status: 'active', convertedOfferId: null }), false);
  assert.equal(wizardSubmissionAccepted({ status: 'submitted', convertedOfferId: 'offer-1' }), true);
  const before = { offerId: 'offer-1', sourceOfferVersion: 4 };
  assert.equal(revisionSubmissionAccepted(before, { id: 'offer-1', version: 5, status: 'under_review' }), true);
  assert.equal(revisionSubmissionAccepted(before, { id: 'offer-1', version: 4, status: 'changes_requested' }), false);
});

test('draft save reconciliation requires newer authoritative content matching the local edit', () => {
  const before = { id: 'draft-1', version: 4 };
  const desired = { step: 'price', payload: { title: 'H100', terms: { b: 2, a: 1 } } };
  const accepted = { id: 'draft-1', version: 5, status: 'active', currentStep: 'price', payload: { terms: { a: 1, b: 2 }, title: 'H100' } };
  assert.equal(draftSaveAccepted(before, desired, accepted), true);
  assert.equal(draftSaveAccepted(before, desired, { ...accepted, version: 4 }), false);
  assert.equal(draftSaveAccepted(before, desired, { ...accepted, currentStep: 'terms' }), false);
  assert.equal(draftSaveAccepted(before, desired, { ...accepted, payload: { title: 'H200' } }), false);
  assert.equal(draftSaveAccepted(before, desired, { ...accepted, status: 'submitted' }), false);
});

test('listing reconciliation accepts only a live listing for the exact offer', () => {
  assert.equal(listingPublicationAccepted('offer-1', [{ offerId: 'offer-1', status: 'active' }]), true);
  assert.equal(listingPublicationAccepted('offer-1', [{ offerId: 'offer-1', status: 'withdrawn' }]), false);
  assert.equal(listingPublicationAccepted('offer-1', [{ offerId: 'offer-2', status: 'active' }]), false);
});

test('listing status recovery requires the exact listing and target state', () => {
  const listings = [{ id: 'listing-1', status: 'paused' }, { id: 'listing-2', status: 'active' }];
  assert.deepEqual(listingStatusChangeAccepted('listing-1', 'paused', listings), listings[0]);
  assert.equal(listingStatusChangeAccepted('listing-1', 'active', listings), null);
  assert.equal(listingStatusChangeAccepted('listing-3', 'paused', listings), null);
  assert.deepEqual(listingStatusChangeAccepted('listing-2', 'active', listings), listings[1]);
});

test('draft abandonment and expired-offer reaudit recover only from authoritative progress', () => {
  assert.equal(draftAbandonAccepted('draft-1', [{ id: 'draft-2' }]), true);
  assert.equal(draftAbandonAccepted('draft-1', [{ id: 'draft-1' }]), false);
  const before = { id: 'offer-1', version: 7, submissionVersion: 2, status: 'expired' };
  const accepted = { ...before, version: 8, submissionVersion: 3, status: 'under_review' };
  assert.equal(offerReauditAccepted(before, accepted), true);
  assert.equal(offerReauditAccepted(before, { ...accepted, version: 9 }), false);
  assert.equal(offerReauditAccepted(before, { ...accepted, status: 'approved' }), false);
});

test('provider order recovery requires authoritative evidence of the requested transition', () => {
  const base = {
    id: 'order-1', side: 'provider', status: 'reserved', confirmedAt: null, deliveryStartedAt: null,
  };
  const confirmed = { ...base, status: 'confirmed', confirmedAt: '2026-08-14T10:00:00.000Z' };
  assert.equal(providerOrderActionAccepted('confirm', base, confirmed), true);
  assert.equal(providerOrderActionAccepted('confirm', base, { ...base, status: 'reserved' }), false);
  assert.equal(providerOrderActionAccepted('confirm', base, { ...confirmed, id: 'order-2' }), false);

  const provisioning = { ...confirmed, status: 'provisioning', deliveryStartedAt: '2026-08-14T10:02:00.000Z' };
  assert.equal(providerOrderActionAccepted('start_delivery', confirmed, provisioning), true);
  assert.equal(providerOrderActionAccepted('start_delivery', confirmed, { ...confirmed, status: 'provisioning' }), false);
  assert.equal(providerOrderActionAccepted('start_delivery', { ...base, status: 'reserved' }, provisioning), false);
});

test('provider confirm and delivery start use safe retry with a caller-stable request key', async () => {
  const api = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
  for (const functionName of ['confirmCloudPayOrder', 'startCloudPayDelivery']) {
    const start = api.indexOf(`export function ${functionName}`);
    assert.notEqual(start, -1, `${functionName} must exist`);
    const next = api.indexOf('\nexport ', start + 1);
    const body = api.slice(start, next === -1 ? undefined : next);
    assert.match(body, /idempotencyKey\?: string/u);
    assert.match(body, /idempotencyKey, true/u);
  }
});

test('provider mutations retry only where the server supports a safe replay', async () => {
  const publishing = await readFile(new URL('../src/publishing.ts', import.meta.url), 'utf8');
  for (const functionName of [
    'createResource', 'resubmitResource', 'createOfferDraft', 'createOfferRevision',
    'submitOfferDraft', 'submitOfferRevision', 'resubmitExpiredOffer', 'publishCreditListing', 'setCreditListingStatus',
  ]) {
    const start = publishing.indexOf(`export async function ${functionName}`);
    assert.notEqual(start, -1, `${functionName} must exist`);
    const next = publishing.indexOf('\nexport ', start + 1);
    const body = publishing.slice(start, next === -1 ? undefined : next);
    assert.match(body, /retry: true/u, `${functionName} must use the server's idempotent replay`);
  }
});
