// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
export type Permission = 'file_read' | 'file_write' | 'network' | 'editor' | 'ai' | 'im' | 'lawfirm' | 'speech' | 'tasks' | 'clipboard';
export type Dock = 'left' | 'right' | 'bottom';
export interface ViewDeclaration {
  id: string; name: string; entry: string; placement: 'sidebar' | 'workspace'; scope: 'project' | 'global'; defaultDock?: Dock; allowedDocks?: Dock[];
}
export type ConnectionAuth = { type: 'none' | 'bearer' } | {
  type: 'oauth2'; authorizationUrl: string; tokenUrl: string; clientId: string; scopes?: string[];
};
export interface ConnectionDeclaration {
  id: string; label: string; baseUrl: string; auth: ConnectionAuth;
  operations: Record<string, { path: string; method: 'GET' | 'POST' }>;
  billing?: { statusOperation: string; checkoutUrl: string };
}
export interface SettingDeclaration {
  scope?: 'installation' | 'user' | 'project'; key: string; type: 'string' | 'boolean' | 'number' | 'select'; label: string; description?: string; default?: string | boolean | number; options?: string[]; secret?: boolean;
}
export interface FileContribution { id: string; name: string; file: string; genre?: string; description?: string; language?: string }
export type McpInputSchema = McpObjectSchema
  | { type: 'array'; items: McpInputSchema; title?: string; description?: string }
  | { type: 'string'; enum?: string[]; title?: string; description?: string }
  | { type: 'number' | 'integer' | 'boolean'; title?: string; description?: string };
export interface McpObjectSchema {
  type: 'object'; properties?: Record<string, McpInputSchema>; required?: string[]; additionalProperties?: boolean; title?: string; description?: string;
}
export interface McpServerDeclaration {
  id: string; transport: 'streamable-http'; url: string; credentialKey?: string; connectionId?: string;
  tools: { name: string; description: string; inputSchema: McpObjectSchema }[];
}
export interface PluginManifest {
  $schema?: string; id: string; name: string; version: string; description?: string; author?: string; homepage?: string; icon?: string;
  minHostVersion?: string; frontendEntry?: string; permissions?: Permission[]; backendJars?: string[]; skills?: string[]; packs?: string[];
  tools?: { name: string; description?: string; [key: string]: unknown }[];
  settings?: SettingDeclaration[]; guide?: Record<string, unknown>;
  contributes?: {
    mcpServers?: McpServerDeclaration[]; views?: ViewDeclaration[]; connections?: ConnectionDeclaration[]; templates?: FileContribution[]; styleProfiles?: FileContribution[];
    capabilities?: { id: string; capability: string; kind: 'web' | 'data' | 'process'; entry: string; protocol: string; runtime?: string }[];
    evidenceSources?: { sourceId: string; name: string; description?: string; transport?: 'spi' | 'mcp'; server?: { url: string; tokenSettingKey?: string }; tool?: string }[];
  };
}
