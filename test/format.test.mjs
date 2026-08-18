import assert from 'node:assert/strict';
import test from 'node:test';
import { cnyPrice, creditUnitPrice } from '../src/format.ts';

test('卡时单价用两位小数展示但不改变服务端原值', () => {
  assert.equal(creditUnitPrice('31.137725'), '31.14');
  assert.equal(creditUnitPrice('31.134999'), '31.13');
  assert.equal(creditUnitPrice('9'), '9.00');
  assert.equal(creditUnitPrice('99.999999'), '100.00');
});

test('人民币核价依据固定显示两位小数', () => {
  assert.equal(cnyPrice('31.200000'), '31.20');
  assert.equal(cnyPrice('31'), '31.00');
});
