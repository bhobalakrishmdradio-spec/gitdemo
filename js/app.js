'use strict';

/* =========================================================
   MyFinances — a fully client-side personal finance tracker
   All data lives in localStorage. No backend, no build step.
   ========================================================= */

/* ---------- Category catalog ---------- */
const CATEGORIES = {
  income: [
    { key: 'salary', label: 'Salary', icon: '💼', color: '#16a34a' },
    { key: 'freelance', label: 'Freelance', icon: '🧑‍💻', color: '#22c55e' },
    { key: 'investment', label: 'Investment', icon: '📈', color: '#059669' },
    { key: 'gift', label: 'Gift', icon: '🎁', color: '#10b981' },
    { key: 'other_income', label: 'Other Income', icon: '➕', color: '#34d399' },
  ],
  expense: [
    { key: 'food', label: 'Food & Dining', icon: '🍔', color: '#f97316' },
    { key: 'rent', label: 'Rent & Housing', icon: '🏠', color: '#6366f1' },
    { key: 'utilities', label: 'Utilities', icon: '💡', color: '#eab308' },
    { key: 'transportation', label: 'Transportation', icon: '🚗', color: '#0ea5e9' },
    { key: 'entertainment', label: 'Entertainment', icon: '🎬', color: '#ec4899' },
    { key: 'shopping', label: 'Shopping', icon: '🛍️', color: '#a855f7' },
    { key: 'health', label: 'Health & Fitness', icon: '💊', color: '#ef4444' },
    { key: 'education', label: 'Education', icon: '📚', color: '#14b8a6' },
    { key: 'insurance', label: 'Insurance', icon: '🛡️', color: '#64748b' },
    { key: 'other_expense', label: 'Other', icon: '📦', color: '#9ca3af' },
  ],
};

const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', INR: '₹', JPY: '¥', CAD: '$', AUD: '$' };

const STORAGE_KEY = 'myfinances_state_v1';
const PREFS_KEY = 'myfinances_prefs_v1';       // plaintext, non-sensitive (theme only) - readable before unlock
const LOCK_META_KEY = 'myfinances_lock_meta_v1'; // plaintext meta (salt, PIN-check ciphertext) - no financial data
const LOCK_CHECK_PLAINTEXT = 'myfinances-lock-v1';

/* ---------- App Lock: crypto helpers (Web Crypto API) ---------- */
function cryptoAvailable() {
  return !!(window.crypto && window.crypto.subtle);
}

function bufToB64(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function b64ToBuf(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function deriveKeyFromPin(pin, saltB64) {
  const salt = b64ToBuf(saltB64);
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptWithKey(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const data = enc.encode(JSON.stringify(obj));
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { cipher: bufToB64(cipherBuf), iv: bufToB64(iv) };
}

async function decryptWithKey(key, cipherB64, ivB64) {
  const cipherBuf = b64ToBuf(cipherB64);
  const iv = new Uint8Array(b64ToBuf(ivB64));
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBuf);
  return JSON.parse(new TextDecoder().decode(plainBuf));
}

/* ---------- App Lock: meta + prefs (always-plaintext, non-financial) ---------- */
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
  } catch (e) {
    return {};
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (e) {
    console.error('Save prefs failed', e);
  }
}

function loadLockMeta() {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCK_META_KEY) || '{}');
    return {
      enabled: !!raw.enabled,
      salt: raw.salt || null,
      checkCipher: raw.checkCipher || null,
      checkIv: raw.checkIv || null,
      autoLockMinutes: typeof raw.autoLockMinutes === 'number' ? raw.autoLockMinutes : 5,
    };
  } catch (e) {
    return { enabled: false, salt: null, checkCipher: null, checkIv: null, autoLockMinutes: 5 };
  }
}

function saveLockMeta(meta) {
  try {
    localStorage.setItem(LOCK_META_KEY, JSON.stringify(meta));
  } catch (e) {
    console.error('Save lock meta failed', e);
    showToast("Couldn't save - your browser is blocking local storage");
  }
}

let lockMeta = loadLockMeta();
let encryptionKey = null;     // in-memory only; never persisted
let isLocked = false;         // true while the lock screen is covering the app
let pendingEncryptedBlob = null; // { cipher, iv } read at boot, decrypted once the PIN is entered
let autoLockTimer = null;

/* ---------- State ---------- */
let state = loadState();
if (isLocked) {
  // The theme lives in a small plaintext prefs entry so the lock screen
  // itself can theme correctly before the PIN has decrypted anything else.
  const prefs = loadPrefs();
  if (prefs.theme) state.settings.theme = prefs.theme;
}

function defaultState() {
  return {
    transactions: [],
    budgets: {},           // { categoryKey: monthlyLimit }
    settings: {
      currency: 'USD',
      theme: 'light',
      lastExportAt: null,        // timestamp (ms) of the last successful export
      reminderDays: 7,           // 0 = reminders off
      reminderSnoozedUntil: null, // timestamp (ms); banner hidden until then
    },
  };
}

