//! Tauri commands — the bridge between the frontend and the diagnostic stack.

use crate::data::{ecus, live, service_functions};
use crate::protocol::{self, Dtc, EcuInfo};
use crate::transport::{self, Transport, TransportConfig};
use serde::Serialize;
use std::sync::Mutex;

#[derive(Default)]
pub struct AppState {
    pub transport: Mutex<Option<Box<dyn Transport>>>,
}

#[derive(Serialize)]
pub struct ConnectionInfo {
    pub transport_name: String,
    pub vin: Option<String>,
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
    let mut t = transport::open(&config).map_err(|e| e.to_string())?;
    let name = t.name().to_string();
    // Best effort VIN read from DME (DID F190)
    let vin = protocol::read_did(t.as_mut(), 0x12, 0xF190)
        .ok()
        .map(|b| String::from_utf8_lossy(&b).trim_matches(char::from(0)).to_string());
    *state.transport.lock().unwrap() = Some(t);
    Ok(ConnectionInfo { transport_name: name, vin })
}

#[tauri::command]
pub fn disconnect(state: tauri::State<'_, AppState>) {
    if let Some(mut t) = state.transport.lock().unwrap().take() {
        t.disconnect();
    }
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
pub fn clear_faults(state: tauri::State<'_, AppState>, address: u8) -> Result<(), String> {
    with_transport(&state, |t| protocol::clear_dtcs(t, address))
}

#[derive(Serialize)]
pub struct ProfileInfo {
    pub id: &'static str,
    pub label: &'static str,
}

#[tauri::command]
pub fn list_profiles() -> Vec<ProfileInfo> {
    live::PROFILES
        .iter()
        .map(|p| ProfileInfo { id: p.id, label: p.label })
        .collect()
}

/// One polling sweep over a profile's parameters. Frontend calls this on a timer.
#[tauri::command]
pub fn read_live_data(
    state: tauri::State<'_, AppState>,
    profile: String,
) -> Result<Vec<live::LiveValue>, String> {
    let prof = live::profile(&profile).ok_or("Unknown profile")?;
    with_transport(&state, |t| {
        let mut out = Vec::new();
        for def in prof.params {
            let data = match def.query {
                live::Query::Did(did) => protocol::read_did(t, def.target, did),
                live::Query::Obd(pid) => protocol::read_obd_pid(t, def.target, pid),
            };
            if let Ok(data) = data {
                if let Some(value) = live::decode(def, &data) {
                    out.push(live::LiveValue {
                        id: def.id,
                        label: def.label,
                        unit: def.unit,
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
pub fn read_raw(
    state: tauri::State<'_, AppState>,
    address: u8,
    mode: String,
    id: u16,
) -> Result<Vec<u8>, String> {
    with_transport(&state, |t| probe_read(t, &mode, address, id))
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
