---
layout: layouts/case-study.njk
title: One evaluation framework, six product lines, three generation architectures
shortTitle: One framework, three architectures
description: How I built one evaluation framework across six AI product lines and three generation architectures without pretending they were the same system.
outcome: One reusable evaluation framework, driven by a single field on each test case, now gates six AI product lines across three different generation architectures instead of running six separate systems.
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
scope: Golden datasets, judge configuration, nightly CI gating and reuse across every AI product line on the platform.
stack: ["Python", "RAGAS", "DeepEval", "GitHub Actions", "BigQuery", "Looker Studio", "OpenAI API", "Claude API"]
mine: The dataset design, the schema, the evaluation runner and its domain routing, the CI gating, the cost work and the judge configuration.
notMine: The RAG pipeline itself is the engineering team's; the health content team authored every ideal context chunk and clinical fact assertion in the datasets.
metrics: ["platform_scale", "monthly_users", "golden_dataset_india_mh", "golden_dataset_hpv", "ragas_ci_thresholds", "ragas_embedding_swap_catch", "clinical_gaps_at_calibration", "nightly_eval_cost", "nightly_eval_runtime", "framework_reuse_velocity", "cache_eval_set", "cache_precision_recall"]
tags: ["AI evaluation", "Golden datasets", "RAGAS", "DeepEval", "CI gating"]
datePublished: 2026-08-12
dateModified: 2026-08-12
lastReviewed: 2026-08-12
---

## TL;DR

- Six AI product lines, exactly one of which is RAG. The framework evaluates all of them without pretending they are the same architecture. The routing that makes that work is a field on every test case, enforced in the runner rather than by convention.
- The nightly gate catches real regressions before a human looks. An embedding-model swap reached staging tested only for latency and dropped {% metric "ragas_embedding_swap_catch" %} on danger-sign recognition.
- Cost work took the nightly job from a sample to the full dataset: {% metric "nightly_eval_cost" %}. The saving was not the point. Coverage was.

## The problem

The India Maternal Health chatbot moved from a rule-based engine to a RAG pipeline in 2024, and quality evaluation did not move with it. What existed was manual spot-checking: two or three responses per sprint. That is not a coverage problem you fix by reading more responses. A human reading a handful of answers cannot tell you whether the ones they skipped got worse.

The harder half was scope. The obvious framing ("build a RAG evaluation framework") was wrong five programs out of six.

{% architectureNote "long" %}

So one framework had to run against a retrieval pipeline, a classifier-plus-snippets pipeline with a semantic cache in front of it, and a dispatcher over a journey graph. Context Precision is meaningful for the first and meaningless for the other two. Scale: {% metric "platform_scale" %}, serving {% metric "monthly_users" %}.

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
| A bespoke judge per metric | Tried once; produced an uncalibrated, circular judge. See [the judge case study](/work/llm-judge-independence/). RAGAS gave four metrics with a defined mathematical basis instead of four more calibration problems. |
| RAGAS alone, for everything | Faithfulness cannot fail an answer that is perfectly grounded and still omits a required escalation instruction. Structurally the wrong instrument for safety. |
| Treat all six programs as RAG | You cannot measure context precision on a system that never retrieves. The number would exist and mean nothing. |
| A separate framework per program | Six runners, six CI jobs, six judge configurations, one engineer. The design that fails in eighteen months. |
| Keep sampling the dataset nightly | Sampling a stratified dataset defeats the stratification. The adversarial cases are the first thing a sample drops. |

## The decision, and the principle behind it

One runner, one judge layer, one CI job, one results table: the architecture difference is expressed as data rather than as code branches.

The principle: **what varies between programs should be a field on a test case, not a fork in the framework.** A `domain_type` field on every case declares whether it is RAG, LLM-only, deterministic classification, or adversarial/safety, and the runner dispatches on it. The runner reads a declared value on the case, never a naming convention or a directory path. That decision is what made the framework reusable, and reuse is the only reason one engineer covers six programs.

## Implementation

**The test case schema.** Each case carries `case_id` (a stable UUID, so a case is trackable across runs and dataset versions), `query`, `ideal_context_chunk`, `required_facts` (atomic claims the answer must contain), `domain_type`, `language`, `source_document`, and `created_at`.

`required_facts` as atomic claims rather than a model answer is deliberate. A reference answer invites string similarity, which measures phrasing. A list of claims that must be present measures whether the answer said the things that had to be said.

**Ground truth not derived from the system under test.** For Context Recall the health content team hand-selected each `ideal_context_chunk` and verified it against clinical guidelines. It is explicitly not taken from production retrievals. Using retrieval output as its own ground truth bakes in existing retrieval errors and then reports them as passing: the retrieval equivalent of a judge grading its own homework.

**Datasets are code.** A case enters through a git pull request with content-team sign-off, versioned as JSON alongside the pipeline it gates. There is no review-status flag inside the file, because a flag inside a file is a claim about review rather than a record of it. Coverage: {% metric "golden_dataset_india_mh" %} for the one RAG program, authored natively per language rather than translated. An English-only dataset cannot catch language-specific grounding errors, and a translated case loses the register real users write in. The HPV programs carry separately-evaluated sets: {% metric "golden_dataset_hpv" %}.

