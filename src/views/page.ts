export function renderPage(email: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Kauf Bulbs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/png" href="/favicon.png">
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 3rem auto; padding: 0 1rem; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
    a.logout { color: #666; text-decoration: none; font-size: 0.9rem; }
    a.logout:hover { text-decoration: underline; }
    #bulbs { color: #888; font-style: italic; }
  </style>
</head>
<body>
  <header>
    <h1>Kauf Bulbs</h1>
    <div>
      <span>${email}</span> &middot;
      <a class="logout" href="/auth/logout">Sign out</a>
    </div>
  </header>
  <section id="bulbs">No bulbs discovered yet.</section>
</body>
</html>
`;
}
