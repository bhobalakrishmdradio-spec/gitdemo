# MyFinances — Personal Finance Tracker

A simple, private, fully client-side personal finance app for India. Track
income, expenses, and transfers across multiple cash/bank accounts, set
monthly budgets per category, and see spending trends — all without a
backend or account. Your data stays in your browser (`localStorage`) and
never leaves your device.

## Features

- **Multiple accounts** — cash or bank accounts, each with its own opening
  balance; archive an account without losing its history.
- **Transactions** — income, expense, or transfer between two accounts;
  category, payment method (cash/UPI/card/bank transfer/other), description,
  optional notes, and an optional receipt photo you can view later.
- **Dashboard** — total balance across all accounts, per-account balances,
  monthly income/expenses, savings rate, a category spending donut chart,
  and a 6-month income/expense trend chart.
- **Budgets** — set a spending limit per expense category *per month* (each
  month keeps its own limit) and track progress with a visual bar; shows an
  explicit "No budget set" state.
- **Categories** — manage income/expense categories from Settings; archiving
  keeps past transactions intact but hides the category from new entries.
- **English / Tamil** interface language.
- **Backup** — export as JSON (full data) or CSV (spreadsheet-safe: text
  that could be read as a formula is neutralized); importing a JSON backup
  shows a summary (accounts/categories/transactions/budgets/date range)
  before replacing anything.
- **App Lock** — optional PIN with the data encrypted at rest on-device.
- **Dark mode** toggle, and a sample-data loader to try the app immediately.

## Money model

Amounts are stored as integer **paise** (₹1.00 = 100 paise) rather than
floating-point rupees, to avoid rounding errors in balances and reports.
Enter amounts with up to 2 decimal places (e.g. `125.50`); currency is
Indian Rupee (₹), formatted with Indian digit grouping (e.g. ₹1,25,000.00).

If you have data saved from an earlier version of this app (single account,
US-style currency selector, floating-point amounts), it's migrated
automatically the first time you open the new version: a "Cash" account is
created for your existing transactions, amounts are converted to paise, and
your existing per-category budgets are carried over as this month's limits
(the old model didn't have a month dimension). A copy of your pre-migration
data is kept under a separate `localStorage` key
(`myfinances_state_v1_pre_v2_backup`) as a safety net.

## Running the app

No build step or dependencies are required — it's plain HTML/CSS/JS.

1. Open `index.html` directly in your browser, **or**
2. Serve it locally for the best experience (some browsers restrict local
   file access):

   ```bash
   python3 -m http.server 8000
   # then visit http://localhost:8000
   ```

## Project structure

```
index.html      # App layout and modal markup
css/styles.css  # Styling, including light/dark theme
js/app.js       # App logic: state, rendering, charts, events
```

## Data & privacy

All data is stored in your browser's `localStorage` under the key
`myfinances_state_v1`. Nothing is sent to any server. Use **Settings →
Data Management → Export Data** to back up your data as a JSON file, and
**Import Data** to restore it (e.g. on another device or browser) — you'll
see a summary before anything is replaced.

## Known limitations

- Interface translation (English/Tamil) covers navigation, forms, settings,
  and toasts; a few less-common strings (the pre-unlock lock screen, some
  App Lock status text, voice-dictation messages) are still English-only.
- Category and account *names* you type are never translated (expected —
  they're your own data).
- No recurring transactions, savings goals, multi-currency accounts, or
  bank connections yet.
