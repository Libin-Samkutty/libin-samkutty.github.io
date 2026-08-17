---
layout: layouts/post.njk
title: Don't call it RAG until you know what it retrieves
shortTitle: Don't call it RAG
description: An AI chatbot names an interface, not an architecture, and the evaluation a system owes you is decided entirely by which architecture is underneath it.
date: 2026-08-01
dateModified: 2026-08-12
metrics: [platform_scale, golden_dataset_india_mh, golden_dataset_hpv, ragas_embedding_swap_catch]
tags: [rag, architecture, evaluation, ai-testing]
technical: true
---

"So you test a RAG chatbot." It is the sentence I hear most often about my work, and it is wrong about most of the systems I test. The mistake is not pedantry. The evaluation you owe a system is decided by its architecture, and "chatbot" does not name one.

{% architectureNote "long" %}

## Three architectures behind one interface

Every one of these programs presents identically. A person sends a message on WhatsApp and gets an answer back. Underneath, they are three different machines.

**Retrieval-augmented generation.** Dense and sparse retrieval run over a corpus, their results are fused, and generation is grounded in the passages that came back. The answer's content originates in a document.

**Intent classification with curated snippets.** A classifier routes the utterance to an intent label, generation draws on curated content written for that intent, and a vector semantic cache serves repeat questions without invoking a model at all. The answer's content originates in something a human wrote.

**A dispatcher over a journey graph.** A defined graph decides what stage the conversation is in, and generation fills in a response inside that stage. The answer's content originates in the model, constrained by position.

Same interface. Three unrelated sets of things that can go wrong.

## What each architecture owes you

| Architecture | The failure the others can't have | What has to be measured |
| --- | --- | --- |
| Retrieval-augmented | The right passage is never retrieved, and the answer is fluent, confident and unsupported | Context precision, faithfulness, retrieval recall (on top of generation quality) |
| Snippets, classification, cache | The utterance is routed to the wrong intent; the cache serves a stored answer for a query it does not answer | Per-label classification correctness, generation against the snippet, cache precision and recall |
| Dispatcher over a graph | The graph routes to the wrong node, or a config change makes a node unreachable | Routing integrity, structural validation of the config itself, response quality per node |

Two of those three rows contain no retrieval step whatsoever.

This is where the word does real damage. You cannot measure context precision on a system that never retrieves anything. Point a retrieval-evaluation library at one and it will not error. It will produce numbers, computed over a `contexts` field that is empty, or synthesised to keep the library happy. The numbers look like the numbers everyone else reports. They mean nothing. A team can run that suite nightly for a year and believe it has retrieval quality under control on a system with no retriever in it.

## Three ways this costs you

**You measure the wrong property and it passes.** The worst outcome, because you now hold a green dashboard for something the system does not do. Nobody re-examines a passing check.

**You measure the right property on the wrong system and read the result as a regression.** Cheaper: you lose a few days chasing a metric that was never defined for that architecture.

**You build one evaluation framework assuming one architecture, then bolt the others on.** This is the expensive one. Each new program makes the framework worse rather than better, because every architecture-specific concept has to be special-cased inside a structure that assumed it away.

The third is the one I had to design around. The scope is {% metric "platform_scale" %}: the constraint, not the boast. A single engineer cannot maintain three evaluation frameworks, and cannot afford one framework that gets worse with each program added.

What made it survivable was drawing the line in the right place: share the machinery, never share the definition of correct. One runner, one judge design, one calibration process, one nightly job, one results table: a different metric set per architecture, selected by the program's own configuration. The golden datasets follow the same split. {% metric "golden_dataset_india_mh" %} gate the retrieval program; {% metric "golden_dataset_hpv" %} cover the three snippet programs. They are curated separately because they test different failures, not because nobody got round to merging them.

The same discipline applies one level down. Two of the programs run in the same country, in overlapping languages, on different architectures. They are two programs. Collapsing them into "the India chatbot" is the most common error made about this platform, and it appears in my own earlier writing about it.

## Where retrieval metrics earn their place

None of this means RAG evaluation is theatre. On the one program that retrieves, it earns its place directly.

An embedding-model swap reached staging having been tested for latency and memory, which is how a dependency change gets tested when nobody has framed it as a behaviour change. The nightly job caught it: {% metric "ragas_embedding_swap_catch" %}. No prompt changed. No generation code changed. The retrieval underneath the generation changed, and the only instrument that could see it was a retrieval metric.

That catch is the argument for architecture-specific evaluation. The metric that saved that release is undefined on five of the six programs. Running it everywhere would not have made anything safer; it would have produced five more numbers nobody could interpret and one that mattered.

## Better questions than "is it RAG?"

When someone tells me they have an AI chatbot, these four questions get to the architecture faster than any amount of documentation:

1. Where does the text in the answer come from: a retrieved document, a human-written snippet, the model's weights, or a template?
2. Is there a step that selects among candidates? Is that step ranked, cached, or both?
3. What decides what happens next in the conversation: the model, or a graph?
4. When an answer is wrong, which component do you look at first?

The fourth is the diagnostic one. If nobody on the team can answer it, no evaluation has been designed yet, regardless of what tooling is installed. The list of components you would check is the list of things your evaluation has to be able to see.

## The rule

"AI chatbot" names an interface. Before choosing a metric, name the architecture: what generates the text, what selects it, and what decides what happens next. If your evaluation would happily produce a number for a system that has no retrieval step, it is measuring your library, not your system.

---

Related: [the evaluation framework that had to span all three architectures](/work/ai-evaluation-framework/), [why the judge has to be independent of the generator](/work/llm-judge-independence/), [what offline evaluation still misses](/work/production-evaluation-pipeline/), and [why the cache is gated at two different thresholds](/writing/asymmetric-thresholds/).
