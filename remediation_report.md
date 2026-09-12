# OTC Elite Signal Engine — Protocol Remediation Report

Date: 2026-09-12
Previous main release: 4038efb — scientific remediation 1.1.0
Sandbox release: 1.2.0

## Evidence received

A Chrome DevTools Protocol capture contained 24 Pocket Option WebSocket observations, 3046 received frames and 162 sent frames across DEMO and REAL sessions. Authentication text frames were redacted by the capture script. The raw capture must remain private because binary attachments can contain account state.

The DEMO market protocol was isolated and sanitized before analysis.

## Confirmed root causes of the zero dashboard

1. Production price data uses Socket.IO binary events (`451-` + binary attachment), while release 1.1.0 parsed only textual `42[...]` price packets.
2. Raw-frame sequence numbers were incremented before semantic parsing, so ignored frames created permanent gaps in the ISOLATED sequencer.
3. The Pocket Option source clock in the capture was approximately two hours ahead of the browser clock; release 1.1.0 treated offsets greater than 60 seconds as suspect and discarded those ticks.
4. Payout arrives through the independent `chafor` event rather than inside `updateStream`.
5. The same WebSocket also carries non-OTC instruments, which must not be mislabeled as OTC.

## Corrections implemented

- Added stateful Socket.IO binary-event decoding for one-attachment `451-` frames.
- Serialized inbound Blob/ArrayBuffer processing per WebSocket to preserve wire order.
- Added strict `updateStream` parser for `[[asset, sourceTimestampSeconds, price]]`.
- Added strict `chafor` parser for `[[asset, payoutPercent]]`.
- Consumed `updateHistoryNewFast` without generating retrospective live decisions.
- Moved semantic sequence assignment after successful semantic parsing.
- Restricted the OTC pipeline to assets ending `_otc`.
- Added feed host to source identity.
- Scoped `VERIFIED` to the exact observed `demo-api-eu.po.market` schemas; matching REAL endpoints remain `INFERRED`.
- Added Tick schema v3 with per-tick source quality and explicit `sourceClockSynchronized`.
- Switched event time to `LOCAL_RECEIPT` while preserving source timestamp and observed offset.
- Removed the false `SUSPECT` classification caused solely by an unsynchronized stable source-clock offset.
- Separated payout from price processing.
- Set captured payout `expirationSeconds` to null because `chafor` does not provide expiry scope.
- Keyed payout state by asset + feed.
- Updated replay to interleave payout and tick events chronologically.
- Bumped IndexedDB to version 3 to prevent legacy schema mixing.
- Fixed PageBridge mode initialization ordering.

## Validation

- TypeScript strict typecheck: PASS
- Unit/invariant tests: 16/16 PASS
- Raw captured DEMO decoder replay: 234 price events, 24 payout events
- Quantitative captured DEMO integration: 234 ticks, 64 candles, 54 decisions, 4 signals, 2 results within the capture window
- Captured tick integrity: VALID
- Captured timestamp basis: LOCAL_RECEIPT
- Captured source quality: VERIFIED
- REAL endpoint parser quality regression: INFERRED

## Safety boundary

No order event from the raw capture is consumed by the signal engine. Balance, authentication, opened-deal, closed-deal and order events are ignored by production semantics.

No auto-trading, auto-click, CALL/PUT click, broker order submission or realized-P&L path exists.

Do not commit the original raw WebSocket capture. Only sanitized DEMO market fixtures may be used for regression documentation or tests.
