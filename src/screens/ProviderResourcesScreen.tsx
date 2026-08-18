import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { CloudPaySnapshot, ProviderResourceAction } from '../api';
import { Card } from '../components';
import { compactDecimal } from '../format';
import { loadSupplierWorkspace, resubmitResource, type ComputeResource } from '../publishing';
import { ResourceEvidenceSheet } from '../ResourceEvidenceSheet';
import { resourceCollectingCopy } from '../resource-evidence-copy';
import { colors } from '../theme';

const kindLabel: Record<ComputeResource['kind'], string> = {
  gpu: 'GPU', token_capacity: 'Token 容量', token_usage: 'Token 用量', rack: '机柜', storage: '存储', apple_silicon: 'Apple 芯片',
};

const statusMeta: Record<ComputeResource['status'], Readonly<{ label: string; icon: 'time-outline' | 'checkmark-circle-outline' | 'alert-circle-outline' | 'pause-circle-outline' | 'document-text-outline'; color: string }>> = {
  draft: { label: '草稿', icon: 'document-text-outline', color: colors.muted },
  pending_verification: { label: '待补材料', icon: 'document-text-outline', color: colors.amber },
  verified: { label: '已验真', icon: 'checkmark-circle-outline', color: colors.green },
  rejected: { label: '需重新送审', icon: 'alert-circle-outline', color: colors.red },
  suspended: { label: '已暂停', icon: 'pause-circle-outline', color: colors.amber },
  retired: { label: '已退役', icon: 'pause-circle-outline', color: colors.muted },
};

