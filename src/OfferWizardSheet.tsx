import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet,
  Text, TextInput, View,
} from 'react-native';
import { ApiError } from './api-client';
import {
  createOfferDraft, createOfferRevision, getOfferDraft, getOfferRevision, listOfferDrafts, loadSupplierWorkspace, previewKaiCredits,
  getSupplierOffer, saveOfferDraft, saveOfferRevision, submitOfferDraft, submitOfferRevision, type ComputeResource,
  type OfferRevisionDraft, type OfferWizardDraft, type OfferWizardPayload, type OfferWizardStep,
} from './publishing';
import {
  draftSaveAccepted, isAmbiguousMutationFailure, revisionSubmissionAccepted, unknownSubmissionMessage, wizardSubmissionAccepted,
} from './mutation-recovery';
import { colors } from './theme';
import { cnyPrice, compactDecimal } from './format';
import {
  commonDeliveryTerms, draftPriceEvidence, formatCnyForEditing, normalizeCnyInput, shouldClearFormErrorOnEdit,
  validateOfferWizardStep,
} from './offer-wizard-form';

type Form = {
  title: string;
  serviceMode: NonNullable<OfferWizardPayload['serviceMode']>;
  minimumQuantity: string;
  availability: string;
  delivery: string;
  acceptance: string;
  refund: string;
  cleanup: string;
  suggestedPriceCny: string;
  priceComponents: string;
  evidenceType: 'contract' | 'invoice' | 'market_quote' | 'cost_breakdown';
  evidenceSource: string;
  evidenceSummary: string;
};

const emptyForm: Form = {
  title: '', serviceMode: 'dedicated', minimumQuantity: '1', availability: '', delivery: '', acceptance: '',
  refund: '', cleanup: '', suggestedPriceCny: '', priceComponents: '', evidenceType: 'contract',
  evidenceSource: '', evidenceSummary: '',
};

const steps: Array<{ key: OfferWizardStep; label: string; caption: string }> = [
  { key: 'service', label: '服务', caption: '怎么卖' },
  { key: 'terms', label: '边界', caption: '怎么交付' },
  { key: 'price', label: '价格', caption: '凭什么值' },
  { key: 'review', label: '确认', caption: '进入双审' },
];

const modeOptions: Array<{ value: Form['serviceMode']; label: string }> = [
  { value: 'dedicated', label: '整卡独享' }, { value: 'shared', label: '共享算力' },
  { value: 'slice', label: '切片实例' }, { value: 'node', label: '整机节点' }, { value: 'reserved', label: '预约时段' },
];

const evidenceOptions: Array<{ value: Form['evidenceType']; label: string }> = [
  { value: 'contract', label: '成交合同' }, { value: 'invoice', label: '发票' },
  { value: 'market_quote', label: '市场报价' }, { value: 'cost_breakdown', label: '成本拆分' },
];

type EditableOfferDraft = OfferWizardDraft | OfferRevisionDraft;

function formFromDraft(draft: EditableOfferDraft): Form {
  const payload = draft.payload;
  const evidence = payload.priceEvidence?.[0];
  const value = (record: Record<string, unknown> | undefined, key: string) => typeof record?.[key] === 'string' ? String(record[key]) : '';
  return {
    ...emptyForm,
    title: payload.title ?? '', serviceMode: payload.serviceMode ?? 'dedicated', minimumQuantity: payload.minimumQuantity ?? '1',
    availability: value(payload.sla, 'availability'), delivery: value(payload.deliveryTerms, 'summary'),
    acceptance: value(payload.acceptanceTerms, 'summary'), refund: value(payload.refundTerms, 'summary'),
    cleanup: value(payload.cleanupTerms, 'summary'), suggestedPriceCny: formatCnyForEditing(payload.suggestedPriceCny ?? ''),
    priceComponents: value(payload.priceComponents, 'summary'), evidenceType: evidence?.type ?? 'contract',
    evidenceSource: evidence?.source ?? '', evidenceSummary: evidence?.summary ?? '',
  };
}

function payloadFromForm(form: Form, capacityUnit: string, previous: OfferWizardPayload = {}): OfferWizardPayload {
  const record = (original: Record<string, unknown> | undefined, key: string, value: string) => {
    const next = { ...original };
    if (value.trim()) next[key] = value.trim(); else delete next[key];
    return next;
  };
  const firstEvidence = previous.priceEvidence?.[0];
  return {
    title: form.title, serviceMode: form.serviceMode, nativeUnit: capacityUnit, minimumQuantity: form.minimumQuantity,
    sla: record(previous.sla, 'availability', form.availability),
    deliveryTerms: record(previous.deliveryTerms, 'summary', form.delivery),
    acceptanceTerms: record(previous.acceptanceTerms, 'summary', form.acceptance),
    refundTerms: record(previous.refundTerms, 'summary', form.refund),
    cleanupTerms: record(previous.cleanupTerms, 'summary', form.cleanup),
    suggestedPriceCny: form.suggestedPriceCny,
    priceComponents: record(previous.priceComponents, 'summary', form.priceComponents),
    priceEvidence: [
      ...draftPriceEvidence(form.evidenceType, form.evidenceSource, form.evidenceSummary, firstEvidence),
      ...(previous.priceEvidence?.slice(1) ?? []),
    ],
  };
}

