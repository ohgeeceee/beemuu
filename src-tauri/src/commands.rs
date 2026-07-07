//! Tauri commands — the bridge between the frontend and the diagnostic stack.

use crate::analysis::{ByteWatcher, WatchSnapshot};
use crate::data::{ecus, freeze, live, service_functions, vin};
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
    pub transport: Mutex<Option<Box<dyn Transport>>>,
    watch: Mutex<Option<WatchSession>>,
    traffic: SharedLog,
    pub unlocked: Mutex<HashSet<u8>>,
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
pub fn connect(
    state: tauri::State<'_, AppState>,
    config: TransportConfig,
) -> Result<ConnectionInfo, String> {
    let inner = transport::open(&config).map_err(|e| e.to_string())?;
    // Fresh session: reset the traffic log and wrap the transport so every
    // request/response from here on is recorded.
    state.traffic.lock().unwrap().clear();
    let mut t: Box<dyn Transport> =
        Box::new(RecordingTransport::new(inner, Arc::clone(&state.traffic)));
    let name = t.name().to_string();
    // Best effort VIN read from DME (DID F190)
    let vin = protocol::read_did(t.as_mut(), 0x12, 0xF190)
        .ok()
        .map(|b| String::from_utf8_lossy(&b).trim_matches(char::from(0)).to_string());
    let suggested_profile = vin.as_deref().and_then(vin::suggested_profile).map(|s| s.to_string());
    *state.transport.lock().unwrap() = Some(t);
    Ok(ConnectionInfo { transport_name: name, vin, suggested_profile })
}

#[tauri::command]
pub fn disconnect(state: tauri::State<'_, AppState>) {
    if let Some(mut t) = state.transport.lock().unwrap().take() {
        t.disconnect();
    }
    state.unlocked.lock().unwrap().clear();
}

fn with_transport<T>(
    state: &tauri::State<'_, AppState>,
    f: impl FnOnce(&mut dyn Transport) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state.transport.lock().unwrap();
    let t = guard.as_mut().ok_or("Not connected")?;
    f(t.as_mut())
}

