# Public MCP tool metadata fixtures

`official-tool-schemas.json` preserves public tool names, descriptions and JSON
schemas returned by the providers' `tools/list` on 2026-10-29. Collected by the
parent task using the user's existing configured connection; no tokens,
credentials, business queries, or business responses are included.

- Qichacha: https://agent.qcc.com/mcp/company/stream (16 tools), public catalog
  https://agent.qcc.com/data and setup https://agent.qcc.com/guide.
- PKULaw: https://apim-gateway.pkulaw.com/mcp-law-agg/mcp (18 tools), documentation
  https://mcp.pkulaw.com/docs.

These are interoperability test data, not implementation source. The providers
retain rights to their metadata. The tests prove schema compatibility and local
argument enforcement, not live paid query results or availability.