export function ProviderResourcesScreen({ snapshot, refreshing, onRefresh, onAdd, onNext, onLogin, openResourceId, onOpenHandled }: Readonly<{
  snapshot: CloudPaySnapshot;
  refreshing: boolean;
  onRefresh: () => void | Promise<void>;
  onAdd: () => void;
  onNext: (action: ProviderResourceAction) => void;
  onLogin: () => void;
  openResourceId?: string | null;
  onOpenHandled?: () => void;
}>) {
  const [resources, setResources] = useState<ComputeResource[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [evidenceResource, setEvidenceResource] = useState<ComputeResource | null>(null);
  const requestKeys = useRef(new Map<string, string>());

  const loadResources = async () => {
    if (!snapshot.authenticated) { setResources([]); setLoaded(false); return; }
    setLoading(true); setError(null);
    try {
      const workspace = await loadSupplierWorkspace();
      setResources(workspace.resources);
      setLoaded(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '资源加载失败，请重试。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setResources([]); setLoaded(false);
    void loadResources();
  }, [snapshot.authenticated, snapshot.currentSubjectId]);

  useEffect(() => {
    if (!openResourceId) return;
    const target = resources.find((resource) => resource.id === openResourceId);
    if (!target) return;
    setEvidenceResource(target);
    onOpenHandled?.();
  }, [onOpenHandled, openResourceId, resources]);

  const refreshAll = async () => {
    await onRefresh();
    await loadResources();
  };

  const resubmit = async (resource: ComputeResource) => {
    setBusyId(resource.id); setError(null);
    let key = requestKeys.current.get(resource.id);
    if (!key) {
      key = `resource-resubmit-${Crypto.randomUUID()}`;
      requestKeys.current.set(resource.id, key);
    }
    try {
      const result = await resubmitResource(resource.id, key);
      setResources((current) => current.map((item) => item.id === resource.id ? result.resource : item));
      setEvidenceResource(result.resource);
      requestKeys.current.delete(resource.id);
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '重新送审失败，请重试。');
    } finally {
      setBusyId(null);
    }
  };

  const workspace = snapshot.providerWorkspace;
  const rows = workspace ? [
    ['已验真', workspace.resources.verified, 'shield-checkmark-outline' as const, colors.green],
    ['待提交', workspace.resources.awaitingMaterials, 'document-text-outline' as const, colors.amber],
    ['审核中', workspace.resources.underReview, 'time-outline' as const, colors.blue],
    ['需处理', workspace.resources.rejected, 'alert-circle-outline' as const, colors.red],
  ] : [];

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing || loading} onRefresh={() => void refreshAll()} tintColor={colors.green} />}>
        <View style={styles.headingRow}>
          <View><Text style={styles.eyebrow}>资源管理</Text><Text style={styles.title}>我的资源</Text><Text style={styles.caption}>查看验真结果和资源状态。</Text></View>
          <Pressable onPress={snapshot.authenticated ? onAdd : onLogin} style={styles.addButton}><Ionicons name="add" size={22} color={colors.surface} /></Pressable>
        </View>

        {!snapshot.authenticated ? (
          <Card style={styles.loginCard}>
            <Ionicons name="lock-closed-outline" size={30} color={colors.green} />
            <Text style={styles.loginTitle}>登录后查看资源</Text>
            <Text style={styles.loginText}>审核状态、驳回原因和重新送审入口都保存在当前账号。</Text>
            <Pressable onPress={onLogin} style={[styles.primary, styles.loginButton]}><Text style={styles.primaryText}>登录</Text></Pressable>
          </Card>
        ) : (
          <>
            <View style={styles.grid}>{rows.map(([label, value, icon, color]) => <Card key={String(label)} style={styles.stat}><Ionicons name={icon as 'shield-checkmark-outline'} size={22} color={String(color)} /><Text style={styles.statValue}>{String(value)}</Text><Text style={styles.statLabel}>{String(label)}</Text></Card>)}</View>
            {error && loaded ? <View style={styles.errorBox}><Ionicons name="alert-circle-outline" size={18} color={colors.red} /><Text style={styles.errorText}>{error}</Text></View> : null}
            <View style={styles.listHeader}><Text style={styles.listTitle}>资源列表</Text><Text style={styles.listCount}>{loaded ? `${resources.length} 项` : '—'}</Text></View>
            {loading && !loaded ? <ActivityIndicator color={colors.green} style={styles.loader} /> : null}
            {!loading && !loaded ? (
              <Card style={styles.emptyCard}><Ionicons name="cloud-offline-outline" size={30} color={colors.green} /><Text style={styles.emptyTitle}>没能读取资源</Text><Text style={styles.emptyText}>请重试，已有资源和审核记录不会被修改。</Text><Pressable onPress={() => void loadResources()} style={[styles.primary, styles.retryButton]}><Text style={styles.primaryText}>重新读取</Text></Pressable></Card>
            ) : null}
            {loaded && resources.length === 0 ? (
              <Card style={styles.emptyCard}><Ionicons name="cube-outline" size={30} color={colors.green} /><Text style={styles.emptyTitle}>还没有资源</Text><Text style={styles.emptyText}>添加第一项资源后，审核进度会显示在这里。</Text></Card>
            ) : null}
            {resources.map((resource) => {
              const meta = resource.status === 'pending_verification' && resource.verification?.status === 'running'
                ? { label: '审核中', icon: 'time-outline' as const, color: colors.blue }
                : statusMeta[resource.status];
              const collecting = resource.status === 'pending_verification' && resource.verification?.status !== 'running';
              const collectingCopy = resourceCollectingCopy(collecting ? resource.verification?.failureReason : null);
              const nextAction = workspace?.resourceActions?.find((action) => action.resourceId === resource.id);
              return (
                <Card key={resource.id} style={styles.resourceCard}>
                  <View style={styles.resourceTop}>
                    <View style={styles.resourceIcon}><Ionicons name="server-outline" size={22} color={colors.green} /></View>
                    <View style={styles.resourceCopy}><Text style={styles.resourceName}>{resource.productCode}</Text><Text style={styles.resourceMeta}>{kindLabel[resource.kind]} · {resource.region}</Text></View>
                    <View style={[styles.statusPill, { backgroundColor: `${meta.color}16` }]}><Ionicons name={meta.icon} size={14} color={meta.color} /><Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text></View>
                  </View>
                  <View style={styles.capacityRow}><Text style={styles.capacityLabel}>提交容量</Text><Text style={styles.capacityValue}>{compactDecimal(resource.capacityTotal)} {resource.capacityUnit}</Text></View>
                  {resource.status === 'pending_verification' ? <Text style={[styles.progressText, collecting && styles.collectingText]}>{collecting ? collectingCopy.summary : '平台正在审核，结果会通过消息通知。'}</Text> : null}
                  {resource.status === 'pending_verification' ? (
                    <Pressable onPress={() => setEvidenceResource(resource)} style={styles.outlineButton}>
                      <Text style={styles.outlineButtonText}>{collecting ? collectingCopy.action : '查看审核进度'}</Text>
                      <Ionicons name="arrow-forward" size={16} color={colors.green} />
                    </Pressable>
                  ) : null}
                  {resource.status === 'rejected' ? (
                    <View style={styles.failureBox}>
                      <Text style={styles.failureLabel}>未通过原因</Text>
                      <Text style={styles.failureText}>{resource.verification?.failureReason ?? '审核未通过，请重新送审或联系平台。'}</Text>
                      {workspace?.canManage ? <Pressable disabled={busyId === resource.id} onPress={() => void resubmit(resource)} style={styles.resubmitButton}>{busyId === resource.id ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.resubmitText}>补充材料</Text>}</Pressable> : null}
                    </View>
                  ) : null}
                  {resource.status === 'verified' ? <View style={styles.verifiedActions}>
                    <Pressable onPress={() => setEvidenceResource(resource)} style={styles.textButton}><Text style={styles.textButtonText}>查看验真记录</Text></Pressable>
                    {workspace?.canManage && nextAction ? <Pressable onPress={() => onNext(nextAction)} style={styles.offerButton}><Text style={styles.offerButtonText}>{nextAction.label}</Text><Ionicons name="arrow-forward" size={15} color={colors.surface} /></Pressable> : null}
                  </View> : null}
                </Card>
              );
            })}
            <Pressable onPress={onAdd} style={styles.primary}><Text style={styles.primaryText}>添加资源</Text><Ionicons name="arrow-forward" size={17} color={colors.surface} /></Pressable>
          </>
        )}
      </ScrollView>
      <ResourceEvidenceSheet
        resource={evidenceResource}
        canManage={Boolean(workspace?.canManage)}
        onClose={() => setEvidenceResource(null)}
        onChanged={refreshAll}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas }, content: { padding: 16, paddingBottom: 150 },
  headingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 8, marginBottom: 22 }, eyebrow: { color: colors.green, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 }, title: { color: colors.ink, fontSize: 30, fontWeight: '900', marginTop: 7 }, caption: { color: colors.muted, fontSize: 12, marginTop: 6 },
  addButton: { width: 48, height: 48, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, stat: { width: '48%', minHeight: 116, padding: 15, justifyContent: 'space-between' }, statValue: { color: colors.ink, fontSize: 27, fontWeight: '900', marginTop: 12 }, statLabel: { color: colors.muted, fontSize: 11 },
  listHeader: { marginTop: 22, marginBottom: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, listTitle: { color: colors.ink, fontSize: 20, fontWeight: '900' }, listCount: { color: colors.muted, fontSize: 11 }, loader: { marginVertical: 28 },
  resourceCard: { padding: 15, marginBottom: 11 }, resourceTop: { flexDirection: 'row', alignItems: 'center' }, resourceIcon: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.greenSoft }, resourceCopy: { flex: 1, marginLeft: 11 }, resourceName: { color: colors.ink, fontSize: 15, fontWeight: '900' }, resourceMeta: { color: colors.muted, fontSize: 10, marginTop: 4 }, statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 999 }, statusText: { fontSize: 9, fontWeight: '900' },
  capacityRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line }, capacityLabel: { color: colors.muted, fontSize: 11 }, capacityValue: { color: colors.ink, fontSize: 11, fontWeight: '800' }, progressText: { color: colors.blue, fontSize: 10, lineHeight: 16, marginTop: 10 },
  collectingText: { color: colors.amber }, outlineButton: { minHeight: 44, marginTop: 11, borderRadius: 14, borderWidth: 1, borderColor: colors.green, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' }, outlineButtonText: { color: colors.green, fontSize: 12, fontWeight: '900' }, textButton: { alignSelf: 'flex-start', marginTop: 11, paddingVertical: 4 }, textButtonText: { color: colors.green, fontSize: 11, fontWeight: '900' },
  verifiedActions: { marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, offerButton: { minHeight: 40, paddingHorizontal: 13, borderRadius: 13, flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: colors.green }, offerButtonText: { color: colors.surface, fontSize: 11, fontWeight: '900' },
  failureBox: { padding: 12, marginTop: 12, borderRadius: 14, backgroundColor: '#FFF1F1' }, failureLabel: { color: colors.red, fontSize: 10, fontWeight: '900' }, failureText: { color: colors.ink, fontSize: 11, lineHeight: 18, marginTop: 4 }, resubmitButton: { minHeight: 42, marginTop: 11, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green }, resubmitText: { color: colors.surface, fontSize: 12, fontWeight: '900' },
  errorBox: { marginTop: 14, padding: 12, borderRadius: 14, flexDirection: 'row', gap: 8, backgroundColor: '#FFF1F1' }, errorText: { flex: 1, color: colors.red, fontSize: 11, lineHeight: 17 },
  primary: { minHeight: 52, marginTop: 16, borderRadius: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.green }, primaryText: { color: colors.surface, fontSize: 14, fontWeight: '900' },
  loginCard: { padding: 25, alignItems: 'center' }, loginTitle: { color: colors.ink, fontSize: 18, fontWeight: '900', marginTop: 13 }, loginText: { color: colors.muted, fontSize: 11, lineHeight: 18, textAlign: 'center', marginTop: 6 },
  loginButton: { width: 170 }, retryButton: { width: 170 },
  emptyCard: { padding: 24, alignItems: 'center' }, emptyTitle: { color: colors.ink, fontSize: 16, fontWeight: '900', marginTop: 10 }, emptyText: { color: colors.muted, fontSize: 11, marginTop: 5 },
});
