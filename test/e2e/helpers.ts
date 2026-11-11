import { Page, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

// Shared by the e2e specs. Adapted from klaushofrichter/www-klaushofrichter
// and christina.art, the references for kube-setup's "public web pages"
// baseline (docs/cluster-deployment-requirements.md, §4).

/** Console errors, uncaught exceptions, CSP violations and failed same-site
 *  requests seen while a test runs. Walkthroughs end by asserting it is
 *  empty: a page that "works" while the console fills with errors is not
 *  working. The 404 page's own status is expected and not a problem. */
export function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 404/.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`exception: ${e.message}`));
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.origin === new URL(page.url() || r.url()).origin && r.status() >= 400 && !u.pathname.startsWith('/does-not-exist')) {
      problems.push(`HTTP ${r.status()}: ${u.pathname}`);
    }
  });
  page.on('requestfailed', (r) => {
    const failure = r.failure()?.errorText ?? '';
    // A navigation away aborts whatever was still in flight; not a fault.
    if (!/ABORTED|cancelled|NS_BINDING_ABORTED/i.test(failure)) problems.push(`failed: ${r.url()} ${failure}`);
  });
  return problems;
}

/** Report CSP violations as console errors, so watchProblems sees them. The
 *  service sends no Content-Security-Policy today, so this passes trivially;
 *  it is here so that adding one cannot break the page unnoticed. */
export async function reportCspViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`));
  });
}

/** Every <img> on the page has arrived and decoded. */
export async function expectAllPicturesLoaded(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Array.from(document.images)
            .filter((img) => !img.complete || img.naturalWidth === 0)
            .map((img) => img.currentSrc || img.src),
        ),
      { timeout: 15_000, message: 'pictures that did not load' },
    )
    .toEqual([]);
}

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

type AxeNode = { target: unknown[]; failureSummary?: string; any?: { message: string }[] };
function describe(results: { impact?: string | null; id: string; help: string; nodes: AxeNode[] }[]) {
  return results.map(
    (v) =>
      `${v.impact} ${v.id}: ${v.help}\n    ${v.nodes
        .slice(0, 4)
        .map((n) => `${n.target.join(' ')}  ${n.failureSummary?.split('\n')[1] ?? n.any?.[0]?.message ?? ''}`)
        .join('\n    ')}`,
  );
}

/** axe-core, WCAG 2.2 A and AA, zero violations.
 *
 *  And zero "incomplete" contrast results. axe files text it cannot judge
 *  (over a gradient, a picture, a translucent layer) as incomplete rather than
 *  failing it, and Lighthouse then scores 100: on www-klaushofrichter that hid
 *  three real failures. This page has no gradients or pictures behind text, so
 *  rather than measuring pixels it requires that axe could judge every piece
 *  of text; if a design ever puts text over something it cannot, this fails
 *  and the measurement has to be added (art and instagetter measure real
 *  screen pixels for that). */
export async function audit(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(describe(result.violations), 'WCAG 2.2 AA violations').toEqual([]);
  const unjudged = result.incomplete.filter((r) => r.id === 'color-contrast');
  expect(describe(unjudged), 'text whose contrast axe could not judge').toEqual([]);
}
