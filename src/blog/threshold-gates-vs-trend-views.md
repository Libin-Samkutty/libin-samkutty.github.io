---
layout: layouts/post.njk
title: A threshold answers tonight, a trend answers next month
shortTitle: Thresholds and trends
description: A p95 crept toward its gate across six consecutive passing runs without ever failing one. Why a fixed threshold cannot catch that, and what to add beside it.
date: 2025-11-01
dateModified: 2026-08-12
metrics: [nudge_api_latency_creep]
tags: [performance, ci, observability, monitoring]
technical: true
---

A threshold gate answers exactly one question: is tonight's run acceptable? It answers it well, cheaply, and without a human. It is also structurally incapable of answering the other question, which is whether you are heading somewhere unacceptable.

## Six green runs

The performance job I built ran nightly. A Python script compared each run's percentiles against a properties file and failed the build on breach. Simple, and it worked. It had already closed out an endpoint fix with an objective before-and-after rather than a developer's impression from a local `curl`.

Then a campaign-trigger endpoint's p95 went {% metric "nudge_api_latency_creep" %}.

Six consecutive builds. Six passes. Six perfectly correct green ticks. Nothing in any single report gave a reader anything to look at, because in each run, individually, there was nothing wrong.

The gate was not broken and had not been misconfigured. It did precisely what it was built to do, and what it was built to do did not include this.

It became visible only after I pushed the run results into a time-series store and put a trend dashboard over the top. Then it was a straight line sloping upward: obvious in one glance, invisible across six accurate build reports. Root cause was a database query that had stopped using its index after a schema migration. Once the slope was on screen, diagnosis took minutes. Left alone, it would have been an incident, discovered by users, on whatever night the line finally crossed.

## Why no threshold catches this

A gate is a function of one run. A creep is a property of a sequence. That is a category difference, not a tuning problem, and lowering the threshold does not fix it. It moves the wall closer and starts failing builds on ordinary night-to-night noise, which trains everyone to ignore the gate. You end up with a gate people rerun until it goes green, which is worse than no gate.

The two artefacts answer different questions and you need both:

| Property | Threshold gate | Trend view |
| --- | --- | --- |
| Question | Is this run acceptable? | Are we going somewhere bad? |
| Input | One run | A sequence of runs |
| Catches | Sudden jumps, broken deploys | Slow drift, gradual erosion |
| Acts | Automatically, blocks the merge | Only when a person looks |
| Fails by | Passing everything under the line | Nobody opening the dashboard |

The last row is why the gate stays. A trend view has no teeth. It depends on a human looking on a day when they have time. The gate is what stops a fourfold regression at two in the morning.

## What to add alongside the gate

**Persist every measurement, not just the verdict.** This is the cheapest item on the list and the one most often skipped. A gate that records only pass or fail has destroyed the data you would need to reconstruct the trend later, and you always want it later. Store the numbers from day one even if nothing reads them for a year.

**Compare against a rolling baseline rather than a fixed line.** The gate uses a fixed line. The trend check should not: it should ask whether the recent window sits above the window before it.

```python
def creeping(history, window=6, tolerance=1.10):
    """history: oldest-first p95 values, one per run.
    A creep is sustained drift above a trailing baseline, not one spike."""
    if len(history) < window * 2:
        return False                      # not enough history to have an opinion
    baseline = median(history[-window * 2:-window])
    return all(value > baseline * tolerance for value in history[-window:])
```

That is deliberately dumber than proper change-point detection. A rule an engineer can hold in their head gets acted on; a statistically superior rule nobody trusts gets muted within a month. Start dumb, and only get clever once someone is reading the output.

**Separate infrastructure noise from signal, or the trend is unreadable.** Performance runs on shared CI agents are noisy, and noise defeats trend analysis faster than it defeats a gate. Two things helped: moving the job to a dedicated quiet window, and putting a fixed-cost calibration call at the head of every run. If the calibration number moved, every other number in that run moved for reasons unrelated to the code, and the run can be marked untrustworthy instead of quietly poisoning the baseline.

**Keep the gate.** Trend views do not block deploys, and should not. The two together give you one automated defence against cliffs and one human-read defence against slopes.

## Every gate is discarding a trend

Once you have the shape, it is everywhere in a pipeline:

- **Suite runtime.** Every run under the timeout; all of them a third slower than last quarter.
- **Flake rate.** Every run green after a retry; retries getting steadily more common.
- **Evaluation pass rate.** Every nightly above the gate; the margin above it shrinking each week.
- **Bundle size, memory ceiling, cost per request, error budget burn.** Same structure, different units.

There is one question to ask of any gate you own: **if this degraded by one percent a week, how many weeks before anyone noticed?** If the honest answer is "the week it breached", you have a gate and no trend, and you are relying on the degradation being fast enough to be dramatic.

## The rule

A threshold answers whether tonight is acceptable. Only a trend answers whether you are heading somewhere unacceptable. Store the measurement, not just the verdict. You cannot reconstruct a trend from a history of green ticks, and a threshold was never going to tell you one was forming.

---

Related: [the CI suite this ran beside](/work/from-robot-to-playwright/), [monitoring what production actually does](/work/production-evaluation-pipeline/), and [why an aggregate can be true and useless at once](/writing/aggregate-metrics-hide-the-failure/).
