/**
 * outreach.js — Activity logging, email templates, template management
 * Quick-entry forms for emails, calls, interviews, notes, submissions
 */

import db from './db.js';
import { openModal, closeModal, toast, escapeHtml, formatDate, setHeaderTitle, setHeaderActions, SearchController } from './ui.js';

const TYPE_ICONS = {
  email: '&#9993;',
  call: '&#9742;',
  interview: '&#128197;',
  note: '&#9998;',
  submission: '&#10148;',
};

// ── Activity List (all activities, searchable) ─────────────

export async function renderOutreach() {
  setHeaderTitle('Outreach');
  setHeaderActions('<button id="btn-new-activity" class="btn btn-primary btn-sm">+ Log Activity</button>');
  const content = document.getElementById('content');

  let activities, candidates, jobs;
  try {
    [activities, candidates, jobs] = await Promise.all([
      db.getAllActivities(),
      db.getAllCandidates(),
      db.getAllJobs(),
    ]);
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><p>Failed to load activities.</p></div>`;
    toast('Database error: ' + err.message, { type: 'error' });
    return;
  }

  const candidateMap = new Map(candidates.map(c => [c.id, c]));
  const jobMap = new Map(jobs.map(j => [j.id, j]));

  // Sort newest first
  const sorted = activities.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (sorted.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <h2>No activities yet</h2>
        <p>Log your first email, call, or note to start tracking outreach.</p>
        <button id="btn-new-activity" class="btn btn-primary">Log Activity</button>
      </div>`;
    document.getElementById('btn-new-activity').addEventListener('click', () => openActivityModal(candidates, jobs));
    return;
  }

  content.innerHTML = `
    <div class="outreach-page">
      <div class="search-bar">
        <input type="text" id="outreach-search" class="form-input" placeholder="Search activities…">
      </div>
      <div class="activity-filter-bar">
        <button class="activity-filter-btn active" data-type="">All</button>
        <button class="activity-filter-btn" data-type="email">Email</button>
        <button class="activity-filter-btn" data-type="call">Call</button>
        <button class="activity-filter-btn" data-type="interview">Interview</button>
        <button class="activity-filter-btn" data-type="note">Note</button>
        <button class="activity-filter-btn" data-type="submission">Submission</button>
      </div>
      <div id="outreach-list"></div>
    </div>`;

  let filterType = '';
  const listContainer = document.getElementById('outreach-list');

  function renderList(list) {
    if (list.length === 0) {
      listContainer.innerHTML = `<div class="empty-state"><p>No matching activities.</p></div>`;
      return;
    }
    listContainer.innerHTML = list.map(a => renderActivityRow(a, candidateMap, jobMap)).join('');
  }

  function getFiltered() {
    return filterType ? sorted.filter(a => a.type === filterType) : sorted;
  }

  renderList(getFiltered());

  // Filter buttons
  content.querySelectorAll('.activity-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      content.querySelectorAll('.activity-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterType = btn.dataset.type;
      renderList(getFiltered());
    });
  });

  // Search
  const sc = new SearchController((results) => {
    if (!results) { renderList(getFiltered()); return; }
    renderList(results);
  });

  document.getElementById('outreach-search').addEventListener('input', (e) => {
    sc.search(e.target.value, (q) => {
      const lower = q.toLowerCase();
      return getFiltered().filter(a => {
        const cand = candidateMap.get(a.candidateId);
        const searchable = [
          a.subject, a.body, a.type,
          cand ? `${cand.firstName} ${cand.lastName}` : '',
        ].join(' ').toLowerCase();
        return searchable.includes(lower);
      });
    });
  });

  // New activity button
  document.getElementById('btn-new-activity').addEventListener('click', () => {
    openActivityModal(candidates, jobs);
  });

  // Event delegation for activity rows
  listContainer.addEventListener('click', (e) => {
    // Let links navigate without opening the detail modal
    if (e.target.closest('.activity-link')) {
      e.stopPropagation();
      return;
    }
    const row = e.target.closest('.activity-row');
    if (!row) return;
    const deleteBtn = e.target.closest('.activity-delete');
    if (deleteBtn) {
      handleDeleteActivity(deleteBtn.dataset.id);
      return;
    }
    // Click on row → view activity detail
    openActivityDetailModal(row.dataset.id, candidateMap, jobMap);
  });
}

