# Plan: reconcile `beemuu-plugins` with the in-app plugin runtime

## Summary

[`beemuu-plugins`](https://github.com/ohgeeceee/beemuu-plugins) (the
marketplace repo at `plugins.beemuu.com`) publishes plugins against a rich
host-capability API described in
[`PLUGIN_FORMAT.md`](https://github.com/ohgeeceee/beemuu-plugins/blob/main/PLUGIN_FORMAT.md):
`context.vehicle.readVin()/readDtc()/clearDtc()/subscribeLive()`,
`context.fs.writeFile()`, `context.ui.registerPanel()/notify()`, and a
declared `capabilities` array (`read-vin`, `read-dtc`, `clear-dtc`,
`live-data`, `filesystem`, `network`, plus reserved `coding-write` /
`ecu-flash`).

The runtime actually shipped in this repo (`src/js/plugins.js`,
`src/js/plugin_runner.js`, registry at `src/plugins/registry/`) is
intentionally much narrower: a plugin is either a `data` pack (static
articles / live-data profile TOML) or a `tool` — a pure JS function executed
in a sandboxed Web Worker with a 2-second timeout, JSON-in/JSON-out only, and
**zero host permissions** (`validate()` rejects any non-empty `permissions`
array; see the comment in `src/js/plugins.js`).

Net effect: the 3 "official" plugins already published on `beemuu-plugins`
(DTC Report PDF, Live Data Logger, VIN Decoder Plus) reference host APIs that
do not exist in the app today and cannot run.

## Decision

`beemuu-plugins`' capability model is the **target architecture**. This doc
tracks extending the in-app runtime to actually support it, rather than
scaling the marketplace spec back down to the sandboxed worker model.

## Proposed phased approach

1. **Design the capability bridge.** Add a new plugin `kind` (e.g. `"host"`,
   or a new `schemaVersion`) alongside the existing sandboxed `data`/`tool`
   kinds, which stay exactly as-is for backward compatibility. A
   host-capability plugin runs in a restricted context (iframe or worker)
   that can only reach a small RPC surface proxied by the app shell — never
   direct Tauri IPC — gated per-call by the plugin's declared `capabilities`.
2. **Capability enforcement.** Each declared capability
   (`read-vin`/`read-dtc`/`clear-dtc`/`live-data`/`filesystem`/`network`) maps
   to exactly one narrow host-side function. Undeclared calls must be
   rejected before they reach vehicle/comms code, consistent with this
   repo's existing rule that "plugins never talk to the transport directly."
3. **Reserved capabilities.** `coding-write` and `ecu-flash` require manual
   maintainer review before an install is allowed, matching
   `beemuu-plugins/CONTRIBUTING.md`.
4. **Filesystem scope.** `context.fs` must be sandboxed to a per-plugin
   directory (not arbitrary disk access) — needs an explicit storage-quota
   and path-scoping design.
5. **UI surface.** `context.ui.registerPanel()` needs a real panel host
   (mount point + lifecycle) in the frontend; `notify()` maps to the existing
   toast/dialog helpers.
6. **Manifest alignment.** Reconcile `manifest.schema.json` (marketplace
   metadata: download URL/sha256/category/tags) with the in-app package
   schema (`schemaVersion`, `id`, `kind`, `permissions`, `code`/`files`) so a
   single package format satisfies both repos.
7. **Registry bridge.** Decide whether `backend/plugins_registry.py` starts
   reading marketplace manifests directly, or whether `beemuu-plugins`
   registry entries get mirrored/validated into `src/plugins/registry/`.
8. **Security review.** Threat-model the new bridge before enabling it by
   default. Written up in "Threat model" below.
9. **Migration.** Existing v1/v2 `data`/`tool` packages must keep working
   unchanged throughout.

## Threat model

Written for the read-only bridge (`plugin_capabilities.js` + `plugin_host.js` +
`plugin_bridge.js`). Enabling anything beyond read-only re-opens this.

**Assets.** Vehicle data only: the VIN, fault memory (codes, status, freeze
frames), and live parameter series. There is no disk access, no network, and no
ECU write in the granted set, so the worst case is *disclosure of vehicle data*
rather than damage to the car.

**Trust boundaries.**

| Component | Trust | Holds |
|---|---|---|
| Plugin code (Worker, blob URL) | untrusted | the `context` object generated for it |
| Runner frame (opaque origin, `default-src 'none'`, `connect-src 'none'`) | ours, but assumed compromised | a capability-gated surface, no Tauri IPC, no host object |
| App shell | trusted | app state, the capability table, the host object |

**What each attack gets, and what stops it.**

1. *Ask for a method you never declared.* The frame's surface is built by
   `createBridge()` from the capabilities the **app** put on the run message.
   The proxy throws on any other known host method and records the attempt, so
   the call never reaches app code.
2. *Lie about your capabilities in the run message.* The app re-derives them
   from the installed package it is running and ignores the frame's copy. Two
   independent gates, neither advisory.
3. *Mutate what you were handed.* `plugin_host` deep-copies each DTC and freeze
   frame and drops unknown internal fields, so holding a returned array cannot
   reach app state.
4. *Exhaust the app by asking for everything.* Payload caps: 200 DTCs, 40
   series, 600 points per series, 64 KiB per answer, 32 KiB of tool input.
5. *Smuggle behaviour across the wire.* Every value crossing is JSON-cloned; a
   function, a cyclic object or anything over the cap becomes an error reply,
   never a send.
6. *Speak to the app from a page that is not the runner.* The app accepts host
   calls only from the current run's `frame.contentWindow` with
   `event.origin === "null"`, and only while that run is live.
7. *Occupy the app indefinitely.* The existing budgets bound the run — 2 s in
   the worker, 5 s for the frame — and RPC shares that budget instead of
   extending it.
8. *Subscribe and never release.* The frame owns the subscription table and
   releases every outstanding subscription when the run ends, so a plugin that
   forgets its unsubscribe cannot keep receiving after it is gone.
9. *Treat "no VIN" as a VIN.* `readVin` returns a validated 17-character VIN or
   `null` — never a placeholder — so a plugin cannot mistake an unavailable read
   for a real value.

**Residual risk, stated plainly.** A plugin with `read-dtc` + `live-data` can
build a detailed profile of one vehicle while it is connected. It cannot send
that anywhere by itself — there is no `network` capability and the frame's CSP
denies `connect-src` — but a user can copy whatever the plugin renders. The
plugin's own output is also plugin-authored: the UI must present it as such, and
never re-publish it as an app finding. That is acceptable for read-only data and
is exactly why `clear-dtc`, `coding-write`, `ecu-flash`, `filesystem`, `network`
and `ui` stay refused until a maintainer reviews them individually.

## Open questions

- Should host-capability plugins run in a separate execution context from
  sandboxed tools, or can the existing worker bridge be extended safely?
- What's the update/consent UX when a plugin's declared capabilities change
  between versions?
- Should `filesystem` writes go through the existing `tauri-plugin-dialog`
  confirmation pattern used elsewhere for write paths?

## References

- Target spec: `beemuu-plugins/PLUGIN_FORMAT.md`
- Target schema: `beemuu-plugins/manifest.schema.json`
- Current runtime: `src/js/plugins.js`, `src/js/plugin_runner.js`,
  `src/js/plugins_ui.js`
- Current registry: `backend/plugins_registry.py`, `src/plugins/registry/`
- Roadmap context: "Plugin ecosystem (Phase 1 of VISION.md)" in `ROADMAP.md`
