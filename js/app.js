'use strict';

/* =========================================================
   MyFinances — a fully client-side personal finance tracker
   All data lives in localStorage. No backend, no build step.
   Schema v2: multiple accounts, transfers, integer-paise money,
   per-month budgets, English/Tamil UI.
   ========================================================= */

const SCHEMA_VERSION = 2;
const STORAGE_KEY = 'myfinances_state_v1';
const PREFS_KEY = 'myfinances_prefs_v1';
const LOCK_META_KEY = 'myfinances_lock_meta_v1';
const LOCK_CHECK_PLAINTEXT = 'myfinances-lock-v1';
const PRE_V2_BACKUP_KEY = 'myfinances_state_v1_pre_v2_backup';

const PAYMENT_METHODS = [
  { id: 'cash', labelKey: 'pay.cash' },
  { id: 'upi', labelKey: 'pay.upi' },
  { id: 'card', labelKey: 'pay.card' },
  { id: 'bank_transfer', labelKey: 'pay.bankTransfer' },
  { id: 'other', labelKey: 'pay.other' },
];

/* ---------- Translations ---------- */
const TRANSLATIONS = {
  en: {
    'nav.dashboard': '📊 Dashboard', 'nav.transactions': '📒 Transactions', 'nav.budgets': '🎯 Budgets', 'nav.settings': '⚙️ Settings',
    'nav.dashboardTitle': 'Dashboard', 'nav.transactionsTitle': 'Transactions', 'nav.budgetsTitle': 'Budgets', 'nav.settingsTitle': 'Settings',
    'lock.now': '🔒 Lock now',
    'txn.add': '+ Add Transaction', 'txn.editTitle': 'Edit Transaction',
    'txn.income': 'Income', 'txn.expense': 'Expense', 'txn.transfer': 'Transfer',
    'txn.allTypes': 'All Types', 'txn.allAccounts': 'All Accounts', 'txn.allCategories': 'All Categories',
    'txn.search': 'Search description...', 'txn.clear': 'Clear',
    'txn.date': 'Date', 'txn.description': 'Description', 'txn.account': 'Account', 'txn.category': 'Category',
    'txn.type': 'Type', 'txn.amount': 'Amount', 'txn.empty': 'No transactions found. Add your first one!',
    'txn.fromAccount': 'From account', 'txn.toAccount': 'To account', 'txn.paymentMethod': 'Payment method',
    'txn.notes': 'Notes (optional)', 'txn.amountError': 'Enter an amount with at most 2 decimal places',
    'txn.upiId': 'UPI ID (optional)', 'txn.scanScreenshot': 'Scan UPI screenshot', 'txn.showDetectedText': 'Show detected text',
    'backup.later': 'Remind me later', 'backup.exportNow': 'Export now',
    'dash.totalBalance': 'Total Balance', 'dash.incomeMonth': 'Income (this month)', 'dash.expenseMonth': 'Expenses (this month)',
    'dash.salaryMonth': 'Salary (this month)', 'dash.otherIncomeMonth': 'Other Income (this month)',
    'dash.salary': 'Salary', 'dash.otherIncome': 'Other Income', 'dash.expense': 'Expenses',
    'dash.periodMonth': 'Month', 'dash.periodYear': 'Year',
    'dash.savingsRate': 'Savings Rate', 'dash.accounts': 'Accounts', 'dash.manage': 'Manage →',
    'dash.spendingByCategory': 'Spending by Category', 'dash.monthlyTrend': 'Monthly Trend',
    'dash.recentTxns': 'Recent Transactions', 'dash.viewAll': 'View all →',
    'budget.title': 'Monthly Budgets by Category',
    'budget.subtitle': 'Set a monthly spending limit per expense category for the selected month — each month keeps its own limits.',
    'budget.noBudget': 'No budget set', 'budget.overBy': 'Over budget by',
    'settings.preferences': 'Preferences', 'settings.language': 'Language', 'settings.currency': 'Currency',
    'settings.currencyValue': 'Indian Rupee (₹) — amounts are stored in paise',
    'settings.accounts': 'Accounts',
    'settings.accountsSubtitle': "Cash or bank accounts you track. Each has its own opening balance; archiving keeps its history but hides it from new entries.",
    'settings.accountName': 'Account name', 'settings.openingBalance': 'Opening balance', 'settings.addAccount': '+ Add account',
    'settings.cash': 'Cash', 'settings.bank': 'Bank',
    'settings.categories': 'Categories',
    'settings.categoriesSubtitle': 'Manage income and expense categories. Archiving keeps past transactions intact but hides the category from new entries.',
    'settings.categoryName': 'Category name', 'settings.addCategory': '+ Add category',
    'settings.dataManagement': 'Data Management',
    'settings.dataSubtitle': 'All your data is stored locally in this browser (localStorage) — nothing is sent to a server.',
    'settings.exportJson': '⬇️ Export Data (JSON)', 'settings.exportCsv': '⬇️ Export as CSV',
    'settings.exportExcel': 'Export as Excel', 'settings.excelWeek': 'Week', 'settings.excelMonth': 'Month',
    'settings.excelYear': 'Year', 'settings.excelAllTime': 'All time', 'settings.excelDownload': '⬇️ Download',
    'settings.importJson': '⬆️ Import Data (JSON)', 'settings.resetAll': '🗑️ Reset All Data',
    'settings.appLock': 'App Lock',
    'settings.appLockSubtitle': 'Require a PIN to open MyFinances, and encrypt your data at rest on this device.',
    'settings.autoLockAfter': 'Auto-lock after', 'settings.autoLockNever': 'Never (manual lock only)',
    'settings.backupReminders': 'Backup Reminders',
    'settings.backupSubtitle': "Get a reminder banner on the dashboard when it's time to export a fresh backup.",
    'settings.remindMe': 'Remind me', 'settings.off': 'Off', 'settings.every3days': 'Every 3 days',
    'settings.weekly': 'Weekly', 'settings.every2weeks': 'Every 2 weeks', 'settings.monthly': 'Monthly',
    'settings.sampleData': 'Sample Data',
    'settings.sampleSubtitle': 'New here? Load a few example transactions to see how MyFinances works.',
    'settings.loadSample': 'Load Sample Data',
    'common.cancel': 'Cancel', 'common.save': 'Save Transaction',
    'restore.title': 'Restore from backup?',
    'restore.subtitle': "This will replace your current data. A recovery copy of what's on this device now will be kept until you close the app.",
    'restore.confirm': 'Replace my data', 'restore.accounts': 'Accounts', 'restore.categories': 'Categories',
    'restore.transactions': 'Transactions', 'restore.budgets': 'Budgets', 'restore.dateRange': 'Date range',
    'pay.cash': 'Cash', 'pay.upi': 'UPI', 'pay.card': 'Card', 'pay.bankTransfer': 'Bank transfer', 'pay.other': 'Other',
    'toast.txnAdded': 'Transaction added', 'toast.txnUpdated': 'Transaction updated', 'toast.txnDeleted': 'Transaction deleted',
    'toast.undo': 'Undo', 'toast.fillRequired': 'Please fill in all required fields',
    'toast.amountInvalid': 'Enter a valid amount (at most 2 decimal places)',
    'toast.transferSameAccount': 'From and To accounts must be different',
    'toast.needTwoAccounts': 'Add a second account first to make a transfer',
    'toast.needOneAccount': 'You need at least one active account',
    'toast.needOneCategory': 'You need at least one active category of this type',
    'toast.acctAdded': 'Account added', 'toast.acctArchived': 'Account archived', 'toast.acctRestored': 'Account restored',
    'toast.catAdded': 'Category added', 'toast.catArchived': 'Category archived', 'toast.catRestored': 'Category restored',
    'toast.budgetUpdated': 'Budget updated', 'toast.dataExported': 'Data exported', 'toast.csvExported': 'CSV exported',
    'toast.excelExported': 'Excel file downloaded', 'toast.excelLoadFailed': "Couldn't create the Excel file (needs an internet connection the first time)",
    'toast.noTxnsToExport': 'No transactions to export yet', 'toast.dataImported': 'Data restored successfully',
    'toast.dataCleared': 'All data cleared', 'toast.sampleLoaded': 'Sample data loaded',
    'toast.storageBlocked': "Couldn't save - your browser is blocking local storage",
    'toast.invalidBackup': "That doesn't look like a MyFinances backup file",
    'toast.ocrReading': 'Reading screenshot… this can take a few seconds',
    'toast.ocrDone': "Detected what we could — please check before saving",
    'toast.ocrNoneFound': "Couldn't confidently detect anything - check the text below or enter details manually",
    'toast.ocrLoadFailed': "Couldn't load the screenshot reader (needs an internet connection the first time) - enter details manually",
    'toast.ocrFailed': "Couldn't read that screenshot - enter details manually",
  },
  ta: {
    'nav.dashboard': '📊 முகப்பு', 'nav.transactions': '📒 பரிவர்த்தனைகள்', 'nav.budgets': '🎯 பட்ஜெட்', 'nav.settings': '⚙️ அமைப்புகள்',
    'nav.dashboardTitle': 'முகப்பு', 'nav.transactionsTitle': 'பரிவர்த்தனைகள்', 'nav.budgetsTitle': 'பட்ஜெட்', 'nav.settingsTitle': 'அமைப்புகள்',
    'lock.now': '🔒 இப்போது பூட்டு',
    'txn.add': '+ பரிவர்த்தனை சேர்', 'txn.editTitle': 'பரிவர்த்தனையைத் திருத்து',
    'txn.income': 'வரவு', 'txn.expense': 'செலவு', 'txn.transfer': 'பரிமாற்றம்',
    'txn.allTypes': 'அனைத்து வகைகளும்', 'txn.allAccounts': 'அனைத்து கணக்குகளும்', 'txn.allCategories': 'அனைத்து வகைப்பாடுகளும்',
    'txn.search': 'விவரத்தைத் தேடு...', 'txn.clear': 'அழி',
    'txn.date': 'தேதி', 'txn.description': 'விவரம்', 'txn.account': 'கணக்கு', 'txn.category': 'வகை',
    'txn.type': 'வகைப்பாடு', 'txn.amount': 'தொகை', 'txn.empty': 'பரிவர்த்தனைகள் இல்லை. உங்கள் முதல் பரிவர்த்தனையைச் சேர்க்கவும்!',
    'txn.fromAccount': 'இருந்து கணக்கு', 'txn.toAccount': 'செல்லும் கணக்கு', 'txn.paymentMethod': 'கட்டண முறை',
    'txn.notes': 'குறிப்புகள் (விருப்பம்)', 'txn.amountError': 'அதிகபட்சம் 2 தசம இடங்களுடன் தொகையை உள்ளிடவும்',
    'txn.upiId': 'UPI ஐடி (விருப்பம்)', 'txn.scanScreenshot': 'UPI ஸ்கிரீன்ஷாட்டைப் படி', 'txn.showDetectedText': 'கண்டறியப்பட்ட உரையைக் காட்டு',
    'backup.later': 'பின்னர் நினைவூட்டு', 'backup.exportNow': 'இப்போது ஏற்றுமதி செய்',
    'dash.totalBalance': 'மொத்த இருப்பு', 'dash.incomeMonth': 'வரவு (இந்த மாதம்)', 'dash.expenseMonth': 'செலவு (இந்த மாதம்)',
    'dash.salaryMonth': 'சம்பளம் (இந்த மாதம்)', 'dash.otherIncomeMonth': 'மற்ற வரவு (இந்த மாதம்)',
    'dash.salary': 'சம்பளம்', 'dash.otherIncome': 'மற்ற வரவு', 'dash.expense': 'செலவு',
    'dash.periodMonth': 'மாதம்', 'dash.periodYear': 'ஆண்டு',
    'dash.savingsRate': 'சேமிப்பு விகிதம்', 'dash.accounts': 'கணக்குகள்', 'dash.manage': 'நிர்வகி →',
    'dash.spendingByCategory': 'வகை வாரியான செலவு', 'dash.monthlyTrend': 'மாதாந்திர போக்கு',
    'dash.recentTxns': 'சமீபத்திய பரிவர்த்தனைகள்', 'dash.viewAll': 'அனைத்தையும் காண்க →',
    'budget.title': 'வகை வாரியான மாத பட்ஜெட்',
    'budget.subtitle': 'தேர்ந்தெடுக்கப்பட்ட மாதத்திற்கு ஒவ்வொரு வகைக்கும் செலவு வரம்பை அமைக்கவும் — ஒவ்வொரு மாதமும் தனித்தனி வரம்புகளைக் கொண்டிருக்கும்.',
    'budget.noBudget': 'பட்ஜெட் அமைக்கப்படவில்லை', 'budget.overBy': 'பட்ஜெட்டை மீறியது',
    'settings.preferences': 'விருப்பத்தேர்வுகள்', 'settings.language': 'மொழி', 'settings.currency': 'நாணயம்',
    'settings.currencyValue': 'இந்திய ரூபாய் (₹) — தொகைகள் பைசாவில் சேமிக்கப்படுகின்றன',
    'settings.accounts': 'கணக்குகள்',
    'settings.accountsSubtitle': 'நீங்கள் கண்காணிக்கும் பண/வங்கிக் கணக்குகள். ஒவ்வொன்றுக்கும் அதன் சொந்த தொடக்க இருப்பு உண்டு; காப்பகப்படுத்துவது வரலாற்றை வைத்திருக்கும், புதிய உள்ளீடுகளில் இருந்து மறைக்கும்.',
    'settings.accountName': 'கணக்கு பெயர்', 'settings.openingBalance': 'தொடக்க இருப்பு', 'settings.addAccount': '+ கணக்கு சேர்',
    'settings.cash': 'பணம்', 'settings.bank': 'வங்கி',
    'settings.categories': 'வகைகள்',
    'settings.categoriesSubtitle': 'வரவு மற்றும் செலவு வகைகளை நிர்வகிக்கவும். காப்பகப்படுத்துவது பழைய பரிவர்த்தனைகளை பாதிக்காது, புதிய உள்ளீடுகளில் இருந்து மட்டும் மறைக்கும்.',
    'settings.categoryName': 'வகை பெயர்', 'settings.addCategory': '+ வகை சேர்',
    'settings.dataManagement': 'தரவு மேலாண்மை',
    'settings.dataSubtitle': 'உங்கள் தரவு அனைத்தும் இந்த உலாவியில் (localStorage) உள்ளூரில் சேமிக்கப்படுகிறது — எதுவும் சர்வருக்கு அனுப்பப்படாது.',
    'settings.exportJson': '⬇️ தரவை ஏற்றுமதி செய் (JSON)', 'settings.exportCsv': '⬇️ CSV ஆக ஏற்றுமதி செய்',
    'settings.exportExcel': 'Excel ஆக ஏற்றுமதி செய்', 'settings.excelWeek': 'வாரம்', 'settings.excelMonth': 'மாதம்',
    'settings.excelYear': 'ஆண்டு', 'settings.excelAllTime': 'எல்லா காலமும்', 'settings.excelDownload': '⬇️ பதிவிறக்கு',
    'settings.importJson': '⬆️ தரவை இறக்குமதி செய் (JSON)', 'settings.resetAll': '🗑️ அனைத்து தரவையும் அழி',
    'settings.appLock': 'பயன்பாட்டு பூட்டு',
    'settings.appLockSubtitle': 'MyFinances-ஐ திறக்க PIN தேவைப்படுத்தி, இந்த சாதனத்தில் உங்கள் தரவை குறியாக்கம் செய்யும்.',
    'settings.autoLockAfter': 'இதற்குப் பிறகு தானாக பூட்டு', 'settings.autoLockNever': 'ஒருபோதும் இல்லை (கைமுறை பூட்டு மட்டும்)',
    'settings.backupReminders': 'காப்புப்பிரதி நினைவூட்டல்கள்',
    'settings.backupSubtitle': 'புதிய காப்புப்பிரதியை ஏற்றுமதி செய்ய வேண்டிய நேரத்தில் டாஷ்போர்டில் நினைவூட்டல் பேனரைப் பெறுங்கள்.',
    'settings.remindMe': 'நினைவூட்டு', 'settings.off': 'நிறுத்தப்பட்டது', 'settings.every3days': 'ஒவ்வொரு 3 நாட்களும்',
    'settings.weekly': 'வாரந்தோறும்', 'settings.every2weeks': 'ஒவ்வொரு 2 வாரங்களும்', 'settings.monthly': 'மாதந்தோறும்',
    'settings.sampleData': 'மாதிரி தரவு',
    'settings.sampleSubtitle': 'புதியவரா? MyFinances எப்படி செயல்படுகிறது என்று பார்க்க சில மாதிரி பரிவர்த்தனைகளை ஏற்றவும்.',
    'settings.loadSample': 'மாதிரி தரவை ஏற்று',
    'common.cancel': 'ரத்துசெய்', 'common.save': 'பரிவர்த்தனையை சேமி',
    'restore.title': 'காப்புப்பிரதியிலிருந்து மீட்டமைக்கவா?',
    'restore.subtitle': 'இது உங்கள் தற்போதைய தரவை மாற்றும். இந்த சாதனத்தில் இப்போது உள்ளதன் மீட்பு நகல் பயன்பாடு மூடப்படும் வரை வைக்கப்படும்.',
    'restore.confirm': 'எனது தரவை மாற்று', 'restore.accounts': 'கணக்குகள்', 'restore.categories': 'வகைகள்',
    'restore.transactions': 'பரிவர்த்தனைகள்', 'restore.budgets': 'பட்ஜெட்கள்', 'restore.dateRange': 'தேதி வரம்பு',
    'pay.cash': 'பணம்', 'pay.upi': 'UPI', 'pay.card': 'அட்டை', 'pay.bankTransfer': 'வங்கி பரிமாற்றம்', 'pay.other': 'மற்றவை',
    'toast.txnAdded': 'பரிவர்த்தனை சேர்க்கப்பட்டது', 'toast.txnUpdated': 'பரிவர்த்தனை புதுப்பிக்கப்பட்டது',
    'toast.txnDeleted': 'பரிவர்த்தனை நீக்கப்பட்டது',
    'toast.undo': 'செயல்தவிர்', 'toast.fillRequired': 'தேவையான அனைத்து புலங்களையும் நிரப்பவும்',
    'toast.amountInvalid': 'சரியான தொகையை உள்ளிடவும் (அதிகபட்சம் 2 தசம இடங்கள்)',
    'toast.transferSameAccount': 'இருந்து மற்றும் செல்லும் கணக்குகள் வேறுபட்டதாக இருக்க வேண்டும்',
    'toast.needTwoAccounts': 'பரிமாற்றம் செய்ய முதலில் இரண்டாவது கணக்கைச் சேர்க்கவும்',
    'toast.needOneAccount': 'குறைந்தது ஒரு செயலில் உள்ள கணக்கு தேவை',
    'toast.needOneCategory': 'இந்த வகையில் குறைந்தது ஒரு செயலில் உள்ள வகை தேவை',
    'toast.acctAdded': 'கணக்கு சேர்க்கப்பட்டது', 'toast.acctArchived': 'கணக்கு காப்பகப்படுத்தப்பட்டது',
    'toast.acctRestored': 'கணக்கு மீட்டெடுக்கப்பட்டது',
    'toast.catAdded': 'வகை சேர்க்கப்பட்டது', 'toast.catArchived': 'வகை காப்பகப்படுத்தப்பட்டது',
    'toast.catRestored': 'வகை மீட்டெடுக்கப்பட்டது',
    'toast.budgetUpdated': 'பட்ஜெட் புதுப்பிக்கப்பட்டது', 'toast.dataExported': 'தரவு ஏற்றுமதி செய்யப்பட்டது',
    'toast.csvExported': 'CSV ஏற்றுமதி செய்யப்பட்டது',
    'toast.excelExported': 'Excel கோப்பு பதிவிறக்கப்பட்டது', 'toast.excelLoadFailed': 'Excel கோப்பை உருவாக்க முடியவில்லை (முதல் முறை இணைய இணைப்பு தேவை)',
    'toast.noTxnsToExport': 'இன்னும் ஏற்றுமதி செய்ய பரிவர்த்தனைகள் இல்லை', 'toast.dataImported': 'தரவு வெற்றிகரமாக மீட்டமைக்கப்பட்டது',
    'toast.dataCleared': 'அனைத்து தரவும் அழிக்கப்பட்டது', 'toast.sampleLoaded': 'மாதிரி தரவு ஏற்றப்பட்டது',
    'toast.storageBlocked': 'சேமிக்க முடியவில்லை - உங்கள் உலாவி உள்ளூர் சேமிப்பகத்தைத் தடுக்கிறது',
    'toast.invalidBackup': 'இது MyFinances காப்புப்பிரதி கோப்பு போல் தெரியவில்லை',
    'toast.ocrReading': 'ஸ்கிரீன்ஷாட் படிக்கப்படுகிறது… சில நொடிகள் ஆகலாம்',
    'toast.ocrDone': 'முடிந்தவரை கண்டறியப்பட்டது - சேமிக்கும் முன் சரிபார்க்கவும்',
    'toast.ocrNoneFound': 'உறுதியாக எதையும் கண்டறிய முடியவில்லை - கீழே உள்ள உரையைப் பார்க்கவும் அல்லது கைமுறையாக உள்ளிடவும்',
    'toast.ocrLoadFailed': 'ஸ்கிரீன்ஷாட் ரீடரை ஏற்ற முடியவில்லை (முதல் முறை இணைய இணைப்பு தேவை) - கைமுறையாக உள்ளிடவும்',
    'toast.ocrFailed': 'அந்த ஸ்கிரீன்ஷாட்டைப் படிக்க முடியவில்லை - கைமுறையாக உள்ளிடவும்',
  },
};

