# PingMaster Redis Schema v1

This schema is designed for:
- Fast dashboard reads
- Duplicate URL deduplication per user
- Efficient ping history storage
- Endpoint grouping under a root monitor
- Cache-friendly summaries

## 1) Canonical URL Rules

All monitor URLs must be canonicalized before write/read:
- Lowercase protocol + hostname
- Remove trailing slash from path except root
- Keep path (because `https://site.com` and `https://site.com/api` are different endpoints)
- Drop hash
- Drop query for monitor identity

Example:
- `https://EXAMPLE.com/` -> `https://example.com`
- `https://example.com/api/` -> `https://example.com/api`

## 2) Core Keys

### User monitor index
- `user:{userId}:monitors` (LIST)
  - values: monitor IDs
  - usage: dashboard monitor list

### Global monitor index (for scheduler)
- `monitor:index:all` (SET)
  - values: monitor IDs
  - usage: scheduler/pinger iteration without keyspace scan
  - note: maintained on monitor create/delete and child create/delete

### URL dedupe index (critical)
- `user:{userId}:monitor_url:{canonicalUrl}` (STRING)
  - value: monitor ID
  - usage: prevent duplicate monitor creation

### Monitor object
- `monitor:{monitorId}` (JSON object)
- fields:
  - `id`
  - `userId`
  - `name`
  - `url` (canonical)
  - `rootMonitorId` (nullable; if endpoint monitor belongs to a root monitor)
  - `status` (`PENDING|UP|UP_RESTRICTED|DOWN`)
  - `lastChecked`
  - `lastLatency`
  - `lastStatusCode`
  - `lastErrorType`
  - `checkIntervalSec` (default 300)
  - `timeoutMs` (default 8000)
  - `retries` (default 3)
  - `createdAt`
  - `updatedAt`

### Root monitor to endpoint monitors
- `monitor:{rootMonitorId}:endpoints` (SET)
  - values: child monitor IDs
  - usage: expand root card quickly

### Child monitor reverse mapping
- `monitor:{childMonitorId}:root` (STRING)
  - value: root monitor ID

## 3) Ping History Model (optimized)

### Detailed recent history (7 days)
- `history:{monitorId}` (LIST, newest first)
- entry object:
  - `ts`
  - `status`
  - `statusCode`
  - `latency`
  - `errorType`
- trim policy: keep latest 2016 entries (5m interval x 7 days)

### Daily aggregate history (long-term)
- `history_daily:{monitorId}:{yyyy-mm-dd}` (HASH)
- fields:
  - `checks`
  - `up`
  - `down`
  - `restricted`
  - `latencySum`
  - `latencyMin`
  - `latencyMax`
  - `incidentsOpened`
- TTL suggestion: 365d or no TTL (depending on reporting needs)

### Last known state cache
- `state:{monitorId}` (HASH)
- fields:
  - `status`
  - `latency`
  - `statusCode`
  - `errorType`
  - `ts`
- usage: fast status read without loading full monitor object

## 4) Incidents (for duplicate log control)

Use incidents to avoid alert/log spam on repeated failures.

### Open incident index
- `monitor:{monitorId}:incident:open` (STRING)
  - value: incident ID

### Incident object
- `incident:{incidentId}` (JSON object)
- fields:
  - `id`
  - `monitorId`
  - `userId`
  - `startedAt`
  - `resolvedAt` (nullable)
  - `failureCount`
  - `rootCause`

### Incident timeline
- `monitor:{monitorId}:incidents` (ZSET)
  - member: incident ID
  - score: startedAt epoch

Behavior:
- If monitor is already DOWN and open incident exists, do not create a new incident.
- On recovery, resolve current incident.

## 5) Crawl & Suggestion Cache

### Crawl result cache
- `crawl_cache:{canonicalBaseUrl}` (JSON object)
- fields:
  - `urls` (non-static endpoints only)
  - `generatedAt`
- TTL: 10 to 30 minutes

### Optional per-user suggestion cache (UI-specific)
- `user:{userId}:suggestions:{canonicalBaseUrl}` (JSON)
- TTL: 5 to 10 minutes

## 6) Query Patterns and Complexity

### Dashboard load (paginated)
1. `LRANGE user:{userId}:monitors {cursor} {cursor+limit-1}`
2. `MGET monitor:{id}...` (or pipelined GET)
3. Return `{ items, nextCursor, limit }`

### Scheduler run
1. `SMEMBERS monitor:index:all`
2. GET each `monitor:{id}`
3. Ping + update monitor + append history

### Create monitor (duplicate-safe)
1. canonicalize URL
2. `GET user:{userId}:monitor_url:{canonicalUrl}`
3. if exists: return existing monitor
4. else create monitor + LPUSH user list + SET url index

### Delete monitor
1. GET monitor
2. DEL monitor + DEL url index + LREM user list + DEL history + DEL state
3. If root/child relation exists, clean corresponding set/string keys

### Add endpoint monitors from card
For each selected endpoint URL:
1. canonicalize URL
2. duplicate check using URL index
3. create monitor only if missing
4. add child monitor ID to `monitor:{rootMonitorId}:endpoints`
5. set `monitor:{childMonitorId}:root`

## 7) Caching Strategy

- Cache only derived/read-heavy data:
  - crawl suggestions
  - dashboard summary counters
  - last-known state
- Do not cache source-of-truth monitor objects externally; Redis is source of truth.
- Invalidate summary caches on:
  - monitor create/delete
  - status change events

Suggested summary cache:
- `summary:{userId}` (HASH)
  - `total`
  - `up`
  - `down`
  - `restricted`
  - `pending`
  - `updatedAt`
- TTL: 30 to 120 seconds

## 8) Parameter Placement

Put monitor-level check parameters in each monitor object:
- `timeoutMs`
- `retries`
- `checkIntervalSec`
- `alertChannels` (IDs)

Put UI-only temporary selection state in frontend only (not Redis).

## 9) How to Update Schema

Use define + migrate, not query-only changes in production.

Recommended process:
1. Define schema contracts first (keys, payloads, query patterns).
2. Ship code that writes/reads the new schema.
3. Backfill existing data where required.
4. Validate parity with sampled reads and counts.
5. Remove deprecated keys/paths after stability window.

## 10) Why this reduces time

- URL dedupe index makes create O(1) for duplicates.
- LIST + point GET keeps dashboard reads cheap and predictable.
- State cache avoids scanning full history for current status.
- Incident open-index prevents duplicate incident/log churn.
- Crawl cache avoids repeated crawl cost for same base URL.
