---
layout: layouts/case-study.njk
title: The refactor that broke every journey with perfectly valid JSON
shortTitle: Contract testing with Pact
description: A classifier refactor broke every user's journey with valid, schema-conformant JSON. Consumer-driven contract tests failed it; the schema diff passed it.
outcome: Consumer-driven contracts catch what a schema diff cannot, a refactor that changes what a field means while leaving its shape perfectly valid.
number: 4
order: 4
period: Q4 2024 – Q4 2025
roleAtTime: QA Engineer
scope: Consumer-driven contracts between two independently deployed services, plus the API test layer underneath them.
stack: ["Python", "Pytest", "Pact", "Pact Broker", "OpenAPI", "Docker", "GitHub Actions"]
mine: The consumer contracts, the provider verification, the broker, the can-i-deploy gate, the schema-diff engine and the shared fixture layer.
notMine: Both services are the engineering team's; the classifier refactor the gate caught was another engineer's change, and it was a reasonable change.
metrics: ["pact_provider_states", "pact_blast_radius", "api_endpoints"]
tags: ["Contract testing", "Pact", "API testing", "CI gating", "Microservices"]
datePublished: 2026-08-12
dateModified: 2026-08-12
lastReviewed: 2026-08-12
---

## TL;DR

- A field rename in the classification service routed every user in staging to a fallback journey. Valid JSON, schema-conformant, no errors, no alerts. Two days to find, by correlating logs across two services by hand.
- Consumer-driven contracts fixed the class rather than the instance. The gate's first real catch failed on {% metric "pact_provider_states" %} (exactly the two that mattered), and the schema diff passed the same commit, correctly.
- Blast radius of the change that never shipped: {% metric "pact_blast_radius" %}.

## The problem

Two services, independently developed, independently deployed, on separate release cycles. The NLP classification service is the provider: it returns a classification against a nine-type scheme. The journey engine is the consumer: it reads that classification, routes the user to the next node, and writes an event row on every routing decision. Those rows are not incidental: the pharmacovigilance screening pipeline filters on them and the funnel dashboards count off them, so a routing-level misclassification propagates into compliance and analytics surfaces.

The precedent was a refactor that renamed a response field from `label` to `intent_label`, to support a multi-label format for a new program. Still valid JSON, still conformant to the documented schema. The journey engine was reading the old name, found nothing, and fell back to a default journey for every user in staging.

Nothing threw. Nothing alerted. The failure mode of a routing bug is a plausible-looking conversation that goes to the wrong place, with nothing that throws and nothing that alerts. Two days passed before anyone noticed, and diagnosis was manual log correlation across both services, slow precisely because there was no error to grep for. And the classifier's prompt iterates fast: one program alone moved through more than a dozen versions in a year. A contract that changes that often is machine-enforced or it is not enforced.

## Constraints

- **Neither team's release cadence could slow down.** Both services deploy independently, and that independence is a feature.
- **The OpenAPI spec could not be trusted as ground truth.** Engineers updated code without updating the spec, and a check comparing a change against a stale document inherits the staleness.
- **The label set was deliberately not a closed enum.** Pinning it would make every prompt iteration a breaking API change. Right call for the product; it removes the cheapest possible check.
- **I had no authority over the provider's code.** The gate had to fail *the provider's own build*, or it would be something a provider team could route around.

## Options considered

| Option | Why not |
| --- | --- |
| OpenAPI schema diff alone | Cannot express a divergence conditional on the response's own content. It never issues a request, so it finds only what the schema language can say. Kept as a second layer rather than the answer. |
| Integration tests in staging | Exactly what was already happening. That is where the two-day diagnosis came from, not a fix for it. |
| A shared types package both services import | Documents intent; does not fail a build when intent drifts. |
| Manual contract review at PR time | The contract changes faster than reviewers' memory of it. Anything held by memory degrades silently. |
| Provider-driven contracts (spec-first) | The provider declares what it emits, so it cannot fail on a change the provider considers reasonable. And this change *was* reasonable from the provider's side. |
| Postman/Newman collections | No ordering guarantee across parallel runs. Fine for shareable exploration, unmaintainable for stateful regression. |

## The decision, and the principle behind it

Consumer-driven contracts with Pact, a self-hosted broker, and `can-i-deploy` wired in as a real deployment gate. The OpenAPI diff engine stays alongside it rather than being replaced.

The principle: **the contract is what the consumer reads, not what the provider publishes.** A provider-declared schema describes what a service is willing to emit, which is a statement about the provider alone. A consumer-declared contract describes what someone downstream depends on, and that is what a change can actually break. Inverting the direction is what lets a provider's own CI fail before a change reaches an environment where anyone would notice.

The corollary, and the reason both layers exist: **a document diff and a live exercise fail on different things.**

## Implementation

**Consumer contracts, one interaction per category.** The journey engine's suite declares an interaction for each classification category, each with a named provider state written as a sentence (*given a message classified as an adverse event*, *given a greeting*), running against a Pact mock server.

