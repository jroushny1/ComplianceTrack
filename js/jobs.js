/**
 * jobs.js — Job/requisition CRUD, list view, detail view, form
 */

import db, { FINRA_LICENSES, COMPLIANCE_CERTS } from './db.js';
import { openModal, closeModal, toast, escapeHtml, formatDate, setHeaderTitle, setHeaderActions, SearchController, markDirty, clearDirty, detailField, confirm } from './ui.js';

// ── Cert Options ───────────────────────────────────────────

async function getAllCertOptions() {
  const customCerts = (await db.getSetting('customCertTypes')) || [];
  return [
    ...FINRA_LICENSES.map(c => c.name),
    ...COMPLIANCE_CERTS.map(c => c.name),
    ...customCerts.map(c => c.name),
  ];
}

// ── List View ──────────────────────────────────────────────

let _listCache = null;

export function invalidateJobListCache() { _listCache = null; }

export async function renderJobList() {
  setHeaderTitle('Jobs');
  setHeaderActions('<a href="#/job/new" class="btn btn-primary btn-sm">+ New Job</a>');
  const content = document.getElementById('content');

  let jobs, clients;
  try {
    jobs = _listCache || await db.getAllJobs();
    _listCache = jobs;
    clients = await db.getAllClients();
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><p>Failed to load jobs.</p></div>`;
    toast('Database error: ' + err.message, { type: 'error' });
    return;
  }

  if (jobs.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <h2>No jobs yet</h2>
        <p>Create your first job requisition to start building a pipeline.</p>
        <a href="#/job/new" class="btn btn-primary">Add Job</a>
      </div>`;
    return;
  }

  const clientMap = new Map(clients.map(c => [c.id, c.companyName]));
  const sorted = jobs.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  content.innerHTML = `
    <div class="search-bar">
      <input type="text" id="job-search" class="form-input" placeholder="Search jobs…">
      <select id="job-status-filter" class="form-input form-input--sm">
        <option value="">All Statuses</option>
        <option value="open">Open</option>
        <option value="on-hold">On Hold</option>
        <option value="filled">Filled</option>
        <option value="cancelled">Cancelled</option>
      </select>
    </div>
    <div id="job-list-container" class="candidate-list"></div>`;

  const listContainer = document.getElementById('job-list-container');

  function renderRows(list) {
    if (list.length === 0) {
      listContainer.innerHTML = `<div class="empty-state"><p>No jobs match your search.</p></div>`;
      return;
    }
    listContainer.innerHTML = list.map(j => {
      const clientName = clientMap.get(j.clientId) || '';
      const statusClass = j.status === 'open' ? 'active' : j.status === 'filled' ? 'active' : 'expired';
      return `
        <a href="#/job/${j.id}" class="candidate-row">
          <div class="candidate-name">${escapeHtml(j.title)}</div>
          <div class="candidate-meta">
            ${clientName ? escapeHtml(clientName) + ' — ' : ''}
            <span class="cert-badge cert-badge--sm cert-badge--${statusClass}">${escapeHtml(j.status)}</span>
            ${j.location ? ` — ${escapeHtml(j.location)}` : ''}
            ${j.remote ? ' (Remote)' : ''}
          </div>
          <div class="candidate-certs">
            ${(j.requiredCerts || []).slice(0, 3).map(c => `<span class="cert-badge cert-badge--sm">${escapeHtml(c)}</span>`).join('')}
            ${(j.requiredCerts || []).length > 3 ? `<span class="cert-badge cert-badge--sm cert-badge--more">+${j.requiredCerts.length - 3}</span>` : ''}
          </div>
        </a>`;
    }).join('');
  }

  renderRows(sorted);

  // Search + filter
  const searchInput = document.getElementById('job-search');
  const statusFilter = document.getElementById('job-status-filter');

  function applyFilters() {
    const q = searchInput.value.toLowerCase();
    const status = statusFilter.value;
    const filtered = sorted.filter(j => {
      if (status && j.status !== status) return false;
      if (!q) return true;
      const clientName = (clientMap.get(j.clientId) || '').toLowerCase();
      return j.title.toLowerCase().includes(q) ||
        clientName.includes(q) ||
        (j.location || '').toLowerCase().includes(q);
    });
    renderRows(filtered);
  }

  searchInput.addEventListener('input', applyFilters);
  statusFilter.addEventListener('change', applyFilters);
}

// ── Detail View ────────────────────────────────────────────

