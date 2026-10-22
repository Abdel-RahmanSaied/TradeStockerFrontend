export type Lane = {id: string; state: string};
export type Quote = {symbol: string; market: string; price_minor: number; currency: string; as_of: string; source: string; mode: string};
export type Account = {id: string; currency: string; cash_minor: number; reserved_minor: number; mode: string};
export type Recommendation = {id: string; symbol: string; lane: string; account_id: string; status: string; quantity: number; entry_minor: number; stop_minor: number; currency: string; created_at: string; expires_at: string; reasons: string[]; mode: string; versions: Record<string,string>};
export type Position = {symbol: string; quantity: number; cost_minor: number; account_id: string; currency: string};
export type Audit = {id: string; at: string; action: string; entity_id: string; detail: unknown};
export type Notification = {id: string; at: string; status: string; text: string};
export type Dashboard = {mode: string; live_advisory_enabled: boolean; lanes: Lane[]; accounts: Account[]; quotes: Quote[]; recommendations: Recommendation[]; positions: Position[]; audit: Audit[]; notifications: Notification[]; entries_paused: boolean; build: string};
