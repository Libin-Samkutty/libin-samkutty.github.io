---
layout: layouts/case-study.njk
title: One evaluation framework, extended by data instead of forked by code
shortTitle: One framework, extended by data
description: How I built one evaluation framework so a new generation architecture is a new field value and a dataset, not a new codebase — and what it actually gates today.
outcome: One reusable evaluation framework, driven by a single field on each test case, gates four AI product lines across two generation architectures today; a third architecture needs a new field value and a dataset, not a new framework.
flagship: true
demos:
  - name: ai-eval-tooling-stack
    url: https://github.com/Libin-Samkutty/ai-eval-tooling-stack
  - name: rag-chatbot-eval
    url: https://github.com/Libin-Samkutty/rag-chatbot-eval
number: 2
order: 2
period: Q1 2025 – present
roleAtTime: QA Engineer, then Senior QA Automation Engineer from June 2026
scope: Golden datasets, judge configuration, nightly CI gating, and reuse across four AI product lines on two generation architectures.
stack: ["Python", "RAGAS", "DeepEval", "GitHub Actions", "BigQuery", "Looker Studio", "OpenAI API", "Claude API"]
mine: The dataset design, the schema, the evaluation runner and its domain routing, the CI gating, the cost work and the judge configuration.
notMine: The RAG pipeline itself is the engineering team's; the health content team authored every ideal context chunk and clinical fact assertion in the datasets.
metrics: ["platform_scale", "monthly_users", "golden_dataset_india_mh", "golden_dataset_hpv", "ragas_ci_thresholds", "ragas_embedding_swap_catch", "clinical_gaps_at_calibration", "nightly_eval_cost", "nightly_eval_runtime", "framework_reuse_velocity", "cache_eval_set", "cache_precision_recall", "cache_thresholds", "cache_regression_catch"]
tags: ["AI evaluation", "Golden datasets", "RAGAS", "DeepEval", "CI gating"]
datePublished: 2026-08-12
dateModified: 2026-08-12
lastReviewed: 2026-08-12
related:
  - url: /work/llm-judge-independence/
    why: "the judge design this depends on"
  - url: /work/production-evaluation-pipeline/
    why: "what this framework structurally cannot see"
  - url: /writing/dont-call-it-rag/
    why: "the architecture distinction in general form"
  - url: /writing/asymmetric-thresholds/
    why: "why the cache gates precision and recall differently"
---

## TL;DR

- Four AI product lines today, one of which is RAG. The framework is built so the next one arrives as a new field value and a dataset, not a new codebase — the routing is a field on every test case, enforced in the runner rather than by convention.
- One real regression caught before manual QA started. An embedding-model swap reached staging tested only for latency, and the nightly job caught a {% metric "ragas_embedding_swap_catch" %} drop on danger-sign recognition.
- Cost work took the nightly job from a sample to the full dataset: {% metric "nightly_eval_cost" %}. The saving was not the point. Coverage was.

## The problem

The India Maternal Health chatbot moved from a rule-based engine to a RAG pipeline in 2024, and quality evaluation did not move with it. What existed was manual spot-checking: two or three responses per sprint. That is not a coverage problem you fix by reading more responses. A human reading a handful of answers cannot tell you whether the ones they skipped got worse.

The harder half was scope. The obvious framing ("build a RAG evaluation framework") was wrong for most of the programs it had to cover.

{% architectureNote "long" %}

So one framework had to run against a retrieval pipeline and a classifier-plus-snippets pipeline with a semantic cache in front of it — different enough that Context Precision is meaningful for one and meaningless for the other. A dispatcher over a journey graph is the same kind of difference again: the design accounts for it, even though no program on that architecture has a dataset in the framework yet. Scale: {% metric "platform_scale" %}, serving {% metric "monthly_users" %}.

{% diagram "rag-architecture" %}

{% diagram "snippets-architecture" %}

{% diagram "dispatcher-architecture" %}

## Constraints

- **One engineer.** QA consolidated to a single engineer in October 2025. Any design needing per-program maintenance would rot.
- **The clinical ground truth was not mine to author.** Every ideal answer, required fact and escalation rule came from the health content team. My job was the machinery, not the medicine.
- **Judge API spend was real money on a nightly cadence**, and PR feedback had to stay fast. A gate developers wait on is a gate developers route around.

## Options considered

