'use strict';

// RITMO: datos locales. No se realizan solicitudes a servicios externos.
const STORE_KEY = 'ritmo_habitos_v1';
const TODAY = () => dateKey(new Date());
let state = readState();
let currentRoute = 'inicio';
let selectedHabitId = state.habits[0]?.id ?? null;
let calendarMonth = new Date().getMonth();
let calendarYear = new Date().getFullYear();
let lastDayRendered = TODAY();
let toastTimeout;
const $ = (id) => document.getElementById(id);
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);
function makeId() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

function dateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}
function dayOffset(dateStr, offset) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d, 12, 0);
  date.setDate(date.getDate() + offset);
  return dateKey(date);
}
function localDateTime(ms = Date.now()) {
  const d = new Date(ms);
  return `${dateKey(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function formatStart(iso) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
}
function validDay(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  if (y < 1970 || y > 2100) return false;
  const check = new Date(y, m - 1, d, 12);
  return check.getFullYear() === y && check.getMonth() + 1 === m && check.getDate() === d;
}
function normalize(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.habits) || !Array.isArray(data.timers)) throw Error('Formato de copia no reconocido.');
  if (data.habits.length > 200 || data.timers.length > 200) throw Error('La copia supera el límite de elementos.');
  const ids = new Set();
  const uniqueId = (id) => {
    const safe = typeof id === 'string' && id.length <= 100 && id.trim() ? id : makeId();
    if (ids.has(safe)) return makeId();
    ids.add(safe); return safe;
  };
  const habits = data.habits.map((x) => {
    if (!x || typeof x.name !== 'string' || !x.name.trim()) throw Error('La copia tiene un hábito inválido.');
    return {
      id: uniqueId(x.id), name: x.name.trim().slice(0, 70),
      emoji: String(x.emoji || '✨').slice(0, 8),
      marked: Array.from(new Set((Array.isArray(x.marked) ? x.marked : []).filter(validDay))).slice(0, 50000)
    };
  });
  const timers = data.timers.map((x) => {
    if (!x || typeof x.name !== 'string' || !x.name.trim()) throw Error('La copia tiene un cronómetro inválido.');
    const startMs = Date.parse(x.start);
    if (!Number.isFinite(startMs) || startMs > Date.now() + 60000 || startMs < Date.parse('1970-01-01')) throw Error('La copia contiene una fecha de racha inválida.');
    return {
      id: uniqueId(x.id), name: x.name.trim().slice(0, 70), emoji: String(x.emoji || '⏱️').slice(0, 8),
      start: new Date(startMs).toISOString(),
      bestMs: Number.isFinite(x.bestMs) ? Math.max(0, Math.min(x.bestMs, 5e14)) : 0,
      resets: Number.isSafeInteger(x.resets) && x.resets >= 0 ? x.resets : 0
    };
  });
  return { version: 1, habits, timers };
}
function readState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? normalize(JSON.parse(raw)) : { version: 1, habits: [], timers: [] };
  } catch (e) {
    console.warn('Error de lectura: ', e);
    return { version: 1, habits: [], timers: [] };
  }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); return true; }
  catch (e) { toast('No se pudieron guardar los datos. Exportá una copia.'); return false; }
}
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.remove('visible'), 3200);
}
function habitStats(habit) {
  const days = new Set(habit.marked);
  const today = TODAY();
  let cursor = days.has(today) ? today : dayOffset(today, -1);
  let current = 0;
  while (days.has(cursor) && current < 100000) { current++; cursor = dayOffset(cursor, -1); }
  const markedSorted = Array.from(days).sort();
  let best = 0, run = 0, prev = null;
  for (const day of markedSorted) {
    run = prev && dayOffset(prev, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  return { current, best, done: days.has(today), total: days.size };
}
function hCard(habit, withDetails = false) {
  const stats = habitStats(habit);
  const selected = selectedHabitId === habit.id;
  return `<article class="habit-card ${stats.done ? 'done' : ''} ${selected && withDetails ? 'selected-card' : ''}">
    <span class="habit-emoji" aria-hidden="true">${esc(habit.emoji)}</span>
    <div class="habit-info"><div class="habit-name">${esc(habit.name)}</div>
      <div class="habit-meta">🔥 ${stats.current} ${stats.current === 1 ? 'día' : 'días'} seguidos · Récord ${stats.best}</div>
    </div>
    ${withDetails ? `<button type="button" class="subtle-menu" data-action="select-habit" data-id="${esc(habit.id)}" aria-label="Ver calendario de ${esc(habit.name)}">▦</button>` : ''}
    <button type="button" class="check-button ${stats.done ? 'checked' : ''}" data-action="toggle-today" data-id="${esc(habit.id)}" aria-label="${stats.done ? 'Desmarcar' : 'Marcar'} ${esc(habit.name)} hoy" aria-pressed="${stats.done}">${stats.done ? '✓' : ''}</button>
  </article>`;
}
function elapsedMs(timer) { return Math.max(0, Date.now() - Date.parse(timer.start)); }
function splitDuration(ms) {
  const sec = Math.floor(Math.max(0, ms) / 1000);
  return {
    days: Math.floor(sec / 86400), hours: Math.floor((sec % 86400) / 3600),
    minutes: Math.floor((sec % 3600) / 60), seconds: sec % 60
  };
}
function timerDigits(timer) {
  const id = esc(timer.id);
  return `<div class="timer-digits" data-clock="${id}">
    <div class="digit-box"><strong data-unit="days">0</strong><small>días</small></div>
    <div class="digit-box"><strong data-unit="hours">00</strong><small>horas</small></div>
    <div class="digit-box"><strong data-unit="minutes">00</strong><small>min</small></div>
    <div class="digit-box"><strong data-unit="seconds">00</strong><small>seg</small></div>
  </div>`;
}
function tCard(timer, withControls = false) {
  const ms = elapsedMs(timer);
  const best = splitDuration(Math.max(ms, timer.bestMs)).days;
  return `<article class="timer-card">
    <div class="timer-top"><span class="timer-emoji" aria-hidden="true">${esc(timer.emoji)}</span>
    <div class="timer-main"><div class="timer-title">${esc(timer.name)}</div><div class="timer-meta">Desde ${esc(formatStart(timer.start))}</div></div>
    </div>
    ${timerDigits(timer)}
    <div class="timer-footer"><span>🏆 Récord: <b data-best-timer="${esc(timer.id)}">${best} días</b></span><span>${timer.resets} ${timer.resets === 1 ? 'reinicio' : 'reinicios'}</span></div>
    ${withControls ? `<div class="timer-actions"><button type="button" data-action="edit-timer" data-id="${esc(timer.id)}">Editar</button><button type="button" class="reset" data-action="reset-timer" data-id="${esc(timer.id)}">Reiniciar racha</button><button type="button" data-action="delete-timer" data-id="${esc(timer.id)}">Eliminar</button></div>` : ''}
  </article>`;
}
function empty(title, label, action) {
  return `<div class="empty-state"><span class="empty-symbol">✳</span><p>${title}</p><button type="button" data-action="${action}">${label}</button></div>`;
}
function render() {
  const today = new Date();
  $('today-label').textContent = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }).format(today);
  const counts = state.habits.map(habitStats);
  const completedToday = counts.filter(x => x.done).length;
  const total = counts.length;
  const percent = total ? Math.round(100 * completedToday / total) : 0;
  $('today-progress').textContent = `${completedToday} / ${total}`;
  $('progress-percent').textContent = `${percent}%`;
  $('progress-ring').style.setProperty('--percent', `${percent}%`);
  $('progress-message').textContent = !total ? 'Empezá creando un hábito' : completedToday === total ? '¡Todos completos por hoy!' : `${total - completedToday} ${total - completedToday === 1 ? 'pendiente' : 'pendientes'} hoy`;
  $('best-daily').textContent = String(Math.max(0, ...counts.map(x => x.best)));
  $('home-habits').innerHTML = total ? state.habits.map(h => hCard(h)).join('') : empty('Todavía no tenés hábitos registrados.', 'Crear mi primer hábito', 'add-habit');
  $('home-timers').innerHTML = state.timers.length ? state.timers.map(t => tCard(t)).join('') : empty('Registrá el tiempo que llevás sosteniendo una racha.', 'Crear mi primera racha', 'add-timer');
  $('habits-list').innerHTML = total ? state.habits.map(h => hCard(h, true)).join('') : empty('Agregá un hábito para empezar a llevar registro.', 'Agregar hábito', 'add-habit');
  $('timers-list').innerHTML = state.timers.length ? state.timers.map(t => tCard(t, true)).join('') : empty('Todavía no creaste ninguna racha con cronómetro.', 'Crear cronómetro', 'add-timer');
  $('total-marks').textContent = String(counts.reduce((sum, x) => sum + x.total, 0));
  if (!total) $('week-rate').textContent = '—';
  else {
    let completed = 0;
    for (const h of state.habits) {
      const marks = new Set(h.marked);
      for (let i = 0; i < 7; i++) if (marks.has(dayOffset(TODAY(), -i))) completed++;
    }
    $('week-rate').textContent = `${Math.round(100 * completed / (total * 7))}%`;
  }
  if (!state.habits.some(h => h.id === selectedHabitId)) selectedHabitId = state.habits[0]?.id ?? null;
  renderCalendar();
  updateTimers();
}
function renderCalendar() {
  const panel = $('calendar-panel');
  const habit = state.habits.find(h => h.id === selectedHabitId);
  if (!habit) { panel.hidden = true; return; }
  panel.hidden = false;
  $('calendar-title').textContent = habit.name;
  const month = new Date(calendarYear, calendarMonth, 1, 12);
  $('calendar-month').textContent = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(month);
  const now = new Date();
  $('calendar-next').disabled = calendarYear > now.getFullYear() || (calendarYear === now.getFullYear() && calendarMonth >= now.getMonth());
  const firstWeekday = (month.getDay() + 6) % 7;
  const last = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const days = new Set(habit.marked);
  let html = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(day => `<div class="calendar-weekday">${day}</div>`).join('');
  for (let i = 0; i < firstWeekday; i++) html += '<span class="calendar-spacer"></span>';
  for (let day = 1; day <= last; day++) {
    const key = dateKey(new Date(calendarYear, calendarMonth, day, 12));
    const future = key > TODAY();
    html += `<button type="button" class="calendar-day ${days.has(key) ? 'completed' : ''} ${key === TODAY() ? 'current' : ''} ${future ? 'future' : ''}" data-action="toggle-calendar" data-day="${key}" ${future ? 'disabled' : ''} aria-label="${day} ${days.has(key) ? 'completado' : 'pendiente'}">${days.has(key) ? '✓' : day}</button>`;
  }
  $('calendar-grid').innerHTML = html;
}
function updateTimers() {
  for (const clock of document.querySelectorAll('[data-clock]')) {
    const t = state.timers.find(x => x.id === clock.dataset.clock);
    if (!t) continue;
    const d = splitDuration(elapsedMs(t));
    for (const [unit, val] of Object.entries(d)) {
      const el = clock.querySelector(`[data-unit="${unit}"]`);
      if (el) el.textContent = unit === 'days' ? String(val) : String(val).padStart(2, '0');
    }
  }
  for (const label of document.querySelectorAll('[data-best-timer]')) {
    const t = state.timers.find(x => x.id === label.dataset.bestTimer);
    if (t) label.textContent = `${splitDuration(Math.max(elapsedMs(t), t.bestMs)).days} días`;
  }
}
function navigate(route) {
  currentRoute = route;
  for (const screen of document.querySelectorAll('.screen')) screen.classList.toggle('active', screen.id === `screen-${route}`);
  for (const tab of document.querySelectorAll('.nav-item')) {
    const active = tab.dataset.route === route;
    tab.classList.toggle('active', active);
    if (active) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
  render();
}
function openDialog(dialog) {
  if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
}
function closeDialogs() {
  for (const dlg of document.querySelectorAll('dialog')) if (dlg.open) dlg.close();
}
function openHabit(id = '') {
  const habit = state.habits.find(h => h.id === id);
  $('habit-id').value = habit?.id || '';
  $('habit-name').value = habit?.name || '';
  $('habit-emoji').value = habit?.emoji || '✨';
  $('habit-dialog-title').textContent = habit ? 'Editar hábito' : 'Nuevo hábito';
  removeHabit.hidden = !habit;
  openDialog($('habit-dialog'));
  $('habit-name').focus();
}
function openTimer(id = '') {
  const timer = state.timers.find(t => t.id === id);
  $('timer-id').value = timer?.id || '';
  $('timer-name').value = timer?.name || '';
  $('timer-emoji').value = timer?.emoji || '⏱️';
  $('timer-start').value = localDateTime(timer ? Date.parse(timer.start) : Date.now());
  $('timer-start').max = localDateTime();
  $('timer-dialog-title').textContent = timer ? 'Editar racha' : 'Nueva racha';
  openDialog($('timer-dialog'));
  $('timer-name').focus();
}
function toggleHabit(habit, key) {
  if (!habit || key > TODAY()) return;
  const marks = new Set(habit.marked);
  if (marks.has(key)) marks.delete(key); else marks.add(key);
  habit.marked = Array.from(marks).sort();
  save(); render();
}
function runAction(action, element) {
  const id = element.dataset.id || '';
  const habit = state.habits.find(h => h.id === id);
  const timer = state.timers.find(t => t.id === id);
  switch (action) {
    case 'add-habit': openHabit(); break;
    case 'add-timer': openTimer(); break;
    case 'toggle-today': toggleHabit(habit, TODAY()); break;
    case 'select-habit':
      selectedHabitId = id;
      calendarMonth = new Date().getMonth(); calendarYear = new Date().getFullYear();
      render(); $('calendar-panel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      break;
    case 'toggle-calendar': toggleHabit(state.habits.find(h => h.id === selectedHabitId), element.dataset.day); break;
    case 'edit-timer': openTimer(id); break;
    case 'delete-timer':
      if (timer && confirm(`¿Eliminar la racha “${timer.name}”? Esta acción no se puede deshacer.`)) {
        state.timers = state.timers.filter(t => t.id !== id); save(); render(); toast('Racha eliminada.');
      }
      break;
    case 'reset-timer':
      if (timer && confirm(`¿Reiniciar “${timer.name}” desde ahora? Se conservará su récord anterior, pero no se podrá deshacer.`)) {
        timer.bestMs = Math.max(timer.bestMs, elapsedMs(timer));
        timer.start = new Date().toISOString(); timer.resets += 1;
        save(); render(); toast('Racha reiniciada.');
      }
      break;
  }
}

document.addEventListener('click', (ev) => {
  const nav = ev.target.closest('[data-route]');
  if (nav) { navigate(nav.dataset.route); return; }
  const btn = ev.target.closest('[data-action]');
  if (btn) { runAction(btn.dataset.action, btn); return; }
  if (ev.target.closest('[data-close-dialog]')) closeDialogs();
});
$('home-add-habit').onclick = $('habits-add').onclick = () => openHabit();
$('home-add-timer').onclick = $('timers-add').onclick = () => openTimer();
$('edit-selected-habit').onclick = () => openHabit(selectedHabitId);
$('calendar-prev').onclick = () => { const d = new Date(calendarYear, calendarMonth - 1, 1); calendarYear = d.getFullYear(); calendarMonth = d.getMonth(); renderCalendar(); };
$('calendar-next').onclick = () => { const d = new Date(calendarYear, calendarMonth + 1, 1); if (d <= new Date()) { calendarYear = d.getFullYear(); calendarMonth = d.getMonth(); renderCalendar(); } };
$('habit-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('habit-name').value.trim();
  if (!name) return;
  const emoji = $('habit-emoji').value.trim() || '✨';
  const current = state.habits.find(h => h.id === $('habit-id').value);
  if (current) { current.name = name; current.emoji = emoji; }
  else {
    const habit = { id: makeId(), name, emoji, marked: [] };
    state.habits.push(habit); selectedHabitId = habit.id;
  }
  save(); closeDialogs(); navigate('habitos'); toast(current ? 'Hábito actualizado.' : 'Hábito creado.');
});
$('timer-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('timer-name').value.trim();
  const timestamp = new Date($('timer-start').value).getTime();
  if (!name || !Number.isFinite(timestamp) || timestamp > Date.now()) { toast('Elegí una fecha y hora que no sean futuras.'); return; }
  const emoji = $('timer-emoji').value.trim() || '⏱️';
  const timer = state.timers.find(t => t.id === $('timer-id').value);
  if (timer) {
    timer.name = name; timer.emoji = emoji;
    timer.start = new Date(timestamp).toISOString();
  } else state.timers.push({ id: makeId(), name, emoji, start: new Date(timestamp).toISOString(), bestMs: 0, resets: 0 });
  save(); closeDialogs(); navigate('rachas'); toast(timer ? 'Racha actualizada.' : 'Racha creada.');
});
// Eliminar un hábito desde su editor, sin interferir con el historial de otros.
const removeHabit = document.createElement('button');
removeHabit.type = 'button'; removeHabit.className = 'danger-button';
removeHabit.textContent = 'Eliminar hábito';
removeHabit.style.marginTop = '8px';
removeHabit.onclick = () => {
  const habit = state.habits.find(h => h.id === $('habit-id').value);
  if (habit && confirm(`¿Eliminar el hábito “${habit.name}” y todo su historial?`)) {
    state.habits = state.habits.filter(h => h.id !== habit.id);
    selectedHabitId = state.habits[0]?.id || null;
    save(); closeDialogs(); render(); toast('Hábito eliminado.');
  }
};
$('habit-form').append(removeHabit);

$('export-data').onclick = () => {
  const backup = { application: 'Ritmo', exportedAt: new Date().toISOString(), ...state };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `ritmo-respaldo-${TODAY()}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast('Copia preparada. Revisá tus descargas.');
};
$('import-trigger').onclick = () => $('import-file').click();
$('import-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw Error('Archivo demasiado grande (máximo 10 MB).');
    const parsed = JSON.parse(await file.text());
    const restored = normalize(parsed);
    if (!confirm(`¿Reemplazar los datos actuales con ${restored.habits.length} hábitos y ${restored.timers.length} rachas del archivo?`)) return;
    state = restored;
    selectedHabitId = state.habits[0]?.id || null;
    save(); navigate('inicio'); toast('Copia restaurada correctamente.');
  } catch (error) { alert(`No se pudo importar: ${error.message}`); }
  finally { event.target.value = ''; }
});
$('clear-data').onclick = () => {
  if (!confirm('¿Borrar TODOS los hábitos, las marcas y los cronómetros? Exportá una copia primero si los necesitás.')) return;
  if (!confirm('Última confirmación: ¿querés eliminar todos tus registros de este dispositivo?')) return;
  state = { version: 1, habits: [], timers: [] }; selectedHabitId = null;
  save(); navigate('inicio'); toast('Datos borrados.');
};

render();
setInterval(() => {
  updateTimers();
  if (lastDayRendered !== TODAY()) { lastDayRendered = TODAY(); render(); }
}, 1000);
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Sin modo offline:', err));
}
