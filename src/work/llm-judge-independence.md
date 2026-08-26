---
layout: layouts/case-study.njk
title: Rebuilding an LLM judge that was grading its own homework
shortTitle: The judge that graded its own homework
description: How I diagnosed circularity bias in the platform's first LLM-as-a-judge and rebuilt it around an independent model, binary verdicts and calibration.
outcome: Diagnosed why the platform's first LLM judge was grading its own homework, then rebuilt it around an independent model, binary verdicts and a calibration protocol every judge since has used.
number: 1
order: 1
period: Q1 2025 – Q4 2025
roleAtTime: QA Engineer
scope: The platform's first evaluation judge for generated text, and its redesign.
stack: ["Python", "DeepEval", "G-Eval", "Claude API", "Gemini API", "GitHub Actions"]
mine: The judge design, the diagnosis that it was structurally unreliable, the redesign, and the calibration protocol that has gated every judge since.
notMine: The health content team annotated every calibration example and wrote the clinical substance of the criteria; the judgement encoded in them is theirs.
metrics: ["judge_calibration_set", "judge_rewrite_rule", "geval_calibration_set", "judge_agreement_geval"]
tags: ["LLM-as-a-judge", "AI evaluation", "Calibration", "Design failure"]
datePublished: 2026-08-12
dateModified: 2026-08-12
lastReviewed: 2026-08-12
---

## TL;DR

- I built the platform's first LLM-as-a-judge using the same model family that generated the answers it graded. It looked like an evaluation system. It was closer to a mirror.
- The redesign fixed four things at once: an independent judge model, binary PASS/FAIL per dimension instead of an uncalibrated 1–10 score, temperature 0, and calibration against a human-annotated set under one explicit rule: {% metric "judge_rewrite_rule" %}.
- Those four constraints became the starting point for every judge built afterwards: the RAGAS configuration, the DeepEval criteria, and the production monitoring judge.

## The problem

Smart Snippets was the first feature on the platform to produce genuinely generated text rather than a classification. Nothing in the existing suite could say whether a generated answer was any good. So I built a judge: 1–10 on Relevancy, Conciseness and Completeness, using Gemini Flash (the same model doing the generation), gated in CI at 6.0.

Two problems surfaced within weeks, and both were design failures rather than tuning issues.

The scores were uninterpretable. A 6 out of 10 had no calibrated reference. I picked 6.0 because it was the middle, and after several sprints I still could not tell a developer whether 6.4 versus 5.8 was signal or noise. A number nobody can act on is not a measurement.

The second problem was worse. Judging generated text with the same model family that generated it produces systematic circularity bias: the judge shares the generator's language preferences and its failure modes, so it reliably finds the generator's own output reasonable. Obvious degradations still surfaced. The subtle drops (the ones the judge existed to catch) stayed invisible, because the judge would have made the same mistake for the same reason.

It isn't an independent check. It shares the generator's blind spots instead of catching them.

{% architectureNote %}

## Constraints

- **The domain expertise was not mine.** Whether an answer is clinically safe is a question for a clinician. Any design that made me the arbiter of correctness was disqualified.
- **Human review could not scale.** The content team reviewed two or three responses per sprint. Their time was the scarcest input, and the judge existed to spend it better, not to spend more of it.
- **The judge had to run in CI, unattended, on every change.** That rules out anything needing interpretation at the moment of failure.
- **The generator model was not mine to change.** It moved on its own cadence, so the design had to survive a generator swap.

## Options considered

| Option | Why not |
| --- | --- |
| Improve the judge prompt, keep the 1–10 scale | Better instructions produce a better-argued number that still has no principled boundary. |
| Raise the CI threshold above 6.0 | Moves an arbitrary line somewhere else. The threshold was never the defect. |
| Average the score across several runs | Reduces variance around a number that means nothing. Precision without validity. |
| Keep the same-model judge, forbid self-preference in the prompt | Circularity bias is not a stated preference a model can suppress on request. It is the shared prior that makes the two agree. |
| Route every generated response to a clinician | The correct standard, and unaffordable. The calibration set approximates it. |
| Change the judge model, keep the numeric score | Fixes the harder problem, leaves the easier one. Half a redesign is one you do twice. |

## The decision, and the principle behind it

I redesigned the judge around four constraints rather than patching it.

**Judge independence.** The judge moved to Claude, a different family from the Gemini Flash generator. A check that fails in the same direction as the thing it checks is not a check.

**Binary verdicts.** Each dimension became PASS or FAIL against explicit written criteria. A verdict forces the criteria onto paper; a score lets them stay in the judge's head, which is exactly where they cannot be argued with. A binary judge that is wrong can be shown to be wrong on a specific example. A 6.4 cannot.

**A calibration set.** {% metric "judge_calibration_set" %}. An evaluator without a reference is not measuring, it is asserting.

**Temperature 0.** Found during calibration, when the same input produced different verdicts across runs. A non-deterministic test is a coin flip with extra steps.

## Implementation

