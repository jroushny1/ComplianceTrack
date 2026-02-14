/**
 * candidates.js — Candidate CRUD, list view (cards + table), detail view, cert tracker UI
 */

import db, { getCertStatus, getCertUrgency, getCertDaysRemaining, FINRA_LICENSES, COMPLIANCE_CERTS } from './db.js';
import { openModal, closeModal, confirm, toast, SearchController, setHeaderTitle, setHeaderActions, formatDate, escapeHtml, markDirty, clearDirty } from './ui.js';

// ── State ───────────────────────────────────────────────────

let viewMode = 'cards'; // 'cards' | 'table'
let filterCert = '';
let filterLocation = '';

const searchCtrl = new SearchController((results, query) => {
  renderResults(results, query);
});

// ── Candidate List View ─────────────────────────────────────

// Cached candidates for the current list view session (avoids getAll per keystroke)
let _listCache = null;

export async function renderCandidateList() {
  setHeaderTitle('Candidates');
  setHeaderActions(`<a href="#/candidate/new" class="btn btn-primary btn-sm">+ Add Candidate</a>`);
  const content = document.getElementById('content');

  let candidates;
  try {
    candidates = await db.getAllCandidates();
    _listCache = candidates;
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><p>Failed to load candidates.</p></div>`;
    toast('Database error: ' + err.message, { type: 'error' });
    return;
  }

  content.innerHTML = `
    <div class="candidates-page">
      <div class="list-toolbar">
        <div class="search-group">
          <input type="search" id="candidate-search" class="form-input search-input" placeholder="Search candidates...">
        </div>
        <div class="filter-group">
          <select id="filter-cert" class="form-select">
            <option value="">All Certs</option>
            ${getCertOptions().map(c => `<option value="${escapeHtml(c)}" ${filterCert === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
          <select id="filter-location" class="form-select">
            <option value="">All Locations</option>
            ${getLocationOptions(candidates).map(l => `<option value="${escapeHtml(l)}" ${filterLocation === l ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}
          </select>
          <div class="view-toggle">
            <button class="view-btn ${viewMode === 'cards' ? 'active' : ''}" data-mode="cards" title="Card view">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            </button>
            <button class="view-btn ${viewMode === 'table' ? 'active' : ''}" data-mode="table" title="Table view">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
          </div>
        </div>
      </div>
      <div id="candidates-results"></div>
    </div>
  `;

  // Initial render
  renderResults(applyFilters(candidates), '');

  // Search (uses cached candidates — no db round-trip per keystroke)
  const searchInput = document.getElementById('candidate-search');
  searchInput.addEventListener('input', () => {
    searchCtrl.search(searchInput.value, async (query) => {
      const all = _listCache || await db.getAllCandidates();
      return applyFilters(searchCandidates(all, query));
    });
  });

  // Filters
  document.getElementById('filter-cert').addEventListener('change', (e) => {
    filterCert = e.target.value;
    refreshList(searchInput.value);
  });
  document.getElementById('filter-location').addEventListener('change', (e) => {
    filterLocation = e.target.value;
    refreshList(searchInput.value);
  });

  // View toggle
  content.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      viewMode = btn.dataset.mode;
      content.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === viewMode));
      refreshList(searchInput.value);
    });
  });
}

async function refreshList(query) {
  const all = _listCache || await db.getAllCandidates();
  const filtered = query.trim() ? applyFilters(searchCandidates(all, query)) : applyFilters(all);
  renderResults(filtered, query);
}

function searchCandidates(candidates, query) {
  const q = query.toLowerCase();
  return candidates.filter(c => {
    const searchable = [
      c.firstName, c.lastName, c.email, c.phone,
      c.currentEmployer, c.currentTitle, c.location,
      ...(c.certifications || []).map(cert => cert.name),
      ...(c.skills || []),
    ].join(' ').toLowerCase();
    return searchable.includes(q);
  });
}

function applyFilters(candidates) {
  let result = candidates;
  if (filterCert) {
    result = result.filter(c => (c.certifications || []).some(cert => cert.name === filterCert));
  }
  if (filterLocation) {
    result = result.filter(c => c.location === filterLocation);
  }
  return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function renderResults(results, query) {
  const container = document.getElementById('candidates-results');
  if (!container) return;

  if (results === null) {
    // Cleared search — show all
    refreshList('');
    return;
  }

  if (results.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>${query ? `No candidates matching "${escapeHtml(query)}"` : 'No candidates yet'}</p>
        ${!query ? '<a href="#/candidate/new" class="btn btn-primary">Add First Candidate</a>' : ''}
      </div>
    `;
    return;
  }

  if (viewMode === 'table') {
    renderTable(container, results);
  } else {
    renderCards(container, results);
  }
}

function renderCards(container, candidates) {
  container.innerHTML = `
    <div class="candidate-grid">
      ${candidates.map(c => `
        <a href="#/candidate/${c.id}" class="candidate-card">
          <div class="candidate-card-header">
            <div class="candidate-name">${escapeHtml(c.firstName)} ${escapeHtml(c.lastName)}</div>
            ${c.location ? `<div class="candidate-location">${escapeHtml(c.location)}</div>` : ''}
          </div>
          <div class="candidate-card-body">
            ${c.currentTitle ? `<div class="candidate-title">${escapeHtml(c.currentTitle)}</div>` : ''}
            ${c.currentEmployer ? `<div class="candidate-employer">${escapeHtml(c.currentEmployer)}</div>` : ''}
          </div>
          <div class="candidate-card-footer">
            ${renderCertBadges(c.certifications || [])}
          </div>
        </a>
      `).join('')}
    </div>
  `;
}

function renderTable(container, candidates) {
  container.innerHTML = `
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Title</th>
            <th>Employer</th>
            <th>Location</th>
            <th>Certifications</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          ${candidates.map(c => `
            <tr class="clickable-row" data-href="#/candidate/${c.id}">
              <td><strong>${escapeHtml(c.firstName)} ${escapeHtml(c.lastName)}</strong></td>
              <td>${escapeHtml(c.currentTitle || '—')}</td>
              <td>${escapeHtml(c.currentEmployer || '—')}</td>
              <td>${escapeHtml(c.location || '—')}</td>
              <td>${renderCertBadges(c.certifications || [])}</td>
              <td class="text-secondary">${formatDate(c.updatedAt)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Clickable rows
  container.querySelectorAll('.clickable-row').forEach(row => {
    row.addEventListener('click', () => { location.hash = row.dataset.href; });
  });
}

function renderCertBadges(certs) {
  if (certs.length === 0) return '<span class="text-secondary">No certs</span>';
  return certs.slice(0, 4).map(cert => {
    const status = getCertStatus(cert);
    const urgency = getCertUrgency(cert);
    let cls = 'cert-badge';
    if (urgency === 'expired') cls += ' cert-badge--expired';
    else if (urgency === 'expiring-soon') cls += ' cert-badge--expiring';
    else cls += ' cert-badge--active';
    return `<span class="${cls}">${escapeHtml(cert.name)}</span>`;
  }).join('') + (certs.length > 4 ? `<span class="cert-badge cert-badge--more">+${certs.length - 4}</span>` : '');
}

// ── Candidate Detail View ───────────────────────────────────

export async function renderCandidateDetail(id) {
  const content = document.getElementById('content');
  let candidate;
  try {
    candidate = await db.getCandidate(id);
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><p>Failed to load candidate.</p></div>`;
    toast('Database error: ' + err.message, { type: 'error' });
    return;
  }

  if (!candidate) {
    content.innerHTML = `<div class="empty-state"><p>Candidate not found.</p><a href="#/candidates" class="btn btn-secondary">Back to List</a></div>`;
    return;
  }

  setHeaderTitle(`${candidate.firstName} ${candidate.lastName}`);
  setHeaderActions(`
    <a href="#/candidate/${id}/edit" class="btn btn-secondary btn-sm">Edit</a>
    <button id="btn-delete-candidate" class="btn btn-danger btn-sm">Delete</button>
  `);

  const alertDays = (await db.getSetting('certAlertDays')) || 60;

  content.innerHTML = `
    <div class="candidate-detail">
      <div class="detail-grid">
        <div class="detail-main">
          <div class="detail-section">
            <h3 class="section-title">Contact</h3>
            <div class="detail-fields">
              ${detailField('Email', candidate.email, candidate.email ? `mailto:${candidate.email}` : null)}
              ${detailField('Phone', candidate.phone, candidate.phone ? `tel:${candidate.phone}` : null)}
              ${detailField('Location', candidate.location)}
            </div>
          </div>

          <div class="detail-section">
            <h3 class="section-title">Professional</h3>
            <div class="detail-fields">
              ${detailField('Title', candidate.currentTitle)}
              ${detailField('Employer', candidate.currentEmployer)}
              ${detailField('Source', candidate.source)}
              ${candidate.salaryMin || candidate.salaryMax ? detailField('Salary Range', formatSalary(candidate.salaryMin, candidate.salaryMax)) : ''}
            </div>
          </div>

          ${candidate.skills && candidate.skills.length > 0 ? `
          <div class="detail-section">
            <h3 class="section-title">Skills</h3>
            <div class="skill-tags">
              ${candidate.skills.map(s => `<span class="skill-tag">${escapeHtml(s)}</span>`).join('')}
            </div>
          </div>
          ` : ''}

          ${candidate.notes ? `
          <div class="detail-section">
            <h3 class="section-title">Notes</h3>
            <div class="notes-content">${escapeHtml(candidate.notes)}</div>
          </div>
          ` : ''}
        </div>

        <div class="detail-sidebar">
          <div class="detail-section">
            <div class="section-title-row">
              <h3 class="section-title">Certifications</h3>
              <button id="btn-add-cert" class="btn btn-sm btn-secondary">+ Add</button>
            </div>
            <div id="cert-list">
              ${renderCertList(candidate.certifications || [], alertDays)}
            </div>
          </div>
        </div>
      </div>

      <div class="detail-meta">
        <span>Created ${formatDate(candidate.createdAt)}</span>
        <span>Updated ${formatDate(candidate.updatedAt)}</span>
        ${candidate.externalId ? `<span>Loxo ID: ${escapeHtml(candidate.externalId)}</span>` : ''}
      </div>
    </div>
  `;

  // Delete
  document.getElementById('btn-delete-candidate').addEventListener('click', async () => {
    const ok = await confirm(`Delete ${candidate.firstName} ${candidate.lastName}? This cannot be undone.`);
    if (!ok) return;
    try {
      const snapshot = { ...candidate, certifications: [...(candidate.certifications || [])] };
      await db.deleteCandidate(id);
      _listCache = null;
      toast(`Deleted ${candidate.firstName} ${candidate.lastName}`, {
        type: 'info',
        duration: 10000,
        actionLabel: 'Undo',
        action: async () => {
          try {
            await db.put('candidates', snapshot);
            _listCache = null;
            toast('Restored', { type: 'success' });
            location.hash = `#/candidate/${id}`;
          } catch (err) {
            toast('Failed to restore: ' + err.message, { type: 'error' });
          }
        },
      });
      location.hash = '#/candidates';
    } catch (err) {
      toast('Failed to delete: ' + err.message, { type: 'error' });
    }
  });

  // Add cert
  document.getElementById('btn-add-cert').addEventListener('click', () => {
    openCertModal(candidate);
  });

  // Edit/delete certs (event delegation)
  document.getElementById('cert-list').addEventListener('click', (e) => {
    const editBtn = e.target.closest('.cert-edit');
    const deleteBtn = e.target.closest('.cert-delete');
    if (editBtn) {
      const idx = parseInt(editBtn.dataset.index, 10);
      openCertModal(candidate, idx);
    }
    if (deleteBtn) {
      const idx = parseInt(deleteBtn.dataset.index, 10);
      removeCert(candidate, idx);
    }
  });
}

