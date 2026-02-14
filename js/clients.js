/**
 * clients.js — Client CRUD, list view, detail view, form
 */

import db from './db.js';
import { openModal, closeModal, toast, escapeHtml, formatDate, setHeaderTitle, setHeaderActions, SearchController, markDirty, clearDirty, detailField, confirm } from './ui.js';
import { invalidateJobListCache } from './jobs.js';

// ── List View ──────────────────────────────────────────────

let _listCache = null;

export function invalidateClientListCache() { _listCache = null; }

export async function renderClientList() {
  setHeaderTitle('Clients');
  setHeaderActions('<a href="#/client/new" class="btn btn-primary btn-sm">+ New Client</a>');
  const content = document.getElementById('content');

  let clients;
  try {
    clients = _listCache || await db.getAllClients();
    _listCache = clients;
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><p>Failed to load clients.</p></div>`;
    toast('Database error: ' + err.message, { type: 'error' });
    return;
  }

  if (clients.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <h2>No clients yet</h2>
        <p>Add your first client company to start linking jobs.</p>
        <a href="#/client/new" class="btn btn-primary">Add Client</a>
      </div>`;
    return;
  }

  // Sort by company name
  const sorted = clients.slice().sort((a, b) => a.companyName.localeCompare(b.companyName));

  const searchBar = `
    <div class="search-bar">
      <input type="text" id="client-search" class="form-input" placeholder="Search clients…">
    </div>`;

  content.innerHTML = searchBar + `<div id="client-list-container" class="candidate-list"></div>`;

  const listContainer = document.getElementById('client-list-container');

  function renderRows(list) {
    if (list.length === 0) {
      listContainer.innerHTML = `<div class="empty-state"><p>No clients match your search.</p></div>`;
      return;
    }
    listContainer.innerHTML = list.map(c => {
      const primaryContact = (c.contacts || []).find(ct => ct.isPrimary) || (c.contacts || [])[0];
      const contactInfo = primaryContact ? escapeHtml(primaryContact.name) : '';
      return `
        <a href="#/client/${c.id}" class="candidate-row">
          <div class="candidate-name">${escapeHtml(c.companyName)}</div>
          <div class="candidate-meta">${escapeHtml(c.industrySector || '')}${contactInfo ? ` — ${contactInfo}` : ''}</div>
        </a>`;
    }).join('');
  }

  renderRows(sorted);

  // Search
  const sc = new SearchController((results, query) => {
    if (!results) { renderRows(sorted); return; }
    renderRows(results);
  });

  document.getElementById('client-search').addEventListener('input', (e) => {
    sc.search(e.target.value, (q) => {
      const lower = q.toLowerCase();
      return sorted.filter(c =>
        c.companyName.toLowerCase().includes(lower) ||
        c.industrySector.toLowerCase().includes(lower) ||
        (c.contacts || []).some(ct => ct.name.toLowerCase().includes(lower))
      );
    });
  });
}

// ── Detail View ────────────────────────────────────────────