function normalizeState(parsed) {
  return {
    transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
    budgets: parsed.budgets && typeof parsed.budgets === 'object' ? parsed.budgets : {},
    settings: Object.assign(defaultState().settings, parsed.settings || {}),
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (parsed && parsed.encrypted) {
      // Locked: can't decrypt without the PIN yet. Stash the ciphertext and
      // hand back an empty shell; the lock screen fills this in on unlock.
      pendingEncryptedBlob = { cipher: parsed.cipher, iv: parsed.iv };
      isLocked = true;
      return defaultState();
    }
    return normalizeState(parsed);
  } catch (e) {
    console.error('Failed to load saved data, starting fresh.', e);
    return defaultState();
  }
}

function saveState() {
  // Never let a storage failure (e.g. Safari Private Browsing, which throws
  // on every localStorage.setItem, or a full quota) propagate out of here:
  // the caller has already updated in-memory `state` and needs to keep going
  // (close the modal, refresh the view) even if persistence itself fails.
  if (lockMeta.enabled && encryptionKey) {
    // Encrypted persistence is necessarily async (Web Crypto has no sync API).
    // The in-memory `state` is already updated by the caller, so the UI stays
    // correct immediately; this just needs to land in storage shortly after.
    encryptWithKey(encryptionKey, { transactions: state.transactions, budgets: state.budgets, settings: state.settings })
      .then((blob) => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ encrypted: true, cipher: blob.cipher, iv: blob.iv }));
      })
      .catch((err) => {
        console.error('Encrypted save failed', err);
        showToast("Couldn't save - your browser is blocking local storage");
      });
  } else {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.error('Save failed', err);
      showToast("Couldn't save - your browser is blocking local storage");
    }
  }
}

/* ---------- Helpers ---------- */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatCurrency(amount) {
  const symbol = CURRENCY_SYMBOLS[state.settings.currency] || '$';
  const sign = amount < 0 ? '-' : '';
  return `${sign}${symbol}${Math.abs(amount).toFixed(2)}`;
}

function monthKey(dateStr) {
  return dateStr.slice(0, 7); // "YYYY-MM"
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonthKey() {
  return todayStr().slice(0, 7);
}

function categoryInfo(key) {
  return (
    CATEGORIES.income.find((c) => c.key === key) ||
    CATEGORIES.expense.find((c) => c.key === key) ||
    { key, label: key, icon: '❓', color: '#9ca3af' }
  );
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.hidden = true; }, 2200);
}

/* ---------- Navigation ---------- */
const views = ['dashboard', 'transactions', 'budgets', 'settings'];
const viewTitles = { dashboard: 'Dashboard', transactions: 'Transactions', budgets: 'Budgets', settings: 'Settings' };

function switchView(view) {
  views.forEach((v) => {
    document.getElementById(`view-${v}`).classList.toggle('active', v === view);
  });
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  document.getElementById('viewTitle').textContent = viewTitles[view];
  renderBackupReminder();
  if (view === 'dashboard') renderDashboard();
  if (view === 'transactions') renderTransactionsView();
  if (view === 'budgets') renderBudgetsView();
}

/* ---------- Backup reminder ---------- */
function daysSince(timestamp) {
  return (Date.now() - timestamp) / 86400000;
}

function renderBackupReminder() {
  const banner = document.getElementById('backupReminder');
  const { reminderDays, reminderSnoozedUntil, lastExportAt } = state.settings;

  const dueForReminder =
    reminderDays > 0 &&
    state.transactions.length > 0 &&
    !(reminderSnoozedUntil && Date.now() < reminderSnoozedUntil) &&
    (!lastExportAt || daysSince(lastExportAt) >= reminderDays);

  banner.hidden = !dueForReminder;
  if (dueForReminder) {
    const text = lastExportAt
      ? `It's been ${Math.floor(daysSince(lastExportAt))} days since your last backup. Export your data to keep it safe.`
      : "You haven't backed up your data yet. Export a copy to keep it safe.";
    document.getElementById('backupReminderText').textContent = text;
  }

  const label = document.getElementById('lastBackupLabel');
  if (label) {
    label.textContent = lastExportAt
      ? `Last backup: ${formatDate(new Date(lastExportAt).toISOString().slice(0, 10))}`
      : "You haven't exported a backup yet.";
  }
}

function snoozeBackupReminder() {
  state.settings.reminderSnoozedUntil = Date.now() + 2 * 86400000; // 2 days
  saveState();
  renderBackupReminder();
  showToast("We'll remind you again in a couple of days");
}

/* ---------- Dashboard rendering ---------- */
function renderDashboard() {
  const month = document.getElementById('chartMonthSelect').value || currentMonthKey();
  renderStatCards();
  renderCategoryChart(month);
  renderTrendChart();
  renderRecentTransactions();
  populateMonthSelect();
}