/// Probe every known ECU address: ident + fault count. This is the
/// ISTA-style "vehicle test" that builds the module tree.
#[tauri::command]
pub fn scan_modules(state: tauri::State<'_, AppState>) -> Result<Vec<EcuInfo>, String> {
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

#[tauri::command]
pub fn read_faults(state: tauri::State<'_, AppState>, address: u8) -> Result<Vec<Dtc>, String> {
    with_transport(&state, |t| protocol::read_dtcs(t, address))
}

#[tauri::command]
pub fn read_freeze_frame(
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
    // Parameter Hunt: +100 for a confirmed freeze-frame schema.
    crate::hunt::record_schema(address);
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
pub fn preview_freeze_frame(
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
pub fn clear_faults(state: tauri::State<'_, AppState>, address: u8) -> Result<(), String> {
    with_transport(&state, |t| protocol::clear_dtcs(t, address))
}

#[derive(Serialize)]
pub struct ProfileInfo {
    pub id: String,
    pub label: String,
}

#[tauri::command]
pub fn list_profiles() -> Vec<ProfileInfo> {
    live::profile_list()
        .into_iter()
        .map(|(id, label)| ProfileInfo { id, label })
        .collect()
}

/// One polling sweep over a profile's parameters. Frontend calls this on a timer.
#[tauri::command]
pub fn read_live_data(
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
                if let Some(value) = live::decode(def.decode, &data) {
                    out.push(live::LiveValue {
                        id: def.id.clone(),
                        label: def.label.clone(),
                        unit: def.unit.clone(),
                        value,
                        min: def.min,
                        max: def.max,
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
pub fn probe_range(
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
        // Simulator discoveries are practice runs: logged, but 0 points.
        let practice = t.name().to_ascii_lowercase().contains("sim");
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
        // Parameter Hunt: +10 per never-before-seen responding identifier.
        let ids: Vec<u16> = found.iter().map(|f| f.id).collect();
        crate::hunt::record_discoveries(address, &mode, &ids, practice);
        Ok(found)
    })
}

/// Single raw read for watch mode — poll one ident and see which bytes move.
#[tauri::command]
pub fn read_raw(
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
    *state.watch.lock().unwrap() = Some(WatchSession {
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
pub fn watch_tick(state: tauri::State<'_, AppState>) -> Result<WatchSnapshot, String> {
    let (address, mode, id) = {
        let guard = state.watch.lock().unwrap();
        let s = guard.as_ref().ok_or("No active watch")?;
        (s.address, s.mode.clone(), s.id)
    };
    let data = with_transport(&state, |t| probe_read(t, &mode, address, id))?;
    let mut guard = state.watch.lock().unwrap();
    let s = guard.as_mut().ok_or("Watch stopped")?;
    s.watcher.feed(&data);
    Ok(s.watcher.snapshot())
}

#[tauri::command]
pub fn watch_stop(state: tauri::State<'_, AppState>) {
    *state.watch.lock().unwrap() = None;
}

#[tauri::command]
pub fn list_service_functions() -> Vec<service_functions::ServiceFunction> {
    service_functions::SERVICE_FUNCTIONS.to_vec()
}

#[tauri::command]
pub fn run_service_function(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<String, String> {
    let sf = service_functions::SERVICE_FUNCTIONS
        .iter()
        .find(|s| s.id == id)
        .ok_or("Unknown service function")?;
    with_transport(&state, |t| {
        protocol::routine(t, sf.target, 0x01, sf.routine)?;
        Ok(format!("{} completed successfully", sf.label))
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
pub fn read_vehicle_info(state: tauri::State<'_, AppState>) -> Result<VehicleInfo, String> {
    with_transport(&state, |t| {
        let vin_str = protocol::read_did(t, 0x12, 0xF190)
            .ok()
            .map(|b| String::from_utf8_lossy(&b).trim_matches(char::from(0)).trim().to_string())
            .filter(|s| s.len() >= 11);
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
pub fn set_session(
    state: tauri::State<'_, AppState>,
    address: u8,
    session: u8,
) -> Result<(), String> {
    with_transport(&state, |t| protocol::set_session(t, address, session))?;
    state.unlocked.lock().unwrap().remove(&address);
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
pub fn security_access(
    state: tauri::State<'_, AppState>,
    address: u8,
    level: u8,
) -> Result<SecurityResult, String> {
    with_transport(&state, |t| {
        match protocol::security::unlock(t, address, level) {
            Ok(protocol::security::Unlock::Granted) => {
                state.unlocked.lock().unwrap().insert(address);
                Ok(SecurityResult {
                    granted: true,
                    already_unlocked: false,
                    nrc: None,
                    message: "Security access granted".to_string(),
                })
            }
            Ok(protocol::security::Unlock::AlreadyUnlocked) => {
                state.unlocked.lock().unwrap().insert(address);
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
pub fn is_unlocked(state: tauri::State<'_, AppState>, address: u8) -> bool {
    state.unlocked.lock().unwrap().contains(&address)
}

#[tauri::command]
pub fn security_status(state: tauri::State<'_, AppState>) -> Vec<SecurityStatus> {
    let unlocked = state.unlocked.lock().unwrap();
    ecus::ECUS
        .iter()
        .map(|def| SecurityStatus {
            address: def.address,
            unlocked: unlocked.contains(&def.address),
        })
        .collect()
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
pub fn connection_test(state: tauri::State<'_, AppState>) -> Result<Vec<TestStep>, String> {
    use std::time::Instant;
    with_transport(&state, |t| {
        let mut steps = Vec::new();

        let s = Instant::now();
        let r = protocol::identify(t, 0x12)
            .map(|id| format!("responded: {}", id.chars().take(40).collect::<String>()));
        push_step(&mut steps, "DME identification (1A 80)", s, r);

        let s = Instant::now();
        let r = protocol::read_did(t, 0x12, 0xF190)
            .map(|b| String::from_utf8_lossy(&b).trim_matches(char::from(0)).trim().to_string())
            .map(|v| if v.is_empty() { "empty".into() } else { v });
        push_step(&mut steps, "VIN read (22 F190)", s, r);

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
pub fn get_traffic(state: tauri::State<'_, AppState>) -> Vec<TrafficEntry> {
    state.traffic.lock().unwrap().snapshot()
}

#[tauri::command]
pub fn clear_traffic(state: tauri::State<'_, AppState>) {
    state.traffic.lock().unwrap().clear();
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
    };
    live::add_param_to_profile(&profile_id, param)
        .ok_or_else(|| format!("Unknown profile '{}'", profile_id))?;
    // Parameter Hunt: +50 for mapping an unknown byte to a physical value.
    crate::hunt::record_mapping(spec.address, &spec.mode, spec.id, &spec.label);
    Ok(())
}

fn find_python() -> Result<String, String> {
    for cmd in &["python", "python3", "py"] {
        if std::process::Command::new(cmd)
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return Ok(cmd.to_string());
        }
    }
    Err("Python not found. Please install Python and ensure it is on PATH.".into())
}

fn find_script(name: &str) -> Result<std::path::PathBuf, String> {
    let mut candidates = vec![
        std::path::PathBuf::from(format!("scripts/{}", name)),
        std::path::PathBuf::from(format!("../scripts/{}", name)),
    ];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(format!("scripts/{}", name)));
            candidates.push(dir.join(format!("../scripts/{}", name)));
            candidates.push(dir.join(format!("../../scripts/{}", name)));
        }
    }
    for c in &candidates {
        if c.exists() {
            return Ok(c.clone());
        }
    }
    Err(format!("{} not found. Searched: {}", name,
        candidates.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(", ")))
}

#[tauri::command]
pub fn analyze_chart(csv_content: String, filename: String) -> Result<String, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Could not locate home directory")?;
    let dir = std::path::Path::new(&home).join("beeemuu-exports");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let safe = std::path::Path::new(&filename)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "log.csv".into());
    let csv_path = dir.join(&safe);
    std::fs::write(&csv_path, csv_content).map_err(|e| e.to_string())?;

    let python = find_python()?;
    let script = find_script("chart_playback.py")?;
    let output_name = safe.replace(".csv", "_analysis.png").replace(".CSV", "_analysis.png");
    let output_path = dir.join(&output_name);

    let output = std::process::Command::new(&python)
        .arg(&script)
        .arg(&csv_path)
        .arg("-o")
        .arg(&output_path)
        .output()
        .map_err(|e| format!("Failed to run Python: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Chart playback failed: {}", stderr));
    }

    Ok(output_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let path = std::path::Path::new(&path);
    if !path.exists() {
        return Err("File does not exist".into());
    }
    let path_str = path.to_string_lossy();

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &path_str])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path_str)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path_str)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
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
pub fn export_session(state: tauri::State<'_, AppState>) -> Result<String, String> {
    use std::time::SystemTime;

    let mut guard = state.transport.lock().unwrap();
    let t = guard.as_mut().ok_or("Not connected")?.as_mut();
    let transport_name = t.name().to_string();

    // Vehicle info
    let vin_str = protocol::read_did(t, 0x12, 0xF190)
        .ok()
        .map(|b| String::from_utf8_lossy(&b).trim_matches(char::from(0)).trim().to_string())
        .filter(|s| s.len() >= 11);
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
    let traffic = state.traffic.lock().unwrap().snapshot();

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
        files.push(ExportFile {
            modified_secs: meta.as_ref().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0),
            size_bytes: meta.as_ref().map(|m| m.len()).unwrap_or(0),
            name,
        });
    }
    files.sort_by(|a, b| b.modified_secs.cmp(&a.modified_secs));
    Ok(files)
}

/* ---------------- Community Oracle ---------------- */

#[tauri::command]
pub fn query_oracle(
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

/* ---------------- Parameter Hunt ---------------- */

#[tauri::command]
pub fn hunt_status() -> crate::hunt::HuntStatus {
    crate::hunt::status()
}

#[tauri::command]
pub fn hunt_leaderboard() -> Vec<crate::hunt::LeaderboardEntry> {
    crate::hunt::leaderboard()
}

#[tauri::command]
pub fn hunt_set_alias(alias: String) -> Result<(), String> {
    crate::hunt::set_alias(&alias)
}

/* ---------------- Virtual Second Opinion ---------------- */

#[tauri::command]
pub fn get_opinions(
    dtc_code: String,
    dtc_text: String,
) -> Result<crate::opinions::OpinionSet, String> {
    Ok(crate::opinions::query(&dtc_code, &dtc_text))
}
