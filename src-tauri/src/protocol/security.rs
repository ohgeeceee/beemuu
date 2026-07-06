//! UDS SecurityAccess (service 0x27) — pluggable seed→key registry.
//!
//! This module separates *policy* (which key-generation algorithm belongs to
//! which ECU) from *mechanism* (the seed/key request exchange over the bus).
//!
//! ## Registering an algorithm
//!
//! A `KeyFn` takes the module's seed bytes and returns the key bytes. Register
//! per ECU address + security level, or install a default that applies to any
//! address at a given level:
//!
//! ```ignore
//! use crate::protocol::security::{registry, algo};
//!
//! // Exact: DME (0x12), level 0x01 uses your reverse-engineered algorithm.
//! registry().register_for(0x12, 0x01, Box::new(|seed| my_dme_key(seed)));
//!
//! // Fallback for any ECU at level 0x01 (e.g. the simulator).
//! registry().register_default(0x01, algo::xor_u32(0x5AA5_1234));
//! ```
//!
//! Real BMW seed/key algorithms are proprietary and undisclosed; supply your
//! own `KeyFn` from your own sources. The `algo` submodule only provides the
//! generic building blocks (XOR, additive, rotate) and the simulator's key.

use crate::transport::Transport;
use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

/// Rich error returned by the security exchange so the UI can show NRC-aware messages.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecurityError {
    pub nrc: Option<u8>,
    pub message: String,
}

impl std::fmt::Display for SecurityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

/// Seed bytes in, key bytes out. Boxed so plain `fn`s and stateful closures
/// both work; `Send + Sync` so the registry can be a process-global.
pub type KeyFn = Box<dyn Fn(&[u8]) -> Vec<u8> + Send + Sync>;

/// Lookup key: `None` address = default for that level.
type Slot = (Option<u8>, u8);

/// Process-wide registry of key-generation algorithms.
pub struct SecurityRegistry {
    map: RwLock<HashMap<Slot, KeyFn>>,
}

impl SecurityRegistry {
    fn new() -> Self {
        Self { map: RwLock::new(HashMap::new()) }
    }

    /// Register an algorithm for a specific ECU address and security level.
    pub fn register_for(&self, address: u8, level: u8, f: KeyFn) {
        self.map.write().unwrap().insert((Some(address), level), f);
    }

    /// Register a fallback used for any address at this level when no exact
    /// entry exists.
    pub fn register_default(&self, level: u8, f: KeyFn) {
        self.map.write().unwrap().insert((None, level), f);
    }

    /// True if some algorithm (exact or default) can serve this address+level.
    pub fn has(&self, address: u8, level: u8) -> bool {
        let m = self.map.read().unwrap();
        m.contains_key(&(Some(address), level)) || m.contains_key(&(None, level))
    }

    /// Compute the key for `seed`, preferring an exact ECU match over the
    /// level default. Returns `None` if nothing is registered.
    pub fn generate(&self, address: u8, level: u8, seed: &[u8]) -> Option<Vec<u8>> {
        let m = self.map.read().unwrap();
        let f = m
            .get(&(Some(address), level))
            .or_else(|| m.get(&(None, level)))?;
        Some(f(seed))
    }
}

/// The global registry. On first use it installs the simulator's default so
/// the built-in virtual ECU can be unlocked out of the box. Add your own
/// entries at startup (see `lib.rs`).
pub fn registry() -> &'static SecurityRegistry {
    static REG: OnceLock<SecurityRegistry> = OnceLock::new();
    REG.get_or_init(|| {
        let r = SecurityRegistry::new();
        // Simulator uses seed XOR 0x5AA51234 at level 0x01.
        r.register_default(0x01, algo::xor_u32(0x5AA5_1234));
        r
    })
}

/// Outcome of an unlock attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unlock {
    /// Key accepted, security granted.
    Granted,
    /// Module reported it was already unlocked (seed came back all-zero).
    AlreadyUnlocked,
}

const REQUEST_SEED: u8 = 0x27;
const POS_RESPONSE: u8 = 0x67;
const NEG_RESPONSE: u8 = 0x7F;

