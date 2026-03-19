import { stateStore } from '../sso/state-store';

describe('SSO state store', () => {
  beforeEach(() => stateStore.clear());

  test('stores and retrieves state', () => {
    stateStore.set('abc', { connectionId: 'conn-1', codeVerifier: 'verifier', createdAt: Date.now() });
    const entry = stateStore.get('abc');
    expect(entry).not.toBeNull();
    expect(entry!.connectionId).toBe('conn-1');
    expect(entry!.codeVerifier).toBe('verifier');
  });

  test('returns null for unknown state', () => {
    expect(stateStore.get('unknown')).toBeNull();
  });

  test('deletes entry after retrieval', () => {
    stateStore.set('xyz', { connectionId: 'c', codeVerifier: 'v', createdAt: Date.now() });
    stateStore.get('xyz');          // first get deletes it
    expect(stateStore.get('xyz')).toBeNull();
  });

  test('returns null for expired state (TTL)', () => {
    const old = Date.now() - 11 * 60 * 1000; // 11 minutes ago
    stateStore.set('expired', { connectionId: 'c', codeVerifier: 'v', createdAt: old });
    expect(stateStore.get('expired')).toBeNull();
  });
});
