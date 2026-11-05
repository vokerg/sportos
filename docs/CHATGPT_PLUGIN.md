# ChatGPT plugin on the existing Render API

Issue #240 adds a remote, read-only connection to the existing SportOS API.
The local stdio server in [ATHLETE_MCP.md](ATHLETE_MCP.md) remains available.
The plugin uses the same five tools, bound to the account from an approved
SportOS browser session. It never uses the local `SPORTOS_MCP_ACCOUNT_ID` binding.

Implementation is in progress on the issue branch. Production migration,
deployment, plugin creation and live ChatGPT verification are pending.
See issue #240 for the inspected-file record and validation progress.
