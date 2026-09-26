/**
 * 0KAY API compatibility engine.
 *
 * Shared by the browser bootstrap (plugin-web/compat) and the standalone proxy
 * (server/index.mjs). It translates legacy API calls into the current contract
 * so older front-end bundles and external clients keep working after the HTTP
 * API evolves.
 *
 * Rule kinds:
 *  1. Generic path policies (always on, component-agnostic):
 *       /api/v1/foo            -> /api/foo
 *       /plugin/<name>/ui/x    -> /api/plugins/<name>/ui/x
 *       //a//b/                -> /a/b
 *  2. Legacy request aliases (REQUEST_ALIASES): exact method+path rewrites that
 *     may also move a query/body field into the path, change the method, or drop
 *     the body. Mirrors the retired-to-current mapping table in docs/HTTP_API.md.
 *  3. Additive response aliases (RESPONSE_ALIASES): guarantee legacy keys exist
 *     without removing the current ones.
 *
 * IMPORTANT: aliases must never change behaviour the current WebUI relies on.
 * Prefer additive response fields; only alias a path once the caller migrates.
 * Rules marked `scope: "proxy"` run only on the external proxy so the live
 * WebUI keeps the redacted `/api/providers` shape.
 */

/** API surfaces this layer covers. */
export const COMPONENTS = ['core', 'webui', 'agent', 'life', 'mocr', 'searxng']

/** Version of the current (translation target) API contract. */
export const CURRENT_API_VERSION = 1

/**
 * Exact legacy path -> current path, per component. Kept for simple, path-only
 * remaps. Empty by default: richer remaps live in REQUEST_ALIASES.
 */
export const PATH_ALIASES = {
  core: {},
  webui: {},
  agent: {},
  life: {},
  mocr: {},
  searxng: {},
}

/** Encode each path segment but keep the separators (for `{name...}` tails). */
function segPaths(value) {
  return String(value ?? '')
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
}

/** Remove a query string entirely. */
const NO_SEARCH = ''

/**
 * Legacy request aliases. Each rule matches one exact `METHOD path` (after
 * normalizePath) and `rewrite(ctx)` returns an optional patch:
 *   { method?, path?, search?, body?, dropBody? }
 * Returning null/undefined leaves the request untouched (the caller's own
 * validation then produces the error).
 *
 * ctx: { path, method, searchParams, query, body }  // body = parsed JSON or undefined
 */
