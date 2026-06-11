# Contributing

Thank you for considering a contribution to HEYNA REPORT.

## How to Contribute

1. Fork the repository.
2. Create a feature branch.
3. Commit your changes.
4. Push your branch.
5. Create a pull request.

## Branch Naming

Use clear branch names:

```text
feature/pdf-chart-summary
fix/failed-test-analysis
docs/quick-start-update
refactor/reporter-core
```

## Commit Message Style

Use concise commit messages:

```text
feat: add pie chart summary
fix: preserve failed tests in execution json
docs: update installation guide
refactor: simplify pdf table renderer
```

## Coding Standard

- Use JavaScript CommonJS.
- Do not use TypeScript.
- Keep reporting utilities reusable.
- Prefer clear function names over clever abstractions.
- Keep PDF rendering logic inside `HeynaPdfGenerator.js`.
- Keep runtime tracking logic inside `HeynaReporter.js`.
- Avoid adding unnecessary dependencies.
- Keep generated artifacts out of commits unless they are intentionally used as examples.

## Local Validation

Before opening a pull request, run:

```bash
npm install
npx playwright install chromium
npm test
node regenerate-report.js
```

Check generated files:

```text
reports/HeynaReport.pdf
test-results/execution.json
evidence/
```

## Pull Request Checklist

- [ ] Tests run locally
- [ ] PDF report generates successfully
- [ ] No unrelated files changed
- [ ] Documentation updated if behavior changed
- [ ] No secrets or credentials committed