function renderActivityRow(activity, candidateMap, jobMap) {
  const cand = candidateMap.get(activity.candidateId);
  const job = jobMap.get(activity.jobId);

  return `
    <div class="activity-row" data-id="${activity.id}">
      <div class="activity-type-icon activity-type--${activity.type}" title="${escapeHtml(activity.type)}">
        ${TYPE_ICONS[activity.type] || '&#9679;'}
      </div>
      <div class="activity-row-content">
        <div class="activity-row-header">
          <span class="activity-subject">${escapeHtml(activity.subject || activity.type)}</span>
          ${activity.status ? `<span class="activity-status activity-status--${activity.status}">${escapeHtml(activity.status)}</span>` : ''}
        </div>
        <div class="activity-row-meta">
          ${cand ? `<a href="#/candidate/${cand.id}" class="link activity-link">${escapeHtml(cand.firstName)} ${escapeHtml(cand.lastName)}</a>` : '<span class="text-secondary">Unknown person</span>'}
          ${job ? ` — <a href="#/job/${job.id}" class="link activity-link">${escapeHtml(job.title)}</a>` : ''}
        </div>
        ${activity.followUpDate ? `<div class="activity-followup">Follow up: ${formatDate(activity.followUpDate)}</div>` : ''}
      </div>
      <div class="activity-row-date">${formatDate(activity.createdAt)}</div>
      <button class="activity-delete" data-id="${activity.id}" title="Delete">&times;</button>
    </div>`;
}

// ── Activity Detail Modal ──────────────────────────────────

async function openActivityDetailModal(activityId, candidateMap, jobMap) {
  const activity = await db.getActivity(activityId);
  if (!activity) return;

  const cand = candidateMap.get(activity.candidateId);
  const job = jobMap.get(activity.jobId);

  const body = `
    <div class="activity-detail">
      <div class="detail-fields">
        <div class="detail-field"><span class="detail-label">Type</span><span class="detail-value">${escapeHtml(activity.type)}</span></div>
        <div class="detail-field"><span class="detail-label">Subject</span><span class="detail-value">${escapeHtml(activity.subject || '—')}</span></div>
        <div class="detail-field"><span class="detail-label">Person</span><span class="detail-value">${cand ? escapeHtml(`${cand.firstName} ${cand.lastName}`) : '—'}</span></div>
        ${job ? `<div class="detail-field"><span class="detail-label">Job</span><span class="detail-value">${escapeHtml(job.title)}</span></div>` : ''}
        ${activity.status ? `<div class="detail-field"><span class="detail-label">Status</span><span class="detail-value">${escapeHtml(activity.status)}</span></div>` : ''}
        ${activity.followUpDate ? `<div class="detail-field"><span class="detail-label">Follow Up</span><span class="detail-value">${formatDate(activity.followUpDate)}</span></div>` : ''}
        <div class="detail-field"><span class="detail-label">Logged</span><span class="detail-value">${formatDate(activity.createdAt)}</span></div>
      </div>
      ${activity.body ? `<div class="activity-body-block"><h4>Body</h4><pre class="activity-body-text">${escapeHtml(activity.body)}</pre></div>` : ''}
    </div>`;

  openModal({ title: activity.subject || activity.type, body });
}

// ── Log Activity Modal ─────────────────────────────────────

