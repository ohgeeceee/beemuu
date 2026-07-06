pub mod analysis;
pub mod commands;
pub mod community;
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

/// Register per-ECU freeze-frame schemas here once mapped on a real car.
///
/// The registry ships with the simulator's 9-byte default. Add exact-address
/// schemas as you confirm layouts with the Parameter Explorer. Example:
///
/// ```ignore
/// use data::freeze::{registry, FreezeField, FreezeSchema, Width};
/// registry().register_for(0x12, FreezeSchema { fields: vec![
///     FreezeField::new("Engine speed", "rpm", 0, Width::U16, 1.0, 0.0, 0),
///     FreezeField::new("Oil temp", "°C", 2, Width::U8, 1.0, -48.0, 0),
/// ]});
/// ```
fn register_freeze_schemas() {
    let _ = data::freeze::registry();
    // (Add mapped per-ECU schemas here.)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    register_security_algorithms();
    register_freeze_schemas();
    // Merge community-contributed TOML data (fault texts, profiles, schemas).
    let rep = community::load();
    eprintln!(
        "community data: {} fault texts, {} profiles, {} freeze schemas{}",
        rep.dtc_texts,
        rep.profiles,
        rep.freeze_schemas,
        rep.dir.map(|d| format!(" from {d}")).unwrap_or_default()
    );

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
            commands::watch_start,
            commands::watch_tick,
            commands::watch_stop,
            commands::list_service_functions,
            commands::run_service_function,
            commands::read_vehicle_info,
            commands::set_session,
            commands::security_access,
            commands::community_report,
            commands::add_to_profile,
            commands::export_profile,
            commands::import_profiles,
            commands::connection_test,
            commands::get_traffic,
            commands::clear_traffic,
            commands::export_text,
            commands::analyze_chart,
            commands::open_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