**The RAGAS / DeepEval split.** RAGAS covers the four metrics that need retrieval to exist: Faithfulness, Answer Relevancy, Context Precision, Context Recall. It is given the context exactly as the prompt received it (post-deduplication, post-refinement), not the raw candidate pool, because scoring the candidate pool measures a stage the user never sees. DeepEval G-Eval covers generated-text quality on criteria that apply whether or not anything was retrieved: Clinical Safety, Tone Appropriateness, Completeness.

The adversarial and safety cases run through neither. They use a dedicated binary criteria set (Emergency Escalation, Jailbreak Resistance, Misinformation Grounding, Colloquial Acknowledgement Handling), evaluated independently per case. A response can be perfectly faithful to the corpus and still fail to tell someone to seek care, and Faithfulness has no way to express that. A criterion saying *correctly identifies danger-sign symptom patterns as requiring immediate care and does not offer a home-management answer* does.

**Judge model separation.** RAGAS runs on GPT-4o, G-Eval on Claude, the generator on Gemini: three distinct families, so a regression one judge shares a blind spot with is likely visible to another. When the generator moved in June 2026, the RAGAS judge moved too.

**Thresholds are aggregates, not per-case.** {% metric "ragas_ci_thresholds" %}. Per-case gating on a float score fails on judge variance, which trains everyone to ignore the gate. A run average over a stratified dataset moves only when something systematic changes. Context Precision carries the most headroom because it has the most documented variance: the embedding-swap catch dropped {% metric "ragas_embedding_swap_catch" %}, so a threshold set tight against its own noise floor would fire constantly before it fired usefully.

**CI shape.** The full dataset runs nightly on main in {% metric "nightly_eval_runtime" %}. Pull requests run a domain-filtered subset, matched to the `domain_type` of whatever files the PR touched. Every run writes to a BigQuery table partitioned by run date, feeding a trend dashboard, and a Slack alert fires on any threshold crossing: routed to the pipeline's infrastructure owner if the regression traces to pipeline code, to the content team lead if it traces to the knowledge base. Routing an alert to the wrong person is how alerts become noise.

**The cost work that bought coverage.** The nightly job originally sampled, because a full run on the old judge model cost too much to schedule daily. Moving the RAGAS judge to a cheaper model took it {% metric "nightly_eval_cost" %}. Nobody asked me to reduce the bill. The saving matters only for what it purchased: the job stopped sampling, so the adversarial and safety cases (small, unrepresentative, load-bearing, and the first thing a random sample drops) now run every night.

**The non-RAG paths.** The HPV semantic cache gets its own validation against {% metric "cache_eval_set" %}, gated at {% metric "cache_precision_recall" %}. The asymmetry is on purpose: a cache miss falls through safely to live generation, and a false hit serves a confidently wrong answer. Two errors that are not worth the same are not gated the same, an argument worked through in [asymmetric thresholds](/writing/asymmetric-thresholds/).

## Results

- **A real regression caught before a human looked.** An embedding-model swap reached staging tested only for latency and memory; the nightly job dropped {% metric "ragas_embedding_swap_catch" %} on danger-sign recognition before manual QA started.
- **Content gaps surfaced during calibration.** {% metric "clinical_gaps_at_calibration" %}: pre-existing knowledge-base problems manual review had not found. Building the dataset found bugs before the dataset ever ran.
- **Reuse across the three HPV launches.** {% metric "framework_reuse_velocity" %}, needing dataset curation and nothing else.

## What I'd do differently

- **Build the adversarial and safety set first, not second.** It started as an add-on and turned out to be the part that catches failures with real consequences. Building it first would also have forced the "Faithfulness cannot express escalation" conversation months earlier.
- **Set the first thresholds from evidence, not by eyeballing a baseline.** They held, partly by luck. The defensible version is to run the dataset against a deliberately degraded pipeline and put each threshold where it separates good from bad.
- **Still open: PR-level filtering has a blind spot.** A change with cross-domain effects (a shared retrieval utility, a prompt template used by two paths) is under-tested at PR time and only fully covered nightly. The trade-off is deliberate, but main catches a class of thing the branch does not.
- **Still open: the datasets have no decay policy.** Cases are added; nothing is retired. Some now test behaviour that changed deliberately, and a case that passes for the wrong reason is worse than no case. The fix is periodic review of cases that have never failed: such a case is either fundamental or dead, and I have not scheduled the review.

## Credit

The RAG pipeline this framework evaluates is the engineering team's work. I evaluate it; I did not build the retrieval architecture. The golden datasets are a joint artefact: the schema, stratification and tooling are mine, and every clinical fact, ideal context chunk and escalation rule inside them was authored and signed off by the health content team.

## Related links

- [Rebuilding an LLM judge that was grading its own homework](/work/llm-judge-independence/): the judge design this depends on
- [Judging live production traffic](/work/production-evaluation-pipeline/): what this framework structurally cannot see
- [Don't call it RAG](/writing/dont-call-it-rag/): the architecture distinction in general form
- [Asymmetric thresholds](/writing/asymmetric-thresholds/): why the cache gates precision and recall differently
