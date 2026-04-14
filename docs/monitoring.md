# Monitoring

Zebric exposes Prometheus-compatible metrics out of the box. This guide covers what metrics are available, how to scrape them locally with the development Docker Compose stack, and how to wire up Grafana for visualization.

---

## Metrics endpoint

The `/metrics` endpoint is served on the same port as the main application (default `3000`):

```
GET http://localhost:3000/metrics
```

It returns plain text in the [Prometheus exposition format](https://prometheus.io/docs/instrumenting/exposition_formats/).

The endpoint is always enabled in development. In production it is controlled by the `METRICS_ENABLED` environment variable (default `true`).

### Available metrics

All metrics use the `zbl_` prefix.

| Metric | Type | Description |
|---|---|---|
| `zbl_requests_total` | counter | Total HTTP requests handled |
| `zbl_requests_by_route_total{route}` | counter | Requests broken down by route path |
| `zbl_requests_by_status_total{status}` | counter | Requests broken down by status class (`2xx`, `4xx`, `5xx`) |
| `zbl_request_duration_ms_sum` | gauge | Cumulative request duration in milliseconds |
| `zbl_request_duration_ms_count` | counter | Number of requests contributing to duration sum |
| `zbl_request_duration_ms_bucket{le}` | counter | Request duration histogram buckets (`<=25`, `<=100`, `<=250`, `<=500`, `<=1000`, `<=2500`, `<=5000`, `+Inf`) |
| `zbl_query_duration_ms_sum{entity}` | gauge | Cumulative DB query duration per entity |
| `zbl_query_duration_ms_count{entity}` | counter | Number of queries per entity |
| `zbl_query_duration_ms_bucket{entity,le}` | counter | Query duration histogram buckets per entity |
| `zbl_route_cache_hits` | counter | Route cache hits |
| `zbl_route_cache_misses` | counter | Route cache misses |

---

## Running the development monitoring stack

`docker-compose.dev.yml` includes Prometheus and Grafana services pre-configured to scrape your local Zebric instance.

### Prerequisites

- Docker and Docker Compose installed
- The `zebric-dev` container running (or the Zebric app running on port 3000)

### Start Prometheus only

```bash
docker compose -f docker-compose.dev.yml up zebric-dev prometheus-dev
```

Prometheus UI is available at **http://localhost:9091**.

To verify scraping is working, open the Prometheus UI, go to **Status → Targets**, and confirm `zebric-engine` shows state `UP`.

You can also query metrics directly:

```
http://localhost:9091/graph?g0.expr=zbl_requests_total
```

### Start Prometheus and Grafana

```bash
docker compose -f docker-compose.dev.yml up zebric-dev prometheus-dev grafana-dev
```

Grafana is available at **http://localhost:3001**.

Default credentials: `admin` / `admin`

Grafana does not have a Prometheus data source pre-configured yet. To add one manually:

1. Go to **Connections → Data sources → Add data source**
2. Select **Prometheus**
3. Set the URL to `http://prometheus-dev:9090` (use the Docker service name, not `localhost`)
4. Click **Save & test**

### Prometheus configuration

The Prometheus config used by the dev stack is at `monitoring/prometheus-dev.yml`. It scrapes `/metrics` on the `zebric-dev` container every 10 seconds.

If you change the app port or container name, update the `targets` field in that file to match:

```yaml
scrape_configs:
  - job_name: 'zebric-engine'
    static_configs:
      - targets: ['zebric-dev:3000']
    metrics_path: '/metrics'
    scrape_interval: 10s
```

### Stopping the stack

```bash
docker compose -f docker-compose.dev.yml down
```

Prometheus data is persisted in the `prometheus_dev_data` Docker volume between runs. To reset it:

```bash
docker compose -f docker-compose.dev.yml down -v
```

---

## Admin server

The engine also runs an admin server on port `3030` (bound to `127.0.0.1` only, not exposed outside the host). It has its own `/metrics` endpoint alongside traces, blueprint inspection, and other debug routes. This is intended for local development use and is not scraped by the default Prometheus config.

```
GET http://localhost:3030/metrics
```