The discipline that makes this work is asserting only the fields routing actually reads. Asserting the whole response body is tempting and wrong: a contract that asserts fields the consumer ignores turns every harmless provider addition into a red build, and a gate that cries wolf gets disabled. The contract should be exactly as wide as the dependency and no wider.

**The broker.** Pacts publish to a self-hosted Pact Broker in Docker, tagged by branch and application version and linked to git commit SHAs. That is what makes this more than a pair of test suites: the broker knows which consumer versions are deployed where, which is the question the gate needs answered.

**Provider verification against the real service.** The provider's CI pulls every pact tagged for the environments it is about to deploy into, spins up the real classifier, hits a state-setup endpoint to force each named case, replays the interaction, and publishes the result back.

Provider states are the load-bearing mechanism and the part people skip. Without them, verification can only replay whatever the service happens to return, so the interesting cases (a safety classification, an out-of-scope input) are unreachable unless you get lucky with fixtures. With them, verification puts the system into the exact state each interaction describes, deterministically, with no consumer present.

**can-i-deploy as an actual gate.** A CLI call in the provider's pipeline asks the broker whether that exact provider version has a passing verification against every consumer version currently deployed to the target environment. Any unverified pairing blocks the pipeline. Contract testing that produces a report is a slower way of finding out later; the value comes entirely from the pipeline going red.

**The second layer.** An OpenAPI YAML diff engine runs on every commit touching the spec, flagging structural breaking changes (removed fields, narrowed types, newly required properties, dropped enum values) with no service boot required. Cheap, and it enforces spec hygiene, a different problem from contract enforcement.

**Underneath both: the Pytest layer.** The same work absorbed the platform's API testing into Pytest across {% metric "api_endpoints" %} endpoints, including a six-call registration-to-delivery workflow that had become an unmaintainable nested-callback chain elsewhere. A shared `DataFactory` fixture module was built for reuse from day one: a decision that paid off when the last Robot Framework suite was retired into it, described in [from Robot to Playwright](/work/from-robot-to-playwright/).

**The catch.** A classifier refactor added structured pharmacovigilance detail for the two safety categories (adverse event and product quality complaint) as a nested `safety` object. For those two categories only, top-level `intent_label` became a generic `"safety_escalation"`, with the real type moved inside the nested object. The other seven were untouched.

The journey engine reads top-level `intent_label` and has no branch for `safety_escalation`. Those messages would have fallen through to the default route. The conversation would have looked fine. The event row would have recorded the fallback intent, and the screening pipeline filtering on those rows would have stopped seeing safety signals entirely while everything upstream continued to look healthy.

Verification failed on {% metric "pact_provider_states" %}. The pass/fail split localised the cause in the first thirty seconds: not "something in the classifier response changed" but "the safety categories, and only the safety categories, changed shape". The gate went red, the provider build failed, nothing reached staging. A replay of historical traffic put the blast radius at {% metric "pact_blast_radius" %}.

**And the schema diff passed it. Correctly.** The change was purely additive: a new optional object, nothing removed, no type narrowed. `"safety_escalation"` is a valid string for a field deliberately left unpinned. Most fundamentally, the divergence was *conditional on classification category*, and OpenAPI cannot say "when the label is a safety type, this field means something different". Both responses were valid instances of one documented shape.

That is the whole argument for running both layers, and why I do not call the schema diff the weaker one. It answered the question it was asked; the question was just not the one that mattered here.

## Results

- The two-day manual staging diagnosis became a build-time failure in the provider's own pipeline, pointed at the exact categories at fault.
- The first significant catch protected a compliance path: {% metric "pact_provider_states" %} failed, {% metric "pact_blast_radius" %} of misrouted rows never happened, and nothing reached staging.
- No service deploys to staging without `can-i-deploy` passing against every published consumer contract.

## What I'd do differently

- **Start with the two safety categories, not all nine.** I built the full set because completeness felt right. The catch came from the categories with downstream compliance consumers, and I could have had that protection weeks earlier by asking which interactions have a blast radius outside the conversation.
- **Write the provider-state setup endpoint with the provider team, not for them.** It works, and it is the piece they are least invested in maintaining. A verification harness whose upkeep depends on someone else's goodwill is a gate with a slow leak.
- **Still open: the contract covers one consumer pair.** Other services read the classifier's output through paths not under contract, and I know that by asking rather than from a dependency map. The fix is not more Pact: it is establishing what actually consumes those event rows, a data-lineage question I have started and not finished.
- **I chose a self-hosted broker over a managed one, and would again.** It keeps contract history inside the client's infrastructure alongside the code it describes: the right trade for a health platform, and a real cost rather than a free one.

## Related links

- [From Robot Framework to Playwright](/work/from-robot-to-playwright/): the fixture layer built here later absorbed the last Robot suite
- [Decompose by tool call](/writing/decompose-by-tool-call/): testing a classifier by what downstream reads
- [Your validation script shares the bug](/writing/your-validation-script-shares-the-bug/): why the provider's own view of correctness is not enough
- [Zero net writes](/writing/zero-net-writes/): the test-data isolation underneath the API layer
