// ---------------------------------------------------------------------------
// Springline — front-end logic
// Talks to /api/water_log, /api/get_water_log and /api/generate_plan
// (Flask backend, see server.py). Falls back to localStorage if the
// backend isn't reachable (e.g. when this file is opened directly
// instead of served through the Flask app).
// ---------------------------------------------------------------------------

const API = {
  waterLog: '/api/water_log',
  waterGet: '/api/get_water_log',
  plan: '/api/generate_plan',
};

const todayKey = () => new Date().toISOString().slice(0, 10);

const state = {
  profile: JSON.parse(localStorage.getItem('sl_profile') || 'null'),
  water: {
    goal: Number(localStorage.getItem('sl_water_goal') || 8),
    count: 0,
    date: todayKey(),
    log: [],
  },
  reminderTimer: null,
};

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
document.querySelectorAll('.rail-btn').forEach(btn => {
  btn.addEventListener('click', () => showPanel(btn.dataset.panel));
});
document.querySelectorAll('[data-goto]').forEach(btn => {
  btn.addEventListener('click', () => showPanel(btn.dataset.goto));
});

function showPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('is-active'));
  document.querySelectorAll('.rail-btn').forEach(b => b.classList.remove('is-active'));
  document.getElementById(`panel-${name}`).classList.add('is-active');
  const btn = document.querySelector(`.rail-btn[data-panel="${name}"]`);
  if (btn) btn.classList.add('is-active');
}

// ---------------------------------------------------------------------------
// Toast helper
// ---------------------------------------------------------------------------
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

// ---------------------------------------------------------------------------
// Water tracker
// ---------------------------------------------------------------------------
async function loadWater() {
  try {
    const res = await fetch(`${API.waterGet}?date=${todayKey()}`);
    if (!res.ok) throw new Error('no backend');
    const data = await res.json();
    state.water.count = data.count || 0;
    state.water.log = data.log || [];
  } catch (e) {
    // fall back to localStorage
    const saved = JSON.parse(localStorage.getItem('sl_water_' + todayKey()) || 'null');
    if (saved) {
      state.water.count = saved.count;
      state.water.log = saved.log;
    }
  }
  renderWater();
}

async function persistWater() {
  localStorage.setItem('sl_water_' + todayKey(), JSON.stringify({
    count: state.water.count,
    log: state.water.log,
  }));
  try {
    await fetch(API.waterLog, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: todayKey(),
        count: state.water.count,
        log: state.water.log,
      }),
    });
  } catch (e) {
    // offline / no backend — localStorage already has it
  }
}

