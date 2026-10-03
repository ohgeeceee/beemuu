"""Verify redact_ident's logic by transcribing the Rust exactly.

No cargo in this environment, so this checks the ALGORITHM against the same
assertions as the Rust tests. It does not prove the Rust compiles — only
`cargo test` does that, and CI must run it before this lands.
"""

def redact_ident(ident: str) -> str:
    trimmed = ident.strip()
    i = trimmed.find('-')                      # Rust's split_once
    if i != -1:
        software, serial = trimmed[:i], trimmed[i + 1:]
        if software != "" and serial != "":
            return software
    return trimmed


CASES = [
    ("MEVD17.2.42-S0000123", "MEVD17.2.42"),
    ("DME_8.4.1-0123456789", "DME_8.4.1"),
    ("MEVD17.2.42-12345678", "MEVD17.2.42"),
    ("MEVD17.2", "MEVD17.2"),
    ("DSC_8.4.1", "DSC_8.4.1"),
    ("-S0000123", "-S0000123"),
    ("MEVD17.2-", "MEVD17.2-"),
    ("  MEVD17.2.42-S1  ", "MEVD17.2.42"),
    ("", ""),
    ("SW-1.2-A-S9", "SW"),          # split_once: first dash wins
]

fail = 0
for src, want in CASES:
    got = redact_ident(src)
    ok = got == want
    fail += not ok
    print(f"{'ok  ' if ok else 'FAIL'} {src!r:26} -> {got!r:16} want {want!r}")

print()
print("MISMATCH with the Rust test:", "yes - fix one side" if redact_ident("SW-1.2-A-S9") != "SW" else "no")
raise SystemExit(1 if fail else 0)