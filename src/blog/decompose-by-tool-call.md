---
layout: layouts/post.njk
title: Decompose an AI feature by tool call, not by user story
shortTitle: Decompose by tool call
description: An AI feature request arrives with no testable units in it. Trace each tool call to the data it reads, and the sequencing plan and test plan fall out.
date: 2026-05-20
dateModified: 2026-08-12
metrics: [prd_decomposition, qa_dev_estimate_ratio]
tags: [requirements, planning, ai-testing, acceptance-criteria]
technical: true
---

An AI feature request arrives as a paragraph about what the assistant will feel like to use. That paragraph contains no testable units. The units are the tool calls and state transitions underneath it, and they are usually not mentioned anywhere in the document.

## Why user stories decompose badly here

A user story is organised around what a person wants. For a deterministic feature that is fine: the story maps onto a screen, a submit, and a handful of validations, and the mapping is close enough to one-to-one that nothing important hides in the gap.

For an assistant, one sentence of user intent fans out into an intent inference, several tool calls, a data lookup behind each of those calls, a state write, and a rendering decision. The story mentions none of it. Decompose by story and you get tasks named after screens, then discover the fan-out during the sprint, when the discovery is most expensive.

The deeper problem is sequencing. **Dependencies between features in an AI product are usually dependencies between the data their tool calls read.** Those never appear in a section heading, because documents are organised by what the user sees and data is not something the user sees.

## The method

1. **List the tool calls.** Not features. Calls. "Resolve a journey from a plain-language description", "fetch programme defaults", "check keyword uniqueness", "generate the link and the code".
2. **For each call, write down the data it reads and who owns that data.** This is where your schedule risk actually lives.
3. **For each call, write down what happens when that data is missing, ambiguous or stale.** This is where your test cases actually live.
4. **Then group calls into stories.** Last, not first.

Steps two and three take a couple of hours and they are the entire value of the exercise. Step four is bookkeeping.

## What step two found

The feature was an admin console where an operator describes a campaign in plain language and an assistant infers the programme, the journey and sensible defaults, then produces the entry points (keyword, welcome message, deep link, scannable code) that previously took several tools and an engineer's afternoon per campaign.

The decomposition came out at {% metric "prd_decomposition" %}.

The finding that paid for the whole exercise came from step two. The journey-resolution call reads journey metadata: country, domain, language, audience, purpose. The work that populates that metadata sat in a separate theme, scheduled later, several pages away in the requirements document. Nothing in the document's structure connected them, because it was organised by what the operator would see and the metadata is invisible to the operator.

The consequence of getting that order wrong is the interesting part. Without the tagging done first, the resolution call does not error. It returns empty or ambiguous results. **It looks like a bad model.** A team in that position spends a sprint tuning a prompt against missing data, and the tuning appears to help, because anything you change moves an ambiguous result somewhere.

Sequencing the data theme ahead of the two themes that depended on it cost nothing before development started. Discovering it mid-sprint would have cost two themes' worth of rework plus the prompt tuning nobody would have known was pointless.

The general form: **for any AI-assisted feature, trace every tool call back to the data it reads, and sequence the plan around that graph rather than around the document's section order.**

## Acceptance criteria in condition–behaviour form

I write acceptance criteria as "when [trigger], the system [response]" rather than Given/When/Then.

Given/When/Then works well for unit-testable behaviour. On a conversational system the "Given" is the problem: you cannot state a precondition without encoding assumptions about session state, and session state is the thing most likely to change mid-sprint. The precondition then goes stale faster than the behaviour it was written to protect, and stale preconditions are worse than absent ones because people trust them.

Condition–behaviour pairs for the journey-resolution call look like this:

- When the description names no country, the system asks for one before attempting to resolve a journey.
- When two candidate journeys score within the ambiguity margin, the system presents both and does not choose.
- When the resolved journey has no tagged language, the system applies the programme default and marks the field as inferred rather than confirmed.
- When the operator edits the phrase in the output panel, the system regenerates the deep link and the code from the edited value.
- When a keyword is already in use in the same market, the system refuses and offers alternatives.

Each names a trigger you can construct and a response you can assert. Each is one test. None of them require you to describe the state of a conversation.

Notice where those criteria came from: three of the five are direct restatements of step three, "what happens when the data is missing or ambiguous". The test plan is not a separate creative act. It is the second column of the decomposition table.

## Estimation falls out of the same table

Because the QA work was decomposed into tasks against those criteria rather than expressed as a percentage of the development estimate, it could be estimated in the same units at the same time: {% metric "qa_dev_estimate_ratio" %}.

That number then did real work: it set the user-acceptance window directly, in a conversation with the programme owners, before development started. A QA estimate derived as "twenty percent of dev" cannot do that, because it is not attached to anything you can point at when someone asks why.

One structural detail that matters more than it should: the QA work was its own first-class story, not a task hanging under a functional one. Where testing sits in the hierarchy decides whether it can be quietly dropped when the sprint tightens, or whether dropping it requires a conversation. It is the same work either way. Only the visibility differs.

## The rule

Decompose an AI feature by its tool calls and state transitions. For each call, name the data it reads and what it does when that data is absent. The first list is your sequencing plan. The second is your test plan. The user stories can be assembled afterwards, from the parts, once you know what the parts are.

---

Related: [the evaluation framework these features get tested against](/work/ai-evaluation-framework/), [why naming the architecture comes before choosing a metric](/writing/dont-call-it-rag/), and [reading traffic before deciding what to test](/writing/audit-your-own-traffic/).