export async function renderJobDetail(id) {
  setHeaderTitle('Job');
  const content = document.getElementById('content');

  let job, client, pipelineEntries, candidates;
  try {
    job = await db.getJob(id);
    if (!job) {
      content.innerHTML = `<div class="empty-state"><p>Job not found.</p></div>`;
      return;
    }
    client = job.clientId ? await db.getClient(job.clientId) : null;
    pipelineEntries = await db.getPipelineByJob(id);
    candidates = await db.getAllCandidates();
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><p>Failed to load job.</p></div>`;
    toast('Error: ' + err.message, { type: 'error' });
    return;
  }

  setHeaderTitle(job.title);
  setHeaderActions(`
    <a href="#/pipeline/${id}" class="btn btn-primary btn-sm">View Pipeline</a>
    <a href="#/job/${id}/edit" class="btn btn-secondary btn-sm">Edit</a>
    <button id="btn-delete-job" class="btn btn-danger btn-sm">Delete</button>
  `);

  const candidateMap = new Map(candidates.map(c => [c.id, c]));

  // Compensation display
  let compDisplay = '—';
  if (job.compensationMin || job.compensationMax) {
    const fmt = (n) => n ? `$${Number(n).toLocaleString()}` : '';
    const type = job.compensationType === 'hourly' ? '/hr' : '/yr';
    if (job.compensationMin && job.compensationMax) {
      compDisplay = `${fmt(job.compensationMin)} – ${fmt(job.compensationMax)}${type}`;
    } else {
      compDisplay = `${fmt(job.compensationMin || job.compensationMax)}${type}`;
    }
  }

  // Pipeline summary by stage
  const stageCounts = {};
  for (const stage of (job.stages || [])) { stageCounts[stage] = 0; }
  for (const pe of pipelineEntries) { stageCounts[pe.stage] = (stageCounts[pe.stage] || 0) + 1; }

  content.innerHTML = `
    <div class="detail-page">
      <div class="detail-section">
        <h2 class="section-title">Job Info</h2>
        <div class="detail-grid">
          ${detailField('Title', job.title)}
          ${detailField('Client', client ? client.companyName : '—', client ? `#/client/${client.id}` : null)}
          ${detailField('Status', job.status)}
          ${detailField('Location', (job.location || '') + (job.remote ? ' (Remote)' : ''))}
          ${detailField('Compensation', compDisplay)}
          ${detailField('Added', formatDate(job.createdAt))}
        </div>
      </div>

      ${job.description ? `
      <div class="detail-section">
        <h2 class="section-title">Description</h2>
        <div class="notes-block">${escapeHtml(job.description)}</div>
      </div>` : ''}

      ${job.requirements ? `
      <div class="detail-section">
        <h2 class="section-title">Requirements</h2>
        <div class="notes-block">${escapeHtml(job.requirements)}</div>
      </div>` : ''}

      <div class="detail-section">
        <h2 class="section-title">Certifications</h2>
        <div class="cert-requirements">
          ${(job.requiredCerts || []).length > 0 ? `
            <div><strong>Required:</strong> ${job.requiredCerts.map(c => `<span class="cert-badge">${escapeHtml(c)}</span>`).join(' ')}</div>
          ` : ''}
          ${(job.preferredCerts || []).length > 0 ? `
            <div style="margin-top: 4px;"><strong>Preferred:</strong> ${job.preferredCerts.map(c => `<span class="cert-badge cert-badge--sm">${escapeHtml(c)}</span>`).join(' ')}</div>
          ` : ''}
          ${(job.requiredCerts || []).length === 0 && (job.preferredCerts || []).length === 0 ? '<p class="text-secondary">No certification requirements set.</p>' : ''}
        </div>
      </div>

      <div class="detail-section">
        <h2 class="section-title">Pipeline (${pipelineEntries.length} candidates)</h2>
        <div class="metrics-row">
          ${(job.stages || []).map(stage => `
            <div class="metric-card metric-card--sm">
              <div class="metric-value">${stageCounts[stage] || 0}</div>
              <div class="metric-label">${escapeHtml(stage)}</div>
            </div>
          `).join('')}
        </div>
        ${pipelineEntries.length > 0 ? `
          <div class="candidate-list compact" style="margin-top: 12px;">
            ${pipelineEntries.sort((a, b) => {
              const ai = (job.stages || []).indexOf(a.stage);
              const bi = (job.stages || []).indexOf(b.stage);
              return ai - bi || a.position - b.position;
            }).slice(0, 10).map(pe => {
              const cand = candidateMap.get(pe.candidateId);
              if (!cand) return '';
              return `
                <a href="#/candidate/${cand.id}" class="candidate-row">
                  <div class="candidate-name">${escapeHtml(cand.firstName)} ${escapeHtml(cand.lastName)}</div>
                  <div class="candidate-meta"><span class="cert-badge cert-badge--sm">${escapeHtml(pe.stage)}</span></div>
                </a>`;
            }).join('')}
          </div>
          ${pipelineEntries.length > 10 ? `<a href="#/pipeline/${id}" class="btn btn-secondary btn-sm" style="margin-top: 8px;">View all in pipeline</a>` : ''}
        ` : `<p class="text-secondary">No candidates in pipeline yet.</p>`}
        <button id="btn-add-to-pipeline" class="btn btn-secondary btn-sm" style="margin-top: 8px;">+ Add Candidate</button>
      </div>
    </div>
  `;

  // Delete handler
  document.getElementById('btn-delete-job').addEventListener('click', async () => {
    if (!await confirm(`Delete "${job.title}" and all pipeline entries?`)) return;
    try {
      await db.deletePipelineByJob(id);
      await db.deleteJob(id);
      _listCache = null;
      toast('Job deleted', { type: 'info' });
      location.hash = '#/jobs';
    } catch (err) {
      toast('Failed to delete: ' + err.message, { type: 'error' });
    }
  });

  // Add to pipeline
  document.getElementById('btn-add-to-pipeline').addEventListener('click', () => {
    showAddToPipelineModal(job, candidates, pipelineEntries);
  });
}

// ── Add Candidate to Pipeline Modal ────────────────────────

function showAddToPipelineModal(job, candidates, existingEntries) {
  const existingCandIds = new Set(existingEntries.map(e => e.candidateId));
  const available = candidates.filter(c => !existingCandIds.has(c.id));

  if (available.length === 0) {
    toast('All candidates are already in this pipeline', { type: 'info' });
    return;
  }

  const sorted = available.slice().sort((a, b) => a.lastName.localeCompare(b.lastName));
  const firstStage = (job.stages || ['Sourced'])[0];

  const body = document.createElement('div');
  body.innerHTML = `
    <input type="text" id="pipeline-search" class="form-input" placeholder="Search candidates…" style="margin-bottom: 12px;">
    <div id="pipeline-candidates" class="candidate-list compact" style="max-height: 300px; overflow-y: auto;"></div>
  `;

  const listEl = body.querySelector('#pipeline-candidates');

  function renderList(list) {
    listEl.innerHTML = list.map(c => `
      <div class="candidate-row candidate-row--selectable" data-id="${c.id}" style="cursor: pointer;">
        <div class="candidate-name">${escapeHtml(c.firstName)} ${escapeHtml(c.lastName)}</div>
        <div class="candidate-meta">${escapeHtml(c.currentTitle || '')}${c.currentEmployer ? ` at ${escapeHtml(c.currentEmployer)}` : ''}</div>
      </div>
    `).join('');
  }

  renderList(sorted);

  body.querySelector('#pipeline-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    if (!q) { renderList(sorted); return; }
    renderList(sorted.filter(c =>
      `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
      (c.currentEmployer || '').toLowerCase().includes(q)
    ));
  });

  listEl.addEventListener('click', async (e) => {
    const row = e.target.closest('.candidate-row--selectable');
    if (!row) return;
    const candidateId = row.dataset.id;
    try {
      await db.addToPipeline({
        candidateId,
        jobId: job.id,
        stage: firstStage,
      });
      toast('Candidate added to pipeline', { type: 'success' });
      closeModal();
      renderJobDetail(job.id);
    } catch (err) {
      if (err.name === 'ConstraintError') {
        toast('Candidate already in this pipeline', { type: 'error' });
      } else {
        toast('Error: ' + err.message, { type: 'error' });
      }
    }
  });

  openModal({ title: `Add to ${job.title}`, body });
}

