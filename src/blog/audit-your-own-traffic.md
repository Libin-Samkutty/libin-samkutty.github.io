---
layout: layouts/post.njk
title: Read what users actually send before you decide what to test
shortTitle: Audit your own traffic
description: "Two production traffic audits that rewrote a test plan: model calls that never needed a model, and voice input carrying more clinical signal than typed input."
date: 2026-07-08
dateModified: 2026-08-12
metrics: [unnecessary_llm_invocations, voice_vs_text_length, voice_vs_text_noise, voice_vs_text_medical_match, voice_session_engagement]
tags: [production-data, traffic-analysis, testing-strategy, evaluation]
technical: true
---

Every test set is a theory about what users send. Most test sets are written before anyone has checked. A day spent reading production traffic is the cheapest quality work available to most teams, and almost nobody does it.

Two audits, both of which changed what I tested rather than merely confirming it.

## Audit one: the model calls that never needed a model

A router sat in front of the model and decided whether an input needed generation or could be handled by a rule. It had been in place for a long time. Nobody had asked what the traffic going through it actually looked like.

I pulled a window of routing decisions and categorised the inputs by hand. {% metric "unnecessary_llm_invocations" %} turned out to be inputs that never needed one.

The largest slice by a distance was acknowledgements the rule layer did not recognise, because its vocabulary was incomplete and it required exact matches: short affirmatives in Hindi and Assamese, transliterated forms, the local equivalents of "ok" and "thanks". The remainder was menu digits, emoji, and gibberish.

The cost and latency implications are the obvious reading and the less interesting one. The finding that mattered to me as a tester was about the shape of the suite. My test set was full of well-formed medical questions. A large share of real traffic was not a question at all, and there was not a single test case for it. That category turned out to be one of the biggest in production. The suite was not weak on that behaviour. It was silent about it.

The deliverable was a prioritised list of missing vocabulary and specific routing changes, handed to engineering as a story. That is the right shape for the output of an audit: not a report, a diff.

## Audit two: the assumption about voice input

The assumption most teams start with, and the one I started with, is that voice transcription is lossy, so voice queries will be messier, shorter, harder to handle and mostly an accessibility feature you accept a quality cost for.

Comparing transcribed voice queries against typed ones on the same platform over the same period, the opposite held on every dimension I measured.

- Query length: {% metric "voice_vs_text_length" %}
- Filler with no clinical substance: {% metric "voice_vs_text_noise" %}
- Queries matching a medical category at all: {% metric "voice_vs_text_medical_match" %}
- Session engagement: {% metric "voice_session_engagement" %}

It makes sense in hindsight, which is the usual property of things nobody checked. Typing on a phone keyboard in a second script is expensive, so people type the shortest string that might work. Speaking is cheap, so people describe their situation. The transcript that arrives is longer and more specific than anything the same person would have typed.

The consequence for testing is direct: voice-derived queries needed their own evaluation cases: longer, more clinically substantive, structured as descriptions rather than questions, not a degraded copy of the typed cases the golden dataset was built from. Had I taken the standard assumption on trust, I would have written short, noisy voice test cases and then evaluated the pipeline against a distribution that does not exist.

It also reframed the feature. Voice input had been budgeted as an accessibility cost. The data says it is the channel carrying the clinical signal, which is a different investment case entirely and one I could only make because the numbers existed.

One limitation, still open. Transcription strips paralinguistic signal: tone, urgency, distress. A transcript of a frightened person and a calm person reads identically, and every downstream classifier sees only the transcript. For crisis detection that matters. It is not a provider problem and no provider choice fixes it; it is a property of converting speech to text before classification. The fix I would want is an audio-derived urgency signal carried alongside the transcript, which needs a model the pipeline does not currently have.

## How to run one

1. **Pull a window, not a convenient sample.** Two weeks, everything, one program. Convenience samples inherit whatever bias produced the convenience.
2. **Categorise by hand first.** Automated clustering finds the categories you already have names for. Reading two hundred rows yourself is how you find the ones you do not.
3. **Count the categories with no test case.** That count is your backlog, and it is also the honest measure of how much your suite is assuming.
4. **Band it before you trust any rate you compute.** [The aggregate will hide the category that matters.](/writing/aggregate-metrics-hide-the-failure/)
5. **Repeat whenever an input channel changes.** Every new channel is a new distribution. Voice was not typed traffic with noise on it; it was a different population.

## The counter-argument, which is real

Production traffic is a lagging indicator. It cannot tell you about users you do not yet have, it will happily confirm that a feature nobody found is unused, and optimising only for what you already see is a way of never changing what you see.

So an audit does not replace a curated golden dataset. A curated set is the only instrument for testing what *should* happen, including cases too rare or too dangerous to wait for. You do not get to sit and hope a maternal emergency shows up in a two-week window so you can check the system handles it.

The two answer different questions. The curated set answers "does this pass the cases we designed for". The audit answers "what are real people sending that we never designed for". Building only the first gives a false sense of completeness, and I have the scar to prove it: a class of danger-sign phrasing once survived four independent layers of testing (golden-dataset regression, conversational flow tests, a grounding metric, and manual spot checks) because every one of those layers had been built by people who assumed users ask for help directly, rather than describing a symptom and hoping the system understands the urgency. Four layers, one shared assumption, and only production traffic could see it. That gap is fixed and closed, and the general lesson is not.

## The rule

Read a window of real traffic before you decide what to test. Count the input categories with no test case; that count is the honest measure of how much your suite assumes. Then band it, because the aggregate will hide the category that matters.

---

Related: [monitoring production rather than trusting offline results](/work/production-evaluation-pipeline/), [why an aggregate can be true and useless at once](/writing/aggregate-metrics-hide-the-failure/), and [the curated datasets an audit complements](/work/ai-evaluation-framework/).
