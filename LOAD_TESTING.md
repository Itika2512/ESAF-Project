# Load Testing (CRM CASA 360 / Customer 360, CBS Cash Deposit / Balance Enquiry)

Browser-based load test harness built on Playwright. Each virtual user (VU) is a real
Chromium session that authenticates **exactly once** and then loops the business flow
over its own data records until the test duration or iteration cap is reached. Every business step is timed as a named
transaction, and all samples are aggregated into an industry standard report
(percentiles, throughput, error rate, Apdex, SLO verdict, time series).

## 1. Prepare test data

Test data lives in CSV files, one row per data set. Rows are **grouped by
`username`/`password`**: a VU is assigned one user group, logs in once as that user and
then cycles round-robin only through that user's records. This guarantees the session
and the data always belong to the same user.

- `fixtures/casa360.csv` — `username,password,casaNumber`
- `fixtures/customer360.csv` — `username,password,customerId`
- `fixtures/crm_deposit360.csv` — `username,password,depositNumber`
- `fixtures/crm_srMobileUpdate.csv` — `username,password,customerId,newMobileNumber,srType,category,subCategory,description,filePath`
- `fixtures/aoco_cifAlone.csv` — `username,password,constitution`
- `fixtures/cbs_balanceEnquiry.csv` — `username,password,customerId`
- `fixtures/cbs_cashDeposit.csv` — `username,password,accountNo,amount,narrative,noteDenomination,authorizer`
- `fixtures/cbs_cashWithdrawal.csv` — `username,password,accountNo,amount,noteDenomination,authorizer`
- `fixtures/cbs_casaTransfer.csv` — `username,password,fromAccountNo,amount,toAccountNo,authorizer`
- `fixtures/cbs_neftPayment.csv` — `username,password,accountNo,amount,beneAccountNo,beneIfsc`
- `fixtures/cbs_rtgsPayment.csv` — `username,password,casaAccountNo,amount,beneIfsc,beneAccountNo`
- `fixtures/cbs_impsPayment.csv` — `username,password,accountNo,amount`
- `fixtures/cbs_loanPayment.csv` — `username,password,loanAccountNo,casaAccountNo,amount,authorizer`
- `fixtures/cbs_tdQuickPayin.csv` — `username,password,accountNo,glAccountNo,amount,termMonths,termDays,authorizer`
- `fixtures/cbs_tdRedemption.csv` — `username,password,tdAccountNo,casaAccountNo,authorizer`
- `fixtures/cbs_nomineeMaintenance.csv` — `username,password,accountNo,nomineeName,dateOfBirth,sharePercentage`
- `fixtures/cbs_passbookReissue.csv` — `username,password,accountNo,newPassbookNo`

Lines starting with `#` are comments. Values may be quoted if they contain commas.
Every row must carry `username` and `password`.

> Use distinct application users where possible. VUs are assigned users round-robin, so
> with 25 VUs and 2 users each user carries ~13 concurrent sessions, which can serialise
> server-side state and distort results. Aim for one user per VU.

Override any path with `<FLOW>_DATA`, e.g. `CASA360_DATA`, `CASHDEPOSIT_DATA`,
`TDREDEMPTION_DATA`.

### Cash deposit / withdrawal data rules

`amount` must be exactly divisible by `noteDenomination`; the note count handed to the
denomination screen is derived as `amount / noteDenomination` (see
`utils/cbs.helpers.js`). A mismatch is rejected before the run starts rather than
producing a flood of misleading CBS validation errors.

### Service request data

For `srMobileUpdate`, `filePath` is the attachment uploaded on the SR form and is
resolved relative to the repository root. `srType`, `category` and `subCategory` must
match the CRM dropdown labels exactly.

### Single-use data

- **`tdRedemption`** — a full redemption closes the deposit, so seed one TD per planned
  iteration.
- **`nomineeMaintenance`** — an account only accepts a limited number of nominees; give
  each user its own account.
- **`passbookReissue`** — the spec appends VU and iteration to `newPassbookNo`, so the CSV
  value acts as a prefix and stays unique per attempt.

> **`srMobileUpdate` and `aocoCifAlone` write data.** Each iteration saves a real service
> request / opens a real onboarding application.

> **Every CBS flow except `balanceEnquiry` writes data.** Each iteration posts and
> authorises a real transaction or maintains customer data. A 10 VU / 10 minute run can
> create thousands of postings and will move teller till and account balances. Only run
> against UAT/DR with explicit sign-off, and agree the data clean-up beforehand.

## 2. Run

