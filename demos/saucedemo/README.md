# SauceDemo

[`model.json`](model.json) is a discovery-generated draft of the live
[SauceDemo](https://www.saucedemo.com/) application, regenerated on 12 October 2026, with 63 observed states and
135 journeys, including 12 fixed-input form journeys. It needs review and
independent business rules before property testing. The fresh model includes
literal login and checkout examples; no Hegel campaigns are inferred.

Testwalker was run against this model at confidence 0.80. Native select
observation and intent-driven selection now work: the blocked replay passes,
and a focused run covering all four sorting choices passes all 13 planned cases.
That focused run remains **INCONCLUSIVE** overall because it verifies 5 of the
model's 135 journeys, below the unchanged full-coverage goal. Details, earlier
results and report links are in the run summary.

[Discovery commands, results and gaps](discovery/README.md) ·
[Run summary](discovery/summary.json) · [Synthetic values](discovery/values.json)

[View the latest discovery results](../artifacts/discovery-saucedemo/fresh-2026-10-12-01-overview/index.html)
(local generated artifact). Rebuild it with the `report` command in the
[standalone discovery package](../../testwalker-discover/README.md).
