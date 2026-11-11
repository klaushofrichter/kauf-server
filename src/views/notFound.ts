// The page a browser gets for an unknown address.
//
// The only HTML this service shows to someone who is not signed in: `/`
// hands straight over to Google, and everything else is the JSON API. So it
// is held to kube-setup's "public web pages" baseline (four browsers, axe,
// e2e/a11y) like a public site's pages are. API callers keep the JSON 404;
// app.ts decides by the Accept header.
//
// Self-contained on purpose: no script, no external file, the styles inline,
// so it renders the same whatever else is broken.
export function renderNotFoundPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Page not found - Kauf Bulbs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="This address does not exist on Kauf Bulbs.">
  <link rel="icon" type="image/png" href="/favicon.png">
  <style>
    body { font-family: system-ui, sans-serif; max-width: 960px; margin: 3rem auto; padding: 0 1rem; color: #222; background: #fff; }
    h1 { margin: 0 0 1rem; }
    a { color: #1a4f9c; }
  </style>
</head>
<body>
  <main>
    <h1>Page not found</h1>
    <p>There is nothing at this address.</p>
    <p><a href="/">Go to Kauf Bulbs</a> (you will be asked to sign in).</p>
  </main>
</body>
</html>
`;
}
