---
layout: layouts/case-study.njk
title: Judging live traffic, and finding the gap four test layers had missed
shortTitle: Judging live production traffic
description: Anomaly-triggered sampling on live traffic surfaced a clinical-safety gap that four independent offline testing layers had each missed for the same reason.
number: 3
order: 3
period: Q4 2025 – present
roleAtTime: QA Engineer, then Senior QA Automation Engineer from June 2026
scope: Real-time evaluation of production conversations, with a human annotation loop back into the datasets.
stack: ["AWS MSK (Kafka)", "AWS Lambda", "AWS Glue Schema Registry", "LangSmith", "Prometheus", "Grafana", "Python", "Parameter Store"]
mine: "The evaluation side: event schema requirements, sampling design, the evaluator Lambda logic, the trace assertion layer and the LangSmith annotation loop."
notMine: The lead developer owned MSK provisioning, the pipeline's log emission and the infrastructure budget; the RAG pipeline itself is the engineering team's.
metrics: ["production_sampling", "anomaly_sampling_yield", "danger_sign_fix_time", "clinical_safety_pass", "annotation_queue_routing", "annotation_override_rate", "rag_retrieval_latency", "reranker_batching_share", "e2e_latency_2026"]
tags: ["Production monitoring", "Kafka", "LLM-as-a-judge", "Sampling", "Human-in-the-loop"]
datePublished: 2026-08-12
dateModified: 2026-08-12
lastReviewed: 2026-08-12
---

## TL;DR

- The golden-dataset framework answered whether the pipeline passed the cases someone thought to write. It could not answer whether the pipeline worked for what users actually sent. Different questions.
- Within two weeks of go-live, anomaly-triggered sampling surfaced a clinical-safety failure class that four independent offline layers had each missed for the same reason. Diagnosed, fixed, closed: {% metric "danger_sign_fix_time" %}.
- The honest limitation, published as a limitation: {% metric "annotation_override_rate" %}. The judge is too conservative on non-urgent symptom mentions because the criteria do not distinguish severity.

## The problem

By late 2025 the offline framework was doing its job: nightly runs, gated thresholds, real regressions caught before humans looked. It is described in full in [the evaluation framework case study](/work/ai-evaluation-framework/).

Then the content team escalated something the framework had no opinion about. Users describing pregnancy complications were receiving responses that were warm, clinically accurate, and contained no instruction to seek care. The golden dataset had zero coverage for that category: not a gap in its size, a gap in its imagination.

That is the structural limit of offline evaluation. A golden dataset measures performance on cases a curator wrote. It cannot describe performance on the actual distribution of how real users phrase things, because that distribution is broader than any curator anticipates. Passing your own test cases and working for real users are different claims.

{% architectureNote %}

## Constraints

- **Judging every production event is not affordable.** Whatever sampling I chose had to be defensible, because sampling is where the failures you never see get decided.
- **Production traffic is protected health information.** Nothing verbatim leaves the system into a report, a dashboard or a ticket.
- **The infrastructure was not mine to build.** The lead developer owned MSK provisioning and the pipeline's event emission. I owned the evaluation side, and that boundary was fixed before design started.
- **Evaluation had to be out of band**, and verdicts comparable to the offline framework's: otherwise a change in the production FAIL rate is ambiguous between "quality moved" and "the judge moved".

## Options considered

| Option | Why not |
| --- | --- |
| Judge every event | A monitoring system whose bill grows with traffic gets switched off, and traffic is what you want to grow. |
| Uniform sampling only | The failures that matter are rare by construction. Sampling 5% of a pattern that is 0.1% of traffic gives you nothing to look at for weeks. |
| Alert on aggregate PASS-rate drops | A rare failure class does not move an aggregate. By the time the average moves, the pattern is not rare any more. |
| Write more golden-dataset cases | You cannot write a test case for a phrasing you have not imagined. That is the failure being addressed, not a fix for it. |
| Run the nightly CI runner over exported logs | Batch-shaped, hours behind, no per-event trace. Turns a monitoring problem into a slower reporting problem. |
| Ship the judge without a human annotation loop | A judge nobody ever overrides is either correct or unchecked, and nothing inside the pipeline can tell you which. |

## The decision, and the principle behind it

Stream every conversation event out of the pipeline, sample two ways, run cheap structural checks before expensive judge calls, and route what the judge finds (plus a random slice of what it passes) to people who know medicine better than I do.

The sampling principle: **uniform sampling answers "how are we doing on average", and averages are the wrong instrument for finding rare failures.** So the pipeline samples uniformly for the trend and oversamples anomalies for the tail, as two separate gates rather than one weighted one.

The annotation principle: **an evaluation system that only ever surfaces its own failures is unfalsifiable.** Routing a random sample of passes to humans is what makes the judge checkable.

## Implementation

**Event flow.** The RAG pipeline emits a conversation event per exchange onto an MSK topic, schema-registered through Glue so a producer-side field change fails at publish rather than at parse. An evaluator Lambda consumes via Event Source Mapping in batches, with a dead-letter queue behind it. Configuration (thresholds, judge model version, feature flags) lives in Parameter Store rather than the deployment package, so a sampling threshold changes without a release.

The event schema is what I cared most about at design time, because it decides what is knowable later: retrieval invocation, retrieved context, retrieval confidence, response text, detected and query language, per-stage latency, session identity.