function detailField(label, value, href) {
  if (!value) return `<div class="detail-field"><span class="detail-label">${label}</span><span class="detail-value text-secondary">—</span></div>`;
  const display = escapeHtml(value);
  const val = href ? `<a href="${href}" class="link">${display}</a>` : display;
  return `<div class="detail-field"><span class="detail-label">${label}</span><span class="detail-value">${val}</span></div>`;
}

function formatSalary(min, max) {
  const fmt = (n) => n ? `$${n.toLocaleString()}` : '';
  if (min && max) return `${fmt(min)} — ${fmt(max)}`;
  if (min) return `${fmt(min)}+`;
  if (max) return `Up to ${fmt(max)}`;
  return '';
}

function renderCertList(certs, alertDays) {
  if (certs.length === 0) {
    return '<p class="text-secondary">No certifications added yet.</p>';
  }
  return certs.map((cert, i) => {
    const status = getCertStatus(cert);
    const urgency = getCertUrgency(cert, alertDays);
    const days = getCertDaysRemaining(cert);
    let statusClass = 'cert-status--active';
    let statusText = 'Active';
    if (status === 'pending') { statusClass = 'cert-status--pending'; statusText = 'Pending'; }
    if (urgency === 'expired') { statusClass = 'cert-status--expired'; statusText = 'Expired'; }
    else if (urgency === 'expiring-soon') { statusClass = 'cert-status--expiring'; statusText = `${days}d remaining`; }

    return `
      <div class="cert-item">
        <div class="cert-item-header">
          <span class="cert-item-name">${escapeHtml(cert.name)}</span>
          <span class="cert-status ${statusClass}">${statusText}</span>
        </div>
        <div class="cert-item-details">
          <span>${escapeHtml(cert.issuingBody || '—')}</span>
          <span>${cert.dateObtained ? formatDate(cert.dateObtained) : '—'}</span>
          <span>${cert.expirationDate ? `Exp: ${formatDate(cert.expirationDate)}` : 'No expiry'}</span>
          ${cert.renewalCycle ? `<span>${escapeHtml(cert.renewalCycle)}</span>` : ''}
        </div>
        <div class="cert-item-actions">
          <button class="btn btn-xs btn-secondary cert-edit" data-index="${i}">Edit</button>
          <button class="btn btn-xs btn-danger cert-delete" data-index="${i}">Remove</button>
        </div>
      </div>
    `;
  }).join('');
}

