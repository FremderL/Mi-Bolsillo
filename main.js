// main.js — Implementación completa actualizada: showOnly/filtros, toasts (y Notification API fallback),
// export rápido por categoría, modal overlay oscuro y correcciones para que la gráfica sea visible.

const STORAGE_KEY = 'mi-bolsillo:v2';
const THEME_KEY = 'mi-bolsillo:theme';
const PIN_KEY = 'mi-bolsillo:pin';
const BACKUP_INTERVAL_MS = 1000 * 60 * 60 * 24 * 7; // semanal

const currencyFmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const qs = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));

/* ===================== State + Storage ===================== */
function defaultCategories(){
  return [
    { id: 'c-uncategorized', name: 'Sin categoría', type:'both', color:'#9ca3af', createdAt: new Date().toISOString() },
    { id: 'c-food', name: 'Alimentos', type:'expense', color:'#ef4444', createdAt: new Date().toISOString() },
    { id: 'c-salary', name: 'Sueldo', type:'income', color:'#10b981', createdAt: new Date().toISOString() }
  ];
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return { entries: [], categories: defaultCategories(), budgets: {}, settings: {} };
    const parsed = JSON.parse(raw);
    if(Array.isArray(parsed)){
      return { entries: parsed, categories: defaultCategories(), budgets: {}, settings: {} };
    }
    return {
      entries: parsed.entries || [],
      categories: parsed.categories || defaultCategories(),
      budgets: parsed.budgets || {},
      settings: parsed.settings || {}
    };
  }catch(e){
    console.error('loadState failed', e);
    return { entries: [], categories: defaultCategories(), budgets: {}, settings: {} };
  }
}

function saveState(){
  const toSave = { entries: state.entries, categories: state.categories, budgets: state.budgets, settings: state.settings };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
}

let state = loadState();
state.view = state.view || 'all';
state.filters = state.filters || { start: null, end: null, query: '' };

/* PIN lock flag */
let isUnlocked = false;

/* ===================== UI helper: showOnly ===================== */
// Oculta todas las secciones con data-section y muestra solo la solicitada.
// Si sectionId === 'main' o null muestra la UI principal (balance + lista + controles)
function showOnly(sectionId){
  const sections = document.querySelectorAll('[data-section]');
  sections.forEach(s => s.classList.add('hidden'));
  if(!sectionId || sectionId === 'main'){
    // mostrar la UI principal (balance + lista + view-controls)
    document.querySelectorAll('[data-section="main"], [data-section="list"], [data-section="view-controls"]').forEach(el => el.classList.remove('hidden'));
    // si filters estaban visibles, no los forzamos aquí; su toggle es independiente
    const f = qs('#filters-section');
    if(f && !f.classList.contains('hidden')) f.classList.remove('hidden');
    return;
  }
  const el = document.querySelector(`[data-section="${sectionId}"]`);
  if(el) el.classList.remove('hidden');
}

/* ===================== Toasts / Notifications ===================== */
function showToast(message, { type='info', timeout=4000 } = {}){
  const container = qs('#toast-container');
  if(!container) return;
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = message;
  container.appendChild(t);
  // animation in CSS
  setTimeout(()=> t.classList.add('visible'), 10);
  setTimeout(()=> {
    t.classList.remove('visible');
    setTimeout(()=> t.remove(), 300);
  }, timeout);
}

async function notifyBudgetReachedUI(category, budget, spent){
  const msg = `Límite alcanzado: "${category.name}" — Presupuesto ${currencyFmt.format(budget)}, Gastado ${currencyFmt.format(spent)}`;
  // intentar Notification API primero
  if('Notification' in window){
    if(Notification.permission === 'granted'){
      new Notification('Mi bolsillo — Presupuesto', { body: msg });
      showToast(msg, { type:'warning', timeout:7000 });
      return;
    } else if(Notification.permission !== 'denied'){
      try{
        const perm = await Notification.requestPermission();
        if(perm === 'granted'){ new Notification('Mi bolsillo — Presupuesto', { body: msg }); showToast(msg, { type:'warning', timeout:7000 }); return; }
      }catch(e){}
    }
  }
  // fallback a toast
  showToast(msg, { type:'warning', timeout:7000 });
}