/// Perform the full seed/key exchange for `address` at `level`.
///
/// `level` is the *requestSeed* sub-function (odd, e.g. 0x01/0x03/0x11); the
/// matching *sendKey* sub-function is `level + 1` per ISO 14229. The key is
/// produced by whatever `KeyFn` the registry holds for this address+level.
pub fn unlock(t: &mut dyn Transport, address: u8, level: u8) -> Result<Unlock, SecurityError> {
    if level % 2 == 0 || level == 0xFF {
        return Err(SecurityError {
            nrc: None,
            message: format!(
                "Security level 0x{level:02X} must be an odd requestSeed sub-function (0x01..0x7D)"
            ),
        });
    }
    let send_key_sub = level + 1; // safe: level is odd and < 0xFF
    if !registry().has(address, level) {
        return Err(SecurityError {
            nrc: None,
            message: format!(
                "No key algorithm registered for ECU 0x{address:02X} level 0x{level:02X}. \
                 Register one via security::registry().register_for(..)."
            ),
        });
    }

    // --- requestSeed: 27 <level> ---
    let seed_resp = exchange(t, address, &[REQUEST_SEED, level])?;
    if seed_resp.first() != Some(&POS_RESPONSE) || seed_resp.len() < 2 || seed_resp[1] != level {
        return Err(SecurityError {
            nrc: None,
            message: format!("Malformed seed response: {:02X?}", seed_resp),
        });
    }
    let seed = &seed_resp[2..];
    // ISO 14229: an all-zero seed means security is already unlocked.
    if !seed.is_empty() && seed.iter().all(|&b| b == 0) {
        return Ok(Unlock::AlreadyUnlocked);
    }

    let key = registry()
        .generate(address, level, seed)
        .ok_or_else(|| SecurityError {
            nrc: None,
            message: "Key algorithm vanished from registry".to_string(),
        })?;

    // --- sendKey: 27 <level+1> <key...> ---
    let mut req = Vec::with_capacity(2 + key.len());
    req.push(REQUEST_SEED);
    req.push(send_key_sub);
    req.extend_from_slice(&key);
    let key_resp = exchange(t, address, &req)?;
    if key_resp.first() == Some(&POS_RESPONSE) {
        Ok(Unlock::Granted)
    } else {
        Err(SecurityError {
            nrc: None,
            message: format!("sendKey not accepted: {:02X?}", key_resp),
        })
    }
}

/// Raw request that surfaces the exact security NRC (invalidKey vs.
/// attempt-limit vs. time-delay) instead of collapsing them all to one error.
fn exchange(t: &mut dyn Transport, address: u8, req: &[u8]) -> Result<Vec<u8>, SecurityError> {
    let resp = t.request(address, req).map_err(|e| SecurityError {
        nrc: None,
        message: e.to_string(),
    })?;
    if resp.first() == Some(&NEG_RESPONSE) && resp.len() >= 3 {
        let nrc = resp[2];
        return Err(SecurityError {
            nrc: Some(nrc),
            message: match nrc {
                0x35 => "Invalid key".to_string(),
                0x36 => "Exceeded number of attempts — module locked out".to_string(),
                0x37 => "Required time delay not expired — wait before retrying".to_string(),
                other => format!("{} (NRC {:02X})", super::nrc_text(other), other),
            },
        });
    }
    Ok(resp)
}

/// Generic seed→key building blocks. These are illustrative, not real BMW
/// algorithms; use them as templates for your own `KeyFn`s.
pub mod algo {
    use super::KeyFn;

    /// Interpret the first 4 seed bytes as a big-endian u32, XOR with `mask`,
    /// return 4 key bytes. Shorter seeds are right-padded with zeros. This is
    /// the simulator's scheme.
    pub fn xor_u32(mask: u32) -> KeyFn {
        Box::new(move |seed| (seed_u32(seed) ^ mask).to_be_bytes().to_vec())
    }

    /// key = (seed + constant) wrapping, as big-endian u32.
    pub fn add_u32(constant: u32) -> KeyFn {
        Box::new(move |seed| seed_u32(seed).wrapping_add(constant).to_be_bytes().to_vec())
    }

    /// key = seed rotated left by `bits`, as big-endian u32.
    pub fn rotl_u32(bits: u32) -> KeyFn {
        Box::new(move |seed| seed_u32(seed).rotate_left(bits).to_be_bytes().to_vec())
    }

    /// Echo the seed back as the key (some development ECUs). Preserves length.
    pub fn echo() -> KeyFn {
        Box::new(|seed| seed.to_vec())
    }

    /// Big-endian u32 from up to 4 seed bytes, right-padded with zeros.
    fn seed_u32(seed: &[u8]) -> u32 {
        let mut b = [0u8; 4];
        for (i, &s) in seed.iter().take(4).enumerate() {
            b[i] = s;
        }
        u32::from_be_bytes(b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xor_algorithm_roundtrip() {
        let f = algo::xor_u32(0x5AA5_1234);
        let seed = [0x11, 0x22, 0x33, 0x44];
        let key = f(&seed);
        let expected = (0x1122_3344u32 ^ 0x5AA5_1234).to_be_bytes().to_vec();
        assert_eq!(key, expected);
    }

    #[test]
    fn short_seed_is_zero_padded() {
        let f = algo::add_u32(1);
        // seed 0x00AB -> u32 0x00AB0000 -> +1
        assert_eq!(f(&[0x00, 0xAB]), 0x00AB_0001u32.to_be_bytes().to_vec());
    }

    #[test]
    fn exact_registration_beats_default() {
        let r = SecurityRegistry::new();
        r.register_default(0x01, algo::echo());
        r.register_for(0x12, 0x01, algo::xor_u32(0xFFFF_FFFF));
        // DME uses the exact XOR entry
        assert_eq!(
            r.generate(0x12, 0x01, &[0x00, 0x00, 0x00, 0x00]),
            Some(vec![0xFF, 0xFF, 0xFF, 0xFF])
        );
        // Any other ECU falls back to echo
        assert_eq!(r.generate(0x29, 0x01, &[1, 2, 3]), Some(vec![1, 2, 3]));
        // Unknown level: nothing
        assert_eq!(r.generate(0x12, 0x03, &[1]), None);
    }
}
