---
layout: layouts/post.njk
title: An aggregate can be true and useless at the same time
shortTitle: True and useless at the same time
description: A speech-to-text provider looked fine averaged over a benchmark and collapsed on the clip lengths real users send. How to choose the dimension to band by.
date: 2026-06-24
dateModified: 2026-08-12
metrics: [stt_latency, stt_duration_banded_collapse]
tags: [benchmarking, metrics, evaluation, speech]
technical: true
---

Every aggregate is a claim that the thing you averaged over does not matter. Almost nobody checks that claim. It is usually the most load-bearing assumption in the whole measurement.

## The shape of the problem

A single number over a population hides any structure inside that population, and the hiding is not detectable from the number. You cannot look at a mean and tell whether it came from a uniform population or from two populations behaving in opposite directions. The distributions that produce a given average are unbounded.

Which means disaggregation is not something you do when a result looks suspicious. You have to do it up front, and you have to guess the right dimension before you have any evidence about which dimension matters. That guess is the actual skill.

## Worked example: choosing a speech-to-text provider

Users on the maternal health program send voice notes rather than typing, particularly where typing means a second script on a phone keyboard. Nothing in the platform could process audio, so I ran a benchmark across two providers on the same set of Assamese and English recordings.

The aggregates came out close enough to argue about. Latency favoured one: {% metric "stt_latency" %}. Real, measurable, and not decisive on its own. Half a second on a pipeline with several seconds of downstream work is a preference, not a verdict.

The decisive number did not exist until the analysis was banded by audio duration: {% metric "stt_duration_banded_collapse" %}.

That is not an aggregate being wrong. Every aggregate over that test set was an honest average of a population containing both behaviours. It simply described nobody. Perfect on the short clips a benchmark set is naturally full of, broken on the lengths people actually record. The average sat somewhere in between, describing a clip length that did not exist.

Manual review found the failure that ended the discussion. I listened to source audio against transcripts rather than trusting the automated rate, and found a word meaning "pharmacy" transcribed as a word meaning "toilet". On a system whose job includes telling someone where to seek care, that is a disqualifying class of error, not a tunable edge case. Aggregate accuracy cannot express the difference between a wrong word and a dangerous one, which is a second reason not to let it decide alone.

One limitation worth stating plainly: no ground-truth transcript corpus existed, so there was no way to compute a formal word error rate at scale. Clean-output rate banded by duration was a proxy. It was good enough to make a provider decision defensible, and I would still build the corpus before making a second one.

## Choosing the dimension to band by

Here is the rule the exercise produced: **band by how your users vary, not by how your data is convenient to group.**

The convenient dimensions in that benchmark were provider, language and file format. All three were sitting in the filename. Duration had to be computed from each file: precisely why it was the dimension nobody had banded by before, and precisely why it was the one hiding the failure.

Two questions surface the right dimension before you have results:

1. **Write down the two or three ways a real input varies most.** Then check each one appears as a column in your analysis. A dimension that is not a column is a dimension your analysis cannot see, no matter how carefully you read the output.
2. **Ask which axis would embarrass you most if the system behaved differently along it.** That is usually the axis where the difference is real and where nobody has looked.

Banding is cheap to implement and the implementation carries one important detail:

```python
BANDS = [(0, 5), (5, 15), (15, 25), (25, 30)]  # seconds

def clean_rate_by_duration(results):
    for low, high in BANDS:
        band = [r for r in results if low <= r.duration_s < high]
        if len(band) < MIN_BAND_SIZE:
            yield (low, high), UNKNOWN, len(band)   # report thinness
            continue
        yield (low, high), mean(r.is_clean for r in band), len(band)
```

The `UNKNOWN` branch is the part that matters. A band too thin to trust must report as unknown rather than being folded back into the aggregate, because folding it back is how the original problem got created. Always carry the count next to the rate. A rate without its denominator is a number that cannot be argued with, which is not the same as a number that is right.

## The same failure, everywhere else

Once you have the shape, you see it constantly:

- **p95 latency across all endpoints.** Healthy overall, with one endpoint that everybody's slowest workflow depends on.
- **Golden-dataset pass rate averaged across languages.** Thai has no word boundaries, which quietly breaks tokenisation assumptions that hold in every other language on the platform. Averaged in, that shows up as a rounding error.
- **Model accuracy over a test set whose input-length distribution does not match production.** Exactly the failure above, in a different medium.
- **Error rate per user, where a small fraction of users generate most of the sessions.** The average user is not the average session and never was.
- **Test-suite pass rate across shards.** One shard failing intermittently and being retried is invisible in a suite-level number.

The common structure: a population with an internal split, and a reporting layer that was built before anyone knew where the split was.

## The rule

Choose the banding dimension from how your users vary, not from what is convenient to group by. Check that every band has enough rows to mean anything, and report the ones that do not as unknown rather than averaging them into the ones that do. An aggregate you have not disaggregated at least once is a hypothesis, not a measurement.

---

Related: [reading production traffic to learn how users actually vary](/writing/audit-your-own-traffic/), [why a threshold and a trend answer different questions](/writing/threshold-gates-vs-trend-views/), and [evaluating what runs in production rather than what passes offline](/work/production-evaluation-pipeline/).
