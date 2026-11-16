# Railway Binance access: safe reporting and verification

## Findings

- The mobile hook already imports React correctly. The quoted “Carry out what is required in the file.” text is absent, and the latest preview build is successful; the reported TypeScript error was not reproduced.
- The first worker market request is `GET https://fapi.binance.com/fapi/v1/exchangeInfo`. History uses `/fapi/v1/klines?symbol=…&interval=1m&limit=1500`, with optional start/end timestamps. REST connectivity checks use `/fapi/v1/time`; live candles use `wss://fstream.binance.com/stream?streams=<symbol>@kline_1m/…`. These are Binance USD-M Futures feeds, not Spot or testnet.
- HTTP 451 indicates an access/legal restriction. The supplied Railway log is consistent with Binance rejecting the deployment's source location/IP, but the exact response body, chosen region and deployed revision are not available here. Incorrect IP classification cannot be distinguished from an intended restriction without those details and Binance confirmation.
- The client currently discards Binance's explanation and throws a generic 451 message. On startup, the failed exchange-information request occurs **before the first dashboard heartbeat**. The worker then exits; repeated deployments/restarts could explain repeated messages, but Railway's restart settings have not been inspected.
- A separate compatibility detail: Railway does not trigger the existing Render-specific automatic host detection. The current code works with `ENGINE_HOST_KIND=hosted`; that explicitly enables the `PORT` health listener. The Render self-request timer does not run without `RENDER_EXTERNAL_URL`; it is not a remedy for 451.
- Actual public requests from this sandbox to exchange information, server time and three NEARUSDT one-minute candles returned HTTP 200. An isolated simulated 451 test confirmed no retry, no dashboard heartbeat and no live writes. Thirteen existing regression tests passed.
- Preview and published dashboards both show OFFLINE / STOPPED, the old temporary heartbeat from 2026-11-15, four retained SHORT positions and no recorded Binance error. This does not disprove that Railway starts; it means Railway's liveness/restriction is not reaching the dashboard.

## Regional access and data alternatives

