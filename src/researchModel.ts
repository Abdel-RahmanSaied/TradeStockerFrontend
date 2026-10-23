// Types and pure helpers for SEC research (contract: backend contracts/research-api.md).
export type Fact = {metric: string; value: string; unit: string; start: string | null; end: string; filed: string; available_at: string; availability_basis: string; accession: string; form: string; tag: string; source_sha256: string; pointer: string; filing_url: string};
export type Derived = {value: string | null; inputs: string[]; status: string};
export type Filing = {accession: string; form: string; filed: string; report_date: string; report_date_basis: string; accepted_at: string | null; available_at: string | null; availability_basis: string; filing_url: string};
export type Withheld = {metric: string; tag: string; reason: string; values: string[]};
export type LaterDifference = {metric: string; tag: string; original_value: string; later_value: string; later_accession: string; later_form: string; later_filed: string};
export type Period = {fiscal_period_end: string; start: string | null; filing: Filing; facts: Fact[]; derived: Record<string, Derived>; checks: {name: string; status: string; difference_usd?: string}[]; missing_metrics: string[]; withheld_metrics: Withheld[]; later_filing_differences: LaterDifference[]};
export type Report = {version: string; issuer: string; symbol: string; cik: string; source: string; data_kind: string; status: string; outcome: string; eligible_for_entry: boolean; eligible_for_backtest: boolean; as_of: string; accounting_framework: string; scope: string; currency: string; periods: Period[]; warnings: string[]; excluded_facts: Record<string, number>; countercase: string[]};
export type Job = {id: string; symbol: string; cik: string; status: string; attempts: number; max_attempts: number; created_at: string; updated_at: string; next_attempt_at?: string; error_code?: string; last_error?: string; result?: Report};
export type Source = {attempt: number; kind: string; sha256: string; url: string; received_at: string; size_bytes: number};
export type ResearchEvent = {at: string; action: string; detail: Record<string, unknown>};
export type Detail = {job: Job; sources: Source[]; events: ResearchEvent[]};
export type Status = {configured: boolean; parser_version: string; max_attempts: number; provider_cooldown_until: string | null};

export const SERIES = ['revenue', 'net_income', 'operating_cash_flow', 'assets', 'liabilities', 'equity'] as const;
export const label = (code: string) => code.replaceAll('_', ' ').toLowerCase();
export const isActive = (status: string) => status === 'QUEUED' || status === 'RUNNING';

// SEC values are exact whole dollars in strings; BigInt keeps every digit.
export function exactUSD(value: string | undefined): string {
  if (value === undefined) return '—';
  if (!/^-?\d{1,19}$/.test(value)) return 'Invalid value';
  const n = BigInt(value);
  return (n < 0n ? '−$' : '$') + (n < 0n ? -n : n).toLocaleString('en-US');
}

export function ratioText(name: string, d: Derived): string {
  if (d.value === null) return d.status === 'MISSING_INPUT' ? 'Missing input' : 'Undefined';
  if (!/^-?\d+\.\d+$/.test(d.value)) return 'Invalid value';
  if (name === 'cash_conversion') return `${d.value}×`;
  return `${(Number(d.value) * 100).toFixed(2)}%`;
}

// What a period shows for a metric: the fact, or why it is absent. Never zero.
export function cellFor(p: Period, metric: string): {text: string; tone: 'value' | 'withheld' | 'missing'} {
  const fact = p.facts.find(f => f.metric === metric);
  if (fact) return {text: exactUSD(fact.value), tone: 'value'};
  if (p.withheld_metrics.some(w => w.metric === metric)) return {text: 'Withheld', tone: 'withheld'};
  return {text: 'Missing', tone: 'missing'};
}

// Poll quickly while work is in progress, slowly otherwise.
export function pollDelay(jobs: Pick<Job, 'status'>[]): number {
  return jobs.some(j => isActive(j.status)) ? 2500 : 15000;
}

const explanations: Record<string, string> = {
  SEC_CONTACT_NOT_CONFIGURED: 'The SEC contact is not configured. Set TS_SEC_USER_AGENT in the backend configuration and restart.',
  INVALID_ISSUER: 'The ticker or CIK is not in the accepted format.',
  SEC_NOT_FOUND: 'SEC has no record for this CIK.',
  SEC_SYMBOL_CIK_MISMATCH: 'SEC does not list this ticker for this CIK. Check both identifiers.',
  SEC_IDENTITY_MISMATCH: 'SEC returned data for a different issuer than requested.',
  SEC_UNEXPECTED_SHAPE: 'SEC returned data in an unexpected structure.',
  SEC_INVALID_JSON: 'SEC returned a response that is not valid JSON.',
  SEC_RESPONSE_TOO_LARGE: 'The SEC response was larger than the 16 MiB limit.',
  SEC_REDIRECT_REFUSED: 'SEC redirected the request; redirects are refused for safety.',
  SEC_ACCESS_LIMITED: 'SEC limited access. All research pauses for 10 minutes before contacting SEC again.',
  SEC_HTTP_ERROR: 'SEC returned a server error.',
  SEC_REQUEST_FAILED: 'The SEC request failed on the network.',
  SEC_REQUEST_TIMEOUT: 'The SEC request took too long.',
  SEC_BODY_FAILED: 'The SEC response was interrupted.',
  RESEARCH_PROVIDER_FAILED: 'The SEC provider failed unexpectedly.',
  RESEARCH_ANALYSIS_FAILED: 'The parser rejected the filing data. The original sources are kept for inspection.',
  WORKER_ATTEMPTS_EXHAUSTED: 'Every allowed attempt was used. Run a new request to try again.',
  WORKER_STOPPED: 'The backend stopped during the attempt. The job continues when the backend runs again.',
};

export function explainCode(code: string | undefined): string {
  if (!code) return '';
  return explanations[code] ?? `Research stopped with code ${code}.`;
}
