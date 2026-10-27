// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import awd = require('../awd-plugin-sdk');
import type { SDK } from '../awd-plugin-sdk';
const instance: SDK = window.awd;
void instance;
import type { PluginManifest } from '../manifest';
const options = { signal: new AbortController().signal, timeoutMs: 120000 };
const text: Promise<string> = awd.ai.request('test', { ...options, purpose: 'test' });
const file: Promise<{ path: string; content: string; truncated: boolean }> = awd.files.read('x', options);
awd.call('context.get', {}, options);
awd.settings.update({ greeting: 'hello' }, { ...options, scope: 'project', projectId: 1 });
awd.services.request<{ matches: unknown[] }>('search', 'query', { query: 'test' }, { ...options, requestId: 'test' });
awd.services.cancel({ requestId: 'test' }, options);
awd.mcp.servers(options); awd.mcp.call('id', 'tool', {}, options);
awd.connections.connect('provider', options); awd.connections.request('provider', 'query', {}, options);
awd.billing.status(undefined, options); awd.billing.checkout('provider', options);
const manifest: PluginManifest = { id: 'demo-plugin', name: 'Demo', version: '0.1.0', permissions: ['network'], contributes: { connections: [{ id: 'demo', label: 'Demo', baseUrl: 'https://example.invalid', auth: { type: 'bearer' }, operations: { query: { method: 'POST', path: '/query' } } }] } };
// @ts-expect-error A connection credential is never an iframe API argument.
awd.connections.connect('provider', { token: 'secret' });
// @ts-expect-error Unknown permission is rejected by declarations and CLI.
const bad: PluginManifest = { id: 'demo-plugin', name: 'Demo', version: '0.1.0', permissions: ['superuser'] };
void text; void file; void manifest; void bad;
const mcpManifest: PluginManifest = {
  id: 'mcp-demo', name: 'MCP demo', version: '1.0.0', permissions: ['speech', 'tasks', 'clipboard', 'network'],
  settings: [{ key: 'apiKey', label: 'API key', type: 'string', secret: true, scope: 'installation' }],
  contributes: { mcpServers: [{ id: 'research', transport: 'streamable-http', url: 'https://research.example.invalid/mcp', credentialKey: 'apiKey', tools: [{ name: 'search', description: 'Search records', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }] }] },
};
void mcpManifest;

const workspace: Promise<Record<string, never>> = awd.ui.openWorkspace();
// @ts-expect-error A plugin cannot choose another plugin's workspace.
awd.ui.openWorkspace('other-plugin');
const contributionOnly: PluginManifest = { id: 'light-plugin', name: 'Light', version: '1.0.0', contributes: { views: [] } };
void workspace; void contributionOnly;
