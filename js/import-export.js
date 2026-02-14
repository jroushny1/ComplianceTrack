/**
 * import-export.js — CSV import (PapaParse), JSON export/backup
 * 4-step workflow: Upload+Map → Preview+Validate → Execute → Verify
 */

import db, { DB_VERSION, validateClient, validateJob, validatePipelineEntry, validateActivity } from './db.js';
import { setHeaderTitle, toast, openModal, closeModal, escapeHtml } from './ui.js';
import { invalidateListCache } from './candidates.js';
import { invalidateClientListCache } from './clients.js';
import { invalidateJobListCache } from './jobs.js';

// Load PapaParse (non-module script, available as global Papa)
let Papa;

async function loadPapaParse() {
  if (Papa) return;
  if (window.Papa) { Papa = window.Papa; return; }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'lib/papaparse.min.js';
    script.onload = () => { Papa = window.Papa; resolve(); };
    script.onerror = () => reject(new Error('Failed to load PapaParse'));
    document.head.appendChild(script);
  });
}

// ── CSV Sanitization ────────────────────────────────────────

function sanitizeCsvValue(value) {
  if (typeof value !== 'string') return value;
  value = value.replace(/<[^>]*>/g, '');                // strip HTML tags
  if (/^[=+\-@\t\r]/.test(value)) value = "'" + value; // neutralize formula injection
  return value.trim();
}

// ── Candidate field list for mapping ────────────────────────

const CANDIDATE_FIELDS = [
  { key: 'firstName', label: 'First Name', required: true },
  { key: 'lastName', label: 'Last Name', required: true },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'currentTitle', label: 'Title' },
  { key: 'currentEmployer', label: 'Employer' },
  { key: 'location', label: 'Location' },
  { key: 'skills', label: 'Skills (comma-separated)' },
  { key: 'salaryMin', label: 'Salary Min' },
  { key: 'salaryMax', label: 'Salary Max' },
  { key: 'notes', label: 'Notes' },
  { key: 'source', label: 'Source' },
  { key: 'externalId', label: 'Loxo ID / External ID' },
];

// Auto-suggest mapping based on similar column names
function autoSuggestMapping(csvHeader) {
  const lower = csvHeader.toLowerCase().replace(/[_\-\s]+/g, '');
  const hints = {
    firstname: 'firstName', first: 'firstName', fname: 'firstName',
    lastname: 'lastName', last: 'lastName', lname: 'lastName',
    email: 'email', emailaddress: 'email',
    phone: 'phone', phonenumber: 'phone', mobile: 'phone',
    title: 'currentTitle', jobtitle: 'currentTitle', position: 'currentTitle',
    employer: 'currentEmployer', company: 'currentEmployer', currentcompany: 'currentEmployer',
    location: 'location', city: 'location', state: 'location',
    skills: 'skills', skill: 'skills',
    salarymin: 'salaryMin', minsalary: 'salaryMin',
    salarymax: 'salaryMax', maxsalary: 'salaryMax',
    notes: 'notes', note: 'notes', comments: 'notes',
    source: 'source',
    externalid: 'externalId', loxoid: 'externalId', id: 'externalId',
  };
  return hints[lower] || '';
}

// ── Import/Export Page ──────────────────────────────────────

// Module state
let importState = null;

