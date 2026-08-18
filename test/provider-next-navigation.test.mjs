import assert from 'node:assert/strict';
import test from 'node:test';
import {
  providerNextNavigation, providerOfferMessageActionLabel, providerOfferMessageDestination,
} from '../src/provider-next-navigation.ts';

test('provider next actions land on their exact mobile task', () => {
  assert.deepEqual(providerNextNavigation('provider_onboarding', 'supplier-1'), {
    tab: 'publish', publishIntent: 'supplier',
  });
  assert.deepEqual(providerNextNavigation('provider_resource_editor', null), {
    tab: 'publish', publishIntent: 'sell',
  });
  assert.deepEqual(providerNextNavigation('provider_resources', 'resource-1'), {
    tab: 'resources', resourceId: 'resource-1',
  });
  assert.deepEqual(providerNextNavigation('provider_offer_create', 'resource-2'), {
    tab: 'publish', offerResourceId: 'resource-2',
  });
  assert.deepEqual(providerNextNavigation('messages', 'supplier-1'), { tab: 'messages' });
  assert.deepEqual(providerNextNavigation('provider_review', 'supplier-1'), {
    tab: 'publish', publishIntent: 'supplier',
  });
  assert.deepEqual(providerNextNavigation('provider_listing_manager', 'listing-1'), {
    tab: 'publish', manageListingId: 'listing-1',
  });
});

test('offer audit messages land on the exact next provider task', () => {
  assert.equal(providerOfferMessageDestination('approved'), 'listing');
  assert.equal(providerOfferMessageActionLabel('approved'), '去上架');
  assert.equal(providerOfferMessageActionLabel(undefined), '查看方案');
  assert.equal(providerOfferMessageDestination('changes_requested'), 'revision');
  assert.equal(providerOfferMessageDestination('rejected'), 'revision');
  assert.equal(providerOfferMessageDestination('under_review'), 'review');
  assert.equal(providerOfferMessageActionLabel('under_review'), '查看方案');
});