// ── Form View ──────────────────────────────────────────────

export async function renderJobForm(id) {
  const content = document.getElementById('content');
  const isEdit = !!id;
  let job = null;
  let clients, certOptions;

  try {
    clients = await db.getAllClients();
    certOptions = await getAllCertOptions();
    if (isEdit) {
      job = await db.getJob(id);
      if (!job) {
        content.innerHTML = `<div class="empty-state"><p>Job not found.</p></div>`;
        return;
      }
    }
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><p>Failed to load data.</p></div>`;
    return;
  }

  // Pre-select client from URL query param
  const urlParams = new URLSearchParams(location.hash.split('?')[1] || '');
  const preselectedClientId = urlParams.get('clientId') || '';

  setHeaderTitle(isEdit ? `Edit ${job.title}` : 'New Job');
  setHeaderActions('');

  const clientOptions = clients.sort((a, b) => a.companyName.localeCompare(b.companyName))
    .map(c => `<option value="${c.id}" ${(isEdit ? job.clientId : preselectedClientId) === c.id ? 'selected' : ''}>${escapeHtml(c.companyName)}</option>`)
    .join('');

  const reqCerts = isEdit ? (job.requiredCerts || []) : [];
  const prefCerts = isEdit ? (job.preferredCerts || []) : [];
  const stages = isEdit ? (job.stages || []) : [...db.constructor.DEFAULT_STAGES];

  content.innerHTML = `
    <form id="job-form" class="form detail-page">
      <div class="detail-section">
        <h2 class="section-title">Job Info</h2>
        <div class="form-grid">
          <div class="form-group">
            <label for="title">Job Title *</label>
            <input type="text" id="title" name="title" class="form-input" required value="${isEdit ? escapeHtml(job.title) : ''}">
          </div>
          <div class="form-group">
            <label for="clientId">Client</label>
            <select id="clientId" name="clientId" class="form-input">
              <option value="">— No Client —</option>
              ${clientOptions}
            </select>
          </div>
          <div class="form-group">
            <label for="status">Status</label>
            <select id="status" name="status" class="form-input">
              ${['open', 'on-hold', 'filled', 'cancelled'].map(s =>
                `<option value="${s}" ${(isEdit ? job.status : 'open') === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
              ).join('')}
            </select>
          </div>
          <div class="form-group">
            <label for="location">Location</label>
            <input type="text" id="location" name="location" class="form-input" value="${isEdit ? escapeHtml(job.location) : ''}">
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="remote" name="remote" ${(isEdit ? job.remote : false) ? 'checked' : ''}> Remote
            </label>
          </div>
        </div>
      </div>

      <div class="detail-section">
        <h2 class="section-title">Compensation</h2>
        <div class="form-grid">
          <div class="form-group">
            <label for="compensationMin">Min</label>
            <input type="number" id="compensationMin" name="compensationMin" class="form-input" value="${isEdit && job.compensationMin ? job.compensationMin : ''}">
          </div>
          <div class="form-group">
            <label for="compensationMax">Max</label>
            <input type="number" id="compensationMax" name="compensationMax" class="form-input" value="${isEdit && job.compensationMax ? job.compensationMax : ''}">
          </div>
          <div class="form-group">
            <label for="compensationType">Type</label>
            <select id="compensationType" name="compensationType" class="form-input">
              <option value="salary" ${(isEdit ? job.compensationType : 'salary') === 'salary' ? 'selected' : ''}>Salary</option>
              <option value="hourly" ${(isEdit ? job.compensationType : 'salary') === 'hourly' ? 'selected' : ''}>Hourly</option>
            </select>
          </div>
        </div>
      </div>

      <div class="detail-section">
        <h2 class="section-title">Description & Requirements</h2>
        <div class="form-group">
          <label for="description">Description</label>
          <textarea id="description" name="description" class="form-input" rows="4">${isEdit ? escapeHtml(job.description) : ''}</textarea>
        </div>
        <div class="form-group">
          <label for="requirements">Requirements</label>
          <textarea id="requirements" name="requirements" class="form-input" rows="3">${isEdit ? escapeHtml(job.requirements) : ''}</textarea>
        </div>
      </div>

      <div class="detail-section">
        <h2 class="section-title">Certification Requirements</h2>
        <div class="form-grid">
          <div class="form-group">
            <label>Required Certifications</label>
            <div id="required-certs-container" class="cert-picker"></div>
          </div>
          <div class="form-group">
            <label>Preferred Certifications</label>
            <div id="preferred-certs-container" class="cert-picker"></div>
          </div>
        </div>
      </div>

      <div class="detail-section">
        <h2 class="section-title">Pipeline Stages</h2>
        <p class="section-desc">Customize the stages candidates move through for this job.</p>
        <div id="stages-container"></div>
        <button type="button" id="btn-add-stage" class="btn btn-secondary btn-sm">+ Add Stage</button>
      </div>

      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Save Changes' : 'Create Job'}</button>
        <a href="${isEdit ? `#/job/${id}` : '#/jobs'}" class="btn btn-secondary">Cancel</a>
      </div>
    </form>
  `;

  // Cert pickers
  initCertPicker('required-certs-container', certOptions, reqCerts);
  initCertPicker('preferred-certs-container', certOptions, prefCerts);

  // Stages
  let stageData = [...stages];
  const stagesContainer = document.getElementById('stages-container');

  function renderStages() {
    stagesContainer.innerHTML = stageData.map((s, i) => `
      <div class="stage-row" data-index="${i}">
        <input type="text" class="form-input form-input--sm stage-input" value="${escapeHtml(s)}" data-index="${i}">
        <button type="button" class="btn btn-sm btn-danger remove-stage" data-index="${i}" ${stageData.length <= 1 ? 'disabled' : ''}>Remove</button>
      </div>
    `).join('');
  }

  renderStages();

  document.getElementById('btn-add-stage').addEventListener('click', () => {
    collectStageData();
    stageData.push('New Stage');
    renderStages();
    markDirty();
  });

  stagesContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-stage');
    if (!btn) return;
    collectStageData();
    stageData.splice(parseInt(btn.dataset.index, 10), 1);
    renderStages();
    markDirty();
  });

  function collectStageData() {
    const inputs = stagesContainer.querySelectorAll('.stage-input');
    stageData = Array.from(inputs).map(inp => inp.value.trim()).filter(Boolean);
  }

  // Form change tracking
  content.addEventListener('input', () => markDirty());

  // Submit
  document.getElementById('job-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    collectStageData();

    const data = {
      title: form.title.value.trim(),
      clientId: form.clientId.value,
      status: form.status.value,
      location: form.location.value.trim(),
      remote: form.remote.checked,
      compensationMin: form.compensationMin.value ? Number(form.compensationMin.value) : null,
      compensationMax: form.compensationMax.value ? Number(form.compensationMax.value) : null,
      compensationType: form.compensationType.value,
      description: form.description.value.trim(),
      requirements: form.requirements.value.trim(),
      requiredCerts: collectCertPicker('required-certs-container'),
      preferredCerts: collectCertPicker('preferred-certs-container'),
      stages: stageData.length > 0 ? stageData : [...db.constructor.DEFAULT_STAGES],
    };

    try {
      if (isEdit) {
        const oldStatus = job.status;
        Object.assign(job, data);
        if (data.status !== oldStatus) job.statusDate = new Date().toISOString();
        await db.updateJob(job);
        toast('Job updated', { type: 'success' });
      } else {
        data.statusDate = new Date().toISOString();
        const newJob = await db.addJob(data);
        id = newJob.id;
        toast('Job created', { type: 'success' });
      }
      _listCache = null;
      clearDirty();
      location.hash = `#/job/${id}`;
    } catch (err) {
      toast('Error: ' + err.message, { type: 'error' });
    }
  });
}