/* ===================== Entries, categories, budgets ===================== */
function addEntry({ type, amount, date, note, categoryId }){
  const entry = { id: uid(), type, amount: Number(amount), date, note: note || '', categoryId: categoryId || 'c-uncategorized', createdAt: new Date().toISOString() };
  state.entries.unshift(entry);
  saveState();
  render();
  if(entry.type === 'expense') checkBudgetForCategory(entry.categoryId);
  return entry;
}

function deleteEntry(id){
  state.entries = state.entries.filter(e => e.id !== id);
  saveState();
  render();
}

function clearAll(){
  if(!confirm('¿Borrar todos los datos? Esta acción no se puede deshacer.')) return;
  state.entries = [];
  state.categories = defaultCategories();
  state.budgets = {};
  saveState();
  render();
}

function randomColor(){
  const colors = ['#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899','#06b6d4','#f97316','#60a5fa'];
  return colors[Math.floor(Math.random()*colors.length)];
}
function addCategory({ name, type='both', budget=null, color=null }){
  const trimmed = (name||'').trim();
  if(!trimmed) throw new Error('Nombre de categoría requerido');
  const cat = { id: 'c-'+uid(), name: trimmed, type, color: color || randomColor(), createdAt: new Date().toISOString() };
  state.categories.push(cat);
  if(budget !== null && budget !== '') state.budgets[cat.id] = Number(budget);
  saveState();
  renderCategories();
  render();
  return cat;
}
function deleteCategory(id){
  if(id === 'c-uncategorized') { showToast('No se puede eliminar la categoría predeterminada.', { type:'info' }); return; }
  if(!confirm('Eliminar categoría. Las transacciones se reasignarán a "Sin categoría". ¿Continuar?')) return;
  state.entries = state.entries.map(e => e.categoryId === id ? { ...e, categoryId: 'c-uncategorized' } : e);
  state.categories = state.categories.filter(c => c.id !== id);
  delete state.budgets[id];
  saveState();
  renderCategories();
  render();
}
function setBudget(categoryId, amount){
  if(amount === null || amount === '' || isNaN(Number(amount))) {
    delete state.budgets[categoryId];
  } else {
    state.budgets[categoryId] = Number(amount);
  }
  saveState();
  renderCategories();
  render();
}

/* ===================== Aggregations ===================== */
function computeTotals(entries){
  const total = entries.reduce((a,e)=> e.type==='income' ? a + Number(e.amount) : a - Number(e.amount), 0);
  const incomes = entries.filter(e=>e.type==='income').reduce((s,e)=>s+Number(e.amount),0);
  const expenses = entries.filter(e=>e.type==='expense').reduce((s,e)=>s+Number(e.amount),0);
  return { total, incomes, expenses };
}
function totalsByCategory(entries){
  const map = {};
  for(const c of state.categories) map[c.id] = { category: c, income: 0, expense: 0 };
  for(const e of entries){
    const id = e.categoryId || 'c-uncategorized';
    if(!map[id]) map[id] = { category: { id, name: 'Sin categoría', color:'#9ca3af' }, income:0, expense:0 };
    if(e.type === 'income') map[id].income += Number(e.amount);
    else map[id].expense += Number(e.amount);
  }
  return Object.values(map);
}
function computeTotalsForPeriod(start, end){
  const entries = state.entries.filter(e => {
    if(start && e.date < start) return false;
    if(end && e.date > end) return false;
    return true;
  });
  return computeTotals(entries);
}
function aggregateMonthly(entries, months=6){
  const now = new Date();
  const arr = [];
  for (let i = months-1; i >= 0; i--){
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    arr.push({ key, label: d.toLocaleDateString('es-MX',{month:'short',year:'2-digit'}), income:0, expense:0 });
  }
  const map = Object.fromEntries(arr.map(a=>[a.key,a]));
  for(const e of entries){
    if(!e.date) continue;
    const k = e.date.slice(0,7);
    if(map[k]){
      if(e.type === 'income') map[k].income += Number(e.amount);
      else map[k].expense += Number(e.amount);
    }
  }
  return Object.values(map);
}

/* ===================== Budget notifications (toast/notification) ===================== */
function checkBudgetForCategory(categoryId){
  const budget = state.budgets[categoryId];
  if(!budget) return;
  const totals = totalsByCategory(state.entries).find(t => t.category.id === categoryId);
  const spent = (totals && totals.expense) || 0;
  if(spent >= budget){
    // usar toast + Notification API si está disponible
    notifyBudgetReachedUI(totals.category, budget, spent);
  }
}

