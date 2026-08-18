import type { ProviderWorkspace } from './api';

export function providerOrderNeedsAttention(order: Readonly<{
  actions: readonly unknown[]; status?: string; requiresAttention?: boolean;
}>) {
  return order.requiresAttention === true || order.actions.length > 0 || order.status === 'disputed';
}

export function providerOrderSection(orders: ReadonlyArray<Readonly<{
  actions: readonly unknown[]; status?: string; requiresAttention?: boolean;
}>>) {
  const actionable = orders.filter(providerOrderNeedsAttention).length;
  return actionable > 0
    ? { title: '订单处理', count: `${actionable} 笔待处理`, actionable }
    : { title: '近期订单', count: `${orders.length} 笔`, actionable };
}

export function providerWorkspaceMetrics(workspace: ProviderWorkspace) {
  return {
    resourceTotal: Object.values(workspace.resources).reduce((sum, value) => sum + value, 0),
    awaitingReview: workspace.resources.underReview + workspace.offers.underReview,
    needsAction: workspace.resources.awaitingMaterials + workspace.resources.rejected
      + workspace.offers.changesRequested + workspace.offers.rejected + workspace.offers.expired,
  } as const;
}
