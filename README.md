# DUVA Rhythm Data Explorer

DUVA Rhythm Data Explorer is a PC-first research prototype for reviewing personal sleep Rhythm, Pattern Emergence, nightly Resonance, Context associations and date-relative History.

The repository contains the current PMData-backed prototype, deterministic algorithm tests and the product/algorithm specification used to explain the calculations.

## Run locally

Requirements:

- Node.js 18 or newer
- npm 9 or newer

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. A useful validation state is:

```text
/?participant=p07&end=2020-03-31
```

The processed PMData JSON is included, so the prototype works without downloading the 1.4 GB raw archive.

## Test and build

```bash
npm run test:algorithm
npm run build
npm run test:sites
```

`test:algorithm` covers Pattern states, Core/Boundary/Unassigned membership, additional sleep, physiology features, Context wording, History updates and Resonance edge cases.

## What the prototype demonstrates

- A rolling evidence window of up to 42 calendar days
- Automatic selection of 1–4 Candidate shapes
- Core, Boundary and Unassigned variation
- Six-dimensional Emergence and independent Confidence
- Pattern publication as Taking shape or Clearly emerged
- Nightly Resonance calculated against earlier nights only
- Exercise, food, inferred work/rest timing and cross-signal Context evidence
- History recalculated from non-overlapping windows relative to the selected date
- Sleep-depth probability bands and the Resonance reflection landscape

## Repository structure

```text
src/                         React UI and current algorithms
  mockData.js                Pattern, Emergence, Confidence, Context and History
  resonance.js               Night-to-Pattern Resonance
scripts/                     PMData preparation and validation scripts
public/data/                 Processed PMData used by the prototype
tests/                       Algorithm and Sites worker regression tests
worker/ and .openai/         Sites-compatible deployment entrypoints
docs/RHYTHM_PATTERN_SPEC.md  Unified product and calculation specification
```

## Rebuild the processed PMData

Download and extract PMData, then run:

```bash
python scripts/build_pmdata.py --raw "PATH/TO/PMData/raw"
```

The script writes browser-ready files to `public/data/`. Raw PMData is intentionally excluded from Git.

## Data attribution

The prototype uses the public [PMData dataset](https://datasets.simula.no/pmdata/) and a derived browser-ready representation. Cite:

> Thambawita, V. et al. (2020). PMData: A Sports Logging Dataset. Proceedings of the 11th ACM Multimedia Systems Conference, 231–236. https://doi.org/10.1145/3339825.3394926

See [NOTICE.md](NOTICE.md) before redistributing the processed data.

## Scope

This is a research and product-validation prototype. It does not provide medical advice, diagnose sleep conditions or establish causal effects from Context associations.