export const REQUEST_ALIASES = [
  {
    id: 'plugins-enable',
    component: 'core',
    method: 'POST',
    path: '/api/plugins/enable',
    to: 'PATCH /api/plugins/{plugin}',
    rewrite: (ctx) => ({
      method: 'PATCH',
      path: `/api/plugins/${encodeURIComponent(ctx.body?.plugin || ctx.body?.name || '')}`,
      dropBody: false,
      body: { enabled: true },
    }),
  },
  {
    id: 'plugins-disable',
    component: 'core',
    method: 'POST',
    path: '/api/plugins/disable',
    to: 'PATCH /api/plugins/{plugin}',
    rewrite: (ctx) => ({
      method: 'PATCH',
      path: `/api/plugins/${encodeURIComponent(ctx.body?.plugin || ctx.body?.name || '')}`,
      body: { enabled: false },
    }),
  },
  {
    id: 'providers-delete-legacy',
    component: 'core',
    method: 'DELETE',
    path: '/api/providers/delete',
    to: 'DELETE /api/providers/{id}',
    rewrite: (ctx) => {
      const id = ctx.query.id || ctx.body?.id
      if (!id) return null
      return { path: `/api/providers/${encodeURIComponent(id)}`, search: NO_SEARCH }
    },
  },
  {
    id: 'skills-delete-legacy',
    component: 'core',
    method: 'DELETE',
    path: '/api/skills',
    to: 'DELETE /api/skills/{name...}',
    rewrite: (ctx) => {
      const name = ctx.query.name || ctx.body?.name
      if (!name) return null
      return { path: `/api/skills/${segPaths(name)}`, search: NO_SEARCH }
    },
  },
  {
    id: 'live2d-delete-legacy',
    component: 'core',
    method: 'DELETE',
    path: '/api/live2d',
    to: 'DELETE /api/live2d/{path...}',
    rewrite: (ctx) => {
      const id = ctx.query.id || ctx.body?.id
      if (!id) return null
      return { path: `/api/live2d/${segPaths(id)}`, search: NO_SEARCH }
    },
  },
  {
    id: 'usage-clear-legacy',
    component: 'core',
    method: 'POST',
    path: '/api/usage/clear',
    to: 'DELETE /api/usage',
    rewrite: () => ({ method: 'DELETE', path: '/api/usage', dropBody: true }),
  },
  {
    id: 'tasks-cancel-legacy',
    component: 'core',
    method: 'POST',
    path: '/api/tasks/cancel',
    to: 'POST /api/tasks/{task_id}/cancel',
    rewrite: (ctx) => {
      const id = ctx.body?.task_id || ctx.body?.taskId || ctx.query.task_id
      if (!id) return null
      return { path: `/api/tasks/${encodeURIComponent(id)}/cancel`, dropBody: true }
    },
  },
  {
    id: 'sessions-item-legacy',
    component: 'core',
    method: 'PATCH',
    path: '/api/agent/sessions',
    to: 'PATCH /api/agent/sessions/{session_id}',
    rewrite: (ctx) => {
      const id = ctx.body?.session_id || ctx.body?.sessionId || ctx.query.session_id
      if (!id) return null
      const rest = { ...(ctx.body || {}) }
      delete rest.session_id
      delete rest.sessionId
      return { path: `/api/agent/sessions/${encodeURIComponent(id)}`, body: Object.keys(rest).length ? rest : undefined }
    },
  },
  {
    id: 'sessions-item-legacy-delete',
    component: 'core',
    method: 'DELETE',
    path: '/api/agent/sessions',
    to: 'DELETE /api/agent/sessions/{session_id}',
    rewrite: (ctx) => {
      const id = ctx.body?.session_id || ctx.body?.sessionId || ctx.query.session_id
      if (!id) return null
      return { path: `/api/agent/sessions/${encodeURIComponent(id)}`, dropBody: true }
    },
  },
  {
    id: 'mocr-generate-legacy',
    component: 'mocr',
    method: 'POST',
    path: '/api/mocr/generate',
    to: 'POST /api/chat',
    rewrite: () => ({ path: '/api/chat' }),
  },
  {
    id: 'life-state-legacy',
    component: 'life',
    method: 'GET',
    path: '/api/life/state',
    to: 'GET /api/state',
    rewrite: () => ({ path: '/api/state' }),
  },
  {
    id: 'providers-credentials-legacy',
    component: 'core',
    method: 'GET',
    path: '/api/providers',
    to: 'GET /api/providers/credentials',
    // Proxy-only: the live WebUI still reads the redacted `/api/providers`.
    scope: 'proxy',
    rewrite: () => ({ path: '/api/providers/credentials', search: NO_SEARCH }),
  },
]

/**
 * Additive response adapters: guarantee legacy keys exist without removing the
 * current ones. Safe to run against the live WebUI.
 */
export const RESPONSE_ALIASES = [
  {
    id: 'core-installed-packages',
    component: 'core',
    method: 'GET',
    path: '/api/plugins/installed',
    adapt: (data) => {
      if (!data || Array.isArray(data) || Array.isArray(data.packages)) return data
      const names = Object.keys(data.installed || {}).map((key) => data.installed[key]?.name || key)
      return { ...data, packages: names }
    },
  },
]

/** Collapse duplicate slashes, drop a trailing slash, rewrite known prefixes. */
export function normalizePath(path) {
  let out = String(path || '/')
  out = out.replace(/\/{2,}/g, '/')
  out = out.replace(/^\/api\/v\d+(?=\/|$)/i, '/api')
  out = out.replace(/^\/plugin\//, '/api/plugins/')
  if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1)
  return out
}

