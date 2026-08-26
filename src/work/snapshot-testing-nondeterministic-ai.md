---
layout: layouts/case-study.njk
title: Making a non-deterministic model produce a stable snapshot
shortTitle: Snapshot testing a non-deterministic AI
description: How I made a non-deterministic classifier produce stable snapshots, with bit-field-aware diffing and a four-level regression severity taxonomy.
outcome: A bit-field-aware diff and a four-level severity taxonomy turned a non-deterministic classifier's output into something a snapshot suite could actually gate on.
demos:
  - name: prompt-regression-tester
    url: https://github.com/Libin-Samkutty/prompt-regression-tester
number: 5
order: 5
period: October 2024 – May 2025
roleAtTime: QA Engineer
scope: Prompt-version regression for the classification prompts, extended to journey configs and outbound message templates.
stack: ["Python", "pytest", "JSON snapshot persistence", "Claude API", "GitHub Actions", "pythainlp"]
mine: The canonical set design, the determinism rule, the bit-field diff, the severity taxonomy and the CI gate. It also covers the two extensions built on the same infrastructure.
notMine: The classification prompts are the NLP team's; the journey graphs are the designers'; the template copy is the content team's.
metrics: ["prompt_review_time", "snapshot_canonical_set", "snapshot_majority_vote", "snapshot_regressions_caught", "prompt_hotfixes", "journey_config_review_time", "template_validation_coverage"]
tags: ["Snapshot testing", "Non-determinism", "Prompt regression", "CI gating"]
datePublished: 2026-08-12
dateModified: 2026-08-12
lastReviewed: 2026-08-12
---

## TL;DR

- Every classification prompt version bump meant running a canonical utterance set by hand and reading the labels: {% metric "prompt_review_time" %}, per version, with reviewer fatigue concentrated on exactly the edge cases that mattered.
- A snapshot suite needs a deterministic target, and the model was not deterministic. {% metric "snapshot_majority_vote" %} produced one.
- The same infrastructure then covered journey configuration graphs and outbound message templates, because the hard part was never the classification. It was the diff.

## The problem

The chatbots route utterances to intents using versioned classification prompts. Through 2024 one went through a full rebuild of its type scheme and several increments after that, each adding labels.

Every version bump required running a canonical utterance set across three languages and reading the output labels by hand. {% metric "prompt_review_time" %}, and the review degraded exactly where it needed to be sharpest. A reviewer who has read a hundred correct labels does not read the hundred-and-first carefully. Two silent label regressions reached production before anyone caught them: an acknowledgement label bleeding into a side-effect label for Indonesian utterances, and a Hindi emergency intent falling through to a generic label after a restructure.

The failure mode is the interesting part. Neither regression broke anything. The classifier returned a valid label from the valid label set with reasonable confidence. It was just the wrong one, for a class of utterance nobody re-checked, in a language the reviewer did not read first.

## Constraints

- **The model is non-deterministic.** Any comparison against a stored baseline had to survive that. A suite that fails randomly is worse than no suite, because it trains people to ignore red.
- **The output is not free-form text.** The classifier emits a pipe-separated bit-field alongside the label, and the bit positions get restructured as the label set evolves.
- **Three country programs iterate their prompts concurrently**, so baselines could not collide across programs or versions.
- **Label additions are normal.** A tool treating every new label as a regression gets turned off within two sprints.

## Options considered

| Option | Why not |
| --- | --- |
| Keep the manual canonical run | Does not scale with version cadence, and its accuracy is worst on the edge cases it exists to protect. |
| Assert an expected label per utterance in test code | A snapshot with none of the tooling. Every label-set change becomes a hand-edit across the whole file, so it gets skipped. |
| Standard JSON diff on the serialised output | Flags every bit position as changed when positions shift during a restructure, even when the net classification is identical. |
| An accuracy threshold over the canonical set | An aggregate says the set is 96% right, not which labels moved. A rare-but-critical regression does not move it. |
| Single run at temperature 0 | Closer, not deterministic. Occasional flips would produce false regressions and kill trust in the gate. |

## The decision, and the principle behind it

Serialise the full classification output for a fixed canonical set as a versioned JSON baseline, diff each new prompt version against the prior one, and classify every diff by severity so a reviewer reads a change report instead of a wall of labels.

The principle: **a snapshot test does not need the system to be deterministic; it needs the recorded target to be.** Those are different requirements, and the gap between them is where the engineering lives.

The second principle, which made the tool survive contact with reviewers: **a diff's job is to judge which differences matter, not just to list them.** A diff that reports everything equally has moved the reading problem rather than solved it.

## Implementation

**The canonical set.** {% metric "snapshot_canonical_set" %}, stratified across intent labels, languages and edge cases, covering the three HPV classification prompts. Stratified rather than sampled: the point is not to mirror traffic distribution but to guarantee every label and every known-awkward case runs every time. The rare labels are the ones that regress silently, because they are also rare in real traffic.

**Making the target deterministic.** {% metric "snapshot_majority_vote" %}. Temperature 0 gets most of the way and does not finish the job: the same input still flips occasionally, particularly near a label boundary. The quorum absorbs that, and has a second, unplanned use: an utterance that fails to reach quorum is itself a finding, because the prompt has no stable opinion about that input. The cost is worth naming: every run is three model calls per utterance. That is the price of a baseline you can trust, and it is paid by a machine rather than a reviewer.