function i18n(key) {
  const lang = (typeof state !== 'undefined' && state && state.settings && state.settings.language) || 'en';
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
  return dict[key] ?? TRANSLATIONS.en[key] ?? key;
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = i18n(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = i18n(el.dataset.i18nPlaceholder); });
}

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
    showToast(i18n('toast.storageBlocked'));
  }
}

let lockMeta = loadLockMeta();
let encryptionKey = null;
let isLocked = false;
let pendingEncryptedBlob = null;
let autoLockTimer = null;

/* ---------- Money: integer paise, Indian grouping ---------- */
function parseRupeesToPaise(str) {
  const s = String(str).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const parts = s.split('.');
  const rupees = parseInt(parts[0], 10);
  const paiseStr = (parts[1] || '').padEnd(2, '0');
  return rupees * 100 + parseInt(paiseStr, 10);
}

function paiseToRupeesString(paise) {
  const abs = Math.abs(paise || 0);
  const rupees = Math.floor(abs / 100);
  const paisePart = String(abs % 100).padStart(2, '0');
  return `${rupees}.${paisePart}`;
}

function indianGroup(n) {
  const s = String(n);
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${grouped},${last3}`;
}

function formatINR(paise) {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise || 0);
  const rupees = Math.floor(abs / 100);
  const paisePart = String(abs % 100).padStart(2, '0');
  return `${sign}₹${indianGroup(rupees)}.${paisePart}`;
}

/* ---------- State: accounts, categories, transactions, budgets ---------- */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonthKey() {
  return todayStr().slice(0, 7);
}

function seedCategories() {
  return [
    { id: 'salary', name: 'Salary', type: 'income', icon: '💼', color: '#16a34a', archived: false },
    { id: 'freelance', name: 'Freelance', type: 'income', icon: '🧑‍💻', color: '#22c55e', archived: false },
    { id: 'investment', name: 'Investment', type: 'income', icon: '📈', color: '#059669', archived: false },
    { id: 'gift', name: 'Gift', type: 'income', icon: '🎁', color: '#10b981', archived: false },
    { id: 'other_income', name: 'Other Income', type: 'income', icon: '➕', color: '#34d399', archived: false },
    { id: 'food', name: 'Food & Dining', type: 'expense', icon: '🍔', color: '#f97316', archived: false },
    { id: 'rent', name: 'Rent & Housing', type: 'expense', icon: '🏠', color: '#6366f1', archived: false },
    { id: 'utilities', name: 'Utilities', type: 'expense', icon: '💡', color: '#eab308', archived: false },
    { id: 'transportation', name: 'Transportation', type: 'expense', icon: '🚗', color: '#0ea5e9', archived: false },
    { id: 'entertainment', name: 'Entertainment', type: 'expense', icon: '🎬', color: '#ec4899', archived: false },
    { id: 'shopping', name: 'Shopping', type: 'expense', icon: '🛍️', color: '#a855f7', archived: false },
    { id: 'health', name: 'Health & Fitness', type: 'expense', icon: '💊', color: '#ef4444', archived: false },
    { id: 'education', name: 'Education', type: 'expense', icon: '📚', color: '#14b8a6', archived: false },
    { id: 'insurance', name: 'Insurance', type: 'expense', icon: '🛡️', color: '#64748b', archived: false },
    { id: 'other_expense', name: 'Other', type: 'expense', icon: '📦', color: '#9ca3af', archived: false },
  ];
}

function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    accounts: [{ id: 'cash', name: 'Cash', type: 'cash', currency: 'INR', openingBalancePaise: 0, openingDate: todayStr(), archived: false }],
    categories: seedCategories(),
    transactions: [],
    budgets: [],
    settings: {
      theme: 'light',
      language: 'en',
      lastExportAt: null,
      reminderDays: 7,
      reminderSnoozedUntil: null,
    },
  };
}

function normalizeState(parsed) {
  const base = defaultState();
  return {
    schemaVersion: SCHEMA_VERSION,
    accounts: Array.isArray(parsed.accounts) && parsed.accounts.length ? parsed.accounts : base.accounts,
    categories: Array.isArray(parsed.categories) && parsed.categories.length ? parsed.categories : base.categories,
    transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
    budgets: Array.isArray(parsed.budgets) ? parsed.budgets : [],
    settings: Object.assign(base.settings, parsed.settings || {}),
  };
}

// Migrates the old single-account, float-dollar, unversioned schema to v2.
// Never mutates `parsed`; always returns a brand-new state object.
function migrateFromV1(parsed) {
  const oldTxns = Array.isArray(parsed.transactions) ? parsed.transactions : [];
  const oldBudgets = parsed.budgets && typeof parsed.budgets === 'object' && !Array.isArray(parsed.budgets) ? parsed.budgets : {};
  const oldSettings = parsed.settings || {};

  let earliestDate = null;
  oldTxns.forEach((t) => { if (t.date && (!earliestDate || t.date < earliestDate)) earliestDate = t.date; });

  const account = { id: 'cash', name: 'Cash', type: 'cash', currency: 'INR', openingBalancePaise: 0, openingDate: earliestDate || todayStr(), archived: false };
  const categories = seedCategories();
  const validCategoryIds = new Set(categories.map((c) => c.id));

  const transactions = oldTxns.map((t) => {
    const type = t.type === 'income' ? 'income' : 'expense';
    let categoryId = t.category;
    if (!validCategoryIds.has(categoryId)) categoryId = type === 'income' ? 'other_income' : 'other_expense';
    return {
      id: t.id || uid(),
      type,
      amountPaise: Math.max(0, Math.round((Number(t.amount) || 0) * 100)),
      date: t.date || todayStr(),
      accountId: 'cash',
      categoryId,
      paymentMethod: 'cash',
      description: t.description || '',
      notes: t.notes || '',
      receiptImage: t.receiptImage,
      createdAt: t.createdAt || Date.now(),
      updatedAt: t.createdAt || Date.now(),
    };
  });

  const mKey = currentMonthKey();
  const budgets = Object.entries(oldBudgets)
    .filter(([, amt]) => typeof amt === 'number' && amt > 0)
    .map(([catId, amt]) => ({
      id: uid(),
      categoryId: validCategoryIds.has(catId) ? catId : 'other_expense',
      month: mKey,
      limitPaise: Math.round(amt * 100),
    }));

  return {
    schemaVersion: SCHEMA_VERSION,
    accounts: [account],
    categories,
    transactions,
    budgets,
    settings: {
      theme: oldSettings.theme === 'dark' ? 'dark' : 'light',
      language: 'en',
      lastExportAt: oldSettings.lastExportAt || null,
      reminderDays: typeof oldSettings.reminderDays === 'number' ? oldSettings.reminderDays : 7,
      reminderSnoozedUntil: oldSettings.reminderSnoozedUntil || null,
    },
  };
}

function coerceLoadedState(parsed) {
  if (!parsed || parsed.schemaVersion === SCHEMA_VERSION) return normalizeState(parsed || {});
  return migrateFromV1(parsed);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (parsed && parsed.encrypted) {
      pendingEncryptedBlob = { cipher: parsed.cipher, iv: parsed.iv };
      isLocked = true;
      return defaultState();
    }
    if (parsed && parsed.schemaVersion !== SCHEMA_VERSION) {
      // Migrating: keep an untouched copy of the pre-migration data as a safety net.
      try { localStorage.setItem(PRE_V2_BACKUP_KEY, raw); } catch (e) { /* best effort */ }
    }
    return coerceLoadedState(parsed);
  } catch (e) {
    console.error('Failed to load saved data, starting fresh.', e);
    return defaultState();
  }
}

function saveState() {
  // Never let a storage failure propagate out of here: the caller has already
  // updated in-memory `state` and needs to keep going even if persistence fails.
  if (lockMeta.enabled && encryptionKey) {
    encryptWithKey(encryptionKey, state)
      .then((blob) => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ encrypted: true, cipher: blob.cipher, iv: blob.iv }));
      })
      .catch((err) => {
        console.error('Encrypted save failed', err);
        showToast(i18n('toast.storageBlocked'));
      });
  } else {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.error('Save failed', err);
      showToast(i18n('toast.storageBlocked'));
    }
  }
}

let state = loadState();
if (isLocked) {
  const prefs = loadPrefs();
  if (prefs.theme) state.settings.theme = prefs.theme;
}

/* ---------- Helpers ---------- */
function monthKey(dateStr) {
  return dateStr.slice(0, 7);
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}

function accountInfo(id) {
  return state.accounts.find((a) => a.id === id) || { id, name: id || '—', type: 'cash', archived: true };
}

function categoryInfo(id) {
  return state.categories.find((c) => c.id === id) || { id, name: id || '—', type: 'expense', icon: '❓', color: '#9ca3af', archived: true };
}

function paymentMethodLabel(id) {
  const m = PAYMENT_METHODS.find((p) => p.id === id);
  return m ? i18n(m.labelKey) : (id || '');
}

function activeAccounts() {
  return state.accounts.filter((a) => !a.archived);
}

function activeCategories(type) {
  return state.categories.filter((c) => c.type === type && !c.archived);
}

// Balance = opening balance + income - expense + incoming transfers - outgoing transfers,
// computed from transactions rather than an independently editable total.
function accountBalancePaise(accountId) {
  const acct = state.accounts.find((a) => a.id === accountId);
  if (!acct) return 0;
  let paise = acct.openingBalancePaise;
  state.transactions.forEach((t) => {
    if (t.type === 'income' && t.accountId === accountId) paise += t.amountPaise;
    else if (t.type === 'expense' && t.accountId === accountId) paise -= t.amountPaise;
    else if (t.type === 'transfer') {
      if (t.fromAccountId === accountId) paise -= t.amountPaise;
      if (t.toAccountId === accountId) paise += t.amountPaise;
    }
  });
  return paise;
}

function totalBalancePaise() {
  return activeAccounts().reduce((s, a) => s + accountBalancePaise(a.id), 0);
}

function showToast(msg, opts) {
  const toast = document.getElementById('toast');
  const actionBtn = document.getElementById('toastAction');
  document.getElementById('toastMsg').textContent = msg;
  if (opts && opts.actionLabel) {
    actionBtn.textContent = opts.actionLabel;
    actionBtn.hidden = false;
    actionBtn.onclick = () => {
      toast.hidden = true;
      clearTimeout(showToast._t);
      opts.onAction();
    };
  } else {
    actionBtn.hidden = true;
    actionBtn.onclick = null;
  }
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.hidden = true; }, opts && opts.actionLabel ? 5000 : 2200);
}

/* ---------- Full-size receipt photo viewer ---------- */
function openPhotoLightbox(dataUrl) {
  if (!dataUrl) return;
  document.getElementById('photoLightboxImg').src = dataUrl;
  document.getElementById('photoLightbox').hidden = false;
}

function closePhotoLightbox() {
  document.getElementById('photoLightbox').hidden = true;
  document.getElementById('photoLightboxImg').src = '';
}

/* ---------- Navigation ---------- */
const views = ['dashboard', 'transactions', 'budgets', 'settings'];
const viewTitleKeys = { dashboard: 'nav.dashboardTitle', transactions: 'nav.transactionsTitle', budgets: 'nav.budgetsTitle', settings: 'nav.settingsTitle' };

function switchView(view) {
  views.forEach((v) => {
    document.getElementById(`view-${v}`).classList.toggle('active', v === view);
  });
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  document.getElementById('viewTitle').textContent = i18n(viewTitleKeys[view]);
  renderBackupReminder();
  if (view === 'dashboard') renderDashboard();
  if (view === 'transactions') { populateAccountFilter(); populateCategoryFilter(); renderTransactionsView(); }
  if (view === 'budgets') renderBudgetsView();
  if (view === 'settings') { renderAccountManageList(); renderCategoryManageList(); populateExcelPeriodValueSelect(); }
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
  state.settings.reminderSnoozedUntil = Date.now() + 2 * 86400000;
  saveState();
  renderBackupReminder();
  showToast("We'll remind you again in a couple of days");
}

/* ---------- Dashboard rendering ---------- */
// { type: 'month', value: 'YYYY-MM' } or { type: 'year', value: 'YYYY' } — drives the
// stat cards and category chart so each month or year can be viewed separately.
let dashboardPeriod = { type: 'month', value: currentMonthKey() };

function transactionsInPeriod(txns, period) {
  return txns.filter((t) => (period.type === 'month' ? monthKey(t.date) === period.value : t.date.slice(0, 4) === period.value));
}

function renderDashboard() {
  populateDashboardPeriodSelect();
  renderStatCards();
  renderAccountBalances();
  renderCategoryChart();
  renderTrendChart();
  renderRecentTransactions();
}

function populateDashboardPeriodSelect() {
  const select = document.getElementById('dashPeriodValue');
  let options, defaultValue;
  if (dashboardPeriod.type === 'month') {
    const months = Array.from(new Set(state.transactions.map((t) => monthKey(t.date)))).sort().reverse();
    if (!months.includes(currentMonthKey())) months.unshift(currentMonthKey());
    options = months.map((m) => ({ value: m, label: monthLabel(m) }));
    defaultValue = currentMonthKey();
  } else {
    const years = Array.from(new Set(state.transactions.map((t) => t.date.slice(0, 4)))).sort().reverse();
    const curYear = String(new Date().getFullYear());
    if (!years.includes(curYear)) years.unshift(curYear);
    options = years.map((y) => ({ value: y, label: y }));
    defaultValue = curYear;
  }
  select.innerHTML = options.map((o) => `<option value="${o.value}">${escapeHTML(o.label)}</option>`).join('');
  if (!options.some((o) => o.value === dashboardPeriod.value)) dashboardPeriod.value = defaultValue;
  select.value = dashboardPeriod.value;
}

function renderStatCards() {
  const periodTxns = transactionsInPeriod(state.transactions, dashboardPeriod);
  const periodIncome = periodTxns.filter((t) => t.type === 'income');
  const salaryP = periodIncome.filter((t) => t.categoryId === 'salary').reduce((s, t) => s + t.amountPaise, 0);
  const otherIncomeP = periodIncome.filter((t) => t.categoryId !== 'salary').reduce((s, t) => s + t.amountPaise, 0);
  const incomeP = salaryP + otherIncomeP;
  const expenseP = periodTxns.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amountPaise, 0);
  const totalP = totalBalancePaise();
  const savingsRate = incomeP > 0 ? Math.round(((incomeP - expenseP) / incomeP) * 100) : 0;

  document.getElementById('statBalance').textContent = formatINR(totalP);
  document.getElementById('statSalary').textContent = formatINR(salaryP);
  document.getElementById('statOtherIncome').textContent = formatINR(otherIncomeP);
  document.getElementById('statExpense').textContent = formatINR(expenseP);
  document.getElementById('statSavingsRate').textContent = `${savingsRate}%`;
}

function renderAccountBalances() {
  const container = document.getElementById('accountBalanceList');
  const accounts = activeAccounts();
  if (accounts.length === 0) {
    container.innerHTML = `<p class="empty-state">${escapeHTML(i18n('settings.accountsSubtitle'))}</p>`;
    return;
  }
  container.innerHTML = accounts.map((a) => `
    <div class="account-balance-row">
      <span><span class="acct-name">${escapeHTML(a.name)}</span><span class="acct-type">${a.type === 'cash' ? i18n('settings.cash') : i18n('settings.bank')}</span></span>
      <span class="acct-balance">${formatINR(accountBalancePaise(a.id))}</span>
    </div>`).join('');
}

/* ---------- Canvas: category pie chart (expenses only; transfers excluded) ---------- */
function renderCategoryChart() {
  const canvas = document.getElementById('categoryChart');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const expenses = transactionsInPeriod(state.transactions.filter((t) => t.type === 'expense'), dashboardPeriod);
  const totals = {};
  expenses.forEach((t) => { totals[t.categoryId] = (totals[t.categoryId] || 0) + t.amountPaise; });
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const legend = document.getElementById('chartLegend');

  if (entries.length === 0) {
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-muted');
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(dashboardPeriod.type === 'month' ? 'No expenses this month' : 'No expenses this year', canvas.width / 2, canvas.height / 2);
    legend.innerHTML = '';
    return;
  }

  const total = entries.reduce((s, [, v]) => s + v, 0);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const radius = Math.min(cx, cy) - 20;
  let startAngle = -Math.PI / 2;

  entries.forEach(([catId, val]) => {
    const info = categoryInfo(catId);
    const sliceAngle = (val / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, startAngle + sliceAngle);
    ctx.closePath();
    ctx.fillStyle = info.color;
    ctx.fill();
    startAngle += sliceAngle;
  });

  const bg = getComputedStyle(document.body).getPropertyValue('--surface').trim() || '#fff';
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();

  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text');
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(formatINR(total), cx, cy);

  legend.innerHTML = entries.map(([catId, val]) => {
    const info = categoryInfo(catId);
    const pct = ((val / total) * 100).toFixed(1);
    return `<li>
      <span class="legend-name"><span class="swatch" style="background:${info.color}"></span>${info.icon} ${escapeHTML(info.name)}</span>
      <span>${formatINR(val)} (${pct}%)</span>
    </li>`;
  }).join('');
}

/* ---------- Canvas: monthly trend (last 6 months; transfers excluded) ---------- */
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
      income: txns.filter((t) => t.type === 'income').reduce((s, t) => s + t.amountPaise, 0),
      expense: txns.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amountPaise, 0),
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

function receiptMarkerHTML(t) {
  return t.receiptImage ? `<button type="button" class="receipt-marker" data-photo="${t.receiptImage}" title="View receipt photo">📎</button>` : '';
}

function txnRowHTML(t) {
  let metaLine, sign, amtClass;
  if (t.type === 'transfer') {
    const fromA = accountInfo(t.fromAccountId);
    const toA = accountInfo(t.toAccountId);
    metaLine = `${escapeHTML(fromA.name)} → ${escapeHTML(toA.name)} · ${formatDate(t.date)}`;
    sign = '';
    amtClass = 'transfer';
  } else {
    const info = categoryInfo(t.categoryId);
    const acct = accountInfo(t.accountId);
    metaLine = `${info.icon} ${escapeHTML(info.name)} · ${escapeHTML(acct.name)} · ${formatDate(t.date)}${t.upiId ? ` · ${escapeHTML(t.upiId)}` : ''}`;
    sign = t.type === 'income' ? '+' : '−';
    amtClass = t.type;
  }
  return `<div class="txn-row" data-id="${t.id}">
    <div class="txn-info">
      <span class="txn-desc">${escapeHTML(t.description)}${receiptMarkerHTML(t)}</span>
      <span class="txn-meta">${metaLine}</span>
    </div>
    <div class="txn-amount ${amtClass}">${sign} ${formatINR(t.amountPaise)}</div>
  </div>`;
}

/* ---------- Transactions view (full table) ---------- */
function populateAccountFilter() {
  const select = document.getElementById('filterAccount');
  const prevValue = select.value;
  const options = [`<option value="all">${escapeHTML(i18n('txn.allAccounts'))}</option>`]
    .concat(state.accounts.map((a) => `<option value="${a.id}">${escapeHTML(a.name)}${a.archived ? ' (archived)' : ''}</option>`));
  select.innerHTML = options.join('');
  select.value = [...select.options].some((o) => o.value === prevValue) ? prevValue : 'all';
}

function populateCategoryFilter() {
  const select = document.getElementById('filterCategory');
  const prevValue = select.value;
  const income = state.categories.filter((c) => c.type === 'income');
  const expense = state.categories.filter((c) => c.type === 'expense');
  const options = [`<option value="all">${escapeHTML(i18n('txn.allCategories'))}</option>`];
  options.push(`<optgroup label="${escapeHTML(i18n('txn.income'))}">`);
  income.forEach((c) => options.push(`<option value="${c.id}">${c.icon} ${escapeHTML(c.name)}${c.archived ? ' (archived)' : ''}</option>`));
  options.push(`</optgroup><optgroup label="${escapeHTML(i18n('txn.expense'))}">`);
  expense.forEach((c) => options.push(`<option value="${c.id}">${c.icon} ${escapeHTML(c.name)}${c.archived ? ' (archived)' : ''}</option>`));
  options.push('</optgroup>');
  select.innerHTML = options.join('');
  select.value = [...select.options].some((o) => o.value === prevValue) ? prevValue : 'all';
}

function getFilteredTransactions() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const type = document.getElementById('filterType').value;
  const account = document.getElementById('filterAccount').value;
  const category = document.getElementById('filterCategory').value;
  const month = document.getElementById('filterMonth').value;

  return state.transactions
    .filter((t) => (search ? t.description.toLowerCase().includes(search) : true))
    .filter((t) => (type === 'all' ? true : t.type === type))
    .filter((t) => (account === 'all' ? true : (t.accountId === account || t.fromAccountId === account || t.toAccountId === account)))
    .filter((t) => (category === 'all' ? true : t.categoryId === category))
    .filter((t) => (month ? monthKey(t.date) === month : true))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

function renderTransactionsView() {
  const tbody = document.getElementById('txnTableBody');
  const list = getFilteredTransactions();
  const emptyState = document.getElementById('emptyState');

  emptyState.hidden = list.length !== 0;
  tbody.innerHTML = list.map((t) => {
    let categoryCell, accountCell, sign, amtClass, typeLabel;
    if (t.type === 'transfer') {
      categoryCell = '—';
      accountCell = `${escapeHTML(accountInfo(t.fromAccountId).name)} → ${escapeHTML(accountInfo(t.toAccountId).name)}`;
      sign = '';
      amtClass = 'transfer';
      typeLabel = i18n('txn.transfer');
    } else {
      const info = categoryInfo(t.categoryId);
      categoryCell = `<span class="cat-badge" style="color:${info.color};background:${info.color}26;">${info.icon} ${escapeHTML(info.name)}</span>`;
      accountCell = escapeHTML(accountInfo(t.accountId).name);
      sign = t.type === 'income' ? '+' : '−';
      amtClass = t.type;
      typeLabel = t.type === 'income' ? i18n('txn.income') : i18n('txn.expense');
    }
    return `<tr data-id="${t.id}">
      <td>${formatDate(t.date)}</td>
      <td>${escapeHTML(t.description)}${receiptMarkerHTML(t)}${t.upiId ? `<div class="txn-meta">${escapeHTML(t.upiId)}</div>` : ''}${t.notes ? `<div class="txn-meta">${escapeHTML(t.notes)}</div>` : ''}</td>
      <td>${accountCell}</td>
      <td>${categoryCell}</td>
      <td>${typeLabel}</td>
      <td class="right txn-amount ${amtClass}">${sign} ${formatINR(t.amountPaise)}</td>
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
      const idx = state.transactions.findIndex((t) => t.id === id);
      if (idx === -1) return;
      const [removed] = state.transactions.splice(idx, 1);
      saveState();
      refreshCurrentView();
      showToast(i18n('toast.txnDeleted'), {
        actionLabel: i18n('toast.undo'),
        onAction: () => {
          state.transactions.splice(idx, 0, removed);
          saveState();
          refreshCurrentView();
        },
      });
    });
  });
  container.querySelectorAll('.txn-row').forEach((row) => {
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => {
      const id = row.dataset.id;
      openTransactionModal(state.transactions.find((t) => t.id === id));
    });
  });
  container.querySelectorAll('.receipt-marker').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openPhotoLightbox(el.dataset.photo);
    });
  });
}

