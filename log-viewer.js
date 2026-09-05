"use strict";
(async function(){
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  const status = document.getElementById("status");
  const chartDiv = document.getElementById("chart");
  const rawPre = document.getElementById("raw");
  if(!id){ status.textContent="No id — use ?id=abc from Share log URL"; return; }
  status.textContent="Fetching log " + id + "…";
  try{
    const res = await fetch("/api/logs/" + encodeURIComponent(id));
    if(!res.ok){ status.textContent="Not found: " + id; return; }
    const text = await res.text();
    status.textContent="Log " + id + " — " + text.split("\n").length + " lines";
    rawPre.textContent = text.slice(0, 4000);
    // Try to render via svg_export if available (loaded as global? fallback to pre)
    if(window.beeemuuSvg && window.beeemuuSvg.chartToSvg){
      // naive: treat CSV as single series
      const lines = text.split("\n").slice(1).filter(Boolean);
      const data = lines.map((l,i)=>{ const v=parseFloat(l.split(",")[0]); return {x:i, y:isFinite(v)?v:0}; });
      const svg = window.beeemuuSvg.chartToSvg({data:{datasets:[{label:id, data, borderColor:"#4da3ff"}]}});
      if(svg) chartDiv.innerHTML = svg;
    }
  }catch(e){ status.textContent="Error: "+e; }
})();
