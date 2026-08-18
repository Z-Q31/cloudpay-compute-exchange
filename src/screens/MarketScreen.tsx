import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { CloudPaySnapshot, MarketCreditListing } from '../api';
import { Card, StatusPill } from '../components';
import { colors } from '../theme';
import { distributionPolicy } from '../distribution';
import { creditUnitPrice } from '../format';

type Props = {
  snapshot: CloudPaySnapshot;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenPublish: () => void;
  onBuy: (listing: MarketCreditListing) => void;
  onManageOwnListing: (listing: MarketCreditListing) => void;
};

const quickSearches = ['H100', '华东', '独享 GPU', 'Token'];
const kinds = ['全部', 'GPU', 'Token', '机柜', '存储'];
const kindMatches: Record<string, MarketCreditListing['kind'][]> = {
  GPU: ['gpu', 'apple_silicon'],
  Token: ['token_capacity', 'token_usage'],
  机柜: ['rack'],
  存储: ['storage'],
};
const serviceModeLabel: Record<MarketCreditListing['serviceMode'], string> = {
  dedicated: '独享', shared: '共享', slice: '切片', node: '整机', reserved: '预留',
};

function compactNumber(value: string) {
  return value.replace(/\.0+$/u, '').replace(/(\.\d*?)0+$/u, '$1');
}

function shortDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatDetails(value: Record<string, unknown>) {
  return Object.entries(value).slice(0, 6).map(([key, detail]) => `${key}: ${String(detail)}`);
}

function ListingCard({ item, expanded, onToggle, onBuy, onManage }: {
  item: MarketCreditListing;
  expanded: boolean;
  onToggle: () => void;
  onBuy: () => void;
  onManage: () => void;
}) {
  const details = formatDetails(item.specifications);
  const available = compactNumber(item.capacityAvailable);
  const minimum = compactNumber(item.minimumQuantity);

  return (
    <Card style={styles.listingCard}>
      <View style={styles.listingTop}>
        <View style={styles.gpuGlyph}>
          <Ionicons name={item.kind === 'storage' ? 'server-outline' : 'hardware-chip-outline'} size={26} color={colors.green} />
        </View>
        <View style={styles.listingCopy}>
          <Text style={styles.listingTitle}>{item.title}</Text>
          <Text style={styles.listingMeta}>{item.productCode} · {item.region}</Text>
        </View>
        <View style={styles.auditPill}>
          <Ionicons name={item.ownedByCurrentSubject ? 'storefront' : 'shield-checkmark'} size={13} color={colors.green} />
          <Text style={styles.auditText}>{item.ownedByCurrentSubject ? '我的挂牌' : '已审核'}</Text>
        </View>
      </View>

      <View style={styles.priceRow}>
        {distributionPolicy.newOrders ? <View>
          <Text style={styles.priceCaption}>KAI 卡时价</Text><Text style={styles.price}>{creditUnitPrice(item.unitCredits)}</Text><Text style={styles.priceUnit}>KAI 卡时 / {item.capacityUnit}</Text>
        </View> : <View>
          <Text style={styles.priceCaption}>资源状态</Text><Text style={styles.directoryValue}>已核验</Text><Text style={styles.priceUnit}>配置和可用时段可查看</Text>
        </View>}
        <View style={styles.stockBlock}>
          <Text style={styles.stockLabel}>可售</Text>
          <Text style={styles.stockValue}>{available} {item.capacityUnit}</Text>
          <Text style={styles.minimum}>最低 {minimum} {item.capacityUnit}</Text>
        </View>
      </View>

      <View style={styles.factsRow}>
        <View style={styles.factChip}><Text style={styles.factText}>{serviceModeLabel[item.serviceMode]}</Text></View>
        <View style={styles.factChip}><Text style={styles.factText}>售至 {shortDate(item.expiresAt)}</Text></View>
      </View>

      {expanded ? (
        <View style={styles.detailPanel}>
          <Text style={styles.detailTitle}>资源配置</Text>
          {details.length > 0
            ? details.map((detail) => <Text key={detail} style={styles.detailText}>{detail}</Text>)
            : <Text style={styles.detailText}>暂无额外公开配置</Text>}
          <View style={styles.auditRow}>
            <Ionicons name="checkmark-circle" size={16} color={colors.green} />
            <Text style={styles.auditRowText}>{distributionPolicy.newOrders ? '资源和卡时价均已通过审核' : '资源信息已经核验'}</Text>
          </View>
          <Text style={styles.validText}>审核有效期至 {shortDate(item.auditValidUntil)}</Text>
        </View>
      ) : null}

      <View style={styles.actionRow}>
        <Pressable
          style={styles.detailButton}
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityLabel={`${expanded ? '收起' : '查看'} ${item.title} 详情`}
        >
          <Text style={styles.detailButtonText}>{expanded ? '收起详情' : '查看详情'}</Text>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-forward'} size={17} color={colors.green} />
        </Pressable>
        {item.ownedByCurrentSubject ? <Pressable style={styles.buyButton} onPress={onManage} accessibilityRole="button" accessibilityLabel={`管理 ${item.title}`}>
          <Text style={styles.buyButtonText}>管理挂牌</Text><Ionicons name="settings-outline" size={16} color={colors.surface} />
        </Pressable> : distributionPolicy.newOrders ? <Pressable style={styles.buyButton} onPress={onBuy} accessibilityRole="button" accessibilityLabel={`购买 ${item.title}`}>
          <Text style={styles.buyButtonText}>购买</Text><Ionicons name="arrow-forward" size={16} color={colors.surface} />
        </Pressable> : null}
      </View>
    </Card>
  );
}

