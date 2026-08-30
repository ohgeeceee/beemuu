<!-- Thanks for contributing! Delete sections that don't apply. -->

## What this adds

<!-- e.g. "Live-data profile for E70 X5 N62B48" or "Fault texts for DSC codes" -->

## For data contributions (community/*.toml)

- **Vehicle:** chassis + engine + year
- **How verified:**
- [ ] Loads cleanly (checked the **Diagnostics** tab — no warnings)
- [ ] Original / community-derived knowledge, **not** from ISTA or other
      proprietary software

## For code contributions

- [ ] `cargo fmt` and `cargo clippy` are clean
- [ ] Tested against the Simulator (and, if possible, a real car — say which)
- [ ] No BMW proprietary data or trademarks added
- [ ] Docs updated if any behavior claims changed

## For release-cut PRs

- [ ] Version bumped in `Cargo.toml`, `package.json`, and `package-lock.json`
- [ ] Annotated tag created for this release (`git tag -a vX.Y.Z`)
- [ ] Tag pushed so `release.yml` can build installers (`git push origin vX.Y.Z`)
