// GoVehicle OS v3.0 - Cyber-Clean Fleet Telematics Controller

const state = {
  vehicles: [],
  tasks: [],
  stats: { fleet_size: 0, on_track: 0, due_soon: 0, overdue: 0, total_spend: 0 },
  logs: [],
  activeView: 'dashboard',
  selectedVehicleId: null,
  pendingServiceLog: null,
  charts: {}
};

// ================= API CALLS =================

async function api(path, options = {}) {
  try {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failure');
    return data;
  } catch (err) {
    showToast(err.message || 'Network error', 'danger');
    throw err;
  }
}

async function loadFleetData() {
  try {
    const [stats, vehicles, tasks] = await Promise.all([
      api('/api/stats'),
      api('/api/vehicles'),
      api('/api/maintenance')
    ]);

    state.stats = stats;
    state.vehicles = vehicles;
    state.tasks = tasks;

    updateDeckIndicators();
    renderDashboardView();
    renderVehiclesView();
    renderMaintenanceView();

    if (state.activeView === 'analytics') renderAnalyticsCharts();
    if (state.activeView === 'logs') loadAuditHistory();

    if (state.selectedVehicleId) {
      openVehicleInspector(state.selectedVehicleId, false);
    }
  } catch (e) {
    console.error('Data sync failed:', e);
  }
}

// ================= TOAST NOTIFICATIONS =================

function showToast(msg, type = 'cyan') {
  const hub = document.getElementById('toastHub');
  if (!hub) return;
  const chip = document.createElement('div');
  chip.className = `cyber-toast-chip toast-${type}`;
  chip.textContent = msg;
  hub.appendChild(chip);
  setTimeout(() => {
    chip.style.opacity = '0';
    chip.style.transform = 'translateX(30px)';
    setTimeout(() => chip.remove(), 250);
  }, 2500);
}

// ================= DIGITAL CLOCK & DECK STATUS =================

function initLiveClock() {
  const clockEl = document.getElementById('deckLiveClock');
  if (!clockEl) return;
  const update = () => {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('en-US', { hour12: false });
  };
  update();
  setInterval(update, 1000);
}

function updateDeckIndicators() {
  const vCountEl = document.getElementById('deckVehicleCount');
  if (vCountEl) vCountEl.textContent = state.vehicles.length;

  const alertDot = document.getElementById('deckAlertCount');
  const overdueCount = state.stats.overdue || 0;
  if (alertDot) {
    alertDot.textContent = overdueCount;
    alertDot.style.display = overdueCount > 0 ? 'inline-block' : 'none';
  }
}

// ================= VIEW SWITCHER =================