/* ---------- Budgets view (one limit per category per month) ---------- */
function populateBudgetMonthSelect() {
  const select = document.getElementById('budgetMonthSelect');
  const months = Array.from(new Set(state.transactions.map((t) => monthKey(t.date)))).sort().reverse();
  if (!months.includes(currentMonthKey())) months.unshift(currentMonthKey());
  const prevValue = select.value;
  select.innerHTML = months.map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join('');
  select.value = months.includes(prevValue) ? prevValue : currentMonthKey();
}

function findBudget(categoryId, month) {
  return state.budgets.find((b) => b.categoryId === categoryId && b.month === month);
}

function renderBudgetsView() {
  populateBudgetMonthSelect();
  const container = document.getElementById('budgetList');
  const mKey = document.getElementById('budgetMonthSelect').value || currentMonthKey();
  const spentByCategory = {};
  state.transactions
    .filter((t) => t.type === 'expense' && monthKey(t.date) === mKey)
    .forEach((t) => { spentByCategory[t.categoryId] = (spentByCategory[t.categoryId] || 0) + t.amountPaise; });

  const cats = activeCategories('expense');
  container.innerHTML = cats.map((cat) => {
    const spentP = spentByCategory[cat.id] || 0;
    const budget = findBudget(cat.id, mKey);
    const limitP = budget ? budget.limitPaise : 0;
    const hasBudget = !!budget;
    const pct = limitP > 0 ? Math.min(100, Math.round((spentP / limitP) * 100)) : 0;
    const barClass = limitP > 0 && spentP > limitP ? 'over' : (pct >= 80 ? 'warn' : '');
    const statusLine = !hasBudget
      ? `<div class="muted">${i18n('budget.noBudget')}</div>`
      : (limitP > 0 && spentP > limitP ? `<div class="muted" style="color:var(--expense)">${i18n('budget.overBy')} ${formatINR(spentP - limitP)}</div>` : '');
    return `<div class="budget-item" data-cat="${cat.id}">
      <div class="budget-item-top">
        <span class="cat">${cat.icon} ${escapeHTML(cat.name)}</span>
        <span>
          ${formatINR(spentP)} /
          <input type="text" inputmode="decimal" class="budget-input" placeholder="${escapeHTML(i18n('budget.noBudget'))}" value="${hasBudget ? paiseToRupeesString(limitP) : ''}" data-cat="${cat.id}" />
        </span>
      </div>
      <div class="budget-bar-track"><div class="budget-bar-fill ${barClass}" style="width:${hasBudget ? pct : 0}%"></div></div>
      ${statusLine}
    </div>`;
  }).join('');

  container.querySelectorAll('.budget-input').forEach((input) => {
    input.addEventListener('change', (e) => {
      const catId = e.target.dataset.cat;
      const raw = e.target.value.trim();
      const existing = findBudget(catId, mKey);
      if (!raw) {
        if (existing) state.budgets = state.budgets.filter((b) => b !== existing);
      } else {
        const paise = parseRupeesToPaise(raw);
        if (paise === null || paise <= 0) {
          showToast(i18n('toast.amountInvalid'));
          renderBudgetsView();
          return;
        }
        if (existing) existing.limitPaise = paise;
        else state.budgets.push({ id: uid(), categoryId: catId, month: mKey, limitPaise: paise });
      }
      saveState();
      renderBudgetsView();
      showToast(i18n('toast.budgetUpdated'));
    });
  });
}

