/**
 * app.js — Hash router, dirty-form guard, app init
 * Thin orchestrator: routes to module render methods
 */

import db from './db.js';
import { initModalListeners, setHeaderTitle, setHeaderActions, toast, escapeHtml, formatDate, isDirty, clearDirty } from './ui.js';
import { renderCandidateList, renderCandidateDetail, renderCandidateForm } from './candidates.js';
import { renderClientList, renderClientDetail, renderClientForm } from './clients.js';
import { renderJobList, renderJobDetail, renderJobForm } from './jobs.js';
import { renderPipeline } from './pipeline.js';
import { renderImportExport, handleBackup } from './import-export.js';

// ── Router ──────────────────────────────────────────────────

const routes = {
  dashboard: renderDashboard,
  candidates: renderCandidateList,
  candidate: renderCandidateDetail,
  'candidate-new': () => renderCandidateForm(null),
  'candidate-edit': (id) => renderCandidateForm(id),
  clients: renderClientList,
  client: renderClientDetail,
  'client-new': () => renderClientForm(null),
  'client-edit': (id) => renderClientForm(id),
  jobs: renderJobList,
  job: renderJobDetail,
  'job-new': () => renderJobForm(null),
  'job-edit': (id) => renderJobForm(id),
  pipeline: renderPipeline,
  import: renderImportExport,
  settings: renderSettings,
};

function handleRoute() {
  const hash = location.hash.slice(1) || '/dashboard';
  const [, view, id, subview] = hash.match(/^\/(\w+)\/?([^/]+)?\/?(\w+)?$/) || [];

  if (!view || !resolveRoute(view, id, subview)) {
    // Fallback to dashboard
    location.hash = '#/dashboard';
  }
}

function resolveRoute(view, id, subview) {
  // Update sidebar active state
  const viewAliases = {
    candidate: 'candidates',
    client: 'clients',
    job: 'jobs',
    pipeline: 'jobs',
  };
  document.querySelectorAll('.nav-link').forEach(link => {
    const linkView = link.dataset.view;
    link.classList.toggle('active', linkView === view || linkView === viewAliases[view]);
  });

  const content = document.getElementById('content');
  content.innerHTML = '';
  setHeaderActions('');

  // Entity routes: candidate, client, job (all follow same pattern)
  for (const entity of ['candidate', 'client', 'job']) {
    if (view === entity) {
      if (id && subview === 'edit') { routes[`${entity}-edit`](id); return true; }
      if (id === 'new') { routes[`${entity}-new`](); return true; }
      if (id) { routes[entity](id); return true; }
    }
  }

  // Pipeline view (takes jobId as id param)
  if (view === 'pipeline' && id) {
    routes['pipeline'](id);
    return true;
  }

  const handler = routes[view];
  if (handler) {
    handler();
    return true;
  }
  return false;
}

// ── Dashboard ───────────────────────────────────────────────