```bash
# validation run first: 2 VUs per flow, 2 iterations each
npm run load:smoke

# full run with the configured profile
LOAD_TEST=1 VUS=25 RAMP_UP_SEC=300 DURATION_SEC=1800 npm run load

# whole application: SYSTEMS expands to every flow of that app and the folder
# scopes collection to its specs
npm run load:crm
npm run load:cbs
npm run load:aoco
npm run load:crm:smoke              # 1 VU, 1 iteration per flow
npm run load:cbs:smoke
npm run load:aoco:smoke

# single flow
npm run load:casa360
npm run load:customer360
npm run load:deposit360

# CRM service request — saves a real SR per iteration
npm run load:srmobileupdate

# AOCO onboarding — opens a real application per iteration
npm run load:aoco:cif:smoke         # 1 VU, 1 application, validates the flow
npm run load:aoco:cif

# CBS balance enquiry — read-only, safe to run at higher concurrency
npm run load:balanceenquiry:smoke
npm run load:balanceenquiry

# CBS cash deposit — posts real transactions, never included by default
npm run load:cashdeposit:smoke      # 1 VU, 1 deposit, validates the flow end to end
LOAD_TEST=1 FLOWS=cashDeposit VUS=5 RAMP_UP_SEC=60 DURATION_SEC=600 \
  npx playwright test tests/load/cbs

# the remaining CBS flows — all write data
npm run load:cashwithdrawal
npm run load:casatransfer
npm run load:neft
npm run load:rtgs
npm run load:imps
npm run load:loanpayment
npm run load:tdquickpayin
npm run load:tdredemption
npm run load:nominee
npm run load:passbook

# mixed CBS load: read-heavy enquiries alongside a lighter posting load
LOAD_TEST=1 FLOWS=balanceEnquiry,cashDeposit VUS_BALANCEENQUIRY=8 VUS_CASHDEPOSIT=2 \
  RAMP_UP_SEC=60 DURATION_SEC=600 npx playwright test tests/load
```

`npm run load` targets `tests/load` only. Regular functional runs (`npm test`) exclude
the load specs automatically.

### Folders vs selection

Load specs live under `tests/load/<app>/` (`crm`, `cbs`, `aoco`). The folder only scopes
which spec files Playwright collects; a flow still runs only when it is selected:

- `SYSTEMS=cbs` — all flows of that application, write flows included.
- `FLOWS=cashDeposit` — individual flows.
- Additive: `SYSTEMS=cbs FLOWS=casa360` runs all CBS flows plus CRM CASA 360 (use the
  parent `tests/load` path in that case).

Running a folder without either variable lists every spec as `disabled via FLOWS`.

## 3. Configuration (all environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `BASE_URL` | `https://dr-crm.esafbank.org` | CRM entry point under test |
| `TEST_ENV` | `dr` | Free-text environment label stamped on the report |
| `CBS_BASE_URL` | `https://dr-cbs-uat-wll.esafbank.org:31108/obxlogin/login.html` | CBS entry point under test |
| `AOCO_BASE_URL` | `https://dr-onboardingapp.esafbank.org/omniapp/pages/login/loginapp.app` | AOCO onboarding entry point under test |
| `SYSTEMS` | – | Comma separated applications to run in full: `crm`, `cbs`, `aoco` |
| `FLOWS` | `casa360,customer360` | Comma separated flows (additive with `SYSTEMS`): `casa360`, `customer360`, `deposit360`, `srMobileUpdate`, `aocoCifAlone`, `balanceEnquiry`, `cashDeposit`, `cashWithdrawal`, `casaTransfer`, `neftPayment`, `rtgsPayment`, `impsPayment`, `loanPayment`, `tdQuickPayin`, `tdRedemption`, `nomineeMaintenance`, `passbookReissue` |
| `VUS` | `10` | Virtual users per flow |
| `VUS_<FLOW>` | `VUS` | Per-flow VU override, e.g. `VUS_CASHDEPOSIT=2`, `VUS_BALANCEENQUIRY=8` |
| `<FLOW>_DATA` | per flow | CSV path override, e.g. `NEFTPAYMENT_DATA=./my.csv` |
| `<FLOW>_TASK_CODE` / `<FLOW>_TASK_LABEL` | per flow | CBS task to open — `1401`/`1001`/`1091`/`2057`/`2055`/`7022`/`1021`/`7201`/`BA525`/`7030`/`7100` |
| `RAMP_UP_SEC` | `60` | VUs are started linearly across this window |
| `DURATION_SEC` | `600` | Steady-state duration per VU |
| `ITERATIONS` | `0` (duration driven) | Hard cap on iterations per VU |
| `THINK_TIME_MIN_MS` / `THINK_TIME_MAX_MS` | `1000` / `3000` | Random pause between iterations |
| `HEADLESS` | `true` | Set `false` to watch the browsers |
| `WORKERS` | `= total VUs` | Playwright worker processes (one browser each) |
| `ABORT_ON_ERROR` | `false` | Fail the whole VU on the first transaction error |
| `APDEX_T_MS` | `3000` | Apdex satisfied threshold (tolerating = 4T) |
| `SLO_P95_MS` | `5000` | SLO: p95 response time |
| `SLO_P99_MS` | `8000` | SLO: p99 response time |
| `SLO_ERROR_RATE_PCT` | `2` | SLO: maximum error rate |
| `SLO_MIN_TPS` | `0` (disabled) | SLO: minimum throughput |
| `RESULTS_DIR` | `./load-results` | Root output folder |
| `LOAD_RUN_ID` | timestamp | Run identifier / output sub-folder |
| `REPORT_BUCKET_SEC` | `10` | Time-series bucket width |