/** Which API component a normalized path belongs to. */
export function componentFor(path) {
  if (path.startsWith('/api/life')) return 'life'
  if (path.startsWith('/api/agent')) return 'agent'
  if (path.startsWith('/api/mocr')) return 'mocr'
  if (path.startsWith('/api/search') || path.startsWith('/api/run')) return 'searxng'
  if (path.startsWith('/api/')) return 'core'
  return 'webui'
}

/** Parse a request body into a plain object when possible (JSON or form). */
export function parseBody(body) {
  if (body == null) return undefined
  if (typeof body === 'object') return body
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return Object.fromEntries(body.entries())
  }
  if (typeof body === 'string' && body.trim()) {
    try {
      return JSON.parse(body)
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * Resolve a request (URL + method + optional body) to the current API contract.
 *
 * opts.via: 'browser' (default) or 'proxy'. `scope: "proxy"` rules only apply
 * to the proxy.
 *
 * Returns { component, originalPath, path, method, changed, url, body,
 *           bodyChanged, dropBody }. `body` is an object when bodyChanged.
 */
export function resolveRequest(rawUrl, method = 'GET', body, opts = {}) {
  const via = opts.via || 'browser'
  const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(String(rawUrl))
  const base = isAbsolute ? undefined : 'http://localhost'
  const url = new URL(String(rawUrl), base)
  const originalPath = url.pathname
  let path = normalizePath(originalPath)
  const component = componentFor(path)
  const aliases = PATH_ALIASES[component] || {}
  if (aliases[path]) path = aliases[path]

  let outMethod = String(method || 'GET').toUpperCase()
  let search = url.search
  let outBody = body
  let bodyChanged = false
  let dropBody = false
  let changed = path !== originalPath

  const parsedBody = parseBody(body)
  const query = Object.fromEntries(url.searchParams.entries())

  for (const rule of REQUEST_ALIASES) {
    if (rule.scope === 'proxy' && via !== 'proxy') continue
    if (rule.method !== outMethod) continue
    if (rule.path !== path) continue
    const result = rule.rewrite({ path, method: outMethod, searchParams: url.searchParams, query, body: parsedBody })
    if (!result) continue
    if (result.method && result.method !== outMethod) {
      changed = true
      outMethod = result.method
    }
    if (result.path && result.path !== path) {
      changed = true
      path = result.path
    }
    if (result.search !== undefined && result.search !== search) {
      changed = true
      search = result.search
    }
    if (result.dropBody) {
      changed = true
      dropBody = true
      bodyChanged = true
      outBody = undefined
    } else if ('body' in result) {
      changed = true
      outBody = result.body
      bodyChanged = true
    }
  }

  const suffix = `${path}${search}`
  return {
    component,
    originalPath,
    path,
    method: outMethod,
    changed,
    body: outBody,
    bodyChanged,
    dropBody,
    url: isAbsolute ? `${url.origin}${suffix}` : suffix,
  }
}

/** Whether a response adapter applies to a resolved request path. */
export function hasResponseAdapter(path, method = 'GET') {
  const upper = String(method || 'GET').toUpperCase()
  return RESPONSE_ALIASES.some((rule) => rule.path === path && (!rule.method || rule.method === upper))
}

/** Apply a matching response adapter, or return the data unchanged. */
export function adaptResponse(path, method, data) {
  const upper = String(method || 'GET').toUpperCase()
  for (const rule of RESPONSE_ALIASES) {
    if (rule.path === path && (!rule.method || rule.method === upper)) return rule.adapt(data)
  }
  return data
}

/** Serialisable snapshot of the active rules (for introspection endpoints). */
export function describeRules() {
  return {
    apiVersion: CURRENT_API_VERSION,
    components: COMPONENTS,
    pathAliases: PATH_ALIASES,
    requestAliases: REQUEST_ALIASES.map(({ id, component, method, path, to, scope }) => ({
      id,
      component,
      from: `${method} ${path}`,
      to,
      scope: scope || 'all',
    })),
    responseAliases: RESPONSE_ALIASES.map(({ id, component, method, path }) => ({ id, component, method, path })),
  }
}
