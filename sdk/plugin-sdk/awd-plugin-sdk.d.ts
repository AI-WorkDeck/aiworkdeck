// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
export as namespace awd;
export = awd;
declare const awd: awd.SDK;
declare global { interface Window { awd: awd.SDK } }
declare namespace awd {
  type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
  type Params = Record<string, unknown>;
  interface CallOptions { signal?: AbortSignal; /** 1–300000 ms; default 60000. */ timeoutMs?: number }
  interface RequestOptions extends CallOptions { requestId?: string }
  interface SettingsOptions extends CallOptions { scope?: 'user' | 'project'; projectId?: number | string }
  interface ConnectionSummary { id: string; label?: string; connected?: boolean; needsReconnect?: boolean; [key: string]: unknown }
  interface McpServer { id: string; name?: string; [key: string]: unknown }
  interface BillingStatus { provider: 'host' | 'developer'; active: boolean; plan?: string; /** Host status: false means cached/offline, not a fresh payment confirmation. */ refreshed?: boolean }
  interface BridgeError extends Error { code: string }
  interface Context { pluginId?: string; projectId?: number | string | null; language?: string; theme?: 'light' | 'dark'; themeTokens?: Record<string, string>; [key: string]: unknown }
  interface File { path: string; name: string; size: number; [key: string]: unknown }
  interface Rect { left: number; top: number; width: number; height: number }
  interface Drag extends File { dragToken: string; dragType: string; expiresAt: number; hostHandle?: boolean }
  interface Target { path: string; locator?: string; relation?: string; method?: string; note?: string }
  interface EvidenceLink { anchor: { selection: true } | { quote: string }; docPath?: string; targets: Target[] }
  interface NotificationInput {
    /** Stable across retries; a different payload needs a new key. */
    eventKey: string; title: string; body?: string; kind?: string; actionState?: 'none' | 'pending';
    /** Opens only this plugin. The target never executes a business decision. */
    target?: { kind: 'plugin'; pluginId: string; view?: string; recordId?: string };
  }
  interface ProgressState {
    title?: string;
    detail?: string;
    percent?: number;
    safetyNote?: string;
    cancelText?: string;
    onCancel?: () => void;
  }
  interface ProgressController {
    update(next: ProgressState | null | false): void;
    clear(): void;
  }
  interface SDK {
    readonly version: string;
    context: Context | null;
    ready(): Promise<Context>;
    call<T = unknown>(method: string, params?: Params, options?: CallOptions): Promise<T>;
    files: {
      list(options?: CallOptions): Promise<File[]>;
      read(path: string, options?: CallOptions): Promise<{ path: string; content: string; truncated: boolean }>;
      prepareDrag(path: string, rect?: Rect, options?: CallOptions): Promise<Drag>;
      endDrag(options?: CallOptions): Promise<unknown>;
    };
    ui: {
      toast(message: string, options?: CallOptions): Promise<unknown>;
      openFile(path: string, options?: CallOptions): Promise<unknown>;
      progress(target: string | Element | null, state?: ProgressState | null | false): ProgressController;
    };
    tools: { invoke(name: string, args?: Params, options?: CallOptions): Promise<string> };
    chat: { send(prompt: string, options?: CallOptions): Promise<unknown>; addFile(path: string, options?: CallOptions): Promise<unknown> };
    im: { request<T = unknown>(action: string, params?: Params, options?: CallOptions): Promise<T> };
    notifications: {
      publish<T = unknown>(notification: NotificationInput, options?: CallOptions): Promise<T>;
      resolve<T = unknown>(eventKey: string, state?: 'done' | 'cancelled', options?: CallOptions): Promise<T>;
    };
    lawfirm: { request<T = unknown>(action: string, params?: Params, options?: CallOptions): Promise<T> };
    storage: { get<T = Json>(key: string, options?: CallOptions): Promise<T | null>; set(key: string, value: Json, options?: CallOptions): Promise<unknown> };
    settings: {
      get(key: string, options?: CallOptions): Promise<string>;
      open(options?: CallOptions): Promise<unknown>;
      /** Only declared, non-secret settings. Credentials belong to connections.connect host UI. */
      update(values: Record<string, string>, options?: SettingsOptions): Promise<unknown>;
    };
    services: {
      request<T = unknown>(service: string, operation: string, params?: Params, options?: RequestOptions): Promise<T>;
      cancel(params: { requestId: string }, options?: CallOptions): Promise<unknown>;
    };
    mcp: { servers(options?: CallOptions): Promise<{ servers: McpServer[] }>; call<T = unknown>(serverId: string, name: string, args?: Params, options?: CallOptions): Promise<T> };
    connections: {
      list(options?: CallOptions): Promise<{ connections: ConnectionSummary[] }>;
      connect(id: string, options?: CallOptions): Promise<{ opened: true }>;
      disconnect(id: string, options?: CallOptions): Promise<unknown>;
      request<T = unknown>(id: string, operation: string, params?: Params, options?: CallOptions): Promise<T>;
    };
    billing: { status(connectionId?: string, options?: CallOptions): Promise<BillingStatus>; checkout(connectionId?: string, options?: CallOptions): Promise<unknown> };
    theme: { get(): { mode: 'light' | 'dark'; tokens: Record<string, string> }; onChange(cb: (mode: 'light' | 'dark', tokens: Record<string, string>) => void): () => void };
    evidence: { link(params: EvidenceLink, options?: CallOptions): Promise<{ linkKey: string; targetIds: string[] }>; list<T = unknown>(params?: { docPath?: string; path?: string; sectionPath?: string; status?: string }, options?: CallOptions): Promise<T>; locate(params: { linkKey: string; targetId?: string }, options?: CallOptions): Promise<unknown> };
    doc: {
      exec<T = unknown>(action: string, params?: Params, options?: CallOptions): Promise<T>;
      active(options?: CallOptions): Promise<{ fileId: string | number | null; kind: 'writer' | 'calc' | 'impress' | null }>;
      getText<T = unknown>(options?: CallOptions): Promise<T>;
      getSelection<T = unknown>(options?: CallOptions): Promise<T>;
      find<T = unknown>(text: string, options?: CallOptions): Promise<T>;
      insertText(text: string, options?: CallOptions): Promise<unknown>;
      addComment(anchorText: string, text: string, options?: CallOptions): Promise<unknown>;
    };
    events: { on<T = Params>(name: string, cb: (data: T) => void): () => void };
    ai: { request(prompt: string, options?: CallOptions & { system?: string; purpose?: string }): Promise<string> };
  }
}