The core of the redesign is the calibration loop, because that is what makes the criteria falsifiable.

The health content team annotated {% metric "judge_calibration_set" %}: deliberately drawn from the clear ends of the distribution rather than the ambiguous middle. The first calibration pass is not there to resolve hard cases. It is there to confirm the judge and the humans agree about easy ones. If they disagree on an obviously good answer, the criterion is broken, and no amount of hard-case tuning fixes that.

The loop runs the judge over the annotated set, compares verdict by verdict, and applies one rule: {% metric "judge_rewrite_rule" %}. The direction of that rule matters more than the number. Disagreement above the line is treated as evidence that the criterion is underspecified: not that the annotators were careless, and not that the model needs better prompting. Every rewrite is a rewrite of the written criterion, and the criterion is what ships.

That rule earned itself a year later. Adding DeepEval G-Eval in Q4 2025 brought three custom criteria (Clinical Safety, Tone Appropriateness, Completeness) calibrated against {% metric "geval_calibration_set" %}, so the second half measured criteria that had not been tuned against it. Clinical Safety and Completeness cleared the bar. Tone Appropriateness did not.

Reading the per-annotator disagreements showed why. The criterion was one sentence: *uses an appropriate and empathetic tone*. Three annotators (a doctor, a nurse-midwife, and a non-clinical content writer acting as a low-literacy proxy reader) were each scoring a different thing under one label. One scored emotional warmth, one scored language simplicity, one scored whether the answer lectured. They were not disagreeing about the answers. They were answering different questions.

The fix was to split the criterion into the three things it had been collapsing: conversational register for a low-literacy reader, jargon avoidance without a plain-language gloss, and warmth that does not tip into dismissiveness. Same judge, same model, same examples, same temperature. Agreement moved {% metric "judge_agreement_geval" %}.

That generalises. When judge and human disagree, the first hypothesis should be that the criterion is ambiguous, not that the judge is weak. An underspecified criterion produces inter-annotator disagreement too, and measuring only judge-versus-human hides it. Which is why the annotation protocol resolves disagreement explicitly (majority vote on binary items, discussion to consensus on rubric items) rather than averaging it away.

Two mechanics carried into everything built afterwards. **Model-family separation as a standing rule:** three distinct families now sit in the evaluation path (the generator, the RAGAS judge, the G-Eval judge), so a failure mode one judge shares a blind spot with is likely visible to another. **Verdict comparability:** the production monitoring judge and the golden-dataset judge stay pinned to identical model versions, because otherwise a shift in the production FAIL rate is ambiguous between "quality changed" and "the judge changed".

The judge configuration itself is small: a model, a temperature, a criteria file, and a runner that routes each case by its declared domain type. The engineering is not the interesting part. The interesting part is that every choice inside it is written somewhere a clinician can disagree with it.

## Results

- Agreement on Tone Appropriateness moved {% metric "judge_agreement_geval" %} after the criterion was decomposed: the same judge, re-specified.
- The redesigned Smart Snippets judge cleared the calibration rule against {% metric "judge_calibration_set" %} before it gated anything.
- Judge independence, binary verdicts, a calibration set and deterministic temperature became the starting point for the RAGAS configuration, the DeepEval criteria and the production monitoring judge.

I have no measurement of the original judge's error rate, and I will not invent one. The finding was that its scores were uninterpretable by design, not inaccurate by some quantity I could report.

## What I'd do differently

- **Measure inter-annotator agreement before judge-annotator agreement.** The Tone Appropriateness problem was visible in the human annotations a cycle before I read it there, and starting with agreement between people would have saved a round of judge tuning that could not have worked.
- **Never ship a numeric score to CI before writing down what a passing answer looks like.** The 1–10 scale let me defer that question. Binary verdicts forced it, which is the real reason they work. The model change is secondary.
- **Still open: no re-calibration trigger for a forced judge-model upgrade.** Pinning the model and fixing temperature removes run-to-run non-determinism, not drift from a version I do not control being deprecated underneath me. The fix is to gate any judge-model bump on re-running the calibration set. The set exists and the runner exists; the missing piece is the trigger.
- **Still open: the binary migration is half done on the RAG metrics.** Context Precision and Context Recall are still float-scored trend signals, because the June 2026 release changed the retrieval architecture and moved their baseline. Setting thresholds now would repeat the 6.0 mistake with better vocabulary.

## Credit

The calibration sets were annotated by the health content team: a doctor, a nurse-midwife and a content writer. The clinical judgement encoded in the criteria is theirs. My part was the design that turned their judgement into something a CI job could apply, and the protocol that keeps the two in agreement.

## Related links

- [One evaluation framework, three architectures](/work/ai-evaluation-framework/): these four constraints applied at scale
- [Judging live production traffic](/work/production-evaluation-pipeline/): the same judge running on real conversations
- [Your validation script shares the bug](/writing/your-validation-script-shares-the-bug/): the general form of the circularity problem
- [Don't call it RAG](/writing/dont-call-it-rag/): why only one of six programs is evaluated for retrieval quality