async function renderDashboard() {
  setHeaderTitle('Dashboard');
  const content = document.getElementById('content');

  let candidates, jobs, clients, alertDays;
  try {
    [candidates, jobs, clients, alertDays] = await Promise.all([
      db.getAllCandidates(),
      db.getAllJobs(),
      db.getAllClients(),
      db.getSetting('certAlertDays'),
    ]);
    alertDays = alertDays || 60;
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><p>Failed to load dashboard data.</p></div>`;
    toast('Database error: ' + err.message, { type: 'error' });
    return;
  }

  const openJobs = jobs.filter(j => j.status === 'open');

  // Compute cert stats
  let totalCerts = 0;
  let expiringSoon = [];
  let expired = [];

  for (const c of candidates) {
    for (const cert of (c.certifications || [])) {
      totalCerts++;
      if (!cert.expirationDate) continue;
      const days = Math.ceil((new Date(cert.expirationDate) - new Date()) / 86400000);
      if (days < 0) {
        expired.push({ ...cert, candidateName: `${c.firstName} ${c.lastName}`, candidateId: c.id });
      } else if (days <= alertDays) {
        expiringSoon.push({ ...cert, candidateName: `${c.firstName} ${c.lastName}`, candidateId: c.id, daysRemaining: days });
      }
    }
  }

  expiringSoon.sort((a, b) => a.daysRemaining - b.daysRemaining);

  content.innerHTML = `
    <div class="dashboard">
      <div class="metrics-row">
        <div class="metric-card">
          <div class="metric-value">${candidates.length}</div>
          <div class="metric-label">Candidates</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">${openJobs.length}</div>
          <div class="metric-label">Open Jobs</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">${clients.length}</div>
          <div class="metric-label">Clients</div>
        </div>
        <div class="metric-card metric-card--warning">
          <div class="metric-value">${expiringSoon.length}</div>
          <div class="metric-label">Expiring Soon</div>
        </div>
        <div class="metric-card metric-card--danger">
          <div class="metric-value">${expired.length}</div>
          <div class="metric-label">Expired</div>
        </div>
      </div>

      ${expiringSoon.length > 0 || expired.length > 0 ? `
      <div class="dashboard-section">
        <h2 class="section-title">Certification Alerts</h2>
        <div class="cert-alerts">
          ${expired.map(cert => `
            <div class="cert-alert cert-alert--expired">
              <div class="cert-alert-badge">EXPIRED</div>
              <div class="cert-alert-info">
                <strong>${escapeHtml(cert.name)}</strong> — <a href="#/candidate/${cert.candidateId}" class="link">${escapeHtml(cert.candidateName)}</a>
                <div class="cert-alert-date">Expired ${formatDate(cert.expirationDate)}</div>
              </div>
            </div>
          `).join('')}
          ${expiringSoon.map(cert => `
            <div class="cert-alert cert-alert--expiring">
              <div class="cert-alert-badge">${cert.daysRemaining}d</div>
              <div class="cert-alert-info">
                <strong>${escapeHtml(cert.name)}</strong> — <a href="#/candidate/${cert.candidateId}" class="link">${escapeHtml(cert.candidateName)}</a>
                <div class="cert-alert-date">Expires ${formatDate(cert.expirationDate)}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}

      ${openJobs.length > 0 ? `
      <div class="dashboard-section">
        <h2 class="section-title">Open Jobs</h2>
        <div class="candidate-list compact">
          ${openJobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5).map(j => {
            const clientName = clients.find(c => c.id === j.clientId)?.companyName || '';
            return `
            <a href="#/job/${j.id}" class="candidate-row">
              <div class="candidate-name">${escapeHtml(j.title)}</div>
              <div class="candidate-meta">${clientName ? escapeHtml(clientName) + ' — ' : ''}${escapeHtml(j.location || '')}${j.remote ? ' (Remote)' : ''}</div>
            </a>`;
          }).join('')}
        </div>
        ${openJobs.length > 5 ? `<a href="#/jobs" class="btn btn-secondary btn-block">View All Jobs</a>` : ''}
      </div>
      ` : ''}

      ${candidates.length === 0 && jobs.length === 0 ? `
      <div class="empty-state">
        <h2>Welcome to ComplianceTrack</h2>
        <p>Get started by adding your first candidate, client, or importing data from Loxo.</p>
        <div class="empty-actions">
          <a href="#/candidate/new" class="btn btn-primary">Add Candidate</a>
          <a href="#/client/new" class="btn btn-secondary">Add Client</a>
          <a href="#/import" class="btn btn-secondary">Import Data</a>
        </div>
      </div>
      ` : `
      <div class="dashboard-section">
        <h2 class="section-title">Recent Candidates</h2>
        <div class="candidate-list compact">
          ${candidates.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5).map(c => `
            <a href="#/candidate/${c.id}" class="candidate-row">
              <div class="candidate-name">${escapeHtml(c.firstName)} ${escapeHtml(c.lastName)}</div>
              <div class="candidate-meta">${escapeHtml(c.currentTitle || '')}${c.currentEmployer ? ` at ${escapeHtml(c.currentEmployer)}` : ''}</div>
              <div class="candidate-certs">
                ${(c.certifications || []).slice(0, 3).map(cert => `<span class="cert-badge cert-badge--sm">${escapeHtml(cert.name)}</span>`).join('')}
                ${(c.certifications || []).length > 3 ? `<span class="cert-badge cert-badge--sm cert-badge--more">+${c.certifications.length - 3}</span>` : ''}
              </div>
            </a>
          `).join('')}
        </div>
        <a href="#/candidates" class="btn btn-secondary btn-block">View All Candidates</a>
      </div>
      `}
    </div>
  `;
}

// ── Settings ────────────────────────────────────────────────

async function renderSettings() {
  setHeaderTitle('Settings');
  const content = document.getElementById('content');

  const alertDays = (await db.getSetting('certAlertDays')) || 60;
  const customCerts = (await db.getSetting('customCertTypes')) || [];

  content.innerHTML = `
    <div class="settings-page">
      <div class="settings-section">
        <h2 class="section-title">Certification Alerts</h2>
        <form id="settings-form" class="form">
          <div class="form-group">
            <label for="certAlertDays">Alert threshold (days before expiration)</label>
            <input type="number" id="certAlertDays" name="certAlertDays" value="${alertDays}" min="1" max="365" class="form-input" style="max-width: 120px;">
          </div>
          <button type="submit" class="btn btn-primary">Save</button>
        </form>
      </div>

      <div class="settings-section">
        <h2 class="section-title">Custom Certification Types</h2>
        <p class="section-desc">Add custom certification types that will appear in cert dropdowns.</p>
        <div id="custom-certs-list">
          ${customCerts.map((cert, i) => `
            <div class="custom-cert-row" data-index="${i}">
              <span>${escapeHtml(cert.name)} <span class="text-secondary">— ${escapeHtml(cert.issuingBody)}</span></span>
              <button class="btn btn-sm btn-danger remove-custom-cert" data-index="${i}">Remove</button>
            </div>
          `).join('')}
        </div>
        <form id="add-custom-cert-form" class="form form-inline">
          <input type="text" name="name" placeholder="Cert name" required class="form-input">
          <input type="text" name="issuingBody" placeholder="Issuing body" required class="form-input">
          <input type="text" name="renewal" placeholder="Renewal cycle" class="form-input">
          <button type="submit" class="btn btn-secondary">Add</button>
        </form>
      </div>

      <div class="settings-section">
        <h2 class="section-title">Data</h2>
        <button id="btn-export-all" class="btn btn-secondary">Export Full Backup (JSON)</button>
        <button id="btn-clear-all" class="btn btn-danger" style="margin-left: 8px;">Clear All Data</button>
      </div>
    </div>
  `;

  // Settings form
  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const days = parseInt(e.target.certAlertDays.value, 10);
      if (days > 0) {
        await db.setSetting('certAlertDays', days);
        toast('Settings saved', { type: 'success' });
      }
    } catch (err) {
      toast('Failed to save settings: ' + err.message, { type: 'error' });
    }
  });

  // Add custom cert
  document.getElementById('add-custom-cert-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const name = e.target.name.value.trim();
      const issuingBody = e.target.issuingBody.value.trim();
      const renewal = e.target.renewal.value.trim();
      if (!name || !issuingBody) return;
      const certs = (await db.getSetting('customCertTypes')) || [];
      certs.push({ name, issuingBody, renewal, type: 'custom' });
      await db.setSetting('customCertTypes', certs);
      toast(`Added "${name}"`, { type: 'success' });
      renderSettings();
    } catch (err) {
      toast('Failed to add cert type: ' + err.message, { type: 'error' });
    }
  });

  // Remove custom cert
  content.addEventListener('click', async (e) => {
    const btn = e.target.closest('.remove-custom-cert');
    if (!btn) return;
    try {
      const idx = parseInt(btn.dataset.index, 10);
      const certs = (await db.getSetting('customCertTypes')) || [];
      certs.splice(idx, 1);
      await db.setSetting('customCertTypes', certs);
      toast('Removed', { type: 'info' });
      renderSettings();
    } catch (err) {
      toast('Failed to remove: ' + err.message, { type: 'error' });
    }
  });

  // Export
  document.getElementById('btn-export-all').addEventListener('click', () => handleBackup());

  // Clear all
  document.getElementById('btn-clear-all').addEventListener('click', async () => {
    if (!window.confirm('This will permanently delete ALL data. Export a backup first. Continue?')) return;
    try {
      await Promise.all([
        db.clear('candidates'),
        db.clear('clients'),
        db.clear('jobs'),
        db.clear('pipeline'),
        db.clear('settings'),
      ]);
      toast('All data cleared', { type: 'info' });
      renderSettings();
    } catch (err) {
      toast('Failed to clear data: ' + err.message, { type: 'error' });
    }
  });
}

// ── Sidebar Toggle ──────────────────────────────────────────

function initSidebar() {
  const toggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('sidebar-open');
  });
  // Close sidebar when clicking a nav link (mobile)
  sidebar.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      sidebar.classList.remove('sidebar-open');
    });
  });
}

// ── Backup Button (sidebar) ─────────────────────────────────

function initBackupButton() {
  document.getElementById('btn-backup').addEventListener('click', () => handleBackup());
}

// ── Init ────────────────────────────────────────────────────

async function init() {
  try {
    await db.init();
  } catch (err) {
    document.getElementById('content').innerHTML = `
      <div class="empty-state">
        <h2>Database Error</h2>
        <p>Could not open IndexedDB. Try using a different browser or clearing site data.</p>
        <pre>${escapeHtml(err.message)}</pre>
      </div>
    `;
    return;
  }

  initModalListeners();
  initSidebar();
  initBackupButton();

  // Set default settings
  if ((await db.getSetting('certAlertDays')) === null) {
    await db.setSetting('certAlertDays', 60);
  }

  // Route handling
  window.addEventListener('hashchange', () => {
    if (isDirty()) {
      if (!window.confirm('You have unsaved changes. Discard them?')) {
        history.back();
        return;
      }
      clearDirty();
    }
    handleRoute();
  });

  handleRoute();
}

document.addEventListener('DOMContentLoaded', init);