### Capacity note

One VU is one Chromium instance. Budget roughly 250–400 MB RAM and ~0.3 vCPU per VU.
Beyond ~20–25 VUs on a laptop, the client becomes the bottleneck and the numbers
measure your machine, not the CRM. Distribute across agents for higher concurrency.

## 4. Transactions measured

**CASA 360** — `00 Login`, `01 Search account`, `02 Open account details`,
`03 Financial Details tab`

**Customer 360** — `00 Login`, `01 Search customer`, `02 Open customer details`,
`03 Communication tab`, `04 KYC Info tab`

**CBS Cash Deposit** — `00 Login`, `01 Open task 1401`, `02 Enter transaction`,
`03 Denomination details`, `04 Authorise`

**CBS Balance Enquiry** — `00 Login`, `01 Open task 7100`, `02 Query customer balances`,
`03 Back to enquiry list`. Read-only, so this is the flow to use for sustained,
high-concurrency CBS capacity tests.

### Session model

`00 Login` is executed once per VU, before the iteration loop, and is recorded as its own
transaction so it never inflates the per-iteration numbers. The session is then reused
for every iteration.

After a failed iteration the harness checks whether the CRM login form has reappeared:

- **Session alive** — nothing happens, the next iteration continues on the same session.
- **Session lost** — a `00 Re-login (session recovery)` transaction is recorded and the VU
  re-authenticates. If that also fails, the VU ends.

Re-login counts are printed per VU at the end of the run and visible as a separate row in
`transactions.csv`. A non-zero count is a finding in itself: it usually means the server
dropped sessions under load.

CBS additionally signs out once per VU after the last iteration, so teller sessions are
released cleanly instead of being killed with the browser.

CBS login hands over to the Oracle Flexcube Retail **popup window**. A flow's `login`
returns that page and the harness then runs every transaction, screenshot, navigation
timing and HTTP metric against it (see `utils/cbsSession.js`).

Each transaction ends only once the UI has stopped mutating (`waitForUiIdle`), so the
timing covers server response plus rendering. Additional synthetic samples are written
per iteration: `ITERATION (end-to-end)`, `PAGE LOAD (navigation timing)` and
`HTTP (network summary)`.

## 5. Outputs

Everything lands in `load-results/<runId>/`:

| Artefact | Contents |
| --- | --- |
| `index.html` | Self-contained dashboard: KPIs, SLO verdict, trend charts, all tables |
| `summary.json` | Full machine-readable report (CI gates, trend databases) |
| `transactions.csv` | Per transaction: count, pass/fail, min/avg/median/p90/p95/p99/max, std dev, TPS, Apdex |
| `flows.csv` | Same statistics rolled up per flow |
| `timeseries.csv` | Per interval: active VUs, throughput, errors, avg and p95 response time |
| `samples.csv` | Raw sample log, one row per transaction execution |
| `errors.csv` | Grouped failures with counts and first/last seen |
| `http-metrics.csv` | Requests, 4xx, 5xx, failed requests, MB received, slowest request |
| `browser-metrics.csv` | TTFB, DOM interactive, DCL, load, FCP (avg and p95) |
| `screenshots/` | Screenshot per failed iteration |
| `raw/*.jsonl` | Per-VU sample streams (source of truth for aggregation) |
| `playwright-results.json`, `playwright-html/` | Native Playwright execution report |

The report is generated automatically in the global teardown. To rebuild it without
re-running the test:

```bash
npm run load:report                        # latest run
LOAD_RUN_ID=20260730-171500 npm run load:report
```

## 6. Reading the results

- **Error rate** — first thing to check. High error rates invalidate response times.
- **p95 / p99** — the headline SLO numbers; averages hide the tail.
- **Throughput vs active VUs** — if throughput flattens while VUs keep rising, the
  system has saturated; the knee of that curve is the capacity limit.
- **Std dev** — large values indicate unstable response times (queueing, GC, locks).
- **Apdex** — single user-satisfaction score, `>= 0.94` is generally "good".
- **HTTP 5xx / failed requests** — server-side saturation signals.
- **SLO verdict** — `PASS`/`FAIL` computed from the `SLO_*` thresholds.

## 7. Report a run alongside server-side metrics

Client-side numbers alone are not a diagnosis. Capture CRM application server, DB and
infrastructure metrics (CPU, memory, GC, thread pools, slow queries) over the same
window and attach them to the run folder before sharing results.
