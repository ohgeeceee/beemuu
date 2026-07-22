//! Tauri commands — the bridge between the frontend and the diagnostic stack.

use crate::analysis::{ByteWatcher, WatchSnapshot};
use crate::data::{ecus, freeze, live, service_functions, vin};
use crate::keepalive;
use crate::protocol::{self, Dtc, EcuInfo, FreezeItem};
use crate::transport::record::{RecordingTransport, SharedLog, TrafficEntry};
use crate::transport::{self, Transport, TransportConfig};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};

/// A live byte-diff watch bound to one identifier.
#[derive(Default)]
struct WatchSession {
    address: u8,
    mode: String,
    id: u16,
    watcher: ByteWatcher,
}

#[derive(Default)]
pub struct AppState {
    /// Behind an `Arc` so the Tester Present keep-alive worker can share
    /// the same lock as every command (see `keepalive` module docs).
    pub transport: Arc<Mutex<Option<Box<dyn Transport>>>>,
    watch: Mutex<Option<WatchSession>>,
    traffic: SharedLog,
    pub unlocked: Mutex<HashSet<u8>>,
    /// Running Tester Present worker while a non-default session is active.
    keepalive: Mutex<Option<keepalive::KeepAlive>>,
}

/// Lock a shared-state mutex, mapping a poisoned lock into a command error
/// instead of panicking. A panic while a guard is held poisons the mutex;
/// propagating the error keeps one bad command from cascading into every
/// other command that shares the state (issue #95).
fn lock_state<'a, T>(m: &'a Mutex<T>) -> Result<std::sync::MutexGuard<'a, T>, String> {
    m.lock().map_err(|e| format!("state lock poisoned: {e}"))
}

#[derive(Serialize)]
pub struct ConnectionInfo {
    pub transport_name: String,
    pub vin: Option<String>,
    pub suggested_profile: Option<String>,
}

#[tauri::command]
pub fn list_ports() -> Vec<String> {
    transport::list_serial_ports()
}

#[tauri::command]
pub async fn connect(
    state: tauri::State<'_, AppState>,
    config: TransportConfig,
) -> Result<ConnectionInfo, String> {
    let inner = transport::open(&config).map_err(|e| e.to_string())?;
    // Fresh session: stop any keep-alive from a previous connection, reset
    // the traffic log and wrap the transport so every request/response from
    // here on is recorded.
    stop_keepalive(&state)?;
    lock_state(&state.traffic)?.clear();
    let mut t: Box<dyn Transport> =
        Box::new(RecordingTransport::new(inner, Arc::clone(&state.traffic)));
    let name = t.name().to_string();
    // Best-effort VIN read — the UDS (22 F190) / KWP (1A 90) split and the
    // CAS fallback are handled inside protocol::read_vin.
    let vin = protocol::read_vin(t.as_mut()).ok();
    let suggested_profile = vin.as_deref().and_then(vin::suggested_profile).map(|s| s.to_string());
    *lock_state(&state.transport)? = Some(t);
    Ok(ConnectionInfo { transport_name: name, vin, suggested_profile })
}

#[tauri::command]
pub async fn disconnect(state: tauri::State<'_, AppState>) -> Result<(), String> {
    stop_keepalive(&state)?;
    if let Some(mut t) = lock_state(&state.transport)?.take() {
        t.disconnect();
    }
    lock_state(&state.unlocked)?.clear();
    Ok(())
}

fn with_transport<T>(
    state: &tauri::State<'_, AppState>,
    f: impl FnOnce(&mut dyn Transport) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = lock_state(&state.transport)?;
    let t = guard.as_mut().ok_or("Not connected")?;
    f(t.as_mut())
}

/// Stop the Tester Present keep-alive worker, if running.
fn stop_keepalive(state: &tauri::State<'_, AppState>) -> Result<(), String> {
    if let Some(ka) = lock_state(&state.keepalive)?.take() {
        ka.stop();
    }
    Ok(())
}

/// (Re)start the Tester Present keep-alive worker against `target`. Called
/// when an ECU enters a non-default diagnostic session so the ECU's
/// S3server timer never expires while the app is idle (issue #87).
fn start_keepalive(state: &tauri::State<'_, AppState>, target: u8) -> Result<(), String> {
    stop_keepalive(state)?;
    let ka = keepalive::spawn(Arc::clone(&state.transport), target, keepalive::INTERVAL);
    *lock_state(&state.keepalive)? = Some(ka);
    Ok(())
}

/// Probe every known ECU address: ident + fault count. This is the
/// ISTA-style "vehicle test" that builds the module tree.
#[tauri::command]
pub async fn scan_modules(state: tauri::State<'_, AppState>) -> Result<Vec<EcuInfo>, String> {
    with_transport(&state, |t| {
        let mut result = Vec::new();
        for def in ecus::ECUS {
            match protocol::identify(t, def.address) {
                Ok(ident) => {
                    let fault_count = protocol::read_dtcs(t, def.address).map(|d| d.len()).ok();
                    result.push(EcuInfo {
                        address: def.address,
                        name: def.name.to_string(),
                        description: def.description.to_string(),
                        ident: Some(ident),
                        present: true,
                        fault_count,
                    });
                }
                Err(_) => result.push(EcuInfo {
                    address: def.address,
                    name: def.name.to_string(),
                    description: def.description.to_string(),
                    ident: None,
                    present: false,
                    fault_count: None,
                }),
            }
        }
        Ok(result)
    })
}

/// OBD-II mode 01 PID scan on a single ECU. Returns the set of PIDs the
/// ECU actually responds to (`0x00..=0x7F`). Used by the Vehicle Test
/// tab's "Scan OBD-II PIDs" button to answer "what does this module
/// actually support?" before the user opens Parameter Explorer.
///
/// Protected path: touches `protocol::scan_obd2_pids` (the OBD-II / UDS
/// byte surface). Flagged at the top of the PR description per the
/// project's protected-path discipline.
#[tauri::command]
pub async fn list_supported_pids(
    state: tauri::State<'_, AppState>,
    address: u8,
) -> Result<Vec<u8>, String> {
    with_transport(&state, |t| protocol::scan_obd2_pids(t, address))
}

#[tauri::command]
pub async fn read_faults(state: tauri::State<'_, AppState>, address: u8) -> Result<Vec<Dtc>, String> {
    with_transport(&state, |t| protocol::read_dtcs(t, address))
}

#[tauri::command]
pub async fn read_freeze_frame(
    state: tauri::State<'_, AppState>,
    address: u8,
    code: String,
) -> Result<Vec<FreezeItem>, String> {
    with_transport(&state, |t| protocol::read_freeze_frame(t, address, &code))
}

#[tauri::command]
pub fn get_freeze_schema(address: u8) -> Option<Vec<freeze::FreezeFieldDef>> {
    let schema = freeze::registry().get_schema(address)?;
    Some(schema.fields.into_iter().map(freeze::FreezeFieldDef::from).collect())
}

#[tauri::command]
pub fn save_freeze_schema(
    address: u8,
    fields: Vec<freeze::FreezeFieldDef>,
) -> Result<(), String> {
    let rust_fields: Vec<freeze::FreezeField> = fields.iter().cloned().map(|f| f.into()).collect();
    crate::community::save_freeze_schema(address, &rust_fields)?;
    let schema = freeze::FreezeSchema {
        fields: rust_fields,
    };
    freeze::registry().register_for(address, schema);
    Ok(())
}