export async function openActivityModal(candidates, jobs, prefill = {}) {
  if (!candidates) candidates = await db.getAllCandidates();
  if (!jobs) jobs = await db.getAllJobs();

  const templates = (await db.getSetting('emailTemplates')) || [];

  const body = document.createElement('form');
  body.id = 'activity-form';
  body.className = 'form';
  body.innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label for="activity-type">Type *</label>
        <select id="activity-type" class="form-select" required>
          <option value="email" ${prefill.type === 'email' ? 'selected' : ''}>Email</option>
          <option value="call" ${prefill.type === 'call' ? 'selected' : ''}>Call</option>
          <option value="interview" ${prefill.type === 'interview' ? 'selected' : ''}>Interview</option>
          <option value="note" ${(!prefill.type || prefill.type === 'note') ? 'selected' : ''}>Note</option>
          <option value="submission" ${prefill.type === 'submission' ? 'selected' : ''}>Submission</option>
        </select>
      </div>
      <div class="form-group">
        <label for="activity-status">Status</label>
        <select id="activity-status" class="form-select">
          <option value="">—</option>
          <option value="sent">Sent</option>
          <option value="replied">Replied</option>
          <option value="no-response">No Response</option>
          <option value="bounced">Bounced</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label for="activity-candidate">Person *</label>
        <select id="activity-candidate" class="form-select" required>
          <option value="">— Select —</option>
          ${candidates.sort((a, b) => a.lastName.localeCompare(b.lastName)).map(c =>
            `<option value="${c.id}" ${prefill.candidateId === c.id ? 'selected' : ''}>${escapeHtml(c.lastName)}, ${escapeHtml(c.firstName)}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group">
        <label for="activity-job">Job (optional)</label>
        <select id="activity-job" class="form-select">
          <option value="">—</option>
          ${jobs.filter(j => j.status === 'open').map(j =>
            `<option value="${j.id}" ${prefill.jobId === j.id ? 'selected' : ''}>${escapeHtml(j.title)}</option>`
          ).join('')}
        </select>
      </div>
    </div>
    ${templates.length > 0 ? `
    <div class="form-group" id="template-group">
      <label for="activity-template">Template</label>
      <select id="activity-template" class="form-select">
        <option value="">— None —</option>
        ${templates.map((t, i) => `<option value="${i}">${escapeHtml(t.name)}</option>`).join('')}
      </select>
    </div>` : ''}
    <div class="form-group">
      <label for="activity-subject">Subject</label>
      <input type="text" id="activity-subject" class="form-input" value="${escapeHtml(prefill.subject || '')}" placeholder="Subject line or topic">
    </div>
    <div class="form-group">
      <label for="activity-body">Body / Notes</label>
      <textarea id="activity-body" class="form-textarea" rows="5" placeholder="Details, message content, or notes…">${escapeHtml(prefill.body || '')}</textarea>
    </div>
    <div class="form-group">
      <label for="activity-followup">Follow-up Date</label>
      <input type="date" id="activity-followup" class="form-input" value="${prefill.followUpDate || ''}">
    </div>
  `;

  const footer = document.createElement('div');
  footer.className = 'modal-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = closeModal;
  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Log Activity';
  footer.append(cancelBtn, saveBtn);

  openModal({ title: 'Log Activity', body, footer });

  // Template selection fills subject + body
  const templateSelect = document.getElementById('activity-template');
  if (templateSelect) {
    templateSelect.addEventListener('change', () => {
      const idx = parseInt(templateSelect.value, 10);
      if (isNaN(idx)) return;
      const tpl = templates[idx];
      if (!tpl) return;

      const candidateId = document.getElementById('activity-candidate').value;
      const cand = candidates.find(c => c.id === candidateId);
      const jobId = document.getElementById('activity-job').value;
      const job = jobs.find(j => j.id === jobId);

      document.getElementById('activity-subject').value = fillTemplate(tpl.subject || '', cand, job);
      document.getElementById('activity-body').value = fillTemplate(tpl.body || '', cand, job);
    });
  }

  // Submit
  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    const candidateId = document.getElementById('activity-candidate').value;
    if (!candidateId) { toast('Select a person', { type: 'error' }); return; }

    const data = {
      type: document.getElementById('activity-type').value,
      candidateId,
      jobId: document.getElementById('activity-job').value || '',
      subject: document.getElementById('activity-subject').value.trim(),
      body: document.getElementById('activity-body').value.trim(),
      templateUsed: templateSelect ? (templates[parseInt(templateSelect.value, 10)]?.name || null) : null,
      status: document.getElementById('activity-status').value || null,
      followUpDate: document.getElementById('activity-followup').value || null,
    };

    try {
      await db.addActivity(data);
      closeModal();
      toast('Activity logged', { type: 'success' });
      // Re-render if on outreach page
      if (location.hash === '#/outreach') renderOutreach();
    } catch (err) {
      toast('Failed to log activity: ' + err.message, { type: 'error' });
    }
  });
}

// ── Delete Activity ────────────────────────────────────────

async function handleDeleteActivity(activityId) {
  if (!window.confirm('Delete this activity?')) return;
  try {
    await db.deleteActivity(activityId);
    toast('Activity deleted', { type: 'info' });
    if (location.hash === '#/outreach') renderOutreach();
  } catch (err) {
    toast('Failed to delete: ' + err.message, { type: 'error' });
  }
}

// ── Template Management ────────────────────────────────────

export async function renderTemplateSettings(container) {
  const templates = (await db.getSetting('emailTemplates')) || [];

  container.innerHTML = `
    <div id="template-list">
      ${templates.length === 0 ? '<p class="text-secondary">No templates yet.</p>' : ''}
      ${templates.map((t, i) => `
        <div class="template-row">
          <div class="template-row-info">
            <strong>${escapeHtml(t.name)}</strong>
            <span class="text-secondary">${escapeHtml(t.subject || '')}</span>
          </div>
          <div class="template-row-actions">
            <button class="btn btn-xs btn-secondary template-edit" data-index="${i}">Edit</button>
            <button class="btn btn-xs btn-danger template-delete" data-index="${i}">Remove</button>
          </div>
        </div>
      `).join('')}
    </div>
    <button id="btn-add-template" class="btn btn-secondary btn-sm" style="margin-top: 8px;">+ Add Template</button>
  `;

  container.querySelector('#btn-add-template').addEventListener('click', () => openTemplateModal(templates, null));

  container.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.template-edit');
    const deleteBtn = e.target.closest('.template-delete');
    if (editBtn) {
      openTemplateModal(templates, parseInt(editBtn.dataset.index, 10));
    }
    if (deleteBtn) {
      const idx = parseInt(deleteBtn.dataset.index, 10);
      templates.splice(idx, 1);
      db.setSetting('emailTemplates', templates).then(() => {
        toast('Template removed', { type: 'info' });
        renderTemplateSettings(container);
      });
    }
  });
}