function isRevisionDraft(value: EditableOfferDraft): value is OfferRevisionDraft {
  return 'offerId' in value && typeof value.offerId === 'string';
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((result, key) => {
    result[key] = stableValue((value as Record<string, unknown>)[key]);
    return result;
  }, {});
}

function draftHasChanges(draft: EditableOfferDraft, step: OfferWizardStep, payload: OfferWizardPayload) {
  return draft.currentStep !== step || JSON.stringify(stableValue(draft.payload)) !== JSON.stringify(stableValue(payload));
}

async function saveDefaultOfferTitle(draft: OfferWizardDraft, resource: ComputeResource) {
  if (draft.payload.title?.trim()) return draft;
  const form = { ...formFromDraft(draft), title: `${resource.productCode} 算力服务` };
  return saveOfferDraft(draft.id, {
    expectedVersion: draft.version,
    currentStep: draft.currentStep,
    payload: payloadFromForm(form, draft.resource.capacityUnit, draft.payload),
  });
}

function serviceSummary(form: Form) {
  const mode = modeOptions.find((item) => item.value === form.serviceMode)?.label;
  return !mode || form.title.includes(mode) ? form.title : `${form.title} · ${mode}`;
}

function Field({ label, value, onChange, placeholder, multiline = false, decimal = false, hint }: Readonly<{
  label: string; value: string; onChange: (value: string) => void; placeholder: string; multiline?: boolean; decimal?: boolean; hint?: string;
}>) {
  return <View style={styles.field}>
    <View style={styles.fieldHeading}><Text style={styles.fieldLabel}>{label}</Text>{hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}</View>
    <TextInput
      accessibilityLabel={label} testID={`offer-field-${label}`}
      value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.subtle}
      keyboardType={decimal ? 'decimal-pad' : 'default'} multiline={multiline}
      returnKeyType={multiline ? 'default' : 'done'} submitBehavior={multiline ? 'newline' : 'blurAndSubmit'}
      style={[styles.input, multiline && styles.multiline]} maxLength={multiline ? 1000 : 120}
    />
  </View>;
}