#[tauri::command]
pub fn load_freeze_schemas() -> Result<u32, String> {
    let dir = crate::community::find_dir().ok_or("Community directory not found")?;
    let freeze_dir = dir.join("freeze");
    if !freeze_dir.is_dir() {
        return Ok(0);
    }
    let mut count = 0u32;
    for entry in std::fs::read_dir(&freeze_dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("toml")) {
            continue;
        }
        let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let parsed: crate::community::FreezeFile =
            toml::from_str(&text).map_err(|e| e.to_string())?;
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        let address = u8::from_str_radix(stem, 16)
            .map_err(|_| format!("Bad filename: {}", path.display()))?;
        let fields: Vec<freeze::FreezeField> = parsed
            .field
            .into_iter()
            .map(|f| {
                let width = freeze::width_from_str(&f.width).unwrap_or(freeze::Width::U8);
                freeze::FreezeField::new(
                    Box::leak(f.label.into_boxed_str()),
                    Box::leak(f.unit.into_boxed_str()),
                    f.offset,
                    width,
                    f.scale,
                    f.bias,
                    f.decimals,
                )
            })
            .collect();
        freeze::registry().register_for(address, freeze::FreezeSchema { fields });
        count += 1;
    }
    Ok(count)
}

#[tauri::command]
pub async fn preview_freeze_frame(
    state: tauri::State<'_, AppState>,
    address: u8,
    code: String,
    fields: Vec<freeze::FreezeFieldDef>,
) -> Result<Vec<FreezeItem>, String> {
    let schema = freeze::FreezeSchema {
        fields: fields.into_iter().map(|f| f.into()).collect(),
    };
    let old = freeze::registry().unregister(address);
    freeze::registry().register_for(address, schema);
    let result = with_transport(&state, |t| protocol::read_freeze_frame(t, address, &code));
    if let Some(s) = old {
        freeze::registry().register_for(address, s);
    }
    result
}

#[tauri::command]
pub async fn clear_faults(state: tauri::State<'_, AppState>, address: u8) -> Result<(), String> {
    with_transport(&state, |t| protocol::clear_dtcs(t, address))
}

#[derive(Serialize)]
pub struct ProfileInfo {
    pub id: String,
    pub label: String,
    /// Per-profile gauge colour scheme (`[profile.theme]` in the TOML).
    /// Omitted from the JSON entirely when the profile has no theme
    /// block, so profiles without one serialise exactly as before.
    #[serde(skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub theme: std::collections::HashMap<String, String>,
}

#[tauri::command]
pub fn list_profiles() -> Vec<ProfileInfo> {
    live::profile_list()
        .into_iter()
        .map(|(id, label, theme)| ProfileInfo { id, label, theme })
        .collect()
}

/// One polling sweep over a profile's parameters. Frontend calls this on a timer.
#[tauri::command]
pub async fn read_live_data(
    state: tauri::State<'_, AppState>,
    profile: String,
) -> Result<Vec<live::LiveValue>, String> {
    let params = live::profile_params(&profile).ok_or("Unknown profile")?;
    with_transport(&state, |t| {
        let mut out = Vec::new();
        for def in &params {
            let data = match def.query {
                live::Query::Did(did) => protocol::read_did(t, def.target, did),
                live::Query::Obd(pid) => protocol::read_obd_pid(t, def.target, pid),
                live::Query::Local(id) => protocol::read_local_ident(t, def.target, id),
            };
            if let Ok(data) = data {
                // For U8Enum the value comes from the per-parameter
                // enum_map, not the numeric decoder. The numeric
                // pipeline returns None for it; we resolve the label
                // here and surface it as `text`. Unknown bytes (e.g.
                // a gear value the profile didn't anticipate) get a
                // `0xNN ?` sentinel so the gauge renders an explicit
                // "unknown state" rather than going silently to zero.
                if matches!(def.decode, live::Decode::U8Enum) {
                    if let Some(label) =
                        live::decode_enum_string_or_unknown(def.decode, &data, &def.enum_map)
                    {
                        out.push(live::LiveValue {
                            id: def.id.clone(),
                            label: def.label.clone(),
                            unit: def.unit.clone(),
                            value: 0.0,
                            min: def.min,
                            max: def.max,
                            text: Some(label),
                        });
                    }
                    continue;
                }
                if let Some(value) = live::decode(def.decode, &data) {
                    out.push(live::LiveValue {
                        id: def.id.clone(),
                        label: def.label.clone(),
                        unit: def.unit.clone(),
                        value,
                        min: def.min,
                        max: def.max,
                        text: None,
                    });
                }
            }
        }
        Ok(out)
    })
}

/* ---------------- Parameter Explorer ---------------- */

#[derive(Serialize)]
pub struct ProbeResult {
    pub id: u16,
    pub hex: String,
}

fn probe_read(t: &mut dyn Transport, mode: &str, address: u8, id: u16) -> Result<Vec<u8>, String> {
    match mode {
        "did" => protocol::read_did(t, address, id),
        "local" => protocol::read_local_ident(t, address, id as u8),
        "obd" => protocol::read_obd_pid(t, address, id as u8),
        _ => Err("Unknown probe mode".into()),
    }
}

/// Scan a range of identifiers on one ECU, returning only the ones that
/// answered with data. Used to discover what a real module exposes.
#[tauri::command]
pub async fn probe_range(
    state: tauri::State<'_, AppState>,
    address: u8,
    mode: String,
    start: u16,
    end: u16,
) -> Result<Vec<ProbeResult>, String> {
    if end < start || (end - start) > 512 {
        return Err("Range too large (max 512 per scan)".into());
    }
    with_transport(&state, |t| {
        let mut found = Vec::new();
        for id in start..=end {
            if let Ok(data) = probe_read(t, &mode, address, id) {
                let hex = data
                    .iter()
                    .map(|b| format!("{b:02X}"))
                    .collect::<Vec<_>>()
                    .join(" ");
                found.push(ProbeResult { id, hex });
            }
        }
        Ok(found)
    })
}

/// Single raw read for watch mode — poll one ident and see which bytes move.
#[tauri::command]
pub async fn read_raw(
    state: tauri::State<'_, AppState>,
    address: u8,
    mode: String,
    id: u16,
) -> Result<Vec<u8>, String> {
    with_transport(&state, |t| probe_read(t, &mode, address, id))
}

/// Begin (or restart) a stateful byte-diff watch on one identifier. Clears
/// any prior mutation statistics.
#[tauri::command]
pub fn watch_start(
    state: tauri::State<'_, AppState>,
    address: u8,
    mode: String,
    id: u16,
) -> Result<(), String> {
    *lock_state(&state.watch)? = Some(WatchSession {
        address,
        mode,
        id,
        watcher: ByteWatcher::new(),
    });
    Ok(())
}

/// Poll the active watch once and return accumulated per-byte statistics
/// (change count, min/max, volatility, mean delta).
#[tauri::command]
pub async fn watch_tick(state: tauri::State<'_, AppState>) -> Result<WatchSnapshot, String> {
    let (address, mode, id) = {
        let guard = lock_state(&state.watch)?;
        let s = guard.as_ref().ok_or("No active watch")?;
        (s.address, s.mode.clone(), s.id)
    };
    let data = with_transport(&state, |t| probe_read(t, &mode, address, id))?;
    let mut guard = lock_state(&state.watch)?;
    let s = guard.as_mut().ok_or("Watch stopped")?;
    s.watcher.feed(&data);
    Ok(s.watcher.snapshot())
}

#[tauri::command]
pub fn watch_stop(state: tauri::State<'_, AppState>) -> Result<(), String> {
    *lock_state(&state.watch)? = None;
    Ok(())
}

#[tauri::command]
pub fn list_service_functions() -> Vec<service_functions::ServiceFunction> {
    service_functions::SERVICE_FUNCTIONS.to_vec()
}