// ── Cert Picker Component ──────────────────────────────────

function initCertPicker(containerId, options, selected) {
  const container = document.getElementById(containerId);
  let selectedSet = new Set(selected);

  function render() {
    container.innerHTML = `
      <div class="cert-picker-selected">
        ${Array.from(selectedSet).map(name => `
          <span class="cert-badge cert-badge--removable">${escapeHtml(name)} <button type="button" class="cert-remove" data-name="${escapeHtml(name)}">&times;</button></span>
        `).join('')}
      </div>
      <select class="form-input form-input--sm cert-add-select">
        <option value="">+ Add certification…</option>
        ${options.filter(o => !selectedSet.has(o)).map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}
      </select>
    `;
  }

  render();

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.cert-remove');
    if (!btn) return;
    selectedSet.delete(btn.dataset.name);
    render();
    markDirty();
  });

  container.addEventListener('change', (e) => {
    if (!e.target.classList.contains('cert-add-select')) return;
    const val = e.target.value;
    if (val) {
      selectedSet.add(val);
      render();
      markDirty();
    }
  });
}

function collectCertPicker(containerId) {
  const container = document.getElementById(containerId);
  return Array.from(container.querySelectorAll('.cert-badge--removable')).map(el => {
    return el.querySelector('.cert-remove').dataset.name;
  });
}
