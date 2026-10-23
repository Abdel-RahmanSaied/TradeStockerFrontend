# TradeStocker dashboard

Private local paper workspace in the owner-requested frontend repository.

## Development

Use `npm ci`, then `npm run dev`. Vite binds to `127.0.0.1:5173` and proxies `/api` to `127.0.0.1:8080`. Override the proxy with `API_PROXY_TARGET` when running a disposable test backend. Start the backend using its README instructions.

## Verification

`npm test` runs API-boundary, freshness and research display tests. `npm run build` checks TypeScript and builds the bundle. For browser tests, run the backend's `scripts/test-e2e.sh`: it starts a disposable API on 127.0.0.1:18080 and runs `npm run test:e2e` here.

- `tests/workspace.spec.ts` and `tests/research.spec.ts` use the real API.
- `tests/research-ui.spec.ts` replaces the API inside the browser with a controlled double, to pin timing races (a late response for an old selection) and display rules.
- SEC research makes real requests to data.sec.gov only with `TS_E2E_REAL_SEC=1` and the owner-approved `TS_SEC_USER_AGENT` in the backend `.env.local`. Without it, the test checks that research is refused.

API tokens are held only in memory, never browser storage or build-time environment variables. The dashboard never calls a brokerage. Fixture data is visibly synthetic and paper balances do not represent actual money. Production identity, provider entitlements and live advisory activation remain outside this increment.