function switchView(viewName, filterParam = null) {
  state.activeView = viewName;

  document.querySelectorAll('.deck-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });

  document.querySelectorAll('.os-view').forEach(view => {
    view.classList.toggle('active', view.id === `view-${viewName}`);
  });

  if (viewName === 'analytics') renderAnalyticsCharts();
  if (viewName === 'logs') loadAuditHistory();

  if (viewName === 'maintenance' && filterParam) {
    const pill = document.querySelector(`.pill-btn[data-status="${filterParam}"]`);
    if (pill) pill.click();
  }
}

// ================= DASHBOARD VIEW =================

function renderDashboardView() {
  const s = state.stats;

  // Bento numbers
  document.getElementById('bentoFleetSize').textContent = s.fleet_size;
  document.getElementById('bentoOnTrack').textContent = s.on_track;
  document.getElementById('bentoDueSoon').textContent = s.due_soon;
  document.getElementById('bentoOverdue').textContent = s.overdue;
  document.getElementById('bentoTotalSpend').textContent = '₹' + Number(s.total_spend || 0).toLocaleString();

  // Critical ticker banner
  const banner = document.getElementById('dashboardCriticalBanner');
  const text = document.getElementById('dashboardCriticalText');
  if (s.overdue > 0) {
    banner.style.display = 'flex';
    text.textContent = `${s.overdue} maintenance schedule${s.overdue === 1 ? ' is' : 's are'} critically overdue across your fleet.`;
  } else {
    banner.style.display = 'none';
  }

  // Reliability percentage
  const total = state.tasks.length;
  const ok = state.tasks.filter(t => t.status === 'ok').length;
  const reliability = total > 0 ? Math.round((ok / total) * 100) : 100;
  const haloText = document.getElementById('reliabilityHaloPercent');
  if (haloText) haloText.textContent = `${reliability}%`;

  // Priority queue
  const queueWrap = document.getElementById('dashboardPriorityQueueList');
  const criticalOrSoon = state.tasks.filter(t => t.status !== 'ok').slice(0, 8);
  const displayItems = criticalOrSoon.length > 0 ? criticalOrSoon : state.tasks.slice(0, 6);

  if (queueWrap) {
    if (displayItems.length === 0) {
      queueWrap.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted)">All fleet units are healthy and on track!</div>';
    } else {
      queueWrap.innerHTML = displayItems.map(t => {
        const icon = getServiceIcon(t.service_key);
        const pillClass = t.status === 'overdue' ? 'pill-overdue' : (t.status === 'soon' ? 'pill-soon' : 'pill-ok');
        const pillLabel = t.status === 'overdue' ? 'Critical' : (t.status === 'soon' ? 'Due Soon' : 'On Track');

        return `
          <div class="stream-card">
            <div class="stream-left">
              <div class="stream-icon">${icon}</div>
              <div>
                <div class="stream-name">${t.vehicle_name} — ${t.service_name}</div>
                <div class="stream-meta">Target: ${t.due_date_formatted} · ${t.vehicle_plate}</div>
              </div>
            </div>
            <div class="stream-right">
              <span class="status-led-pill ${pillClass}">${pillLabel}</span>
              <button class="deck-btn-secondary" style="padding:6px 12px;font-size:12px" onclick="openLogServiceModal(${t.vehicle_id}, '${t.service_key}', '${t.vehicle_name}', '${t.service_name}', ${t.last_cost})">
                Resolve
              </button>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  renderDashboardCharts();
}

function getServiceIcon(key) {
  const map = { oil: '🛢️', tires: '🔄', brakes: '🛑', fluids: '🧪', dot: '📋' };
  return map[key] || '⚙️';
}

function renderDashboardCharts() {
  const isDark = document.body.classList.contains('dark');
  const textColor = isDark ? '#94a3b8' : '#475569';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.06)';

  // 1. Health Donut Chart
  const ctxHealth = document.getElementById('healthDonutChart');
  if (ctxHealth) {
    if (state.charts.healthDonut) state.charts.healthDonut.destroy();

    const okCount = state.tasks.filter(t => t.status === 'ok').length;
    const soonCount = state.tasks.filter(t => t.status === 'soon').length;
    const overdueCount = state.tasks.filter(t => t.status === 'overdue').length;

    state.charts.healthDonut = new Chart(ctxHealth, {
      type: 'doughnut',
      data: {
        labels: ['Healthy (On Track)', 'Due Soon', 'Critical Overdue'],
        datasets: [{
          data: [okCount, soonCount, overdueCount],
          backgroundColor: ['#00f5a0', '#ffb800', '#ff2e63'],
          borderWidth: 0,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: { position: 'bottom', labels: { color: textColor, font: { family: 'Plus Jakarta Sans', weight: '600' } } }
        }
      }
    });
  }

  // 2. Utilization Bar Chart
  const ctxUtil = document.getElementById('utilizationBarChart');
  if (ctxUtil) {
    if (state.charts.utilization) state.charts.utilization.destroy();

    state.charts.utilization = new Chart(ctxUtil, {
      type: 'bar',
      data: {
        labels: state.vehicles.map(v => v.name),
        datasets: [{
          label: 'Current Odometer (Miles)',
          data: state.vehicles.map(v => v.mileage),
          backgroundColor: '#00f0ff',
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: textColor, font: { family: 'Plus Jakarta Sans', weight: '600' } } },
          x: { grid: { display: false }, ticks: { color: textColor, font: { family: 'Plus Jakarta Sans' } } }
        }
      }
    });
  }
}

// ================= FLEET REGISTRY VIEW =================

function renderVehiclesView() {
  const query = (document.getElementById('vehicleSearchInput')?.value || '').toLowerCase();
  const filter = document.getElementById('vehicleStatusFilter')?.value || 'all';

  const list = state.vehicles.filter(v => {
    const matchQ = (v.name + ' ' + v.type + ' ' + v.plate).toLowerCase().includes(query);
    const matchF = filter === 'all' || v.overall_status === filter;
    return matchQ && matchF;
  });

  // Render Grid
  const grid = document.getElementById('vehiclesGridContainer');
  if (grid) {
    if (list.length === 0) {
      grid.innerHTML = '<div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--text-muted)">No matching fleet units found.</div>';
    } else {
      grid.innerHTML = list.map(v => {
        const fillClass = v.overall_status === 'overdue' ? 'fill-crimson' : (v.overall_status === 'soon' ? 'fill-amber' : 'fill-mint');
        const pillClass = v.overall_status === 'overdue' ? 'pill-overdue' : (v.overall_status === 'soon' ? 'pill-soon' : 'pill-ok');
        const pillLabel = v.overall_status === 'overdue' ? 'Overdue' : (v.overall_status === 'soon' ? 'Due Soon' : 'Healthy');

        return `
          <div class="vehicle-tech-card">
            <div class="card-top-identity">
              <div>
                <h3 class="card-unit-name">${v.name}</h3>
                <div class="card-unit-class">${v.type}</div>
              </div>
              <span class="status-led-pill ${pillClass}">${pillLabel}</span>
            </div>

            <div class="card-meter-strip">
              <div class="meter-strip-top">
                <span>Health Index</span>
                <span style="font-weight:700;font-family:var(--font-numbers);font-variant-numeric:tabular-nums">${v.health_percent}%</span>
              </div>
              <div class="meter-track">
                <div class="meter-fill ${fillClass}" style="width:${v.health_percent}%"></div>
              </div>
            </div>

            <div class="card-odometer-data">
              <div>
                <div class="data-k">Plate / Unit ID</div>
                <div class="plate-stamp-mono">${v.plate}</div>
              </div>
              <div style="text-align:right">
                <div class="data-k">Odometer</div>
                <div class="data-v">${Number(v.mileage).toLocaleString()} mi</div>
              </div>
            </div>

            <div class="card-button-dock">
              <button class="deck-btn-secondary" onclick="openVehicleInspector(${v.id})">
                Inspect ➔
              </button>
              <button class="cyber-primary-btn" style="padding:6px 12px;font-size:12px" onclick="openLogServiceModal(${v.id}, 'oil', '${v.name}', 'Oil Change', 1200)">
                Log Oil
              </button>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // Render Table
  const tbody = document.getElementById('vehiclesTableBody');
  if (tbody) {
    tbody.innerHTML = list.map(v => {
      const pillClass = v.overall_status === 'overdue' ? 'pill-overdue' : (v.overall_status === 'soon' ? 'pill-soon' : 'pill-ok');
      const pillLabel = v.overall_status === 'overdue' ? 'Overdue' : (v.overall_status === 'soon' ? 'Due Soon' : 'Healthy');

      return `
        <tr>
          <td><b style="font-family:var(--font-display)">${v.name}</b></td>
          <td><span class="plate-stamp-mono">${v.plate}</span></td>
          <td>${v.type}</td>
          <td style="font-family:var(--font-numbers)">${Number(v.mileage).toLocaleString()} mi</td>
          <td><b style="font-family:var(--font-numbers)">${v.health_percent}%</b></td>
          <td><span class="status-led-pill ${pillClass}">${pillLabel}</span></td>
          <td style="text-align:right">
            <button class="deck-btn-secondary" style="padding:5px 10px;font-size:12px" onclick="openVehicleInspector(${v.id})">Inspect</button>
          </td>
        </tr>
      `;
    }).join('');
  }
}

// ================= SERVICE PIPELINE VIEW =================

function renderMaintenanceView() {
  const query = (document.getElementById('maintenanceSearchInput')?.value || '').toLowerCase();
  const activePill = document.querySelector('.cyber-filter-pill-deck .pill-btn.active')?.dataset.status || 'all';

  const list = state.tasks.filter(t => {
    const matchQ = (t.vehicle_name + ' ' + t.vehicle_plate + ' ' + t.service_name).toLowerCase().includes(query);
    const matchS = activePill === 'all' || t.status === activePill;
    return matchQ && matchS;
  });

  const tbody = document.getElementById('maintenanceTableBody');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted)">No maintenance items match current criteria.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(t => {
    const icon = getServiceIcon(t.service_key);
    const statusClass = t.status === 'overdue' ? 'pill-overdue' : (t.status === 'soon' ? 'pill-soon' : 'pill-ok');
    const statusLabel = t.status === 'overdue' ? 'Overdue' : (t.status === 'soon' ? 'Due Soon' : 'On Track');

    let remainingBadge = '';
    if (t.days_left < 0) {
      remainingBadge = `<span class="text-crimson" style="font-weight:700;font-family:var(--font-numbers);font-variant-numeric:tabular-nums">${Math.abs(t.days_left)} days overdue</span>`;
    } else {
      remainingBadge = `<span style="font-family:var(--font-numbers);font-variant-numeric:tabular-nums">${t.days_left} days left</span>`;
    }

    const dueMiles = t.due_mileage ? `${t.due_mileage.toLocaleString()} mi` : 'Annual Date';

    return `
      <tr>
        <td><b>${t.vehicle_name}</b> <br><small class="plate-stamp-mono" style="font-size:10px">${t.vehicle_plate}</small></td>
        <td><span style="margin-right:6px">${icon}</span><b>${t.service_name}</b></td>
        <td style="font-family:var(--font-numbers)">${t.due_date_formatted}</td>
        <td style="font-family:var(--font-numbers)">${dueMiles}</td>
        <td>${remainingBadge}</td>
        <td><span class="status-led-pill ${statusClass}">${statusLabel}</span></td>
        <td style="text-align:right">
          <button class="cyber-primary-btn" style="padding:6px 12px;font-size:12px" onclick="openLogServiceModal(${t.vehicle_id}, '${t.service_key}', '${t.vehicle_name}', '${t.service_name}', ${t.last_cost})">
            Resolve
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// ================= COST ANALYTICS =================

function renderAnalyticsCharts() {
  const isDark = document.body.classList.contains('dark');
  const textColor = isDark ? '#94a3b8' : '#475569';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.06)';

  // 1. Service Polar Area Chart
  const ctxPolar = document.getElementById('servicePolarChart');
  if (ctxPolar) {
    if (state.charts.polar) state.charts.polar.destroy();

    const counts = {};
    state.tasks.forEach(t => {
      counts[t.service_name] = (counts[t.service_name] || 0) + 1;
    });

    state.charts.polar = new Chart(ctxPolar, {
      type: 'polarArea',
      data: {
        labels: Object.keys(counts),
        datasets: [{
          data: Object.values(counts),
          backgroundColor: ['#00f0ff', '#00f5a0', '#ffb800', '#ff2e63', '#8b5cf6']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: textColor, font: { family: 'Plus Jakarta Sans', weight: '600' } } }
        }
      }
    });
  }

  // 2. Mileage Chart
  const ctxMile = document.getElementById('analyticsMileageChart');
  if (ctxMile) {
    if (state.charts.mileage) state.charts.mileage.destroy();

    state.charts.mileage = new Chart(ctxMile, {
      type: 'bar',
      data: {
        labels: state.vehicles.map(v => v.name),
        datasets: [{
          label: 'Mileage',
          data: state.vehicles.map(v => v.mileage),
          backgroundColor: '#8b5cf6',
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: textColor, font: { family: 'Plus Jakarta Sans', weight: '600' } } },
          x: { grid: { display: false }, ticks: { color: textColor, font: { family: 'Plus Jakarta Sans' } } }
        }
      }
    });
  }
}

// ================= AUDIT LOG HISTORY =================

async function loadAuditHistory() {
  try {
    const logs = await api('/api/maintenance/logs?limit=50');
    state.logs = logs;

    const tbody = document.getElementById('auditHistoryTableBody');
    if (!tbody) return;

    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted)">No maintenance transactions recorded yet.</td></tr>';
      return;
    }

    tbody.innerHTML = logs.map(l => `
      <tr>
        <td style="font-family:var(--font-numbers)">${l.service_date}</td>
        <td><b>${l.vehicle_name}</b> <small class="plate-stamp-mono" style="font-size:10px">${l.vehicle_plate}</small></td>
        <td>${getServiceIcon(l.service_key)} ${l.service_name}</td>
        <td style="font-family:var(--font-numbers)">${Number(l.mileage).toLocaleString()} mi</td>
        <td style="font-family:var(--font-numbers);font-weight:700">₹${Number(l.cost).toLocaleString()}</td>
        <td>${l.performed_by || 'Central Fleet Depot'}</td>
        <td class="text-dim">${l.notes || 'Routine complete'}</td>
      </tr>
    `).join('');
  } catch (e) {
    console.error('Failed to load audit trail:', e);
  }
}

// ================= SLIDE-OVER VEHICLE INSPECTOR =================

async function openVehicleInspector(vehicleId, animate = true) {
  state.selectedVehicleId = vehicleId;
  try {
    const v = await api(`/api/vehicles/${vehicleId}`);

    document.getElementById('drawerVehicleName').textContent = v.name;
    document.getElementById('drawerVehicleType').textContent = v.type;
    document.getElementById('drawerVehiclePlate').textContent = v.plate;
    document.getElementById('drawerOdometer').textContent = `${Number(v.mileage).toLocaleString()} mi`;

    const total = v.tasks.length;
    const ok = v.tasks.filter(t => t.status === 'ok').length;
    const health = total > 0 ? Math.round((ok / total) * 100) : 100;
    const healthEl = document.getElementById('drawerHealthPercent');
    healthEl.textContent = `${health}%`;
    healthEl.className = health >= 80 ? 'hud-box-number text-mint' : 'hud-box-number text-crimson';

    // Tasks Stack
    const tasksWrap = document.getElementById('drawerTasksContainer');
    tasksWrap.innerHTML = v.tasks.map(t => {
      const statusClass = t.status === 'overdue' ? 'pill-overdue' : (t.status === 'soon' ? 'pill-soon' : 'pill-ok');
      const statusLabel = t.status === 'overdue' ? 'Overdue' : (t.status === 'soon' ? 'Due Soon' : 'On Track');

      return `
        <div class="drawer-task-tile">
          <div>
            <div style="font-weight:700">${getServiceIcon(t.service_key)} ${t.service_name}</div>
            <div class="text-dim" style="font-size:11.5px;font-family:var(--font-numbers)">Due: ${t.due_date_formatted} · Last Cost: ₹${Number(t.last_cost || 0).toLocaleString()}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="status-led-pill ${statusClass}">${statusLabel}</span>
            <button class="deck-btn-secondary" style="padding:4px 8px;font-size:11px" onclick="openLogServiceModal(${v.id}, '${t.service_key}', '${v.name}', '${t.service_name}', ${t.last_cost})">
              Log
            </button>
          </div>
        </div>
      `;
    }).join('');

    // History Timeline
    const timeline = document.getElementById('drawerHistoryTimeline');
    if (v.history && v.history.length > 0) {
      timeline.innerHTML = v.history.map(h => `
        <div class="timeline-node">
          <div style="font-size:11px;color:var(--text-dim);font-family:var(--font-numbers)">${h.service_date}</div>
          <div style="font-weight:700;font-size:13px;margin:2px 0">${h.service_name} — ₹${Number(h.cost).toLocaleString()}</div>
          <div style="font-size:12px;color:var(--text-muted)">${h.notes || 'Service performed.'} (${h.performed_by || 'Workshop'})</div>
        </div>
      `).join('');
    } else {
      timeline.innerHTML = '<div style="font-size:12px;color:var(--text-dim)">No prior service logs for this unit.</div>';
    }

    // Drawer buttons
    document.getElementById('drawerActionLogOil').onclick = () => {
      openLogServiceModal(v.id, 'oil', v.name, 'Oil Change', 1200);
    };

    document.getElementById('drawerActionEdit').onclick = () => {
      openEditVehicleModal(v);
    };

    document.getElementById('drawerActionDelete').onclick = async () => {
      if (confirm(`Decommission and remove ${v.name} (${v.plate}) from the active fleet?`)) {
        await api(`/api/vehicles/${v.id}`, { method: 'DELETE' });
        closeInspectorDrawer();
        showToast('Vehicle removed from active fleet', 'crimson');
        loadFleetData();
      }
    };

    if (animate) {
      document.getElementById('inspectorDrawerBackdrop').classList.add('open');
    }
  } catch (e) {
    console.error('Inspector failure:', e);
  }
}

function closeInspectorDrawer() {
  document.getElementById('inspectorDrawerBackdrop').classList.remove('open');
  state.selectedVehicleId = null;
}

// ================= MODAL CONTROLLERS =================

function openModal(id) {
  document.getElementById(id)?.classList.add('open');
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}

function openLogServiceModal(vehicleId, serviceKey, vehicleName, serviceName, lastCost) {
  state.pendingServiceLog = { vehicleId, serviceKey };
  document.getElementById('logServiceSubtitle').textContent = `${vehicleName} — Vehicle ID #${vehicleId}`;
  document.getElementById('logServiceNameDisplay').textContent = serviceName;
  document.getElementById('logServiceCost').value = lastCost || 1200;
  document.getElementById('logServiceNotes').value = '';
  document.getElementById('logServiceTech').value = 'Central Fleet Depot';
  openModal('logServiceModal');
}

async function submitLogService() {
  if (!state.pendingServiceLog) return;
  const cost = Number(document.getElementById('logServiceCost').value) || 0;
  const notes = document.getElementById('logServiceNotes').value.trim();
  const tech = document.getElementById('logServiceTech').value.trim() || 'Central Fleet Depot';

  try {
    await api('/api/maintenance/log', {
      method: 'POST',
      body: JSON.stringify({
        vehicle_id: state.pendingServiceLog.vehicleId,
        service_key: state.pendingServiceLog.serviceKey,
        cost,
        notes,
        performed_by: tech
      })
    });
    closeModal('logServiceModal');
    state.pendingServiceLog = null;
    showToast('Maintenance service logged & saved to database', 'mint');
    await loadFleetData();
  } catch (e) {
    // handled
  }
}

function openEditVehicleModal(v) {
  document.getElementById('editVehicleName').value = v.name;
  document.getElementById('editVehicleType').value = v.type;
  document.getElementById('editVehiclePlate').value = v.plate;
  document.getElementById('editVehicleMileage').value = v.mileage;
  document.getElementById('editVehicleModal').dataset.id = v.id;
  openModal('editVehicleModal');
}

async function submitEditVehicle() {
  const vid = document.getElementById('editVehicleModal').dataset.id;
  const name = document.getElementById('editVehicleName').value.trim();
  const type = document.getElementById('editVehicleType').value;
  const plate = document.getElementById('editVehiclePlate').value.trim();
  const mileage = Number(document.getElementById('editVehicleMileage').value) || 0;

  if (!name) return showToast('Vehicle name required', 'crimson');

  try {
    await api(`/api/vehicles/${vid}`, {
      method: 'PUT',
      body: JSON.stringify({ name, type, plate, mileage })
    });
    closeModal('editVehicleModal');
    showToast('Vehicle specifications updated', 'mint');
    await loadFleetData();
  } catch (e) {
    // handled
  }
}

async function submitAddVehicle() {
  const name = document.getElementById('addVehicleName').value.trim();
  const type = document.getElementById('addVehicleType').value;
  const plate = document.getElementById('addVehiclePlate').value.trim();
  const mileage = Number(document.getElementById('addVehicleMileage').value) || 0;

  if (!name) return showToast('Vehicle name required', 'crimson');

  try {
    await api('/api/vehicles', {
      method: 'POST',
      body: JSON.stringify({ name, type, plate, mileage })
    });
    closeModal('addVehicleModal');
    ['addVehicleName', 'addVehiclePlate', 'addVehicleMileage'].forEach(id => {
      document.getElementById(id).value = '';
    });
    showToast('Vehicle provisioned & scheduled in database', 'mint');
    await loadFleetData();
  } catch (e) {
    // handled
  }
}

// ================= AUTHENTICATION =================

async function submitAuth() {
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value.trim();
  const errEl = document.getElementById('loginError');

  if (!u || !p) {
    errEl.textContent = 'Please provide username and security key';
    return;
  }
  errEl.textContent = '';

  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: u, password: p })
    });
    sessionStorage.setItem('gv_user', data.user.username);
    enterPortal(data.user.username);
  } catch (e) {
    errEl.textContent = e.message || 'Invalid credentials';
  }
}