export async function renderImportExport() {
  setHeaderTitle('Import / Export');
  const content = document.getElementById('content');

  importState = null;

  content.innerHTML = `
    <div class="import-page">
      <div class="import-step">
        <h3>Import People from CSV</h3>
        <p class="section-desc">Upload a CSV file from Loxo or any other source. You'll map columns before importing.</p>
        <div id="drop-zone" class="drop-zone">
          <p><strong>Drop CSV file here</strong> or click to browse</p>
          <input type="file" id="csv-file-input" accept=".csv,.txt" hidden>
        </div>
      </div>

      <div id="import-workflow"></div>

      <div class="import-step" style="margin-top: 32px;">
        <h3>Export</h3>
        <p class="section-desc">Download a full backup of all your data as JSON.</p>
        <button id="btn-export-json" class="btn btn-primary">Export Full Backup (JSON)</button>
        <button id="btn-export-csv" class="btn btn-secondary" style="margin-left: 8px;">Export People (CSV)</button>
      </div>

      <div class="import-step">
        <h3>Restore from Backup</h3>
        <p class="section-desc">Import a previously exported JSON backup file.</p>
        <div id="restore-drop-zone" class="drop-zone">
          <p><strong>Drop JSON backup file here</strong> or click to browse</p>
          <input type="file" id="json-file-input" accept=".json" hidden>
        </div>
      </div>
    </div>
  `;

  // CSV file upload
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('csv-file-input');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleCsvUpload(file);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleCsvUpload(fileInput.files[0]);
  });

  // JSON restore
  const restoreZone = document.getElementById('restore-drop-zone');
  const jsonInput = document.getElementById('json-file-input');

  restoreZone.addEventListener('click', () => jsonInput.click());
  restoreZone.addEventListener('dragover', (e) => { e.preventDefault(); restoreZone.classList.add('drag-over'); });
  restoreZone.addEventListener('dragleave', () => restoreZone.classList.remove('drag-over'));
  restoreZone.addEventListener('drop', (e) => {
    e.preventDefault();
    restoreZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleJsonRestore(file);
  });
  jsonInput.addEventListener('change', () => {
    if (jsonInput.files[0]) handleJsonRestore(jsonInput.files[0]);
  });

  // Export buttons
  document.getElementById('btn-export-json').addEventListener('click', () => handleBackup());
  document.getElementById('btn-export-csv').addEventListener('click', () => handleCsvExport());
}

// ── Step 1: Upload + Map ────────────────────────────────────

async function handleCsvUpload(file) {
  await loadPapaParse();

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (results) => {
      if (results.errors.length > 0) {
        toast(`CSV parse errors: ${results.errors[0].message}`, { type: 'error' });
      }
      if (results.data.length === 0) {
        toast('CSV file is empty', { type: 'error' });
        return;
      }

      importState = {
        headers: results.meta.fields,
        data: results.data,
        mapping: {},
        fileName: file.name,
      };

      // Auto-suggest mappings
      for (const header of results.meta.fields) {
        const suggestion = autoSuggestMapping(header);
        if (suggestion) importState.mapping[header] = suggestion;
      }

      renderMappingStep();
    },
    error: (err) => {
      toast(`Failed to parse CSV: ${err.message}`, { type: 'error' });
    },
  });
}

function renderMappingStep() {
  const workflow = document.getElementById('import-workflow');

  workflow.innerHTML = `
    <div class="import-step">
      <h3>Step 1: Map Columns</h3>
      <p class="section-desc">Map CSV columns to person fields. Auto-suggested mappings are pre-filled.</p>
      <div class="mapping-grid">
        ${importState.headers.map(header => `
          <div class="form-group" style="margin:0">
            <span style="font-family: var(--font-mono); font-size: 13px;">${escapeHtml(header)}</span>
          </div>
          <span class="mapping-arrow">&rarr;</span>
          <select class="form-select mapping-select" data-csv-header="${escapeHtml(header)}">
            <option value="">— Skip —</option>
            ${CANDIDATE_FIELDS.map(f => `
              <option value="${f.key}" ${importState.mapping[header] === f.key ? 'selected' : ''}>${f.label}${f.required ? ' *' : ''}</option>
            `).join('')}
          </select>
        `).join('')}
      </div>
      <div style="margin-top: 16px;">
        <button id="btn-preview" class="btn btn-primary">Preview Import</button>
        <button id="btn-cancel-import" class="btn btn-secondary" style="margin-left: 8px;">Cancel</button>
      </div>
    </div>
  `;

  // Update mapping on select change
  workflow.querySelectorAll('.mapping-select').forEach(select => {
    select.addEventListener('change', () => {
      const header = select.dataset.csvHeader;
      if (select.value) {
        importState.mapping[header] = select.value;
      } else {
        delete importState.mapping[header];
      }
    });
  });

  document.getElementById('btn-preview').addEventListener('click', renderPreviewStep);
  document.getElementById('btn-cancel-import').addEventListener('click', () => {
    importState = null;
    document.getElementById('import-workflow').innerHTML = '';
  });
}

