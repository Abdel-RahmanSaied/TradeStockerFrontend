// Research UI behavior against a controlled, in-browser API double. These tests pin
// timing races and display rules; real-API coverage is in research.spec.ts.
import {test, expect, type Page, type Route} from '@playwright/test';
import {createHash} from 'node:crypto';

type Job = {id: string; symbol: string; cik: string; status: string; attempts: number; max_attempts: number; created_at: string; updated_at: string; error_code?: string; last_error?: string; next_attempt_at?: string; result?: unknown};

const dashboard = {mode: 'PAPER', live_advisory_enabled: false, lanes: [], accounts: [], quotes: [], recommendations: [], positions: [], audit: [], notifications: [], entries_paused: false, build: 'test'};
const job = (id: string, symbol: string, status = 'SUCCEEDED', extra: Partial<Job> = {}): Job => ({id, symbol, cik: '0000000001', status, attempts: 1, max_attempts: 3, created_at: '2026-10-23T06:00:00Z', updated_at: '2026-10-23T06:00:10Z', ...extra});
const report = (issuer: string, symbol: string, over: Record<string, unknown> = {}) => ({
  version: 'sec-annual-v2', issuer, symbol, cik: '0000000001', source: 'SEC_PUBLIC', data_kind: 'OFFICIAL_FILINGS', status: 'PARTIAL', outcome: 'INSUFFICIENT_DATA',
  eligible_for_entry: false, eligible_for_backtest: false, as_of: '2026-10-23T06:00:00Z', accounting_framework: 'US_GAAP', scope: 'Synthetic test scope', currency: 'USD',
  periods: [], warnings: ['ANNUAL_STRUCTURED_FACTS_ONLY'], excluded_facts: {}, countercase: ['Synthetic countercase.'], ...over,
});
const sourceBytes = '{"cik":1,"synthetic":true}';
const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');

class FakeAPI {
  jobs: Job[] = [];
  details: Record<string, unknown> = {};
  slow = new Set<string>();
  failList = 0;
  cooldown: string | null = null;
  create: (body: unknown) => {status: number; body: unknown} = () => ({status: 500, body: {}});
  served = '';
  constructor(page: Page) {
    void page.route('**/api/v1/**', route => this.handle(route));
  }
  async handle(route: Route) {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    const json = (status: number, body: unknown) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body)});
    if (path === '/dashboard') return json(200, dashboard);
    if (path === '/research/status') return json(200, {configured: true, parser_version: 'sec-annual-v2', max_attempts: 3, provider_cooldown_until: this.cooldown});
    if (path === '/research/jobs' && route.request().method() === 'POST') { const r = this.create(route.request().postDataJSON()); return json(r.status, r.body); }
    if (path === '/research/jobs') {
      if (this.failList > 0) { this.failList--; return json(503, {error: {code: 'RESEARCH_STORAGE_UNAVAILABLE', message: 'Research storage failed; no success is assumed'}}); }
      return json(200, {jobs: this.jobs.map(({result: _, ...j}) => j)});
    }
    const source = path.match(/^\/research\/jobs\/([^/]+)\/sources\/(\w+)$/);
    if (source) return route.fulfill({status: 200, contentType: 'application/json', body: this.served || sourceBytes});
    const detail = path.match(/^\/research\/jobs\/([^/]+)$/);
    if (detail) {
      const id = decodeURIComponent(detail[1]);
      if (this.slow.has(id)) await new Promise(r => setTimeout(r, 1500));
      return json(200, this.details[id]);
    }
    return json(404, {error: {code: 'NOT_FOUND', message: 'not mocked'}});
  }
  add(j: Job, rep?: unknown, sources: unknown[] = []) {
    this.jobs.unshift(j);
    this.details[j.id] = {job: {...j, result: rep}, sources, events: [{at: j.created_at, action: 'REQUESTED', detail: {}}]};
  }
}

