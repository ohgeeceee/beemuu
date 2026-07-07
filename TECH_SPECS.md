# BeeEmUu — Technical Specification: 14 Unique Features

*Version 1.0 — 2026-07-06*
*Status: Design-complete, ready for implementation planning*

---

## Table of Contents

1. [Community Oracle](#1-community-oracle)
2. [Diagnostic Story Mode](#2-diagnostic-story-mode)
3. [Tuning Fingerprint Detector](#3-tuning-fingerprint-detector)
4. [Ghost Mode](#4-ghost-mode)
5. [Adaptation Drift Tracker](#5-adaptation-drift-tracker)
6. [Misfire Pattern Recognition](#6-misfire-pattern-recognition)
7. [Parameter Hunt (Gamified)](#7-parameter-hunt-gamified)
8. [Virtual Second Opinion](#8-virtual-second-opinion)
9. [Dyno Mode](#9-dyno-mode)
10. [Predictive CBS Timeline](#10-predictive-cbs-timeline)
11. [Wiring Detective](#11-wiring-detective)
12. [Cold Start Auto-Logger](#12-cold-start-auto-logger)
13. [Secure Snapshot Share](#13-secure-snapshot-share)
14. [Flash Counter & History Auditor](#14-flash-counter--history-auditor)

Appendices:
- [A. Shared Infrastructure Changes](#appendix-a-shared-infrastructure-changes)
- [B. Dependency & Crate Additions](#appendix-b-dependency--crate-additions)
- [C. File Inventory](#appendix-c-file-inventory)

---

## Conventions

| Term | Meaning |
|------|---------|
| `BE` | Big-endian |
| `DID` | Data Identifier (UDS service 0x22) |
| `DTC` | Diagnostic Trouble Code |
| `ECU` | Electronic Control Unit |
| `KWP` | Keyword Protocol 2000 |
| `OBD` | On-Board Diagnostics |
| `UDS` | Unified Diagnostic Services |
| `Tauri command` | Rust function exposed to the frontend via `#[tauri::command]` |
| `invoke` | Frontend call to a Tauri command |

**Existing architectural anchors referenced throughout:**
- `Transport` trait: `src-tauri/src/transport/mod.rs:41`
- `RecordingTransport`: `src-tauri/src/transport/record.rs:82`
- `AppState`: `src-tauri/src/commands.rs:22`
- `SessionSnapshot`: `src-tauri/src/commands.rs:764`
- `LiveValue` / `LiveParam`: `src-tauri/src/data/live.rs:78`
- `ByteWatcher`: `src-tauri/src/analysis.rs:13`
- `LogSession` / `LogSeries`: `src/js/main.js:874`
- `logChart` (Chart.js instance): `src/js/main.js:829`
- Community TOML loading: `src-tauri/src/community.rs`

---

## 1. Community Oracle

### 1.1 Overview
An opt-in, anonymized DTC pattern-matching engine. When a user scans faults, BeeEmUu hashes the DTC set + freeze-frame signature and queries a community knowledge base to surface resolution statistics: prevalence, common fixes, part numbers, and cost estimates.

### 1.2 Why Unique
- ISTA/D is dealer-only with no community layer.
- Carly/BimmerLink are siloed commercial apps.
- Forum knowledge (E90Post, Bimmerpost) is unstructured and not queryable at scan-time.
- BeeEmUu's community-first governance is the only credible foundation for this.

### 1.3 Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│  Rust Backend   │────▶│  Knowledge Base │
│  (Vehicle Test) │◀────│  (Fingerprint + │◀────│  (JSON/HTTP or  │
│                 │     │   Query Engine) │     │   bundled DB)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### 1.4 Data Model

**Fingerprint** (`src-tauri/src/oracle.rs` — new file)
```rust
/// A privacy-preserving hash of the diagnostic picture.
/// No VIN, no mileage, no PII.
#[derive(Serialize)]
pub struct DtcFingerprint {
    /// Hash of: sorted DTC codes + engine profile + ECU ident hash
    pub hash: String,
    /// Human-readable key for display
    pub engine_family: String,  // e.g. "n55", "b58", "n54"
    pub dtc_count: usize,
    pub dtcs: Vec<String>,      // sorted codes
}

/// One community contribution to a pattern.
#[derive(Serialize, Deserialize, Clone)]
pub struct PatternOutcome {
    pub fix_category: String,   // e.g. "replaced_hpfp", "smoke_test_intake"
    pub part_numbers: Vec<String>,
    pub cost_estimate_usd: Option<u32>,
    pub confidence: u8,         // 0-100, based on contributor count
    pub source: String,         // "community" | "forum_aggregate"
}

/// Result returned to the frontend.
#[derive(Serialize)]
pub struct OracleResult {
    pub match_count: usize,
    pub exact_matches: usize,   // same DTC set, same engine
    pub outcomes: Vec<PatternOutcome>,
    pub top_forum_threads: Vec<ForumLink>,
}

#[derive(Serialize)]
pub struct ForumLink {
    pub title: String,
    pub url: String,
    pub relevance_score: f32,
}
```

### 1.5 Backend Implementation

**New file: `src-tauri/src/oracle.rs`**

```rust
use sha2::{Sha256, Digest};

pub fn fingerprint(dtcs: &[crate::protocol::Dtc], engine_profile: &str) -> DtcFingerprint {
    let mut codes: Vec<String> = dtcs.iter().map(|d| d.code.clone()).collect();
    codes.sort();
    let canonical = format!("{}:{}", engine_profile, codes.join(","));
    let hash = format!("{:x}", Sha256::digest(canonical.as_bytes()))[..16].to_string();
    DtcFingerprint {
        hash,
        engine_family: engine_profile.to_string(),
        dtc_count: dtcs.len(),
        dtcs: codes,
    }
}
```

**Knowledge Base Sources (tiered fallback):**

| Tier | Source | Latency | Privacy |
|------|--------|---------|---------|
| 1 | Bundled quarterly snapshot (`community/oracle_snapshot.json`) | 0 ms | 100% offline |
| 2 | Community API (opt-in, anonymous POST/GET) | ~200 ms | Hash only, no VIN |
| 3 | Forum scraper (future, read-only) | N/A | N/A |

**Tauri command addition in `commands.rs`:**
```rust
#[tauri::command]
pub fn query_oracle(
    state: tauri::State<'_, AppState>,
    address: u8,
) -> Result<oracle::OracleResult, String> {
    let dtcs = with_transport(&state, |t| protocol::read_dtcs(t, address))?;
    let profile = "n55"; // TODO: derive from VIN decode or user selection
    let fp = oracle::fingerprint(&dtcs, profile);
    oracle::query(&fp)
}
```

### 1.6 Frontend Implementation

**UI placement:** New panel inside the Vehicle Test detail view, below the fault table.

**`src/index.html` addition** (inside `#view-vehicle > .detail-panel`, after `#freeze-panel`):
```html
<div id="oracle-panel" class="oracle-panel hidden">
  <div class="oracle-head">Community Oracle</div>
  <div id="oracle-body" class="oracle-body">
    <span class="muted">Select a control unit with faults to see community insights.</span>
  </div>
</div>
```

**`src/js/main.js` — `selectModule()` extension:**
After `readFaults()`, call `loadOracle(address)`.

```javascript
async function loadOracle(address) {
  const panel = $("oracle-panel");
  const body = $("oracle-body");
  const m = modules.find((x) => x.address === address);
  if (!m || !m.fault_count) { panel.classList.add("hidden"); return; }
  panel.classList.remove("hidden");
  body.innerHTML = "<span class='muted'>Querying community knowledge base…</span>";
  try {
    const result = await invoke("query_oracle", { address });
    renderOracle(result);
  } catch (e) {
    body.innerHTML = `<span class='muted'>Oracle offline: ${e}</span>`;
  }
}

function renderOracle(result) {
  const body = $("oracle-body");
  let html = `<div class="oracle-stats">${result.match_count} similar cases · ${result.exact_matches} exact matches</div>`;
  html += '<div class="oracle-outcomes">';
  for (const o of result.outcomes) {
    html += `<div class="oracle-fix">
      <div class="fix-cat">${o.fix_category}</div>
      <div class="fix-meta">Confidence: ${o.confidence}% · ${o.cost_estimate_usd ? '$'+o.cost_estimate_usd : 'cost unknown'}</div>
      ${o.part_numbers.length ? `<div class="fix-parts">Parts: ${o.part_numbers.join(', ')}</div>` : ''}
    </div>`;
  }
  html += '</div>';
  body.innerHTML = html;
}
```

### 1.7 Privacy Design
- **No VIN transmitted.** Fingerprint is derived from DTC codes + engine family only.
- **Opt-in via settings.** Default is bundled offline snapshot only.
- **Contribution is explicit.** User must click "Contribute my fix" after resolving an issue.

### 1.8 Implementation Phases
| Phase | Work | Effort |
|-------|------|--------|
| 1 | `fingerprint()` + bundled JSON snapshot + frontend panel | 2 days |
| 2 | Community API endpoint (simple HTTP POST/GET) | 2 days |
| 3 | Contribution flow ("I fixed this by…") | 1 day |

---

## 2. Diagnostic Story Mode

### 2.1 Overview
One-click generation of a human-readable diagnostic narrative from any `SessionSnapshot`. Reads like a master technician's report, synthesizing DTCs, freeze frames, vehicle info, and engine-specific knowledge into actionable advice.

### 2.2 Why Unique
- ISTA provides flowcharts, not narratives.
- Every other tool shows raw codes and expects the user to Google.
- No BMW diagnostic tool integrates LLM or rule-based synthesis with live vehicle data.

### 2.3 Architecture

```
SessionSnapshot JSON ──▶ Story Engine ──▶ Markdown Narrative ──▶ PDF / Copy
     │                       │
     └─▶ DTC texts           └─▶ Rule-based templates (v1)
     └─> Freeze frames       └─▶ Local LLM (v2, optional)
     └─> VIN decode
     └─> Engine knowledge base
```

### 2.4 Data Model

**New file: `src-tauri/src/story.rs`**

```rust
/// Input: everything the story engine needs.
pub struct StoryInput {
    pub vehicle: commands::VehicleInfo,
    pub modules: Vec<commands::SessionModule>,
    pub engine_family: String,  // "n55", "b58", etc.
}

/// Output: structured narrative sections.
#[derive(Serialize)]
pub struct Story {
    pub title: String,
    pub summary: String,
    pub vehicle_summary: String,
    pub findings: Vec<Finding>,
    pub recommendations: Vec<Recommendation>,
    pub severity: Severity,
    pub estimated_cost_range: Option<(u32, u32)>,
}

#[derive(Serialize)]
pub struct Finding {
    pub dtc_code: String,
    pub dtc_text: String,
    pub context: String,        // freeze frame summary
    pub n55_commonality: Option<String>,  // engine-specific note
}

#[derive(Serialize)]
pub struct Recommendation {
    pub priority: u8,           // 1 = do first
    pub action: String,
    pub rationale: String,
    pub diy_difficulty: String, // "easy" | "moderate" | "advanced"
    pub estimated_cost: Option<String>,
}

#[derive(Serialize)]
pub enum Severity {
    Info, Warning, Critical,
}
```

### 2.5 Backend Implementation

**Rule-based engine (v1 — offline, deterministic):**

```rust
// story.rs
pub fn generate(input: &StoryInput) -> Story {
    let mut findings = Vec::new();
    let mut recs = Vec::new();

    for m in &input.modules {
        for dtc in &m.dtcs {
            let finding = analyze_dtc(&dtc.code, &input.engine_family, &dtc.freeze_frame);
            findings.push(finding);
        }
    }

    // Sort by severity
    findings.sort_by_key(|f| f.severity);

    Story {
        title: format!("Diagnostic Report for {} {}", 
            input.vehicle.decode.as_ref().map(|d| d.model.clone()).unwrap_or_default(),
            input.vehicle.vin.as_ref().map(|v| &v[..6]).unwrap_or("")),
        summary: generate_summary(&findings),
        vehicle_summary: format_vehicle(&input.vehicle),
        findings,
        recommendations: generate_recommendations(&findings, &input.engine_family),
        severity: max_severity(&findings),
        estimated_cost_range: estimate_cost(&findings),
    }
}
```

**Knowledge base format** (`community/stories/<engine>.toml`):
```toml
[[dtc_story]]
code = "29E0"
template = "Mixture too lean. On the {engine}, this is most commonly caused by a vacuum leak at the charge pipe elbow or valve cover gasket. Check fuel trims under load."
severity = "warning"
diy = "moderate"
first_check = "Smoke test the intake tract"

[[dtc_story]]
code = "2A82"
template = "VANOS intake control fault. On {engine}, the solenoid can be removed and cleaned in 20 minutes before replacing."
severity = "warning"
diy = "easy"
first_check = "Remove and clean VANOS solenoid"
```

**Tauri command in `commands.rs`:**
```rust
#[tauri::command]
pub fn generate_story(snapshot: commands::SessionSnapshot) -> Result<story::Story, String> {
    let engine_family = snapshot.vehicle_info
        .as_ref()
        .and_then(|v| v.suggested_profile.clone())
        .unwrap_or_else(|| "generic".into());
    let input = story::StoryInput {
        vehicle: /* ... */,
        modules: snapshot.modules,
        engine_family,
    };
    Ok(story::generate(&input))
}
```

### 2.6 Frontend Implementation

**UI placement:** New button on the Snapshots tab and Vehicle Info tab: "Generate Story".

**`src/index.html` addition** (in `#view-snapshots`):
```html
<button id="btn-story-generate" class="btn btn-small">Generate Story</button>
```

**`src/js/main.js`:**
```javascript
async function generateStory() {
  const snapshot = /* get current snapshot */;
  try {
    const story = await invoke("generate_story", { snapshot });
    renderStory(story);
  } catch (e) {
    log("Story generation failed: " + e);
  }
}

function renderStory(story) {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal story-modal">
      <div class="modal-head">${story.title}</div>
      <div class="modal-body">
        <div class="story-severity story-severity-${story.severity.toLowerCase()}">${story.severity}</div>
        <p class="story-summary">${story.summary}</p>
        <h4>Findings</h4>
        ${story.findings.map(f => `
          <div class="story-finding">
            <code>${f.dtc_code}</code> — ${f.dtc_text}
            <p class="story-context">${f.context}</p>
          </div>
        `).join('')}
        <h4>Recommendations</h4>
        <ol>
          ${story.recommendations.map(r => `
            <li><strong>${r.action}</strong> (${r.diy_difficulty})
              <br><span class="muted">${r.rationale}</span></li>
          `).join('')}
        </ol>
      </div>
      <div class="modal-actions">
        <button class="btn" onclick="copyStory()">Copy</button>
        <button class="btn btn-primary" onclick="exportStoryPdf()">Export PDF</button>
        <button class="btn" onclick="this.closest('.modal-overlay').remove()">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}
```

### 2.7 Implementation Phases
| Phase | Work | Effort |
|-------|------|--------|
| 1 | Rule-based template engine + TOML knowledge base | 3 days |
| 2 | Frontend modal + export (Markdown/clipboard) | 1 day |
| 3 | Optional: local LLM integration (Phi-3 via llama.cpp) | 3 days |

---

## 3. Tuning Fingerprint Detector

### 3.1 Overview
Forensic analysis that compares live data distributions against known-stock baselines to detect if a vehicle has been tuned — even if the tuner attempted to hide it.

### 3.2 Why Unique
- Tuning platforms (MHD, Bootmod3) don't expose this.
- Dealer tools (ISTA) detect flash counters but not behavioral signatures.
- No open-source tool has a stock-baseline fingerprint library.

### 3.3 Detectable Signatures

| Parameter | Stock Baseline | Tuned Signature |
|-----------|---------------|-----------------|
| Boost request vs. actual | Request ≈ actual, smooth ramp | Request > actual (boost leak) or overshoot (aggressive tune) |
| Fuel trims under load | ±3% at WOT | +5-8% (lean tune) or -5% (rich tune) |
| Ignition timing @ 4000 RPM / 80% load | N55: ~15-18° | Stage 1: ~12-14° (retarded for knock margin) |
| Throttle plate vs. pedal | Linear, ~1:1 | Non-linear (pedal remapping) |
| Lambda response speed | ~200ms settle | Faster (catless) or oscillating (rich tune) |
| Rail pressure @ idle | N55: ~5 MPa | Higher (larger injector scaling) |

### 3.4 Data Model

**New file: `src-tauri/src/tuning_detect.rs`**

```rust
/// A statistical distribution snapshot from a confirmed-stock vehicle.
pub struct StockBaseline {
    pub engine: String,         // "n55", "b58", etc.
    pub param_id: String,       // matches LiveParam.id
    pub rpm_bins: Vec<u16>,     // e.g. [800, 1500, 2500, 4000, 5500, 7000]
    pub load_bins: Vec<u8>,     // e.g. [0, 20, 40, 60, 80, 100]
    /// 2D grid: mean[value] per (rpm_bin, load_bin)
    pub means: Vec<Vec<f64>>,
    pub stddevs: Vec<Vec<f64>>,
    pub sample_count: u32,
}

/// Divergence score for one parameter.
#[derive(Serialize)]
pub struct ParamDivergence {
    pub param_id: String,
    pub param_label: String,
    pub divergence_score: f64,  // 0.0 = identical to stock, >2.0 = significant deviation
    pub stock_range: (f64, f64),
    pub observed_mean: f64,
    pub confidence: u8,         // 0-100, based on sample coverage
}

#[derive(Serialize)]
pub struct TuningReport {
    pub overall_confidence: u8,
    pub is_tuned: bool,
    pub suspected_platform: Option<String>,  // "bootmod3_stage1", "mhd_stage2", etc.
    pub divergences: Vec<ParamDivergence>,
    pub note: String,
}
```

### 3.5 Backend Implementation

**Baseline storage:** `community/baselines/n55_stock.toml` (community-contributed)

**Analysis engine:**
```rust
pub fn analyze(log_data: &[LiveLogEntry], baseline: &StockBaseline) -> TuningReport {
    let mut divergences = Vec::new();
    // Bin log data into (rpm, load) cells
    let binned = bin_by_rpm_load(log_data, &baseline.rpm_bins, &baseline.load_bins);
    for (i, rpm_bin) in baseline.rpm_bins.iter().enumerate() {
        for (j, load_bin) in baseline.load_bins.iter().enumerate() {
            if let Some(observed) = binned.get(&(i, j)) {
                let mean = statistical_mean(observed);
                let stock_mean = baseline.means[i][j];
                let stock_std = baseline.stddevs[i][j];
                let z_score = (mean - stock_mean) / stock_std.max(0.001);
                if z_score.abs() > 2.0 {
                    divergences.push(ParamDivergence {
                        param_id: baseline.param_id.clone(),
                        // ...
                        divergence_score: z_score.abs(),
                    });
                }
            }
        }
    }
    // Heuristic: count high-divergence parameters, weight by significance
    let tuned = /* heuristic matching against known tune signatures */;
    TuningReport { is_tuned: tuned, /* ... */ }
}
```

**Tauri command:**
```rust
#[tauri::command]
pub fn detect_tuning(
    state: tauri::State<'_, AppState>,
    profile: String,
) -> Result<tuning_detect::TuningReport, String> {
    // 1. Collect 30s of live data at varying RPM/load
    // 2. Load baseline for this profile
    // 3. Run analysis
}
```

### 3.6 Frontend Implementation

**New tab or panel:** "Tuning Analysis" inside the Diagnostics tab, or a dedicated modal.

**UI flow:**
1. User clicks "Run Tuning Analysis"
2. Backend instructs: "Hold 2500 RPM, 50% load for 5 seconds…" (progressive test)
3. Results displayed as radar chart: stock vs. observed across key parameters.
4. Verdict banner: "Confidence 87% — suspected Bootmod3 Stage 1"

### 3.7 Implementation Phases
| Phase | Work | Effort |
|-------|------|--------|
| 1 | Baseline TOML format + stock data collection guide | 2 days |
| 2 | Divergence analysis engine | 2 days |
| 3 | Frontend radar chart + guided test protocol | 2 days |

---

## 4. Ghost Mode

### 4.1 Overview
A completely passive CAN bus listening mode that decodes known broadcast frames without sending any diagnostic request. Useful for track days, driving monitoring, and diagnosing intermittent issues where active polling may change behavior.

### 4.2 Why Unique
- ISTA/BimmerLink are 100% active-query tools.
- Generic CAN sniffers (CANalyzer, SavvyCAN) require manual DBC setup.
- No BMW-specific tool offers one-click passive listening with preloaded frame definitions.

### 4.3 Known Broadcast Frames (E-series)

| Frame ID | Content | Bytes | Period |
|----------|---------|-------|--------|
| 0x0AA | RPM, throttle, load | 0-1: RPM/4, 2: load %, 3: throttle % | 10 ms |
| 0x1D0 | Coolant temp, ambient | 1: coolant -48 offset, 4: ambient -48 | 1000 ms |
| 0x545 | Oil temp (E46/E90), various | 5: oil temp -48 | 1000 ms |
| 0x0CE | Vehicle speed | 0-1: speed * 0.0625 (mph?) | 100 ms |
| 0x1B4 | Steering angle, Yaw rate | DSC data | 10 ms |
| 0x0C0 | Brake pressure | 0-1: pressure | 10 ms |

### 4.4 Backend Implementation

**New transport: `src-tauri/src/transport/ghost.rs`**

```rust
use super::{Result, Transport, TransportError};

pub struct GhostTransport {
    port: Box<dyn serialport::SerialPort>,  // K+DCAN in listen-only mode
    frame_defs: Vec<FrameDef>,
}

struct FrameDef {
    can_id: u32,
    name: &'static str,
    fields: Vec<FrameField>,
}

struct FrameField {
    label: &'static str,
    unit: &'static str,
    offset: usize,      // byte offset in payload
    width: usize,       // 1 or 2 bytes
    decode: fn(u16) -> f64,
}

impl GhostTransport {
    pub fn open(port_name: &str) -> Result<Self> {
        let port = serialport::new(port_name, 500_000)
            .timeout(std::time::Duration::from_millis(100))
            .open()
            .map_err(|e| TransportError::Io(e.to_string()))?;
        // Configure FTDI chip for CAN listen-only mode
        // (depends on K+DCAN adapter — may need specific init sequence)
        Ok(Self { port, frame_defs: load_frame_defs() })
    }
}

/// Passive listener — does NOT implement Transport::request
/// Instead, provides a polling method that returns decoded frames.
impl GhostTransport {
    pub fn poll_frames(&mut self) -> Result<Vec<DecodedFrame>> {
        // Read raw CAN frames from serial buffer
        // Parse according to K+DCAN CAN frame format
        // Match against frame_defs, decode fields
    }
}

#[derive(Serialize, Clone)]
pub struct DecodedFrame {
    pub can_id: String,     // "0x0AA"
    pub name: String,
    pub fields: Vec<DecodedField>,
    pub t_ms: u128,
}

#[derive(Serialize, Clone)]
pub struct DecodedField {
    pub label: String,
    pub value: f64,
    pub unit: String,
}
```

**Tauri commands in `commands.rs`:**
```rust
#[tauri::command]
pub fn ghost_start(port: String) -> Result<(), String> { /* ... */ }

#[tauri::command]
pub fn ghost_poll(state: tauri::State<'_, AppState>) -> Result<Vec<ghost::DecodedFrame>, String> { /* ... */ }

#[tauri::command]
pub fn ghost_stop(state: tauri::State<'_, AppState>) -> Result<(), String> { /* ... */ }
```

### 4.5 Frontend Implementation

**New tab: "Ghost Mode"**

```html
<section id="view-ghost" class="view">
  <div class="panel">
    <div class="panel-head">
      <span>👻 Ghost Mode — Passive CAN Listener</span>
      <span>
        <button id="btn-ghost-start" class="btn btn-small btn-primary">Start listening</button>
        <button id="btn-ghost-log" class="btn btn-small" disabled>Log to CSV</button>
      </span>
    </div>
    <div class="ghost-warning">
      ⚠️ No diagnostic queries are sent. Only broadcast frames are decoded.
      Safe to use while driving or on track.
    </div>
    <div id="ghost-grid" class="gauge-grid"></div>
    <div id="ghost-frame-list" class="ghost-frames"></div>
  </div>
</section>
```

**Polling loop in `main.js`:**
```javascript
let ghostTimer = null;
async function ghostPoll() {
  try {
    const frames = await invoke("ghost_poll");
    for (const frame of frames) {
      for (const f of frame.fields) {
        updateGhostGauge(f.label, f.value, f.unit);
      }
    }
  } catch (e) { /* ignore timeouts */ }
}
```

### 4.6 Implementation Phases
| Phase | Work | Effort |
|-------|------|--------|
| 1 | GhostTransport skeleton + frame definitions | 2 days |
| 2 | K+DCAN listen-only serial configuration | 1-2 days (needs real hardware testing) |
| 3 | Frontend gauges + CSV logging | 1 day |

---

## 5. Adaptation Drift Tracker

### 5.1 Overview
Track adaptation values, fuel trims, idle learnings, and other "learned" parameters across multiple sessions over weeks or months. Plot drift and alert when values cross predictive thresholds.

### 5.2 Why Unique
- ISTA stores adaptations per session but has no cross-session trends.
- Consumer apps (Carly) are session-only.
- No tool predicts failure from adaptation drift.

### 5.3 Data Model

**New file: `src-tauri/src/drift.rs`**

```rust
use chrono::{DateTime, Utc};

/// One snapshot of adaptation values for one vehicle.
#[derive(Serialize, Deserialize)]
pub struct AdaptationSnapshot {
    pub vin_hash: String,       // SHA-256 first 8 chars — not reversible
    pub recorded_at: DateTime<Utc>,
    pub engine_profile: String,
    pub values: Vec<AdaptationValue>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AdaptationValue {
    pub id: String,             // e.g. "ltft_bank1"
    pub label: String,
    pub unit: String,
    pub value: f64,
    pub address: u8,
    pub did: u16,               // or local ident
}

/// A time-series entry read from disk.
pub struct DriftSeries {
    pub label: String,
    pub unit: String,
    pub history: Vec<(DateTime<Utc>, f64)>,
}

#[derive(Serialize)]
pub struct DriftAlert {
    pub param_id: String,
    pub param_label: String,
    pub current_value: f64,
    pub baseline_value: f64,
    pub trend: f64,             // units per month
    pub predicted_crossing: Option<String>,  // human-readable time estimate
    pub severity: String,       // "info" | "watch" | "act"
    pub message: String,
}
```

### 5.4 Backend Implementation

**Storage:** `~/beeemuu-sessions/drift/<vin_hash>.jsonl` — one line per session, append-only.

**Reading adaptations:** Requires new protocol functions for adaptation DID reads:
- N55: DID 0x1201 (long-term fuel trim), 0x1202 (idle adaptation), etc.
- These vary by ECU; community TOML can map them.

```rust
// drift.rs
pub fn record(state: &AppState, vin_hash: &str, profile: &str) -> Result<(), String> {
    let dir = dirs::home_dir().ok_or("No home dir")?.join("beeemuu-sessions/drift");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{}.jsonl", vin_hash));
    
    // Read known adaptation DIDs for this profile
    let values = read_adaptations(state, profile)?;
    let snap = AdaptationSnapshot {
        vin_hash: vin_hash.to_string(),
        recorded_at: Utc::now(),
        engine_profile: profile.to_string(),
        values,
    };
    let line = serde_json::to_string(&snap).map_err(|e| e.to_string())?;
    std::fs::OpenOptions::new().append(true).create(true).open(&path)?
        .write_all(line.as_bytes())?;
    std::fs::OpenOptions::new().append(true).open(&path)?
        .write_all(b"\n")?;
    Ok(())
}

pub fn analyze(vin_hash: &str, param_id: &str) -> Option<DriftSeries> {
    // Read all historical snapshots, extract the param's time series
    // Fit linear regression to detect trend
    // Compare against community-known thresholds
}
```

**Tauri commands:**
```rust
#[tauri::command]
pub fn read_adaptations(state: tauri::State<'_, AppState>, profile: String) -> Result<Vec<drift::AdaptationValue>, String>;

#[tauri::command]
pub fn drift_history(vin_hash: String, param_id: String) -> Result<Vec<(String, f64)>, String>;

#[tauri::command]
pub fn drift_alerts(vin_hash: String) -> Result<Vec<drift::DriftAlert>, String>;
```

### 5.5 Frontend Implementation

**New section in Vehicle Info tab:** "Adaptation History"

**Chart:** Small sparkline per adaptation value showing last N sessions.
**Alerts:** Banner if any parameter is trending toward a threshold.

```javascript
async function loadDriftAlerts() {
  const alerts = await invoke("drift_alerts", { vin_hash: currentVinHash });
  const el = $("drift-alerts");
  if (!alerts.length) { el.innerHTML = ""; return; }
  el.innerHTML = alerts.map(a => `
    <div class="drift-alert drift-alert-${a.severity}">
      <strong>${a.param_label}</strong>: ${a.message}
      <span class="muted">Trend: ${a.trend.toFixed(2)} ${a.unit}/month</span>
    </div>
  `).join('');
}
```

### 5.6 Implementation Phases
| Phase | Work | Effort |
|-------|------|--------|
| 1 | Adaptation DID mapping per engine (community TOML) | 2 days |
| 2 | JSONL storage + trend analysis | 2 days |
| 3 | Frontend sparklines + alerts | 1 day |

---

## 6. Misfire Pattern Recognition

### 6.1 Overview
Correlate misfire counts (Mode $06 or BMW-specific DIDs) with concurrent live data (RPM, load, temperature) to identify conditional patterns that reveal root cause.

### 6.2 Why Unique
- ISTA shows misfire counts per cylinder but no conditional analysis.
- Generic OBD tools (Torque) show raw counts only.
- No tool correlates misfires with concurrent operating conditions.

### 6.3 Pattern Logic

| Pattern | Interpretation |
|---------|---------------|
| Cyl X, only >4000 RPM, >80% load | Spark plug/coil failing under pressure |
| Cyl X, only at cold start, clears in 60s | Injector leak-down (fuel puddling) |
| All cylinders, random, at idle | Vacuum leak or fuel pressure issue |
| Cyl X, only at high coolant temp | Heat-related coil breakdown |
| Cyl X, correlated with high knock retard | Detonation-induced misfire (bad gas/tune) |

### 6.4 Backend Implementation

**New file: `src-tauri/src/misfire.rs`**

```rust
#[derive(Serialize)]
pub struct MisfireEvent {
    pub cylinder: u8,
    pub timestamp_ms: u128,
    pub rpm: f64,
    pub load: f64,
    pub coolant_temp: f64,
    pub oil_temp: f64,
    pub iat: f64,
    pub knock_retard: f64,
    pub time_since_start: f64,  // seconds
}

#[derive(Serialize)]
pub struct MisfirePattern {
    pub cylinder: u8,
    pub total_events: usize,
    pub rpm_distribution: Vec<(u16, usize)>,   // (rpm_bin, count)
    pub load_distribution: Vec<(u8, usize)>,
    pub temp_distribution: Vec<(i8, usize)>,   // coolant temp bins
    pub time_since_start_distribution: Vec<(u16, usize)>, // seconds bins
    pub diagnosis: String,      // human-readable interpretation
    pub confidence: u8,
}

pub fn analyze(events: &[MisfireEvent]) -> Vec<MisfirePattern> {
    let mut by_cyl: HashMap<u8, Vec<&MisfireEvent>> = HashMap::new();
    for e in events { by_cyl.entry(e.cylinder).or_default().push(e); }
    
    by_cyl.iter().map(|(cyl, evs)| {
        let rpm_dist = histogram(evs.iter().map(|e| e.rpm as u16), &RPM_BINS);
        let load_dist = histogram(evs.iter().map(|e| e.load as u8), &LOAD_BINS);
        let (diagnosis, confidence) = classify(evs, &rpm_dist, &load_dist);
        MisfirePattern { cylinder: *cyl, total_events: evs.len(), /* ... */ diagnosis, confidence }
    }).collect()
}

fn classify(evs: &[&MisfireEvent], rpm_dist: &[(u16, usize)], load_dist: &[(u8, usize)]) -> (String, u8) {
    // Rule-based classification
    let high_rpm_high_load = evs.iter().filter(|e| e.rpm > 4000.0 && e.load > 80.0).count();
    let cold_start = evs.iter().filter(|e| e.time_since_start < 60.0 && e.coolant_temp < 60.0).count();
    let ratio = evs.len() as f64;
    
    if high_rpm_high_load as f64 / ratio > 0.7 {
        return ("Misfires only under high load/RPM. Likely spark plug or ignition coil failing under cylinder pressure.".into(), 85);
    }
    if cold_start as f64 / ratio > 0.7 {
        return ("Misfires primarily at cold start. Likely injector leak-down or poor atomization when cold.".into(), 80);
    }
    // ... more rules
    ("Pattern unclear — log more data under varied conditions.".into(), 30)
}
```

### 6.5 Frontend Implementation

**New panel in Logging tab:** "Misfire Analysis" button (enabled when misfire data is present in log).

**Visualization:**
- Per-cylinder bar chart: total misfires
- Heatmap: Cylinder × RPM band (color = misfire count)
- Heatmap: Cylinder × Load band
- Diagnosis cards with confidence badges

### 6.6 Implementation Phases
| Phase | Work | Effort |
|-------|------|--------|
| 1 | Misfire DID mapping per engine + event collection | 2 days |
| 2 | Pattern classification engine | 1 day |
| 3 | Frontend heatmaps + diagnosis cards | 1 day |

---

## 7. Parameter Hunt (Gamified)

### 7.1 Overview
Gamify the Parameter Explorer. Users earn points for discovering new identifiers, mapping unknown bytes, and contributing confirmed schemas. Leaderboards, badges, and monthly challenges.

### 7.2 Why Unique
- INPA/ISTA treat reverse engineering as a technician's chore.
- No diagnostic tool has ever gamified discovery.
- BeeEmUu's existing Parameter Explorer + community profile system is 80% of the infrastructure.

### 7.3 Scoring System

| Action | Points | Verification |
|--------|--------|-------------|
| Discover a new responding local identifier | +10 | Auto: probe_range returned it |
| Map an unknown byte to a known physical value | +50 | Manual: user submits label + decode |
| Contribute a confirmed freeze frame schema | +100 | PR merged |
| First to map an engine's oil condition sensor | +500 | Community vote |
| Fix a bug in the simulator | +200 | PR merged |
| Write a DTC story entry | +25 | PR merged |

### 7.4 Backend Implementation

**New file: `src-tauri/src/hunt.rs`**

```rust
#[derive(Serialize, Deserialize)]
pub struct HunterProfile {
    pub github_username: String,
    pub total_score: u32,
    pub badges: Vec<Badge>,
    pub discoveries: Vec<Discovery>,
}

#[derive(Serialize, Deserialize)]
pub struct Badge {
    pub id: String,
    pub name: String,
    pub description: String,
    pub earned_at: String,
}

#[derive(Serialize, Deserialize)]
pub struct Discovery {
    pub kind: String,       // "local_ident" | "freeze_schema" | "dtc_story"
    pub description: String,
    pub points: u32,
    pub verified: bool,
}

/// Scores are computed from git history + community data at build time.
/// No runtime server needed for v1.
pub fn build_leaderboard(community_dir: &std::path::Path) -> Vec<HunterProfile> {
    // Parse git log for contributors
    // Parse community/ for who added what
    // Cross-reference with GitHub API for usernames
}
```

**Static generation approach (v1):**
- A build script or GitHub Action parses the repo's git history.
- Awards points based on merged PRs that touched `community/` or added decode functions.
- Generates `community/leaderboard.json` shipped with the app.

### 7.5 Frontend Implementation

**New tab: "Hunt"**

```html
<section id="view-hunt" class="view">
  <div class="hunt-layout">
    <div class="panel">
      <div class="panel-head"><span>🏆 Leaderboard</span></div>
      <div id="hunt-leaderboard"></div>
    </div>
    <div class="panel">
      <div class="panel-head"><span>🎯 Active Challenges</span></div>
      <div id="hunt-challenges"></div>
    </div>
    <div class="panel">
      <div class="panel-head"><span>⭐ Your Progress</span></div>
      <div id="hunt-self"></div>
    </div>
  </div>
</section>
```

**Challenges (static TOML: `community/challenges.toml`):**
```toml
[[challenge]]
id = "n54-map-5-locals"
title = "N54 Pioneer"
description = "Map 5 new local identifiers on the N54 this month"
points = 250
deadline = "2026-08-01"
engine = "n54"
```

### 7.6 Implementation Phases
| Phase | Work | Effort |
|-------|------|--------|
| 1 | Point system + static leaderboard generation | 1 day |
| 2 | Challenges TOML + frontend tab | 1 day |
| 3 | Badge graphics + personal progress tracking | 1 day |

---

## 8. Virtual Second Opinion

### 8.1 Overview
For any DTC, present three synthesized viewpoints: The Dealer, The Indie Shop, and The Forums. Each with different cost, approach, and difficulty.

### 8.2 Why Unique
- ISTA only gives the dealer perspective.
- Forums have all three but scattered and contradictory.
- No tool synthesizes viewpoints with source attribution.

### 8.3 Data Model

**New file: `community/opinions/<dtc_code>.toml`:**
```toml
[[opinion]]
perspective = "dealer"
action = "Replace DME control unit"
cost_usd = 2400
time = "3 days"
source = "BMW TSB 1234567"

[[opinion]]
perspective = "indie"
action = "Check ground strap G105 and 5V reference circuit"
cost_usd = 150
time = "2 hours"
source = "Shop experience (Bimmerpost aggregate)"

[[opinion]]
perspective = "diy"
action = "Clean Valvetronic motor connector with contact cleaner"
cost_usd = 0
time = "20 minutes"
source = "E90Post thread #456789"
difficulty = "easy"
```

### 8.4 Backend Implementation

```rust
// opinions.rs
#[derive(Serialize)]
pub struct OpinionSet {
    pub dtc_code: String,
    pub dtc_text: String,
    pub perspectives: Vec<Opinion>,
}

#[derive(Serialize)]
pub struct Opinion {
    pub perspective: String,    // "dealer" | "indie" | "diy"
    pub action: String,
    pub cost_usd: Option<u32>,
    pub time_estimate: String,
    pub difficulty: Option<String>,
    pub source: String,
    pub source_url: Option<String>,
}

pub fn load_opinions(code: &str) -> Option<OpinionSet> {
    // Load from community/opinions/<code>.toml
}
```

### 8.5 Frontend Implementation

**UI placement:** Inside the Oracle panel (Feature #1) or as an expandable card per DTC row.

```html
<div class="second-opinion">
  <div class="so-tabs">
    <button class="so-tab active" data-pov="diy">🔧 DIY</button>
    <button class="so-tab" data-pov="indie">🏠 Indie Shop</button>
    <button class="so-tab" data-pov="dealer">🏢 Dealer</button>
  </div>
  <div class="so-content" id="so-content">
    <!-- Populated by JS -->
  </div>
</div>
```

### 8.6 Implementation Phases
| Phase | Work | Effort |
|-------|------|--------|
| 1 | Opinion TOML format + loader | 1 day |
| 2 | Frontend tabs + integration with DTC table | 1 day |

---

## 9. Dyno Mode

### 9.1 Overview
Log 0-60 mph, ¼-mile, and horsepower estimation using only OBD data + device GPS/accelerometer (if available via Tauri geolocation plugin). No external hardware.

### 9.2 Why Unique Here
- Dragy/Performance Box exist but require extra hardware.
- No BMW-specific diagnostic tool integrates performance logging with diagnostic data correlation.

### 9.3 Backend Implementation

```rust
// dyno.rs
#[derive(Serialize)]
pub struct DynoRun {
    pub start_time_ms: u128,
    pub zero_to_sixty_ms: Option<u128>,
    pub quarter_mile_ms: Option<u128>,
    pub trap_speed_mph: Option<f64>,
    pub est_hp: Option<f64>,   // calculated from MAF + VE model
    pub est_tq: Option<f64>,
    pub log_data: Vec<DynoSample>,
}

#[derive(Serialize)]
pub struct DynoSample {
    pub t_ms: u128,
    pub speed_mph: f64,
    pub rpm: f64,
    pub load: f64,
    pub maf_gps: f64,
    pub iat: f64,
}

/// Horsepower estimate using MAF-based calculation:
/// HP = (MAF * AFR * BSFC_inv) / 60
/// where AFR = 14.7 (stoich), BSFC_inv derived from engine family
pub fn estimate_hp(samples: &[DynoSample], engine: &str) -> f64 {
    let max_maf = samples.iter().map(|s| s.maf_gps).fold(0.0, f64::max);
    let bsfc_factor = match engine {
        "n55" => 1.0 / 0.45,
        "b58" => 1.0 / 0.42,
        _ => 1.0 / 0.45,
    };
    max_maf * 14.7 * bsfc_factor / 60.0 * 1.34  // rough conversion to HP
}
```

### 9.4 Frontend Implementation

**New tab or modal:** "Performance"

**UI:**
- "Start Run" button (arms the logger, waits for speed > 0)
- Real-time display during run: speed, RPM, estimated HP
- Results table: all saved runs, sortable
- Overlay chart: speed vs. time for multiple runs

### 9.5 Implementation Phases
| Phase | Work | Effort |
|-------|------|--------|
| 1 | Dyno sample collection + HP estimation | 1 day |
| 2 | Frontend run UI + overlay charts | 1 day |
| 3 | GPS integration (optional, Tauri plugin) | 1 day |

---

## 10. Predictive CBS Timeline

### 10.1 Overview
Predict when each Condition Based Service item will actually be needed based on driving patterns, oil condition data, and historical wear rates.

### 10.2 Why Unique
- All existing tools read the current CBS status. None predict.
- BMW's own CBS is conservative and doesn't account for driving style.

### 10.3 Backend Implementation

```rust
// cbs_predict.rs
#[derive(Serialize)]
pub struct CbsPrediction {
    pub item: String,           // "front_brake", "oil", "microfilter"
    pub current_status: String, // "OK", "DUE", "OVERDUE"
    pub current_value: f64,     // e.g. brake pad mm, oil condition %
    pub predicted_due_date: String,
    pub predicted_due_km: u32,
    pub driving_adjustment: String, // "Based on 60% city driving"
}

pub fn predict(
    cbs_data: &[(String, f64)],  // (item, current_value)
    history: &[CbsSnapshot],
    driving_profile: &DrivingProfile,
) -> Vec<CbsPrediction> {
    // Linear extrapolation of wear rates from historical data
    // Adjust for driving style: aggressive = 1.3x wear, highway = 0.7x
}
```

### 10.4 Frontend Implementation

**UI placement:** Vehicle Info tab, below current CBS status.

```html
<div id="cbs-predictions">
  <div class="cbs-pred">
    <span class="cbs-name">Front brake pads</span>
    <span class="cbs-current">4.2 mm</span>
    <span class="cbs-pred">→ 2.5 mm in ~8,200 miles (Dec 2026)</span>
  </div>
</div>
```

### 10.5 Implementation Phases
| Phase | Work | Effort |
|-------|------|--------|
| 1 | CBS DID mapping + wear rate models | 1 day |
| 2 | Prediction engine + frontend display | 1 day |

---

## 11. Wiring Detective

### 11.1 Overview
For DTCs related to sensors/actuators, show a simplified wiring diagram of the affected circuit: power source → fuse → ECU pin → component → ground. Highlight common failure points.

### 11.2 Why Unique
- ISTA has full schematics but they're overwhelming.
- No tool auto-filters to just the relevant circuit.
- No open-source tool does this.

### 11.3 Data Model

**New file: `community/wiring/<dtc_code>.toml`:**
```toml
[[circuit]]
dtc = "P0171"
component = "MAF sensor"
ecu_pin = "X60002.26"
component_pin = "3"
power_fuse = "F07 (5A)"
ground_point = "G105"
common_failures = [
    "DISA valve vacuum line crack at elbow",
    "Oil filler cap gasket leaking",
]
```

### 11.4 Frontend Implementation

**UI:** Expandable card per DTC row.

```html
<div class="wiring-card">
  <div class="wiring-circuit">
    <span class="wiring-node">Fuse F07 (5A)</span>
    <span class="wiring-line">───▶</span>
    <span class="wiring-node">DME X60002.26</span>
    <span class="wiring-line">───▶</span>
    <span class="wiring-node">MAF Pin 3</span>
    <span class="wiring-line">───▶</span>
    <span class="wiring-node">G105 Ground</span>
  </div>
  <ul class="wiring-failures">
    <li>🔧 DISA valve vacuum line crack at elbow</li>
    <li>🔧 Oil filler cap gasket leaking</li>
  </ul>
</div>
```

### 11.5 Implementation Phases
| Phase | Work | Effort |
|-------|------|--------|
| 1 | Wiring TOML format + loader | 1 day |
| 2 | Frontend circuit display | 1 day |

---

## 12. Cold Start Auto-Logger

### 12.1 Overview
Automatically detect when the engine starts from cold (coolant < 40°C) and trigger a special high-frequency logging session for the first 5 minutes.

### 12.2 Why Unique
- All loggers require manual start/stop.
- By the time you realize you need a cold-start log, the engine is warm.

### 12.3 Backend Implementation

```rust
// cold_start.rs
pub struct ColdStartMonitor {
    armed: bool,
    logging: bool,
    start_temp: f64,
}

impl ColdStartMonitor {
    pub fn tick(&mut self, coolant: f64, running: bool) -> ColdStartAction {
        if !self.armed && !running && coolant < 40.0 {
            // Engine off, coolant cold → arm
            self.armed = true;
            return ColdStartAction::Armed;
        }
        if self.armed && running && coolant < 40.0 && !self.logging {
            // Engine just started cold → trigger
            self.logging = true;
            self.start_temp = coolant;
            return ColdStartAction::StartLogging;
        }
        if self.logging && coolant > 70.0 {
            // Warmed up → can disarm
            self.logging = false;
            self.armed = false;
            return ColdStartAction::StopLogging;
        }
        ColdStartAction::None
    }
}
```

**Integration with existing logger:**
- Add checkbox in Logging tab: "☑ Auto-start on cold start"
- Backend monitors coolant temp via `read_live_data` when armed.

### 12.4 Frontend Implementation

**UI addition:** Checkbox in Logging tab panel-head.

```html
<label class="chk"><input type="checkbox" id="log-coldstart" /> Auto-start on cold start</label>
```

When triggered, show toast: "Cold start detected — logging at 4×/s for 5 minutes."

### 12.5 Implementation Phases
| Phase | Work | Effort |
|-------|------|--------|
| 1 | ColdStartMonitor + integration with logger | 1 day |
| 2 | Frontend checkbox + toast notification | 0.5 day |

---

## 13. Secure Snapshot Share

### 13.1 Overview
When exporting a snapshot, offer a "Secure Share" mode that strips VIN, hashes the license plate, retains all diagnostic data, and generates a one-time link or encrypted file.

### 13.2 Why Unique
- Privacy concerns prevent many owners from sharing diagnostic data.
- No existing tool has built-in anonymization.
- Critical for Community Oracle (Feature #1) to work at scale.

### 13.3 Backend Implementation

```rust
// anonymize.rs
#[derive(Serialize, Deserialize)]
pub struct AnonymizedSnapshot {
    pub vehicle_fingerprint: String,  // hash of VIN + mileage, not reversible
    pub engine_family: String,
    pub build_date: Option<String>,   // month/year only
    pub modules: Vec<AnonymizedModule>,
}

pub fn anonymize(original: &commands::SessionSnapshot) -> AnonymizedSnapshot {
    AnonymizedSnapshot {
        vehicle_fingerprint: hash_vin(&original.vehicle_info.as_ref().unwrap().vin),
        engine_family: original.vehicle_info.as_ref()
            .and_then(|v| v.suggested_profile.clone())
            .unwrap_or_default(),
        build_date: original.vehicle_info.as_ref()
            .and_then(|v| v.decode.as_ref())
            .map(|d| d.build_date.clone()),
        modules: original.modules.iter().map(|m| AnonymizedModule {
            address: m.address,
            name: m.name.clone(),
            dtcs: m.dtcs.clone(),
            // ident stripped if it contains VIN-derived data
            ident: None,
        }).collect(),
    }
}
```

### 13.4 Frontend Implementation

**UI placement:** Vehicle Info tab, next to "Export snapshot" button.

```html
<button id="btn-snapshot-share" class="btn btn-small">Secure Share</button>
```

Modal:
- "This will remove your VIN and license plate while keeping all diagnostic data."
- "Recipient can analyze the full picture without knowing your identity."
- Export as encrypted `.bee` file or copy anonymized JSON.

### 13.5 Implementation Phases
| Phase | Work | Effort |
|-------|------|--------|
| 1 | Anonymization function + hash generation | 0.5 day |
| 2 | Frontend modal + export | 0.5 day |

---

## 14. Flash Counter & History Auditor

### 14.1 Overview
Read and display flash/programming counters from each ECU. Show a timeline of when modules were last flashed. Detect mismatched software versions across modules.

### 14.2 Why Unique
- ISTA shows this data but buried in programming menus.
- No consumer tool exposes flash history.
- Essential for used-car buyers.

### 14.3 Backend Implementation

```rust
// flash_history.rs
#[derive(Serialize)]
pub struct FlashHistory {
    pub address: u8,
    pub module_name: String,
    pub flash_count: Option<u32>,
    pub last_programmed_date: Option<String>,
    pub software_version: Option<String>,
    pub hardware_version: Option<String>,
    pub boot_version: Option<String>,
}

/// UDS DID 0xF184 (application software identification)
/// UDS DID 0xF186 (active diagnostic session — not flash count)
/// BMW-specific: DID 0xF198 (repair shop code / flash history)
/// DID 0xF199 (programming date)
pub fn read_flash_history(t: &mut dyn Transport, address: u8) -> Result<FlashHistory, String> {
    let sw_id = protocol::read_did(t, address, 0xF184).ok();
    let prog_date = protocol::read_did(t, address, 0xF199).ok();
    // Parse date bytes: typically [year_hi, year_lo, month, day]
    let date_str = prog_date.and_then(|b| {
        if b.len() >= 4 {
            Some(format!("{:02X}{:02X}-{:02X}-{:02X}", b[0], b[1], b[2], b[3]))
        } else { None }
    });
    FlashHistory {
        address,
        module_name: ecus::lookup_name(address).to_string(),
        flash_count: None,  // requires BMW-specific DID
        last_programmed_date: date_str,
        software_version: sw_id.map(|b| String::from_utf8_lossy(&b).to_string()),
        hardware_version: None,
        boot_version: None,
    }
}
```

### 14.4 Frontend Implementation

**UI placement:** New section in Vehicle Info tab, below VIN decode.

```html
<div class="flash-history">
  <h4>Module Programming History</h4>
  <table class="flash-table">
    <tr><th>Module</th><th>Software</th><th>Last Programmed</th><th>⚠</th></tr>
    <tr>
      <td>DME</td>
      <td>ME17.2.42</td>
      <td>2023-03-15</td>
      <td class="flash-warn">Mismatched with Kombi</td>
    </tr>
  </table>
</div>
```

### 14.5 Implementation Phases
| Phase | Work | Effort |
|-------|------|--------|
| 1 | Flash DID mapping per ECU | 1 day |
| 2 | Mismatch detection heuristic + frontend table | 1 day |

---

## Appendix A: Shared Infrastructure Changes

### A.1 New Rust Modules

| Module | File | Purpose |
|--------|------|---------|
| `oracle` | `src-tauri/src/oracle.rs` | DTC fingerprinting + community KB queries |
| `story` | `src-tauri/src/story.rs` | Narrative generation from snapshots |
| `tuning_detect` | `src-tauri/src/tuning_detect.rs` | Stock baseline comparison |
| `ghost` | `src-tauri/src/transport/ghost.rs` | Passive CAN listener |
| `drift` | `src-tauri/src/drift.rs` | Adaptation time-series tracking |
| `misfire` | `src-tauri/src/misfire.rs` | Misfire pattern analysis |
| `hunt` | `src-tauri/src/hunt.rs` | Gamification scoring |
| `dyno` | `src-tauri/src/dyno.rs` | Performance logging |
| `cbs_predict` | `src-tauri/src/cbs_predict.rs` | Predictive service timelines |
| `anonymize` | `src-tauri/src/anonymize.rs` | Snapshot anonymization |
| `flash_history` | `src-tauri/src/flash_history.rs` | ECU flash counter reads |

### A.2 Modifications to Existing Files

| File | Changes |
|------|---------|
| `src-tauri/src/lib.rs` | Add `mod` declarations for all new modules; wire Tauri commands |
| `src-tauri/src/commands.rs` | Add ~15 new `#[tauri::command]` functions |
| `src-tauri/src/data/live.rs` | Add new `Decode` variants as needed (`u16_div100`, `s16_div4`, etc.) |
| `src-tauri/src/protocol/mod.rs` | Add `read_adaptation()` helper if not present |
| `src/index.html` | New tabs, panels, modals for all features |
| `src/js/main.js` | New event handlers, render functions, polling loops |
| `src/css/app.css` | New component styles (oracle, story, hunt, etc.) |

### A.3 New Community TOML Files

| File | Purpose |
|------|---------|
| `community/oracle_snapshot.json` | Bundled DTC pattern knowledge base |
| `community/stories/n55.toml` | Narrative templates for N55 DTCs |
| `community/stories/n54.toml` | Narrative templates for N54 DTCs |
| `community/baselines/n55_stock.toml` | Stock live-data baselines |
| `community/opinions/*.toml` | Second-opinion entries per DTC |
| `community/wiring/*.toml` | Simplified circuit diagrams per DTC |
| `community/challenges.toml` | Active gamification challenges |
| `community/adaptations.toml` | DID mappings for adaptation values per engine |

---

## Appendix B: Dependency & Crate Additions

### B.1 Rust (`src-tauri/Cargo.toml`)

```toml
[dependencies]
# Already present: serde, tauri, serialport, toml

# New for v0.3.0+
sha2 = "0.10"          # Oracle fingerprinting
chrono = { version = "0.4", features = ["serde"] }  # Drift timestamps
reqwest = { version = "0.12", features = ["json"], optional = true }  # Oracle API

[features]
cloud = ["dep:reqwest"]   # Enable for community API builds
```

### B.2 Frontend

No new major dependencies. All charts use existing Chart.js. Optional: Tauri geolocation plugin for Dyno Mode GPS.

---

## Appendix C: File Inventory

### New Files (Backend)

```
src-tauri/src/oracle.rs
src-tauri/src/story.rs
src-tauri/src/tuning_detect.rs
src-tauri/src/transport/ghost.rs
src-tauri/src/drift.rs
src-tauri/src/misfire.rs
src-tauri/src/hunt.rs
src-tauri/src/dyno.rs
src-tauri/src/cbs_predict.rs
src-tauri/src/anonymize.rs
src-tauri/src/flash_history.rs
```

### New Files (Frontend)

```
src/js/oracle.js        # Oracle panel logic (or inline in main.js)
src/js/story.js         # Story modal logic
src/js/hunt.js          # Hunt tab logic
src/js/dyno.js          # Dyno mode logic
src/css/story.css       # Story modal styles
src/css/hunt.css        # Hunt tab styles
```

### New Files (Community Data)

```
community/oracle_snapshot.json
community/stories/n55.toml
community/stories/n54.toml
community/stories/b58.toml
community/stories/generic.toml
community/baselines/n55_stock.toml
community/opinions/
community/wiring/
community/challenges.toml
community/adaptations.toml
```

---

## Recommended Build Order

| Phase | Features | Rationale |
|-------|----------|-----------|
| **0.3.1** | Community Oracle, Secure Snapshot Share, Second Opinion | Activate community network effect; low technical risk |
| **0.3.2** | Diagnostic Story Mode, Parameter Hunt | Content-driven; builds on community contributions |
| **0.3.3** | Ghost Mode, Cold Start Auto-Logger | Extend existing logging infrastructure |
| **0.4.0** | Tuning Fingerprint, Adaptation Drift, Misfire Pattern | Heavy analysis features; need baseline data collection |
| **0.4.1** | Dyno Mode, Predictive CBS, Flash History, Wiring Detective | Nice-to-have differentiators |

---

*End of Specification*
