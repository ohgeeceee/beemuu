# Beemuu Community-First Strategy Framework

## The Rules We Live By

These four guidelines govern every interaction in GitHub Issues, GitHub Discussions, and Discord. They are non-negotiable. They exist to prove — not promise — that Beemuu is a community democracy, not a solo project with a benevolent dictator.

---

### Rule 1: Every Issue Gets a Human Response Within 48 Hours

**The Rule:** No issue, no matter how small or critical, sits unanswered for more than two days. If you don't have a fix yet, you respond with acknowledgment, a label, and a timeline.

**Why it matters:** Silence kills community trust faster than bugs do. A quick "Thanks for reporting, we're looking into this — expect an update by Friday" signals that contributors are heard, not ignored. The clock forces maintainers to stay engaged and prevents the "abandoned project" death spiral.

**In Practice:**
- Use GitHub issue templates to route bugs, features, and questions correctly.
- Set up Discord/Slack webhooks to ping maintainers when new issues arrive.
- If you're going to be away, post a heads-up in Discussions so the community knows.

---

### Rule 2: Work Lands Directly as Pull Requests

**The Rule:** Finished work — features, cycle plans, fixes — lands on GitHub as a pull request as soon as it's done. No Discussion thread, waiting period, or other gate stands between completed work and its PR. The PR itself is where review happens: the reasoning goes in the PR body, the decision in the review comments. GitHub Discussions remains available as an *optional* venue for open-ended questions and early thinking, but it is never a requirement and never a gate.

**Why it matters:** Momentum is a feature — a gate between "done" and "proposed" quietly kills contributions and delays fixes nobody disagrees with. Public reasoning still matters exactly as much as it always did; it just lives in the PR, next to the code it describes, instead of in a thread that has to conclude first. Surprise redesigns are still wrong — the defense against them is a visible PR with the trade-offs written down, not a mandatory prequel.

**In Practice:**
- Open the PR when the work is done. Put the reasoning, alternatives considered, and review checklist in the PR body.
- Use Discussions (optional) only when the direction itself is genuinely open; if a thread exists, link it from the PR.
- Label issues that would benefit from broader input with `needs-community-input` — the label invites input; it never blocks a PR.
- When a PR settles a debated question, summarize the decision in the PR before merge. Never ghost a thread after making a call.

---

### Rule 3: Credit Is Public, Permanent, and Prominent

**The Rule:** Every contributor — whether they fixed a typo or architected a major release — gets public credit in the release notes, a `CONTRIBUTORS.md` file, and a shout-out in the announcement thread. No exceptions.

**Why it matters:** Community ownership isn't a vibe; it's a ledger. People need to see their name attached to the work. It transforms users into stakeholders. When someone knows their contribution will be permanently visible, they invest more deeply.

**In Practice:**
- Automate contributor list generation with tools like `all-contributors`.
- In every release notes post, lead with "This release was made possible by..." and name names.
- If someone opens a PR that doesn't get merged, still thank them publicly and explain why. Rejection without acknowledgment is a community killer.

---

### Rule 4: Transparency Is Default; Secrecy Requires Justification

**The Rule:** Roadmaps, financials (if any donations/sponsorships), security incidents, and architectural decisions are public by default. The only things that stay private are unreported security vulnerabilities (until fixed) and direct personal harassment reports.

**Why it matters:** "Trust us" is what corporations say. Communities prove trust by showing the work. If Beemuu takes a donation, the community sees where it goes. If a security bug is found, the community sees the fix timeline. If the roadmap shifts, the community knows why.

**In Practice:**
- Maintain a public `ROADMAP.md` in the repo. Update it monthly.
- If running donations, publish a quarterly "State of Beemuu" transparency post covering funds received and spent.
- For security issues: use GitHub Security Advisories for responsible disclosure, but publish a postmortem after the patch drops.
- When you say no to a popular feature request, explain the trade-offs publicly. "No, because X" is infinitely better than silence.

---

## The Standard You Set Is the Culture You Get

These rules aren't suggestions. They're the proof that Beemuu is different. Follow them rigorously for the first 100 issues, the first 50 contributors, and the first year — and the community will defend the project harder than any marketing campaign ever could.
