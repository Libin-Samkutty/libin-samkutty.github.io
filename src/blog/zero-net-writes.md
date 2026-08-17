---
layout: layouts/post.njk
title: Design the suite for zero net writes
shortTitle: Zero net writes
description: Test suites that write to shared state are a scaling problem disguised as flakiness. Timestamp scoping, write blocking, injected clocks and contract mocks.
date: 2026-04-22
dateModified: 2026-08-12
metrics: [bsp_mock_flakiness, bsp_error_paths, scheduler_clock_collapse, scheduler_dedup_catch]
tags: [test-infrastructure, mocking, flakiness, ci]
technical: true
---

A suite that writes to shared state works until two things run at once. Then it looks flaky, and it gets debugged as flakiness: reruns, sleeps, retry decorators, a quarantine tag. The actual problem is that the suite has side effects, and side effects do not parallelise.

## The tell

These symptoms look like timing flake and are not:

- Passes alone, fails in CI.
- Passes on the first run of the day, fails on the second.
- Fails only when a colleague happens to be testing.
- Fails, then passes after someone manually "cleans things up".
- Two tests that each pass in isolation and never pass in the same run.

The instinctive fix is isolation by environment: a fresh database per run, a container per worker. When you can have that, take it. Sometimes you cannot. On the platform I look after, staging and production route through different function aliases over the same underlying database and cache rather than running as separate instances. There is no clean schema to hand out per run and no realistic path to creating one. Isolation had to be designed inside shared, live infrastructure.

The target that fell out of that constraint turned out to be a better target generally: **after a test run, shared state is exactly what it was before.** Zero net writes.

## Four mechanisms

### Scope every assertion instead of cleaning up after it

Rather than creating data and deleting it afterwards, record a `testStartedAt` timestamp at the top of the run and scope every database assertion to records created after it, for a dedicated test identity. Production rows in the same table become invisible to the run without anything touching them.

Cleanup is the wrong shape anyway. It runs at the end, which is precisely when a crashed run does not reach it. The cases that leave the most mess are the cases where cleanup never executes.

This closed a real contamination path. Manual staging runs had been creating rows in a shared conversation transition-log table that carried no environment flag, and those rows occasionally surfaced in production analytics counts. Nobody had done anything wrong; the table simply had no way to tell the two apart. Timestamp scoping made the test rows invisible to assertions, and the next mechanism removed them entirely.

### Block writes at the connection, not by convention

Run the suite through a read-only proxy on both staging and production.

Test discipline is a rule. A write-blocking connection is a property. The difference shows up the first time somebody adds a test in a hurry at the end of a sprint. It shows up in their own diff, at the moment they run it, rather than three weeks later in an analytics figure nobody can explain.

Zero net writes stops being an aspiration that decays and becomes something the architecture guarantees. That is worth the small amount of setup: guarantees survive staff changes and aspirations do not.

### Make the clock an input

Time-dependent logic is the other large source of shared-state coupling, and the usual workaround is worse than the problem. Shortening timer intervals in configuration for test environments means you are testing a different program from the one you ship, and the difference lives in exactly the code you were trying to verify.

Inject the offset as a test header instead, so the application code is byte-identical between the real scheduler and the virtual one. A two-nudge re-engagement sequence (a first message some hours after a user drops out, a second later still, with de-duplication that suppresses the second if the user comes back in between) becomes something CI can run: {% metric "scheduler_clock_collapse" %}.

That harness immediately earned itself: {% metric "scheduler_dedup_catch" %}. One dispatched a duplicate message when a user re-engaged between the two sends; one read the opt-out signal from a wrongly named configuration field. In health messaging, a duplicate message to somebody who opted out is a consent problem before it is a quality problem, and neither defect was reachable at all without a controllable clock.

### Build mocks against the contract, including its failures

The most common mock is a recording of a happy-path response. It removes the external dependency, which is the stated goal, and quietly teaches the suite that the dependency never fails.

Put sharply: **a mock that cannot fail the way the real service fails teaches the suite that a class of error does not exist.** Every error path you cannot trigger becomes a path nobody has ever executed, and the first execution happens in production.

Building the messaging provider's mock from recorded live traffic (including the undocumented envelope fields that were breaking deserialisation in ways indistinguishable from logic bugs) produced a surface that could be made to fail on demand: {% metric "bsp_error_paths" %}. Before it, those paths were not merely untested. They were untestable, because you cannot ask a real sandbox to reject a template or time out on request.

Stateful contracts need the same treatment. A delivered event must follow a sent event for the same message identifier. A mock that will emit them in any order is reproducing a response, and a bug in your ordering logic will pass against it.

The flakiness went with all of this: {% metric "bsp_mock_flakiness" %}. The suite also stopped consuming live sandbox quota entirely, which had been a standing monthly cost for messages nobody read.

## The obvious objection

Now you own a mock that can drift from the real service. That is a genuine cost, not a rhetorical one, and two habits keep it honest.

Re-record real traffic periodically and diff the payload shapes against your fixtures. Undocumented envelope fields are what actually break deserialisation, and a hand-written fixture is exactly the artefact that omits them.

Keep a small number of tests running against the real service on a schedule rather than per-commit, whose only job is to fail when the contract has moved. They will be slow and occasionally flaky. That is acceptable for a handful of tests whose failure means "go look", and unacceptable for a suite that gates every merge. That is the whole reason the mock exists.

Neither habit is free. Both are cheaper than a fast green suite testing a fiction.

## The rule

Aim for zero net writes: after a run, shared state is what it was before. Get there by scoping assertions to the run rather than cleaning up after it, blocking writes at the connection rather than by convention, making the clock an input rather than an environment, and mocking the contract (failures included) rather than a recorded response.

---

Related: [contract testing that caught what a schema check could not](/work/contract-testing-pact/), [why a checker sharing a dependency cannot see past it](/writing/your-validation-script-shares-the-bug/), and [the CI suite this runs inside](/work/from-robot-to-playwright/).
