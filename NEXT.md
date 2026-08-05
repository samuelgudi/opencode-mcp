# NEXT — opencode-mcp

## Audit MCP spec 2026-07-28 (2026-08-05)

Esito: `opencode_wait` usa `notifications/message` (capability Logging, **deprecata**, finestra 12 mesi). Refactor consigliato: migrare il trio fire/check/wait all'estensione Tasks (`io.modelcontextprotocol/tasks`) + upgrade SDK. Piano completo in `docs/mcp-spec-2026-07-28-audit.md`.