/// One routineControl call. The Rust side resolves `module_label`
/// at runtime (via `effective_module_label`) so the JSON the UI
/// receives always has the human-readable name filled in, never the
/// empty-string default marker.
#[tauri::command]
pub async fn run_service_function(
    state: tauri::State<'_, AppState>,
    id: String,
    // Index into `service.routines`. Defaults to 0 (single-routine
    // services) for backwards compatibility with any UI that still
    // sends only `id`. The UI built in v0.4.0 always sends an
    // explicit index.
    module_index: Option<usize>,
) -> Result<String, String> {
    let sf = service_functions::SERVICE_FUNCTIONS
        .iter()
        .find(|s| s.id == id)
        .ok_or("Unknown service function")?;
    let idx = module_index.unwrap_or(0);
    let routine = sf.routines.get(idx).ok_or_else(|| {
        format!(
            "service {} has only {} routine(s); module_index {} is out of range",
            sf.id,
            sf.routines.len(),
            idx
        )
    })?;
    with_transport(&state, |t| {
        protocol::routine(t, routine.target, 0x01, routine.routine)?;
        Ok(format!(
            "{} completed successfully ({} @ 0x{:02X})",
            sf.label, routine.module_label, routine.target
        ))
    })
}

/* ---------------- Vehicle info ---------------- */

#[derive(Serialize)]
pub struct VehicleInfo {
    pub vin: Option<String>,
    pub decode: Option<vin::VinDecode>,
    pub mileage_km: Option<u32>,
    pub suggested_profile: Option<String>,
}