// ── Step 2: Preview + Validate ──────────────────────────────

async function renderPreviewStep() {
  // Validate required fields are mapped
  const mappedFields = Object.values(importState.mapping);
  const missingRequired = CANDIDATE_FIELDS.filter(f => f.required && !mappedFields.includes(f.key));
  if (missingRequired.length > 0) {
    toast(`Required fields not mapped: ${missingRequired.map(f => f.label).join(', ')}`, { type: 'error' });
    return;
  }

  // Transform data
  const transformed = importState.data.map(row => {
    const candidate = {};
    for (const [csvHeader, appField] of Object.entries(importState.mapping)) {
      let value = sanitizeCsvValue(row[csvHeader] || '');
      if (appField === 'skills') {
        candidate[appField] = value.split(',').map(s => s.trim()).filter(Boolean);
      } else if (appField === 'salaryMin' || appField === 'salaryMax') {
        const num = parseInt(value.replace(/[^0-9]/g, ''), 10);
        candidate[appField] = isNaN(num) ? null : num;
      } else {
        candidate[appField] = value;
      }
    }
    return candidate;
  });

  // Duplicate detection (O(n) via Map lookups)
  const existing = await db.getAllCandidates();
  const extIdMap = new Map();
  const emailMap = new Map();
  for (const c of existing) {
    if (c.externalId) extIdMap.set(c.externalId, c);
    if (c.email) emailMap.set(c.email.toLowerCase(), c);
  }

  let newCount = 0, updateCount = 0, dupCount = 0;
  const duplicates = [];

  for (const row of transformed) {
    let match = null;
    if (row.externalId) {
      match = extIdMap.get(row.externalId) || null;
    }
    if (!match && row.email) {
      match = emailMap.get(row.email.toLowerCase()) || null;
    }
    if (match) {
      row._existingId = match.id;
      row._dupAction = 'skip'; // default
      dupCount++;
      duplicates.push({ row, existing: match });
    } else {
      newCount++;
    }
  }

  importState.transformed = transformed;
  importState.duplicates = duplicates;

  const workflow = document.getElementById('import-workflow');
  const previewRows = transformed.slice(0, 20);

  workflow.innerHTML = `
    <div class="import-step">
      <h3>Step 2: Preview & Validate</h3>
      <div class="import-summary">
        ${importState.data.length} rows parsed &nbsp;|&nbsp;
        <strong>${newCount} new</strong> &nbsp;|&nbsp;
        ${dupCount > 0 ? `<span style="color: var(--cert-expiring)">${dupCount} duplicates</span>` : '0 duplicates'}
      </div>

      ${duplicates.length > 0 ? `
      <div style="margin-top: 12px;">
        <p class="section-desc">Duplicates detected (matched by ${duplicates[0].row.externalId ? 'External ID' : 'email'}). Choose action for each:</p>
        <div style="display: flex; gap: 8px; margin-bottom: 8px;">
          <button class="btn btn-xs btn-secondary" id="bulk-skip">Skip All</button>
          <button class="btn btn-xs btn-secondary" id="bulk-update">Update All</button>
        </div>
        ${duplicates.slice(0, 10).map((d, i) => `
          <div class="custom-cert-row" style="gap: 8px;">
            <span>${escapeHtml(d.row.firstName || '')} ${escapeHtml(d.row.lastName || '')} (${escapeHtml(d.row.email || d.row.externalId || '?')})</span>
            <select class="form-select dup-action" data-index="${i}" style="max-width: 120px;">
              <option value="skip" selected>Skip</option>
              <option value="update">Update</option>
              <option value="new">Create New</option>
            </select>
          </div>
        `).join('')}
        ${duplicates.length > 10 ? `<p class="text-secondary" style="margin-top: 4px;">...and ${duplicates.length - 10} more (will be skipped)</p>` : ''}
      </div>
      ` : ''}

      <h4 style="margin-top: 16px; margin-bottom: 8px;">Preview (first ${previewRows.length} rows)</h4>
      <div class="table-wrapper">
        <table class="preview-table">
          <thead>
            <tr>
              ${CANDIDATE_FIELDS.filter(f => Object.values(importState.mapping).includes(f.key)).map(f => `<th>${f.label}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${previewRows.map(row => `
              <tr>
                ${CANDIDATE_FIELDS.filter(f => Object.values(importState.mapping).includes(f.key)).map(f => {
                  const val = Array.isArray(row[f.key]) ? row[f.key].join(', ') : (row[f.key] ?? '');
                  return `<td>${escapeHtml(String(val))}</td>`;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div style="margin-top: 16px;">
        <button id="btn-execute-import" class="btn btn-primary">Import ${newCount} People</button>
        <button id="btn-back-mapping" class="btn btn-secondary" style="margin-left: 8px;">Back</button>
      </div>
    </div>
  `;

  // Dup actions
  workflow.querySelectorAll('.dup-action').forEach(select => {
    select.addEventListener('change', () => {
      const idx = parseInt(select.dataset.index, 10);
      duplicates[idx].row._dupAction = select.value;
    });
  });

  const bulkSkip = document.getElementById('bulk-skip');
  const bulkUpdate = document.getElementById('bulk-update');
  if (bulkSkip) {
    bulkSkip.addEventListener('click', () => {
      duplicates.forEach(d => d.row._dupAction = 'skip');
      workflow.querySelectorAll('.dup-action').forEach(s => s.value = 'skip');
    });
  }
  if (bulkUpdate) {
    bulkUpdate.addEventListener('click', () => {
      duplicates.forEach(d => d.row._dupAction = 'update');
      workflow.querySelectorAll('.dup-action').forEach(s => s.value = 'update');
    });
  }

  document.getElementById('btn-execute-import').addEventListener('click', executeImport);
  document.getElementById('btn-back-mapping').addEventListener('click', renderMappingStep);
}

// ── Step 3: Execute ─────────────────────────────────────────

async function executeImport() {
  const workflow = document.getElementById('import-workflow');

  // Auto-backup first
  toast('Creating backup before import...', { type: 'info', duration: 2000 });
  await handleBackup(true); // silent mode

  workflow.innerHTML = `
    <div class="import-step">
      <h3>Step 3: Importing...</h3>
      <div class="progress-bar-container">
        <div id="import-progress" class="progress-bar" style="width: 0%"></div>
      </div>
      <p id="import-status" class="text-secondary" style="margin-top: 8px;">Starting...</p>
    </div>
  `;

  const bar = document.getElementById('import-progress');
  const status = document.getElementById('import-status');
  const rows = importState.transformed;
  const BATCH_SIZE = 100;
  let created = 0, updated = 0, skipped = 0, errors = 0;

  // Pre-load existing candidates for O(1) lookup (avoids N+1)
  const allExisting = await db.getAllCandidates();
  const existingMap = new Map(allExisting.map(c => [c.id, c]));

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const toCreate = [];
    const toUpdate = [];

    for (const row of batch) {
      try {
        if (row._existingId && row._dupAction === 'skip') {
          skipped++;
          continue;
        }
        if (row._existingId && row._dupAction === 'update') {
          const existing = existingMap.get(row._existingId);
          if (existing) {
            for (const [key, value] of Object.entries(row)) {
              if (key.startsWith('_')) continue;
              if (value && value !== '' && (!Array.isArray(value) || value.length > 0)) {
                existing[key] = value;
              }
            }
            existing.updatedAt = new Date().toISOString();
            toUpdate.push(existing);
            continue;
          }
        }

        // Collect new candidates for batch write
        const data = {};
        for (const [key, value] of Object.entries(row)) {
          if (!key.startsWith('_')) data[key] = value;
        }
        toCreate.push(db.createCandidate(data));
      } catch (err) {
        errors++;
      }
    }

    // Batch write creates in a single transaction
    if (toCreate.length > 0) {
      try {
        await db.addCandidatesBatch(toCreate);
        created += toCreate.length;
      } catch (err) {
        errors += toCreate.length;
      }
    }

    // Batch write updates in a single transaction
    if (toUpdate.length > 0) {
      try {
        await db.addCandidatesBatch(toUpdate);
        updated += toUpdate.length;
      } catch (err) {
        errors += toUpdate.length;
      }
    }

    // Update progress
    const pct = Math.min(100, Math.round(((i + batch.length) / rows.length) * 100));
    bar.style.width = `${pct}%`;
    status.textContent = `${i + batch.length} of ${rows.length} processed...`;

    // Yield to main thread
    await new Promise(r => setTimeout(r, 0));
  }

  invalidateListCache();

  // Step 4: Verify
  renderVerifyStep(created, updated, skipped, errors);
}

// ── Step 4: Verify ──────────────────────────────────────────

function renderVerifyStep(created, updated, skipped, errors) {
  const workflow = document.getElementById('import-workflow');
  const total = created + updated + skipped + errors;

  workflow.innerHTML = `
    <div class="import-step">
      <h3>Step 4: Import Complete</h3>
      <div class="import-summary">
        <strong>${total}</strong> rows processed<br>
        <span style="color: var(--cert-active)">${created} created</span> &nbsp;|&nbsp;
        ${updated > 0 ? `<span style="color: var(--accent)">${updated} updated</span> &nbsp;|&nbsp;` : ''}
        ${skipped} skipped &nbsp;|&nbsp;
        ${errors > 0 ? `<span style="color: var(--cert-expired)">${errors} errors</span>` : '0 errors'}
      </div>
      <div style="margin-top: 16px;">
        <a href="#/candidates" class="btn btn-primary">View People</a>
        <button id="btn-import-another" class="btn btn-secondary" style="margin-left: 8px;">Import Another File</button>
      </div>
    </div>
  `;

  document.getElementById('btn-import-another').addEventListener('click', () => {
    importState = null;
    workflow.innerHTML = '';
  });

  toast(`Import complete: ${created} created, ${updated} updated`, { type: 'success' });
}

// ── JSON Backup / Restore ───────────────────────────────────

export async function handleBackup(silent = false) {
  try {
    const data = await db.exportAll();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compliancetrack-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    if (!silent) toast('Backup downloaded', { type: 'success' });
  } catch (err) {
    toast('Backup failed: ' + err.message, { type: 'error' });
  }
}

async function handleJsonRestore(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    // Shape validation
    if (!data.candidates || !Array.isArray(data.candidates)) {
      toast('Invalid backup file: missing candidates array', { type: 'error' });
      return;
    }

    // Version check
    if (data.version && data.version > DB_VERSION) {
      toast(`Backup is from a newer version (v${data.version}). Update ComplianceTrack before restoring.`, { type: 'error' });
      return;
    }

    // Validate each candidate has required shape
    for (let i = 0; i < data.candidates.length; i++) {
      const c = data.candidates[i];
      if (!c.id || !c.firstName || !c.lastName) {
        toast(`Invalid person at row ${i + 1}: missing id, firstName, or lastName`, { type: 'error' });
        return;
      }
    }

    const count = data.candidates.length;
    if (!window.confirm(`This will import ${count} people from backup. Existing data will NOT be overwritten (matched by ID). Continue?`)) return;

    // Auto-backup current data first
    await handleBackup(true);

    // Batch import — single getAllCandidates + Set lookup (avoids N+1)
    const existing = await db.getAllCandidates();
    const existingIds = new Set(existing.map(c => c.id));
    const toImport = [];
    let skipped = 0;
    for (const c of data.candidates) {
      if (existingIds.has(c.id)) {
        skipped++;
      } else {
        toImport.push(c);
      }
    }

    if (toImport.length > 0) {
      await db.addCandidatesBatch(toImport);
    }

    // Restore clients, jobs, pipeline (Phase 2 data, skip duplicates by ID)
    // Validate each entity and batch write in single transactions
    let clientsImported = 0, jobsImported = 0, pipelineImported = 0;

    if (data.clients && Array.isArray(data.clients)) {
      const existingClients = new Set((await db.getAllClients()).map(c => c.id));
      const toImportClients = [];
      for (const c of data.clients) {
        if (!c.id || existingClients.has(c.id)) continue;
        try { validateClient(c); toImportClients.push(c); } catch { /* skip invalid */ }
      }
      if (toImportClients.length > 0) {
        await db.batchPut('clients', toImportClients);
        clientsImported = toImportClients.length;
      }
    }

    if (data.jobs && Array.isArray(data.jobs)) {
      const existingJobs = new Set((await db.getAllJobs()).map(j => j.id));
      const toImportJobs = [];
      for (const j of data.jobs) {
        if (!j.id || existingJobs.has(j.id)) continue;
        try { validateJob(j); toImportJobs.push(j); } catch { /* skip invalid */ }
      }
      if (toImportJobs.length > 0) {
        await db.batchPut('jobs', toImportJobs);
        jobsImported = toImportJobs.length;
      }
    }

    if (data.pipeline && Array.isArray(data.pipeline)) {
      const existingPipeline = new Set((await db.getAll('pipeline')).map(p => p.id));
      const toImportPipeline = [];
      for (const p of data.pipeline) {
        if (!p.id || existingPipeline.has(p.id)) continue;
        try { validatePipelineEntry(p); toImportPipeline.push(p); } catch { /* skip invalid */ }
      }
      if (toImportPipeline.length > 0) {
        await db.batchPut('pipeline', toImportPipeline);
        pipelineImported = toImportPipeline.length;
      }
    }

    // Restore activities
    let activitiesImported = 0;
    if (data.activities && Array.isArray(data.activities)) {
      const existingActivities = new Set((await db.getAllActivities()).map(a => a.id));
      const toImportActivities = [];
      for (const a of data.activities) {
        if (!a.id || existingActivities.has(a.id)) continue;
        try { validateActivity(a); toImportActivities.push(a); } catch { /* skip invalid */ }
      }
      if (toImportActivities.length > 0) {
        await db.batchPut('activities', toImportActivities);
        activitiesImported = toImportActivities.length;
      }
    }

    // Restore settings (whitelist known keys only)
    const SETTINGS_WHITELIST = new Set(['certAlertDays', 'customCertTypes', 'emailTemplates']);
    if (data.settings && Array.isArray(data.settings)) {
      for (const s of data.settings) {
        if (s.key && SETTINGS_WHITELIST.has(s.key) && s.value !== undefined) {
          await db.put('settings', s);
        }
      }
    }

    invalidateListCache();
    invalidateClientListCache();
    invalidateJobListCache();

    const parts = [`${toImport.length} people`];
    if (clientsImported > 0) parts.push(`${clientsImported} clients`);
    if (jobsImported > 0) parts.push(`${jobsImported} jobs`);
    if (pipelineImported > 0) parts.push(`${pipelineImported} pipeline entries`);
    if (activitiesImported > 0) parts.push(`${activitiesImported} activities`);
    toast(`Restored ${parts.join(', ')}${skipped > 0 ? ` (${skipped} people already existed)` : ''}`, { type: 'success' });
    renderImportExport();
  } catch (err) {
    toast(`Failed to restore: ${err.message}`, { type: 'error' });
  }
}

