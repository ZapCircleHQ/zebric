The Big Zebra
Internal benchmark harness for Zebric.

What is here

- `app/blueprint.toml`: benchmark application blueprint
- `profiles/`: named workload profiles
- `seed/`: deterministic dataset generation and bulk seed logic
- `scenarios/`: interactive, webhook, workflow, and notification workers
- `runner/`: metrics, ramp control, report writing, and run orchestration
- `simulators/`: local notification sink and webhook simulator services
- `docker-compose.benchmark.yml`: local compose topologies
- `nginx.benchmark.conf`: stable entrypoint for scaled app containers
- `cli.mjs`: internal command surface used by the Zebric CLI wrapper

Primary commands

- `node benchmark/cli.mjs seed --profile=big-zebra-v1 --tier=smoke`
- `node benchmark/cli.mjs run --profile=big-zebra-v1 --topology=local`
- `node benchmark/cli.mjs report --input=benchmark/results/latest.json`
- `node benchmark/cli.mjs worker --databaseUrl=... --sinkUrl=...`

Notes

- This harness is local-first and internal.
- The local topology uses SQLite and starts the app in-process.
- The compose topologies are wired for Postgres-backed local orchestration.
- `benchmark/Dockerfile` builds a self-contained benchmark image for compose runs.
- The benchmark code imports the current repo's built runtime from `packages/runtime-node/dist`.