export function OfferWizardSheet({ visible, resumeDraftId, initialResourceId, revisionOfferId, onClose, onSubmitted }: Readonly<{
  visible: boolean; resumeDraftId?: string | null; initialResourceId?: string | null; revisionOfferId?: string | null;
  onClose: () => void; onSubmitted: () => void | Promise<void>;
}>) {
  const [loading, setLoading] = useState(false);
  const [resources, setResources] = useState<ComputeResource[]>([]);
  const [draft, setDraftState] = useState<EditableOfferDraft | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [step, setStep] = useState<OfferWizardStep>('service');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'conflict' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [closing, setClosing] = useState(false);
  const [reload, setReload] = useState(0);
  const hydratedRef = useRef(false);
  const draftRef = useRef<EditableOfferDraft | null>(null);
  const desiredRef = useRef<{ step: OfferWizardStep; payload: OfferWizardPayload } | null>(null);
  const savingRef = useRef(false);
  const drainPromiseRef = useRef<Promise<EditableOfferDraft | null> | null>(null);
  const submitAttemptRef = useRef<{ fingerprint: string; requestId: string; expectedVersion: number } | null>(null);
  const submitInFlightRef = useRef(false);

  const setDraft = useCallback((value: EditableOfferDraft | null) => {
    draftRef.current = value;
    setDraftState(value);
  }, []);

  const hydrate = useCallback((value: EditableOfferDraft) => {
    hydratedRef.current = false;
    setDraft(value); setForm(formFromDraft(value)); setStep(value.currentStep); setSaveState('saved');
    requestAnimationFrame(() => { hydratedRef.current = true; });
  }, [setDraft]);

  useEffect(() => {
    if (!visible) {
      hydratedRef.current = false; desiredRef.current = null; setDraft(null); setForm(emptyForm); setError(null); setSaveState('idle');
      submitAttemptRef.current = null; submitInFlightRef.current = false; setClosing(false);
      return;
    }
    setLoading(true); setError(null); setResources([]);
    if (revisionOfferId) {
      void createOfferRevision(revisionOfferId, `offer-revision-${Crypto.randomUUID()}`)
        .then(hydrate)
        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '没有读取到需要修改的上架方案。'))
        .finally(() => setLoading(false));
      return;
    }
    void Promise.all([loadSupplierWorkspace(), listOfferDrafts()])
      .then(async ([workspace, drafts]) => {
        const verified = workspace.resources.filter((item) => item.status === 'verified');
        setResources(verified);
        if (resumeDraftId) { hydrate(await getOfferDraft(resumeDraftId)); return; }
        if (initialResourceId) {
          const existing = drafts.find((item) => item.resourceId === initialResourceId);
          if (existing) { hydrate(existing); return; }
          const resource = verified.find((item) => item.id === initialResourceId);
          if (!resource) throw new Error('这项资源尚未通过验真，不能创建上架方案。');
          const created = await createOfferDraft(resource.id, `wizard-create-${Crypto.randomUUID()}`);
          hydrate(await saveDefaultOfferTitle(created, resource));
          return;
        }
        if (drafts[0]) hydrate(drafts[0]);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '暂时无法读取上架草稿。'))
      .finally(() => setLoading(false));
  }, [hydrate, initialResourceId, reload, resumeDraftId, revisionOfferId, setDraft, visible]);

  const drain = useCallback((): Promise<EditableOfferDraft | null> => {
    if (drainPromiseRef.current) return drainPromiseRef.current;
    if (!draftRef.current) return Promise.resolve(null);
    const pending = Promise.resolve().then(async () => {
      savingRef.current = true;
      let failed = false;
      try {
        while (desiredRef.current && draftRef.current) {
          const desired = desiredRef.current; desiredRef.current = null; setSaveState('saving');
          const current = draftRef.current;
          try {
            const saved = isRevisionDraft(current)
              ? await saveOfferRevision(current.offerId, {
                expectedVersion: current.version, currentStep: desired.step, payload: desired.payload,
              })
              : await saveOfferDraft(current.id, {
              expectedVersion: current.version, currentStep: desired.step, payload: desired.payload,
              });
            setDraft(saved); setSaveState('saved');
          } catch (reason) {
            const uncertain = isAmbiguousMutationFailure(reason) || (reason instanceof ApiError && reason.status === 409);
            if (uncertain) {
              try {
                const latest = isRevisionDraft(current)
                  ? await getOfferRevision(current.offerId)
                  : await getOfferDraft(current.id);
                if (draftSaveAccepted(current, desired, latest)) {
                  setDraft(latest); setSaveState('saved');
                  continue;
                }
                if (reason instanceof ApiError && reason.status === 409) {
                  desiredRef.current = null;
                  setSaveState('conflict');
                  setError('这份方案已经更新，请重新打开后继续。');
                  failed = true;
                  break;
                }
              } catch { /* The form stays in memory and can be retried explicitly. */ }
            }
            desiredRef.current = null;
            setSaveState('error');
            setError(isAmbiguousMutationFailure(reason)
              ? '网络中断，当前内容仍在页面。恢复网络后点“未保存”重试。'
              : reason instanceof Error ? reason.message : '暂时没有保存成功，请再试一次。');
            failed = true;
            break;
          }
        }
        return failed ? null : draftRef.current;
      } finally {
        savingRef.current = false;
      }
    }).finally(() => {
      drainPromiseRef.current = null;
      if (desiredRef.current) queueMicrotask(() => { void drain(); });
    });
    drainPromiseRef.current = pending;
    return pending;
  }, [setDraft]);

  const flush = useCallback(async () => {
    let latest = draftRef.current;
    do {
      latest = await drain();
      if (!latest) return null;
    } while (desiredRef.current || drainPromiseRef.current);
    return latest;
  }, [drain]);

  const retrySave = useCallback(() => {
    const current = draftRef.current;
    if (!current || savingRef.current || saveState === 'conflict') return;
    desiredRef.current = {
      step,
      payload: payloadFromForm(form, current.resource.capacityUnit, current.payload),
    };
    setError(null); setSaveState('idle'); void drain();
  }, [drain, form, saveState, step]);

  useEffect(() => {
    if (!visible || !draft || !hydratedRef.current || saveState === 'conflict') return;
    const payload = payloadFromForm(form, draft.resource.capacityUnit, draft.payload);
    if (!draftHasChanges(draft, step, payload)) { setSaveState('saved'); return; }
    desiredRef.current = { step, payload };
    setSaveState('idle');
    const timer = setTimeout(() => { void drain(); }, 850);
    return () => clearTimeout(timer);
  }, [draft?.id, drain, form, step, visible]);

  useEffect(() => {
    if (!visible || !draft || !hydratedRef.current) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' || !draftRef.current || !hydratedRef.current) return;
      const payload = payloadFromForm(form, draft.resource.capacityUnit, draft.payload);
      if (!draftHasChanges(draftRef.current, step, payload)) return;
      desiredRef.current = { step, payload };
      void drain();
    });
    return () => subscription.remove();
  }, [draft, drain, form, step, visible]);

  const closeSafely = useCallback(async () => {
    if (closing || submitInFlightRef.current) return;
    if (!draftRef.current || !hydratedRef.current) { onClose(); return; }
    if (saveState === 'conflict') {
      setError('这份方案已经更新，请重新打开后继续。');
      return;
    }
    setClosing(true); setError(null);
    const payload = payloadFromForm(form, draftRef.current.resource.capacityUnit, draftRef.current.payload);
    if (!draftHasChanges(draftRef.current, step, payload)) { onClose(); return; }
    desiredRef.current = { step, payload };
    const saved = await flush();
    if (!saved) {
      setClosing(false);
      Alert.alert('还没有保存成功', '请检查网络后再关闭，当前填写内容仍保留在页面中。');
      return;
    }
    onClose();
  }, [closing, flush, form, onClose, saveState, step]);

  const chooseResource = async (resource: ComputeResource) => {
    setLoading(true); setError(null);
    try {
      const created = await createOfferDraft(resource.id, `wizard-create-${Crypto.randomUUID()}`);
      hydrate(await saveDefaultOfferTitle(created, resource));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '无法创建上架草稿。'); }
    finally { setLoading(false); }
  };

  const index = steps.findIndex((item) => item.key === step);
  const update = <Key extends keyof Form>(key: Key, value: Form[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (shouldClearFormErrorOnEdit(saveState)) setError(null);
  };
  const validation = validateOfferWizardStep(step, form);

  const next = () => {
    if (validation) { setError(validation); return; }
    const target = steps[Math.min(index + 1, steps.length - 1)]!.key;
    Keyboard.dismiss(); setError(null); setStep(target);
    if (draftRef.current) {
      desiredRef.current = { step: target, payload: payloadFromForm(form, draftRef.current.resource.capacityUnit, draftRef.current.payload) };
      setSaveState('idle'); void drain();
    }
    void Haptics.selectionAsync();
  };
  const previous = () => {
    const target = steps[Math.max(index - 1, 0)]!.key;
    Keyboard.dismiss(); setError(null); setStep(target);
    if (draftRef.current) {
      desiredRef.current = { step: target, payload: payloadFromForm(form, draftRef.current.resource.capacityUnit, draftRef.current.payload) };
      setSaveState('idle'); void drain();
    }
  };

  const useCommonTerms = () => {
    if (!draft) return;
    const terms = commonDeliveryTerms(draft.resource.name);
    setForm((current) => ({ ...current, ...terms }));
    setError(null); void Haptics.selectionAsync();
  };

  const submit = async () => {
    if (!draft || submitInFlightRef.current) return;
    if (savingRef.current) { setError('正在保存最新内容，保存完成后再确认提交。'); return; }
    submitInFlightRef.current = true;
    setSubmitting(true); setError(null);
    const submitPayload = payloadFromForm(form, draft.resource.capacityUnit, draft.payload);
    const fingerprint = JSON.stringify(submitPayload);
    let submittedDraft: EditableOfferDraft | null = null;
    const showSubmitted = () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('已提交', revision
        ? '修改已经提交，资源和价格会重新审核，结果会发到消息里。'
        : '资源和价格会分别审核，结果会发到消息里。', [{
        text: '知道了', onPress: () => { onClose(); void onSubmitted(); },
      }]);
    };
    try {
      const existingAttempt = submitAttemptRef.current?.fingerprint === fingerprint ? submitAttemptRef.current : null;
      let latest = draftRef.current;
      if (!existingAttempt) {
        desiredRef.current = { step: 'review', payload: submitPayload };
        latest = await flush();
      }
      if (!latest) return;
      submittedDraft = latest;
      const requestId = existingAttempt?.requestId
        ?? `${isRevisionDraft(latest) ? 'revision' : 'wizard'}-submit-${Crypto.randomUUID()}`;
      const expectedVersion = existingAttempt?.expectedVersion ?? latest.version;
      submitAttemptRef.current = { fingerprint, requestId, expectedVersion };
      if (isRevisionDraft(latest)) {
        await submitOfferRevision(latest.offerId, expectedVersion, requestId);
      } else {
        await submitOfferDraft(latest.id, expectedVersion, requestId);
      }
      showSubmitted();
    } catch (reason) {
      if (submittedDraft && isAmbiguousMutationFailure(reason)) {
        try {
          const accepted = isRevisionDraft(submittedDraft)
            ? revisionSubmissionAccepted(submittedDraft, await getSupplierOffer(submittedDraft.offerId))
            : wizardSubmissionAccepted(await getOfferDraft(submittedDraft.id));
          if (accepted) { showSubmitted(); return; }
        } catch { /* Keep the original unknown result and the same idempotency key. */ }
        setError(unknownSubmissionMessage);
      } else setError(reason instanceof Error ? reason.message : '提交审核失败，请稍后重试。');
    }
    finally { submitInFlightRef.current = false; setSubmitting(false); }
  };

  const pricePreview = previewKaiCredits(form.suggestedPriceCny);
  const revision = draft && isRevisionDraft(draft) ? draft : null;
  const handleRequestClose = () => {
    if (Keyboard.isVisible()) { Keyboard.dismiss(); return; }
    void closeSafely();
  };
  return <Modal visible={visible} animationType="slide" transparent onRequestClose={handleRequestClose}>
    <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <View><Text style={styles.eyebrow}>算力上架</Text><Text style={styles.title}>{revisionOfferId ? '修改上架方案' : '上架方案'}</Text></View>
          <View style={styles.headerActions}>
            {draft ? <Pressable accessibilityLabel={saveState === 'error' ? '重新保存上架方案' : '上架方案保存状态'} disabled={saveState !== 'error'} onPress={retrySave} style={[styles.savePill, saveState === 'error' || saveState === 'conflict' ? styles.savePillError : null]}>
              <Ionicons name={saveState === 'saving' ? 'cloud-upload-outline' : saveState === 'saved' ? 'cloud-done-outline' : 'ellipse-outline'} size={14} color={saveState === 'error' || saveState === 'conflict' ? colors.red : colors.green} />
              <Text style={[styles.saveText, saveState === 'error' || saveState === 'conflict' ? styles.saveTextError : null]}>{saveState === 'saving' ? '保存中' : saveState === 'saved' ? '已保存' : saveState === 'conflict' ? '版本冲突' : saveState === 'error' ? '未保存' : '待保存'}</Text>
            </Pressable> : null}
            <Pressable accessibilityLabel="保存并退出上架方案" disabled={closing || submitting} onPress={() => void closeSafely()} style={[styles.close, (closing || submitting) && styles.buttonDisabled]}>
              {closing ? <ActivityIndicator size="small" color={colors.green} /> : <Ionicons name="close" size={23} color={colors.ink} />}
            </Pressable>
          </View>
        </View>

        {loading ? <View style={styles.center}><ActivityIndicator color={colors.green} /><Text style={styles.loadingText}>正在读取上架进度…</Text></View> : null}
        {!loading && !draft ? <ScrollView contentContainerStyle={styles.resourceContent}>
          <View style={styles.resourceHero}><Ionicons name="cube-outline" size={30} color={colors.green} /><Text style={styles.resourceTitle}>选择已验真的资源</Text><Text style={styles.resourceCaption}>服务型号和计量单位将直接使用资源验真结果。</Text></View>
          {error ? <ErrorBox text={error} /> : null}
          {error ? <Pressable onPress={() => setReload((value) => value + 1)} style={styles.retryButton}><Text style={styles.retryText}>重新读取</Text></Pressable> : null}
          {resources.map((resource) => <Pressable key={resource.id} onPress={() => void chooseResource(resource)} style={styles.resourceCard}>
            <View style={styles.resourceIcon}><Text style={styles.resourceInitial}>{resource.productCode.slice(0, 1)}</Text></View>
            <View style={styles.resourceCopy}><Text style={styles.resourceName}>{resource.productCode}</Text><Text style={styles.resourceMeta}>{resource.region} · {compactDecimal(resource.capacityTotal)} {resource.capacityUnit}</Text></View>
            <Ionicons name="arrow-forward-circle" size={25} color={colors.green} />
          </Pressable>)}
          {resources.length === 0 && !error ? <View style={styles.empty}><Ionicons name="shield-outline" size={30} color={colors.amber} /><Text style={styles.emptyTitle}>还没有已验真资源</Text><Text style={styles.emptyText}>资源通过真实性审核后，才能填写上架方案。</Text></View> : null}
        </ScrollView> : null}

        {!loading && draft ? <>
          <View style={styles.stepBar}>{steps.map((item, itemIndex) => <View key={item.key} style={styles.stepItem}>
            <View style={[styles.stepDot, itemIndex <= index && styles.stepDotActive]}>{itemIndex < index ? <Ionicons name="checkmark" size={12} color={colors.surface} /> : <Text style={[styles.stepNumber, itemIndex <= index && styles.stepNumberActive]}>{itemIndex + 1}</Text>}</View>
            <Text style={[styles.stepLabel, itemIndex === index && styles.stepLabelActive]}>{item.label}</Text>
          </View>)}</View>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} showsVerticalScrollIndicator={false}>
            <View style={styles.assetStrip}><View><Text style={styles.assetEyebrow}>已验真资源</Text><Text style={styles.assetName}>{draft.resource.name}</Text></View><Text style={styles.assetUnit}>{draft.resource.capacityUnit}</Text></View>
            {revision?.reviewFeedback.map((feedback) => feedback.returnStep === step || step === 'review' ? (
              <View key={`${feedback.kind}-${feedback.returnStep}`} style={styles.feedbackBox}>
                <View style={styles.feedbackTop}><Ionicons name="chatbox-ellipses-outline" size={18} color={colors.red} /><Text style={styles.feedbackTitle}>{feedback.kind === 'price' ? '价格审核意见' : '资源审核意见'}</Text></View>
                <Text style={styles.feedbackReason}>{feedback.reason ?? '请按审核要求修改这一部分。'}</Text>
                {feedback.summary ? <Text style={styles.feedbackSummary}>{feedback.summary}</Text> : null}
              </View>
            ) : null)}
            {error ? <ErrorBox text={error} /> : null}

            {step === 'service' ? <>
              <SectionHeading icon="sparkles-outline" title="服务信息" caption="填写买方实际购买和使用的服务规格。" />
              <Field label="服务名称" value={form.title} onChange={(value) => update('title', value)} placeholder="例如：H100 80G 整卡独享" />
              <Text style={styles.fieldLabel}>交付形态</Text><View style={styles.chips}>{modeOptions.map((option) => <Pressable key={option.value} onPress={() => update('serviceMode', option.value)} style={[styles.chip, form.serviceMode === option.value && styles.chipActive]}><Text style={[styles.chipText, form.serviceMode === option.value && styles.chipTextActive]}>{option.label}</Text></Pressable>)}</View>
              <Field label="最小起售量" value={form.minimumQuantity} onChange={(value) => update('minimumQuantity', value)} placeholder="1" decimal hint={draft.resource.capacityUnit} />
            </> : null}

            {step === 'terms' ? <>
              <SectionHeading icon="git-branch-outline" title="交付条款" caption="填写服务保障、验收、退款和数据清理规则。" />
              <View style={styles.templateBox}><View style={styles.templateCopy}><Text style={styles.templateTitle}>从常用条款开始</Text><Text style={styles.templateText}>一键填入五项基础内容，再按实际交付能力修改。</Text></View><Pressable accessibilityLabel="填入常用交付条款" onPress={useCommonTerms} style={styles.templateButton}><Text style={styles.templateButtonText}>填入模板</Text></Pressable></View>
              <Field label="服务保障" value={form.availability} onChange={(value) => update('availability', value)} placeholder="例如：月可用性 99.9%，故障 15 分钟内响应" multiline />
              <Field label="交付方式" value={form.delivery} onChange={(value) => update('delivery', value)} placeholder="例如：平台工作区交付，开通后消息通知" multiline />
              <Field label="验收规则" value={form.acceptance} onChange={(value) => update('acceptance', value)} placeholder="例如：以型号、显存、互联和可用时长为准" multiline />
              <Field label="退款规则" value={form.refund} onChange={(value) => update('refund', value)} placeholder="例如：归责资源方的中断按分钟退还卡时" multiline />
              <Field label="数据清理" value={form.cleanup} onChange={(value) => update('cleanup', value)} placeholder="例如：任务结束后 2 小时内清理工作数据" multiline />
            </> : null}

            {step === 'price' ? <>
              <SectionHeading icon="analytics-outline" title="价格与核价材料" caption="人民币用于核价；市场成交使用 KAI 卡时。" />
              <Field label={`人民币依据 / ${draft.resource.capacityUnit}`} value={form.suggestedPriceCny} onChange={(value) => update('suggestedPriceCny', normalizeCnyInput(value))} placeholder="例如：31.20" decimal hint="仅作核价依据" />
              <View style={styles.priceCard}><View><Text style={styles.priceLabel}>提交核价参考</Text>{pricePreview ? <Text style={styles.priceValue}>{pricePreview} <Text style={styles.priceUnit}>KAI 卡时</Text></Text> : <Text style={styles.priceEmpty}>填写人民币依据后自动换算</Text>}</View><View style={styles.auditPill}><Ionicons name="time-outline" size={14} color={colors.amber} /><Text style={styles.auditText}>等待价格审核</Text></View><Text style={styles.conversion}>按 ¥1.002 / 卡时自动换算；最终挂牌价由价格审核锁定</Text></View>
              <Field label="价格构成" value={form.priceComponents} onChange={(value) => update('priceComponents', value)} placeholder="说明设备折旧、电力、网络、运维与税费是否包含" multiline />
              <Text style={styles.fieldLabel}>核价凭证</Text><View style={styles.chips}>{evidenceOptions.map((option) => <Pressable key={option.value} onPress={() => update('evidenceType', option.value)} style={[styles.chip, form.evidenceType === option.value && styles.chipActive]}><Text style={[styles.chipText, form.evidenceType === option.value && styles.chipTextActive]}>{option.label}</Text></Pressable>)}</View>
              <Field label="凭证来源" value={form.evidenceSource} onChange={(value) => update('evidenceSource', value)} placeholder="例如：近三个月同型号成交合同" />
              <Field label="凭证说明" value={form.evidenceSummary} onChange={(value) => update('evidenceSummary', value)} placeholder="说明时间、地区、型号与本次报价的可比性" multiline />
            </> : null}

            {step === 'review' ? <>
              <SectionHeading icon="shield-checkmark-outline" title="提交审核" caption="资源与价格分别审核；需要补充时会说明具体项目。" />
              <ReviewRow label="服务" value={serviceSummary(form)} />
              <ReviewRow label="起售" value={`${compactDecimal(form.minimumQuantity)} ${draft.resource.capacityUnit}`} />
              <ReviewRow label="交付边界" value="保障、交付、验收、退款和数据清理已定义" />
              <ReviewRow label="提交核价参考" value={`¥${cnyPrice(form.suggestedPriceCny) || '—'} → ${pricePreview ?? '—'} KAI 卡时 / ${draft.resource.capacityUnit}；最终以审核结果为准`} />
              <ReviewRow label="核价凭证" value={`${evidenceOptions.find((item) => item.value === form.evidenceType)?.label ?? '凭证'} · ${form.evidenceSource.trim() || '未填写来源'}`} />
              <ReviewRow label="凭证说明" value={form.evidenceSummary.trim() || '未填写说明'} />
              <View style={styles.auditMap}><View style={styles.auditNode}><Ionicons name="hardware-chip-outline" size={22} color={colors.green} /><Text style={styles.auditNodeTitle}>资源审核</Text><Text style={styles.auditNodeText}>核对配置、控制权、容量和交付能力</Text></View><View style={styles.auditDivider} /><View style={styles.auditNode}><Ionicons name="calculator-outline" size={22} color={colors.green} /><Text style={styles.auditNodeTitle}>价格审核</Text><Text style={styles.auditNodeText}>核对人民币依据，确定每小时卡时价</Text></View></View>
            </> : null}
          </ScrollView>
          <View style={styles.footer}>
            {index > 0 ? <Pressable onPress={previous} style={styles.secondaryButton}><Ionicons name="arrow-back" size={18} color={colors.ink} /><Text style={styles.secondaryText}>上一步</Text></Pressable> : <View />}
            {index < steps.length - 1 ? <Pressable onPress={next} style={styles.nextButton}><Text style={styles.nextText}>下一步 · {steps[index + 1]!.label}</Text><Ionicons name="arrow-forward" size={18} color={colors.surface} /></Pressable> : (
              <Pressable disabled={submitting || saveState === 'conflict' || saveState === 'saving'} onPress={() => void submit()} style={[styles.footerSubmit, (submitting || saveState === 'conflict' || saveState === 'saving') && styles.buttonDisabled]}>
                {submitting ? <><ActivityIndicator color={colors.surface} /><Text style={styles.submitText}>正在提交并确认…</Text></> : <><Text style={styles.submitText}>{revision ? '提交修改，重新审核' : '提交审核'}</Text><Ionicons name="arrow-forward" size={18} color={colors.surface} /></>}
              </Pressable>
            )}
          </View>
        </> : null}
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

