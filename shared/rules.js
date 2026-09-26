/**
 * 0KAY API compatibility engine.
 *
 * Shared by the browser bootstrap (plugin-web/compat) and the standalone proxy
 * (server/index.mjs). It translates legacy API calls into the current contract
 * so older front-end bundles and external clients keep working after the HTTP
 * API evolves.
 *
 * Two kinds of rules:
 *  1. Generic path policies (always on, component-agnostic):
 *       /api/v1/foo            -> /api/foo
 *       /plugin/<name>/ui/x    -> /api/plugins/<name>/ui/x
 *       //a//b/                -> /a/b
 *  2. Per-component legacy aliases (PATH_ALIASES) and additive response
 *     aliases (RESPONSE_ALIASES).
 *
 * IMPORTANT: aliases must never change behaviour the current WebUI relies on.
 * Prefer additive response fields; only alias a path once Core stops serving it.
 */

/** API surfaces this layer covers. */
export const COMPONENTS = ['core', 'webui', 'agent', 'life', 'mocr', 'searxng']

/** Version of the current (translation target) API contract. */
export const CURRENT_API_VERSION = 1

/**
 * Exact legacy path -> current path, per component. Empty for now: Core still
 * serves the legacy paths it shipped with, so nothing needs remapping yet.
 * Add entries as old versions are retired, e.g.:
 *
 *   life:  { '/api/permissions': '/api/life/permissions' },
 *   agent: { '/api/agent/session': '/api/agent/sessions' },
 *
 * Never map a path the current WebUI still calls (e.g. /api/life/state).
 */
export const PATH_ALIASES = {
  core: {},
  webui: {},
  agent: {},
  life: {},
  mocr: {},
  searxng: {},
}

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

/** Resolve a request URL (relative or absolute) to the current API contract. */
export function resolveRequest(rawUrl, method = 'GET') {
  const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(String(rawUrl))
  const base = isAbsolute ? undefined : 'http://localhost'
  const url = new URL(String(rawUrl), base)
  const originalPath = url.pathname
  let path = normalizePath(originalPath)
  const component = componentFor(path)
  const aliases = PATH_ALIASES[component] || {}
  if (aliases[path]) path = aliases[path]
  const changed = path !== originalPath
  const suffix = `${path}${url.search}`
  return {
    component,
    originalPath,
    path,
    method: String(method || 'GET').toUpperCase(),
    changed,
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
    responseAliases: RESPONSE_ALIASES.map(({ id, component, method, path }) => ({ id, component, method, path })),
  }
}
