# Security Policy

## Supported Versions

| Version | Supported | Notes |
|---------|-----------|-------|
| v0.2.x | ✅ Yes | Current release |
| v0.1.x | ⚠️ Best-effort | Previous release; no longer actively tested |
| < v0.1.0 | ❌ No | Pre-release / experimental |

Security updates are backported to the current release only. If you're on an
older version, upgrade to the latest release.

## What We Consider a Security Vulnerability

BeeEmUu is a desktop diagnostic tool that communicates with vehicle ECUs over
OBD-II / UDS / KWP2000. The following categories are in scope:

| Category | Examples | Severity |
|----------|----------|----------|
| **Code execution** | Memory corruption in protocol parser, RCE via crafted ECU response | Critical |
| **Privilege escalation** | Installer requires admin but app doesn't drop privileges | High |
| **Information disclosure** | Log files leak VIN or location data unexpectedly | Medium |
| **Denial of service** | Crash on malformed ECU response, infinite loop on timeout | Medium |
| **Transport security** | No authentication on ENET/DoIP, MITM via rogue adapter | Low (protocol limitation) |

Out of scope:
- **Physical attacks** — someone with physical access to the OBD port can always
  read/clear codes; this is a property of OBD-II, not BeeEmUu
- **Protocol limitations** — KWP2000 and UDS have no built-in encryption;
  we can't fix that at the app level
- **Social engineering** — convincing a user to clear fault codes is a user
  education issue, not a software vulnerability

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, email `security@yourdomain.com` (or DM the maintainer if you have
a private channel). If you don't get a response within 48 hours, ping the
public issue tracker with a vague reference and we'll open a private thread.

### What to include

1. **Description** — what the vulnerability is and how it could be exploited
2. **Reproduction steps** — minimal steps to trigger the bug
3. **Impact** — what data or access could be compromised
4. **Suggested fix** — if you have one; no pressure
5. **Your disclosure preference** — coordinated disclosure timeline, or immediate
   public if you believe users are actively at risk

### Response timeline

| Phase | Timeline | What we do |
|-------|----------|------------|
| Acknowledgment | ≤ 48 hours | Reply confirming receipt, assign internal ID |
| Initial assessment | ≤ 7 days | Reproduce, determine severity, plan fix |
| Fix + testing | ≤ 30 days (critical), ≤ 90 days (high/medium) | Develop patch, test on simulator + real car |
| Disclosure | Coordinated with reporter | Publish security advisory, credit reporter |

We prefer **coordinated disclosure** — we fix the bug, release a patch, and
publicly disclose together. If you prefer a different timeline, tell us and we'll
try to accommodate.

## Security Measures in Place

### Build and distribution
- CI builds run on GitHub-hosted runners (not local machines)
- Release binaries are built from tagged commits with reproducible steps
- No binary blobs or precompiled dependencies checked into the repo

### Data handling
- No telemetry, analytics, or remote logging
- No cloud sync (unless user explicitly exports a file)
- Log files and CSV exports stay on the user's machine
- VIN is read from the car but never transmitted off-device

### Communication with the car
- All OBD/UDS/KWP2000 traffic is local (USB/ENET cable, no internet)
- No remote diagnostic server or API calls
- SecurityAccess (0x27) seed/key algorithms are pluggable but don't ship
  proprietary BMW keys

### Known limitations (not vulnerabilities, but worth understanding)

| Limitation | Why it exists | Mitigation |
|------------|-------------|------------|
| No encryption on OBD-II / KWP2000 / UDS | These protocols predate modern crypto | Physical access control (lock your car) |
| ENET/DoIP is unauthenticated on the vehicle network | BMW design; not our protocol | Use trusted adapters; don't connect to unknown networks |
| SecurityAccess seed/key can be brute-forced | 16-bit seeds, publicly known algorithms | Not our bug; we implement what the ECU requires |
| Clearing faults erases diagnostic evidence | It's a feature, not a bug | Confirm with user before clearing; warn in UI |
| Service functions can actuate hardware | Required for bleeding brakes, etc. | Mark high-risk functions with `risk: "high"` |

## Security History

| Date | Issue | Severity | Fix | Credit |
|------|-------|----------|-----|--------|
| — | — | — | — | — |

*(No reported vulnerabilities yet. Be the first to get your name here.)*

## Acknowledgments

We thank the following security researchers for responsibly disclosing
vulnerabilities:

*(List will be updated as reports come in.)*

---

*This policy is adapted from the [GitHub Security Lab](https://securitylab.github.com/) template and is licensed under CC0.*