function enterPortal(username) {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appRoot').style.display = 'flex';
  document.getElementById('userName').textContent = username;
  document.getElementById('avatarInit').textContent = (username[0] || 'A').toUpperCase();
  initLiveClock();
  loadFleetData();
}

function logoutPortal() {
  if (confirm('Disconnect from GoVehicle OS?')) {
    sessionStorage.removeItem('gv_user');
    document.getElementById('appRoot').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
  }
}

// ================= LISTENERS =================

document.addEventListener('DOMContentLoaded', () => {
  // Navigation
  document.querySelectorAll('.deck-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Omni Search
  document.getElementById('globalSearchInput')?.addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    if (state.activeView !== 'vehicles' && state.activeView !== 'maintenance') {
      switchView('vehicles');
    }
    const vSearch = document.getElementById('vehicleSearchInput');
    if (vSearch) {
      vSearch.value = q;
      renderVehiclesView();
    }
    const mSearch = document.getElementById('maintenanceSearchInput');
    if (mSearch) {
      mSearch.value = q;
      renderMaintenanceView();
    }
  });

  // Vehicle Registry Search & Mode Toggles
  document.getElementById('vehicleSearchInput')?.addEventListener('input', renderVehiclesView);
  document.getElementById('vehicleStatusFilter')?.addEventListener('change', renderVehiclesView);

  const gridBtn = document.getElementById('viewModeGridBtn');
  const tableBtn = document.getElementById('viewModeTableBtn');
  gridBtn?.addEventListener('click', () => {
    gridBtn.classList.add('active');
    tableBtn.classList.remove('active');
    document.getElementById('vehiclesGridContainer').style.display = 'grid';
    document.getElementById('vehiclesTableContainer').style.display = 'none';
  });
  tableBtn?.addEventListener('click', () => {
    tableBtn.classList.add('active');
    gridBtn.classList.remove('active');
    document.getElementById('vehiclesGridContainer').style.display = 'none';
    document.getElementById('vehiclesTableContainer').style.display = 'block';
  });

  // Maintenance Search & Filter Pills
  document.getElementById('maintenanceSearchInput')?.addEventListener('input', renderMaintenanceView);
  document.querySelectorAll('.cyber-filter-pill-deck .pill-btn').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.cyber-filter-pill-deck .pill-btn').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      renderMaintenanceView();
    });
  });

  // Theme Toggle
  const themeBtn = document.getElementById('themeToggleBtn');
  themeBtn?.addEventListener('click', () => {
    document.body.classList.toggle('light');
    document.body.classList.toggle('dark');
    const isLight = document.body.classList.contains('light');
    localStorage.setItem('gv_theme', isLight ? 'light' : 'dark');
    renderDashboardCharts();
    if (state.activeView === 'analytics') renderAnalyticsCharts();
  });
  if (localStorage.getItem('gv_theme') === 'light') {
    document.body.classList.add('light');
    document.body.classList.remove('dark');
  }

  // Export CSV Action
  document.getElementById('exportCsvBtn')?.addEventListener('click', () => {
    showToast('Exporting maintenance CSV schedule...', 'cyan');
    window.location.href = '/api/export-csv';
  });

  // Drawer Close
  document.getElementById('drawerCloseBtn')?.addEventListener('click', closeInspectorDrawer);
  document.getElementById('inspectorDrawerBackdrop')?.addEventListener('click', e => {
    if (e.target.id === 'inspectorDrawerBackdrop') closeInspectorDrawer();
  });

  // Modal Handlers
  document.getElementById('openAddVehicleModalBtn')?.addEventListener('click', () => openModal('addVehicleModal'));
  document.getElementById('saveVehicleSubmitBtn')?.addEventListener('click', submitAddVehicle);
  document.getElementById('saveEditVehicleSubmitBtn')?.addEventListener('click', submitEditVehicle);
  document.getElementById('saveLogServiceSubmitBtn')?.addEventListener('click', submitLogService);

  // Auth Handlers
  document.getElementById('loginBtn')?.addEventListener('click', submitAuth);
  document.getElementById('loginPass')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitAuth();
  });
  document.getElementById('logoutBtn')?.addEventListener('click', logoutPortal);

  // Auto-login existing session
  const storedUser = sessionStorage.getItem('gv_user') || 'admin';
  enterPortal(storedUser);
});
