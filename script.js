// Sakura Money Tracker - polished script (animations, dark mode, settings)
// Keeps localStorage, export/import, and robust input formatting.
// Author: ChatGPT for Vortex :3

// ---- Selectors ----
const form = document.getElementById('transaction-form');
const transactionsEl = document.getElementById('transactions');
const balanceEl = document.getElementById('balance');

const exportBtn = document.getElementById('exportBtn');
const importFile = document.getElementById('importFile');

const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const closeSettings = document.getElementById('closeSettings');

const themeToggle = document.getElementById('themeToggle');

const amountInput = document.getElementById('amount');
const typeSelect = document.getElementById('type');

const TEMPLATE = document.getElementById('transaction-template');

// ---- Keys & state ----
const STORAGE_KEY = 'sakura_transactions_v1';
const THEME_KEY = 'sakura_theme_v1';
let transactions = loadTransactions();

// ---- Theme init ----
function applyTheme(theme) {
  const body = document.body;
  if (theme === 'dark') {
    body.classList.add('theme-dark');
    themeToggle && themeToggle.setAttribute('aria-pressed', 'true');
  } else {
    body.classList.remove('theme-dark');
    themeToggle && themeToggle.setAttribute('aria-pressed', 'false');
  }
  localStorage.setItem(THEME_KEY, theme || 'light');
}

(function initTheme(){
  const saved = localStorage.getItem(THEME_KEY) || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(saved);
})();

// ---- Utility ----
function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString();
}

function cryptoRandomId() {
  return 'id-' + (crypto.getRandomValues(new Uint32Array(2)).join('-'));
}

// ---- Storage ----
function saveTransactions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions, null, 2));
}

function loadTransactions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Load failed', e);
    return [];
  }
}

// ---- UI rendering ----
function updateUI() {
  // Clear list
  transactionsEl.innerHTML = '';

  // Balance
  const balance = transactions.reduce((acc, t) => acc + Number(t.amount || 0), 0);
  balanceEl.textContent = `$${Number(balance).toFixed(2)}`;

  // Sorted newest first
  const sorted = [...transactions].sort((a,b)=> new Date(b.date) - new Date(a.date));

  if (sorted.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'transaction';
    empty.innerHTML = '<div style="color:var(--muted)">No transactions yet — add your first one above 🌸</div>';
    transactionsEl.appendChild(empty);
    return;
  }

  for (const t of sorted) {
    const tmpl = TEMPLATE.content.cloneNode(true);
    const node = tmpl.querySelector('.transaction');

    node.querySelector('.tx-title').textContent = t.title;
    node.querySelector('.tx-meta .tx-type').textContent = t.type;
    node.querySelector('.tx-meta .tx-date').textContent = formatDate(t.date);
    node.querySelector('.tx-desc').textContent = t.description || '';

    const amountEl = node.querySelector('.tx-amount');
    const sign = Number(t.amount) >= 0 ? '+' : '-';
    const absVal = Math.abs(Number(t.amount)).toFixed(2);
    amountEl.textContent = `${sign}$${absVal}`;

    node.classList.add(Number(t.amount) >= 0 ? 'positive' : 'negative');

    // add enter animation class (force reflow to ensure animation plays)
    node.classList.add('enter');
    // delete behavior with leave animation
    const delBtn = node.querySelector('.delete-btn');
    delBtn.addEventListener('click', () => {
      if (!confirm(`Delete "${t.title}" of ${sign}$${absVal}?`)) return;
      // animate out
      node.classList.add('leave');
      // remove from data after animation ends
      node.addEventListener('animationend', () => {
        transactions = transactions.filter(x => x.id !== t.id);
        saveTransactions();
        updateUI();
      }, {once:true});
    });

    transactionsEl.appendChild(node);
  }
}

// ---- Validation ----
function validateFormFields() {
  const title = document.getElementById('title').value.trim();
  const type = typeSelect.value;
  const rawAmount = amountInput.value.trim();

  if (!title) { showToast('Please add a title for the transaction.'); return false; }
  if (!type) { showToast('Please choose a transaction type (Paycheck / Gift / Purchase).'); return false; }
  if (rawAmount === '') { showToast('Please enter an amount.'); return false; }

  const parsed = parseFloat(rawAmount.replace(/[^0-9.-]+/g,""));
  if (isNaN(parsed)) { showToast('Amount looks invalid. Use numbers like 12.00 or 5.'); return false; }
  return true;
}

