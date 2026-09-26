/**
 * 0KAY compatibility proxy: exposes the legacy API surface on its own port and
 * forwards translated requests to the current Core (or another component base).
 *
 *   COMPAT_PORT    listen port            (default 8090)
 *   COMPAT_TARGET  upstream base URL      (default http://127.0.0.1:8080)
 *
 * External clients that still speak the old paths point at this port; the
 * browser plugin covers the WebUI itself. Legacy request aliases live in
 * ../shared/rules.js and include method/path/query/body rewrites.
 */
import http from 'node:http'
import { resolveRequest, adaptResponse, hasResponseAdapter, describeRules } from '../shared/rules.js'

const PORT = Number(process.env.COMPAT_PORT || 8090)
const TARGET = String(process.env.COMPAT_TARGET || 'http://127.0.0.1:8080').replace(/\/+$/, '')

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function sendJSON(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/compat/rules' || req.url === '/api/compat/rules') {
      return sendJSON(res, 200, describeRules())
    }
    if (req.url === '/compat/health') {
      return sendJSON(res, 200, { ok: true, target: TARGET, port: PORT })
    }

    const hasBodyMethod = req.method && !['GET', 'HEAD'].includes(req.method.toUpperCase())
    const rawBody = hasBodyMethod ? (await readBody(req)).toString('utf8') : undefined
    const resolved = resolveRequest(req.url, req.method, rawBody, { via: 'proxy' })
    const upstreamUrl = `${TARGET}${resolved.url}`

    const headers = { ...req.headers }
    delete headers.host
    delete headers['content-length']

    const init = { method: resolved.method, headers }
    if (resolved.dropBody) {
      if (['GET', 'HEAD'].includes(resolved.method.toUpperCase())) delete headers['content-type']
    } else if (resolved.bodyChanged) {
      init.body = JSON.stringify(resolved.body ?? {})
      headers['content-type'] = 'application/json'
    } else if (rawBody !== undefined) {
      init.body = rawBody
    }

    const upstream = await fetch(upstreamUrl, init)
    let buffer = Buffer.from(await upstream.arrayBuffer())
    const contentType = upstream.headers.get('content-type') || ''
    if (contentType.includes('application/json') && hasResponseAdapter(resolved.path, resolved.method)) {
      try {
        const adapted = adaptResponse(resolved.path, resolved.method, JSON.parse(buffer.toString('utf8')))
        buffer = Buffer.from(JSON.stringify(adapted), 'utf8')
      } catch { /* leave the original body */ }
    }

    const outHeaders = {}
    upstream.headers.forEach((value, key) => {
      if (key === 'content-length' || key === 'content-encoding' || key === 'transfer-encoding') return
      outHeaders[key] = value
    })
    outHeaders['x-0kay-compat'] = '1'
    res.writeHead(upstream.status, outHeaders)
    res.end(buffer)
  } catch (error) {
    sendJSON(res, 502, { error: error?.message || String(error) })
  }
})

server.listen(PORT, () => {
  console.log(`0kay-compat proxy listening on http://127.0.0.1:${PORT} -> ${TARGET}`)
})
