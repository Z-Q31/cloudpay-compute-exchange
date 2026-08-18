import type { OfferWizardStep } from './publishing';

export type OfferWizardFormValues = Readonly<{
  title: string;
  minimumQuantity: string;
  availability: string;
  delivery: string;
  acceptance: string;
  refund: string;
  cleanup: string;
  suggestedPriceCny: string;
  priceComponents: string;
  evidenceSource: string;
  evidenceSummary: string;
}>;

export function shouldClearFormErrorOnEdit(saveState: 'idle' | 'saving' | 'saved' | 'conflict' | 'error') {
  return saveState !== 'error' && saveState !== 'conflict';
}

type DraftPriceEvidence = Readonly<{
  type: 'contract' | 'invoice' | 'market_quote' | 'cost_breakdown';
  source: string;
  summary: string;
  digest?: string;
}>;

export function draftPriceEvidence(
  type: DraftPriceEvidence['type'],
  source: string,
  summary: string,
  previous?: DraftPriceEvidence,
) {
  return [{
    ...(previous?.digest ? { digest: previous.digest } : {}),
    type,
    source: source.trim(),
    summary: summary.trim(),
  }];
}

export function normalizeCnyInput(input: string) {
  const clean = input.replace(/[^0-9.]/gu, '');
  const dot = clean.indexOf('.');
  if (dot < 0) return clean.slice(0, 9);
  const integer = (clean.slice(0, dot) || '0').slice(0, 9);
  const decimals = clean.slice(dot + 1).replace(/\./gu, '').slice(0, 2);
  return `${integer}.${decimals}`;
}

export function formatCnyForEditing(input: string) {
  if (!/^\d+(?:\.\d+)?$/u.test(input.trim())) return input;
  const [whole = '0', rawFraction = ''] = input.trim().split('.');
  const fraction = rawFraction.replace(/0+$/u, '').padEnd(2, '0').slice(0, 2);
  return `${BigInt(whole)}.${fraction}`;
}

export function validateOfferWizardStep(step: OfferWizardStep, form: OfferWizardFormValues) {
  if (step === 'service' && (form.title.trim().length < 2 || Number(form.minimumQuantity) <= 0)) {
    return '请填写服务名称与最小起售量。';
  }
  if (step === 'terms' && [form.availability, form.delivery, form.acceptance, form.refund, form.cleanup]
    .some((value) => value.trim().length < 2)) {
    return '请完整定义保障、交付、验收、退款和数据清理边界。';
  }
  const validCny = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/u.test(form.suggestedPriceCny)
    && Number(form.suggestedPriceCny) > 0;
  if (step === 'price' && (!validCny || form.priceComponents.trim().length < 4
    || form.evidenceSource.trim().length < 2 || form.evidenceSummary.trim().length < 4)) {
    return '请填写人民币依据、价格构成和一条可核验凭证。';
  }
  return null;
}

export function commonDeliveryTerms(productCode: string) {
  const product = productCode.trim() || '已验真资源';
  return {
    availability: '月可用性不低于 99.9%，故障 15 分钟内响应',
    delivery: '通过平台工作区交付，开通完成后由消息通知',
    acceptance: `以 ${product} 型号、已验真配置、可用时长和交付记录为准`,
    refund: '归责资源方的服务中断，按实际受影响分钟退还 KAI 卡时',
    cleanup: '任务结束后 2 小时内清理工作数据，并保留清理记录',
  } as const;
}