function renderStatCards() {
  const mKey = currentMonthKey();
  const monthTxns = state.transactions.filter((t) => monthKey(t.date) === mKey);
  const income = monthTxns.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = monthTxns.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const totalBalance = state.transactions.reduce(
    (s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0
  );
  const savingsRate = income > 0 ? Math.round(((income - expense) / income) * 100) : 0;

  document.getElementById('statBalance').textContent = formatCurrency(totalBalance);
  document.getElementById('statIncome').textContent = formatCurrency(income);
  document.getElementById('statExpense').textContent = formatCurrency(expense);
  document.getElementById('statSavingsRate').textContent = `${savingsRate}%`;
}

function populateMonthSelect() {
  const select = document.getElementById('chartMonthSelect');
  const months = Array.from(new Set(state.transactions.map((t) => monthKey(t.date)))).sort().reverse();
  if (!months.includes(currentMonthKey())) months.unshift(currentMonthKey());
  const prevValue = select.value;
  select.innerHTML = months.map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join('');
  select.value = months.includes(prevValue) ? prevValue : currentMonthKey();
}

/* ---------- Canvas: category pie chart ---------- */
function renderCategoryChart(mKey) {
  const canvas = document.getElementById('categoryChart');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const expenses = state.transactions.filter((t) => t.type === 'expense' && monthKey(t.date) === mKey);
  const totals = {};
  expenses.forEach((t) => { totals[t.category] = (totals[t.category] || 0) + t.amount; });
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const legend = document.getElementById('chartLegend');

  if (entries.length === 0) {
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-muted');
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No expenses this month', canvas.width / 2, canvas.height / 2);
    legend.innerHTML = '';
    return;
  }

  const total = entries.reduce((s, [, v]) => s + v, 0);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const radius = Math.min(cx, cy) - 20;
  let startAngle = -Math.PI / 2;

  entries.forEach(([catKey, val]) => {
    const info = categoryInfo(catKey);
    const sliceAngle = (val / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, startAngle + sliceAngle);
    ctx.closePath();
    ctx.fillStyle = info.color;
    ctx.fill();
    startAngle += sliceAngle;
  });

  // Donut hole
  const bg = getComputedStyle(document.body).getPropertyValue('--surface').trim() || '#fff';
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();

  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text');
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(formatCurrency(total), cx, cy);

  legend.innerHTML = entries.map(([catKey, val]) => {
    const info = categoryInfo(catKey);
    const pct = ((val / total) * 100).toFixed(1);
    return `<li>
      <span class="legend-name"><span class="swatch" style="background:${info.color}"></span>${info.icon} ${info.label}</span>
      <span>${formatCurrency(val)} (${pct}%)</span>
    </li>`;
  }).join('');
}

/* ---------- Canvas: monthly trend (last 6 months) ---------- */
function renderTrendChart() {
  const canvas = document.getElementById('trendChart');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const data = months.map((mKey) => {
    const txns = state.transactions.filter((t) => monthKey(t.date) === mKey);
    return {
      mKey,
      income: txns.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0),
      expense: txns.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0),
    };
  });

  const maxVal = Math.max(1, ...data.map((d) => Math.max(d.income, d.expense)));
  const padding = 36;
  const chartW = canvas.width - padding * 2;
  const chartH = canvas.height - padding * 2;
  const groupW = chartW / months.length;
  const barW = groupW * 0.32;

  const incomeColor = getComputedStyle(document.body).getPropertyValue('--income') || '#16a34a';
  const expenseColor = getComputedStyle(document.body).getPropertyValue('--expense') || '#dc2626';
  const mutedColor = (getComputedStyle(document.body).getPropertyValue('--text-muted') || '#666').trim();
  const borderColor = (getComputedStyle(document.body).getPropertyValue('--border') || '#ddd').trim();

  // Baseline
  ctx.strokeStyle = borderColor;
  ctx.beginPath();
  ctx.moveTo(padding, canvas.height - padding);
  ctx.lineTo(canvas.width - padding, canvas.height - padding);
  ctx.stroke();

  data.forEach((d, i) => {
    const groupX = padding + i * groupW;
    const incomeH = (d.income / maxVal) * chartH;
    const expenseH = (d.expense / maxVal) * chartH;
    const baseY = canvas.height - padding;

    ctx.fillStyle = incomeColor.trim();
    ctx.fillRect(groupX + groupW * 0.12, baseY - incomeH, barW, incomeH);

    ctx.fillStyle = expenseColor.trim();
    ctx.fillRect(groupX + groupW * 0.12 + barW + 4, baseY - expenseH, barW, expenseH);

    ctx.fillStyle = mutedColor;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    const [, m] = d.mKey.split('-');
    const label = new Date(2000, Number(m) - 1, 1).toLocaleDateString(undefined, { month: 'short' });
    ctx.fillText(label, groupX + groupW / 2, canvas.height - padding + 16);
  });
}

/* ---------- Recent transactions (dashboard) ---------- */
function renderRecentTransactions() {
  const container = document.getElementById('recentList');
  const recent = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 6);
  if (recent.length === 0) {
    container.innerHTML = '<p class="empty-state">No transactions yet. Click "Add Transaction" to get started.</p>';
    return;
  }
  container.innerHTML = recent.map(txnRowHTML).join('');
  wireRowActions(container);
}

