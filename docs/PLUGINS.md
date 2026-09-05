# Community plugins (package API 1)

The desktop **Plugins** tab supports install, explicit replacement, enable,
disable, removal, export, and local package import. The bundled catalog works
offline. Packages are stored in this webview's local storage; clearing webview
data may remove them. Export packages to keep a copy. Installation and replacement
leave a package disabled. No tool runs at startup.

## Author and publish

1. In Plugins → Discover, download either authoring example. Examples also live
   in `src/plugins/catalog.json`.
2. Choose a unique namespaced `id`, such as `yourname.log-summary`. Fill in
   `name`, `author`, `description`, `license`, and a numeric `major.minor.patch`
   version. Keep `schemaVersion: 1` and `permissions: []`.
3. Edit the data or JavaScript, import the JSON, review its identity, install,
   enable, and test it. Export the resulting `.beemuu-plugin.json` package.
4. Publish that file in a release of your own repository. Users download and
   import it. This does not require inclusion in the bundled catalog.
5. For discovery in future Beemuu builds, submit a pull request to
   [ohgeeceee/beemuu](https://github.com/ohgeeceee/beemuu) adding your package to
   `src/plugins/catalog.json`. Include source provenance, license, supported
   vehicles if applicable, and test results. Run
   `node --test src/js/plugins.test.js` before submitting.

Catalog inclusion follows normal PR review and CI. API 1 has no hosted upload
service, automatic updates, publisher verification, or package signatures.
Author names are self-declared. Replacing an ID replaces the entire installed
package, including code; inspect changes before installing.
Limits: 256 KiB per package, 20 installed packages, 2 MiB serialized storage.

## Data packs

Set `kind: "data"` and provide `content.articles`, an array of up to 100 objects
with `title` and `body` strings. Text is displayed literally, never as HTML.
Optionally add `content.profilesToml`, containing the existing
[community profile format](../community/README.md). Articles may be empty if
the pack contains profiles. Unknown fields are rejected.

Users explicitly import profiles for the current session. Rust validates them
through the existing `import_profiles` command and the Live Data selectors
refresh. Matching profile IDs may be replaced. Packages do not auto-activate
vehicle reads. Disable/remove affects the package, not already imported runtime
profiles; restart to clear those profiles. Articles display inside Plugins,
not the core DTC database. Follow existing contributor validation for vehicles.

## Executable tools

Set `kind: "tool"`, provide JSON `exampleInput`, and put an async JavaScript
function **body** in `code`. The function receives `input` and returns JSON:

```javascript
return { fahrenheit: input.celsius.map(c => c * 9 / 5 + 32) };
```

Users edit input JSON and click Run. Input is limited to 32 KiB, output to 64 KiB.
Each invocation gets a fresh worker with a two-second execution timer and a
separate five-second host watchdog. Stop, disable, remove, replacement, or leaving
Plugins destroys the runner. Results and source are plain text. Custom HTML
dashboards are not part of this API.

The worker is created by a trusted runner in an opaque-origin iframe with only
`sandbox="allow-scripts"`. No same-origin, popup, form, top-navigation, or download
exceptions are granted. Runner CSP blocks connections, frames, images, and objects.
The host accepts messages only from that frame with an opaque origin. There is
no message-to-Tauri forwarding and no automatic transfer of VINs, fault records,
files, or live data. See [MDN sandbox documentation](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox).

This is a browser worker boundary, not operating-system resource isolation.
Timers cannot guarantee a memory ceiling. Install code from sources you trust.
Hardware commands, custom UI, native libraries, external dependencies, and network
permissions require a future API design and review.

## Browser regression checks

`scripts/test-plugins-browser.cjs` serves the real plugin manager and runner with
the shipping CSP. CI installs pinned Playwright and Chromium and runs it. Locally,
install Playwright and its Chromium browser, then run the script with Node. Set
`PLUGIN_TEST_BROWSER=msedge` to use installed Edge instead. It checks persistence,
replacement, execution, network denial, absence of host globals, timeout, literal
rendering, and the profile-import bridge. Native Tauri/real-car validation remains
separate; browser tests do not exercise vehicle hardware.
