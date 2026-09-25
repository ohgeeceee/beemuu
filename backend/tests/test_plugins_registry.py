"""Tests for the read-only community plugin registry (backend.plugins_registry)."""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from unittest import mock
from urllib.error import HTTPError
from urllib.request import urlopen

from backend import app as app_module
from backend import plugins_registry


def _write_pkg(directory: Path, pkg: dict, name: str | None = None) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / (name or f"{pkg['id']}.json")
    path.write_text(json.dumps(pkg), encoding="utf-8")
    return path


def _tool_pkg(**overrides) -> dict:
    pkg = {
        "schemaVersion": 1,
        "id": "author.example-tool",
        "name": "Example tool",
        "version": "1.0.0",
        "author": "Author Name",
        "description": "A test tool.",
        "license": "GPL-3.0-or-later",
        "kind": "tool",
        "permissions": [],
        "exampleInput": {"x": 1},
        "code": "return input.x;",
    }
    pkg.update(overrides)
    return pkg


def _data_pkg(**overrides) -> dict:
    pkg = {
        "schemaVersion": 1,
        "id": "author.example-data",
        "name": "Example data",
        "version": "1.0.0",
        "author": "Author Name",
        "description": "A test data pack.",
        "license": "GPL-3.0-or-later",
        "kind": "data",
        "permissions": [],
        "content": {"articles": [{"title": "T", "body": "B"}]},
    }
    pkg.update(overrides)
    return pkg


class TestValidatePackage(unittest.TestCase):
    def test_valid_tool_and_data_pass(self):
        plugins_registry.validate_package(_tool_pkg())
        plugins_registry.validate_package(_data_pkg())

    def test_valid_v2_bundle_passes(self):
        pkg = _tool_pkg(
            schemaVersion=2,
            code=None,
            files={"a.js": "const x = 1;", "main.js": "return x;"},
            entry="main.js",
        )
        plugins_registry.validate_package(pkg)

    def test_rejects_bad_shape(self):
        for bad in [
            "not a dict",
            [],
            _tool_pkg(schemaVersion=3),
            _tool_pkg(id="nonamespace"),
            _tool_pkg(id="../../evil"),
            _tool_pkg(version="1.2"),
            _tool_pkg(kind="native"),
            _tool_pkg(permissions=["ecu.write"]),
            _tool_pkg(code=""),
            _tool_pkg(exampleInput=None),
            _tool_pkg(content={"articles": []}),
            _tool_pkg(files={"a.js": "x"}, entry="missing.js"),
            _tool_pkg(files={"a.js": ""}, entry="a.js"),
            _tool_pkg(files={}, entry="main.js"),
        ]:
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    plugins_registry.validate_package(bad)

    def test_rejects_oversize_package(self):
        big = _tool_pkg(description="x" * (plugins_registry.MAX_PACKAGE + 1))
        with self.assertRaises(ValueError):
            plugins_registry.validate_package(big)


class TestListAndGet(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.dir = Path(self._tmp.name)
        _write_pkg(self.dir, _tool_pkg())
        _write_pkg(self.dir, _data_pkg())
        _write_pkg(self.dir, _tool_pkg(id="author.other", name="Other tool", description="unrelated"))

    def tearDown(self):
        self._tmp.cleanup()

    def test_list_returns_summaries_without_code(self):
        rows = plugins_registry.list_plugins(self.dir)
        self.assertEqual(len(rows), 3)
        for row in rows:
            self.assertIn("id", row)
            self.assertIn("name", row)
            self.assertNotIn("code", row)
            self.assertNotIn("files", row)

    def test_list_filters_by_kind(self):
        rows = plugins_registry.list_plugins(self.dir, kind="data")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["kind"], "data")

    def test_list_filters_by_query(self):
        rows = plugins_registry.list_plugins(self.dir, q="other")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], "author.other")

    def test_list_limit_clamped(self):
        rows = plugins_registry.list_plugins(self.dir, limit=1)
        self.assertEqual(len(rows), 1)
        rows = plugins_registry.list_plugins(self.dir, limit=99999)
        self.assertLessEqual(len(rows), 200)

    def test_get_plugin_returns_full_package(self):
        pkg = plugins_registry.get_plugin(self.dir, "author.example-tool")
        self.assertIsNotNone(pkg)
        self.assertEqual(pkg["id"], "author.example-tool")
        self.assertIn("code", pkg)

    def test_get_plugin_unknown_returns_none(self):
        self.assertIsNone(plugins_registry.get_plugin(self.dir, "nope.nothing"))
        self.assertIsNone(plugins_registry.get_plugin(self.dir, "bad id"))

    def test_malformed_file_is_skipped_not_fatal(self):
        (self.dir / "broken.json").write_text("{ not json", encoding="utf-8")
        rows = plugins_registry.list_plugins(self.dir)
        self.assertEqual(len(rows), 3)


def _start_server(registry_dir: Path):
    from backend import bootstrap
    with mock.patch.dict(os.environ, {"BEEMUU_ADMIN_PASSWORD": "test-pw"}):
        bootstrap.bootstrap_for_startup(Path(tempfile.mkdtemp()) / "reg.db")
    server = ThreadingHTTPServer(("127.0.0.1", 0), app_module.Handler)
    t = Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server, t


class TestPluginEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        cls.registry = Path(cls._tmp.name) / "registry"
        _write_pkg(cls.registry, _tool_pkg())
        _write_pkg(cls.registry, _data_pkg())
        # Point the app at this registry. PLUGIN_REGISTRY is bound at import
        # time, so patch the module attribute rather than the env var.
        cls._orig = app_module.PLUGIN_REGISTRY
        app_module.PLUGIN_REGISTRY = cls.registry
        cls.server, cls.thread = _start_server(cls.registry)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        app_module.PLUGIN_REGISTRY = cls._orig

    def _get(self, path):
        try:
            with urlopen(f"{self.base}{path}", timeout=5) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except HTTPError as e:
            return e.code, json.loads(e.read().decode("utf-8"))

    def test_list_endpoint(self):
        status, body = self._get("/api/plugins")
        self.assertEqual(status, 200)
        self.assertEqual(body["count"], 2)
        self.assertEqual(len(body["results"]), 2)
        self.assertNotIn("code", body["results"][0])

    def test_list_kind_filter(self):
        status, body = self._get("/api/plugins?kind=data")
        self.assertEqual(status, 200)
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["results"][0]["kind"], "data")

    def test_list_bad_kind_400(self):
        status, body = self._get("/api/plugins?kind=bogus")
        self.assertEqual(status, 400)
        self.assertIn("error", body)

    def test_get_by_id_returns_full_manifest(self):
        status, body = self._get("/api/plugins/author.example-tool")
        self.assertEqual(status, 200)
        self.assertEqual(body["id"], "author.example-tool")
        self.assertIn("code", body)

    def test_get_unknown_404(self):
        status, body = self._get("/api/plugins/nope.nothing")
        self.assertEqual(status, 404)
        self.assertIn("error", body)


if __name__ == "__main__":
    unittest.main()
