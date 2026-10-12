# Feed Trust Scenarios

These fixtures are deterministic, small trust/scam benchmark scenarios for the
Feed training package.

Each scenario JSON should contain:

- Top-level metadata (`id`, `name`, `description`, `profile`)
- Thresholds used for pass/fail evaluation
- A complete `snapshot` compatible with `BenchmarkGameSnapshot`
- `snapshot.groundTruth.trustGroundTruth.events`, which define scam attempts,
  disclosure risks, relationship opportunities, and information-sale events

These scenarios are intentionally compact so they can be used in tests and CI.
Larger 100-agent / 150-NPC Feed worlds should be generated separately and can
reuse the same `trustGroundTruth` schema.