// Records every panel heading the page ever shows. Retrying assertions alone would
// wait past a briefly wrong heading, which is exactly how this race looks.
async function recordHeadings(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = ((window as unknown as {seenHeadings: string[]}).seenHeadings = []);
    const scan = () => document.querySelectorAll('h2').forEach(h => { if (h.textContent && !seen.includes(h.textContent)) seen.push(h.textContent); });
    new MutationObserver(scan).observe(document.body, {subtree: true, childList: true, characterData: true});
  });
}
const seenHeadings = (page: Page) => page.evaluate(() => (window as unknown as {seenHeadings: string[]}).seenHeadings);

async function openResearch(page: Page) {
  await page.goto('/');
  await page.getByRole('button', {name: 'Configure API access', exact: true}).click();
  await page.getByLabel('Local API token').fill('test-token-for-mocked-api');
  await page.getByRole('button', {name: 'Connect', exact: true}).click();
  await page.getByRole('button', {name: 'Research', exact: true}).click();
}

test('a slow response for an earlier selection never replaces the current job', async ({page}) => {
  const api = new FakeAPI(page);
  api.add(job('research_a', 'AAPL'), report('Alpha Test Corp', 'AAPL'));
  api.add(job('research_b', 'MSFT'), report('Beta Test Corp', 'MSFT'));
  await openResearch(page);
  api.slow.add('research_a');
  await recordHeadings(page);
  await page.getByRole('button', {name: /^AAPL/}).click();
  await page.getByRole('button', {name: /^MSFT/}).click();
  await expect(page.getByRole('heading', {name: 'Beta Test Corp · MSFT'})).toBeVisible();
  await page.waitForTimeout(2200); // The slow Alpha response has arrived by now.
  expect(await seenHeadings(page)).not.toContain('Alpha Test Corp · AAPL');
  await expect(page.getByRole('heading', {name: 'Beta Test Corp · MSFT'})).toBeVisible();
  await expect(page.getByRole('button', {name: /^MSFT/})).toHaveAttribute('aria-pressed', 'true');
});

test('a new job stays selected even when the previous selection answers late', async ({page}) => {
  const api = new FakeAPI(page);
  api.add(job('research_a', 'AAPL'), report('Alpha Test Corp', 'AAPL'));
  api.create = () => { const c = job('research_c', 'NEWCO', 'QUEUED', {attempts: 0}); api.add(c); return {status: 202, body: c}; };
  await openResearch(page);
  api.slow.add('research_a');
  await recordHeadings(page);
  await page.getByRole('button', {name: /^AAPL/}).click();
  await page.getByLabel('US ticker').fill('NEWCO');
  await page.getByRole('button', {name: 'Run SEC research'}).click();
  await expect(page.getByRole('heading', {name: 'NEWCO · research job'})).toBeVisible();
  await page.waitForTimeout(2200); // The slow Alpha response has arrived by now.
  expect(await seenHeadings(page)).not.toContain('Alpha Test Corp · AAPL');
  await expect(page.getByRole('heading', {name: 'NEWCO · research job'})).toBeVisible();
});

test('action errors survive successful polls; polling errors clear on recovery', async ({page}) => {
  const api = new FakeAPI(page);
  api.add(job('research_r', 'RUNCO', 'RUNNING')); // keeps fast polling active
  api.create = () => ({status: 429, body: {error: {code: 'RESEARCH_QUEUE_LIMIT', message: 'Too many research jobs are waiting; retry after they finish'}}});
  await openResearch(page);
  await page.getByRole('button', {name: 'Run SEC research'}).click();
  const action = page.getByRole('alert').filter({hasText: 'Too many research jobs are waiting'});
  await expect(action).toBeVisible();
  api.failList = 1;
  await expect(page.getByText(/Live updates are failing/)).toBeVisible({timeout: 6000});
  await expect(page.getByText(/Live updates are failing/)).toHaveCount(0, {timeout: 6000});
  await expect(action).toBeVisible();
});

