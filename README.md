# Migration Rehearsal Runner

Offline, read-only simulation of declared schema migration steps over an exported fixture. This is a deliberate safety adaptation of a database rehearsal: it does **not** create a database, connect to one, execute SQL, inspect production, modify fixture files, or delete data. It checks only the narrow declarative schema operations listed below; it cannot prove real SQL behavior, data transformations, locking, or database rollback safety.

## Run

Node.js 22+; no dependencies or network calls.

```sh
node bin/migration-rehearsal-runner.mjs --root examples/pass --input snapshot.json
node bin/migration-rehearsal-runner.mjs --root examples/fail --input snapshot.json
npm run check
```

`--help` prints usage. Normal runs emit one JSON report on stdout: exit 0=`pass`, 1=`fail`, 2=`incomplete` or invalid configuration. Invalid options or root produce empty stdout. An unreadable, undecodable, malformed, or out-of-root named input produces an incomplete report. The input is realpath-confined under the root; UTF-8 decoding is strict and duplicate decoded JSON keys are rejected. No files are written.

## Snapshot and simulation

One JSON snapshot contains `schemaVersion:"1"`, `complete:true`, `fixture`, `steps`, and `expected`. The passing example shows the exact form. A schema is `{ "tables": [{"name":"items","columns":["id"]}] }`; it contains names only, no rows. `steps` has three ordered arrays:

- `setup`: `{ "action":"create-table", "table":"items", "columns":["id"] }`
- `forward`: `{ "action":"add-column", "table":"items", "column":"label" }`
- `rollback`: `{ "action":"remove-column", "table":"items", "column":"label" }`

`expected.afterSetup`, `expected.afterForward`, and `expected.afterRollback` are complete schemas. The simulator copies the fixture into memory, applies only those three operation forms, checks each phase against its expected schema without depending on column order, and additionally requires rollback to restore the post-setup schema. At least one forward and one rollback step are required. Unsupported operations, SQL text, connection-string fields, and common database URI schemes are rejected as incomplete evidence. A failed operation or state comparison fails policy; the report retains the phase and step pointer in `failure` and records `disposal:{scope:"simulated-memory-only",performed:true}`. This disposal means the local in-memory copy went out of scope; it does not claim to have cleaned a real database. Findings have fixed, non-echoing messages with logical `@snapshot` provenance and JSON pointers. They sort by `(pointer, ruleId)` in UTF-16 code-unit order.

## Limits and non-goals

Input ≤65,536 bytes; ≤50 tables per schema; ≤100 columns per table; ≤50 steps per phase; JSON depth ≤16; evaluation deadline ≤5,000 ms through an injected monotonic clock. Identifiers are ASCII letters followed by up to 63 ASCII letters, digits, or underscores. Every inclusive bound accepts N and rejects N+1. Optional top-level `metadata` is non-semantic but still inspected for depth and connection hints. This tool is not a substitute for an isolated real-database migration test performed by a separate, explicitly authorized workflow.