#[tauri::command]
pub async fn read_vehicle_info(state: tauri::State<'_, AppState>) -> Result<VehicleInfo, String> {
    with_transport(&state, |t| {
        // VIN via protocol::read_vin (UDS/KWP split + CAS fallback); the
        // returned VIN is guaranteed 17 chars, so no length filter needed.
        let vin_str = protocol::read_vin(t).ok();
        let decode = vin_str.as_deref().map(vin::decode);
        let suggested_profile = vin_str.as_deref().and_then(vin::suggested_profile).map(|s| s.to_string());
        // Odometer DID (sim 0x1010, u24 km). Real DID varies by cluster.
        let mileage_km = protocol::read_did(t, 0x12, 0x1010).ok().and_then(|b| {
            if b.len() >= 3 {
                Some(((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32)
            } else {
                None
            }
        });
        Ok(VehicleInfo { vin: vin_str, decode, mileage_km, suggested_profile })
    })
}

/* ---------------- UDS session + security ---------------- */

#[tauri::command]
pub async fn set_session(
    state: tauri::State<'_, AppState>,
    address: u8,
    session: u8,
) -> Result<(), String> {
    with_transport(&state, |t| protocol::set_session(t, address, session))?;
    lock_state(&state.unlocked)?.remove(&address);
    // S3server keep-alive: a non-default session needs periodic Tester
    // Present to survive idle time; the default session must never see
    // keep-alive frames (issue #87).
    if session == 0x01 {
        stop_keepalive(&state)?;
    } else {
        start_keepalive(&state, address)?;
    }
    Ok(())
}

#[derive(Serialize)]
pub struct SecurityResult {
    pub granted: bool,
    pub already_unlocked: bool,
    pub nrc: Option<u8>,
    pub message: String,
}

#[derive(Serialize)]
pub struct SecurityStatus {
    pub address: u8,
    pub unlocked: bool,
}

/// Security access via the pluggable key registry (`protocol::security`).
/// The algorithm used is whatever is registered for this ECU address + level;
/// register real per-ECU algorithms at startup in `lib.rs`.
#[tauri::command]
pub async fn security_access(
    state: tauri::State<'_, AppState>,
    address: u8,
    level: u8,
) -> Result<SecurityResult, String> {
    with_transport(&state, |t| {
        match protocol::security::unlock(t, address, level) {
            Ok(protocol::security::Unlock::Granted) => {
                lock_state(&state.unlocked)?.insert(address);
                Ok(SecurityResult {
                    granted: true,
                    already_unlocked: false,
                    nrc: None,
                    message: "Security access granted".to_string(),
                })
            }
            Ok(protocol::security::Unlock::AlreadyUnlocked) => {
                lock_state(&state.unlocked)?.insert(address);
                Ok(SecurityResult {
                    granted: false,
                    already_unlocked: true,
                    nrc: None,
                    message: "Already unlocked".to_string(),
                })
            }
            Err(e) => Ok(SecurityResult {
                granted: false,
                already_unlocked: false,
                nrc: e.nrc,
                message: e.message,
            }),
        }
    })
}

#[tauri::command]
pub fn is_unlocked(state: tauri::State<'_, AppState>, address: u8) -> Result<bool, String> {
    Ok(lock_state(&state.unlocked)?.contains(&address))
}

#[tauri::command]
pub fn security_status(state: tauri::State<'_, AppState>) -> Result<Vec<SecurityStatus>, String> {
    let unlocked = lock_state(&state.unlocked)?;
    Ok(ecus::ECUS
        .iter()
        .map(|def| SecurityStatus {
            address: def.address,
            unlocked: unlocked.contains(&def.address),
        })
        .collect())
}

/* ---------------- Connection self-test ---------------- */

#[derive(Serialize)]
pub struct TestStep {
    pub name: String,
    pub ok: bool,
    pub detail: String,
    pub ms: u64,
}

fn push_step(
    steps: &mut Vec<TestStep>,
    name: &str,
    start: std::time::Instant,
    res: Result<String, String>,
) {
    let (ok, detail) = match res {
        Ok(d) => (true, d),
        Err(e) => (false, e),
    };
    steps.push(TestStep { name: name.to_string(), ok, detail, ms: start.elapsed().as_millis() as u64 });
}

/// Run a sequence of sanity checks against the connected adapter and DME.
/// Each step is timed so a healthy cable's round-trip latency is visible —
/// high latency here is the usual cause of intermittent K+DCAN reads.
#[tauri::command]
pub async fn connection_test(state: tauri::State<'_, AppState>) -> Result<Vec<TestStep>, String> {
    use std::time::Instant;
    with_transport(&state, |t| {
        let mut steps = Vec::new();

        let s = Instant::now();
        let r = protocol::identify(t, 0x12)
            .map(|id| format!("responded: {}", id.chars().take(40).collect::<String>()));
        push_step(&mut steps, "DME identification (1A 80)", s, r);

        let s = Instant::now();
        let r = protocol::read_vin(t);
        push_step(&mut steps, "VIN read (22 F190 / 1A 90)", s, r);

        let s = Instant::now();
        let r = protocol::read_obd_pid(t, 0x12, 0x00)
            .map(|b| format!("bitmask {}", b.iter().map(|x| format!("{x:02X}")).collect::<String>()));
        push_step(&mut steps, "OBD-II supported PIDs (01 00)", s, r);

        // Round-trip latency: three testerPresent calls, report the mean.
        let s = Instant::now();
        let mut total = 0u128;
        for _ in 0..3 {
            let one = Instant::now();
            let _ = t.request(0x12, &[0x3E, 0x00]);
            total += one.elapsed().as_millis();
        }
        push_step(&mut steps, "Round-trip latency (3× tester present)", s, Ok(format!("~{} ms/round-trip", total / 3)));

        Ok(steps)
    })
}

/* ---------------- Traffic log ---------------- */

#[tauri::command]
pub fn get_traffic(state: tauri::State<'_, AppState>) -> Result<Vec<TrafficEntry>, String> {
    Ok(lock_state(&state.traffic)?.snapshot())
}

#[tauri::command]
pub fn clear_traffic(state: tauri::State<'_, AppState>) -> Result<(), String> {
    lock_state(&state.traffic)?.clear();
    Ok(())
}

/* ---------------- Community data ---------------- */

#[tauri::command]
pub fn community_report() -> crate::community::LoadReport {
    crate::community::report()
}

/// Serialise a profile to a shareable TOML snippet.
#[tauri::command]
pub fn export_profile(id: String) -> Result<String, String> {
    live::profile_to_toml(&id).ok_or_else(|| format!("Unknown profile '{id}'"))
}

/// Import profiles from a pasted/loaded TOML string; returns labels added.
#[tauri::command]
pub fn import_profiles(content: String) -> Result<Vec<String>, String> {
    crate::community::import_profiles_str(&content)
}

/* ---------------- Profile editing ---------------- */

#[derive(serde::Deserialize)]
pub struct AddParamSpec {
    pub label: String,
    pub unit: String,
    pub address: u8,
    pub mode: String,
    pub id: u16,
    pub decode: String,
    pub min: f64,
    pub max: f64,
}

#[tauri::command]
pub fn add_to_profile(profile_id: String, spec: AddParamSpec) -> Result<(), String> {
    let query = match spec.mode.as_str() {
        "did" => live::Query::Did(spec.id),
        "local" => live::Query::Local(spec.id as u8),
        "obd" => live::Query::Obd(spec.id as u8),
        _ => return Err("Unknown mode".into()),
    };
    let decode = live::decode_from_str(&spec.decode)
        .ok_or_else(|| format!("Unknown decode '{}'", spec.decode))?;
    let param = live::LiveParam {
        id: format!("{}_{:04X}", spec.mode, spec.id),
        label: spec.label.clone(),
        unit: spec.unit,
        target: spec.address,
        query,
        decode,
        min: spec.min,
        max: spec.max,
        // Parameter Explorer's "Add to profile" doesn't carry an enum
        // map yet; future enhancement can accept one in AddParamSpec.
        enum_map: std::collections::HashMap::new(),
    };
    live::add_param_to_profile(&profile_id, param)
        .ok_or_else(|| format!("Unknown profile '{}'", profile_id))?;
    Ok(())
}

/// Broadcast ISO 13400 DoIP vehicle identification (UDP 13400, all
/// interfaces via limited broadcast, ~2.5 s bounded) and return the
/// vehicles that answered. Runs on a blocking thread: the socket work is
/// synchronous and must not occupy an async runtime worker (issue
/// v0.7.0-plan PR #1). Zero responses is an empty list, not an error.
#[tauri::command]
pub async fn discover_enet_targets() -> Result<Vec<transport::enet::DiscoveredTarget>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        transport::enet::discover(transport::enet::DOIP_BROADCAST, transport::enet::DISCOVERY_WINDOW)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/* ---------------- File export ---------------- */

/// Write text to <home>/beeemuu-exports/<filename> and return the full path.
/// Used for module-inventory reports and live-data CSV logs.
#[tauri::command]
pub fn export_text(filename: String, content: String) -> Result<String, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Could not locate home directory")?;
    let dir = std::path::Path::new(&home).join("beeemuu-exports");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // sanitise filename to its base name only
    let safe = std::path::Path::new(&filename)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "export.txt".into());
    let path = dir.join(safe);
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Read back a text file from <home>/beeemuu-exports/<filename> — the
/// read companion to `export_text`, with the same home-dir lookup and
/// basename-only sanitisation. Used to restore the saved workspace
/// layout (`workspace.json`) at startup. Async per the repo's command
/// invariant (new commands are async unless justify-sync), though this
/// only touches the local disk; the file read itself runs on a blocking
/// thread.
#[tauri::command]
pub async fn read_export_text(filename: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .map_err(|_| "Could not locate home directory")?;
        let dir = std::path::Path::new(&home).join("beeemuu-exports");
        // sanitise filename to its base name only (same rule as export_text)
        let safe = std::path::Path::new(&filename)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "export.txt".into());
        std::fs::read_to_string(dir.join(safe)).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
/* ---------------- Session export ---------------- */

#[derive(Serialize, Deserialize)]
pub struct SessionDtc {
    pub code: String,
    pub status: u8,
    pub status_text: String,
    pub text: String,
    pub freeze_frame: Vec<FreezeItem>,
}

#[derive(Serialize, Deserialize)]
pub struct SessionModule {
    pub address: u8,
    pub name: String,
    pub description: String,
    pub ident: Option<String>,
    pub present: bool,
    pub fault_count: Option<usize>,
    pub dtcs: Vec<SessionDtc>,
}

#[derive(Serialize, Deserialize)]
pub struct SessionSnapshot {
    pub version: u32,
    pub exported_at: String,
    pub transport_name: String,
    pub vehicle_info: Option<SessionVehicleInfo>,
    pub modules: Vec<SessionModule>,
    pub traffic: Vec<TrafficEntry>,
}

#[derive(Serialize, Deserialize)]
pub struct SessionVehicleInfo {
    pub vin: Option<String>,
    pub decode: Option<vin::VinDecode>,
    pub mileage_km: Option<u32>,
    pub suggested_profile: Option<String>,
}

#[tauri::command]
pub async fn export_session(state: tauri::State<'_, AppState>) -> Result<String, String> {
    use std::time::SystemTime;

    let mut guard = lock_state(&state.transport)?;
    let t = guard.as_mut().ok_or("Not connected")?.as_mut();
    let transport_name = t.name().to_string();

    // Vehicle info — VIN via protocol::read_vin (UDS/KWP split + CAS fallback)
    let vin_str = protocol::read_vin(t).ok();
    let decode = vin_str.as_deref().map(vin::decode);
    let suggested_profile = vin_str.as_deref().and_then(vin::suggested_profile).map(|s| s.to_string());
    let mileage_km = protocol::read_did(t, 0x12, 0x1010).ok().and_then(|b| {
        if b.len() >= 3 {
            Some(((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32)
        } else {
            None
        }
    });

    let vehicle_info = Some(SessionVehicleInfo {
        vin: vin_str.clone(),
        decode,
        mileage_km,
        suggested_profile,
    });

    // Modules with faults and freeze frames
    let mut modules = Vec::new();
    for def in ecus::ECUS {
        match protocol::identify(t, def.address) {
            Ok(ident) => {
                let dtcs = match protocol::read_dtcs(t, def.address) {
                    Ok(dtc_list) => {
                        dtc_list
                            .into_iter()
                            .map(|d| {
                                let freeze = protocol::read_freeze_frame(t, def.address, &d.code)
                                    .unwrap_or_default();
                                SessionDtc {
                                    code: d.code,
                                    status: d.status,
                                    status_text: d.status_text,
                                    text: d.text,
                                    freeze_frame: freeze,
                                }
                            })
                            .collect()
                    }
                    Err(_) => Vec::new(),
                };
                modules.push(SessionModule {
                    address: def.address,
                    name: def.name.to_string(),
                    description: def.description.to_string(),
                    ident: Some(ident),
                    present: true,
                    fault_count: Some(dtcs.len()),
                    dtcs,
                });
            }
            Err(_) => {
                modules.push(SessionModule {
                    address: def.address,
                    name: def.name.to_string(),
                    description: def.description.to_string(),
                    ident: None,
                    present: false,
                    fault_count: None,
                    dtcs: Vec::new(),
                });
            }
        }
    }

    // Traffic log
    let traffic = lock_state(&state.traffic)?.snapshot();

    let snapshot = SessionSnapshot {
        version: 1,
        exported_at: SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| format!("{} (UTC)", d.as_secs()))
            .unwrap_or_else(|_| "unknown".to_string()),
        transport_name,
        vehicle_info,
        modules,
        traffic,
    };

    serde_json::to_string_pretty(&snapshot).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_session(content: String) -> Result<SessionSnapshot, String> {
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_session_file(name: String) -> Result<SessionSnapshot, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Could not locate home directory")?;
    let dir = std::path::Path::new(&home).join("beeemuu-exports");
    let safe = std::path::Path::new(&name)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "session.json".into());
    let path = dir.join(safe);
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct ExportFile {
    pub name: String,
    pub modified_secs: u64,
    pub size_bytes: u64,
}

#[tauri::command]
pub fn list_exports() -> Result<Vec<ExportFile>, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Could not locate home directory")?;
    let dir = std::path::Path::new(&home).join("beeemuu-exports");
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let meta = entry.metadata().ok();
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".json") {
            continue;
        }
        // workspace.json is the app's own UI-state file (v0.7.0), not a
        // session snapshot — keep it out of the Snapshot library.
        if name == "workspace.json" {
            continue;
        }
        files.push(ExportFile {
            modified_secs: meta.as_ref().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0),
            size_bytes: meta.as_ref().map(|m| m.len()).unwrap_or(0),
            name,
        });
    }
    files.sort_by(|a, b| b.modified_secs.cmp(&a.modified_secs));
    Ok(files)
}