Railway confirms its four regions in its [region documentation](https://docs.railway.com/reference/regions). There is **no verified Binance permission for this specific use from any of the four**:

| Railway location | Evidence and limitation |
| --- | --- |
| Virginia / California | U.S. public Binance API restrictions have been reported. Do not treat either as a permitted replacement location. |
| Singapore | A [Railway-hosted report](https://station.railway.com/questions/binance-api-returns-http-451-from-singap-7079b988) describes the same Futures 451 and attributes it to Binance's source-location eligibility check. That reply is labelled BOT, not written Binance approval. |
| Amsterdam | No current official allowance for these public Futures endpoints was verified. Dutch customer-service restrictions are not themselves proof of the API policy. |

Binance's current terms and developer pages returned empty HTTP 202 responses to this research environment. Existing customer restrictions and HTTP 200 tests do not establish permission. Do not move regions merely to get around the rejection. Ask Binance to confirm public-data eligibility for the user's residence, actual hosting country and outbound IP, including possible IP-geolocation error.

- **Official historical option:** [Binance Public Data](https://github.com/binance/binance-public-data) publishes USD-M Futures candles from `/fapi/v1/klines`. Daily files appear the next day, so they cannot provide live one-minute breakeven alerts. No archive integration is proposed.
- **Live data candidate, not an approved replacement:** [CoinAPI](https://www.coinapi.io/derivatives-exchanges) documents Binance USD-M Futures (`BINANCEFTS`) OHLCV and offers real-time/historical interfaces. Its [use policy](https://www.coinapi.io/blog/coinapi-data-commercial-use-policy) permits internal analytics and derived signals on paid plans. Specific regional licensing, symbol coverage, original Binance-candle equivalence and cost would still need confirmation. This is not verified Binance-authorized unrestricted access and does not meet the standing $0 budget; do not activate it.
- Binance.US, Binance Spot, testnet and another exchange's candles are not equivalent substitutes. No verified permanently free, permitted live replacement providing identical required candles was found.

## Proposed changes — only after approval

1. Keep the cloud service's health and dashboard heartbeat working before market-data startup. This allows **CLOUD ONLINE** to coexist with **BINANCE ACCESS RESTRICTED** and **SCANNER ERROR**.
2. Recognize HTTP 451 explicitly, record a short safe explanation, endpoint path, HTTP status and time, then pause all candle processing and market reconnection attempts. Keep health reporting active; do not repeatedly retry the restriction or report connected feeds. Restart market startup only after the user resolves access lawfully and restarts the service.
3. Distinguish restriction, IP ban, rate limit, network interruption and other provider failures. Preserve rate-limit/backoff handling for transient failures without routing around bans or legal restrictions.
4. Show separate cloud, scanner and Binance-data statuses on the dashboard and System Health page. Retain strict fresh-heartbeat and durable-candle requirements for RUNNING. Keep old candle/price timestamps visibly historical while paused. Replace misleading Render-only labels and setup guidance with Railway-compatible wording.
5. Preserve every calculation, signal condition, original Pine file, symbol, checkpoint, history row, Telegram setting and shared-key security boundary. No new trades or notifications while data access is restricted. No paid resources, new market-data provider or automatic hosting change.

## Technical details

- Keep `ENGINE_APP_URL`, `ENGINE_SHARED_SECRET` and `ENGINE_HOST_KIND=hosted` compatible; retain `PORT`, public content-free `/healthz` and authenticated detailed health. Do not change or disclose secret values.
- Introduce typed Binance request errors containing only public request details and a bounded sanitized provider explanation. Set REST/WebSocket connectivity false on restriction, including restrictions during warmup/recovery, not only initial startup.
- Use existing heartbeat `status=ERROR` with a stable `BINANCE_ACCESS_RESTRICTED` error classification to preserve database/protocol compatibility; derive the distinct Binance label from that classification. Do not require a destructive migration or broaden public access.
- Begin owned-lease heartbeat reporting before Binance startup. Keep paused liveness reporting separate from scanner initialization. Continue single-writer protection, stop on lease loss and release only the owning instance during shutdown.
- Add focused regression tests for startup 451, later 451, no market retries/writes, disconnected feeds, fresh restricted cloud health, expired heartbeats, transient failures and healthy recovery. Keep fixtures and transaction checks isolated from production and real Telegram.

## User steps and acceptance checks

1. Open the Railway scanner service, then Settings; report the selected region. Do not change it yet.
2. If Railway provides a terminal for the **running container**, run this read-only check. It uses Bun already present in the Docker image; no keys are required:

```bash
bun -e 'const r=await fetch("https://fapi.binance.com/fapi/v1/exchangeInfo",{signal:AbortSignal.timeout(15000)}); console.log("HTTP",r.status); console.log(r.ok ? "Exchange information received" : (await r.text()).slice(0,1000));'
```

If the container cannot stay up or a terminal is unavailable, share the relevant Railway log lines instead. Do not paste variables, keys or other credentials. A command on a local computer is not a test of Railway's outbound access.

3. Send the selected region and public Binance response. For a 451, request Binance confirmation rather than assume a different region is legal or will work.
4. After approving the reporting changes, publish the website and deploy the corresponding worker revision with matching existing settings; no account or subscription is created by this approval.
5. Verify a fresh restricted heartbeat reads back as CLOUD ONLINE / SCANNER ERROR / BINANCE ACCESS RESTRICTED, with no new candle commits, signals or Telegram messages.
6. Only after lawful access is confirmed: test Binance metadata, one-minute history, actual WebSocket closed candles, durable dashboard advancement and reconnect/restart recovery on Railway. Genuine signal-to-Telegram delivery and unattended uptime remain separate checks.

**Boundary:** Approval authorizes truthful reporting improvements, not a claim that Binance access is restored, paid services, regional circumvention or a replacement data feed. Railway's actual 451 response and legal access decision remain external prerequisites.