/**
 * Browser bootstrap: wrap fetch/XHR so legacy API calls are translated to the
 * current contract in-place. Loaded once by the WebUI host via a
 * `target: "bootstrap"` UI patch.
 */
import { resolveRequest, adaptResponse, hasResponseAdapter, describeRules, CURRENT_API_VERSION } from '../../../shared/rules.js'

const STATE_KEY = '__0KAY_COMPAT__'

/** Only rewrite same-origin (or relative) requests; never touch cross-origin. */
function shouldHandle(raw) {
  if (typeof raw !== 'string') return true
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return true
  try {
    return new URL(raw).origin === window.location.origin
  } catch {
    return false
  }
}

/** Build a fetch init from a resolved rewrite (method/path/body). */
function applyRewrite(init, nativeInput, resolved) {
  const next = { ...(init || {}) }
  next.method = resolved.method
  if (resolved.bodyChanged) {
    const headers = new Headers(next.headers || (typeof nativeInput === 'object' ? nativeInput?.headers : undefined) || undefined)
    if (resolved.dropBody) {
      delete next.body
      headers.delete('Content-Type')
    } else {
      next.body = JSON.stringify(resolved.body ?? {})
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    }
    next.headers = headers
  }
  return next
}

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
        if (!shouldHandle(raw)) return nativeFetch(input, init)
        const method = init?.method || (typeof input === 'object' && input?.method) || 'GET'
        const body = init?.body
        const resolved = resolveRequest(raw, method, body, { via: 'browser' })
        let nextInput = input
        let nextInit = init
        if (resolved.changed) {
          state.hits.push({
            at: Date.now(),
            transport: 'fetch',
            from: resolved.originalPath,
            to: resolved.path,
            method: resolved.method,
          })
          nextInput = resolved.url
          nextInit = applyRewrite(init, input, resolved)
        }
        const response = await nativeFetch(nextInput, nextInit)
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
  const nativeSend = XMLHttpRequest.prototype.send
  const nativeSetHeader = XMLHttpRequest.prototype.setRequestHeader
  const pending = new WeakMap()

  XMLHttpRequest.prototype.open = function compatOpen(method, url, ...rest) {
    pending.set(this, { method, url: String(url), rest, headers: {}, handled: shouldHandle(String(url)) })
    return nativeOpen.call(this, method, url, ...rest)
  }
  XMLHttpRequest.prototype.setRequestHeader = function compatSetHeader(name, value) {
    const entry = pending.get(this)
    if (entry && entry.handled) entry.headers[name] = value
    return nativeSetHeader.call(this, name, value)
  }
  XMLHttpRequest.prototype.send = function compatSend(body) {
    const entry = pending.get(this)
    if (!entry || !entry.handled) return nativeSend.call(this, body)
    try {
      const resolved = resolveRequest(entry.url, entry.method, body, { via: 'browser' })
      if (resolved.changed) {
        state.hits.push({
          at: Date.now(),
          transport: 'xhr',
          from: resolved.originalPath,
          to: resolved.path,
          method: resolved.method,
        })
        // Re-open with the rewritten method/URL and replay recorded headers.
        nativeOpen.call(this, resolved.method, resolved.url, ...entry.rest)
        for (const [name, value] of Object.entries(entry.headers)) nativeSetHeader.call(this, name, value)
        if (resolved.dropBody) body = null
        else if (resolved.bodyChanged) {
          body = JSON.stringify(resolved.body ?? {})
          if (!Object.keys(entry.headers).some((k) => k.toLowerCase() === 'content-type')) {
            nativeSetHeader.call(this, 'Content-Type', 'application/json')
          }
        }
      }
    } catch { /* fall back to the original request */ }
    return nativeSend.call(this, body)
  }

  state.uninstall = () => {
    if (nativeFetch) window.fetch = nativeFetch
    XMLHttpRequest.prototype.open = nativeOpen
    XMLHttpRequest.prototype.send = nativeSend
    XMLHttpRequest.prototype.setRequestHeader = nativeSetHeader
    state.installed = false
  }
  return state
}

export default install
