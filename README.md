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

- `PATH_ALIASES[component][oldPath] = currentPath` — **never** alias a path the
  current WebUI still calls; only remap once Core stops serving it.
- `RESPONSE_ALIASES` — add legacy keys to JSON responses without removing the
  current ones (e.g. re-derive `packages` on `/api/plugins/installed`).

Components covered: `core`, `webui`, `agent`, `life`, `mocr`, `searxng`.

## Install

```
0kay-pm install razureink/0kay-compat
```

## Proxy

```
COMPAT_PORT=8090 COMPAT_TARGET=http://127.0.0.1:8080 node server/index.mjs
```

- `GET /compat/health` — liveness + upstream
- `GET /compat/rules` — the active rule set (JSON)

## Browser introspection

After the WebUI loads, `window.__0KAY_COMPAT__` exposes `{ installed, hits, rules, uninstall }`.

## Adding a legacy mapping

1. Edit `shared/rules.js` (`PATH_ALIASES` or `RESPONSE_ALIASES`).
2. Rebuild: `npm --prefix plugin-web/compat run build` (or reinstall via 0kay-pm).
3. Reload the WebUI; the proxy picks it up on restart.

MIT licensed.
