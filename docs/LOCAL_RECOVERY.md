# Local process and connection recovery

The API and worker share a PostgreSQL pool that handles disconnected idle and
checked-out clients. Errors still reject active queries; requests and writes are
never automatically replayed. New connections have a 10-second connection wait
and TCP keepalive enabled. TLS verification and database-role separation are
unchanged. Recovery messages contain no database error objects or client data.

Worker queue scans retry connection failures with exponential delays from one
second to a maximum of 30 seconds, reset after a successful scan. Shutdown cancels
the wait. SQL and application errors are not classified as connection outages.
Existing persisted job leases, attempts, stale recovery and explicit retries stay
authoritative for interrupted work.

A sleeping laptop cannot serve requests or execute jobs. Recovery resumes after
wake and network restoration; detecting an already-open dead socket may still
require the operating system's TCP timeout. A failed browser request may need a
manual refresh. Prevent idle sleep temporarily with `caffeinate -i pnpm dev`
(or `caffeinate -i pnpm dev:worker`); this does not promise lid-closed operation.

The SSL-mode deprecation warning is separate from transport timeouts; weakening
TLS verification is not a recovery mechanism.

`pnpm dev`, `pnpm dev:api` and `pnpm dev:worker` build/watch their relevant backend
project graph and supervise plain Node runtime processes. Unexpected exits restart
after 1, 2, 4, 8, 16, then at most 30 seconds; a 30-second stable run resets backoff.
Compiled JavaScript changes restart the backend processes after a short debounce.
The combined command supervises the Angular dev server and compiler too. Ctrl-C
or SIGTERM cancels restarts and terminates process trees, escalating after five
seconds. Start the command once again after updating to activate this launcher.
`pnpm dev:web` remains the standalone Angular dev server; direct production start
commands still require the deployment's process supervisor.

Validation: `pnpm test:dev-recovery`, focused DB pool/connection-error tests and
worker polling/provider tests, plus `pnpm build:backend`. The DB socket test uses
the installed pg/Kysely implementation against an isolated local wire peer; it
does not connect to either configured database or perform job/scoring writes.