function addGlass(delta) {
  const next = state.water.count + delta;
  if (next < 0) return;
  state.water.count = next;
  if (delta > 0) {
    state.water.log.push(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  } else {
    state.water.log.pop();
  }
  renderWater();
  persistWater();
}

function renderWater() {
  const goal = state.water.goal;
  const count = state.water.count;
  const pct = Math.max(0, Math.min(1, count / goal));
  const ml = count * 250;

  ['today', 'big'].forEach(scope => {
    const countEl = document.getElementById(`water-count-${scope}`);
    const goalEl = document.getElementById(`water-goal-${scope}`);
    if (countEl) countEl.textContent = count;
    if (goalEl) goalEl.textContent = goal;
  });
  document.getElementById('water-ml').textContent = ml;

  fillBottle('water-fill-mini', 220, pct);
  fillBottle('water-fill-big', 300, pct);

  const logList = document.getElementById('water-log-list');
  if (state.water.log.length === 0) {
    logList.innerHTML = '<li class="empty-note">No glasses logged yet.</li>';
  } else {
    logList.innerHTML = state.water.log.map(t => `<li>${t}</li>`).join('');
  }
}

function fillBottle(id, svgHeight, pct) {
  const rect = document.getElementById(id);
  if (!rect) return;
  const maxFill = svgHeight - 20; // leave a little margin at top
  const h = maxFill * pct;
  rect.setAttribute('height', h);
  rect.setAttribute('y', svgHeight - h - 4);
  rect.setAttribute('fill', pct >= 1 ? '#3F7D6C' : (pct < 0.35 ? '#E7A33E' : '#3F7D6C'));
}

document.getElementById('quick-add-water').addEventListener('click', () => addGlass(1));
document.getElementById('add-glass').addEventListener('click', () => addGlass(1));
document.getElementById('remove-glass').addEventListener('click', () => addGlass(-1));

const goalInput = document.getElementById('goal-input');
goalInput.addEventListener('change', () => {
  state.water.goal = Number(goalInput.value) || 8;
  localStorage.setItem('sl_water_goal', state.water.goal);
  renderWater();
});
goalInput.value = state.water.goal;

// ---------------------------------------------------------------------------
// Reminders (browser Notification API)
// ---------------------------------------------------------------------------
const remindersToggle = document.getElementById('reminders-toggle');
const intervalInput = document.getElementById('interval-input');
const notifStatus = document.getElementById('notif-status');

remindersToggle.addEventListener('change', async () => {
  if (remindersToggle.checked) {
    if (!('Notification' in window)) {
      notifStatus.textContent = 'This browser does not support notifications.';
      remindersToggle.checked = false;
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      notifStatus.textContent = 'Notifications blocked — enable them in your browser settings to get reminders.';
      remindersToggle.checked = false;
      return;
    }
    startReminders();
    notifStatus.textContent = `Reminding you every ${intervalInput.value} minutes while this tab is open.`;
  } else {
    stopReminders();
    notifStatus.textContent = 'Reminders are off.';
  }
});
intervalInput.addEventListener('change', () => {
  if (remindersToggle.checked) startReminders();
});

function startReminders() {
  stopReminders();
  const mins = Number(intervalInput.value);
  state.reminderTimer = setInterval(() => {
    if (state.water.count < state.water.goal) {
      new Notification('Time for some water 💧', {
        body: `You're at ${state.water.count}/${state.water.goal} glasses today.`,
      });
    }
  }, mins * 60 * 1000);
}
function stopReminders() {
  if (state.reminderTimer) clearInterval(state.reminderTimer);
  state.reminderTimer = null;
}

// ---------------------------------------------------------------------------
// Profile form
// ---------------------------------------------------------------------------
const profileForm = document.getElementById('profile-form');

function fillFormFromProfile(p) {
  if (!p) return;
  Object.entries(p).forEach(([key, val]) => {
    const field = profileForm.elements.namedItem(key);
    if (field) field.value = val;
  });
}

profileForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(profileForm);
  const profile = Object.fromEntries(fd.entries());
  state.profile = profile;
  localStorage.setItem('sl_profile', JSON.stringify(profile));
  document.getElementById('profile-saved-note').textContent = 'Saved ✓';
  setTimeout(() => { document.getElementById('profile-saved-note').textContent = ''; }, 2500);
  renderTargets();
  toast('Profile saved.');
});

function estimateTargets(p) {
  if (!p) return null;
  const weight = parseFloat(p.weight);
  const height = parseFloat(p.height);
  const age = parseFloat(p.age);
  if (!weight || !height || !age) return null;

  // Mifflin-St Jeor BMR
  let bmr;
  if (p.sex === 'male') bmr = 10 * weight + 6.25 * height - 5 * age + 5;
  else if (p.sex === 'female') bmr = 10 * weight + 6.25 * height - 5 * age - 161;
  else bmr = 10 * weight + 6.25 * height - 5 * age - 78; // midpoint estimate

  const activityFactor = {
    sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, athlete: 1.9,
  }[p.activity] || 1.375;

  let calories = bmr * activityFactor;
  if (p.goal === 'lose_fat') calories -= 400;
  if (p.goal === 'gain_muscle') calories += 300;
  calories = Math.round(calories / 10) * 10;

  // Macro split depends on goal
  let proteinPerKg = 1.2, fatPct = 0.28;
  if (p.goal === 'gain_muscle') proteinPerKg = 1.8;
  if (p.goal === 'lose_fat') proteinPerKg = 1.6;

  const proteinG = Math.round(weight * proteinPerKg);
  const fatG = Math.round((calories * fatPct) / 9);
  const carbG = Math.max(0, Math.round((calories - proteinG * 4 - fatG * 9) / 4));

  return { calories: Math.round(calories), proteinG, carbG, fatG };
}

function renderTargets() {
  const t = estimateTargets(state.profile);
  if (!t) return;
  document.getElementById('m-cal').textContent = `${t.calories} kcal`;
  document.getElementById('m-protein').textContent = `${t.proteinG} g`;
  document.getElementById('m-carb').textContent = `${t.carbG} g`;
  document.getElementById('m-fat').textContent = `${t.fatG} g`;
  document.getElementById('macro-hint').textContent =
    'Estimated with the Mifflin-St Jeor formula based on your profile — a helpful starting point, not medical advice.';

  const budget = state.profile.budget;
  const currency = { INR: '₹', USD: '$', EUR: '€', GBP: '£' }[state.profile.currency] || '';
  document.getElementById('budget-display').textContent = budget ? `${currency}${budget} / day` : '—';
  document.getElementById('goal-display').textContent = labelForGoal(state.profile.goal);
}

