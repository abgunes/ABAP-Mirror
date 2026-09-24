// Ready-to-paste client configurations for the "Copy MCP Client Config" command.

export interface ClientConfigSnippet {
  label: string;
  detail: string;
  text: string;
}

export function mcpUrl(port: number): string {
  return `http://127.0.0.1:${port}/mcp`;
}

export function clientConfigSnippets(port: number, token: string): ClientConfigSnippet[] {
  const url = mcpUrl(port);
  const headers = { Authorization: `Bearer ${token}` };
  return [
    {
      label: 'mcpServers JSON',
      detail: 'Cursor (~/.cursor/mcp.json), Cline, Windsurf and most other clients',
      text: JSON.stringify({ mcpServers: { 'abap-mirror': { type: 'http', url, headers } } }, null, 2),
    },
    {
      label: 'Claude Code CLI command',
      detail: 'Run once in a terminal',
      text: `claude mcp add --transport http abap-mirror ${url} --header "Authorization: Bearer ${token}"`,
    },
    {
      label: 'VS Code mcp.json',
      detail: 'For MCP clients inside another VS Code window (.vscode/mcp.json)',
      text: JSON.stringify({ servers: { 'abap-mirror': { type: 'http', url, headers } } }, null, 2),
    },
  ];
}