function openTemplateModal(templates, editIndex) {
  const isEdit = editIndex !== null;
  const tpl = isEdit ? templates[editIndex] : {};

  const body = document.createElement('form');
  body.id = 'template-form';
  body.className = 'form';
  body.innerHTML = `
    <div class="form-group">
      <label for="tpl-name">Template Name *</label>
      <input type="text" id="tpl-name" class="form-input" required value="${escapeHtml(tpl.name || '')}" placeholder="e.g., Initial Outreach">
    </div>
    <div class="form-group">
      <label for="tpl-subject">Subject Line</label>
      <input type="text" id="tpl-subject" class="form-input" value="${escapeHtml(tpl.subject || '')}" placeholder="e.g., {{firstName}} — Opportunity at {{currentEmployer}}">
    </div>
    <div class="form-group">
      <label for="tpl-body">Body</label>
      <textarea id="tpl-body" class="form-textarea" rows="8" placeholder="Hi {{firstName}},\n\nI wanted to reach out about…">${escapeHtml(tpl.body || '')}</textarea>
    </div>
    <p class="text-secondary" style="font-size: 12px; margin-top: 4px;">
      Available placeholders: <code>{{firstName}}</code> <code>{{lastName}}</code> <code>{{email}}</code> <code>{{currentTitle}}</code> <code>{{currentEmployer}}</code> <code>{{jobTitle}}</code>
    </p>
  `;

  const footer = document.createElement('div');
  footer.className = 'modal-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = closeModal;
  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = isEdit ? 'Update' : 'Add Template';
  footer.append(cancelBtn, saveBtn);

  openModal({ title: isEdit ? 'Edit Template' : 'New Template', body, footer });

  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('tpl-name').value.trim();
    if (!name) { toast('Name is required', { type: 'error' }); return; }

    const data = {
      name,
      subject: document.getElementById('tpl-subject').value.trim(),
      body: document.getElementById('tpl-body').value.trim(),
    };

    if (isEdit) {
      templates[editIndex] = data;
    } else {
      templates.push(data);
    }

    await db.setSetting('emailTemplates', templates);
    closeModal();
    toast(isEdit ? 'Template updated' : 'Template added', { type: 'success' });
    // Re-render settings if on that page
    if (location.hash === '#/settings') {
      const container = document.getElementById('template-settings-container');
      if (container) renderTemplateSettings(container);
    }
  });
}

// ── Template Placeholder Substitution ──────────────────────

const TEMPLATE_PLACEHOLDERS = new Set([
  'firstName', 'lastName', 'email', 'currentTitle', 'currentEmployer',
  'jobTitle',
]);

function fillTemplate(text, candidate, job) {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!TEMPLATE_PLACEHOLDERS.has(key)) return match;
    if (key === 'jobTitle') return job ? job.title : match;
    if (candidate && candidate[key]) return candidate[key];
    return match;
  });
}

// ── Activity Timeline (for candidate detail) ───────────────

export async function renderActivityTimeline(candidateId, container) {
  let activities;
  try {
    activities = await db.getActivitiesByCandidate(candidateId);
  } catch {
    container.innerHTML = '<p class="text-secondary">Failed to load activities.</p>';
    return;
  }

  if (activities.length === 0) {
    container.innerHTML = '<p class="text-secondary">No activity logged yet.</p>';
    return;
  }

  const jobs = await db.getAllJobs();
  const jobMap = new Map(jobs.map(j => [j.id, j]));

  // Sort newest first
  activities.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  container.innerHTML = `
    <div class="activity-timeline">
      ${activities.map(a => {
        const job = jobMap.get(a.jobId);
        return `
          <div class="timeline-item">
            <div class="timeline-icon activity-type--${a.type}">${TYPE_ICONS[a.type] || '&#9679;'}</div>
            <div class="timeline-content">
              <div class="timeline-header">
                <span class="timeline-subject">${escapeHtml(a.subject || a.type)}</span>
                <span class="timeline-date">${formatDate(a.createdAt)}</span>
              </div>
              ${a.body ? `<div class="timeline-body">${escapeHtml(a.body).slice(0, 200)}${a.body.length > 200 ? '…' : ''}</div>` : ''}
              <div class="timeline-meta">
                ${a.status ? `<span class="activity-status activity-status--${a.status}">${escapeHtml(a.status)}</span>` : ''}
                ${job ? `<span class="text-secondary">${escapeHtml(job.title)}</span>` : ''}
                ${a.followUpDate ? `<span class="activity-followup">Follow up: ${formatDate(a.followUpDate)}</span>` : ''}
              </div>
            </div>
          </div>`;
      }).join('')}
    </div>`;
}