function labelForGoal(g) {
  return {
    maintain: 'Maintain weight',
    lose_fat: 'Lose fat',
    gain_muscle: 'Build muscle',
    improve_energy: 'Improve energy',
    manage_condition: 'Manage a condition',
  }[g] || '—';
}

// ---------------------------------------------------------------------------
// Meal plan generation
// ---------------------------------------------------------------------------
const generateBtn = document.getElementById('generate-plan-btn');
const planStatus = document.getElementById('plan-status');
const planOutput = document.getElementById('meal-plan-output');

generateBtn.addEventListener('click', async () => {
  if (!state.profile) {
    showPlanStatus('Save your profile first — head to the Profile & budget tab.', true);
    showPanel('profile');
    return;
  }
  const targets = estimateTargets(state.profile);
  generateBtn.disabled = true;
  generateBtn.textContent = 'Thinking…';
  showPlanStatus('Asking the planner for meals that fit your budget and macros…', false);

  try {
    const res = await fetch(API.plan, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: state.profile, targets }),
    });
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error('Backend did not return valid JSON: ' + raw.slice(0, 200)); }
    if (!res.ok || data.error) throw new Error(data.error || 'Unknown error from server.');

    renderPlan(data);
    localStorage.setItem('sl_last_plan', JSON.stringify(data));
    showPlanStatus('Here\'s today\'s plan, built around your targets and budget.', false);
    renderNextMeal(data);
  } catch (err) {
    console.error(err);
    showPlanStatus(`Couldn't generate a plan: ${err.message}`, true);
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "Generate today's plan";
  }
});

function showPlanStatus(msg, isError) {
  planStatus.hidden = false;
  planStatus.textContent = msg;
  planStatus.classList.toggle('is-error', !!isError);
}

function renderPlan(data) {
  const currency = { INR: '₹', USD: '$', EUR: '€', GBP: '£' }[state.profile.currency] || '';
  const meals = data.meals || [];
  let html = '';

  if (data.summary) {
    html += `
      <div class="meal-card plan-summary">
        <span class="meal-slot">DAY SUMMARY</span>
        <h3>${escapeHtml(data.summary.title || 'Your plan today')}</h3>
        <p class="meal-desc">${escapeHtml(data.summary.note || '')}</p>
        <div class="macro-row">
          <span>Total cost: <strong>${currency}${data.summary.total_cost ?? '—'}</strong></span>
          <span>Calories: <strong>${data.summary.total_calories ?? '—'}</strong></span>
          <span>Protein: <strong>${data.summary.total_protein_g ?? '—'} g</strong></span>
          <span>Carbs: <strong>${data.summary.total_carb_g ?? '—'} g</strong></span>
          <span>Fat: <strong>${data.summary.total_fat_g ?? '—'} g</strong></span>
        </div>
      </div>`;
  }

  meals.forEach(m => {
    html += `
      <div class="meal-card">
        <span class="meal-slot">${escapeHtml((m.slot || '').toUpperCase())}</span>
        <h3>${escapeHtml(m.name || 'Meal')}</h3>
        <p class="meal-desc">${escapeHtml(m.description || '')}</p>
        <span class="meal-cost">${currency}${m.cost ?? '—'}</span>
        <div class="macro-row">
          <span>Cal: <strong>${m.calories ?? '—'}</strong></span>
          <span>Protein: <strong>${m.protein_g ?? '—'}g</strong></span>
          <span>Carbs: <strong>${m.carb_g ?? '—'}g</strong></span>
          <span>Fat: <strong>${m.fat_g ?? '—'}g</strong></span>
        </div>
      </div>`;
  });

  planOutput.innerHTML = html;
}

function renderNextMeal(data) {
  const card = document.getElementById('next-meal-card');
  const meals = data.meals || [];
  if (meals.length === 0) return;
  const m = meals[0];
  card.innerHTML = `
    <span class="label">Next up</span>
    <h3 style="margin:4px 0;font-family:var(--font-head);">${escapeHtml(m.name)}</h3>
    <p class="empty-note">${escapeHtml(m.description || '')}</p>
    <button class="link-btn" data-goto="meals">See full plan</button>`;
  card.querySelector('[data-goto]').addEventListener('click', () => showPanel('meals'));
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
(function init() {
  fillFormFromProfile(state.profile);
  renderTargets();
  loadWater();
  const cached = JSON.parse(localStorage.getItem('sl_last_plan') || 'null');
  if (cached) { renderPlan(cached); renderNextMeal(cached); }
})();
