import assert from 'node:assert/strict';
import test from 'node:test';
import { providerOrderSection, providerWorkspaceMetrics } from '../src/provider-workspace-metrics.ts';

test('materials not yet submitted count as action, not review', () => {
  const metrics = providerWorkspaceMetrics({
    resources: { draft: 0, awaitingMaterials: 2, underReview: 1, verified: 3, rejected: 1, suspended: 0, retired: 0 },
    offers: { draft: 0, underReview: 4, changesRequested: 1, approved: 0, rejected: 1, suspended: 0, expired: 1 },
  });
  assert.deepEqual(metrics, { resourceTotal: 7, awaitingReview: 5, needsAction: 6 });
});

test('provider order section distinguishes real work from recent history', () => {
  assert.deepEqual(providerOrderSection([{ actions: ['confirm'] }, { actions: [] }]), {
    title: '订单处理', count: '1 笔待处理', actionable: 1,
  });
  assert.deepEqual(providerOrderSection([{ actions: [] }]), {
    title: '近期订单', count: '1 笔', actionable: 0,
  });
  assert.deepEqual(providerOrderSection([{ actions: [], status: 'disputed' }]), {
    title: '订单处理', count: '1 笔待处理', actionable: 1,
  });
  assert.deepEqual(providerOrderSection([{ actions: [], status: 'accepted', requiresAttention: true }]), {
    title: '订单处理', count: '1 笔待处理', actionable: 1,
  });
});
