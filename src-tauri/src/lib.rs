pub mod commands;
pub mod data;
pub mod protocol;
pub mod transport;

/// Register real per-ECU SecurityAccess key algorithms here.
///
/// The registry ships with the simulator's default (seed XOR 0x5AA51234 at
/// level 0x01). Add your reverse-engineered per-module algorithms below;
/// exact (address, level) entries override the default. Example:
///
/// ```ignore
/// use protocol::security::{registry, algo};
/// registry().register_for(0x12, 0x01, algo::add_u32(0x00C0_FFEE)); // DME
/// registry().register_for(0x29, 0x01, Box::new(|seed| my_dsc_key(seed)));
/// ```
fn register_security_algorithms() {
    // Touch the registry so its default is installed before first use.
    let _ = protocol::security::registry();
    // (No proprietary algorithms bundled — add yours here.)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    register_security_algorithms();

    tauri::Builder::default()
        .manage(commands::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::list_ports,
            commands::connect,
            commands::disconnect,
            commands::scan_modules,
            commands::read_faults,
            commands::read_freeze_frame,
            commands::clear_faults,
            commands::list_profiles,
            commands::read_live_data,
            commands::probe_range,
            commands::read_raw,
            commands::list_service_functions,
            commands::run_service_function,
            commands::read_vehicle_info,
            commands::set_session,
            commands::security_access,
            commands::export_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
