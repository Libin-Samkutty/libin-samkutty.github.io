---
layout: layouts/case-study.njk
title: Two years optimising a framework, then retiring it
shortTitle: From Robot Framework to Playwright
description: Two years optimising a test framework, then the diagnosis that four of its limits were structural rather than tunable — and the migration that followed.
number: 6
order: 6
period: May 2022 – Q1 2026
roleAtTime: Associate QA Engineer, then QA Engineer
scope: The platform's UI, conversational and API automation — built from zero, optimised, migrated, and finally decommissioned.
stack: ["Robot Framework", "pabot", "Playwright", "Botium", "Pytest", "Python", "TypeScript", "Docker", "Jenkins", "GitHub Actions", "Allure"]
mine: The original suites, the flakiness and parallelisation work, the migration decision and cutover, and the retirement of the framework I had built.
notMine: The application and its CI infrastructure are the engineering team's; the company-wide Robot Framework base framework is a separate org-level initiative I co-own with others.
metrics: ["ci_flake_rate", "env_drift_breakages", "docker_setup_time", "robot_pabot_smoke", "robot_pabot_regression", "robot_suite_growth", "robot_ceiling_erosion", "playwright_poc", "ui_scenarios_to_api", "ci_smoke_runtime", "regression_suite_runtime", "playwright_scenarios", "botium_flows", "visual_regression", "robot_retirement_ported", "regression_effort_days"]
tags: ["Framework migration", "CI performance", "Test architecture", "Technical debt", "Playwright"]
datePublished: 2026-08-12
dateModified: 2026-08-12
lastReviewed: 2026-08-12
---

## TL;DR

- I built the platform's first UI automation on Robot Framework, then spent two years making it fast: {% metric "robot_pabot_regression" %} on full regression, with a fix for a parallel-worker race condition arriving free in the same change.
- A year later the same suite sat at {% metric "robot_ceiling_erosion" %}. The optimisation had not failed. It decayed with growth, which is a different and more important fact.
- Four limits turned out to be structural rather than tunable, so I migrated — then four years later retired the last corner, {% metric "robot_retirement_ported" %}, with a parallel-run cycle proving zero divergence first.

## The problem

In May 2022 the platform had no automated UI coverage, and manual regression ran at {% metric "regression_effort_days" %}. I built the first UI suite in Robot Framework with a Gherkin-style layer, and the first conversational suite in Botium shortly after — {% metric "botium_flows" %} covering multi-turn journeys, intent routing and adversarial inputs through a webhook-simulation connector signed with the same HMAC the production consumer verifies.

Both suites worked. Then the problems arrived in order. First flakiness: the month after the Jenkins cutover ran at {% metric "ci_flake_rate" %}, because dashboard components became visible in the DOM before their content finished loading, so waiting for visibility was waiting for the wrong event. "Flaky tests" is a symptom description, not a diagnosis. Then environment drift: browser and driver versions on the CI agent and on local machines moved independently, producing {% metric "env_drift_breakages" %}, which containerising with pinned versions removed entirely while cutting new-machine setup {% metric "docker_setup_time" %}.

Then runtime. This is the part worth reading carefully.

## Constraints

- **The suite could not stop protecting releases while I worked on it**, and CI capacity was fixed — more parallelism meant using the workers better, not asking for more.
- **I was the only person who could do this.** By late 2023 I maintained the suite alone, which makes authoring overhead a first-class cost rather than a stylistic complaint.
- **The application was getting harder to test, not easier**, so any framework decision had to be judged against where the product was going.

## Options considered

| Option | Why not |
| --- | --- |
| Add a fifth pabot worker | No further gain. The bottleneck had stopped being worker count. |
| Fix the per-suite login tax, or restructure files to dodge it | The framework re-authenticates per suite file by design — architecture, not configuration. Restructuring trades a runtime tax for sprawl and erodes again with the next growth. |
| Rewrite on Selenium with pytest, or move to Cypress | Selenium keeps the driver layer the flakiness came from. Cypress had real multi-tab, cross-origin and frame limitations at the time. |
| Accept the ceiling | Defensible if the product were static. It was getting more asynchronous every quarter. |
| *(Q1 2026)* Patch the API suite's dependency conflict, or give it its own base image | A day's work, and the second time in a year this framework needed isolated attention. Both keep framework-specific infrastructure alive for a suite unchanged since 2023. |

## The decision, and the principle behind it

Exhaust optimisation first, then decide whether the framework is still the right one — and treat those as two separate disciplines rather than one continuous effort.

The principle: **an optimisation that decays with growth is not a fix, it is a loan.** When the numbers came back a year later, my first instinct was that the tuning had been wrong. It had not been. The tuning was correct and the growth ate it, because what it optimised around was structural.

The second principle, four years later: **retiring a framework you built is part of owning it, and needs the same evidence bar as shipping one.**

## Implementation

### The optimisation, and why it decayed

The naive parallelisation was a file-level split across four workers. It took the smoke suite to 24 minutes and stopped, bottlenecked on two oversized suite files no worker count could subdivide. Test-level splitting with longest-running-test-first scheduling got it to {% metric "robot_pabot_smoke" %}.

Full regression needed a different fix. Each suite file authenticated its own browser session, so a four-worker run spent a large fraction of its time logging in. Consolidating to one login per worker took it {% metric "robot_pabot_regression" %}, and removed a session race condition between workers — one of those cases where the performance fix and the correctness fix are the same fix, because both came from the same wrong assumption about session scope.

Then the suite grew: {% metric "robot_suite_growth" %} over the following year. And the runtimes went back up: {% metric "robot_ceiling_erosion" %}.

