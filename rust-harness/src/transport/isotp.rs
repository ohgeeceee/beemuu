//! Deliberately empty stand-in for the real `isotp.rs`.
//!
//! The real file is 430 LOC of ISO-TP reassembly whose own tests call
//! `crate::protocol::{read_vin, read_dtcs, identify}`, which would drag in
//! `data/` + `community/` and the whole TOML/community overlay. isotp is not
//! touched by this change, so it is left out of the harness; CI compiles and
//! tests it.
//!
//! NOTE: this is a real file, not a symlink into the repo. Writing a stub at a
//! symlinked path writes *through* the link and clobbers the repo file (that
//! happened once — 421 lines of the real isotp.rs).
//!
//! What THIS harness is for: compiling the real `mod.rs` (the shared
//! `TransportError` change) together with the real enet / record / sim
//! modules, and running their tests.

use super::Result;
use std::time::Instant;

/// Verbatim copy of the real `isotp::CanBus` declaration — `sim.rs` implements
/// `super::isotp::CanBus for SimCanBus`, so the trait has to exist here for the
/// real sim module to compile. Keep in sync with `isotp.rs`.
pub trait CanBus: Send {
    fn send_frame(&mut self, target: u8, frame: &[u8]) -> Result<()>;
    fn recv_frame(&mut self, target: u8, deadline: Instant) -> Result<Vec<u8>>;
}
