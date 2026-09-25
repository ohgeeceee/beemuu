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
8. **Security review.** Threat-model the new bridge (a compromised or
   malicious plugin with `network` + `read-dtc`, for example, could
   exfiltrate vehicle data) before enabling it by default.
9. **Migration.** Existing v1/v2 `data`/`tool` packages must keep working
   unchanged throughout.

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
