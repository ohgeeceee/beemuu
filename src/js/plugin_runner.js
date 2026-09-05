/* Trusted bridge in a sandbox="allow-scripts" frame. No Tauri API bridge. */
"use strict";
(() => {
  let started = false;
  window.addEventListener("message", (event) => {
    if (event.source !== parent || started || event.data?.type !== "beemuu:run") return;
    started = true;
    const { code, input } = event.data;
    if (typeof code !== "string" || code.length > 120000 || typeof input !== "string" || input.length > 32000) return;
    let worker;
    let url;
    let timer;
    let done = false;
    const finish = (result, error = false) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker?.terminate();
      if (url) URL.revokeObjectURL(url);
      parent.postMessage({ type: "beemuu:result", result, error }, "*");
    };
    try {
      // Serialize input as a string literal; plugin code has only Worker globals.
      const source = `"use strict";\nconst sendResult = self.postMessage.bind(self);\nPromise.resolve((async (input) => {\n${code}\n})(JSON.parse(${JSON.stringify(input)}))).then(value => {\n const text = JSON.stringify(value === undefined ? null : value, null, 2);\n const large = new TextEncoder().encode(text).length > 64000;\n sendResult({result: large ? 'Result exceeds 64 KiB.' : text, error: large});\n}).catch(() => sendResult({result: 'Plugin execution failed.', error: true}));`;
      url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      worker = new Worker(url);
      timer = setTimeout(() => finish("Plugin exceeded the 2 second execution limit.", true), 2000);
      worker.onmessage = ({ data }) => {
        if (typeof data?.result !== "string" || new TextEncoder().encode(data.result).length > 64000) return finish("Invalid or oversized plugin result.", true);
        finish(data.result, data.error === true);
      };
      worker.onerror = (e) => { e.preventDefault(); finish("Plugin execution failed. Check its JavaScript code.", true); };
    } catch (_) { finish("Plugin runner could not start on this system.", true); }
  });
  parent.postMessage({ type: "beemuu:ready" }, "*");
})();