// ── Cert Modal (Add / Edit) ─────────────────────────────────

async function openCertModal(candidate, editIndex = null) {
  const isEdit = editIndex !== null;
  const cert = isEdit ? candidate.certifications[editIndex] : {};
  const customCerts = (await db.getSetting('customCertTypes')) || [];

  const allCerts = [
    ...FINRA_LICENSES.map(c => ({ ...c, type: 'finra' })),
    ...COMPLIANCE_CERTS.map(c => ({ ...c, type: 'compliance' })),
    ...customCerts.map(c => ({ ...c, type: 'custom' })),
  ];

  const body = document.createElement('form');
  body.id = 'cert-form';
  body.className = 'form';
  body.innerHTML = `
    <div class="form-group">
      <label for="cert-select">Certification</label>
      <select id="cert-select" class="form-select" ${isEdit ? 'disabled' : ''}>
        <option value="">— Select or type below —</option>
        <optgroup label="FINRA Licenses">
          ${FINRA_LICENSES.map(c => `<option value="${c.name}" ${cert.name === c.name ? 'selected' : ''}>${c.name} — ${c.description}</option>`).join('')}
        </optgroup>
        <optgroup label="Compliance Certifications">
          ${COMPLIANCE_CERTS.map(c => `<option value="${c.name}" ${cert.name === c.name ? 'selected' : ''}>${c.name} — ${c.description}</option>`).join('')}
        </optgroup>
        ${customCerts.length > 0 ? `
        <optgroup label="Custom">
          ${customCerts.map(c => `<option value="${c.name}" ${cert.name === c.name ? 'selected' : ''}>${c.name}</option>`).join('')}
        </optgroup>
        ` : ''}
        <option value="__custom__">Other (custom)...</option>
      </select>
    </div>
    <div id="custom-cert-fields" class="form-row" style="display: none;">
      <div class="form-group">
        <label for="cert-custom-name">Cert Name</label>
        <input type="text" id="cert-custom-name" class="form-input" value="${escapeHtml(cert.name || '')}">
      </div>
      <div class="form-group">
        <label for="cert-custom-body">Issuing Body</label>
        <input type="text" id="cert-custom-body" class="form-input" value="${escapeHtml(cert.issuingBody || '')}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label for="cert-obtained">Date Obtained</label>
        <input type="date" id="cert-obtained" class="form-input" value="${cert.dateObtained ? cert.dateObtained.slice(0, 10) : ''}">
      </div>
      <div class="form-group">
        <label for="cert-expiration">Expiration Date</label>
        <input type="date" id="cert-expiration" class="form-input" value="${cert.expirationDate ? cert.expirationDate.slice(0, 10) : ''}">
      </div>
    </div>
    <div class="form-group">
      <label for="cert-renewal">Renewal Cycle</label>
      <input type="text" id="cert-renewal" class="form-input" placeholder="e.g., 3 years, Annual" value="${escapeHtml(cert.renewalCycle || '')}">
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
  saveBtn.textContent = isEdit ? 'Update' : 'Add';
  footer.append(cancelBtn, saveBtn);

  openModal({ title: isEdit ? 'Edit Certification' : 'Add Certification', body, footer });

  // Show/hide custom fields
  const select = document.getElementById('cert-select');
  const customFields = document.getElementById('custom-cert-fields');

  function updateCustomVisibility() {
    const isCustom = select.value === '__custom__' || select.disabled;
    customFields.style.display = isCustom ? 'flex' : 'none';
  }

  select.addEventListener('change', () => {
    if (select.value && select.value !== '__custom__') {
      const ref = allCerts.find(c => c.name === select.value);
      if (ref) {
        document.getElementById('cert-renewal').value = ref.renewal || '';
      }
    }
    updateCustomVisibility();
  });

  if (isEdit) updateCustomVisibility();

  // Submit
  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    const selectVal = select.value;
    let name, issuingBody, type;

    if (isEdit) {
      name = document.getElementById('cert-custom-name').value.trim() || cert.name;
      issuingBody = document.getElementById('cert-custom-body').value.trim() || cert.issuingBody;
      type = cert.type;
    } else if (selectVal === '__custom__') {
      name = document.getElementById('cert-custom-name').value.trim();
      issuingBody = document.getElementById('cert-custom-body').value.trim();
      type = 'custom';
    } else {
      const ref = allCerts.find(c => c.name === selectVal);
      if (!ref) { toast('Please select a certification', { type: 'error' }); return; }
      name = ref.name;
      issuingBody = ref.issuingBody;
      type = ref.type;
    }

    if (!name) { toast('Certification name is required', { type: 'error' }); return; }

    const newCert = {
      type: type || 'custom',
      name,
      issuingBody: issuingBody || '',
      dateObtained: document.getElementById('cert-obtained').value || null,
      expirationDate: document.getElementById('cert-expiration').value || null,
      renewalCycle: document.getElementById('cert-renewal').value.trim() || '',
    };

    if (isEdit) {
      candidate.certifications[editIndex] = newCert;
    } else {
      candidate.certifications = candidate.certifications || [];
      candidate.certifications.push(newCert);
    }

    try {
      await db.updateCandidate(candidate);
      closeModal();
      toast(isEdit ? 'Certification updated' : 'Certification added', { type: 'success' });
      renderCandidateDetail(candidate.id);
    } catch (err) {
      toast('Failed to save certification: ' + err.message, { type: 'error' });
    }
  });
}

async function removeCert(candidate, index) {
  const cert = candidate.certifications[index];
  const ok = await confirm(`Remove ${cert.name} certification?`);
  if (!ok) return;
  try {
    candidate.certifications.splice(index, 1);
    await db.updateCandidate(candidate);
    toast(`Removed ${cert.name}`, { type: 'info' });
    renderCandidateDetail(candidate.id);
  } catch (err) {
    toast('Failed to remove certification: ' + err.message, { type: 'error' });
  }
}

// ── Candidate Form (New / Edit) ─────────────────────────────

export async function renderCandidateForm(id) {
  const content = document.getElementById('content');
  const isEdit = !!id;
  let candidate = isEdit ? await db.getCandidate(id) : {};

  if (isEdit && !candidate) {
    content.innerHTML = `<div class="empty-state"><p>Candidate not found.</p></div>`;
    return;
  }

  setHeaderTitle(isEdit ? `Edit: ${candidate.firstName} ${candidate.lastName}` : 'New Candidate');
  setHeaderActions('');

  content.innerHTML = `
    <form id="candidate-form" class="form candidate-form">
      <div class="form-section">
        <h3 class="section-title">Basic Info</h3>
        <div class="form-row">
          <div class="form-group">
            <label for="firstName">First Name *</label>
            <input type="text" id="firstName" name="firstName" class="form-input" required value="${escapeHtml(candidate.firstName || '')}">
          </div>
          <div class="form-group">
            <label for="lastName">Last Name *</label>
            <input type="text" id="lastName" name="lastName" class="form-input" required value="${escapeHtml(candidate.lastName || '')}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" class="form-input" value="${escapeHtml(candidate.email || '')}">
          </div>
          <div class="form-group">
            <label for="phone">Phone</label>
            <input type="tel" id="phone" name="phone" class="form-input" value="${escapeHtml(candidate.phone || '')}">
          </div>
        </div>
      </div>

      <div class="form-section">
        <h3 class="section-title">Professional</h3>
        <div class="form-row">
          <div class="form-group">
            <label for="currentTitle">Current Title</label>
            <input type="text" id="currentTitle" name="currentTitle" class="form-input" value="${escapeHtml(candidate.currentTitle || '')}">
          </div>
          <div class="form-group">
            <label for="currentEmployer">Current Employer</label>
            <input type="text" id="currentEmployer" name="currentEmployer" class="form-input" value="${escapeHtml(candidate.currentEmployer || '')}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="location">Location</label>
            <input type="text" id="location" name="location" class="form-input" placeholder="e.g., New York, NY" value="${escapeHtml(candidate.location || '')}">
          </div>
          <div class="form-group">
            <label for="source">Source</label>
            <input type="text" id="source" name="source" class="form-input" placeholder="e.g., LinkedIn, Referral" value="${escapeHtml(candidate.source || '')}">
          </div>
        </div>
      </div>

      <div class="form-section">
        <h3 class="section-title">Compensation</h3>
        <div class="form-row">
          <div class="form-group">
            <label for="salaryMin">Salary Min ($)</label>
            <input type="number" id="salaryMin" name="salaryMin" class="form-input" min="0" step="1000" value="${candidate.salaryMin || ''}">
          </div>
          <div class="form-group">
            <label for="salaryMax">Salary Max ($)</label>
            <input type="number" id="salaryMax" name="salaryMax" class="form-input" min="0" step="1000" value="${candidate.salaryMax || ''}">
          </div>
        </div>
      </div>

      <div class="form-section">
        <h3 class="section-title">Skills</h3>
        <div class="form-group">
          <label for="skills">Skills (comma-separated)</label>
          <input type="text" id="skills" name="skills" class="form-input" placeholder="e.g., AML, BSA, KYC, Risk Management" value="${escapeHtml((candidate.skills || []).join(', '))}">
        </div>
      </div>

      <div class="form-section">
        <h3 class="section-title">Notes</h3>
        <div class="form-group">
          <textarea id="notes" name="notes" class="form-textarea" rows="4" placeholder="Free-text notes...">${escapeHtml(candidate.notes || '')}</textarea>
        </div>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="btn-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Save Changes' : 'Create Candidate'}</button>
      </div>
    </form>
  `;

  const form = document.getElementById('candidate-form');

  // Mark dirty on input
  form.addEventListener('input', () => markDirty());

  // Cancel
  document.getElementById('btn-cancel').addEventListener('click', () => {
    if (isEdit) {
      location.hash = `#/candidate/${id}`;
    } else {
      location.hash = '#/candidates';
    }
  });

  // Submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const firstName = form.firstName.value.trim();
    const lastName = form.lastName.value.trim();
    if (!firstName || !lastName) {
      toast('First and last name are required', { type: 'error' });
      return;
    }

    const data = {
      firstName,
      lastName,
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
      currentTitle: form.currentTitle.value.trim(),
      currentEmployer: form.currentEmployer.value.trim(),
      location: form.location.value.trim(),
      source: form.source.value.trim(),
      salaryMin: form.salaryMin.value ? parseInt(form.salaryMin.value, 10) : null,
      salaryMax: form.salaryMax.value ? parseInt(form.salaryMax.value, 10) : null,
      skills: form.skills.value.split(',').map(s => s.trim()).filter(Boolean),
      notes: form.notes.value.trim(),
    };

    clearDirty();

    try {
      if (isEdit) {
        Object.assign(candidate, data);
        await db.updateCandidate(candidate);
        _listCache = null;
        toast('Candidate updated', { type: 'success' });
        location.hash = `#/candidate/${id}`;
      } else {
        const newCandidate = await db.addCandidate(data);
        _listCache = null;
        toast('Candidate created', { type: 'success' });
        location.hash = `#/candidate/${newCandidate.id}`;
      }
    } catch (err) {
      toast('Failed to save: ' + err.message, { type: 'error' });
    }
  });
}

// ── Helpers ─────────────────────────────────────────────────

function getCertOptions() {
  const names = new Set();
  for (const c of FINRA_LICENSES) names.add(c.name);
  for (const c of COMPLIANCE_CERTS) names.add(c.name);
  return [...names].sort();
}

function getLocationOptions(candidates) {
  const locations = new Set();
  for (const c of candidates) {
    if (c.location) locations.add(c.location);
  }
  return [...locations].sort();
}