The mechanism matters, because "the suite got slower as it got bigger" is the boring version and not what happened. Runtime did not grow in proportion to test count. It grew in proportion to *suite file count*, because each new file bought its own authentication regardless of how many workers were running. The consolidation had made login cost proportional to workers; suite growth made it proportional to files again. The optimisation was correct, and it was defeated along the axis it had not touched.

### The four structural limits

By late 2023 I could name four things tuning would not reach: the Gherkin and step-definition authoring overhead, which I was paying alone across a suite that size; flakiness against an increasingly async, AI-driven UI, where the driver layer was fighting the direction the product was moving; the parallelisation ceiling, demonstrated twice by measurement rather than assumed; and the debugging affordances — no trace-level replay of a CI failure, and weaker multi-tab, frame and browser-context isolation.

Only the third was a number. The rest were judgement calls I had to make in front of stakeholders, which is why the proof of concept mattered. I rebuilt the three highest-failure-rate scenarios in Playwright: {% metric "playwright_poc" %}. What secured sign-off was not the timing — it was demonstrating the trace viewer on a failed run, because "I cannot tell you why CI went red" was a cost every stakeholder in that room had personally paid. Three scenarios is a small sample, chosen adversarially; a demonstration for a decision conversation, not a benchmark.

### The cutover

Migration started in March 2024 and ran alongside the existing suite rather than replacing it in one step, so regression confidence never had a gap. Three things did the work.

**Native sharding instead of process-level workers.** Playwright's sharding across six CI runners gives twelve-way effective parallelism and does not re-authenticate per suite file. The decay characteristic that defeated the previous optimisation does not exist in this model, and that — not raw speed — is the actual argument for the migration.

**Removing work rather than speeding it up.** {% metric "ui_scenarios_to_api" %} did not need browser-level verification at all. They asserted on data, not on rendering, and had been UI tests only because the UI suite was where tests lived. Part of the improvement below is not speed — it is work no longer being done in the wrong place.

**Rebuilding rather than porting.** The suite grew to {% metric "playwright_scenarios" %}, from new country variants, dashboard modules and a visual regression layer — {% metric "visual_regression" %}, baselines generated in CI only, since cross-OS font rendering makes a locally-generated baseline a trap.

### Retiring the last corner, four years later

By late 2025 the framework's only remaining role was its original API regression suite — stable, unchanged since 2023, causing nobody any trouble. Then an unrelated dependency bump surfaced a transitive conflict with its pinned requirements in the shared Docker base image. I could have fixed that in about a day. I ported the suite instead, because this was the second time in a year that this one framework needed isolated attention while every other tool shared common infrastructure, and fixing the symptom again would only have scheduled the same conversation for the next conflict.

The port was deliberately slow: a three-week proof of concept on the eight highest-traffic cases — hardest cases first, the same discipline as the original migration POC — folded into the shared fixture layer built for [the contract testing work](/work/contract-testing-pact/). Then both suites ran side by side in CI for a full release cycle, and only after zero divergence did the rest follow: {% metric "robot_retirement_ported" %}. It also closed a defect the suite had carried since it was built — timestamp-based data meant a negative test depended on a preceding positive test's cleanup — because each ported case now creates and tears down its own data.

Separately, Robot Framework continues as the company-wide API automation base framework, which I still co-own. Retiring a tool from one platform is not a verdict on the tool.

## Results

- {% metric "ci_smoke_runtime" %} on the CI smoke suite and {% metric "regression_suite_runtime" %} on full regression, across the whole arc from the original serial runs.
- {% metric "ci_flake_rate" %}, making a red build a signal worth acting on for the rest of the framework's life.
- {% metric "env_drift_breakages" %}, and {% metric "docker_setup_time" %} to stand up an environment on a new machine.
- {% metric "playwright_scenarios" %} in production use, plus {% metric "botium_flows" %} on the conversational side, and {% metric "regression_effort_days" %} of manual regression.
- {% metric "robot_retirement_ported" %}, with one CI job and one Docker image removed.

## What I'd do differently

- **Measure the decay curve, not just the endpoints.** I knew the runtime was 39 minutes and a year later 65, but I did not watch it move — so I re-ran a diagnosis a trend line would have handed me months earlier. That is the argument in [threshold gates vs trend views](/writing/threshold-gates-vs-trend-views/), learned by making the mistake.
- **Move the non-browser scenarios to the API layer before deciding to migrate, not during.** Removing them first would have shown how much of the ceiling was the framework and how much was me testing the wrong things in the wrong place.
- **Still open: no scheduled re-evaluation of the current framework.** A tool can be right at adoption and wrong three years later, and last time I found that out by hitting a wall. "I would notice" is exactly what I would have said in 2022.
- **The visual regression layer is a trade I would make again and would not extend.** {% metric "visual_regression" %}, at roughly 200–400ms per scenario — a ratio that only holds at tight tolerance on a small, chosen set of screens.

## Credit

The conversational suite depends on `botium-core`, whose community adoption collapsed after its 2022 acquisition. We maintain it as an internally-patched fork rather than tracking upstream — a maintenance liability I took on knowingly and would name in any conversation about that suite's future.

## Related links

- [The refactor that broke every journey with valid JSON](/work/contract-testing-pact/) — the fixture layer that absorbed the retired API suite
- [Making a non-deterministic model produce a stable snapshot](/work/snapshot-testing-nondeterministic-ai/) — testing the conversational layer
- [Threshold gates vs trend views](/writing/threshold-gates-vs-trend-views/) — the trend argument, learned here
