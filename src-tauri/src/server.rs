//! Simple embedded HTTP server for web fallback.
//!
//! Runs on localhost:8765 and serves:
//!   GET /           -> static HTML fallback UI
//!   GET /dashboard  -> JSON dashboard data
//!
//! Can be accessed via SSH tunnel: ssh -L 8765:localhost:8765 user@host
use crate::backend_dashboard::{now_secs, summarize_traffic, BackendDashboard};
use crate::community;
use crate::hunt;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

static SERVER_RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

const FALLBACK_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BeeEmUu Backend</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;padding:20px;background:#f5f5f5}
    .container{max-width:800px;margin:0 auto;background:#fff;padding:24px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1)}
    h1{margin-top:0;color:#333}
    .metric{display:inline-block;background:#f0f4f8;padding:12px 16px;border-radius:6px;margin:4px}
    .metric span{display:block;font-size:12px;color:#666;text-transform:uppercase}
    .metric strong{font-size:24px;color:#222}
    .section{margin-top:20px;padding-top:20px;border-top:1px solid #eee}
    .section h3{color:#444;margin-bottom:12px}
    pre{background:#f8f8f8;padding:12px;border-radius:4px;overflow-x:auto;font-size:13px}
    button{background:#0066cc;color:#fff;border:none;padding:10px 20px;border-radius:4px;cursor:pointer;font-size:14px}
    button:hover{background:#0055aa}
    .error{color:#c00;background:#ffe6e6;padding:12px;border-radius:4px;display:none}
  </style>
</head>
<body>
  <div class="container">
    <h1>Backend Dashboard</h1>
    <p><button onclick="loadDash()">Refresh</button></p>
    <div id="error" class="error"></div>
    <div id="dash"></div>
  </div>
  <script>
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    async function loadDash() {
      const err = document.getElementById('error');
      const out = document.getElementById('dash');
      err.style.display = 'none';
      try {
        const r = await fetch('/dashboard');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        let html = '';
        html += '<div class="metric"><span>Connected</span><strong>' + (d.connected ? 'Yes' : 'No') + '</strong></div>';
        html += '<div class="metric"><span>Transport</span><strong>' + escapeHtml(d.transport_name || '-') + '</strong></div>';
        html += '<div class="metric"><span>Profiles</span><strong>' + d.profile_count + '</strong></div>';
        html += '<div class="metric"><span>Exports</span><strong>' + d.export_count + '</strong></div>';
        html += '<div class="metric"><span>Traffic OK</span><strong>' + d.traffic.ok + '</strong></div>';
        html += '<div class="metric"><span>Traffic Failed</span><strong>' + d.traffic.failed + '</strong></div>';
        html += '<div class="metric"><span>Avg Latency</span><strong>' + d.traffic.avg_ms + ' ms</strong></div>';
        html += '<div class="metric"><span>Hunt Active</span><strong>' + (d.hunt.active ? 'Yes' : 'No') + '</strong></div>';
        html += '<div class="metric"><span>Hunt Found</span><strong>' + d.hunt.found + '</strong></div>';
        html += '<div class="section"><h3>Community</h3><pre>' + escapeHtml(JSON.stringify(d.community, null, 2)) + '</pre></div>';
        out.innerHTML = html;
      } catch (e) {
        err.textContent = e.message;
        err.style.display = 'block';
      }
    }
    loadDash();
  </script>
</body>
</html>"#;

pub fn start_server() {
    if SERVER_RUNNING.load(std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    SERVER_RUNNING.store(true, std::sync::atomic::Ordering::SeqCst);

    thread::spawn(|| {
        let addr = "127.0.0.1:8765";
        let listener = match TcpListener::bind(addr) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("backend http server failed to bind {}: {}", addr, e);
                return;
            }
        };
        println!("backend http server listening on http://{}", addr);
        for stream in listener.incoming() {
            let mut stream = match stream {
                Ok(s) => s,
                Err(_) => continue,
            };
            let mut buf = [0u8; 1024];
            let _ = stream.read(&mut buf).ok();
            let req = String::from_utf8_lossy(&buf);
            let path = req
                .lines()
                .next()
                .unwrap_or("/")
                .split_whitespace()
                .nth(1)
                .unwrap_or("/");

            let (status, content_type, body) = match path {
                "/dashboard" => {
                    let dash = build_dashboard();
                    let json = serde_json::to_string(&dash).unwrap_or_default();
                    ("200 OK", "application/json", json)
                }
                _ => ("200 OK", "text/html", FALLBACK_HTML.to_string()),
            };

            let resp = format!(
                "HTTP/1.1 {}\r\nContent-Type: {}; charset=utf-8\r\nContent-Length: {}\r\n\r\n{}",
                status,
                content_type,
                body.len(),
                body
            );
            let _ = stream.write_all(resp.as_bytes());
        }
    });
}

fn build_dashboard() -> BackendDashboard {
    let traffic = summarize_traffic(&[]);
    let community = community::report();
    let hunt = hunt::status();
    BackendDashboard {
        generated_at_secs: now_secs(),
        connected: false, // TODO: check transport state
        transport_name: Some("kdcan".to_string()),
        profile_count: community.profiles,
        export_count: 0, // TODO: count exports
        traffic,
        community,
        hunt,
    }
}