**Two-level sampling.** {% metric "production_sampling" %}.

The uniform gate hashes the session ID rather than the message, which matters more than it sounds. Sampling per message gives disconnected fragments of many conversations; sampling per session gives whole conversations, deterministically. And a conversation is the unit a quality problem lives in. A session sampled once stays sampled, so a multi-turn failure appears as a sequence rather than an unexplained single bad answer.

The anomaly gate is deliberately not a model. It is three structural conditions describing pipeline failure regardless of subject matter: nothing was retrieved, what was retrieved scored badly, or the response was too short to plausibly contain an answer. They need no training data, they do not drift, and they fire on exactly the events a random sample is least likely to catch. Layered on the uniform gate they produced {% metric "anomaly_sampling_yield" %}.

**Cheap checks before expensive ones.** Before any judge call, a trace assertion layer asserts that retrieval was invoked, retrieval scores clear a floor, the response is non-trivially non-empty, and the response language matches the query language. An event failing those is already known to be broken, and spending a judge call to have a model restate that in prose is waste. Everything upstream of the judge exists so it only sees events where its opinion is the missing information.

**Two monitoring layers, deliberately separate.** Prometheus and Grafana watch pipeline health: consumer lag, Lambda errors, DLQ depth. LangSmith carries evaluation quality: traces, verdicts, annotation state. "The evaluator is falling behind" and "the answers are getting worse" have different owners, urgencies and fixes, so they do not share a dashboard.

**The annotation loop.** {% metric "annotation_queue_routing" %}. The FAIL routing is obvious. The random sample of passes is what makes the system honest: it is the only mechanism by which a systematically lenient judge could ever be discovered. Annotators use a fixed schema rather than free text, so disagreements aggregate into something that can change a criterion.

**What the pipeline found.** Within the first two weeks, the anomaly queue's short-response and low-confidence signals clustered on a single query shape: users describing a symptom rather than asking for help. The responses were empathetic and clinically accurate, and none of them said to seek care.

Three things compounded. The retriever was surfacing informational content rather than protocol content for that phrasing. The prompt had no explicit rule requiring a referral instruction on urgent clinical queries. And the golden dataset had no cases phrased as symptom descriptions at all, because every curator (me included) had assumed someone worried about a danger sign would ask for help directly. The fix was all three, validated before shipping: {% metric "danger_sign_fix_time" %}.

The two weeks are not the interesting number. The interesting fact is that four independent layers (golden-dataset regression, the conversational suite, RAGAS Faithfulness scoring and manual spot-checks) had each missed it for the same reason. None were looking at how real people write when they are worried. Four layers that share an assumption are one layer.

## Results

- A clinical-safety failure class found, diagnosed and closed: {% metric "danger_sign_fix_time" %}, with Clinical Safety PASS on the production sample at {% metric "clinical_safety_pass" %} afterwards.
- {% metric "anomaly_sampling_yield" %}.
- The measurement infrastructure made the June 2026 retrieval work legible: {% metric "rag_retrieval_latency" %} on the retrieval step, and {% metric "e2e_latency_2026" %} end to end. See the credit note below.

## What I'd do differently

- **Build the annotation loop with the pipeline, not six months after it.** The judge ran unaudited for two quarters. Nothing bad came of it, which is luck rather than design. An unaudited judge has no error bar, so every number it produced in that window is softer than it looked.
- **Put conversation history in the event schema from the start.** The schema captures single exchanges, so a follow-up question that only makes sense given the previous turn is unjudgeable, and the judge marks some of them down for missing context the user had already supplied.
- **Still open: {% metric "annotation_override_rate" %}.** The judge is too conservative on non-urgent symptom mentions, because the Clinical Safety criterion does not distinguish severity. The fix is a criterion separating urgent from routine, which needs the health content team to define the boundary, and that work is scheduled rather than done. I publish the number because a judge with a known, quantified bias is more useful than one whose bias nobody has measured.
- **Still open: the anomaly thresholds are unvalidated in one direction.** I can see what they catch. I cannot see what passes all three conditions and is still wrong. The honest close is a periodic audit that judges the events the anomaly gate rejected.

## Credit

The pipeline was co-designed with the lead developer. He owned MSK cluster provisioning, the RAG pipeline's event emission and the infrastructure budget. My part was the evaluation side: the schema fields evaluation needed, the sampling design, the evaluator Lambda logic, the trace assertion layer and the LangSmith integration. His review also caught two things in my Lambda that mattered at batch scale: context chunks serialised per record rather than once per batch, and the LangSmith client reinitialised per record.

The RAG retrieval latency improvement was the engineering team's work, not mine. {% metric "reranker_batching_share" %}: collapsing sequential cross-encoder inference calls into one batched pass accounts for the overwhelming majority of it. The June 2026 reranker removal was likewise their decision and implementation. My part was the measurement infrastructure that attributed both. Two changes shipped together in that release, so the end-to-end improvement cannot be attributed to either alone.

## Related links

- [One evaluation framework, three architectures](/work/ai-evaluation-framework/) — the offline layer this complements
- [Rebuilding an LLM judge that was grading its own homework](/work/llm-judge-independence/) — the judge design inside this pipeline
- [Audit your own traffic](/writing/audit-your-own-traffic/) — reading what users actually send
- [Aggregate metrics hide the failure](/writing/aggregate-metrics-hide-the-failure/) — why an average would not have found this