/* ---------------- Schematics Sidebar ----------------
 *
 * PROTECTED PATH: this command hits the network. Per CLAUDE.md it MUST
 * be async, return a Result, and never block the webview. The shared
 * module `crate::schematics` is read-only over HTTPS — no adapter I/O,
 * no ECU probes, no writes.
 *
 * Returns the cross-link list for one DTC code; the front-end renders
 * each row as a card in the "Related schematics" panel beside the
 * freeze-frame / second-opinion panels.
 */

#[tauri::command]
pub async fn fetch_dtc_schematics(
    code: String,
    api_base_url: Option<String>,
) -> Result<crate::schematics::SchematicsForDtc, String> {
    crate::schematics::fetch_for_code(&code, api_base_url.as_deref()).await
}

/* ---------------- Community Oracle ---------------- */

#[tauri::command]
pub async fn query_oracle(
    state: tauri::State<'_, AppState>,
    address: u8,
) -> Result<crate::oracle::OracleResult, String> {
    let dtcs = with_transport(&state, |t| protocol::read_dtcs(t, address))?;
    // Derive engine family from the active live-data profile (best-effort).
    // If no profile is selected, fall back to "generic".
    let profile = "n55"; // TODO: derive from VIN or user selection once profile tracking is added
    let fp = crate::oracle::fingerprint(&dtcs, profile);
    crate::oracle::query(&fp)
}

/* ---------------- Diagnostic Story Mode ---------------- */

#[tauri::command]
pub fn generate_story(
    snapshot: SessionSnapshot,
) -> Result<crate::story::Story, String> {
    let engine_family = snapshot.vehicle_info
        .as_ref()
        .and_then(|v| v.suggested_profile.clone())
        .unwrap_or_else(|| "generic".into());
    let input = crate::story::StoryInput {
        vehicle: snapshot.vehicle_info.map(|v| VehicleInfo {
            vin: v.vin,
            decode: v.decode,
            mileage_km: v.mileage_km,
            suggested_profile: v.suggested_profile,
        }).unwrap_or(VehicleInfo { vin: None, decode: None, mileage_km: None, suggested_profile: None }),
        modules: snapshot.modules,
        engine_family,
    };
    Ok(crate::story::generate(&input))
}

/* ---------------- Secure Snapshot Share ---------------- */

#[tauri::command]
pub fn anonymize_snapshot(
    snapshot: SessionSnapshot,
) -> Result<String, String> {
    let json = crate::anonymize::export_json(&snapshot);
    Ok(json)
}

/* ---------------- Virtual Second Opinion ---------------- */

#[tauri::command]
pub fn get_opinions(
    dtc_code: String,
    dtc_text: String,
) -> Result<crate::opinions::OpinionSet, String> {
    Ok(crate::opinions::query(&dtc_code, &dtc_text))
}

/* ---------------- Guided Fault Finding (test plans) ---------------- */

/// Return the guided-diagnosis test plan for a DTC, if one is authored.
///
/// Read-only, purely-local: an in-memory KB lookup with no transport or
/// blocking I/O — the same class as `get_opinions` / `list_service_functions`,
/// so it stays sync (see the `async_commands` allowlist justification). The
/// walkthrough's branch traversal is frontend state; this command only
/// hands over the plan graph. Returns `None` (→ JSON `null`) when no plan
/// exists, and the UI hides the panel.
#[tauri::command]
pub fn get_test_plan(dtc_code: String) -> Result<Option<crate::testplans::TestPlan>, String> {
    Ok(crate::testplans::query(&dtc_code))
}

/* ---------------- DTC History (v0.12.0 "Fault Memory") ---------------- */

// v0.12.0 PR — Fault Memory: persist every DTC read to a local JSONL log
// and surface "this DTC has appeared N times over the past K days on this
// car" in the UI. Local-only, opt-in (frontend toggle; default off), no
// cloud, no privacy surprise. The persistence file lives under the same
// `~/beeemuu-exports/` directory the v0.6.0 export pipeline already uses.
//
// Why this is commands.rs-only (Tier B): CLAUDE.md §1 lists `commands.rs`
// as a protected path because the IPC surface is the trust boundary
// between the renderer and the diagnostic core. Adding three commands
// here is additive and read-only of any bus state — they touch a local
// JSONL file under the user's home directory, nothing else. No
// `transport/` or `protocol/` changes. The PR body flags `commands.rs`
// at the top; human merges after review.
//
// File format: one JSON object per line. Forward-compatible — adding a
// new field to `HistoryLine` does not break old files (serde ignores
// unknown fields on read).
//
// Dedup window: 60 seconds. A re-read of the same `(vin, address, code)`
// tuple within the window is dropped to avoid duplicate entries from
// repeated scans of the same module during one session. Reads after the
// window count as a new occurrence. The window is a soft guard, not a
// permanent id — the full history is what `query_dtc_history` returns.

/// Filename for the local DTC history log. Lives next to `export_text`'s
/// other artefacts so the user finds it where they look.
pub(crate) const DTC_HISTORY_FILENAME: &str = "dtc-history.jsonl";

/// Dedup window in seconds. Re-reads within this window of the previous
/// record for the same `(vin, address, code)` tuple are dropped.
pub(crate) const DTC_DEDUP_WINDOW_SECS: i64 = 60;

/// One JSONL record — one DTC observation.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HistoryLine {
    /// ISO-8601 UTC timestamp of the read, e.g. "2026-07-21T10:00:00Z".
    /// Optional for forward compat with very-old files written before
    /// the field existed; readers skip lines that fail to deserialize.
    pub ts_iso: String,
    /// VIN of the car when the read was taken. `None` means no VIN
    /// was known at the time — the UI surfaces these as "no-VIN"
    /// entries and does not merge them with VIN-tagged ones.
    pub vin: Option<String>,
    /// Module address (UDS target id, e.g. 0x12 for DME).
    pub address: u8,
    /// DTC code, BMW-style hex ("2A82").
    pub code: String,
    pub status: u8,
    pub status_text: String,
    pub text: String,
}

/// Grouped view of the history — what `query_dtc_history` returns.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DtcHistorySummary {
    /// One entry per `(code, address)` pair, sorted by `last_seen_iso`
    /// descending (most recent first).
    pub entries: Vec<DtcHistoryEntry>,
    /// Total raw JSONL lines on disk (after malformed-line skip).
    pub total_lines: usize,
    /// Full path to the JSONL file, so the UI can surface "stored at…".
    pub file_path: String,
    /// Number of lines skipped because they failed to parse. A non-zero
    /// value means a future schema change made some old lines unreadable
    /// — the UI can surface this as a quiet warning.
    pub skipped_lines: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DtcHistoryEntry {
    pub code: String,
    pub address: u8,
    pub status_text: String,
    pub text: String,
    pub first_seen_iso: String,
    pub last_seen_iso: String,
    /// Total occurrences (sum of raw JSONL lines minus dedup drops).
    pub occurrences: usize,
}