/* ---------- Modal: add/edit transaction ---------- */
let currentTxnType = 'expense';

function populateAccountSelects(txn) {
  const referenced = [];
  if (txn) ['accountId', 'fromAccountId', 'toAccountId'].forEach((k) => { if (txn[k]) referenced.push(txn[k]); });
  const byId = new Map();
  activeAccounts().forEach((a) => byId.set(a.id, a));
  referenced.forEach((id) => { if (!byId.has(id)) { const a = state.accounts.find((x) => x.id === id); if (a) byId.set(id, a); } });
  const accounts = [...byId.values()];
  const opts = accounts.map((a) => `<option value="${a.id}">${escapeHTML(a.name)}${a.archived ? ' (archived)' : ''}</option>`).join('');
  ['txnAccount', 'txnFromAccount', 'txnToAccount'].forEach((id) => { document.getElementById(id).innerHTML = opts; });
}

function populatePaymentMethodSelect() {
  const select = document.getElementById('txnPaymentMethod');
  select.innerHTML = PAYMENT_METHODS.map((p) => `<option value="${p.id}">${escapeHTML(i18n(p.labelKey))}</option>`).join('');
}

function updateUpiIdRowVisibility() {
  const method = document.getElementById('txnPaymentMethod').value;
  document.getElementById('txnUpiIdRow').hidden = method !== 'upi';
}

