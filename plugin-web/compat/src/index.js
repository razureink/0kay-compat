/**
 * Browser bootstrap: wrap fetch/XHR so legacy API calls are translated to the
 * current contract in-place. Loaded once by the WebUI host via a
 * `target: "bootstrap"` UI patch.
 */
import { resolveRequest, adaptResponse, hasResponseAdapter, describeRules, CURRENT_API_VERSION } from '../../../shared/rules.js'

const STATE_KEY = '__0KAY_COMPAT__'

/** Install the interceptor. Idempotent. */
export function install(context = {}) {
  if (typeof window === 'undefined') return null
  const existing = window[STATE_KEY]
  if (existing && existing.installed) return existing

  const state = {
    installed: true,
    apiVersion: CURRENT_API_VERSION,
    context,
    installedAt: Date.now(),
    hits: [],
    rules: describeRules(),
    uninstall: null,
  }
  window[STATE_KEY] = state

  // --- fetch ---------------------------------------------------------------
  const nativeFetch = window.fetch ? window.fetch.bind(window) : null
  state.nativeFetch = nativeFetch
  if (nativeFetch) {
    window.fetch = async function compatFetch(input, init) {
      try {
        const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url
        const method = init?.method || (typeof input === 'object' && input?.method) || 'GET'
        const resolved = resolveRequest(raw, method)
        if (resolved.changed) {
          state.hits.push({ at: Date.now(), transport: 'fetch', from: resolved.originalPath, to: resolved.path, method: resolved.method })
          input = resolved.url
        }
        const response = await nativeFetch(input, init)
        if (hasResponseAdapter(resolved.path, resolved.method)) {
          const text = await response.clone().text()
          if (text) {
            try {
              const adapted = adaptResponse(resolved.path, resolved.method, JSON.parse(text))
              return new Response(JSON.stringify(adapted), { status: response.status, statusText: response.statusText, headers: response.headers })
            } catch { /* non-JSON or unparsable: leave untouched */ }
          }
        }
        return response
      } catch {
        return nativeFetch(input, init)
      }
    }
  }

  // --- XMLHttpRequest ------------------------------------------------------
  const nativeOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function compatOpen(method, url, ...rest) {
    try {
      const resolved = resolveRequest(String(url), method)
      if (resolved.changed) {
        state.hits.push({ at: Date.now(), transport: 'xhr', from: resolved.originalPath, to: resolved.path, method: resolved.method })
        url = resolved.url
      }
    } catch { /* fall back to the original URL */ }
    return nativeOpen.call(this, method, url, ...rest)
  }

  state.uninstall = () => {
    if (nativeFetch) window.fetch = nativeFetch
    XMLHttpRequest.prototype.open = nativeOpen
    state.installed = false
  }
  return state
}

export default install