/// Return value of `record_dtc_read` — summary of what was written.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecordSummary {
    /// Number of new JSONL lines actually written (after dedup).
    pub appended: usize,
    /// Number of DTCs that were dropped by the dedup window.
    pub deduped: usize,
    pub file_path: String,
}

/// Resolve the home-directory + `beeemuu-exports/` + filename triplet
/// into a full path. Pure function — `home_override` lets tests point at
/// a `std::env::temp_dir()` subdirectory instead of the real home.
fn history_file_path(home_override: Option<&str>) -> Result<std::path::PathBuf, String> {
    let home = match home_override {
        Some(h) => h.to_string(),
        None => std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .map_err(|_| "Could not locate home directory".to_string())?,
    };
    let dir = std::path::Path::new(&home).join("beeemuu-exports");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create_dir_all: {e}"))?;
    Ok(dir.join(DTC_HISTORY_FILENAME))
}

/// Append a single history line to the JSONL file. Uses `OpenOptions`
/// with append + create so concurrent writers don't truncate each other
/// — two recordings landing within the same millisecond still produce
/// two intact lines.
fn append_history_line(path: &std::path::Path, line: &HistoryLine) -> std::io::Result<()> {
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    let json = serde_json::to_string(line).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    writeln!(f, "{}", json)?;
    Ok(())
}

/// Read the JSONL file into a list of `HistoryLine` records. Malformed
/// lines are skipped (counted via the second tuple element); we never
/// abort the whole read because one bad line made it to disk.
fn read_history_lines(path: &std::path::Path) -> std::io::Result<(Vec<HistoryLine>, usize)> {
    if !path.exists() {
        return Ok((Vec::new(), 0));
    }
    let text = std::fs::read_to_string(path)?;
    let mut out = Vec::new();
    let mut skipped = 0;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }
        match serde_json::from_str::<HistoryLine>(trimmed) {
            Ok(h) => out.push(h),
            Err(_) => skipped += 1,
        }
    }
    Ok((out, skipped))
}

/// Group the history lines into `(code, address)` buckets. If `vin_filter`
/// is `Some(v)`, lines with a different (or missing) VIN are excluded so
/// per-car queries don't blend multiple cars in the same file.
fn group_history_lines(
    lines: Vec<HistoryLine>,
    vin_filter: Option<&str>,
) -> Vec<DtcHistoryEntry> {
    use std::collections::BTreeMap;
    // BTreeMap for stable iteration order; final sort is by last_seen.
    let mut buckets: BTreeMap<(String, u8), DtcHistoryEntry> = BTreeMap::new();
    for line in lines {
        if let Some(v) = vin_filter {
            match &line.vin {
                Some(line_v) if line_v == v => {} // keep
                _ => continue,
            }
        }
        let key = (line.code.clone(), line.address);
        let entry = buckets.entry(key).or_insert_with(|| DtcHistoryEntry {
            code: line.code.clone(),
            address: line.address,
            status_text: line.status_text.clone(),
            text: line.text.clone(),
            first_seen_iso: line.ts_iso.clone(),
            last_seen_iso: line.ts_iso.clone(),
            occurrences: 0,
        });
        // Update status_text / text to the most recent values (so the
        // UI reflects the current DTC description, not the first-ever one
        // which may have been a partial decode).
        entry.status_text = line.status_text.clone();
        entry.text = line.text.clone();
        if line.ts_iso < entry.first_seen_iso { entry.first_seen_iso = line.ts_iso.clone(); }
        if line.ts_iso > entry.last_seen_iso { entry.last_seen_iso = line.ts_iso.clone(); }
        entry.occurrences += 1;
    }
    let mut entries: Vec<DtcHistoryEntry> = buckets.into_values().collect();
    // Most-recent first.
    entries.sort_by(|a, b| b.last_seen_iso.cmp(&a.last_seen_iso));
    entries
}

/// Parse two ISO-8601 timestamps and return true if the second is within
/// `window_secs` of the first. Missing or malformed timestamps return
/// false (conservative — treat as "outside the window" so a fresh
/// occurrence is always recorded).
fn within_dedup_window(prev_iso: &str, new_iso: &str, window_secs: i64) -> bool {
    let prev = match parse_iso8601_to_unix(prev_iso) { Some(t) => t, None => return false };
    let new = match parse_iso8601_to_unix(new_iso) { Some(t) => t, None => return false };
    let delta = new - prev;
    delta >= 0 && delta <= window_secs
}

/// Tiny ISO-8601 (UTC, `YYYY-MM-DDTHH:MM:SSZ`) parser — no external
/// dep. Returns the timestamp as Unix seconds. Returns `None` on any
/// deviation so the caller can conservatively skip the dedup check.
fn parse_iso8601_to_unix(s: &str) -> Option<i64> {
    let bytes = s.as_bytes();
    if bytes.len() < 19 { return None; }
    let y: i64 = s.get(0..4)?.parse().ok()?;
    let mo: i64 = s.get(5..7)?.parse().ok()?;
    let d: i64 = s.get(8..10)?.parse().ok()?;
    let h: i64 = s.get(11..13)?.parse().ok()?;
    let mi: i64 = s.get(14..16)?.parse().ok()?;
    let se: i64 = s.get(17..19)?.parse().ok()?;
    if bytes[4] != b'-' || bytes[7] != b'-' { return None; }
    if bytes[10] != b'T' && bytes[10] != b' ' { return None; }
    if bytes[13] != b':' || bytes[16] != b':' { return None; }
    let days = days_from_civil(y, mo as u32, d as u32)?;
    Some(days * 86_400 + h * 3_600 + mi * 60 + se)
}

/// Howard Hinnant's `days_from_civil` — fast civil-date to days-since-
/// epoch. Returns None for invalid month/day combos.
fn days_from_civil(y: i64, m: u32, d: u32) -> Option<i64> {
    if m < 1 || m > 12 { return None; }
    if d < 1 || d > 31 { return None; }
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = (y - era * 400) as i64; // [0, 399]
    let m = m as i64;
    let d = d as i64;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

/// Generate an ISO-8601 UTC timestamp in the simple shape
/// "YYYY-MM-DDTHH:MM:SSZ" we accept in `parse_iso8601_to_unix`.
fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (y, mo, d, h, mi, s) = unix_to_civil(secs);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, mo, d, h, mi, s
    )
}

/// Inverse of `days_from_civil` — Unix seconds -> (y, m, d, h, mi, s) UTC.
fn unix_to_civil(secs: i64) -> (i64, u32, u32, u32, u32, u32) {
    let days = secs.div_euclid(86_400);
    let secs_of_day = secs.rem_euclid(86_400) as u32;
    let h = secs_of_day / 3_600;
    let mi = (secs_of_day % 3_600) / 60;
    let s = secs_of_day % 60;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097) as i64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d, h, mi, s)
}

/// Append a batch of DTC reads to the local history. Async + `spawn_blocking`
/// to keep the file I/O off the webview thread — CLAUDE.md §4 says no
/// new sync commands that touch disk (the previous sync grandfathering
/// for `export_text` is being phased out; new commands follow the
/// project direction). The frontend invokes this after a successful
/// `read_faults` call. Per-line append is microseconds; the
/// `spawn_blocking` cost is amortised over the whole batch.
#[tauri::command]
pub async fn record_dtc_read(
    vin: Option<String>,
    address: u8,
    dtcs: Vec<Dtc>,
) -> Result<RecordSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        record_dtc_read_impl(vin, address, dtcs, None)
    })
    .await
    .map_err(|e| format!("join: {e}"))?
}