// ---- Simple toast (non-blocking, pretty) ----
function showToast(message, timeout=2500) {
  // small lightweight toast to replace alert (better UX)
  let t = document.getElementById('sakura-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'sakura-toast';
    t.style.position = 'fixed';
    t.style.left = '50%';
    t.style.bottom = '28px';
    t.style.transform = 'translateX(-50%)';
    t.style.zIndex = 120;
    t.style.background = 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(255,255,255,0.9))';
    t.style.padding = '10px 14px';
    t.style.borderRadius = '12px';
    t.style.boxShadow = '0 10px 30px rgba(25,10,20,0.08)';
    t.style.color = 'var(--text)';
    t.style.fontWeight = 700;
    t.style.fontSize = '13px';
    document.body.appendChild(t);
  }
  t.textContent = message;
  t.style.opacity = '0';
  t.style.transition = 'opacity 220ms ease, transform 220ms ease';
  requestAnimationFrame(()=> { t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)'; });
  clearTimeout(t._timeout);
  t._timeout = setTimeout(()=> {
    t.style.opacity = '0';
    t.style.transform = 'translateX(-50%) translateY(8px)';
  }, timeout);
}

// ---- Form submit ----
form.addEventListener('submit', evt => {
  evt.preventDefault();
  if (!validateFormFields()) return;

  const title = document.getElementById('title').value.trim();
  const description = document.getElementById('description').value.trim();
  const type = typeSelect.value;
  const rawAmount = amountInput.value.trim();

  const parsed = parseFloat(rawAmount.replace(/[^0-9.-]+/g,""));
  let finalAmount = parsed;
  if (type === 'purchase') finalAmount = -Math.abs(parsed);
  else finalAmount = Math.abs(parsed);

  const tx = {
    id: cryptoRandomId(),
    title, description, type, amount: Number(finalAmount),
    date: new Date().toISOString()
  };

  transactions.push(tx);
  saveTransactions();
  updateUI();

  // reset & nice UX
  form.reset();
  amountInput.value = '0.00';
  typeSelect.selectedIndex = 0;

  // Scroll transactions container to top smoothly so user sees new entry
  setTimeout(()=> {
    transactionsEl.scrollTo({ top: 0, behavior: 'smooth' });
  }, 50);
});

// ---- Export / Import ----
exportBtn && exportBtn.addEventListener('click', () => {
  const filename = `sakura_money_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`;
  const blob = new Blob([JSON.stringify(transactions, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a);
  a.click(); a.remove(); URL.revokeObjectURL(url);
  showToast('Exported JSON ✅');
});

importFile && importFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm('Importing will replace current transactions. Continue?')) { importFile.value = ''; return; }
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('Invalid file format');
    const normalized = parsed.map(p => ({
      id: p.id || cryptoRandomId(),
      title: p.title || 'Untitled',
      description: p.description || '',
      type: p.type || 'purchase',
      amount: Number(p.amount) || 0,
      date: p.date || new Date().toISOString()
    }));
    transactions = normalized;
    saveTransactions();
    updateUI();
    showToast('Import successful 🌸');
  } catch (err) {
    console.error(err);
    showToast('Import failed — invalid JSON', 3500);
  } finally { importFile.value = ''; }
});

// ---- Settings panel toggles ----
settingsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const show = settingsPanel.style.display !== 'block';
  settingsPanel.style.display = show ? 'block' : 'none';
  if (show){
    // small entrance animation
    settingsPanel.style.opacity = '0';
    settingsPanel.style.transform = 'translateY(-8px) scale(.99)';
    requestAnimationFrame(()=> {
      settingsPanel.style.transition = 'opacity 260ms var(--); transform 260ms var(--);';
      settingsPanel.style.opacity = '1';
      settingsPanel.style.transform = 'translateY(0) scale(1)';
    });
  }
  settingsPanel.setAttribute('aria-hidden', show ? 'false' : 'true');
});
closeSettings.addEventListener('click', ()=> { settingsPanel.style.display = 'none'; settingsPanel.setAttribute('aria-hidden','true'); });
document.addEventListener('click', (e) => {
  if (!settingsPanel) return;
  if (settingsPanel.style.display !== 'block') return;
  if (settingsPanel.contains(e.target) || e.target === settingsBtn) return;
  settingsPanel.style.display = 'none';
  settingsPanel.setAttribute('aria-hidden','true');
});

// ---- Theme toggle action ----
themeToggle && themeToggle.addEventListener('click', () => {
  const isDark = document.body.classList.contains('theme-dark');
  applyTheme(isDark ? 'light' : 'dark');
  showToast(isDark ? 'Light mode' : 'Dark mode');
});

// ---- Amount formatting (friendly) ----
amountInput.addEventListener('focus', (e) => { if (e.target.value === '0.00') e.target.value = ''; });
amountInput.addEventListener('input', (e) => {
  const el = e.target;
  let v = el.value;
  v = v.replace(/[^\d.]/g, '');
  const parts = v.split('.');
  if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
  if (v.includes('.')) {
    const [intPart, decPart] = v.split('.');
    el.value = intPart + '.' + decPart.slice(0,2);
  } else el.value = v;
});
amountInput.addEventListener('blur', (e) => {
  const el = e.target;
  if (el.value.trim() === '') { el.value = '0.00'; return; }
  const num = parseFloat(el.value.replace(/[^0-9.-]+/g,""));
  el.value = isNaN(num) ? '0.00' : Number(num).toFixed(2);
});
if (!amountInput.value) amountInput.value = '0.00';

// ---- Init UI ----
updateUI();
