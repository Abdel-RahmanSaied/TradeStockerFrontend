import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, freshness, money, mutation, request, setSessionToken } from './api';
afterEach(() => { vi.unstubAllGlobals(); setSessionToken(''); });
describe('API boundary', () => {
  it('sends ephemeral token and idempotency key on paper mutation', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"ok":true}', {status: 200}));
    vi.stubGlobal('fetch', fetch); setSessionToken('local-token');
    await mutation('/paper/example', {quantity: 2}, 'same-operation');
    expect(fetch.mock.calls[0][1].headers).toMatchObject({Authorization: 'Bearer local-token', 'Idempotency-Key': 'same-operation'});
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/paper/example');
  });
  it('surfaces rejected risk input instead of treating it as success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"stale evidence"}', {status: 422})));
    await expect(request('/risk')).rejects.toEqual(new ApiError(422, 'stale evidence'));
  });
  it('reuses an operation key after a response is lost', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('connection lost')).mockResolvedValueOnce(new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetch);
    await expect(mutation('/paper/ambiguous', {quantity: 3})).rejects.toThrow('connection lost');
    await mutation('/paper/ambiguous', {quantity: 3});
    expect(fetch.mock.calls[0][1].headers['Idempotency-Key']).toBe(fetch.mock.calls[1][1].headers['Idempotency-Key']);
  });
  it.each(['{"id":', 'null', '"untrusted-success"'])('retains retry key for ambiguous HTTP 200 body %s', async (body) => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(body,{status:200})).mockResolvedValueOnce(new Response('{"id":"same-commit"}',{status:200}));
    vi.stubGlobal('fetch',fetch);
    const path='/paper/truncated-'+body;
    await expect(mutation(path,{quantity:1})).rejects.toThrow(/response|JSON/i);
    await mutation(path,{quantity:1});
    expect(fetch.mock.calls[0][1].headers['Idempotency-Key']).toBe(fetch.mock.calls[1][1].headers['Idempotency-Key']);
  });
  it('handles non-json gateway errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', {status: 503})));
    await expect(request('/status')).rejects.toThrow('Request failed (503)');
  });
});
describe('data provenance display', () => {
  const now = Date.parse('2026-10-23T10:00:00Z');
  it('distinguishes missing, invalid, future and stale timestamps', () => {
    expect(freshness(undefined, 300, now)).toBe('missing');
    expect(freshness('invalid', 300, now)).toBe('missing');
    expect(freshness('2026-10-23T10:01:00Z', 300, now)).toBe('future');
    expect(freshness('2026-10-23T09:00:00Z', 300, now)).toBe('stale');
    expect(freshness('2026-10-23T09:59:00Z', 300, now)).toBe('fresh');
  });
  it('never invents a balance for missing financial values', () => {
    expect(money(undefined)).toBe('—'); expect(money(NaN)).toBe('—'); expect(money(0)).toBe('$0.00');
  });
});