/* ===================== Export / Import con filtros ===================== */
function filterEntriesByOptions(entries, filters){
  let res = entries.slice();
  if(!filters || filters.scope === 'all') return res;
  if(filters.scope === 'category' && filters.categoryId) res = res.filter(e => e.categoryId === filters.categoryId);
  else if(filters.scope === 'date'){
    if(filters.start) res = res.filter(e => e.date >= filters.start);
    if(filters.end) res = res.filter(e => e.date <= filters.end);
  } else if(filters.scope === 'notes' && filters.notesText){
    const q = filters.notesText.toLowerCase();
    res = res.filter(e => (e.note||'').toLowerCase().includes(q));
  } else if(filters.scope === 'type' && filters.type){
    res = res.filter(e => e.type === filters.type);
  }
  return res;
}
function exportJSONWithFilters(filters){
  const items = filterEntriesByOptions(state.entries, filters);
  const toExport = { meta: { generatedAt: new Date().toISOString(), filters }, entries: items, categories: state.categories, budgets: state.budgets };
  const data = JSON.stringify(toExport, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `mi-bolsillo-export-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url);
}
function exportCSVWithFilters(filters){
  const items = filterEntriesByOptions(state.entries, filters);
  const rows = [['id','tipo','monto','fecha','nota','categoria']];
  for(const e of items){
    const cat = state.categories.find(c=>c.id === e.categoryId) || { name: 'Sin categoría' };
    const noteSafe = (e.note||'').replace(/"/g,'""');
    const catSafe = (cat.name||'').replace(/"/g,'""');
    rows.push([e.id, e.type, e.amount, e.date, `"${noteSafe}"`, `"${catSafe}"`]);
  }
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `mi-bolsillo-export-${filters.scope || 'all'}-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url);
}
function exportPDFWithFilters(filters){
  const items = filterEntriesByOptions(state.entries, filters);
  const totals = computeTotals(items);
  const byCat = totalsByCategory(items);
  let html = `<html><head><meta charset="utf-8"><title>Exportar — Mi bolsillo</title><style>body{font-family:Arial,Helvetica,sans-serif;padding:20px;color:#111}h1{font-size:18px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px}</style></head><body>`;
  html += `<h1>Mi bolsillo — Exportación</h1>`;
  html += `<p>Totales — Ingresos: ${currencyFmt.format(totals.incomes)} · Egresos: ${currencyFmt.format(totals.expenses)} · Balance: ${currencyFmt.format(totals.total)}</p>`;
  html += `<h2>Por categoría</h2><table><thead><tr><th>Categoría</th><th>Ingresos</th><th>Egresos</th></tr></thead><tbody>`;
  for(const c of byCat){
    html += `<tr><td>${escapeHtml(c.category.name)}</td><td>${currencyFmt.format(c.income)}</td><td>${currencyFmt.format(c.expense)}</td></tr>`;
  }
  html += `</tbody></table><h2>Transacciones</h2><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Monto</th><th>Categoría</th><th>Nota</th></tr></thead><tbody>`;
  for(const e of items){
    const cat = state.categories.find(c=>c.id===e.categoryId) || {name:'Sin categoría'};
    html += `<tr><td>${escapeHtml(e.date)}</td><td>${escapeHtml(e.type)}</td><td>${currencyFmt.format(e.amount)}</td><td>${escapeHtml(cat.name)}</td><td>${escapeHtml(e.note)}</td></tr>`;
  }
  html += `</tbody></table></body></html>`;
  const w = window.open('', '_blank');
  if(!w){ showToast('No se pudo abrir ventana nueva para generar PDF.', { type:'error' }); return; }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(()=> w.print(), 500);
}