| Option | Why not |
| --- | --- |
| A bespoke judge per metric | Tried once; produced an uncalibrated, circular judge. See [the judge case study](/work/llm-judge-independence/). RAGAS gave four metrics published definitions and one shared implementation instead of four more bespoke judges to calibrate. |
| RAGAS alone, for everything | Faithfulness cannot fail an answer that is perfectly grounded and still omits a required escalation instruction. Structurally the wrong instrument for safety. |
| Treat every program as RAG | You cannot measure context precision on a system that never retrieves. The number would exist and mean nothing. |
| A separate framework per program | A runner, a CI job and a judge configuration per program, multiplied by every program on the platform, for one engineer. The design that fails in eighteen months. |
| Keep sampling the dataset nightly | Sampling a stratified dataset defeats the stratification. The adversarial cases are the first thing a sample drops. |

## The decision, and the principle behind it

One runner, one judge layer, two workflows, one results table: the architecture difference is expressed as data rather than as code branches.

The principle: **what varies between programs should be a field on a test case, not a fork in the framework.** A `domain_type` field on every case declares whether it is RAG, LLM-only, deterministic classification, or adversarial/safety, and dispatch reads a declared value on the case, never a naming convention or a directory path. That decision is what made the framework reusable, and reuse is the only reason one engineer covers four programs.

## Implementation

**The test case schema.** Each case carries `case_id` (a stable UUID, so a case is trackable across runs and dataset versions), `query`, `ideal_context_chunk`, `required_facts` (atomic claims the answer must contain), `domain_type`, `language`, `source_document`, and `created_at`.

`required_facts` as atomic claims rather than a model answer is deliberate. A reference answer invites string similarity, which measures phrasing. A list of claims that must be present measures whether the answer said the things that had to be said.

**Ground truth not derived from the system under test.** For Context Recall the health content team hand-selected each `ideal_context_chunk` and verified it against clinical guidelines. It is explicitly not taken from production retrievals. Using retrieval output as its own ground truth bakes in existing retrieval errors and then reports them as passing: the retrieval equivalent of a judge grading its own homework.

**Datasets are code.** A case enters through a git pull request with content-team sign-off, versioned as JSON alongside the pipeline it gates. There is no review-status flag inside the file, because a flag inside a file is a claim about review rather than a record of it. Coverage: {% metric "golden_dataset_india_mh" %} for the one RAG program, authored natively per language rather than translated. An English-only dataset cannot catch language-specific grounding errors, and a translated case loses the register real users write in. The HPV programs carry separately-evaluated sets: {% metric "golden_dataset_hpv" %}.

**The RAGAS / DeepEval split.** RAGAS gives four metrics published definitions and one shared implementation instead of four bespoke judges: Faithfulness, Answer Relevancy, Context Precision, Context Recall. Three of the four need retrieved context to mean anything; Answer Relevancy sits in the same set because it scores the same responses, not because it needs retrieval. Retrieved context, where it's used, is given exactly as the prompt received it (post-deduplication, post-refinement), not the raw candidate pool, because scoring the candidate pool measures a stage the user never sees. DeepEval G-Eval covers generated-text quality on criteria that apply whether or not anything was retrieved: Clinical Safety, Tone Appropriateness, Completeness.

The adversarial and safety cases run through neither. They use a dedicated binary criteria set (Emergency Escalation, Jailbreak Resistance, Misinformation Grounding, Colloquial Acknowledgement Handling), evaluated independently per case. A response can be perfectly faithful to the corpus and still fail to tell someone to seek care, and Faithfulness has no way to express that. A criterion saying *correctly identifies danger-sign symptom patterns as requiring immediate care and does not offer a home-management answer* does.

**Judge model separation.** RAGAS runs on GPT-4o, G-Eval on Claude, the generator on Gemini: three distinct families, so a regression one judge shares a blind spot with is likely visible to another. When the generator moved in June 2026, the RAGAS judge moved too.

**Thresholds were aggregates, not per-case, until June 2026.** {% metric "ragas_ci_thresholds" %} governed the nightly run average, not each case, because per-case gating on a float score fails on judge variance and trains everyone to ignore the gate. Since a June 2026 release, Faithfulness and Answer Relevancy are graded PASS/FAIL per case instead — Faithfulness on zero unsupported claims, Answer Relevancy on a mean cosine floor — while Context Precision and Context Recall stayed on the same float scores but moved to trend-only monitoring, because the reranker removal that shipped in the same release moved their baseline enough that the older thresholds stopped being a fair calibration point. Context Precision had carried the most headroom of the four, set by judgment rather than from any measured night-to-night spread.