// ── CSV Export ───────────────────────────────────────────────

async function handleCsvExport() {
  try {
    await loadPapaParse();

    const candidates = await db.getAllCandidates();
    if (candidates.length === 0) {
      toast('No people to export', { type: 'info' });
      return;
    }

    const rows = candidates.map(c => ({
      'First Name': c.firstName,
      'Last Name': c.lastName,
      'Email': c.email,
      'Phone': c.phone,
      'Title': c.currentTitle,
      'Employer': c.currentEmployer,
      'Location': c.location,
      'Skills': (c.skills || []).join(', '),
      'Salary Min': c.salaryMin || '',
      'Salary Max': c.salaryMax || '',
      'Certifications': (c.certifications || []).map(cert => cert.name).join(', '),
      'Notes': c.notes,
      'Source': c.source,
      'External ID': c.externalId || '',
      'Created': c.createdAt,
      'Updated': c.updatedAt,
    }));

    // Sanitize for formula injection
    const sanitized = rows.map(row => {
      const clean = {};
      for (const [key, val] of Object.entries(row)) {
        clean[key] = sanitizeCsvValue(String(val));
      }
      return clean;
    });

    const csv = Papa.unparse(sanitized);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compliancetrack-people-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV exported', { type: 'success' });
  } catch (err) {
    toast('CSV export failed: ' + err.message, { type: 'error' });
  }
}
