# Receipt Audit Network

An open agentic website that publishes **one exact capability**: given a receipt's line items, it
returns the duplicate charges and the gap between the printed total and what the items actually add
up to. Every number is arithmetic on printed values. Nothing is guessed, and nothing is uploaded.

Built for the [Open Agentic Web Challenge](https://cognizant-agenticweb.devpost.com/) (Cognizant ×
MIT Media Lab NANDA × Mozilla Otari × AWS), following the
[Worldwide Agentic Web MVP profile](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md).

**Live site:** https://qq-exe.github.io/receipt-audit-network/

---

## Why a capability and not an app

A receipt audit is exact work: the answer is either right or wrong, and a language model has no
better claim on it than arithmetic does. So the useful thing to publish is the *check itself*, as a
typed capability another agent can call when it needs a number verified. The chat on the page is one
caller; another site's agent is another.

This is the difference between "an app that uses AI" and "a capability other agents can build on".

## The network

| | |
|---|---|
| Network name | `receipt_audit` |
| Front agent | `receipt_auditor` |
| Descriptor | [`agent-manifest.json`](agent-manifest.json) |
| Network definition | [`receipt_audit.network.json`](receipt_audit.network.json) |
| Runtime | [`runtime/`](runtime/) — the reference nsdeploy browser runtime, unmodified except where the challenge skill patches action support |
| Bridge | [`bridge/agent-manifest.json`](bridge/agent-manifest.json) — shares the audit with calling sites |

### Capabilities

| Tool | Effect | What it does |
|---|---|---|
| `audit_receipt` | `read` | The capability. Returns item sum, printed total, difference, duplicate lines and suspect overcharge. |
| `show_audit` | `write` | Same audit, rendered into the page's report panel so the visitor sees what ran. |
| `read_site` | `read` | What this site supports and refuses, so an agent does not promise a check that does not exist. |

All three run in the visitor's browser. There is no backend and no key on any server.

## Reproduce it

No install, no key for the arithmetic path.

1. Open the live site and press **Audit** — the built-in sample returns 5 lines, item sum 128.50,
   printed total 128.50, and a suspect overcharge of **18.50** from the duplicated line.
2. Open [`agent-manifest.json`](agent-manifest.json) — the descriptor a peer fetches to discover the
   network. It names one network, one front agent and three tools.
3. Open [`receipt_audit.network.json`](receipt_audit.network.json) — the resolved network the runtime
   executes.
4. Open [`bridge/agent-manifest.json`](bridge/agent-manifest.json) — what another agentic site gets
   when its agent calls this network: the shared `audit_receipt` read, and nothing about any visitor.
5. Run the checker against the live network:

   ```bash
   node scripts/check_partner.mjs https://qq-exe.github.io/receipt-audit-network/receipt_audit
   ```

   It reads the manifest, the network, `links.json` and the bridge over plain HTTP and reports whether
   other sites can call this network.

To run the site locally:

```bash
node server.mjs          # http://0.0.0.0:8090, sends Access-Control-Allow-Origin: *
```

A plain static server works too (`python -m http.server`), but this site ships a tiny Node server so
the public artefacts carry an explicit CORS header — the spec requires peers to be able to read them
across origins.

## What this site will not do

The audit is arithmetic on what is printed. It does **not**:

- estimate whether a unit price is fair or above market (that needs a price source it does not have)
- check tax, tip or discount rules the receipt does not print
- read a photo — it takes text or structured line items
- contact a merchant, file a dispute, or issue a refund
- store a receipt for later

Saying this plainly is part of the capability: an agent that knows the limits of what it called will
not promise a visitor something that does not exist.

## How the arithmetic works

`js/audit-core.js` has no dependencies and no model call:

1. Normalise item names, group identical ones. A group with more than one entry is a probable double
   scan — the later entries are the excess.
2. Sum the line amounts, compare against the printed total, report the difference.
3. If no total is printed, say so instead of computing one.

`js/app.js` exposes the same functions to the page's own buttons and to the agent tools, so the
visitor and the agent can never get different answers from the same input.

## Things worth recording

Short notes from building this, in case they help another entrant:

- **`.well-known/` needs `.nojekyll` on GitHub Pages.** Without it, Jekyll skips dot-directories and
  the discovery file never appears.
- **Static hosts differ on CORS.** GitHub Pages sends `Access-Control-Allow-Origin: *`; some hosts do
  not, and a peer's `fetch` then fails with an opaque error that looks like the site is down.
- **The bridge is what makes the network callable.** A site with no `bridge/bridge-actions.js` still
  answers chat, but a calling agent gets *no* tools — the build says so explicitly, and it is easy to
  miss.
- **Sharing a read is a design decision, not a default.** This site shares `audit_receipt` with `*`
  because it is a pure function over the caller's own arguments and returns nothing about any
  visitor. A site that reads its own data should name its callers instead.

## License

MIT. See [LICENSE](LICENSE).