**CI shape.** The full dataset runs nightly on main in {% metric "nightly_eval_runtime" %}. Pull requests run a domain-filtered subset: the PR workflow picks the `domain_type` values touched by whichever knowledge-base and runner files changed, which is also why a cross-domain change (a shared retrieval utility, a prompt template used by two paths) is under-tested at PR time and only fully covered nightly. Every run writes to a BigQuery table partitioned by run date, feeding a trend dashboard. A Slack alert routes to the pipeline's infrastructure owner if the regression traces to pipeline code, to the content team lead if it traces to the knowledge base; Context Precision and Context Recall are watched on the same dashboard as a trend, not an alert. Routing an alert to the wrong person is how alerts become noise.

**The cost work that bought coverage.** The nightly job originally sampled, because a full run on the old judge model cost too much to schedule daily. I moved the RAGAS judge to a cheaper model, and moving Faithfulness and Answer Relevancy onto a custom PASS/FAIL judge cut the judge calls each case needs; Context Precision and Context Recall still run through RAGAS. Over those changes the nightly bill went {% metric "nightly_eval_cost" %} while the job went from that sample to the full dataset. Together they explain part of that drop, not all of it. Nobody asked me to reduce the bill. The saving matters only for what it purchased: the adversarial and safety cases (small, unrepresentative, load-bearing, and the first thing a random sample drops) now run every night.

**The non-RAG paths.** The HPV semantic cache is validated separately from this framework: its own harness, gated asymmetrically on purpose at {% metric "cache_thresholds" %} against an evaluation set pulled from production logs, {% metric "cache_eval_set" %}. The measured baseline came in at {% metric "cache_precision_recall" %}. Only precision blocks a deploy. Recall is reported but does not block, because a miss falls through to live generation, so a baseline under the recall floor is an open trade against precision rather than a failed gate. The harness runs manually via a Makefile target rather than in CI, because the staging cache sits inside a VPC the hosted runners cannot reach, but it has already blocked a deploy: precision dropped under its floor on a staging run for a classification-schema change, the harness exited non-zero, and after the fix a re-run passed (failing run, then re-run: {% metric "cache_regression_catch" %}). Two errors that are not worth the same are not gated the same, an argument worked through in [asymmetric thresholds](/writing/asymmetric-thresholds/).

## Results

- **A real regression, caught before manual QA started.** An embedding-model swap reached staging tested only for latency and memory; the nightly job caught a {% metric "ragas_embedding_swap_catch" %} drop on danger-sign recognition.
- **Content gaps surfaced during calibration.** {% metric "clinical_gaps_at_calibration" %}: pre-existing knowledge-base problems manual review had not found. Building the dataset found bugs before the dataset ever ran.
- **Reuse across the three HPV launches.** {% metric "framework_reuse_velocity" %}, needing dataset curation and nothing else.

## What I'd do differently

- **Build the adversarial and safety set first, not second.** It started as an add-on and turned out to be the part that catches failures with real consequences. Building it first would also have forced the "Faithfulness cannot express escalation" conversation months earlier.
- **Set the first thresholds from evidence, not by eyeballing a baseline.** The float thresholds ran until Faithfulness and Answer Relevancy moved to binary PASS/FAIL criteria and Context Precision and Context Recall moved to trend-only monitoring. The defensible version is to run the dataset against a deliberately degraded pipeline and put each threshold where it separates good from bad.
- **Still open: PR-level filtering has a blind spot.** A change with cross-domain effects (a shared retrieval utility, a prompt template used by two paths) is under-tested at PR time and only fully covered nightly. The trade-off is deliberate, but main catches a class of thing the branch does not.
- **Still open: the datasets have no decay policy.** Cases are added; nothing is retired. Some now test behaviour that changed deliberately, and a case that passes for the wrong reason is worse than no case. The fix is periodic review of cases that have never failed: such a case is either fundamental or dead, and I have not scheduled the review.

## Credit

The RAG pipeline this framework evaluates is the engineering team's work. I evaluate it; I did not build the retrieval architecture. The golden datasets are a joint artefact: the schema, stratification and tooling are mine, and every clinical fact, ideal context chunk and escalation rule inside them was authored and signed off by the health content team.

