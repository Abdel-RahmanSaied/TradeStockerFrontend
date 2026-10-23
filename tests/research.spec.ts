// Research against the real local API (started by backend scripts/test-e2e.sh).
// By default the API has no SEC contact, so nothing contacts SEC. With
// TS_E2E_REAL_SEC=1 the API uses the approved contact and calls data.sec.gov.
import {test, expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const token = process.env.TS_LOCAL_DEV_TOKEN;
const realSEC = process.env.TS_E2E_REAL_SEC === '1';

test.beforeEach(async ({page}) => {
  if (!token) throw new Error('TS_LOCAL_DEV_TOKEN required. Use backend scripts/test-e2e.sh.');
  await page.goto('/');
  await page.getByRole('button', {name: 'Configure API access', exact: true}).click();
  await page.getByLabel('Local API token').fill(token);
  await page.getByRole('button', {name: 'Connect', exact: true}).click();
  await expect(page.getByText('LIVE ADVISORY DISABLED', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Research', exact: true}).click();
});

test('research is refused without an approved SEC contact', async ({page}) => {
  test.skip(realSEC, 'This run has an SEC contact configured.');
  await expect(page.getByText(/SEC contact is not configured/)).toBeVisible();
  await expect(page.getByRole('button', {name: 'Run SEC research'})).toBeDisabled();
  const refused = await page.request.post('/api/v1/research/jobs', {headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'e2e-unconfigured-1'}, data: {symbol: 'AAPL', cik: '0000320193'}});
  expect(refused.status()).toBe(503);
  expect((await refused.json()).error.code).toBe('SEC_CONTACT_NOT_CONFIGURED');
  expect((await page.request.get('/api/v1/research/status')).status()).toBe(401);
});

test('real SEC annual research for Apple with verified original sources', async ({page}) => {
  test.skip(!realSEC, 'Set TS_E2E_REAL_SEC=1 (with the approved TS_SEC_USER_AGENT) to contact data.sec.gov.');
  test.setTimeout(240_000);
  await page.getByLabel('US ticker').fill('AAPL');
  await page.getByLabel('SEC CIK').fill('0000320193');
  await page.getByRole('button', {name: 'Run SEC research'}).click();
  await expect(page.getByRole('heading', {name: 'Apple Inc. · AAPL'})).toBeVisible({timeout: 150_000});
  await expect(page.getByText('Entry outcome: INSUFFICIENT_DATA')).toBeVisible();
  await expect(page.getByText(/Entry eligible: No · Historical backtest eligible: No/)).toBeVisible();
  const rows = page.getByRole('table').first().getByRole('row');
  await expect(rows).toHaveCount(6); // header + five annual reports
  for (let i = 1; i < 6; i++) await expect(rows.nth(i)).toContainText('10-K');
  await expect(page.getByRole('table').first().getByRole('cell', {name: 'Missing'})).toHaveCount(0);

  const facts = page.locator('.fact-evidence').filter({hasText: 'companyfacts · attempt 1'});
  const shown = (await facts.locator('.mono').textContent())?.trim();
  expect(shown).toMatch(/^[0-9a-f]{64}$/);
  const pending = page.waitForEvent('download');
  await facts.getByRole('button', {name: 'Download original companyfacts'}).click();
  const file = await (await pending).path();
  expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(shown);

  // A ticker that SEC does not list for the CIK fails visibly, with no substitute data.
  await page.getByLabel('SEC CIK').fill('0000789019');
  await page.getByRole('button', {name: 'Run SEC research'}).click();
  await expect(page.getByRole('heading', {name: 'AAPL · research job'})).toBeVisible();
  await expect(page.getByRole('alert').filter({hasText: 'Research failed: SEC_SYMBOL_CIK_MISMATCH'})).toBeVisible({timeout: 150_000});
  await expect(page.getByText('No fallback data was substituted.', {exact: false})).toBeVisible();
});
