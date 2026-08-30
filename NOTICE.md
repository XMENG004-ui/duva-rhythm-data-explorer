# Data notice

`public/data/pmdata.json` and the related validation outputs are derived from PMData, a public lifelogging and sports-activity dataset collected by Simula and its research collaborators.

Source:

- https://datasets.simula.no/pmdata/
- https://doi.org/10.1145/3339825.3394926

Changes made in this repository:

- Selected complete staged primary-sleep records
- Converted sleep time to a continuous evening-to-next-day axis
- Sampled sleep-stage profiles
- Derived nightly heart-rate and first-90-minute sleep-structure metrics
- Matched available exercise, food and wellness context
- Removed the original raw file structure from the distributed application bundle

The current PMData website states CC BY 4.0 terms. The original 2020 publication describes CC BY-NC 4.0 terms. This repository applies the more restrictive CC BY-NC 4.0 treatment to the derived data until the applicable terms are confirmed for the intended use. Preserve this notice, credit the original authors and source, link the applicable Creative Commons license and identify changes when redistributing derived data.

The application source code has no public open-source license in this repository. Access to a private repository does not grant permission for public redistribution of the DUVA source code.