function SectionHeading({ icon, title, caption }: Readonly<{ icon: 'sparkles-outline' | 'git-branch-outline' | 'analytics-outline' | 'shield-checkmark-outline'; title: string; caption: string }>) {
  return <View style={styles.sectionHeading}><View style={styles.sectionIcon}><Ionicons name={icon} size={22} color={colors.green} /></View><View style={styles.sectionCopy}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.sectionCaption}>{caption}</Text></View></View>;
}
function ReviewRow({ label, value }: Readonly<{ label: string; value: string }>) { return <View style={styles.reviewRow}><Text style={styles.reviewLabel}>{label}</Text><Text style={styles.reviewValue}>{value}</Text></View>; }
function ErrorBox({ text }: Readonly<{ text: string }>) { return <View style={styles.errorBox}><Ionicons name="alert-circle-outline" size={18} color={colors.red} /><Text style={styles.errorText}>{text}</Text></View>; }

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(10,24,17,0.42)' }, sheet: { height: '96%', backgroundColor: colors.canvas, borderTopLeftRadius: 30, borderTopRightRadius: 30, overflow: 'hidden' }, handle: { width: 42, height: 5, borderRadius: 3, alignSelf: 'center', marginTop: 9, backgroundColor: '#D2DDD5' },
  header: { minHeight: 72, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, eyebrow: { color: colors.green, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 }, title: { color: colors.ink, fontSize: 25, fontWeight: '900', marginTop: 3 }, headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 }, close: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  savePill: { height: 32, paddingHorizontal: 10, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.greenSoft }, savePillError: { backgroundColor: '#FDECEC' }, saveText: { color: colors.green, fontSize: 10, fontWeight: '900' }, saveTextError: { color: colors.red }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, loadingText: { color: colors.muted, fontSize: 12, marginTop: 10 },
  stepBar: { paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line, backgroundColor: colors.surface }, stepItem: { flex: 1, alignItems: 'center' }, stepDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E4EBE6' }, stepDotActive: { backgroundColor: colors.green }, stepNumber: { color: colors.muted, fontSize: 9, fontWeight: '900' }, stepNumberActive: { color: colors.surface }, stepLabel: { color: colors.muted, fontSize: 10, fontWeight: '800', marginTop: 4 }, stepLabelActive: { color: colors.green },
  content: { padding: 17, paddingBottom: 30 }, assetStrip: { minHeight: 62, paddingHorizontal: 14, marginBottom: 19, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#0B4F2B' }, assetEyebrow: { color: '#AEEAC0', fontSize: 8, fontWeight: '900', letterSpacing: 1.2 }, assetName: { color: colors.surface, fontSize: 14, fontWeight: '900', marginTop: 3 }, assetUnit: { color: '#D8F7E1', fontSize: 11, fontWeight: '800' },
  sectionHeading: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 19 }, sectionIcon: { width: 45, height: 45, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.greenSoft }, sectionCopy: { flex: 1, marginLeft: 11 }, sectionTitle: { color: colors.ink, fontSize: 20, fontWeight: '900' }, sectionCaption: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 4 },
  field: { marginBottom: 14 }, fieldHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }, fieldLabel: { color: colors.ink, fontSize: 12, fontWeight: '900', marginBottom: 7 }, fieldHint: { color: colors.green, fontSize: 9, fontWeight: '800' }, input: { minHeight: 52, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.line, borderRadius: 16, color: colors.ink, fontSize: 14, backgroundColor: colors.surface }, multiline: { minHeight: 84, paddingTop: 13, textAlignVertical: 'top' }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 15 }, chip: { paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: colors.line, borderRadius: 999, backgroundColor: colors.surface }, chipActive: { borderColor: colors.green, backgroundColor: colors.green }, chipText: { color: colors.muted, fontSize: 11, fontWeight: '800' }, chipTextActive: { color: colors.surface },
  templateBox: { minHeight: 74, padding: 13, marginBottom: 16, borderRadius: 18, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.greenSoft }, templateCopy: { flex: 1, paddingRight: 10 }, templateTitle: { color: colors.greenDark, fontSize: 12, fontWeight: '900' }, templateText: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 3 }, templateButton: { minHeight: 38, paddingHorizontal: 13, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green }, templateButtonText: { color: colors.surface, fontSize: 10, fontWeight: '900' },
  priceCard: { minHeight: 118, padding: 16, marginBottom: 15, borderRadius: 20, backgroundColor: '#102D20' }, priceLabel: { color: '#BCECC9', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 }, priceValue: { color: colors.surface, fontSize: 27, fontWeight: '900', marginTop: 6 }, priceEmpty: { color: colors.surface, fontSize: 15, fontWeight: '800', marginTop: 13 }, priceUnit: { fontSize: 12, color: '#D1F4DB' }, auditPill: { position: 'absolute', right: 14, top: 14, paddingHorizontal: 9, paddingVertical: 6, flexDirection: 'row', gap: 5, borderRadius: 999, backgroundColor: '#FFF4D4' }, auditText: { color: colors.amber, fontSize: 9, fontWeight: '900' }, conversion: { color: '#9BC9A8', fontSize: 9, marginTop: 10 },
  reviewRow: { minHeight: 67, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line }, reviewLabel: { color: colors.green, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 }, reviewValue: { color: colors.ink, fontSize: 13, fontWeight: '800', lineHeight: 19, marginTop: 5 }, auditMap: { flexDirection: 'row', alignItems: 'stretch', marginTop: 18, padding: 14, borderRadius: 20, backgroundColor: colors.greenSoft }, auditNode: { flex: 1 }, auditNodeTitle: { color: colors.greenDark, fontSize: 12, fontWeight: '900', marginTop: 7 }, auditNodeText: { color: colors.muted, fontSize: 9, lineHeight: 14, marginTop: 4 }, auditDivider: { width: 1, marginHorizontal: 11, backgroundColor: '#B9D9C1' }, submitButton: { minHeight: 54, marginTop: 18, borderRadius: 17, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green }, submitText: { color: colors.surface, fontSize: 14, fontWeight: '900' }, buttonDisabled: { opacity: 0.5 },
  footer: { minHeight: 74, paddingHorizontal: 17, paddingTop: 10, paddingBottom: 10, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, secondaryButton: { height: 48, paddingHorizontal: 14, borderRadius: 15, flexDirection: 'row', gap: 7, alignItems: 'center', backgroundColor: colors.canvas }, secondaryText: { color: colors.ink, fontSize: 12, fontWeight: '900' }, nextButton: { height: 48, paddingHorizontal: 18, borderRadius: 15, flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: colors.green }, nextText: { color: colors.surface, fontSize: 12, fontWeight: '900' },
  footerSubmit: { height: 48, paddingHorizontal: 17, borderRadius: 15, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green },
  errorBox: { padding: 12, marginBottom: 14, borderRadius: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#FDECEC' }, errorText: { flex: 1, color: colors.red, fontSize: 11, lineHeight: 17 },
  feedbackBox: { padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#F2C9C9', borderRadius: 17, backgroundColor: '#FFF7F7' },
  feedbackTop: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  feedbackTitle: { color: colors.red, fontSize: 12, fontWeight: '900' },
  feedbackReason: { color: colors.ink, fontSize: 13, lineHeight: 20, fontWeight: '700', marginTop: 9 },
  feedbackSummary: { color: colors.muted, fontSize: 10, lineHeight: 16, marginTop: 6 },
  resourceContent: { padding: 18, paddingBottom: 30 }, resourceHero: { padding: 21, marginBottom: 16, borderRadius: 23, backgroundColor: colors.greenSoft }, resourceTitle: { color: colors.greenDark, fontSize: 21, fontWeight: '900', marginTop: 13 }, resourceCaption: { color: colors.muted, fontSize: 11, lineHeight: 18, marginTop: 6 }, resourceCard: { minHeight: 82, padding: 13, marginBottom: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 20, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface }, resourceIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green }, resourceInitial: { color: colors.surface, fontSize: 21, fontWeight: '900' }, resourceCopy: { flex: 1, marginLeft: 12 }, resourceName: { color: colors.ink, fontSize: 14, fontWeight: '900' }, resourceMeta: { color: colors.muted, fontSize: 10, marginTop: 4 }, empty: { alignItems: 'center', padding: 26, borderRadius: 22, backgroundColor: colors.surface }, emptyTitle: { color: colors.ink, fontSize: 16, fontWeight: '900', marginTop: 12 }, emptyText: { color: colors.muted, fontSize: 11, lineHeight: 18, textAlign: 'center', marginTop: 6 },
  retryButton: { minHeight: 46, marginBottom: 14, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green }, retryText: { color: colors.surface, fontSize: 12, fontWeight: '900' },
});