function populateCategorySelect(type, includeCategoryId) {
  let cats = activeCategories(type);
  if (includeCategoryId && !cats.find((c) => c.id === includeCategoryId)) {
    const c = state.categories.find((x) => x.id === includeCategoryId);
    if (c) cats = [c, ...cats];
  }
  const select = document.getElementById('txnCategory');
  select.innerHTML = cats.map((c) => `<option value="${c.id}" style="color:${c.color};">${c.icon} ${escapeHTML(c.name)}</option>`).join('');
  updateCategoryColorDot();
}

function updateCategoryColorDot() {
  const dot = document.getElementById('categoryColorDot');
  if (!dot) return;
  const info = categoryInfo(document.getElementById('txnCategory').value);
  dot.style.background = info.color;
}

function setTypeButtons(type, includeCategoryId) {
  currentTxnType = type;
  document.getElementById('typeExpenseBtn').classList.toggle('active', type === 'expense');
  document.getElementById('typeIncomeBtn').classList.toggle('active', type === 'income');
  document.getElementById('typeTransferBtn').classList.toggle('active', type === 'transfer');
  const isTransfer = type === 'transfer';
  document.getElementById('txnAccountRow').hidden = isTransfer;
  document.getElementById('txnCategoryRow').hidden = isTransfer;
  document.getElementById('txnPaymentMethodRow').hidden = isTransfer;
  document.getElementById('txnTransferRow').hidden = !isTransfer;
  document.getElementById('txnAccount').required = !isTransfer;
  document.getElementById('txnCategory').required = !isTransfer;
  if (!isTransfer) populateCategorySelect(type, includeCategoryId);
}

function openTransactionModal(txn) {
  const overlay = document.getElementById('modalOverlay');
  const form = document.getElementById('txnForm');
  form.reset();

  populateAccountSelects(txn);
  populatePaymentMethodSelect();

  const type = txn ? txn.type : 'expense';
  setTypeButtons(type, txn ? txn.categoryId : null);

  document.getElementById('modalTitle').textContent = txn ? i18n('txn.editTitle') : i18n('txn.add');
  document.getElementById('txnId').value = txn ? txn.id : '';
  document.getElementById('txnDescription').value = txn ? txn.description : '';
  document.getElementById('txnAmount').value = txn ? paiseToRupeesString(txn.amountPaise) : '';
  document.getElementById('txnDate').value = txn ? txn.date : todayStr();
  document.getElementById('txnNotes').value = txn ? (txn.notes || '') : '';
  document.getElementById('txnAmountError').hidden = true;

  document.getElementById('txnUpiId').value = txn ? (txn.upiId || '') : '';

  if (txn && txn.type === 'transfer') {
    document.getElementById('txnFromAccount').value = txn.fromAccountId;
    document.getElementById('txnToAccount').value = txn.toAccountId;
  } else if (txn) {
    document.getElementById('txnAccount').value = txn.accountId;
    document.getElementById('txnCategory').value = txn.categoryId;
    document.getElementById('txnPaymentMethod').value = txn.paymentMethod || 'cash';
  } else {
    const firstAcct = activeAccounts()[0];
    if (firstAcct) document.getElementById('txnAccount').value = firstAcct.id;
    document.getElementById('txnPaymentMethod').value = 'cash';
  }
  updateCategoryColorDot();
  updateUpiIdRowVisibility();

  pendingReceiptImage = txn && txn.receiptImage ? txn.receiptImage : null;
  ocrRawText = '';
  document.getElementById('ocrTextDetails').hidden = true;
  document.getElementById('receiptStatus').hidden = true;
  renderReceiptPreview();

  overlay.hidden = false;
  document.getElementById('txnDescription').focus();
}

function closeTransactionModal() {
  if (dictationRecognition) dictationRecognition.stop();
  document.getElementById('modalOverlay').hidden = true;
}

function handleTransactionSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('txnId').value;
  const description = document.getElementById('txnDescription').value.trim();
  const amountStr = document.getElementById('txnAmount').value.trim();
  const amountPaise = parseRupeesToPaise(amountStr);
  const date = document.getElementById('txnDate').value;
  const notes = document.getElementById('txnNotes').value.trim();
  const errEl = document.getElementById('txnAmountError');

  if (amountPaise === null || amountPaise <= 0) {
    errEl.hidden = false;
    showToast(i18n('toast.amountInvalid'));
    return;
  }
  errEl.hidden = true;

  if (!description || !date) {
    showToast(i18n('toast.fillRequired'));
    return;
  }

  let extra;
  if (currentTxnType === 'transfer') {
    const fromAccountId = document.getElementById('txnFromAccount').value;
    const toAccountId = document.getElementById('txnToAccount').value;
    if (!fromAccountId || !toAccountId) { showToast(i18n('toast.fillRequired')); return; }
    if (fromAccountId === toAccountId) { showToast(i18n('toast.transferSameAccount')); return; }
    extra = { fromAccountId, toAccountId };
  } else {
    const accountId = document.getElementById('txnAccount').value;
    const categoryId = document.getElementById('txnCategory').value;
    const paymentMethod = document.getElementById('txnPaymentMethod').value;
    if (!accountId || !categoryId) { showToast(i18n('toast.fillRequired')); return; }
    extra = { accountId, categoryId, paymentMethod };
    if (paymentMethod === 'upi') {
      const upiId = document.getElementById('txnUpiId').value.trim();
      if (upiId) extra.upiId = upiId;
    }
  }

  const now = Date.now();
  if (id) {
    const txn = state.transactions.find((t) => t.id === id);
    delete txn.accountId; delete txn.categoryId; delete txn.paymentMethod; delete txn.upiId;
    delete txn.fromAccountId; delete txn.toAccountId;
    Object.assign(txn, { type: currentTxnType, description, amountPaise, date, notes, updatedAt: now }, extra);
    if (pendingReceiptImage) txn.receiptImage = pendingReceiptImage;
    else delete txn.receiptImage;
    showToast(i18n('toast.txnUpdated'));
  } else {
    const newTxn = Object.assign({ id: uid(), type: currentTxnType, description, amountPaise, date, notes, createdAt: now, updatedAt: now }, extra);
    if (pendingReceiptImage) newTxn.receiptImage = pendingReceiptImage;
    state.transactions.push(newTxn);
    showToast(i18n('toast.txnAdded'));
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

/* ---------- Receipt photo: attach a photo to a transaction ---------- */
let pendingReceiptImage = null;

function compressImageFile(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Could not decode image'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function renderReceiptPreview() {
  const preview = document.getElementById('receiptPreview');
  const thumb = document.getElementById('receiptThumb');
  const attachBtn = document.getElementById('receiptAttachBtn');
  const scanBtn = document.getElementById('receiptScanBtn');
  if (pendingReceiptImage) {
    thumb.src = pendingReceiptImage;
    preview.hidden = false;
    attachBtn.textContent = '📷 Replace photo';
    scanBtn.hidden = false;
  } else {
    preview.hidden = true;
    attachBtn.textContent = '📷 Add receipt photo';
    scanBtn.hidden = true;
  }
}

async function handleReceiptFileSelected(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('Please choose an image file');
    return;
  }
  try {
    pendingReceiptImage = await compressImageFile(file, 900, 0.72);
    ocrRawText = '';
    document.getElementById('ocrTextDetails').hidden = true;
    document.getElementById('receiptStatus').hidden = true;
    renderReceiptPreview();
  } catch (err) {
    console.error('Receipt compress failed', err);
    showToast("Couldn't read that photo");
  }
}

function removeReceiptPhoto() {
  pendingReceiptImage = null;
  ocrRawText = '';
  document.getElementById('ocrTextDetails').hidden = true;
  document.getElementById('receiptStatus').hidden = true;
  renderReceiptPreview();
}

/* ---------- UPI screenshot: in-browser OCR (Tesseract.js), fully offline after first load ---------- */
let ocrRawText = '';
let tesseractLoadPromise = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractLoadPromise) return tesseractLoadPromise;
  tesseractLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    script.onload = () => { window.Tesseract ? resolve(window.Tesseract) : reject(new Error('Tesseract did not load')); };
    script.onerror = () => reject(new Error('Could not load the screenshot reader script'));
    document.head.appendChild(script);
  });
  return tesseractLoadPromise;
}

// Common UPI payment-service-provider handles, used only to prefer a higher-confidence
// match when a screenshot's OCR text contains more than one name@handle-looking token.
const UPI_HANDLES = ['ybl', 'okhdfcbank', 'okicici', 'oksbi', 'okaxis', 'paytm', 'ibl', 'axl', 'apl', 'sbi', 'icici', 'hdfcbank', 'axisbank', 'idfcbank', 'upi', 'yesbank', 'kotak'];

function extractUpiFields(text) {
  const result = { upiId: null, amount: null, description: null };

  const vpaCandidates = text.match(/\b[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}\b/g) || [];
  const preferred = vpaCandidates.find((v) => UPI_HANDLES.some((h) => v.toLowerCase().endsWith('@' + h)));
  if (preferred) result.upiId = preferred;
  else if (vpaCandidates.length) result.upiId = vpaCandidates[0];

  const amountMatch = text.match(/(?:₹|Rs\.?|INR)\s?([\d,]+(?:\.\d{1,2})?)/i);
  if (amountMatch) {
    const cleaned = amountMatch[1].replace(/,/g, '');
    if (/^\d+(\.\d{1,2})?$/.test(cleaned)) result.amount = cleaned;
  }

  const nameMatch = text.match(/(?:Paid to|Payment to|Sent to|Received from|Paid by|From)\s*[:\-]?\s*([A-Za-z][A-Za-z .]{2,40})/i);
  if (nameMatch) result.description = nameMatch[1].trim();

  return result;
}

async function scanUpiScreenshot() {
  if (!pendingReceiptImage) return;
  const statusEl = document.getElementById('receiptStatus');
  const scanBtn = document.getElementById('receiptScanBtn');
  statusEl.hidden = false;
  statusEl.textContent = i18n('toast.ocrReading');
  scanBtn.disabled = true;

  try {
    const Tesseract = await loadTesseract().catch(() => { throw { ocrLoadFailed: true }; });
    const { data } = await Tesseract.recognize(pendingReceiptImage, 'eng');
    ocrRawText = data.text || '';
    document.getElementById('ocrTextRaw').textContent = ocrRawText || '(no text detected)';
    document.getElementById('ocrTextDetails').hidden = false;

    const fields = extractUpiFields(ocrRawText);
    let foundAny = false;
    if (fields.upiId) { document.getElementById('txnUpiId').value = fields.upiId; foundAny = true; }
    if (fields.amount) { document.getElementById('txnAmount').value = fields.amount; foundAny = true; }
    if (fields.description) { document.getElementById('txnDescription').value = fields.description.slice(0, 80); foundAny = true; }
    if (fields.upiId && document.getElementById('txnPaymentMethod').value !== 'upi') {
      document.getElementById('txnPaymentMethod').value = 'upi';
      updateUpiIdRowVisibility();
    }

    statusEl.hidden = true;
    showToast(foundAny ? i18n('toast.ocrDone') : i18n('toast.ocrNoneFound'));
  } catch (e) {
    console.error('UPI screenshot scan failed', e);
    statusEl.hidden = true;
    showToast(e && e.ocrLoadFailed ? i18n('toast.ocrLoadFailed') : i18n('toast.ocrFailed'));
  } finally {
    scanBtn.disabled = false;
  }
}

/* ---------- Accounts management (Settings) ---------- */
function renderAccountManageList() {
  const container = document.getElementById('accountList');
  if (!container) return;
  container.innerHTML = state.accounts.map((a) => `
    <div class="manage-row ${a.archived ? 'archived' : ''}" data-id="${a.id}">
      <span>
        <span class="manage-name">${escapeHTML(a.name)}</span><br/>
        <span class="manage-meta">${a.type === 'cash' ? i18n('settings.cash') : i18n('settings.bank')} · ${formatINR(accountBalancePaise(a.id))}${a.archived ? ' · archived' : ''}</span>
      </span>
      <span class="manage-actions">
        <button type="button" data-action="${a.archived ? 'unarchive' : 'archive'}">${a.archived ? '↩' : '🗄'}</button>
      </span>
    </div>`).join('');

  container.querySelectorAll('[data-action="archive"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = e.target.closest('[data-id]').dataset.id;
      if (activeAccounts().length <= 1) { showToast(i18n('toast.needOneAccount')); return; }
      const acct = state.accounts.find((a) => a.id === id);
      if (!acct) return;
      acct.archived = true;
      saveState();
      renderAccountManageList();
      populateAccountFilter();
      showToast(i18n('toast.acctArchived'));
    });
  });
  container.querySelectorAll('[data-action="unarchive"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = e.target.closest('[data-id]').dataset.id;
      const acct = state.accounts.find((a) => a.id === id);
      if (!acct) return;
      acct.archived = false;
      saveState();
      renderAccountManageList();
      populateAccountFilter();
      showToast(i18n('toast.acctRestored'));
    });
  });
}

function handleAddAccountSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('newAccountName').value.trim();
  const type = document.getElementById('newAccountType').value;
  const openingStr = document.getElementById('newAccountOpeningBalance').value.trim();
  if (!name) { showToast(i18n('toast.fillRequired')); return; }
  let openingBalancePaise = 0;
  if (openingStr) {
    const parsed = parseRupeesToPaise(openingStr);
    if (parsed === null) { showToast(i18n('toast.amountInvalid')); return; }
    openingBalancePaise = parsed;
  }
  state.accounts.push({ id: uid(), name, type, currency: 'INR', openingBalancePaise, openingDate: todayStr(), archived: false });
  saveState();
  document.getElementById('addAccountForm').reset();
  renderAccountManageList();
  populateAccountFilter();
  showToast(i18n('toast.acctAdded'));
}

/* ---------- Categories management (Settings) ---------- */
function renderCategoryManageList() {
  const container = document.getElementById('categoryList');
  if (!container) return;
  container.innerHTML = state.categories.map((c) => `
    <div class="manage-row ${c.archived ? 'archived' : ''}" data-id="${c.id}">
      <span>
        <span class="manage-name">${c.icon} ${escapeHTML(c.name)}</span><br/>
        <span class="manage-meta">${c.type === 'income' ? i18n('txn.income') : i18n('txn.expense')}${c.archived ? ' · archived' : ''}</span>
      </span>
      <span class="manage-actions">
        <button type="button" data-action="${c.archived ? 'unarchive' : 'archive'}">${c.archived ? '↩' : '🗄'}</button>
      </span>
    </div>`).join('');

  container.querySelectorAll('[data-action="archive"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = e.target.closest('[data-id]').dataset.id;
      const cat = state.categories.find((c) => c.id === id);
      if (!cat) return;
      const sameTypeActive = state.categories.filter((c) => c.type === cat.type && !c.archived);
      if (sameTypeActive.length <= 1) { showToast(i18n('toast.needOneCategory')); return; }
      cat.archived = true;
      saveState();
      renderCategoryManageList();
      populateCategoryFilter();
      showToast(i18n('toast.catArchived'));
    });
  });
  container.querySelectorAll('[data-action="unarchive"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = e.target.closest('[data-id]').dataset.id;
      const cat = state.categories.find((c) => c.id === id);
      if (!cat) return;
      cat.archived = false;
      saveState();
      renderCategoryManageList();
      populateCategoryFilter();
      showToast(i18n('toast.catRestored'));
    });
  });
}

