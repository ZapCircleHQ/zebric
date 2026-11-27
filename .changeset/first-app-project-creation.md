---
"@zebric/cli": minor
---

Add non-interactive `zebric init` with the tested first-app starter, package scripts,
and overwrite protection. Make dev, validate, and audit discover the only default
TOML or JSON Blueprint and require an explicit path when both exist. Add strict
port validation, `--admin-port`, Blueprint preflight validation, and actionable
startup diagnostics for missing files, occupied ports, and database write failures.
