---
layout: layouts/post.njk
title: Gate your two failure modes at two different thresholds
shortTitle: Two failure modes, two thresholds
description: A single accuracy target claims both of a classifier's failure modes cost the same. Here is how to price them separately and decide which one blocks a deploy.
date: 2026-05-06
dateModified: 2026-08-12
metrics: [cache_eval_set, cache_thresholds, cache_precision_recall, cache_regression_catch, crisis_prompt_fp_testset]
tags: [evaluation, thresholds, classifiers, caching]
technical: true
---

A pass threshold is a claim about cost. Set one number for a whole classifier and you have claimed that both of its failure modes cost the same amount. They almost never do.

## An accuracy target averages over two different things

Any binary gate has two ways to be wrong, and they are not variants of one another. A false positive and a false negative have different consequences, land on different people, and get discovered by different mechanisms. A single accuracy or F1 target lets an optimiser trade one for the other freely, which is only defensible if the exchange rate between them is one to one.

The question that settles the exchange rate is not "how bad does this look". It is narrower and much easier to answer: **what is the next thing the system does after each error?**

If one error falls through to a slower, safer path, it costs latency and money. If the other is served to a person as an answer, it costs correctness, and nothing downstream will catch it. Those are two currencies. One threshold cannot price both.

## Worked example: a semantic response cache

{% architectureNote "short" %}

A vector semantic cache sits in front of generation. A query comes in, gets embedded, and if something close enough is already stored, the stored answer is returned. Cheap and fast. It has exactly two failure modes:

**A cache miss.** The query should have hit and did not. The system falls through to live generation. The user gets a correct answer, slightly later, and it cost an inference call. Nobody is harmed.

**A false cache hit.** A stored answer is returned for a query it does not actually answer. The user gets a confidently wrong answer, fast, with nothing downstream to check it. In a health context, that is the failure that matters.

So the harness that validates the cache is gated asymmetrically on purpose: {% metric "cache_thresholds" %}. That gap is not a compromise between two ideals. It is the two costs, written down.

The evaluation set behind it is {% metric "cache_eval_set" %}, pulled from real production logs and labelled by hand. The measured baseline came in at {% metric "cache_precision_recall" %}.

Read those two numbers against their two thresholds and they say something specific and actionable: no wrong answers are being served, and cache hits are being left on the table. That is a tuning problem on the similarity threshold, not a safety problem. A single accuracy figure would have averaged the two into one number that looked broadly fine and told me nothing about which lever to reach for.

The gate earned itself back the first time a classification-schema change went through. Precision dropped under the floor on a staging run, the harness exited non-zero, and the deploy stopped. After the fix, a re-run passed: {% metric "cache_regression_catch" %}.

Two honest notes. It runs manually via a Makefile target rather than in CI, because the staging cache sits inside a VPC our hosted runners cannot reach. A validation tool does not need CI integration to prove real value. It just needs to run before the moment that matters. And the recall shortfall is still open: closing it means loosening the similarity threshold, which moves precision in the wrong direction at the same time, so it is a real trade rather than a free win.

## Writing the thresholds down

The procedure is four steps and takes an afternoon.

1. **Name the two errors in the system's own vocabulary**, not the confusion matrix's. Not "false positive": "a stored answer served for a question it doesn't answer."
2. **For each, finish the sentence "when this happens, the next thing that happens is ___".** If you cannot finish it, you do not yet know the cost, and any threshold you pick is decoration.
3. **The error with a safe fallback gets the loose bar. The error that reaches a person unchecked gets the tight one.**
4. **Say which bar blocks the deploy.** A threshold nobody blocks on is a dashboard.

Step four is the one teams skip, and it is the one that makes the asymmetry real rather than rhetorical:

```python
GATES = {
    # A false hit is served to a user as an answer. This one stops the deploy.
    "precision": Gate(floor=PRECISION_FLOOR, blocking=True),
    # A miss falls through to live generation. This one reports and moves on.
    "recall":    Gate(floor=RECALL_FLOOR,    blocking=False),
}
```

Two lines of configuration carrying the entire risk model of the component. Anyone reading that file learns, in five seconds, which failure the team is actually afraid of.

## The same reasoning runs the other way too

Asymmetry does not always favour precision. On the same platform, a crisis and adverse-event detection layer is deliberately tuned the opposite way. Missing a genuine case is a reportable compliance event with no second reader; a false positive lands in a human review queue and costs someone a minute. Recall is the gate there, and precision is the thing you are allowed to improve. It only counts once you have proven recall did not move.

That constraint made the tuning work narrower and harder than it looked. Any prompt change had to demonstrate that true-positive detection was unchanged before its false-positive gains counted at all: {% metric "crisis_prompt_fp_testset" %}, with detection of genuine cases holding steady across both versions.

Same principle, inverted conclusion. The direction of the asymmetry comes from where the safe fallback is, not from a preference for precision.

## Where else this applies

Anywhere a threshold gates a classifier and the two errors take different downstream paths:

- **Spam and abuse filters.** A false positive silences a real person, usually with no appeal path. A false negative gets caught in a report queue. Gate tighter on the one with no second reader.
- **Fraud scoring.** A blocked legitimate transaction is a support ticket and a lost customer. A missed fraudulent one is money. The costs are genuinely comparable here, which is the rare case where a symmetric target is defensible.
- **Retrieval reranking.** A relevant document ranked too low costs recall the generator may survive. An irrelevant document ranked high gets grounded into an answer as if true.
- **Routing and intent classification.** Routing to a general handler is recoverable. Routing confidently to the wrong specialist handler is not, because the wrong handler will answer.

## The rule

Before you set a number, name the fallback. The error with a safe fallback gets the loose threshold; the error that reaches a person gets the tight one. If both reach a person, you do not have a threshold problem. You have a design problem, and no choice of number will fix it.

---

Related: [the evaluation framework these gates run inside](/work/ai-evaluation-framework/), [why the architecture decides the metric](/writing/dont-call-it-rag/), and [why a checker that shares a dependency cannot see past it](/writing/your-validation-script-shares-the-bug/).