**Bit-field-aware diffing.** The classifier's output carries a pipe-separated field alongside the label: six positions, each a distinct signal. A standard JSON diff treats that string as atomic, so when a restructure shifts positions, every field reads as changed even where the net classification is unchanged.

The diff logic parses the field and compares each position independently. This single change is what made the reports readable. Before it, a restructure produced a diff in which every utterance had changed and a reviewer decided by hand which were real. After it, a restructure produces a diff saying one specific position moved, uniformly, across all utterances: exactly what a positional restructure *is*, and a one-line conclusion instead of an afternoon.

**Four severity levels, not a pass/fail.** Every diff is categorised as a hard regression (wrong label on a known-correct utterance), a soft regression (confidence tier drop), a format regression (bit-field shape change), or informational (a new label added, expected). Hard regressions block; the others report.

The taxonomy is what stops the tool from being switched off. A prompt version that adds a label produces a large diff by definition, and a gate treating a large diff as a failure gets bypassed on the first legitimate label addition. Separating "this changed" from "this got worse" is the whole design.

**Baselines as artefacts.** Snapshots live in a per-program, per-version directory structure, so concurrent development across three programs cannot collide. A baseline is promoted deliberately, as part of a version promotion, not regenerated whenever the suite is red. A snapshot tool where updating the baseline is the easiest way to turn CI green records history rather than gating it.

**Extension one: journey configuration graphs.** The journeys are JSON graphs edited by designers and engineers simultaneously; the largest is 32 nodes across nine phases with two entry paths, and reviewing one by hand took the better part of an hour. Two mis-wiring bugs had already reached user-acceptance testing rather than review.

Same machinery, pointed at structure instead of model output. The snapshot captures node count per phase, edge adjacency per node, the phase label set, entry-path definitions, button payload mappings and re-engagement hook points. It deliberately excludes message copy, which changes constantly and legitimately. Severity mirrors the prompt suite: a removed node, broken edge or changed entry path blocks merge; a renamed phase or altered payload reports. {% metric "journey_config_review_time" %}.

One detail earned its keep above the rest: button payload strings are cross-referenced against the committed classification label baselines from the prompt suite, so a label renamed in a prompt that orphans a routing edge in a journey config is caught at diff time: across two artefacts no single reviewer would have opened together.

**Extension two: outbound message templates.** The programs send approved templates for reminders and follow-ups, with positional placeholders substituted in application code. Two encoding bugs had already reached production (a Devanagari character double-encoded on some clients, and a placeholder shifted by a copy-edit so a raw placeholder string reached users), each requiring an emergency re-submission with an approval turnaround measured in days.

The suite renders every active template against canonical substitution fixtures per language and snapshots the output, checking that placeholder count matches substitution arity, that no raw placeholder survives, that encoding round-trips through Unicode NFC, that the rendered string stays inside the body length limit, and that button payloads match the classification label set. Thai needed a segmentation step first, since it has no word-boundary spaces. Baselines come from the approved-template API response rather than the design-side draft, because the approval process normalises whitespace and a draft-sourced baseline produces a false diff on every submission. Coverage went {% metric "template_validation_coverage" %}.

## Results

- {% metric "prompt_review_time" %} per prompt version, with human attention redirected to flagged diffs.
- {% metric "snapshot_regressions_caught" %} in the suite's first three months.
- {% metric "prompt_hotfixes" %}.
- {% metric "journey_config_review_time" %}, and journey-breaking config bugs stopped reaching user-acceptance testing.
- {% metric "template_validation_coverage" %}, with three latent bugs found the moment the baselines were first committed: a missing null-value fallback, an over-length rendered string, and a mismatched button payload.

That last line repeats across all three extensions: writing down what the current behaviour *is* found bugs before the tool ran a single comparison. Establishing a baseline is itself a test.

## What I'd do differently

- **Build the label-to-journey cross-reference first.** It was the third thing I added and it is the check spanning two artefacts nobody reviews together. Single-artefact checks find bugs a careful reviewer would eventually find; cross-artefact checks find the ones no reviewer is positioned to find at all.
- **Do not fix the canonical set at one size.** {% metric "snapshot_canonical_set" %} was chosen for review tractability under the old manual process, and once review stopped being manual that constraint disappeared. The set should have grown with the label scheme and did not, so the newest labels are the thinnest covered.
- **Still open: baseline promotion has no second pair of eyes.** A reviewer approving a prompt PR sees the new baseline in the diff without necessarily reading it, so a real regression can be blessed into the baseline and become invisible. The fix is a separate approval on baseline changes: process rather than code, which is why it is still open.
- **Still open: nothing verifies the canonical set still resembles production traffic.** It was stratified against the label scheme, not against how people actually write, and has not been re-derived since. The traffic analysis exists; I have not wired the two together.

## Related links

- [One evaluation framework, three architectures](/work/ai-evaluation-framework/): the evaluation layer above these structural checks
- [The refactor that broke every journey with valid JSON](/work/contract-testing-pact/): the same class of failure, one service boundary away
- [Decompose by tool call](/writing/decompose-by-tool-call/): evaluating a classifier by structure rather than by prose
- [Audit your own traffic](/writing/audit-your-own-traffic/): how a canonical set should be derived
