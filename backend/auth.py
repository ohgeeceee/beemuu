"""Password hashing + cookie-session helpers for the beemuu admin panel.

Stdlib only. Passwords use hashlib.scrypt (per OWASP password-storage guidance
for 2024) with a per-password random salt. Cookies are 32-byte urlsafe tokens
stored in the `session_cookie` table with an explicit expires_at — no JWT, no
clock-skew surprises, easy to revoke.

A note on bcrypt vs scrypt: bcrypt would be more familiar to most readers, but
it requires a pip dependency (no stdlib equivalent). scrypt is in the standard
library and is OWASP-recommended. Same security posture, zero deploy friction.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from pathlib import Path

from . import db

# scrypt cost parameters. OWASP 2024 guidance: N=2^17, r=8, p=1 is a sensible
# default for interactive auth. We stay at N=2^15 (=32768) so login takes
# ~50–100ms on the VPS — enough to slow brute-force, fast enough to not annoy
# the single admin.
_SCRYPT_N = 2**15
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_DKLEN = 32
_SALT_BYTES = 16

# Cookie lifetime
_SESSION_TTL_SECS = 7 * 24 * 3600  # 7 days


def hash_password(password: str) -> str:
    """Hash a password with a fresh random salt.

    Returns a self-describing string: "scrypt$<salt_hex>$<hash_hex>".
    """
    salt = secrets.token_bytes(_SALT_BYTES)
    # OpenSSL's default maxmem (32 MB) is too small for our N/r params;
    # bump it explicitly. 128 MB comfortably covers N=2^15, r=8, p=1.
    digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_SCRYPT_DKLEN,
        maxmem=128 * 1024 * 1024,
    )
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Constant-time verify. Returns False on any malformed hash (no exception)."""
    try:
        algo, salt_hex, digest_hex = stored_hash.split("$", 2)
    except ValueError:
        return False
    if algo != "scrypt":
        return False
    try:
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except ValueError:
        return False
    actual = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=len(expected),
        maxmem=128 * 1024 * 1024,
    )
    # hmac.compare_digest is constant-time, prevents timing attacks
    return hmac.compare_digest(actual, expected)


def create_session(db_path: Path, admin_id: int, ip: str) -> str:
    """Create a session for admin_id. Returns the opaque token to set in the cookie."""
    token = secrets.token_urlsafe(32)
    expires_at = int(time.time()) + _SESSION_TTL_SECS
    with db.get_conn(db_path) as conn:
        conn.execute(
            "INSERT INTO session_cookie (id, admin_id, expires_at, created_ip) "
            "VALUES (?, ?, ?, ?)",
            (token, admin_id, expires_at, ip[:64] if ip else None),
        )
        conn.execute(
            "UPDATE admin_user SET last_login_at = ? WHERE id = ?",
            (int(time.time()), admin_id),
        )
        conn.commit()
    return token


def lookup_session(db_path: Path, token: str) -> int | None:
    """Return admin_id for a valid, non-expired token; None otherwise."""
    if not token:
        return None
    now = int(time.time())
    with db.get_conn(db_path) as conn:
        row = conn.execute(
            "SELECT admin_id, expires_at FROM session_cookie WHERE id = ?",
            (token,),
        ).fetchone()
    if row is None:
        return None
    admin_id, expires_at = row["admin_id"], row["expires_at"]
    if expires_at <= now:
        # Expired — lazily clean it up
        with db.get_conn(db_path) as conn:
            conn.execute("DELETE FROM session_cookie WHERE id = ?", (token,))
            conn.commit()
        return None
    return admin_id


def revoke_session(db_path: Path, token: str) -> None:
    """Delete a session row. No-op if token doesn't exist."""
    if not token:
        return
    with db.get_conn(db_path) as conn:
        conn.execute("DELETE FROM session_cookie WHERE id = ?", (token,))
        conn.commit()