/* ===================== Helpers (UI + misc) ===================== */
function escapeHtml(s=''){ return String(s).replace(/[&<>'"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]); }
function formatDate(d){ try{ const dt = new Date(d); return dt.toLocaleDateString('es-MX',{year:'numeric',month:'short',day:'numeric'}); }catch(e){ return d } }
function hexToRgba(hex, a=0.12){
  if(!hex) return `rgba(0,0,0,${a})`;
  const c = hex.replace('#','');
  const bigint = parseInt(c.length === 3 ? c.split('').map(x=>x+x).join('') : c ,16);
  const r = (bigint >> 16) & 255; const g = (bigint >> 8) & 255; const b = bigint & 255;
  return `rgba(${r},${g},${b},${a})`;
}

/* ===================== Render UI ===================== */
let chart = null;
function render(){
  renderTotals();
  renderList();
  renderChart();
  renderMonthlySummary();
  renderCategories();
  updateSegment();
}
function renderTotals(){
  const { total } = computeTotals(state.entries);
  const el = qs('#total-money');
  if(el) { el.textContent = currencyFmt.format(total || 0); el.style.color = (total < 0) ? 'var(--danger)' : 'var(--success)'; }
}
function renderList(){
  const list = qs('#entries-list'); if(!list) return;
  list.innerHTML = '';
  const filtered = applyFilters(state.entries);
  if(filtered.length === 0){ qs('#empty-msg')?.classList.remove('hidden'); } else qs('#empty-msg')?.classList.add('hidden');
  for(const e of filtered){
    const li = document.createElement('li'); li.className = 'entry'; li.dataset.id = e.id;
    const left = document.createElement('div'); left.className = 'meta';
    const pill = document.createElement('span'); pill.className = 'pill ' + (e.type === 'income' ? 'income' : 'expense');
    const cat = state.categories.find(c => c.id === e.categoryId) || { name: 'Sin categoría', color: '#9ca3af' };
    pill.textContent = cat.name; pill.style.background = hexToRgba(cat.color, 0.12); pill.style.color = cat.color;
    const note = document.createElement('div');
    note.innerHTML = `<div style="font-weight:600">${escapeHtml(e.note || '(sin nota)')}</div><div class="muted" style="font-size:0.85rem">${formatDate(e.date)}</div>`;
    left.appendChild(pill); left.appendChild(note);
    const right = document.createElement('div'); right.style.display='flex'; right.style.alignItems='center'; right.style.gap='12px';
    const amount = document.createElement('div'); amount.className = 'amount'; amount.textContent = (e.type === 'expense' ? '-' : '') + currencyFmt.format(e.amount);
    const del = document.createElement('button'); del.className='btn'; del.title='Eliminar'; del.innerHTML='🗑'; del.onclick = ()=> { if(confirm('¿Eliminar este registro?')) deleteEntry(e.id); };
    right.appendChild(amount); right.appendChild(del);
    li.appendChild(left); li.appendChild(right); list.appendChild(li);
  }
}
function renderChart(){
  const ctx = qs('#chart')?.getContext('2d');
  if(!ctx) return;
  const monthly = aggregateMonthly(state.entries, 6);
  const labels = monthly.map(m => m.label);
  const incomes = monthly.map(m => m.income);
  const expenses = monthly.map(m => m.expense);
  if(chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Ingresos', data: incomes, backgroundColor: 'rgba(16,185,129,0.85)' },
        { label: 'Egresos', data: expenses, backgroundColor: 'rgba(239,68,68,0.85)' }
      ]
    },
    options: { responsive:true, maintainAspectRatio:false, scales:{ x:{ stacked:true }, y:{ stacked:false } }, plugins:{ legend:{ position:'bottom' } } }
  });
}
function renderMonthlySummary(){
  const now = new Date(); const monthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const items = state.entries.filter(e => e.date && e.date.startsWith(monthKey));
  const { total, incomes, expenses } = computeTotals(items);
  const el = qs('#monthly-summary');
  if(el) el.textContent = `Este mes — Ingresos: ${currencyFmt.format(incomes)} · Egresos: ${currencyFmt.format(expenses)} · Balance: ${currencyFmt.format(total)}`;
  const start = state.filters.start; const end = state.filters.end;
  if(start || end){ const totals = computeTotalsForPeriod(start, end); qs('#period-summary').textContent = `Resumen periodo — Ingresos: ${currencyFmt.format(totals.incomes)} · Egresos: ${currencyFmt.format(totals.expenses)} · Balance: ${currencyFmt.format(totals.total)}`; }
  else qs('#period-summary').textContent = '';
}
function renderCategories(){
  const sel = qs('#category');
  if(sel){ sel.innerHTML = ''; for(const c of state.categories){ const opt = document.createElement('option'); opt.value = c.id; opt.textContent = c.name; sel.appendChild(opt); } }
  const exportCatSel = qs('#export-category');
  if(exportCatSel){ exportCatSel.innerHTML = ''; for(const c of state.categories){ const opt = document.createElement('option'); opt.value = c.id; opt.textContent = c.name; exportCatSel.appendChild(opt); } }
  const list = qs('#categories-list');
  if(list){
    list.innerHTML = '';
    const totals = totalsByCategory(state.entries);
    for(const c of state.categories){
      const t = totals.find(x => x.category.id === c.id) || { income:0, expense:0 };
      const budgetVal = state.budgets[c.id] || 0;
      const restante = budgetVal ? Math.max(0, (budgetVal - t.expense)) : null;
      const usedPercent = budgetVal ? Math.min(100, Math.round((t.expense / budgetVal) * 100)) : 0;
      const li = document.createElement('li'); li.className = 'category-item';
      li.innerHTML = `
        <div class="category-left">
          <span class="category-pill" style="background:${hexToRgba(c.color,0.12)};color:${c.color}">${escapeHtml(c.name)}</span>
          <div class="category-meta">
            <div><strong>${escapeHtml(c.name)}</strong> <small class="muted">(${c.type})</small></div>
            <div class="muted">Ingresos: ${currencyFmt.format(t.income)} · Gastos: ${currencyFmt.format(t.expense)}</div>
          </div>
        </div>
      `;
      const right = document.createElement('div'); right.className = 'category-right';
      if(budgetVal){
        const progress = document.createElement('div'); progress.className = 'budget-progress';
        progress.innerHTML = `<div class="progress-bar"><div class="progress-fill" style="width:${usedPercent}%"></div></div>
          <div class="budget-info">Presupuesto: ${currencyFmt.format(budgetVal)} · Gastado: ${currencyFmt.format(t.expense)} · Restante: ${currencyFmt.format(restante)}</div>`;
        right.appendChild(progress);
      } else {
        const noBudget = document.createElement('div'); noBudget.className = 'muted'; noBudget.textContent = 'Sin presupuesto'; right.appendChild(noBudget);
      }
      const actions = document.createElement('div'); actions.className='category-actions';
      const setBtn = document.createElement('button'); setBtn.className='btn'; setBtn.textContent='Editar presupuesto';
      setBtn.onclick = ()=> { const val = prompt(`Establecer presupuesto para "${c.name}" (vacío para quitar):`, budgetVal || ''); if(val === null) return; setBudget(c.id, val); };
      const delBtn = document.createElement('button'); delBtn.className='btn'; delBtn.textContent='Eliminar';
      delBtn.onclick = ()=> deleteCategory(c.id);
      // quick export buttons
      const expCsv = document.createElement('button'); expCsv.className='btn'; expCsv.textContent='Export CSV';
      expCsv.title = 'Exportar transacciones de esta categoría (CSV)';
      expCsv.onclick = ()=> exportCSVWithFilters({ scope:'category', categoryId: c.id });
      const expPdf = document.createElement('button'); expPdf.className='btn'; expPdf.textContent='Export PDF';
      expPdf.title = 'Exportar transacciones de esta categoría (PDF)';
      expPdf.onclick = ()=> exportPDFWithFilters({ scope:'category', categoryId: c.id });
      actions.appendChild(setBtn); actions.appendChild(delBtn); actions.appendChild(expCsv); actions.appendChild(expPdf);
      li.appendChild(right); li.appendChild(actions);
      list.appendChild(li);
    }
  }
}
function updateSegment(){ qsa('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.view === state.view)); }

/* ===================== Filters ===================== */
function applyFilters(entries){
  let res = entries.slice();
  const f = state.filters;
  if(f.start) res = res.filter(e => e.date >= f.start);
  if(f.end) res = res.filter(e => e.date <= f.end);
  if(f.query) res = res.filter(e => (e.note || '').toLowerCase().includes(f.query.toLowerCase()));
  if(state.view !== 'all') res = res.filter(e => e.type === state.view);
  return res;
}

/* ===================== PIN (lock overlay) ===================== */
function hasSavedPin(){ return !!localStorage.getItem(PIN_KEY); }
function showLockOverlay(){ const overlay = qs('#app-lock-overlay'); if(!overlay) return; overlay.classList.remove('hidden'); overlay.setAttribute('aria-hidden','false'); showOnly(null); }
function hideLockOverlay(){ const overlay = qs('#app-lock-overlay'); if(!overlay) return; overlay.classList.add('hidden'); overlay.setAttribute('aria-hidden','true'); showOnly('main'); }
function promptForPinOnLoad(){ if(hasSavedPin()){ isUnlocked = false; showLockOverlay(); } else { isUnlocked = true; hideLockOverlay(); } }
function verifyPinAttempt(pin){ const saved = localStorage.getItem(PIN_KEY); if(!saved) return true; return pin === saved; }
function setPinFlow(){ const existing = localStorage.getItem(PIN_KEY); if(existing){ const ok = prompt('Ya hay un PIN. Para modificarlo, introduce el PIN actual:'); if (!ok) return; if (ok !== existing){ showToast('PIN incorrecto', { type:'error' }); return; } } const pin = prompt('Introduce un PIN de 4 dígitos (guárdalo en un lugar seguro):'); if (!pin) return; if (!/^[0-9]{4}$/.test(pin)){ showToast('PIN inválido. Deben ser 4 dígitos.', { type:'error' }); return; } localStorage.setItem(PIN_KEY, pin); showToast('PIN guardado localmente.'); }

/* ===================== UI setup ===================== */
function setupUI(){
  // empezar mostrando la UI principal
  showOnly('main');

  // modal & entry form
  const modal = qs('#modal'); const modalTitle = qs('#modal-title');
  const typeInput = qs('#type'); const amountInput = qs('#amount'); const dateInput = qs('#date'); const noteInput = qs('#note'); const categorySelect = qs('#category');
  dateInput.value = new Date().toISOString().slice(0,10);

  const openModal = (mode)=>{
    typeInput.value = mode === 'income' ? 'income' : 'expense';
    modalTitle.textContent = mode === 'income' ? 'Agregar ingreso' : 'Agregar egreso';
    amountInput.value = ''; noteInput.value = '';
    categorySelect.value = state.categories[0]?.id || 'c-uncategorized';
    modal.classList.remove('hidden'); modal.setAttribute('aria-hidden','false');
    amountInput.focus();
  };
  const closeModal = ()=>{ modal.classList.add('hidden'); modal.setAttribute('aria-hidden','true'); hideModalIfNoOverlay(); };

  qs('#add-income')?.addEventListener('click', ()=> { if(!isUnlocked){ showToast('Debes desbloquear la app antes de añadir registros.', { type:'error' }); return; } openModal('income'); });
  qs('#add-expense')?.addEventListener('click', ()=> { if(!isUnlocked){ showToast('Debes desbloquear la app antes de añadir registros.', { type:'error' }); return; } openModal('expense'); });
  qs('#close-modal')?.addEventListener('click', closeModal);
  qs('#cancel-modal')?.addEventListener('click', closeModal);

  qs('#entry-form')?.addEventListener('submit', (ev)=>{
    ev.preventDefault();
    if(!isUnlocked){ showToast('Debes desbloquear la app antes de añadir registros.', { type:'error' }); return; }
    const data = { type: typeInput.value, amount: parseFloat(amountInput.value) || 0, date: dateInput.value, note: noteInput.value.trim(), categoryId: categorySelect.value };
    if(!data.amount || data.amount <= 0){ showToast('Ingresa un monto válido', { type:'error' }); return; }
    addEntry(data);
    closeModal();
  });

  // segmented buttons
  qsa('.seg-btn').forEach(btn => btn.addEventListener('click', ()=>{ state.view = btn.dataset.view; render(); }));

  // menu behavior
  const menuBtn = qs('#menu-btn'); const menuPanel = qs('#menu-panel');
  menuBtn?.addEventListener('click', ()=>{ const hidden = menuPanel.classList.toggle('hidden'); menuPanel.setAttribute('aria-hidden', hidden ? 'true' : 'false'); });

  // show/hide filters by toggle in menu
  qs('#show-filters-btn')?.addEventListener('click', ()=>{
    const sec = qs('#filters-section');
    if(sec.classList.contains('hidden')) sec.classList.remove('hidden'); else sec.classList.add('hidden');
    // close menu to avoid superposición
    if(menuPanel && !menuPanel.classList.contains('hidden')) { menuPanel.classList.add('hidden'); menuPanel.setAttribute('aria-hidden','true'); }
  });

  // export modal
  qs('#export-open')?.addEventListener('click', ()=> {
    if(menuPanel && !menuPanel.classList.contains('hidden')) { menuPanel.classList.add('hidden'); menuPanel.setAttribute('aria-hidden','true'); }
    openExportModal();
  });

  qs('#import-json')?.addEventListener('click', ()=> qs('#import-file')?.click());
  qs('#import-file')?.addEventListener('change', async (ev)=>{
    if(!isUnlocked){ showToast('Desbloquea la app antes de importar.', { type:'error' }); ev.target.value=''; return; }
    const f = ev.target.files[0]; if(!f) return; const text = await f.text();
    try{
      const imported = JSON.parse(text);
      if(Array.isArray(imported)){
        const existingIds = new Set(state.entries.map(e=>e.id));
        const filtered = imported.filter(i => !existingIds.has(i.id));
        state.entries = filtered.concat(state.entries);
      } else {
        state.entries = (imported.entries || []).concat(state.entries);
        state.categories = mergeCategories(state.categories, imported.categories || []);
        state.budgets = { ...state.budgets, ...(imported.budgets || {}) };
      }
      saveState(); render(); showToast('Importación exitosa.');
    }catch(err){
      showToast('No se pudo importar: ' + err.message, { type:'error' });
    } finally {
      ev.target.value = '';
    }
  });

  qs('#clear-data')?.addEventListener('click', clearAll);
  qs('#about')?.addEventListener('click', ()=> alert('Mi bolsillo — PWA · Los datos se almacenan únicamente en tu dispositivo.'));

  // filters
  qs('#apply-filters')?.addEventListener('click', ()=>{ state.filters.start = qs('#filter-start').value || null; state.filters.end = qs('#filter-end').value || null; state.filters.query = qs('#filter-note').value || ''; render(); });
  qs('#clear-filters')?.addEventListener('click', ()=>{ qs('#filter-start').value=''; qs('#filter-end').value=''; qs('#filter-note').value=''; state.filters = { start:null, end:null, query:'' }; render(); });

  // categories modal:
  qs('#manage-categories')?.addEventListener('click', ()=> {
    if(!isUnlocked){ showToast('Desbloquea la app para gestionar categorías.', { type:'error' }); return; }
    if(menuPanel && !menuPanel.classList.contains('hidden')){ menuPanel.classList.add('hidden'); menuPanel.setAttribute('aria-hidden','true'); }
    qs('#cat-modal')?.classList.remove('hidden'); qs('#cat-modal')?.setAttribute('aria-hidden','false');
    renderCategories();
  });
  qs('#close-cat-modal')?.addEventListener('click', ()=> { qs('#cat-modal')?.classList.add('hidden'); qs('#cat-modal')?.setAttribute('aria-hidden','true'); hideModalIfNoOverlay(); });
  qs('#close-cat-ok')?.addEventListener('click', ()=> { qs('#cat-modal')?.classList.add('hidden'); qs('#cat-modal')?.setAttribute('aria-hidden','true'); hideModalIfNoOverlay(); });

  qs('#category-form')?.addEventListener('submit', (ev)=>{
    ev.preventDefault();
    if(!isUnlocked){ showToast('Desbloquea la app antes de crear categorías.', { type:'error' }); return; }
    const name = qs('#cat-name').value.trim();
    const type = qs('#cat-type').value;
    const budget = qs('#cat-budget').value;
    if(!name) return showToast('Ingresa un nombre de categoría', { type:'error' });
    addCategory({ name, type, budget });
    qs('#cat-name').value=''; qs('#cat-budget').value='';
  });

  qs('#set-pin')?.addEventListener('click', () => setPinFlow());

  // PIN overlay form
  const pinForm = qs('#pin-form'); const pinInput = qs('#pin-input');
  pinForm?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const pin = pinInput.value.trim();
    if(verifyPinAttempt(pin)){
      isUnlocked = true; hideLockOverlay(); pinInput.value = ''; render();
    } else {
      showToast('PIN incorrecto', { type:'error' }); pinInput.value = ''; pinInput.focus();
    }
  });

  // close menu when clicking outside
  document.addEventListener('click', (ev)=>{
    if(!menuPanel || menuPanel.classList.contains('hidden')) return;
    const menuBtn = qs('#menu-btn');
    if(ev.target === menuPanel || menuPanel.contains(ev.target) || ev.target === menuBtn) return;
    menuPanel.classList.add('hidden'); menuPanel.setAttribute('aria-hidden','true');
  });

  // double-click delete on entries list
  qs('#entries-list')?.addEventListener('dblclick', (ev) => {
    const li = ev.target.closest('.entry'); if(!li) return; const id = li.dataset.id;
    if(confirm('¿Eliminar este registro?')) deleteEntry(id);
  });

  // keyboard shortcut: n opens income modal (unless locked)
  window.addEventListener('keydown', (ev) => {
    if(ev.key.toLowerCase() === 'n' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){
      if(!isUnlocked){ showToast('Debes desbloquear la app antes de crear registros.', { type:'error' }); return; }
      qs('#add-income')?.click();
    }
  });

  // Export modal UI wiring
  const exportModal = qs('#export-modal');
  const exportForm = qs('#export-form');
  const exportScopeSel = qs('#export-scope');
  const panels = document.querySelectorAll('.export-scope-panel');

  function openExportModal(){
    exportModal.classList.remove('hidden'); exportModal.setAttribute('aria-hidden','false'); renderCategories();
    qs('#export-format').value = 'csv'; exportScopeSel.value = 'all'; panels.forEach(p => p.classList.add('hidden'));
  }
  function closeExportModal(){ exportModal.classList.add('hidden'); exportModal.setAttribute('aria-hidden','true'); hideModalIfNoOverlay(); }
  qs('#close-export-modal')?.addEventListener('click', closeExportModal);
  qs('#cancel-export')?.addEventListener('click', closeExportModal);
  exportScopeSel?.addEventListener('change', (ev)=>{ panels.forEach(p => p.classList.add('hidden')); const v = ev.target.value; if(v === 'category') qs('#export-scope-category')?.classList.remove('hidden'); if(v === 'date') qs('#export-scope-date')?.classList.remove('hidden'); if(v === 'notes') qs('#export-scope-notes')?.classList.remove('hidden'); if(v === 'type') qs('#export-scope-type')?.classList.remove('hidden'); });
  exportForm?.addEventListener('submit', (ev)=>{
    ev.preventDefault();
    if(!isUnlocked){ showToast('Desbloquea la app antes de exportar.', { type:'error' }); return; }
    const fmt = qs('#export-format').value; const scope = exportScopeSel.value; const filters = { scope };
    if(scope === 'category') filters.categoryId = qs('#export-category').value;
    if(scope === 'date'){ filters.start = qs('#export-start').value || null; filters.end = qs('#export-end').value || null; }
    if(scope === 'notes') filters.notesText = qs('#export-notes-text').value || '';
    if(scope === 'type') filters.type = qs('#export-type').value;
    if(fmt === 'csv') exportCSVWithFilters(filters); else if(fmt === 'pdf') exportPDFWithFilters(filters); else exportJSONWithFilters(filters);
    closeExportModal();
  });

  render();
}

