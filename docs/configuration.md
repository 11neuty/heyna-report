# Configuration

HEYNA REPORT reads CommonJS configuration from `heyna.config.js` in the project root. This file is independent of `playwright.config.js`.

## Configuration file

The checked-in configuration demonstrates the supported auto-capture fields:

```js
module.exports = {
  autoCapture: true,
  screenshotMode: 'failure-only',
  autoActions: [
    'fill',
    'click',
    'check',
    'uncheck',
    'selectOption',
    'press',
    'dragAndDrop',
    'setInputFiles',
    'hover',
    'dblclick',
    'tap',
    'focus',
    'blur'
  ],
  locatorFactories: [
    'locator',
    'getByRole',
    'getByText',
    'getByLabel',
    'getByPlaceholder',
    'getByTestId',
    'getByAltText',
    'getByTitle'
  ],
  chainMethods: ['first', 'last', 'nth', 'filter'],
  importantActions: ['click', 'dblclick', 'tap', 'setInputFiles', 'dragAndDrop'],
  apiLogging: {
    include: ['/api/', 'saucedemo.com']
  }
};
```

Configuration may also be overridden programmatically with `Heyna.configure({...})`. Nested `apiLogging` and `history` settings are merged with defaults; action and locator arrays replace their defaults when provided.

## Project and artifact roots

The project root locates:

- `heyna.config.js`
- `package.json`
- project assets and version metadata

The artifact root locates current output and execution history. Keeping these roots separate allows tests or embedded consumers to place runtime artifacts outside the source tree.

Environment overrides are:

- `HEYNA_PROJECT_ROOT` — selects the project and configuration root
- `HEYNA_ARTIFACT_ROOT` — selects the runtime artifact root

`Heyna.configure({ projectRoot, artifactRoot })` provides the equivalent programmatic override. A configured `artifactRoot` takes precedence over `HEYNA_ARTIFACT_ROOT`.

## Output paths

Relative output paths resolve beneath the artifact root. Absolute output paths are also accepted for current-run output.

| Setting | Default | Result |
|---|---|---|
| `resultDir` | `test-results` | `execution.json`, `metadata.json`, and run locks |
| `reportDir` | `reports` | `HeynaReport.pdf` and `TestExecutionReport.pdf` |
| `dashboardDir` | `dashboard` | `index.html` |
| `evidenceDir` | `evidence` | Screenshots and API logs |

Example:

```js
module.exports = {
  resultDir: 'runtime/test-results',
  reportDir: 'runtime/reports',
  dashboardDir: 'runtime/dashboard',
  evidenceDir: 'runtime/evidence'
};
```

## Auto Action Capture

`autoCapture` defaults to `true`. When enabled, `Heyna.attach(page, testCase)` wraps the configured page actions, locator factories and chains, keyboard input, and mouse clicks.

`autoActions`, `locatorFactories`, `chainMethods`, and `importantActions` are explicit allowlists. Entries that are not present on the Playwright object are skipped. See [Auto Action Capture](auto-action-capture.md) for the supported checked-in configuration.

## Screenshots and evidence

`screenshotMode` defaults to `failure-only`:

| Mode | Successful actions | Failed actions |
|---|---|---|
| `failure-only` | No screenshot | Screenshot |
| `off` or `disabled` | No screenshot | Screenshot |
| `all` or `on-step` | Screenshot | Screenshot |
| `important-actions` | Screenshot only for `importantActions` | Screenshot |

Evidence is written beneath `evidence/<testCase>/`. `captureEvidence()` creates PNG screenshots there, and the API logger writes `api-log.json`. API logging retains only response URLs containing one of the configured `apiLogging.include` strings and excludes recognized static resources.

## Execution history

History is disabled by default. Enabling it retains immutable run snapshots and, by default, all supported current-run artifact types:

```js
module.exports = {
  history: {
    enabled: true,
    rootDir: 'history',
    runsDir: 'runs',
    tempDir: '.temp',
    latestFile: 'latest.json',
    retention: {
      enabled: true,
      maxRuns: 50,
      maxAgeDays: 30
    },
    artifacts: {
      execution: true,
      metadata: true,
      pdf: true,
      dashboard: true,
      evidence: false,
      traces: false
    },
    migration: {
      enabled: true,
      stateFile: '.migration-state.json'
    },
    lock: {
      file: '.history.lock',
      retryDelayMs: 50,
      maxRetries: 100,
      staleMs: 30000
    }
  }
};
```

Nested history objects are deeply merged with defaults. Set individual artifact flags to `false` to avoid retaining sensitive or large artifacts.

Retention is also disabled by default. When enabled:

- `maxRuns` is a non-negative integer or `null`
- `maxAgeDays` is a finite non-negative number or `null`
- a run is eligible for deletion when it exceeds either configured limit

See [Execution History Storage](history-storage.md) for publication, migration, privacy, and recovery semantics.

## Validated history rules

Configuration validation rejects:

- a non-object history or lock configuration
- an unsafe, negative, or non-integer `lock.maxRetries`
- negative or non-finite `lock.retryDelayMs` or `lock.staleMs`
- empty, absolute, or traversing history child paths
- history child paths that resolve outside `history.rootDir`
- identical or nested `runsDir` and `tempDir` trees
- invalid retention limits when retention is enforced

History child paths are deliberately stricter than current-run output paths because staging and completed runs must remain beneath the same history root for atomic publication.

## Scope

There is no public HEYNA CLI, dashboard configuration API, quality-gate configuration, hosting configuration, or automatic redaction configuration. Do not place secrets in configuration or retained artifacts.
