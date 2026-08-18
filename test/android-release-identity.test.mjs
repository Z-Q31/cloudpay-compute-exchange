import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { androidVersionEvidence, validProjectId } from '../scripts/android-release-identity.mjs';

test('production Android release requires explicit, exclusive version history evidence', () => {
  assert.throws(() => androidVersionEvidence(2, {}), /Set exactly one/u);
  assert.throws(() => androidVersionEvidence(2, {
    CLOUDPAY_PUBLISHED_ANDROID_VERSION_CODE: '1', CLOUDPAY_ANDROID_PACKAGE_NEVER_PUBLISHED: '1',
  }), /Set exactly one/u);
  assert.deepEqual(androidVersionEvidence(2, { CLOUDPAY_PUBLISHED_ANDROID_VERSION_CODE: '1' }), {
    kind: 'published-version', candidateVersionCode: 2, publishedVersionCode: 1,
  });
  assert.deepEqual(androidVersionEvidence(1, { CLOUDPAY_ANDROID_PACKAGE_NEVER_PUBLISHED: '1' }), {
    kind: 'never-published', candidateVersionCode: 1,
  });
  assert.throws(() => androidVersionEvidence(1, { CLOUDPAY_PUBLISHED_ANDROID_VERSION_CODE: '1' }), /must be greater/u);
});

test('Expo project IDs must be real UUID-shaped identifiers before remote binding lookup', () => {
  assert.equal(validProjectId('8eb57c7a-7c5d-4d0e-8d32-5c5aca562f20'), true);
  assert.equal(validProjectId('00000000-0000-0000-0000-000000000000'), false);
  assert.equal(validProjectId('replace-me'), false);
});

test('provider preview replaces an incompatible legacy signature only on an emulator', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(packageJson.scripts['preview:android:provider'], /--replace-incompatible/u);
  const smoke = await readFile(new URL('../scripts/android-device-smoke.mjs', import.meta.url), 'utf8');
  assert.match(smoke, /getprop', 'ro\.kernel\.qemu'/u);
  assert.match(smoke, /Refusing to remove an incompatible app from a physical device/u);
});
