export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'ApiError'; }
}
let sessionToken = '';
export function setSessionToken(value: string) { sessionToken = value.trim(); }
export function hasSessionToken() { return sessionToken.length > 0; }
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}), ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, typeof body?.error === 'string' ? body.error : body?.error?.message ?? body?.message ?? `Request failed (${response.status})`);
  return body as T;
}
// Keep an ambiguous operation's key in memory so retry cannot duplicate its effect.
const pendingMutations = new Map<string,string>();
export async function mutation<T>(path: string, body: unknown = {}, explicitKey?: string): Promise<T> {
  const json = JSON.stringify(body);
  const operation = path + '\n' + json;
  const key = explicitKey ?? pendingMutations.get(operation) ?? crypto.randomUUID();
  pendingMutations.set(operation, key);
  try {
    const result = await request<T>(path, { method: 'POST', headers: { 'Idempotency-Key': key }, body: json });
    pendingMutations.delete(operation);
    return result;
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) pendingMutations.delete(operation);
    throw error;
  }
}
export function displayError(error: unknown): string {
  if (error instanceof ApiError) return error.status === 401 ? 'Access denied. Check the local API token.' : error.message;
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'The API took too long to respond. Check the backend and retry.';
  return error instanceof Error ? error.message : 'Unable to reach the API. Start the backend and retry.';
}
export function money(value: number | undefined, currency = 'USD') {
  return value === undefined || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('en-US', {style: 'currency', currency, maximumFractionDigits: 2}).format(value);
}
export function timestamp(value: string | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not available';
  return new Intl.DateTimeFormat('en-GB', {dateStyle: 'medium', timeStyle: 'medium'}).format(new Date(value));
}
export function freshness(value: string | undefined, maxAgeSeconds = 300, now = Date.now()): 'missing' | 'future' | 'stale' | 'fresh' {
  if (!value || !Number.isFinite(Date.parse(value))) return 'missing';
  const age = (now - Date.parse(value)) / 1000;
  return age < -5 ? 'future' : age > maxAgeSeconds ? 'stale' : 'fresh';
}