/* hide modal wrapper depending on PIN overlay presence */
function hideModalIfNoOverlay(){
  if(hasSavedPin() && !isUnlocked) showLockOverlay();
  else showOnly('main');
}

/* merge categories import avoiding duplicates by name */
function mergeCategories(existing, incoming){
  const map = Object.fromEntries(existing.map(c => [c.name.toLowerCase(), c]));
  for(const ic of incoming){ if(!map[ic.name.toLowerCase()]) map[ic.name.toLowerCase()] = ic; }
  return Object.values(map);
}

/* ===================== Backup automatico y PWA ===================== */
function scheduleBackup(){ try{ const last = localStorage.getItem('mi-bolsillo:last-backup') || 0; const now = Date.now(); if(now - last > BACKUP_INTERVAL_MS){ localStorage.setItem('mi-bolsillo:last-backup', now); const data = JSON.stringify({ entries: state.entries, categories: state.categories, budgets: state.budgets }, null, 2); const blob = new Blob([data], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `mi-bolsillo-autobackup-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url); } }catch(e){console.warn(e)} }
function applyTheme(name){ if(name === 'light'){ document.documentElement.classList.add('light'); document.body.classList.add('light'); } else { document.documentElement.classList.remove('light'); document.body.classList.remove('light'); } }
function setupPWA(){ if('serviceWorker' in navigator){ navigator.serviceWorker.register('service-worker.js').then(r => console.log('SW registrado', r)).catch(e => console.warn('SW falló', e)); } let deferredPrompt = null; window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; const installBtn = document.createElement('button'); installBtn.textContent = 'Instalar app'; installBtn.className = 'btn'; installBtn.onclick = async () => { installBtn.disabled = true; deferredPrompt.prompt(); const choice = await deferredPrompt.userChoice; if(choice.outcome === 'accepted') console.log('App instalada'); deferredPrompt = null; installBtn.remove(); }; qs('.menu-panel')?.appendChild(installBtn); }); }

/* ===================== Init / Boot ===================== */
function boot(){
  const theme = localStorage.getItem(THEME_KEY) || (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  applyTheme(theme);
  setupUI();
  promptForPinOnLoad();
  scheduleBackup();
  setupPWA();
  render();
}
document.addEventListener('DOMContentLoaded', boot);