function txnRowHTML(t) {
  const info = categoryInfo(t.category);
  const sign = t.type === 'income' ? '+' : '−';
  return `<div class="txn-row" data-id="${t.id}">
    <div class="txn-info">
      <span class="txn-desc">${info.icon} ${escapeHTML(t.description)}</span>
      <span class="txn-meta">${info.label} · ${formatDate(t.date)}</span>
    </div>
    <div class="txn-amount ${t.type}">${sign} ${formatCurrency(t.amount)}</div>
  </div>`;
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ---------- Transactions view (full table) ---------- */
function populateCategoryFilter() {
  const select = document.getElementById('filterCategory');
  const options = ['<option value="all">All Categories</option>'];
  options.push('<optgroup label="Income">');
  CATEGORIES.income.forEach((c) => options.push(`<option value="${c.key}">${c.icon} ${c.label}</option>`));
  options.push('</optgroup><optgroup label="Expense">');
  CATEGORIES.expense.forEach((c) => options.push(`<option value="${c.key}">${c.icon} ${c.label}</option>`));
  options.push('</optgroup>');
  select.innerHTML = options.join('');
}

function getFilteredTransactions() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const type = document.getElementById('filterType').value;
  const category = document.getElementById('filterCategory').value;
  const month = document.getElementById('filterMonth').value;

  return state.transactions
    .filter((t) => (search ? t.description.toLowerCase().includes(search) : true))
    .filter((t) => (type === 'all' ? true : t.type === type))
    .filter((t) => (category === 'all' ? true : t.category === category))
    .filter((t) => (month ? monthKey(t.date) === month : true))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

function renderTransactionsView() {
  const tbody = document.getElementById('txnTableBody');
  const list = getFilteredTransactions();
  const emptyState = document.getElementById('emptyState');

  emptyState.hidden = list.length !== 0;
  tbody.innerHTML = list.map((t) => {
    const info = categoryInfo(t.category);
    const sign = t.type === 'income' ? '+' : '−';
    return `<tr data-id="${t.id}">
      <td>${formatDate(t.date)}</td>
      <td>${escapeHTML(t.description)}${t.notes ? `<div class="txn-meta">${escapeHTML(t.notes)}</div>` : ''}</td>
      <td><span class="cat-badge">${info.icon} ${info.label}</span></td>
      <td>${t.type === 'income' ? 'Income' : 'Expense'}</td>
      <td class="right ${t.type === 'income' ? 'txn-amount income' : 'txn-amount expense'}">${sign} ${formatCurrency(t.amount)}</td>
      <td>
        <div class="row-actions">
          <button data-action="edit" title="Edit">✏️</button>
          <button data-action="delete" title="Delete">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  wireRowActions(tbody);
}

function wireRowActions(container) {
  container.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = e.target.closest('[data-id]').dataset.id;
      openTransactionModal(state.transactions.find((t) => t.id === id));
    });
  });
  container.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = e.target.closest('[data-id]').dataset.id;
      if (confirm('Delete this transaction?')) {
        state.transactions = state.transactions.filter((t) => t.id !== id);
        saveState();
        refreshCurrentView();
        showToast('Transaction deleted');
      }
    });
  });
  // Clicking a dashboard txn-row opens edit too
  container.querySelectorAll('.txn-row').forEach((row) => {
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => {
      const id = row.dataset.id;
      openTransactionModal(state.transactions.find((t) => t.id === id));
    });
  });
}

/* ---------- Budgets view ---------- */
function populateBudgetMonthSelect() {
  const select = document.getElementById('budgetMonthSelect');
  const months = Array.from(new Set(state.transactions.map((t) => monthKey(t.date)))).sort().reverse();
  if (!months.includes(currentMonthKey())) months.unshift(currentMonthKey());
  const prevValue = select.value;
  select.innerHTML = months.map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join('');
  select.value = months.includes(prevValue) ? prevValue : currentMonthKey();
}

function renderBudgetsView() {
  populateBudgetMonthSelect();
  const container = document.getElementById('budgetList');
  const mKey = document.getElementById('budgetMonthSelect').value || currentMonthKey();
  const spentByCategory = {};
  state.transactions
    .filter((t) => t.type === 'expense' && monthKey(t.date) === mKey)
    .forEach((t) => { spentByCategory[t.category] = (spentByCategory[t.category] || 0) + t.amount; });

  container.innerHTML = CATEGORIES.expense.map((cat) => {
    const spent = spentByCategory[cat.key] || 0;
    const budget = state.budgets[cat.key] || 0;
    const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
    const barClass = budget > 0 && spent > budget ? 'over' : (pct >= 80 ? 'warn' : '');
    return `<div class="budget-item" data-cat="${cat.key}">
      <div class="budget-item-top">
        <span class="cat">${cat.icon} ${cat.label}</span>
        <span>
          ${formatCurrency(spent)} /
          <input type="number" class="budget-input" min="0" step="1" value="${budget || ''}" placeholder="No limit" data-cat="${cat.key}" />
        </span>
      </div>
      <div class="budget-bar-track">
        <div class="budget-bar-fill ${barClass}" style="width:${budget > 0 ? pct : 0}%"></div>
      </div>
      ${budget > 0 && spent > budget ? `<div class="muted" style="color:var(--expense)">Over budget by ${formatCurrency(spent - budget)}</div>` : ''}
    </div>`;
  }).join('');

  container.querySelectorAll('.budget-input').forEach((input) => {
    input.addEventListener('change', (e) => {
      const cat = e.target.dataset.cat;
      const val = parseFloat(e.target.value);
      if (!isNaN(val) && val > 0) {
        state.budgets[cat] = val;
      } else {
        delete state.budgets[cat];
      }
      saveState();
      renderBudgetsView();
      showToast('Budget updated');
    });
  });
}

/* ---------- Modal: add/edit transaction ---------- */
let currentTxnType = 'expense';

function populateCategorySelect(type) {
  const select = document.getElementById('txnCategory');
  select.innerHTML = CATEGORIES[type].map((c) => `<option value="${c.key}">${c.icon} ${c.label}</option>`).join('');
}

function openTransactionModal(txn) {
  const overlay = document.getElementById('modalOverlay');
  const form = document.getElementById('txnForm');
  form.reset();

  currentTxnType = txn ? txn.type : 'expense';
  setTypeButtons(currentTxnType);
  populateCategorySelect(currentTxnType);

  document.getElementById('modalTitle').textContent = txn ? 'Edit Transaction' : 'Add Transaction';
  document.getElementById('txnId').value = txn ? txn.id : '';
  document.getElementById('txnDescription').value = txn ? txn.description : '';
  document.getElementById('txnAmount').value = txn ? txn.amount : '';
  document.getElementById('txnDate').value = txn ? txn.date : todayStr();
  document.getElementById('txnNotes').value = txn ? (txn.notes || '') : '';
  if (txn) document.getElementById('txnCategory').value = txn.category;

  overlay.hidden = false;
  document.getElementById('txnDescription').focus();
}

function closeTransactionModal() {
  if (dictationRecognition) dictationRecognition.stop();
  document.getElementById('modalOverlay').hidden = true;
}

function setTypeButtons(type) {
  currentTxnType = type;
  document.getElementById('typeExpenseBtn').classList.toggle('active', type === 'expense');
  document.getElementById('typeIncomeBtn').classList.toggle('active', type === 'income');
  populateCategorySelect(type);
}

function handleTransactionSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('txnId').value;
  const description = document.getElementById('txnDescription').value.trim();
  const amount = parseFloat(document.getElementById('txnAmount').value);
  const date = document.getElementById('txnDate').value;
  const category = document.getElementById('txnCategory').value;
  const notes = document.getElementById('txnNotes').value.trim();

  if (!description || isNaN(amount) || amount <= 0 || !date || !category) {
    showToast('Please fill in all required fields');
    return;
  }

  if (id) {
    const txn = state.transactions.find((t) => t.id === id);
    Object.assign(txn, { description, amount, date, category, notes, type: currentTxnType });
    showToast('Transaction updated');
  } else {
    state.transactions.push({
      id: uid(),
      type: currentTxnType,
      description, amount, date, category, notes,
      createdAt: Date.now(),
    });
    showToast('Transaction added');
  }

  saveState();
  closeTransactionModal();
  refreshCurrentView();
}

function refreshCurrentView() {
  const activeBtn = document.querySelector('.nav-btn.active');
  const view = activeBtn ? activeBtn.dataset.view : 'dashboard';
  switchView(view);
}

/* ---------- App Lock: UI flow ---------- */
let pinModalResolve = null;

function openPinModal({ title, subtitle, singleInput, label1, label2 }) {
  return new Promise((resolve) => {
    pinModalResolve = resolve;
    document.getElementById('pinModalTitle').textContent = title;
    document.getElementById('pinModalSubtitle').textContent = subtitle;
    document.getElementById('pinInput1Label').textContent = label1 || 'PIN';
    document.getElementById('pinInput2Row').hidden = !!singleInput;
    document.getElementById('pinInput2').required = !singleInput;
    if (label2) document.querySelector('label[for="pinInput2"]').textContent = label2;
    document.getElementById('pinForm').reset();
    document.getElementById('pinModalError').hidden = true;
    document.getElementById('pinModalOverlay').hidden = false;
    document.getElementById('pinInput1').focus();
  });
}

function closePinModal(result) {
  document.getElementById('pinModalOverlay').hidden = true;
  if (pinModalResolve) {
    pinModalResolve(result);
    pinModalResolve = null;
  }
}

function pinModalErrorText(msg) {
  const el = document.getElementById('pinModalError');
  el.textContent = msg;
  el.hidden = false;
}

function handlePinFormSubmit(e) {
  e.preventDefault();
  const pin1 = document.getElementById('pinInput1').value;
  const singleInput = document.getElementById('pinInput2Row').hidden;

  if (!/^\d{4,6}$/.test(pin1)) {
    pinModalErrorText('PIN must be 4-6 digits');
    return;
  }
  if (!singleInput) {
    const pin2 = document.getElementById('pinInput2').value;
    if (pin1 !== pin2) {
      pinModalErrorText("PINs don't match");
      return;
    }
  }
  closePinModal(pin1);
}

async function enableAppLock() {
  if (!cryptoAvailable()) {
    showToast('App Lock needs a secure browser context (serve over HTTPS or via a local server) and is not available here');
    return;
  }

  const pin = await openPinModal({
    title: 'Set App Lock PIN',
    subtitle: "Choose a 4-6 digit PIN. You'll need it every time you open MyFinances.",
    singleInput: false,
    label1: 'New PIN',
    label2: 'Confirm PIN',
  });
  if (!pin) return; // cancelled

  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const saltB64 = bufToB64(saltBytes.buffer);
  const key = await deriveKeyFromPin(pin, saltB64);
  const check = await encryptWithKey(key, { v: LOCK_CHECK_PLAINTEXT });

  lockMeta = {
    enabled: true,
    salt: saltB64,
    checkCipher: check.cipher,
    checkIv: check.iv,
    autoLockMinutes: 5,
  };
  saveLockMeta(lockMeta);
  encryptionKey = key;
  saveState(); // re-persists current state encrypted under the new key
  updateAppLockUI();
  resetAutoLockTimer();
  showToast('App Lock turned on');
}

async function disableAppLock() {
  const pin = await openPinModal({
    title: 'Turn off App Lock',
    subtitle: 'Enter your current PIN to confirm.',
    singleInput: true,
    label1: 'Current PIN',
  });
  if (!pin) return; // cancelled

  try {
    const key = await deriveKeyFromPin(pin, lockMeta.salt);
    const result = await decryptWithKey(key, lockMeta.checkCipher, lockMeta.checkIv);
    if (result.v !== LOCK_CHECK_PLAINTEXT) throw new Error('bad pin');
  } catch (e) {
    showToast('Incorrect PIN');
    return;
  }

  lockMeta = { enabled: false, salt: null, checkCipher: null, checkIv: null, autoLockMinutes: 5 };
  saveLockMeta(lockMeta);
  encryptionKey = null;
  clearTimeout(autoLockTimer);
  saveState(); // now writes plaintext, since lockMeta.enabled is false
  updateAppLockUI();
  showToast('App Lock turned off');
}

async function attemptUnlock(pin) {
  const errorEl = document.getElementById('lockError');
  errorEl.hidden = true;
  if (!/^\d{4,6}$/.test(pin)) {
    errorEl.textContent = 'Enter your 4-6 digit PIN';
    errorEl.hidden = false;
    return;
  }

  try {
    const key = await deriveKeyFromPin(pin, lockMeta.salt);
    const check = await decryptWithKey(key, lockMeta.checkCipher, lockMeta.checkIv);
    if (check.v !== LOCK_CHECK_PLAINTEXT) throw new Error('bad pin');

    // Correct PIN: decrypt the real data (freshest copy on disk, in case
    // another unlock/lock cycle wrote to it since boot).
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const blob = raw.encrypted ? raw : pendingEncryptedBlob;
    state = blob ? normalizeState(await decryptWithKey(key, blob.cipher, blob.iv)) : defaultState();

    encryptionKey = key;
    isLocked = false;
    pendingEncryptedBlob = null;
    document.getElementById('lockScreen').hidden = true;
    document.getElementById('lockPinInput').value = '';
    applyTheme(state.settings.theme);
    document.getElementById('currencySelect').value = state.settings.currency;
    document.getElementById('reminderFrequencySelect').value = String(state.settings.reminderDays);
    updateAppLockUI();
    refreshCurrentView();
    resetAutoLockTimer();
  } catch (e) {
    errorEl.textContent = 'Incorrect PIN';
    errorEl.hidden = false;
    document.getElementById('lockPinInput').value = '';
    document.getElementById('lockPinInput').focus();
  }
}

function engageLock() {
  if (!lockMeta.enabled || isLocked) return;
  encryptionKey = null;
  isLocked = true;
  // Blank sensitive in-memory data so it isn't sitting in the DOM/state while locked.
  state = defaultState();
  clearTimeout(autoLockTimer);
  document.getElementById('lockScreen').hidden = false;
  document.getElementById('lockPinInput').value = '';
  document.getElementById('lockError').hidden = true;
  refreshCurrentView();
  setTimeout(() => document.getElementById('lockPinInput').focus(), 50);
}

function lockNow() {
  if (!lockMeta.enabled) return;
  engageLock();
}

function resetAutoLockTimer() {
  clearTimeout(autoLockTimer);
  if (!lockMeta.enabled || isLocked || lockMeta.autoLockMinutes === 0) return;
  autoLockTimer = setTimeout(engageLock, lockMeta.autoLockMinutes * 60000);
}

function forgotPin() {
  if (!confirm('This erases all MyFinances data on this device - there is no way to recover an encrypted backup without the PIN. Continue?')) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LOCK_META_KEY);
  location.reload();
}

function updateAppLockUI() {
  const btn = document.getElementById('appLockToggle');
  if (!btn) return;
  const on = lockMeta.enabled;
  btn.setAttribute('aria-pressed', String(on));
  document.getElementById('appLockToggleLabel').textContent = on ? 'App Lock on' : 'App Lock off';
  document.getElementById('appLockStatusLabel').textContent = on
    ? 'MyFinances is PIN-protected and your data is encrypted at rest on this device.'
    : 'Turn on to protect MyFinances with a PIN.';
  document.getElementById('autoLockRow').hidden = !on;
  if (on) document.getElementById('autoLockSelect').value = String(lockMeta.autoLockMinutes);
  document.getElementById('lockNowBtn').hidden = !on;
}

/* ---------- Voice dictation (Description field) ---------- */
let dictationRecognition = null;

function getSpeechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function resetDictationButton() {
  const btn = document.getElementById('voiceDictateBtn');
  if (btn) {
    btn.classList.remove('recording');
    btn.textContent = '🎤';
    btn.title = 'Dictate description';
  }
  dictationRecognition = null;
}

function toggleDictation() {
  if (dictationRecognition) {
    dictationRecognition.stop(); // onend fires -> resetDictationButton
    return;
  }

  const SR = getSpeechRecognitionCtor();
  if (!SR) {
    showToast('Voice input is not supported in this browser');
    return;
  }

  const input = document.getElementById('txnDescription');
  const baseText = input.value.trim();
  const btn = document.getElementById('voiceDictateBtn');
  let finalTranscript = '';

  dictationRecognition = new SR();
  dictationRecognition.lang = navigator.language || 'en-US';
  dictationRecognition.interimResults = true;
  dictationRecognition.continuous = true;

  btn.classList.add('recording');
  btn.textContent = '⏹️';
  btn.title = 'Stop dictation';

  dictationRecognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) finalTranscript += res[0].transcript + ' ';
      else interim += res[0].transcript;
    }
    const spoken = (finalTranscript + interim).trim();
    input.value = baseText ? (baseText + ' ' + spoken).trim() : spoken;
  };

  dictationRecognition.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      showToast('Microphone access was blocked - check your browser\'s site settings');
    } else if (event.error === 'no-speech') {
      showToast('Didn\'t catch that - try again');
    } else if (event.error !== 'aborted') {
      showToast('Voice input error: ' + event.error);
    }
    resetDictationButton();
  };

  dictationRecognition.onend = resetDictationButton;

  try {
    dictationRecognition.start();
  } catch (e) {
    showToast('Could not start the microphone');
    resetDictationButton();
  }
}

/* ---------- Import / Export / Reset / Sample data ---------- */
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `myfinances-backup-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  state.settings.lastExportAt = Date.now();
  state.settings.reminderSnoozedUntil = null;
  saveState();
  renderBackupReminder();
  showToast('Data exported');
}

function csvEscape(value) {
  const str = String(value == null ? '' : value);
  if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

function buildCsv() {
  const header = ['Date', 'Description', 'Category', 'Type', 'Amount', 'Notes'];
  const rows = [...state.transactions]
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
    .map((t) => {
      const info = categoryInfo(t.category);
      const amount = t.type === 'income' ? t.amount : -t.amount;
      return [t.date, t.description, info.label, t.type === 'income' ? 'Income' : 'Expense', amount.toFixed(2), t.notes || ''];
    });
  return [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
}

function exportCsvData() {
  if (state.transactions.length === 0) {
    showToast('No transactions to export yet');
    return;
  }
  const blob = new Blob([buildCsv()], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `myfinances-transactions-${todayStr()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('CSV exported');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed.transactions)) throw new Error('Invalid file format');
      state = {
        transactions: parsed.transactions,
        budgets: parsed.budgets || {},
        settings: Object.assign(defaultState().settings, parsed.settings || {}),
      };
      saveState();
      applyTheme(state.settings.theme);
      document.getElementById('currencySelect').value = state.settings.currency;
      refreshCurrentView();
      showToast('Data imported successfully');
    } catch (err) {
      alert('Could not import file: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function resetAllData() {
  if (!confirm('This will permanently delete all transactions and budgets, and turn off App Lock. Continue?')) return;
  lockMeta = { enabled: false, salt: null, checkCipher: null, checkIv: null, autoLockMinutes: 5 };
  saveLockMeta(lockMeta);
  encryptionKey = null;
  clearTimeout(autoLockTimer);
  state = defaultState();
  saveState();
  updateAppLockUI();
  refreshCurrentView();
  showToast('All data cleared');
}

function loadSampleData() {
  const mKey = currentMonthKey();
  const [y, m] = mKey.split('-').map(Number);
  const d = (day) => `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const samples = [
    { type: 'income', category: 'salary', description: 'Monthly Salary', amount: 4200, date: d(1) },
    { type: 'expense', category: 'rent', description: 'Apartment Rent', amount: 1400, date: d(2) },
    { type: 'expense', category: 'food', description: 'Grocery Shopping', amount: 95.4, date: d(3) },
    { type: 'expense', category: 'utilities', description: 'Electricity Bill', amount: 62.1, date: d(5) },
    { type: 'expense', category: 'transportation', description: 'Gas Fill-up', amount: 48, date: d(6) },
    { type: 'expense', category: 'entertainment', description: 'Movie Night', amount: 32, date: d(8) },
    { type: 'income', category: 'freelance', description: 'Freelance Web Project', amount: 650, date: d(9) },
    { type: 'expense', category: 'food', description: 'Restaurant Dinner', amount: 54.75, date: d(10) },
    { type: 'expense', category: 'shopping', description: 'New Shoes', amount: 89.99, date: d(12) },
    { type: 'expense', category: 'health', description: 'Gym Membership', amount: 40, date: d(13) },
  ];
  samples.forEach((s) => state.transactions.push({ id: uid(), notes: '', createdAt: Date.now(), ...s }));
  state.budgets = { food: 400, entertainment: 100, shopping: 150, transportation: 120 };
  saveState();
  refreshCurrentView();
  showToast('Sample data loaded');
}

/* ---------- Theme ---------- */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('themeToggle');
  btn.textContent = theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode';
}

function toggleTheme() {
  state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
  applyTheme(state.settings.theme);
  savePrefs({ theme: state.settings.theme }); // plaintext copy so the lock screen can theme itself pre-unlock
  saveState();
  refreshCurrentView(); // charts read CSS colors, so redraw
}

/* ---------- Wire up events ---------- */
function init() {
  applyTheme(state.settings.theme);
  updateAppLockUI();
  if (isLocked) {
    document.getElementById('lockScreen').hidden = false;
    setTimeout(() => document.getElementById('lockPinInput').focus(), 50);
  }
  document.getElementById('currencySelect').value = state.settings.currency;
  document.getElementById('reminderFrequencySelect').value = String(state.settings.reminderDays);
  populateCategoryFilter();
  document.getElementById('txnDate').value = todayStr();

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
  document.querySelectorAll('[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.goto));
  });

  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
  document.getElementById('quickAddBtn').addEventListener('click', () => openTransactionModal(null));
  document.getElementById('modalClose').addEventListener('click', closeTransactionModal);
  document.getElementById('modalCancel').addEventListener('click', closeTransactionModal);
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') closeTransactionModal();
  });
  document.getElementById('txnForm').addEventListener('submit', handleTransactionSubmit);
  document.getElementById('typeExpenseBtn').addEventListener('click', () => setTypeButtons('expense'));
  document.getElementById('typeIncomeBtn').addEventListener('click', () => setTypeButtons('income'));
  document.getElementById('voiceDictateBtn').addEventListener('click', toggleDictation);

  ['searchInput', 'filterType', 'filterCategory', 'filterMonth'].forEach((id) => {
    document.getElementById(id).addEventListener('input', renderTransactionsView);
  });
  document.getElementById('clearFilters').addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    document.getElementById('filterType').value = 'all';
    document.getElementById('filterCategory').value = 'all';
    document.getElementById('filterMonth').value = '';
    renderTransactionsView();
  });

  document.getElementById('chartMonthSelect').addEventListener('change', () => {
    renderCategoryChart(document.getElementById('chartMonthSelect').value);
  });

  document.getElementById('budgetMonthSelect').addEventListener('change', renderBudgetsView);

  document.getElementById('currencySelect').addEventListener('change', (e) => {
    state.settings.currency = e.target.value;
    saveState();
    refreshCurrentView();
  });

  document.getElementById('exportBtn').addEventListener('click', exportData);
  document.getElementById('exportCsvBtn').addEventListener('click', exportCsvData);
  document.getElementById('importInput').addEventListener('change', (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('resetBtn').addEventListener('click', resetAllData);
  document.getElementById('loadSampleBtn').addEventListener('click', loadSampleData);

  document.getElementById('backupExportNowBtn').addEventListener('click', exportData);
  document.getElementById('backupRemindLaterBtn').addEventListener('click', snoozeBackupReminder);
  document.getElementById('reminderFrequencySelect').addEventListener('change', (e) => {
    state.settings.reminderDays = parseInt(e.target.value, 10) || 0;
    state.settings.reminderSnoozedUntil = null;
    saveState();
    renderBackupReminder();
    showToast('Backup reminder updated');
  });

  document.getElementById('appLockToggle').addEventListener('click', async () => {
    if (lockMeta.enabled) await disableAppLock(); else await enableAppLock();
  });
  document.getElementById('autoLockSelect').addEventListener('change', (e) => {
    lockMeta.autoLockMinutes = parseInt(e.target.value, 10) || 0;
    saveLockMeta(lockMeta);
    resetAutoLockTimer();
    showToast('Auto-lock updated');
  });
  document.getElementById('lockNowBtn').addEventListener('click', lockNow);

  document.getElementById('pinForm').addEventListener('submit', handlePinFormSubmit);
  document.getElementById('pinModalCancel').addEventListener('click', () => closePinModal(null));
  document.getElementById('pinModalClose').addEventListener('click', () => closePinModal(null));

  document.getElementById('lockForm').addEventListener('submit', (e) => {
    e.preventDefault();
    attemptUnlock(document.getElementById('lockPinInput').value);
  });
  document.getElementById('lockForgotBtn').addEventListener('click', forgotPin);

  ['mousemove', 'keydown', 'touchstart', 'click'].forEach((evt) => {
    document.addEventListener(evt, resetAutoLockTimer, { passive: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && lockMeta.enabled && lockMeta.autoLockMinutes !== 0) engageLock();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('modalOverlay').hidden) closeTransactionModal();
    if (e.key === 'Escape' && !document.getElementById('pinModalOverlay').hidden) closePinModal(null);
  });

  switchView('dashboard');
}

document.addEventListener('DOMContentLoaded', init);