export function MarketScreen({ snapshot, refreshing, onRefresh, onOpenPublish, onBuy, onManageOwnListing }: Props) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('全部');
  const [expandedListingId, setExpandedListingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return snapshot.listings.filter((item) => {
      const haystack = `${item.title} ${item.productCode} ${item.region} ${JSON.stringify(item.specifications)}`.toLowerCase();
      const queryMatch = !needle || haystack.includes(needle);
      const kindMatch = kind === '全部' || (kindMatches[kind] ?? []).includes(item.kind);
      return queryMatch && kindMatch;
    });
  }, [kind, query, snapshot.listings]);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} />}
      >
        <View style={styles.introRow}>
          <View>
            <Text style={styles.title}>{distributionPolicy.newOrders ? '算力市场' : '算力目录'}</Text>
            <Text style={styles.subtitle}>{distributionPolicy.newOrders ? '查找当前可购买的卡时挂牌' : '查看已审核的算力资源'}</Text>
          </View>
          <StatusPill online={snapshot.listingCatalogOnline} />
        </View>

        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={21} color={colors.green} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="搜索型号、地区或配置"
            placeholderTextColor={colors.subtle}
            style={styles.searchInput}
            returnKeyType="search"
          />
          {query ? <Pressable onPress={() => setQuery('')} hitSlop={8}><Ionicons name="close-circle" size={20} color={colors.subtle} /></Pressable> : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickRow}>
          {quickSearches.map((item) => (
            <Pressable key={item} style={styles.quickChip} onPress={() => setQuery(item)}>
              <Text style={styles.quickText}>{item}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kindRow}>
          {kinds.map((item) => (
            <Pressable key={item} onPress={() => setKind(item)} style={[styles.kindChip, kind === item && styles.kindChipActive]}>
              <Text style={[styles.kindText, kind === item && styles.kindTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.marketHeader}>
          <View>
            <Text style={styles.marketTitle}>{distributionPolicy.newOrders ? '可购买算力' : '已审核算力'}</Text>
            <Text style={styles.marketCaption}>{filtered.length} 个挂牌</Text>
          </View>
          <Pressable onPress={onRefresh} style={styles.refreshButton} accessibilityLabel="刷新市场">
            <Ionicons name="refresh" size={18} color={colors.green} />
          </Pressable>
        </View>

        {snapshot.authenticated && snapshot.creditBalance ? (
          <View style={styles.balanceBar}>
            <View style={styles.balanceIcon}><Ionicons name="wallet-outline" size={18} color={colors.green} /></View>
            <View style={styles.balanceCopy}><Text style={styles.balanceLabel}>当前可用卡时</Text><Text style={styles.balanceValue}>{compactNumber(snapshot.creditBalance.available)}</Text></View>
            <Text style={styles.balanceUnit}>KAI 卡时</Text>
          </View>
        ) : null}

        {filtered.length > 0 ? (
          <View style={styles.listings}>
            {filtered.map((item) => (
              <ListingCard
                key={item.id}
                item={item}
                expanded={expandedListingId === item.id}
                onToggle={() => setExpandedListingId((current) => current === item.id ? null : item.id)}
                onBuy={() => onBuy(item)}
                onManage={() => onManageOwnListing(item)}
              />
            ))}
          </View>
        ) : (
          <Card style={styles.emptyCard}>
            <View style={styles.emptyIcon}><Ionicons name="storefront-outline" size={38} color={colors.green} /></View>
            <Text style={styles.emptyTitle}>{snapshot.listingCatalogOnline ? (distributionPolicy.newOrders ? '暂无可购买算力' : '暂无已审核算力') : '市场连接失败'}</Text>
            <Text style={styles.emptyCaption}>
              {snapshot.listingCatalogOnline
                ? '当前没有处于可售时段且余量足够的挂牌。'
                : '请检查网络后重试。'}
            </Text>
            {distributionPolicy.newOrders ? <Pressable style={styles.publishButton} onPress={onOpenPublish}>
              <Ionicons name="add-circle-outline" size={19} color={colors.surface} />
              <Text style={styles.publishButtonText}>发布算力需求</Text>
            </Pressable> : null}
          </Card>
        )}

        <View style={styles.marketNote}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.green} />
          <Text style={styles.marketNoteText}>{distributionPolicy.newOrders ? '市场只展示资源和卡时价已审核通过的挂牌。' : '目录只展示已经核验的资源信息。'}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 16, paddingBottom: 36 },
  introRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 8, marginBottom: 18 },
  title: { color: colors.ink, fontSize: 29, fontWeight: '900', letterSpacing: -0.6 },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 7 },
  searchBox: { minHeight: 56, paddingHorizontal: 16, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  searchInput: { flex: 1, color: colors.ink, fontSize: 15, paddingVertical: 0 },
  quickRow: { gap: 8, paddingVertical: 12 },
  quickChip: { justifyContent: 'center', paddingHorizontal: 13, height: 36, borderRadius: 12, backgroundColor: colors.greenSoft },
  quickText: { color: colors.greenDark, fontSize: 12, fontWeight: '700' },
  kindRow: { gap: 8, paddingBottom: 22 },
  kindChip: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  kindChipActive: { backgroundColor: colors.green, borderColor: colors.green },
  kindText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  kindTextActive: { color: colors.surface },
  marketHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 },
  marketTitle: { color: colors.ink, fontSize: 21, fontWeight: '800' },
  marketCaption: { color: colors.muted, fontSize: 12, marginTop: 3 },
  refreshButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.greenSoft },
  listings: { gap: 12 },
  balanceBar: { minHeight: 64, marginBottom: 13, paddingHorizontal: 14, borderRadius: 18, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.greenSoft },
  balanceIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  balanceCopy: { flex: 1, marginLeft: 11 },
  balanceLabel: { color: colors.muted, fontSize: 9 },
  balanceValue: { color: colors.greenDark, fontSize: 20, fontWeight: '900', marginTop: 2 },
  balanceUnit: { color: colors.green, fontSize: 10, fontWeight: '800' },
  listingCard: { padding: 16 },
  listingTop: { flexDirection: 'row', alignItems: 'center' },
  gpuGlyph: { width: 49, height: 49, borderRadius: 16, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  listingCopy: { flex: 1, marginLeft: 12 },
  listingTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  listingMeta: { color: colors.muted, fontSize: 11, marginTop: 4 },
  auditPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.greenSoft },
  auditText: { color: colors.green, fontSize: 10, fontWeight: '800' },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 19, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.line },
  priceCaption: { color: colors.muted, fontSize: 10 },
  price: { color: colors.greenDark, fontSize: 28, fontWeight: '900', letterSpacing: -0.8, marginTop: 2 },
  directoryValue: { color: colors.greenDark, fontSize: 24, fontWeight: '900', marginTop: 5 },
  priceUnit: { color: colors.muted, fontSize: 10, marginTop: 1 },
  stockBlock: { alignItems: 'flex-end' },
  stockLabel: { color: colors.muted, fontSize: 10 },
  stockValue: { color: colors.ink, fontSize: 15, fontWeight: '900', marginTop: 3 },
  minimum: { color: colors.muted, fontSize: 10, marginTop: 4 },
  factsRow: { flexDirection: 'row', gap: 7, marginTop: 14 },
  factChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9, backgroundColor: colors.canvas },
  factText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  detailPanel: { marginTop: 13, padding: 13, borderRadius: 14, backgroundColor: colors.canvas, gap: 5 },
  detailTitle: { color: colors.ink, fontSize: 12, fontWeight: '800', marginBottom: 3 },
  detailText: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  auditRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 7 },
  auditRowText: { color: colors.greenDark, fontSize: 11, fontWeight: '700' },
  validText: { color: colors.muted, fontSize: 10, marginLeft: 22 },
  actionRow: { flexDirection: 'row', gap: 9, marginTop: 12 },
  detailButton: { flex: 1, minHeight: 46, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailButtonText: { color: colors.green, fontSize: 13, fontWeight: '800' },
  buyButton: { minWidth: 112, minHeight: 46, paddingHorizontal: 17, borderRadius: 14, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green },
  buyButtonText: { color: colors.surface, fontSize: 13, fontWeight: '900' },
  emptyCard: { paddingHorizontal: 24, paddingVertical: 30, alignItems: 'center' },
  emptyIcon: { width: 78, height: 78, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.greenSoft, marginBottom: 17 },
  emptyTitle: { color: colors.ink, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  emptyCaption: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 9 },
  publishButton: { minHeight: 46, marginTop: 20, borderRadius: 15, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.green },
  publishButtonText: { color: colors.surface, fontSize: 14, fontWeight: '800' },
  marketNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 18, padding: 13, borderRadius: 14, backgroundColor: colors.greenSoft },
  marketNoteText: { flex: 1, color: colors.greenDark, fontSize: 12, lineHeight: 18 },
});
