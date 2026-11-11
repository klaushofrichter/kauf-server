# Changelog

Versions are **generated at deploy time**, not carried in the sources: a merge
into `production` is tagged `vYYYY.MM.DD.N`, where `N` counts that day's
releases. Nothing needs bumping and nothing can be forgotten.

Each release's notes are assembled from the commits since the previous one,
preceded by anything curated under Unreleased below. The full history lives on
the [releases page](https://github.com/klaushofrichter/kauf-server/releases);
this file is where notes are written *before* a release, not an archive of them.

<!-- Anything written under Unreleased is prepended to the next release's
     notes. Keep prose out of it unless you mean it to be published. -->
## [Unreleased]

### Accessibility and phones

- The bulb details dialog now fits a phone screen. On a Pixel it was 443 px
  wide in a 412 px screen and lost both edges; the name field also ran under
  the Save name button.
- Pressing Enter on a button in the details dialog (Save name, Set, Turn
  on/off) no longer closes the dialog. A keyboard click counted as a click
  outside it.
- Each bulb's name is now a real button, so the details open from the
  keyboard without the card being a button wrapped around another button
  (which screen readers cannot represent). It looks the same.
- The version number and the "No bulbs discovered yet" text are darker, to
  meet WCAG contrast (they were 2.8:1 and 3.5:1).
- Buttons are at least 24 px tall (WCAG 2.2 target size).
- An unknown address shows a "Page not found" page in a browser. API clients
  still get the JSON 404.
- The title icon is a 192 px, 4 KB picture instead of the 726 px, 76 KB
  original, and has its size set so nothing moves while it loads. The page
  weighs 28 KB instead of 97 KB.
- The page has a meta description.

### Checks

- Every pull request now runs the Docker image in four browsers (desktop
  Chrome, a Pixel, an iPhone, desktop Firefox) with axe-core at WCAG 2.2 AA,
  then Lighthouse on a phone against the signed-in panel (100/100/100/100).
- A new live check runs the read-only part of the suite against production
  after each release and daily.