function handleAddCategorySubmit(e) {
  e.preventDefault();
  const name = document.getElementById('newCategoryName').value.trim();
  const type = document.getElementById('newCategoryType').value;
  if (!name) { showToast(i18n('toast.fillRequired')); return; }
  const palette = ['#6366f1', '#0ea5e9', '#14b8a6', '#84cc16', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444'];
  const color = palette[state.categories.length % palette.length];
  state.categories.push({ id: uid(), name, type, icon: type === 'income' ? '➕' : '🏷️', color, archived: false });
  saveState();
  document.getElementById('addCategoryForm').reset();
  renderCategoryManageList();
  populateCategoryFilter();
  showToast(i18n('toast.catAdded'));
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
  if (!pin) return;

  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const saltB64 = bufToB64(saltBytes.buffer);
  const key = await deriveKeyFromPin(pin, saltB64);
  const check = await encryptWithKey(key, { v: LOCK_CHECK_PLAINTEXT });

  lockMeta = { enabled: true, salt: saltB64, checkCipher: check.cipher, checkIv: check.iv, autoLockMinutes: 5 };
  saveLockMeta(lockMeta);
  encryptionKey = key;
  saveState();
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
  if (!pin) return;

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
  saveState();
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

    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const blob = raw.encrypted ? raw : pendingEncryptedBlob;
    state = blob ? coerceLoadedState(await decryptWithKey(key, blob.cipher, blob.iv)) : defaultState();

    encryptionKey = key;
    isLocked = false;
    pendingEncryptedBlob = null;
    document.getElementById('lockScreen').hidden = true;
    document.getElementById('lockPinInput').value = '';
    applyTheme(state.settings.theme);
    document.getElementById('languageSelect').value = state.settings.language;
    applyTranslations();
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
  localStorage.removeItem(PRE_V2_BACKUP_KEY);
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
  if (on) btn.closest('details.settings-panel').open = true;
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
    dictationRecognition.stop();
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

/* ---------- Export / Import / Restore / Reset / Sample data ---------- */
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
  showToast(i18n('toast.dataExported'));
}

function csvEscape(value) {
  const str = String(value == null ? '' : value);
  if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

// Guards free-text fields against spreadsheet formula injection (a cell
// starting with = + - @ can execute as a formula when opened in a
// spreadsheet app), then applies normal CSV quoting.
function csvSafeText(value) {
  let str = String(value == null ? '' : value);
  if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
  return csvEscape(str);
}

function buildCsv() {
  const header = ['Date', 'Type', 'Account', 'From Account', 'To Account', 'Category', 'Payment Method', 'UPI ID', 'Description', 'Amount (INR)', 'Notes'];
  const rows = [...state.transactions]
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
    .map((t) => {
      if (t.type === 'transfer') {
        return [
          csvEscape(t.date), csvEscape('Transfer'), csvEscape(''),
          csvSafeText(accountInfo(t.fromAccountId).name), csvSafeText(accountInfo(t.toAccountId).name),
          csvEscape(''), csvEscape(''), csvEscape(''), csvSafeText(t.description), csvEscape((t.amountPaise / 100).toFixed(2)), csvSafeText(t.notes || ''),
        ].join(',');
      }
      const info = categoryInfo(t.categoryId);
      const signedRupees = (t.type === 'income' ? t.amountPaise : -t.amountPaise) / 100;
      return [
        csvEscape(t.date), csvEscape(t.type === 'income' ? 'Income' : 'Expense'), csvSafeText(accountInfo(t.accountId).name),
        csvEscape(''), csvEscape(''), csvSafeText(info.name), csvEscape(paymentMethodLabel(t.paymentMethod)),
        csvSafeText(t.upiId || ''), csvSafeText(t.description), csvEscape(signedRupees.toFixed(2)), csvSafeText(t.notes || ''),
      ].join(',');
    });
  const headerRow = header.map(csvEscape).join(',');
  return [headerRow, ...rows].join('\r\n');
}

function exportCsvData() {
  if (state.transactions.length === 0) {
    showToast(i18n('toast.noTxnsToExport'));
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
  showToast(i18n('toast.csvExported'));
}

/* ---------- Export as Excel, scoped to a week/month/year/all time ---------- */
function weekStartDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay(); // 0 = Sunday .. 6 = Saturday
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day)); // Monday-anchored week
  return d.toISOString().slice(0, 10);
}

function weekKey(dateStr) {
  return weekStartDate(dateStr);
}

function weekLabel(weekStartStr) {
  const start = new Date(weekStartStr + 'T00:00:00');
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const sameYear = start.getFullYear() === end.getFullYear();
  const fmtShort = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const fmtWithYear = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const startStr = sameYear ? fmtShort(start) : fmtWithYear(start);
  const endStr = sameYear ? `${fmtShort(end)}, ${end.getFullYear()}` : fmtWithYear(end);
  return `${startStr} – ${endStr}`;
}

function transactionsInExportPeriod(txns, period) {
  if (period.type === 'all') return txns;
  if (period.type === 'week') return txns.filter((t) => weekKey(t.date) === period.value);
  if (period.type === 'year') return txns.filter((t) => t.date.slice(0, 4) === period.value);
  return txns.filter((t) => monthKey(t.date) === period.value);
}

function periodDisplayLabel(period) {
  if (period.type === 'all') return 'All time';
  if (period.type === 'week') return weekLabel(period.value);
  if (period.type === 'year') return period.value;
  return monthLabel(period.value);
}

function populateExcelPeriodValueSelect() {
  const type = document.getElementById('excelPeriodType').value;
  const valueSelect = document.getElementById('excelPeriodValue');
  if (type === 'all') {
    valueSelect.innerHTML = '';
    valueSelect.hidden = true;
    return;
  }
  valueSelect.hidden = false;
  let options;
  if (type === 'week') {
    const weeks = Array.from(new Set(state.transactions.map((t) => weekKey(t.date)))).sort().reverse();
    const curWeek = weekKey(todayStr());
    if (!weeks.includes(curWeek)) weeks.unshift(curWeek);
    options = weeks.map((w) => ({ value: w, label: weekLabel(w) }));
  } else if (type === 'year') {
    const years = Array.from(new Set(state.transactions.map((t) => t.date.slice(0, 4)))).sort().reverse();
    const curYear = String(new Date().getFullYear());
    if (!years.includes(curYear)) years.unshift(curYear);
    options = years.map((y) => ({ value: y, label: y }));
  } else {
    const months = Array.from(new Set(state.transactions.map((t) => monthKey(t.date)))).sort().reverse();
    if (!months.includes(currentMonthKey())) months.unshift(currentMonthKey());
    options = months.map((m) => ({ value: m, label: monthLabel(m) }));
  }
  const prev = valueSelect.value;
  valueSelect.innerHTML = options.map((o) => `<option value="${o.value}">${escapeHTML(o.label)}</option>`).join('');
  valueSelect.value = options.some((o) => o.value === prev) ? prev : options[0].value;
}

function buildExcelRows(period, txns) {
  const income = txns.filter((t) => t.type === 'income');
  const salaryP = income.filter((t) => t.categoryId === 'salary').reduce((s, t) => s + t.amountPaise, 0);
  const otherIncomeP = income.filter((t) => t.categoryId !== 'salary').reduce((s, t) => s + t.amountPaise, 0);
  const expenseP = txns.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amountPaise, 0);

  const rows = [];
  rows.push(['MyFinances export']);
  rows.push(['Period', periodDisplayLabel(period)]);
  rows.push(['Generated', new Date().toLocaleString()]);
  rows.push([]);
  rows.push(['Salary (₹)', 'Other Income (₹)', 'Total Income (₹)', 'Expenses (₹)', 'Net (₹)']);
  rows.push([salaryP / 100, otherIncomeP / 100, (salaryP + otherIncomeP) / 100, expenseP / 100, (salaryP + otherIncomeP - expenseP) / 100]);
  rows.push([]);
  rows.push(['Date', 'Type', 'Account', 'From Account', 'To Account', 'Category', 'Payment Method', 'UPI ID', 'Description', 'Amount (INR)', 'Notes']);

  [...txns].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt).forEach((t) => {
    if (t.type === 'transfer') {
      rows.push([t.date, 'Transfer', '', accountInfo(t.fromAccountId).name, accountInfo(t.toAccountId).name, '', '', '', t.description, t.amountPaise / 100, t.notes || '']);
    } else {
      const info = categoryInfo(t.categoryId);
      const signed = (t.type === 'income' ? t.amountPaise : -t.amountPaise) / 100;
      rows.push([t.date, t.type === 'income' ? 'Income' : 'Expense', accountInfo(t.accountId).name, '', '', info.name, paymentMethodLabel(t.paymentMethod), t.upiId || '', t.description, signed, t.notes || '']);
    }
  });
  return rows;
}

let sheetJsLoadPromise = null;
function loadSheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (sheetJsLoadPromise) return sheetJsLoadPromise;
  sheetJsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    script.onload = () => { window.XLSX ? resolve(window.XLSX) : reject(new Error('XLSX did not load')); };
    script.onerror = () => reject(new Error('Could not load the Excel export library'));
    document.head.appendChild(script);
  });
  return sheetJsLoadPromise;
}

async function exportExcelData() {
  const type = document.getElementById('excelPeriodType').value;
  const value = document.getElementById('excelPeriodValue').value;
  const period = { type, value };
  const txns = transactionsInExportPeriod(state.transactions, period);
  if (txns.length === 0) {
    showToast(i18n('toast.noTxnsToExport'));
    return;
  }

  const btn = document.getElementById('exportExcelBtn');
  btn.disabled = true;
  try {
    const XLSX = await loadSheetJS();
    const rows = buildExcelRows(period, txns);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [12, 10, 16, 16, 16, 16, 14, 14, 28, 12, 24].map((wch) => ({ wch }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
    const safeValue = (type === 'all' ? 'all-time' : value).replace(/[^\w-]/g, '');
    XLSX.writeFile(wb, `myfinances-${type}-${safeValue}-${todayStr()}.xlsx`);
    showToast(i18n('toast.excelExported'));
  } catch (e) {
    console.error('Excel export failed', e);
    showToast(i18n('toast.excelLoadFailed'));
  } finally {
    btn.disabled = false;
  }
}

let pendingRestoreState = null;
let preRestoreBackup = null; // kept in memory only, for this session, as a recovery copy

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(reader.result);
    } catch (e) {
      showToast(i18n('toast.invalidBackup'));
      return;
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.transactions)) {
      showToast(i18n('toast.invalidBackup'));
      return;
    }
    const candidate = coerceLoadedState(parsed);
    pendingRestoreState = candidate;
    showRestoreSummary(candidate);
  };
  reader.onerror = () => showToast(i18n('toast.invalidBackup'));
  reader.readAsText(file);
}