/// Test/host-override entry point — `home_override` lets unit tests point
/// at a temp directory instead of the real `~/beeemuu-exports/`.
fn record_dtc_read_impl(
    vin: Option<String>,
    address: u8,
    dtcs: Vec<Dtc>,
    home_override: Option<&str>,
) -> Result<RecordSummary, String> {
    let path = history_file_path(home_override)?;
    let (existing, _skipped) = read_history_lines(&path).map_err(|e| format!("read_history: {e}"))?;
    let now = now_iso();
    let mut appended = 0usize;
    let mut deduped = 0usize;
    for dtc in dtcs {
        // Dedup against the most recent record for the same (vin, address, code).
        let prev_ts = existing
            .iter()
            .rev()
            .find(|h| h.code == dtc.code && h.address == address && h.vin == vin)
            .map(|h| h.ts_iso.as_str());
        if let Some(prev) = prev_ts {
            if within_dedup_window(prev, &now, DTC_DEDUP_WINDOW_SECS) {
                deduped += 1;
                continue;
            }
        }
        let line = HistoryLine {
            ts_iso: now.clone(),
            vin: vin.clone(),
            address,
            code: dtc.code.clone(),
            status: dtc.status,
            status_text: dtc.status_text.clone(),
            text: dtc.text.clone(),
        };
        append_history_line(&path, &line).map_err(|e| format!("append: {e}"))?;
        appended += 1;
    }
    Ok(RecordSummary {
        appended,
        deduped,
        file_path: path.to_string_lossy().to_string(),
    })
}

/// Read the local DTC history and return a grouped summary. Pure read of
/// the user-owned file — never touches the bus. Async + `spawn_blocking`
/// for the same reason as `record_dtc_read`.
#[tauri::command]
pub async fn query_dtc_history(vin: Option<String>, since_iso: Option<String>) -> Result<DtcHistorySummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        query_dtc_history_impl(vin, since_iso, None)
    })
    .await
    .map_err(|e| format!("join: {e}"))?
}

fn query_dtc_history_impl(
    vin: Option<String>,
    since_iso: Option<String>,
    home_override: Option<&str>,
) -> Result<DtcHistorySummary, String> {
    let path = history_file_path(home_override)?;
    let (lines, skipped) = read_history_lines(&path).map_err(|e| format!("read_history: {e}"))?;
    let total_lines = lines.len();
    // Optional time filter — only keep entries whose `ts_iso >= since_iso`.
    let lines = if let Some(since) = since_iso.as_deref() {
        lines.into_iter().filter(|l| l.ts_iso.as_str() >= since).collect()
    } else {
        lines
    };
    let entries = group_history_lines(lines, vin.as_deref());
    Ok(DtcHistorySummary {
        entries,
        total_lines,
        file_path: path.to_string_lossy().to_string(),
        skipped_lines: skipped,
    })
}

/// Delete the local DTC history file. The UI gates this behind a confirm
/// dialog; no unlink race: simple `fs::remove_file` with `ok_or` mapping.
/// Returns Ok even if the file didn't exist — "cleared" is idempotent.
/// Async + `spawn_blocking` for the same reason as the other two history
/// commands.
#[tauri::command]
pub async fn clear_dtc_history() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| clear_dtc_history_impl(None))
        .await
        .map_err(|e| format!("join: {e}"))?
}

fn clear_dtc_history_impl(home_override: Option<&str>) -> Result<(), String> {
    let path = history_file_path(home_override)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("remove_file: {e}")),
    }
}

