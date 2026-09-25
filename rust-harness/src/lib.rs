//! Harness crate root — mirrors src-tauri/src/lib.rs's module tree for the
//! closed dependency set that the real crate compiles without Tauri:
//!
//!   transport (enet/record/sim real; kdcan/isotp stubbed)
//!   data (ecus/dtc/freeze/live/service_functions/vin — real)
//!   community (real)
//!   protocol (mod + security — real)
//!
//! `commands.rs` is NOT a module here (it needs Tauri). It is symlinked in
//! purely so `protocol::vin_tests::command_layer_has_no_raw_vin_did_reads`
//! can static-scan the real source (the VIN invariant).
//!
//! Do not write through the symlinks: `write_file`/`patch` at a symlinked
//! path clobbers the real file. Copy or `unlink` first.

pub mod transport;
pub mod data;
pub mod community;
pub mod protocol;