function showRestoreSummary(candidate) {
  const dates = candidate.transactions.map((t) => t.date).filter(Boolean).sort();
  const range = dates.length ? `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}` : '—';
  const summary = document.getElementById('restoreSummary');
  summary.innerHTML = [
    [i18n('restore.accounts'), candidate.accounts.length],
    [i18n('restore.categories'), candidate.categories.length],
    [i18n('restore.transactions'), candidate.transactions.length],
    [i18n('restore.budgets'), candidate.budgets.length],
    [i18n('restore.dateRange'), range],
  ].map(([label, val]) => `<li><span>${escapeHTML(label)}</span><span>${escapeHTML(String(val))}</span></li>`).join('');
  document.getElementById('restoreModalOverlay').hidden = false;
}

function closeRestoreModal() {
  document.getElementById('restoreModalOverlay').hidden = true;
  pendingRestoreState = null;
}

function confirmRestore() {
  if (!pendingRestoreState) return;
  preRestoreBackup = state; // atomic swap: only commit once the new state is fully built
  state = pendingRestoreState;
  pendingRestoreState = null;
  saveState();
  document.getElementById('restoreModalOverlay').hidden = true;
  applyTheme(state.settings.theme);
  document.getElementById('languageSelect').value = state.settings.language;
  applyTranslations();
  document.getElementById('reminderFrequencySelect').value = String(state.settings.reminderDays);
  refreshCurrentView();
  showToast(i18n('toast.dataImported'));
}

function resetAllData() {
  if (!confirm('This will permanently delete all accounts, transactions, and budgets, and turn off App Lock. Continue?')) return;
  lockMeta = { enabled: false, salt: null, checkCipher: null, checkIv: null, autoLockMinutes: 5 };
  saveLockMeta(lockMeta);
  encryptionKey = null;
  clearTimeout(autoLockTimer);
  state = defaultState();
  saveState();
  localStorage.removeItem(PRE_V2_BACKUP_KEY);
  updateAppLockUI();
  refreshCurrentView();
  showToast(i18n('toast.dataCleared'));
}

function loadSampleData() {
  const mKey = currentMonthKey();
  const [y, m] = mKey.split('-').map(Number);
  const d = (day) => `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const rupees = (n) => Math.round(n * 100);

  if (!state.accounts.find((a) => a.id === 'bank_sample')) {
    state.accounts.push({ id: 'bank_sample', name: 'HDFC Bank', type: 'bank', currency: 'INR', openingBalancePaise: rupees(5000), openingDate: d(1), archived: false });
  }

  const samples = [
    { type: 'income', categoryId: 'salary', accountId: 'cash', paymentMethod: 'bank_transfer', description: 'Monthly Salary', amountPaise: rupees(42000), date: d(1) },
    { type: 'expense', categoryId: 'rent', accountId: 'cash', paymentMethod: 'bank_transfer', description: 'Apartment Rent', amountPaise: rupees(14000), date: d(2) },
    { type: 'expense', categoryId: 'food', accountId: 'cash', paymentMethod: 'upi', description: 'Grocery Shopping', amountPaise: rupees(954), date: d(3) },
    { type: 'expense', categoryId: 'utilities', accountId: 'cash', paymentMethod: 'upi', description: 'Electricity Bill', amountPaise: rupees(621), date: d(5) },
    { type: 'expense', categoryId: 'transportation', accountId: 'cash', paymentMethod: 'cash', description: 'Fuel', amountPaise: rupees(480), date: d(6) },
    { type: 'expense', categoryId: 'entertainment', accountId: 'cash', paymentMethod: 'card', description: 'Movie Night', amountPaise: rupees(320), date: d(8) },
    { type: 'income', categoryId: 'freelance', accountId: 'bank_sample', paymentMethod: 'bank_transfer', description: 'Freelance Web Project', amountPaise: rupees(6500), date: d(9) },
    { type: 'expense', categoryId: 'food', accountId: 'cash', paymentMethod: 'card', description: 'Restaurant Dinner', amountPaise: rupees(547), date: d(10) },
    { type: 'expense', categoryId: 'shopping', accountId: 'bank_sample', paymentMethod: 'card', description: 'New Shoes', amountPaise: rupees(899), date: d(12) },
    { type: 'expense', categoryId: 'health', accountId: 'cash', paymentMethod: 'upi', description: 'Gym Membership', amountPaise: rupees(400), date: d(13) },
  ];
  const now = Date.now();
  samples.forEach((s) => state.transactions.push(Object.assign({ id: uid(), notes: '', createdAt: now, updatedAt: now }, s)));

  state.transactions.push({
    id: uid(), type: 'transfer', fromAccountId: 'cash', toAccountId: 'bank_sample',
    amountPaise: rupees(3000), date: d(7), description: 'Move savings to bank', notes: '', createdAt: now, updatedAt: now,
  });

  const limits = { food: 4000, entertainment: 1000, shopping: 1500, transportation: 1200 };
  Object.entries(limits).forEach(([catId, amt]) => {
    state.budgets = state.budgets.filter((b) => !(b.categoryId === catId && b.month === mKey));
    state.budgets.push({ id: uid(), categoryId: catId, month: mKey, limitPaise: rupees(amt) });
  });

  saveState();
  refreshCurrentView();
  showToast(i18n('toast.sampleLoaded'));
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
  savePrefs({ theme: state.settings.theme });
  saveState();
  refreshCurrentView();
}

/* ---------- Wire up events ---------- */
function init() {
  applyTranslations();
  applyTheme(state.settings.theme);
  updateAppLockUI();
  if (isLocked) {
    document.getElementById('lockScreen').hidden = false;
    setTimeout(() => document.getElementById('lockPinInput').focus(), 50);
  }
  document.getElementById('languageSelect').value = state.settings.language;
  document.getElementById('reminderFrequencySelect').value = String(state.settings.reminderDays);
  document.getElementById('txnDate').value = todayStr();

  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
  document.querySelectorAll('[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.goto));
  });

  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
  document.getElementById('languageSelect').addEventListener('change', (e) => {
    state.settings.language = e.target.value;
    saveState();
    applyTranslations();
    refreshCurrentView();
  });

  document.getElementById('quickAddBtn').addEventListener('click', () => openTransactionModal(null));
  document.getElementById('modalClose').addEventListener('click', closeTransactionModal);
  document.getElementById('modalCancel').addEventListener('click', closeTransactionModal);
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') closeTransactionModal();
  });
  document.getElementById('txnForm').addEventListener('submit', handleTransactionSubmit);
  document.getElementById('txnCategory').addEventListener('change', updateCategoryColorDot);
  document.getElementById('txnPaymentMethod').addEventListener('change', updateUpiIdRowVisibility);
  document.getElementById('typeExpenseBtn').addEventListener('click', () => setTypeButtons('expense'));
  document.getElementById('typeIncomeBtn').addEventListener('click', () => setTypeButtons('income'));
  document.getElementById('typeTransferBtn').addEventListener('click', () => {
    if (activeAccounts().length < 2) { showToast(i18n('toast.needTwoAccounts')); return; }
    setTypeButtons('transfer');
  });
  document.getElementById('voiceDictateBtn').addEventListener('click', toggleDictation);
  document.getElementById('receiptAttachBtn').addEventListener('click', () => document.getElementById('receiptFileInput').click());
  document.getElementById('receiptFileInput').addEventListener('change', handleReceiptFileSelected);
  document.getElementById('receiptRemoveBtn').addEventListener('click', removeReceiptPhoto);
  document.getElementById('receiptScanBtn').addEventListener('click', scanUpiScreenshot);
  document.getElementById('receiptThumbBtn').addEventListener('click', () => openPhotoLightbox(pendingReceiptImage));
  document.getElementById('photoLightboxClose').addEventListener('click', closePhotoLightbox);
  document.getElementById('photoLightbox').addEventListener('click', (e) => { if (e.target.id === 'photoLightbox') closePhotoLightbox(); });

  ['searchInput', 'filterType', 'filterAccount', 'filterCategory', 'filterMonth'].forEach((id) => {
    document.getElementById(id).addEventListener('input', renderTransactionsView);
  });
  document.getElementById('clearFilters').addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    document.getElementById('filterType').value = 'all';
    document.getElementById('filterAccount').value = 'all';
    document.getElementById('filterCategory').value = 'all';
    document.getElementById('filterMonth').value = '';
    renderTransactionsView();
  });

  document.querySelectorAll('.period-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) return;
      dashboardPeriod = { type: btn.dataset.period, value: null };
      document.querySelectorAll('.period-btn').forEach((b) => b.classList.toggle('active', b === btn));
      populateDashboardPeriodSelect();
      renderStatCards();
      renderCategoryChart();
    });
  });
  document.getElementById('dashPeriodValue').addEventListener('change', (e) => {
    dashboardPeriod.value = e.target.value;
    renderStatCards();
    renderCategoryChart();
  });

  document.getElementById('budgetMonthSelect').addEventListener('change', renderBudgetsView);

  document.getElementById('addAccountForm').addEventListener('submit', handleAddAccountSubmit);
  document.getElementById('addCategoryForm').addEventListener('submit', handleAddCategorySubmit);

  document.getElementById('exportBtn').addEventListener('click', exportData);
  document.getElementById('exportCsvBtn').addEventListener('click', exportCsvData);
  document.getElementById('excelPeriodType').addEventListener('change', populateExcelPeriodValueSelect);
  document.getElementById('exportExcelBtn').addEventListener('click', exportExcelData);
  populateExcelPeriodValueSelect();
  document.getElementById('importInput').addEventListener('change', (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('restoreCancelBtn').addEventListener('click', closeRestoreModal);
  document.getElementById('restoreModalClose').addEventListener('click', closeRestoreModal);
  document.getElementById('restoreConfirmBtn').addEventListener('click', confirmRestore);
  document.getElementById('restoreModalOverlay').addEventListener('click', (e) => { if (e.target.id === 'restoreModalOverlay') closeRestoreModal(); });
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
    if (e.key !== 'Escape') return;
    if (!document.getElementById('photoLightbox').hidden) closePhotoLightbox();
    else if (!document.getElementById('restoreModalOverlay').hidden) closeRestoreModal();
    else if (!document.getElementById('modalOverlay').hidden) closeTransactionModal();
    else if (!document.getElementById('pinModalOverlay').hidden) closePinModal(null);
  });

  switchView('dashboard');
}

document.addEventListener('DOMContentLoaded', init);
