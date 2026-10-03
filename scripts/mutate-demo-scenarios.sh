#!/bin/bash
# Mutation-check the demo scenarios. Each mutant breaks a scenario so that it
# stops describing the fault it claims to describe. If the suite still passes,
# the scenario has stopped being a test and become decoration.
set -u
cd /home/pn/beemuu-v3

T="src/js/test/demo_scenarios.test.cjs"
F="src/js/demo_scenarios.js"
cp "$F" /tmp/ds.bak

check() {
  local label="$1" out
  out=$(node --test "$T" 2>&1 | grep -E '^ℹ (pass|fail)' | tr '\n' ' ')
  printf '%-56s [%s]\n' "$label" "$out"
  cp /tmp/ds.bak "$F"
}

mutate() {
  python3 - "$1" "$2" "$3" <<'PYEOF'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
if old not in s:
    print("NO MATCH: " + repr(old[:50]))
    sys.exit(3)
open(path, 'w').write(s.replace(old, new, 1))
PYEOF
}

echo "baseline:"
check "(none — all green)"

mutate "$F" 'if (t < 62 || t > 86) return 0;' 'if (t < 8 || t > 86) return 0;'
check "misfires now happen at idle, not under load" || true

mutate "$F" 'if (t < 62 || t > 86) return 0;' 'return 0;'
check "no misfires at all" || true

mutate "$F" '        ? 12 + Math.sin(t * 0.2) * 0.4' '        ? 85 + Math.sin(t * 0.2) * 0.4'
check "cold-start scenario is a warm engine" || true

mutate "$F" 'const COLD_SOAK_S = 120;' 'const COLD_SOAK_S = 20;'
check "cold soak shorter than the monitor minimum" || true

mutate "$F" 'const values = [6, 8, 10, 12, 14, 16, 17.5, 19];' 'const values = [6, 6, 6, 6, 6, 6, 6, 6];'
check "fuel trim stops drifting" || true

mutate "$F" 'const values = [6, 8, 10, 12, 14, 16, 17.5, 19];' 'const values = [6, 8, 10, 12, 14, 16, 17.5, 30];'
check "fuel trim ends past its limit (act, not watch)" || true

mutate "$F" '      snap(base, 1, "MEVD17.2.40"),
      snap(base + 40 * 86400000, 2, "MEVD17.2.44"),' '      snap(base, 2, "MEVD17.2.44"),
      snap(base + 40 * 86400000, 1, "MEVD17.2.40"),'
check "flash counter goes backwards (reset, not flash)" || true

mutate "$F" '      if (rand() < dropout) continue;' '      if (false) continue;'
check "no dropouts (the dropout test should fail)" || true

mutate "$F" '      if (rand() < dropout) continue;' '      if (rand() < 0.9) continue;'
check "heavy dropouts" || true

# The rpm channel is the fastest; dropping it to 1 Hz makes every channel the
# same rate, which is exactly the bug the "sampled at different rates" test
# exists to catch.
mutate "$F" '{ id: "rpm", label: "Engine speed", unit: "rpm", hz: 10,' \
         '{ id: "rpm", label: "Engine speed", unit: "rpm", hz: 1,'
check "all channels sampled at the same rate" || true

echo
check "(restored — all green)"
node "$T" >/dev/null 2>&1 || true