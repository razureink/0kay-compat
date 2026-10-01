# 0KAY API Compatibility Layer

A 0KAY plugin that keeps **older API clients working** as the platform's HTTP
API evolves. It translates legacy calls into the current contract in two places:

| Surface | What it does | How it loads |
|---|---|---|
| **WebUI** | Wraps `fetch` / `XMLHttpRequest` globally so legacy calls made by old front-end bundles are rewritten in place. | `target: "bootstrap"` UI patch (`core/data/ui/compat.patch`) |
| **External clients** | Runs an HTTP proxy on its own port that rewrites and forwards requests to Core. | `start: ["node", "server/index.mjs"]` |

Both share the same rule engine in `shared/rules.js`.

## Rules

Generic policies (always active, every component):

```
/api/v1/<x>            -> /api/<x>
/plugin/<name>/ui/<x>  -> /api/plugins/<name>/ui/<x>
//a//b/                -> /a/b
```

Per-component and additive response aliases live in `shared/rules.js`:

- `REQUEST_ALIASES` — exact `METHOD path` rewrites that can also move a
  query/body field into the path, change the method, or drop the body.
- `PATH_ALIASES[component][oldPath] = currentPath` — simple path-only remaps;
  **never** alias a path the current WebUI still calls.
- `RESPONSE_ALIASES` — add legacy keys to JSON responses without removing the
  current ones (e.g. re-derive `packages` on `/api/plugins/installed`).

### Legacy request mappings

| Legacy | Current |
|---|---|
| `POST /api/plugins/enable\|disable {plugin}` | `PATCH /api/plugins/{plugin} {enabled}` |
| `DELETE /api/providers/delete?id=` | `DELETE /api/providers/{id}` |
| `DELETE /api/skills?name=` | `DELETE /api/skills/{name...}` |
| `DELETE /api/live2d?id=` | `DELETE /api/live2d/{path...}` |
| `POST /api/usage/clear` | `DELETE /api/usage` |
| `POST /api/tasks/cancel {task_id}` | `POST /api/tasks/{task_id}/cancel` |
| `PATCH\|DELETE /api/agent/sessions {session_id}` | `PATCH\|DELETE /api/agent/sessions/{session_id}` |
| `POST /api/mocr/generate` | `POST /api/chat` |
| `GET /api/life/state` | `GET /api/state` |
| `GET /api/providers` (plaintext key)* | `GET /api/providers/credentials` |

`*` The last rule is `scope: "proxy"` — it applies only to the external proxy so
the live WebUI keeps the redacted `/api/providers` shape. Current Core restricts
`GET /api/providers/credentials` to **machine callers** (a plugin identity or a
paired-device / `CORE_API_TOKEN` bearer), so the proxy forwards a Core token for
this alias when the legacy client does not supply one — see `COMPAT_CORE_TOKEN`.

Components covered: `core`, `webui`, `agent`, `life`, `mocr`, `searxng`.

## Install

```
0kay-pm install razureink/0kay-compat
```

## Proxy

```
COMPAT_PORT=8090 COMPAT_TARGET=http://127.0.0.1:8080 node server/index.mjs
```

| Variable | Default | Purpose |
|---|---|---|
| `COMPAT_PORT` | `8090` | Listen port of the external proxy |
| `COMPAT_TARGET` | `http://127.0.0.1:8080` | Core (or component) base URL to forward to |
| `COMPAT_CORE_TOKEN` | `CORE_PAIR_TOKEN` / `CORE_API_TOKEN` | Machine token attached to the `GET /api/providers` → `/api/providers/credentials` alias so legacy plaintext exports keep working |

- `GET /compat/health` — liveness + upstream
- `GET /compat/rules` — the active rule set (JSON)

If no `COMPAT_CORE_TOKEN` (or `CORE_PAIR_TOKEN` / `CORE_API_TOKEN`) is available
and the legacy client sends no `Authorization`, current Core answers the
credentials alias with `403 machine_credential_required`; the proxy forwards that
status unchanged.

## Browser introspection

After the WebUI loads, `window.__0KAY_COMPAT__` exposes `{ installed, hits, rules, uninstall }`.

## Adding a legacy mapping

1. Edit `shared/rules.js` (`REQUEST_ALIASES`, `PATH_ALIASES` or `RESPONSE_ALIASES`).
2. Rebuild: `npm --prefix plugin-web/compat run build` (or reinstall via 0kay-pm).
3. Reload the WebUI; the proxy picks it up on restart.

MIT licensed.
