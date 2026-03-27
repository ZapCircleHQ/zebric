# Performance Benchmarks

Baseline measurements taken on an Apple M-series Mac running Node.js 20. Numbers will vary by hardware, but the relative costs and scaling characteristics hold across environments.

Run the benchmarks yourself:

```bash
pnpm --filter @zebric/runtime-core bench
```

---

## Route Matching

Route matching runs on every HTTP request. Zebric uses an exact-match fast path first, then falls back to regex matching for dynamic routes.

| Scenario | Throughput | Mean latency |
|---|---|---|
| Static route, root `/` (5 routes) | 8,093,570 ops/sec | 0.0001 ms |
| Static route, root `/` (15 routes) | 4,679,793 ops/sec | 0.0002 ms |
| Static route, root `/` (30 routes) | 7,409,877 ops/sec | 0.0001 ms |
| Static route, last in table (30 routes) | 4,508,141 ops/sec | 0.0002 ms |
| Dynamic route `:id` (5 routes) | 277,636 ops/sec | 0.0036 ms |
| Dynamic route `:id` (15 routes) | 335,289 ops/sec | 0.0030 ms |
| Dynamic route `:id` (30 routes) | 39,077 ops/sec | 0.0256 ms |
| Nested dynamic route `/:id/edit` | 211,789 ops/sec | 0.0047 ms |
| Static path with query string | 360,837 ops/sec | 0.0028 ms |
| Dynamic path with query string | 285,648 ops/sec | 0.0035 ms |
| No match (5 routes) | 465,276 ops/sec | 0.0021 ms |
| No match (30 routes) | 80,350 ops/sec | 0.0124 ms |

**Key observations:**
- Static route matching is near free (~0.1 µs) and does not degrade significantly with table size.
- Dynamic route matching relies on regex compilation and degrades with more routes. A table of 30 dynamic routes is ~8× slower than 15. Keep route tables small where possible.
- Not-found requests must scan the entire table; cost is proportional to table size.

---

## HTML Escaping

`escapeHtml` is called for every user-generated value rendered into HTML. It is intentionally in the critical path to prevent XSS.

| Scenario | Throughput | Mean latency |
|---|---|---|
| Null / undefined value | 11,413,267 ops/sec | 0.0001 ms |
| Number value | 6,055,922 ops/sec | 0.0002 ms |
| Clean short string | 5,004,776 ops/sec | 0.0002 ms |
| Typical user content (mixed) | 1,835,992 ops/sec | 0.0005 ms |
| Dirty short string (XSS attempt) | 1,283,663 ops/sec | 0.0008 ms |
| Clean long string (no replacements) | 1,197,155 ops/sec | 0.0008 ms |
| Dirty long string (many replacements) | 45,956 ops/sec | 0.0218 ms |
| Attribute value (clean) | 2,318,964 ops/sec | 0.0004 ms |
| Attribute value (dirty) | 2,246,283 ops/sec | 0.0004 ms |
| Multiline attribute value | 2,389,108 ops/sec | 0.0004 ms |

**Key observations:**
- Escaping is fast for typical content. Pages rendering many small string values incur negligible overhead.
- Long strings with many special characters (`&`, `<`, `>`, `"`, `'`) are ~110× slower than typical short strings, as every character must be checked and replaced. This is unlikely to be a bottleneck in practice.

---

## HTML Rendering

Full-page server-side rendering including layout selection, component assembly, and HTML document wrapping.

| Scenario | Throughput | Mean latency |
|---|---|---|
| List page — 5 rows | 12,519 ops/sec | 0.0799 ms |
| List page — 25 rows | 5,532 ops/sec | 0.1807 ms |
| List page — 100 rows | 450 ops/sec | 2.2215 ms |
| Detail page | 5,949 ops/sec | 0.1681 ms |
| Form page (4 fields) | 2,771 ops/sec | 0.3608 ms |
| Dashboard page (25 rows) | 10,073 ops/sec | 0.0993 ms |
| Construct new `HTMLRenderer` | 3,911 ops/sec | 0.2556 ms |

**Key observations:**
- Rendering cost scales roughly linearly with row count. A 100-row list takes ~27× longer than a 5-row list.
- Use pagination in blueprints (`limit`) to keep list pages within a manageable row count. 20–25 rows is a reasonable default.
- Form rendering is slower than detail rendering due to form field component assembly.
- `HTMLRenderer` instances are created once per engine startup, not per request.

---

## Blueprint Parsing

Parsing runs at startup and on hot reload. It is not in the per-request path.

| Scenario | Throughput | Mean latency |
|---|---|---|
| TOML — minimal blueprint | 83,347 ops/sec | 0.0120 ms |
| TOML — typical (3 entities, 3 pages) | 3,393 ops/sec | 0.2947 ms |
| JSON — minimal blueprint | 117,829 ops/sec | 0.0085 ms |
| JSON — typical (3 entities, 3 pages) | 10,177 ops/sec | 0.0983 ms |
| TOML vs JSON — typical, TOML | 5,837 ops/sec | 0.1713 ms |
| TOML vs JSON — typical, JSON | 13,827 ops/sec | 0.0723 ms |

**Key observations:**
- JSON parsing is ~2.4× faster than TOML for equivalent blueprints. For production deployments where startup latency matters (e.g. CloudFlare Workers cold starts), prefer JSON.
- TOML is the recommended format for authoring due to readability; convert to JSON as a build step if needed.
- Blueprint complexity (number of entities, pages, and fields) has a significant effect — a typical app parses in ~0.3 ms (TOML) or ~0.1 ms (JSON), both negligible for startup.

---

## Running Benchmarks

Benchmarks live in `packages/runtime-core/src/` alongside the code they measure:

| File | Covers |
|---|---|
| `routing/route-matcher.bench.ts` | Route resolution |
| `security/html-escape.bench.ts` | HTML escaping |
| `renderer/html-renderer.bench.ts` | Page rendering |
| `blueprint/blueprint-parser.bench.ts` | Blueprint parsing |

```bash
# Run all benchmarks
pnpm --filter @zebric/runtime-core bench

# Run a specific file
pnpm --filter @zebric/runtime-core exec vitest bench src/routing/route-matcher.bench.ts
```