test('reports show withheld, missing and restated values without inventing numbers', async ({page}) => {
  const api = new FakeAPI(page);
  api.cooldown = new Date(Date.now() + 9 * 60_000).toISOString();
  const p = {
    fiscal_period_end: '2025-09-27', start: '2024-09-29',
    filing: {accession: '0000000001-25-000020', form: '10-K', filed: '2025-10-31', report_date: '2025-09-27', report_date_basis: 'SEC_REPORT_DATE', accepted_at: null, available_at: '2025-11-01T00:00:00+00:00', availability_basis: 'FILING_DATE_PLUS_ONE_DAY_ESTIMATE', filing_url: 'https://www.sec.gov/Archives/edgar/data/1/000000000125000020/0000000001-25-000020-index.html'},
    facts: [{metric: 'revenue', value: '9007199254740993', unit: 'USD', start: '2024-09-29', end: '2025-09-27', filed: '2025-10-31', available_at: '2025-11-01T00:00:00+00:00', availability_basis: 'FILING_DATE_PLUS_ONE_DAY_ESTIMATE', accession: '0000000001-25-000020', form: '10-K', tag: 'Revenues', source_sha256: sourceHash, pointer: '/facts/us-gaap/Revenues/units/USD/0', filing_url: 'https://www.sec.gov/'}],
    derived: {net_margin: {value: null, inputs: ['net_income', 'revenue'], status: 'MISSING_INPUT'}},
    checks: [{name: 'BALANCE_TOTALS', status: 'MISSING_CONTEXT'}], missing_metrics: ['assets', 'equity', 'liabilities', 'liabilities_and_equity', 'operating_cash_flow'],
    withheld_metrics: [{metric: 'net_income', tag: 'NetIncomeLoss', reason: 'CONFLICTING_VALUES', values: ['100', '1000']}],
    later_filing_differences: [{metric: 'revenue', tag: 'Revenues', original_value: '9007199254740993', later_value: '9007199254740999', later_accession: '0000000001-26-000001', later_form: '10-K/A', later_filed: '2026-01-15'}],
  };
  api.add(job('research_w', 'WITH'), report('Withheld Test Corp', 'WITH', {periods: [p], warnings: ['CONFLICTING_FACT_VALUES_WITHHELD', 'FILING_TIME_ESTIMATED']}),
    [{attempt: 1, kind: 'companyfacts', sha256: sourceHash, url: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json', received_at: '2026-10-23T06:00:05Z', size_bytes: sourceBytes.length}]);
  await openResearch(page);
  await expect(page.getByText(/SEC limited access\. Research is paused until/)).toBeVisible();
  await page.getByRole('button', {name: /^WITH/}).click();
  const series = page.getByRole('table');
  await expect(series.getByRole('cell', {name: '$9,007,199,254,740,993'})).toBeVisible();
  await expect(series.getByRole('cell', {name: 'Withheld'})).toBeVisible();
  await expect(series.getByRole('cell', {name: 'Missing'}).first()).toBeVisible();
  await expect(series.getByRole('cell', {name: '$0'})).toHaveCount(0);
  await expect(page.getByText('Later filings report different values')).toBeVisible();
  await expect(page.getByText(/acceptance time not indexed; availability estimated/)).toBeVisible();
  await expect(page.getByText('Entry eligible: No · Historical backtest eligible: No', {exact: false})).toBeVisible();
  await expect(page.getByText('Missing input', {exact: true})).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Download original companyfacts'}).click();
  expect((await download).suggestedFilename()).toBe(`WITH-companyfacts-${sourceHash.slice(0, 12)}.json`);
  api.served = '{"cik":1,"synthetic":false}';
  await page.getByRole('button', {name: 'Download original companyfacts'}).click();
  await expect(page.getByRole('alert').filter({hasText: 'Source hash verification failed'})).toBeVisible();
});
