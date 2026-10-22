# TradeStocker dashboard

Private local paper workspace in the owner-requested frontend repository.

## Development

Use `npm ci`, then `npm run dev`. Vite binds to `127.0.0.1:5173` and proxies `/api` to `127.0.0.1:8080`. Override the proxy with `API_PROXY_TARGET` when running a disposable test backend. Start the backend using its README instructions.

## Verification

`npm test` runs API-boundary and freshness tests. `npm run build` checks TypeScript and builds the bundle. `npm run test:e2e` runs Playwright against the real local backend (setup details are recorded after integration verification).

API tokens are held only in memory, never browser storage or build-time environment variables. The dashboard never calls a brokerage. Fixture data is visibly synthetic and paper balances do not represent actual money. Production identity, provider entitlements and live advisory activation remain outside this increment.