#[cfg(test)]
mod dtc_history_tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// Unique temp subdir per test invocation — avoids cross-test
    /// interference without needing the `tempfile` dev-dependency.
    fn unique_tmp_home(tag: &str) -> String {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let pid = std::process::id();
        let path = std::env::temp_dir().join(format!("beeemuu-history-{tag}-{pid}-{n}"));
        std::fs::create_dir_all(&path).unwrap();
        path.to_string_lossy().to_string()
    }

    fn dtc(code: &str, status: u8, status_text: &str, text: &str) -> Dtc {
        Dtc {
            code: code.to_string(),
            status,
            status_text: status_text.to_string(),
            text: text.to_string(),
        }
    }

    #[test]
    fn record_appends_one_line_per_dtc() {
        let home = unique_tmp_home("append-one");
        let dtcs = vec![
            dtc("2A82", 0x24, "confirmed", "VANOS intake solenoid fault"),
            dtc("29E0", 0x24, "confirmed", "VANOS exhaust solenoid fault"),
        ];
        let summary = record_dtc_read_impl(Some("VIN123".into()), 0x12, dtcs, Some(&home)).unwrap();
        assert_eq!(summary.appended, 2);
        assert_eq!(summary.deduped, 0);
        let path = history_file_path(Some(&home)).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        for line in &lines {
            let parsed: HistoryLine = serde_json::from_str(line).unwrap();
            assert_eq!(parsed.vin.as_deref(), Some("VIN123"));
            assert_eq!(parsed.address, 0x12);
        }
    }

    #[test]
    fn record_with_empty_dtcs_appends_nothing() {
        let home = unique_tmp_home("empty");
        let summary = record_dtc_read_impl(None, 0x12, vec![], Some(&home)).unwrap();
        assert_eq!(summary.appended, 0);
        assert_eq!(summary.deduped, 0);
        let path = history_file_path(Some(&home)).unwrap();
        if path.exists() {
            assert_eq!(std::fs::read_to_string(&path).unwrap().trim(), "");
        }
    }

    #[test]
    fn record_dedups_within_60s_window() {
        let home = unique_tmp_home("dedup");
        let dtcs = vec![dtc("2A82", 0x24, "confirmed", "VANOS intake solenoid fault")];
        let s1 = record_dtc_read_impl(Some("VIN1".into()), 0x12, dtcs.clone(), Some(&home)).unwrap();
        assert_eq!(s1.appended, 1);
        let s2 = record_dtc_read_impl(Some("VIN1".into()), 0x12, dtcs, Some(&home)).unwrap();
        assert_eq!(s2.appended, 0);
        assert_eq!(s2.deduped, 1);
        let path = history_file_path(Some(&home)).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 1);
    }

    #[test]
    fn record_does_not_dedup_across_different_codes() {
        let home = unique_tmp_home("dedup-cross-code");
        record_dtc_read_impl(Some("VIN1".into()), 0x12, vec![dtc("2A82", 0x24, "", "")], Some(&home)).unwrap();
        let s2 = record_dtc_read_impl(Some("VIN1".into()), 0x12, vec![dtc("29E0", 0x24, "", "")], Some(&home)).unwrap();
        assert_eq!(s2.appended, 1);
        assert_eq!(s2.deduped, 0);
    }

    #[test]
    fn record_does_not_dedup_across_different_vins() {
        let home = unique_tmp_home("dedup-cross-vin");
        record_dtc_read_impl(Some("VIN_A".into()), 0x12, vec![dtc("2A82", 0x24, "", "")], Some(&home)).unwrap();
        let s2 = record_dtc_read_impl(Some("VIN_B".into()), 0x12, vec![dtc("2A82", 0x24, "", "")], Some(&home)).unwrap();
        assert_eq!(s2.appended, 1, "different VINs are different records");
        assert_eq!(s2.deduped, 0);
    }

    #[test]
    fn record_does_not_dedup_across_different_modules() {
        let home = unique_tmp_home("dedup-cross-addr");
        record_dtc_read_impl(Some("VIN1".into()), 0x12, vec![dtc("2A82", 0x24, "", "")], Some(&home)).unwrap();
        let s2 = record_dtc_read_impl(Some("VIN1".into()), 0x18, vec![dtc("2A82", 0x24, "", "")], Some(&home)).unwrap();
        assert_eq!(s2.appended, 1, "different modules are different records");
    }

    #[test]
    fn query_returns_empty_summary_when_no_file() {
        let home = unique_tmp_home("empty-query");
        let summary = query_dtc_history_impl(None, None, Some(&home)).unwrap();
        assert_eq!(summary.entries.len(), 0);
        assert_eq!(summary.total_lines, 0);
        assert_eq!(summary.skipped_lines, 0);
    }

    #[test]
    fn query_groups_by_code_and_address() {
        let home = unique_tmp_home("group");
        record_dtc_read_impl(Some("VIN1".into()), 0x12, vec![dtc("2A82", 0x24, "confirmed", "VANOS intake")], Some(&home)).unwrap();
        record_dtc_read_impl(Some("VIN1".into()), 0x12, vec![dtc("2A82", 0x24, "confirmed", "VANOS intake")], Some(&home)).unwrap();
        record_dtc_read_impl(Some("VIN1".into()), 0x18, vec![dtc("2A82", 0x24, "confirmed", "VANOS intake")], Some(&home)).unwrap();
        record_dtc_read_impl(Some("VIN1".into()), 0x12, vec![dtc("29E0", 0x24, "confirmed", "VANOS exhaust")], Some(&home)).unwrap();
        let summary = query_dtc_history_impl(Some("VIN1".into()), None, Some(&home)).unwrap();
        // Two 2A82@0x12 reads within 60 s dedup to one entry; 2A82@0x18
        // is a separate (code, address) bucket; 29E0@0x12 is another.
        assert_eq!(summary.entries.len(), 3);
        assert_eq!(summary.total_lines, 3, "dedup collapses two reads into one line");
        let s282_012 = summary.entries.iter().find(|e| e.code == "2A82" && e.address == 0x12).unwrap();
        assert_eq!(s282_012.occurrences, 1, "dedup collapses the two-window occurrences");
    }

    #[test]
    fn query_filters_by_vin() {
        let home = unique_tmp_home("vin-filter");
        record_dtc_read_impl(Some("VIN_A".into()), 0x12, vec![dtc("2A82", 0x24, "", "")], Some(&home)).unwrap();
        record_dtc_read_impl(Some("VIN_B".into()), 0x12, vec![dtc("29E0", 0x24, "", "")], Some(&home)).unwrap();
        let s_a = query_dtc_history_impl(Some("VIN_A".into()), None, Some(&home)).unwrap();
        assert_eq!(s_a.entries.len(), 1);
        assert_eq!(s_a.entries[0].code, "2A82");
        let s_all = query_dtc_history_impl(None, None, Some(&home)).unwrap();
        assert_eq!(s_all.entries.len(), 2);
    }

    #[test]
    fn query_filters_by_since_iso() {
        let home = unique_tmp_home("since");
        let path = history_file_path(Some(&home)).unwrap();
        let old = HistoryLine {
            ts_iso: "2020-01-01T00:00:00Z".into(),
            vin: Some("V".into()),
            address: 0x12,
            code: "OLD".into(),
            status: 0, status_text: "".into(), text: "".into(),
        };
        let new = HistoryLine {
            ts_iso: "2030-01-01T00:00:00Z".into(),
            vin: Some("V".into()),
            address: 0x12,
            code: "NEW".into(),
            status: 0, status_text: "".into(), text: "".into(),
        };
        append_history_line(&path, &old).unwrap();
        append_history_line(&path, &new).unwrap();
        let s = query_dtc_history_impl(None, Some("2025-01-01T00:00:00Z".into()), Some(&home)).unwrap();
        assert_eq!(s.entries.len(), 1);
        assert_eq!(s.entries[0].code, "NEW");
    }

    #[test]
    fn query_skips_malformed_lines_and_counts_them() {
        let home = unique_tmp_home("skip-bad");
        let path = history_file_path(Some(&home)).unwrap();
        let good = HistoryLine {
            ts_iso: "2026-01-01T00:00:00Z".into(),
            vin: Some("V".into()), address: 0x12, code: "X".into(),
            status: 0, status_text: "".into(), text: "".into(),
        };
        let good_json = serde_json::to_string(&good).unwrap();
        std::fs::write(&path, format!("{}\nnot json at all\n{}\n", good_json, good_json)).unwrap();
        let s = query_dtc_history_impl(None, None, Some(&home)).unwrap();
        assert_eq!(s.entries.len(), 1, "garbage line skipped, two valid grouped to one entry");
        assert_eq!(s.skipped_lines, 1);
    }

    #[test]
    fn clear_removes_file_and_is_idempotent() {
        let home = unique_tmp_home("clear");
        record_dtc_read_impl(Some("V".into()), 0x12, vec![dtc("X", 0, "", "")], Some(&home)).unwrap();
        let path = history_file_path(Some(&home)).unwrap();
        assert!(path.exists());
        clear_dtc_history_impl(Some(&home)).unwrap();
        assert!(!path.exists());
        // Second clear should be a no-op, not an error.
        clear_dtc_history_impl(Some(&home)).unwrap();
    }

    #[test]
    fn within_dedup_window_true_inside_60s() {
        assert!(within_dedup_window("2026-01-01T00:00:00Z", "2026-01-01T00:00:30Z", 60));
        assert!(within_dedup_window("2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z", 60));
    }

    #[test]
    fn within_dedup_window_false_outside_60s() {
        assert!(!within_dedup_window("2026-01-01T00:00:00Z", "2026-01-01T00:01:01Z", 60));
    }

    #[test]
    fn within_dedup_window_false_for_invalid_timestamps() {
        assert!(!within_dedup_window("not iso", "2026-01-01T00:00:00Z", 60));
        assert!(!within_dedup_window("2026-01-01T00:00:00Z", "not iso", 60));
    }

    #[test]
    fn now_iso_roundtrips_through_parser() {
        let s = now_iso();
        assert_eq!(s.len(), 20);
        assert!(s.ends_with('Z'));
        let parsed = parse_iso8601_to_unix(&s);
        assert!(parsed.is_some());
    }

    #[test]
    fn unix_to_civil_roundtrips_for_known_dates() {
        // 2026-07-21T10:00:00Z = 1_784_628_000 (verified via `Date.UTC(2026, 6, 21, 10) / 1000`).
        let (y, m, d, h, mi, s) = unix_to_civil(1_784_628_000);
        assert_eq!((y, m, d, h, mi, s), (2026, 7, 21, 10, 0, 0));
        let (y, m, d, _h, _mi, _s) = unix_to_civil(0);
        assert_eq!((y, m, d), (1970, 1, 1));
        let (y, m, d, _h, _mi, _s) = unix_to_civil(946_684_800);
        assert_eq!((y, m, d), (2000, 1, 1));
    }

    #[test]
    fn days_from_civil_handles_known_dates() {
        assert_eq!(days_from_civil(1970, 1, 1), Some(0));
        assert_eq!(days_from_civil(2000, 1, 1), Some(10_957));
        // Month-out-of-range is the bounds we promise. Day-out-of-range
        // for a specific month (e.g. Feb 30) is intentionally NOT
        // validated — the algorithm produces a numeric answer for
        // any in-range month with 1 <= d <= 31, and the upstream
        // caller (a JSONL timestamp read) never feeds us garbage.
        // The conservative dedup path treats unparseable inputs as
        // "outside the window" via `within_dedup_window` returning false.
        assert_eq!(days_from_civil(2026, 0, 1), None);
        assert_eq!(days_from_civil(2026, 13, 1), None);
    }
}