export async function renderClientDetail(id) {
  setHeaderTitle('Client');
  const content = document.getElementById('content');

  let client, jobs;
  try {
    client = await db.getClient(id);
    if (!client) {
      content.innerHTML = `<div class="empty-state"><p>Client not found.</p></div>`;
      return;
    }
    jobs = await db.getJobsByClient(id);
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><p>Failed to load client.</p></div>`;
    toast('Error: ' + err.message, { type: 'error' });
    return;
  }

  setHeaderTitle(client.companyName);
  setHeaderActions(`
    <a href="#/client/${id}/edit" class="btn btn-secondary btn-sm">Edit</a>
    <button id="btn-delete-client" class="btn btn-danger btn-sm">Delete</button>
  `);

  const contactsHtml = (client.contacts || []).map(ct => `
    <div class="contact-card">
      <div class="contact-name">${escapeHtml(ct.name)}${ct.isPrimary ? ' <span class="cert-badge cert-badge--sm">Primary</span>' : ''}</div>
      <div class="contact-meta">${escapeHtml(ct.title || '')}</div>
      ${ct.email ? `<div class="contact-meta"><a href="mailto:${escapeHtml(ct.email)}" class="link">${escapeHtml(ct.email)}</a></div>` : ''}
      ${ct.phone ? `<div class="contact-meta">${escapeHtml(ct.phone)}</div>` : ''}
    </div>
  `).join('') || '<p class="text-secondary">No contacts added.</p>';

  const jobsHtml = jobs.length > 0 ? jobs.map(j => `
    <a href="#/job/${j.id}" class="candidate-row">
      <div class="candidate-name">${escapeHtml(j.title)}</div>
      <div class="candidate-meta">
        <span class="cert-badge cert-badge--sm cert-badge--${j.status === 'open' ? 'active' : j.status === 'filled' ? 'active' : 'expired'}">${escapeHtml(j.status)}</span>
        ${j.location ? ` — ${escapeHtml(j.location)}` : ''}
      </div>
    </a>
  `).join('') : '<p class="text-secondary">No jobs linked to this client.</p>';

  content.innerHTML = `
    <div class="detail-page">
      <div class="detail-section">
        <h2 class="section-title">Company Info</h2>
        <div class="detail-grid">
          ${detailField('Company', client.companyName)}
          ${detailField('Industry / Sector', client.industrySector)}
          ${detailField('Added', formatDate(client.createdAt))}
          ${detailField('Updated', formatDate(client.updatedAt))}
        </div>
      </div>

      <div class="detail-section">
        <h2 class="section-title">Contacts</h2>
        <div class="contacts-grid">${contactsHtml}</div>
      </div>

      ${client.notes ? `
      <div class="detail-section">
        <h2 class="section-title">Notes</h2>
        <div class="notes-block">${escapeHtml(client.notes)}</div>
      </div>` : ''}

      <div class="detail-section">
        <h2 class="section-title">Jobs (${jobs.length})</h2>
        <div class="candidate-list compact">${jobsHtml}</div>
        <a href="#/job/new?clientId=${id}" class="btn btn-secondary btn-sm" style="margin-top: 8px;">+ Add Job</a>
      </div>
    </div>
  `;

  // Delete handler
  document.getElementById('btn-delete-client').addEventListener('click', async () => {
    if (!await confirm(`Delete "${client.companyName}" and unlink all associated jobs?`)) return;
    try {
      // Unlink jobs (set clientId to empty)
      for (const j of jobs) {
        j.clientId = '';
        await db.updateJob(j);
      }
      await db.deleteClient(id);
      _listCache = null;
      invalidateJobListCache();
      toast('Client deleted', { type: 'info' });
      location.hash = '#/clients';
    } catch (err) {
      toast('Failed to delete: ' + err.message, { type: 'error' });
    }
  });
}

// ── Form View ──────────────────────────────────────────────

export async function renderClientForm(id) {
  const content = document.getElementById('content');
  const isEdit = !!id;
  let client = null;

  if (isEdit) {
    try {
      client = await db.getClient(id);
      if (!client) {
        content.innerHTML = `<div class="empty-state"><p>Client not found.</p></div>`;
        return;
      }
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><p>Failed to load client.</p></div>`;
      return;
    }
  }

  setHeaderTitle(isEdit ? `Edit ${client.companyName}` : 'New Client');
  setHeaderActions('');

  const contacts = client ? (client.contacts || []) : [];

  content.innerHTML = `
    <form id="client-form" class="form detail-page">
      <div class="detail-section">
        <h2 class="section-title">Company Info</h2>
        <div class="form-grid">
          <div class="form-group">
            <label for="companyName">Company Name *</label>
            <input type="text" id="companyName" name="companyName" class="form-input" required value="${isEdit ? escapeHtml(client.companyName) : ''}">
          </div>
          <div class="form-group">
            <label for="industrySector">Industry / Sector</label>
            <input type="text" id="industrySector" name="industrySector" class="form-input" value="${isEdit ? escapeHtml(client.industrySector) : ''}" placeholder="e.g. Banking, Insurance, Fintech">
          </div>
        </div>
      </div>

      <div class="detail-section">
        <h2 class="section-title">Contacts</h2>
        <div id="contacts-container"></div>
        <button type="button" id="btn-add-contact" class="btn btn-secondary btn-sm">+ Add Contact</button>
      </div>

      <div class="detail-section">
        <h2 class="section-title">Notes</h2>
        <div class="form-group">
          <textarea id="notes" name="notes" class="form-input" rows="4" placeholder="Fee agreements, relationship details…">${isEdit ? escapeHtml(client.notes) : ''}</textarea>
        </div>
      </div>

      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Save Changes' : 'Create Client'}</button>
        <a href="${isEdit ? `#/client/${id}` : '#/clients'}" class="btn btn-secondary">Cancel</a>
      </div>
    </form>
  `;

  // Contacts dynamic rows
  const container = document.getElementById('contacts-container');
  let contactData = contacts.length > 0 ? contacts.map(c => ({ ...c })) : [];

  function renderContactRows() {
    container.innerHTML = contactData.map((ct, i) => `
      <div class="contact-form-row" data-index="${i}">
        <div class="form-grid form-grid--tight">
          <div class="form-group">
            <input type="text" name="contact-name-${i}" class="form-input" placeholder="Name" value="${escapeHtml(ct.name || '')}">
          </div>
          <div class="form-group">
            <input type="text" name="contact-title-${i}" class="form-input" placeholder="Title" value="${escapeHtml(ct.title || '')}">
          </div>
          <div class="form-group">
            <input type="email" name="contact-email-${i}" class="form-input" placeholder="Email" value="${escapeHtml(ct.email || '')}">
          </div>
          <div class="form-group">
            <input type="tel" name="contact-phone-${i}" class="form-input" placeholder="Phone" value="${escapeHtml(ct.phone || '')}">
          </div>
          <div class="form-group form-group--actions">
            <label class="checkbox-label">
              <input type="radio" name="primary-contact" value="${i}" ${ct.isPrimary ? 'checked' : ''}> Primary
            </label>
            <button type="button" class="btn btn-sm btn-danger remove-contact" data-index="${i}">Remove</button>
          </div>
        </div>
      </div>
    `).join('');
  }

  renderContactRows();

  document.getElementById('btn-add-contact').addEventListener('click', () => {
    contactData.push({ name: '', title: '', email: '', phone: '', isPrimary: false });
    renderContactRows();
    markDirty();
  });

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-contact');
    if (!btn) return;
    const idx = parseInt(btn.dataset.index, 10);
    collectContactData();
    contactData.splice(idx, 1);
    renderContactRows();
    markDirty();
  });

  function collectContactData() {
    const form = document.getElementById('client-form');
    const primaryIdx = form.querySelector('input[name="primary-contact"]:checked')?.value;
    contactData = contactData.map((ct, i) => ({
      name: form.querySelector(`[name="contact-name-${i}"]`)?.value.trim() || ct.name || '',
      title: form.querySelector(`[name="contact-title-${i}"]`)?.value.trim() || ct.title || '',
      email: form.querySelector(`[name="contact-email-${i}"]`)?.value.trim() || ct.email || '',
      phone: form.querySelector(`[name="contact-phone-${i}"]`)?.value.trim() || ct.phone || '',
      isPrimary: String(i) === String(primaryIdx),
    }));
    return contactData.filter(ct => ct.name);
  }

  // Form change tracking
  content.addEventListener('input', () => markDirty());

  // Submit
  document.getElementById('client-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;

    const data = {
      companyName: form.companyName.value.trim(),
      industrySector: form.industrySector.value.trim(),
      contacts: collectContactData(),
      notes: form.notes.value.trim(),
    };

    try {
      if (isEdit) {
        Object.assign(client, data);
        await db.updateClient(client);
        toast('Client updated', { type: 'success' });
      } else {
        const newClient = await db.addClient(data);
        id = newClient.id;
        toast('Client created', { type: 'success' });
      }
      _listCache = null;
      clearDirty();
      location.hash = `#/client/${id}`;
    } catch (err) {
      toast('Error: ' + err.message, { type: 'error' });
    }
  });
}
