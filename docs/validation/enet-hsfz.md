# ENET / HSFZ discovery harness — issue #248

> **Status:** diagnostic fix merged-anytime on
> `fix/248-enet-zgw-diagnostics`; experimental wake-up + tester-address
> retry on `fix/248-enet-hsfz-wakeup-retry`. Real-car verification on an
> early-F BMW (F36/N55) is the open item. This doc is the harness for that
> verification — it tells you which control word to expect, what it means,
> and exactly what to file back.

## The problem (issue #248)

On an early-F-series car (2015 F36/N55 tested), the app reported
**"0 Control Units Found"** over an ENET cable that demonstrably worked:

- Laptop ↔ ZGW ping: success.
- TCP 6801 (HSFZ): reachable.
- TCP 13400 (DoIP): closed — **expected**, early F-series speak HSFZ on
  6801, not DoIP. A closed 13400 is not a symptom; don't chase it.

So the physical + transport layer was proven. The failure was in the
HSFZ application exchange: the gateway would answer a request it could
not route with a *rejection control word*, and the app's request loop
only recognised `CTRL_DIAG` (0x0001) and `CTRL_ACK` (0x0002) — every
other control word fell into the same `continue` as keep-alive traffic
and was discarded. A refused request then sat until the 3 s read
timeout and surfaced as a generic `Timeout`, which is why all the user
ever saw was "0 control units found" with no reason attached.

The fix makes rejections visible: the request loop now returns
`TransportError::Rejected` naming the control word, the target ECU, and
which knob to turn, and a timeout that followed keep-alive traffic says
so instead of claiming silence.

## What each rejection control word means

When a request is refused, the ZGW sends one of these instead of a
diagnostic message. This is your best diagnostic tool — it names the
knob to turn:

| Control | Meaning | What to try |
|---|---|---|
| `0x0040` | incorrect tester address | the experimental branch retries once as `0xF5`; otherwise the gateway refuses `0xF4` |
| `0x0041` | unknown control word | a bug in what we send — file it with the captured frame |
| `0x0042` | malformed frame | check the HSFZ length field; report the raw bytes |
| `0x0043` | destination ECU address not reachable | the target address isn't routable on this car |
| `0x0044` | message too large | request exceeded the gateway's frame cap |
| `0x0045` | gateway not ready | retry once the car is fully awake (ignition on) |
| `0x00FF` | gateway out of memory | transient; retry |

Before the fix these all surfaced as a bare 3 s `Timeout`. Now they
surface as `Gateway rejected the request: target 0x12: … (control
0x0043)` and the app log tells you exactly which one this car sent.

## What to build and how to run it

Installers are built by `release.yml` on a `v*` tag push. **Note: as of
Sep 2026 the repo's GitHub Actions are locked by an account billing
issue, so no workflow (including release) has been running — resolve
the lock at Settings → Billing first, then:**

```bash
git fetch origin
git checkout fix/248-enet-zgw-diagnostics        # rejection surfacing (safe)
# or, to also test the wake-up + tester retry:
#   git checkout fix/248-enet-hsfz-wakeup-retry
git push -u origin <branch>
# open a PR from it; once CI is green and merged, cut a test tag:
git tag -a v0.22.0-rc1 -m "ENET HSFZ diagnostics test"
git push origin v0.22.0-rc1
```

The release run produces a Windows `.exe`/`.msi` under the release's
assets (published as a draft — publish it after the build finishes).

## The report-back loop

On the car:

1. Connect the ENET cable; the app should find the car or you type its
   link-local IP manually (`169.254.x.x`, port 6801).
2. Run **Vehicle Test**.
3. Open the app log / the Live Data traffic view.

Two outcomes to capture:

- **A named rejection** (`Gateway rejected the request: … (control
  0x00xx)`): file it. Which control word is the single most useful
  piece of data this harness produces. If it is `0x0040`, rebuild on
  `fix/248-enet-hsfz-wakeup-retry` (tester retry) and repeat.
- **Still "0 control units found" with no named rejection** after the
  fix: the car is answering with something the loop still skips. That
  is exactly the case the fix's keep-alive-timeout message is for —
  capture the log line that names the control words it saw.

File the result as a comment on issue #248 with:

- the branch/tag you built,
- the exact error text from the log,
- whether the tester-address retry changed anything,
- VIN prefix, model, model year, engine.

The maintainer (or the next person with the same car) can then decide
whether the wake-up is required and whether any other control words need
handling. Until an early-F car has produced a real result, treat the
wake-up and the `0xF4 → 0xF5` retry as **unverified** — they come from
the issue's attached draft, reviewed by tools but never run on a car.
