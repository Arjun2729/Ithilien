# Ithilien project instructions

## Product intent
Ithilien is an open-source agent execution firewall and evidence layer.
It provides:
- policy-enforced execution
- tamper-evident traces
- signed manifests
- portable bundles
- local and CI verification

## Build philosophy
- local-first
- zero-cost tooling
- no speculative SaaS
- small reviewable changes
- security claims must be precise

## Working style
- assess before changing
- propose phase design before implementation
- implement one phase at a time
- always add tests for critical logic
- always update docs
- do not refactor unrelated areas

## Security posture
- no overclaiming sandbox guarantees
- document trust boundaries
- document bypass assumptions
- treat key management carefully
- verification logic must be deterministic and testable

## Priorities
1. policy enforcement
2. verification reliability
3. bundle format hardening
4. CI integration
5. agent wrappers
6. local viewer

## Output expectations
Every substantial change should include:
- rationale
- files changed
- tests
- docs
- remaining risks