"""Tests for the backend.bootstrap CLI entry point + ops/bootstrap-admin.sh.

These guard two contracts:

1. ``python3 -m backend.bootstrap`` invokes ``bootstrap_admin`` with the
   same env-driven behavior as the systemd unit's startup path.
2. ``ops/bootstrap-admin.sh`` exists, is executable, and shells out to
   ``backend.bootstrap`` (not a separate module).

The shell script test is intentionally minimal — we exec it as a
subprocess against a temp DB with ``BEEMUU_ADMIN_PASSWORD`` set, and
verify the admin row exists. This catches the common regressions:
- someone renames the python module and forgets to update the script,
- the script loses its executable bit in a tarball,
- the script stops forwarding ``--db-path``.
"""
from __future__ import annotations

import os
import sqlite3
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from backend import auth, bootstrap, db

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "ops" / "bootstrap-admin.sh"


class TestBootstrapCLIModule(unittest.TestCase):
    """``python3 -m backend.bootstrap`` mirrors bootstrap_admin() behavior."""

    def test_main_creates_schema_and_admin(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as td:
            db_path = Path(td) / "cli.db"
            with mock.patch.dict(
                os.environ,
                {"BEEMUU_ADMIN_PASSWORD": "cli-pw", "BEEMUU_DB_PATH": str(db_path)},
            ):
                # Re-run the module as a script in its own process so we
                # exercise the actual ``if __name__ == '__main__'`` branch.
                result = subprocess.run(
                    [sys.executable, "-m", "backend.bootstrap"],
                    cwd=str(REPO_ROOT),
                    capture_output=True,
                    text=True,
                    env={**os.environ, "BEEMUU_ADMIN_PASSWORD": "cli-pw",
                         "BEEMUU_DB_PATH": str(db_path)},
                )
            self.assertEqual(
                result.returncode, 0,
                f"stdout={result.stdout!r} stderr={result.stderr!r}",
            )
            self.assertIn("bootstrapped admin user", result.stdout)

            with sqlite3.connect(db_path) as conn:
                row = conn.execute(
                    "SELECT username, password_hash FROM admin_user"
                ).fetchone()
            self.assertEqual(row[0], "admin")
            self.assertTrue(auth.verify_password("cli-pw", row[1]))

    def test_main_exits_2_when_password_unset(self) -> None:
        env = {k: v for k, v in os.environ.items() if k != "BEEMUU_ADMIN_PASSWORD"}
        result = subprocess.run(
            [sys.executable, "-m", "backend.bootstrap"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("BEEMUU_ADMIN_PASSWORD", result.stderr)

    def test_main_respects_custom_db_path(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as td:
            db_path = Path(td) / "explicit.db"
            result = subprocess.run(
                [sys.executable, "-m", "backend.bootstrap", "--db-path", str(db_path)],
                cwd=str(REPO_ROOT),
                capture_output=True,
                text=True,
                env={**os.environ, "BEEMUU_ADMIN_PASSWORD": "x"},
            )
            self.assertEqual(
                result.returncode, 0,
                f"stderr={result.stderr!r}",
            )
            self.assertTrue(db_path.exists())


class TestBootstrapAdminScript(unittest.TestCase):
    """ops/bootstrap-admin.sh is executable, invokes the right module, and
    forwards ``--db-path`` correctly."""

    def test_script_exists_and_is_executable(self) -> None:
        self.assertTrue(SCRIPT.exists(), f"missing {SCRIPT}")
        mode = SCRIPT.stat().st_mode
        self.assertTrue(
            mode & stat.S_IXUSR,
            f"{SCRIPT} must be executable by the owner (chmod +x)",
        )

    def test_script_creates_admin_in_db(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as td:
            db_path = Path(td) / "script.db"
            result = subprocess.run(
                ["bash", str(SCRIPT), str(db_path)],
                cwd=str(REPO_ROOT),
                capture_output=True,
                text=True,
                env={**os.environ, "BEEMUU_ADMIN_PASSWORD": "script-pw"},
            )
            self.assertEqual(
                result.returncode, 0,
                f"stdout={result.stdout!r} stderr={result.stderr!r}",
            )
            with sqlite3.connect(db_path) as conn:
                row = conn.execute(
                    "SELECT username, password_hash FROM admin_user"
                ).fetchone()
            self.assertEqual(row[0], "admin")
            self.assertTrue(auth.verify_password("script-pw", row[1]))

    def test_script_fails_when_password_unset(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as td:
            db_path = Path(td) / "no-pw.db"
            env = {k: v for k, v in os.environ.items() if k != "BEEMUU_ADMIN_PASSWORD"}
            result = subprocess.run(
                ["bash", str(SCRIPT), str(db_path)],
                cwd=str(REPO_ROOT),
                capture_output=True,
                text=True,
                env=env,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("BEEMUU_ADMIN_PASSWORD", result.stderr)


if __name__ == "__main__":
    unittest.main()
