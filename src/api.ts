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
  let body: any;
  try { body = await response.json(); }
  catch {
    if (!response.ok) throw new ApiError(response.status, `Request failed (${response.status})`);
    throw new Error('The API response was incomplete or invalid JSON. The result is uncertain; retry preserves the same operation key.');
  }
  if (!response.ok) throw new ApiError(response.status, typeof body?.error === 'string' ? body.error : body?.error?.message ?? body?.message ?? `Request failed (${response.status})`);
  if (body === null || typeof body !== 'object') throw new Error('The API response shape is invalid. The result is uncertain; retry preserves the same operation key.');
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

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}
// Fetch original source bytes and refuse them unless they match the recorded hash.
export async function fetchVerified(path: string, expectedHash: string): Promise<ArrayBuffer> {
  const response = await fetch(`/api/v1${path}`, {headers: {Accept: 'application/json', Authorization: `Bearer ${sessionToken}`}, signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw new ApiError(response.status, `Source download failed (${response.status})`);
  const bytes = await response.arrayBuffer();
  if (await sha256Hex(bytes) !== expectedHash) throw new Error('Source hash verification failed. Download cancelled.');
  return bytes;
}
export async function downloadJSON(path: string, filename: string, expectedHash: string) {
  const bytes = await fetchVerified(path, expectedHash);
  const url = URL.createObjectURL(new Blob([bytes], {type: 'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
