pub mod commands;
pub mod data;
pub mod protocol;
pub mod transport;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::list_ports,
            commands::connect,
            commands::disconnect,
            commands::scan_modules,
            commands::read_faults,
            commands::clear_faults,
            commands::list_profiles,
            commands::read_live_data,
            commands::probe_range,
            commands::read_raw,
            commands::list_service_functions,
            commands::run_service_function,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
