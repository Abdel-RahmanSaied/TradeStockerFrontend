import {afterEach, describe, expect, it, vi} from 'vitest';
import {fetchVerified, setSessionToken, sha256Hex} from './api';
import {cellFor, exactUSD, explainCode, pollDelay, ratioText, type Period} from './researchModel';

afterEach(() => { vi.unstubAllGlobals(); setSessionToken(''); });

const period = (over: Partial<Period> = {}): Period => ({
  fiscal_period_end: '2025-09-27', start: '2024-09-29',
  filing: {accession: '0000000001-25-000020', form: '10-K', filed: '2025-10-31', report_date: '2025-09-27', report_date_basis: 'SEC_REPORT_DATE', accepted_at: '2025-10-31T14:01:26+00:00', available_at: '2025-10-31T14:01:26+00:00', availability_basis: 'SEC_ACCEPTANCE', filing_url: 'https://www.sec.gov/'},
  facts: [{metric: 'revenue', value: '416161000000', unit: 'USD', start: '2024-09-29', end: '2025-09-27', filed: '2025-10-31', available_at: '', availability_basis: '', accession: '', form: '10-K', tag: '', source_sha256: '', pointer: '', filing_url: ''}],
  derived: {}, checks: [], missing_metrics: ['assets'], withheld_metrics: [{metric: 'net_income', tag: 'NetIncomeLoss', reason: 'CONFLICTING_VALUES', values: ['1', '2']}], later_filing_differences: [], ...over,
});

describe('exact SEC amounts', () => {
  it('keeps every digit beyond floating-point precision', () => {
    expect(exactUSD('416161000000')).toBe('$416,161,000,000');
    expect(exactUSD('9007199254740993')).toBe('$9,007,199,254,740,993');
    expect(exactUSD('-50')).toBe('−$50');
    expect(exactUSD('0')).toBe('$0');
  });
  it('never renders malformed or absent values as numbers', () => {
    for (const bad of ['1.5', '1e9', '', 'abc', '12345678901234567890']) expect(exactUSD(bad)).toBe('Invalid value');
    expect(exactUSD(undefined)).toBe('—');
  });
});

describe('period cells', () => {
  it('distinguishes a reported value, a withheld conflict and a missing fact', () => {
    const p = period();
    expect(cellFor(p, 'revenue')).toEqual({text: '$416,161,000,000', tone: 'value'});
    expect(cellFor(p, 'net_income')).toEqual({text: 'Withheld', tone: 'withheld'});
    expect(cellFor(p, 'assets')).toEqual({text: 'Missing', tone: 'missing'});
    expect(cellFor(p, 'equity').text).not.toMatch(/\$0/);
  });
});

describe('derived ratios', () => {
  it('formats derived values and explains absent ones', () => {
    expect(ratioText('net_margin', {value: '0.269151', inputs: [], status: 'DERIVED'})).toBe('26.92%');
    expect(ratioText('cash_conversion', {value: '0.995286', inputs: [], status: 'DERIVED'})).toBe('0.995286×');
    expect(ratioText('net_margin', {value: null, inputs: [], status: 'MISSING_INPUT'})).toBe('Missing input');
    expect(ratioText('cash_conversion', {value: null, inputs: [], status: 'UNDEFINED_NONPOSITIVE_DENOMINATOR'})).toBe('Undefined');
    expect(ratioText('net_margin', {value: 'NaN', inputs: [], status: 'DERIVED'})).toBe('Invalid value');
  });
});

describe('polling and errors', () => {
  it('polls quickly only while a job is queued or running', () => {
    expect(pollDelay([{status: 'SUCCEEDED'}, {status: 'RUNNING'}])).toBe(2500);
    expect(pollDelay([{status: 'QUEUED'}])).toBe(2500);
    expect(pollDelay([{status: 'SUCCEEDED'}, {status: 'FAILED'}])).toBe(15000);
    expect(pollDelay([])).toBe(15000);
  });
  it('explains known codes and names unknown ones', () => {
    expect(explainCode('SEC_ACCESS_LIMITED')).toMatch(/pauses for 10 minutes/);
    expect(explainCode('NEW_CODE')).toBe('Research stopped with code NEW_CODE.');
    expect(explainCode(undefined)).toBe('');
  });
});

describe('source verification', () => {
  const bytes = new TextEncoder().encode('{"cik":320193}').buffer as ArrayBuffer;
  it('returns bytes only when the SHA-256 matches', async () => {
    const hash = await sha256Hex(bytes);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const fetch = vi.fn().mockResolvedValue(new Response(bytes));
    vi.stubGlobal('fetch', fetch); setSessionToken('local-token');
    expect(new Uint8Array(await fetchVerified('/research/jobs/x/sources/companyfacts', hash))).toEqual(new Uint8Array(bytes));
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer local-token');
  });
  it('refuses altered bytes and failed responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"cik":1}')));
    await expect(fetchVerified('/x', await sha256Hex(bytes))).rejects.toThrow('hash verification failed');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', {status: 404})));
    await expect(fetchVerified('/x', 'a'.repeat(64))).rejects.toThrow('Source download failed (404)');
  });
});
