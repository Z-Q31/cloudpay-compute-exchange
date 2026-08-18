import assert from 'node:assert/strict';
import test from 'node:test';
import { resourceCollectingCopy, resourceEvidenceCopy } from '../src/resource-evidence-copy.ts';

test('submitted evidence reads as review progress and no longer prompts for file formats', () => {
  assert.deepEqual(resourceEvidenceCopy('under_review', null, false, 3), {
    headerTitle: '审核进度', reviewTitle: '平台审核中', reviewText: '审核结果会通过消息通知。', showFormatNote: false,
  });
});

test('collecting evidence keeps the upload guidance', () => {
  assert.deepEqual(resourceEvidenceCopy('collecting', null, true, 3), {
    headerTitle: '准备审核材料', reviewTitle: '材料已齐，可以提交', reviewText: '文件通过安全检查后，才能提交平台审核。', showFormatNote: true,
  });
});

test('a resumed correction keeps the concrete review instruction on the resource card', () => {
  assert.deepEqual(resourceCollectingCopy(' 配置截图缺少设备序列号，请更换配置材料后重新提交。 '), {
    summary: '配置截图缺少设备序列号，请更换配置材料后重新提交。', action: '继续补充材料',
  });
  assert.deepEqual(resourceCollectingCopy(null), {
    summary: '准备三类材料后提交平台审核。', action: '准备审核材料',
  });
});
