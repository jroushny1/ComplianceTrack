/**
 * ui.js — Modal system, toasts, search controller, form helpers
 */

// ── Modal System ────────────────────────────────────────────

const modalOverlay = () => document.getElementById('modal-overlay');
const modalTitle = () => document.getElementById('modal-title');
const modalBody = () => document.getElementById('modal-body');
const modalFooter = () => document.getElementById('modal-footer');

export function openModal({ title, body, footer, onClose }) {
  const overlay = modalOverlay();
  modalTitle().textContent = title || '';
  if (typeof body === 'string') {
    modalBody().innerHTML = '';
    modalBody().insertAdjacentHTML('beforeend', body);
  } else if (body instanceof Node) {
    modalBody().innerHTML = '';
    modalBody().appendChild(body);
  }
  if (footer) {
    modalFooter().innerHTML = '';
    if (typeof footer === 'string') {
      modalFooter().insertAdjacentHTML('beforeend', footer);
    } else if (footer instanceof Node) {
      modalFooter().appendChild(footer);
    }
    modalFooter().hidden = false;
  } else {
    modalFooter().hidden = true;
  }
  overlay._onClose = onClose || null;
  overlay.hidden = false;
  // Focus the modal for accessibility
  document.getElementById('modal').focus();
}

export function closeModal() {
  const overlay = modalOverlay();
  if (overlay._onClose) overlay._onClose();
  overlay.hidden = true;
  modalBody().innerHTML = '';
  modalFooter().innerHTML = '';
}

export function initModalListeners() {
  const overlay = modalOverlay();
  // Close on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  // Close button
  overlay.querySelector('.modal-close').addEventListener('click', closeModal);
  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) closeModal();
  });
}

// ── Confirm Dialog ──────────────────────────────────────────

export function confirm(message) {
  return new Promise((resolve) => {
    const body = document.createElement('p');
    body.textContent = message;

    const footer = document.createElement('div');
    footer.className = 'modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => { closeModal(); resolve(false); };

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn btn-danger';
    confirmBtn.textContent = 'Delete';
    confirmBtn.onclick = () => { closeModal(); resolve(true); };

    footer.append(cancelBtn, confirmBtn);

    openModal({ title: 'Confirm', body, footer });
  });
}

// ── Toast Notifications ─────────────────────────────────────

let toastCounter = 0;

export function toast(message, { type = 'info', duration = 4000, action, actionLabel } = {}) {
  const container = document.getElementById('toast-container');
  const id = ++toastCounter;

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', 'alert');

  const textSpan = document.createElement('span');
  textSpan.textContent = message;
  el.appendChild(textSpan);

  let actionResult = null;

  if (action && actionLabel) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = actionLabel;
    btn.onclick = () => {
      actionResult = 'clicked';
      action();
      removeToast();
    };
    el.appendChild(btn);
  }

  container.appendChild(el);
  // Trigger reflow for animation
  el.offsetHeight;
  el.classList.add('toast-visible');

  const removeToast = () => {
    el.classList.remove('toast-visible');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
    // Fallback removal
    setTimeout(() => { if (el.parentNode) el.remove(); }, 500);
  };

  if (duration > 0) {
    setTimeout(() => {
      if (actionResult !== 'clicked') removeToast();
    }, duration);
  }

  return { id, dismiss: removeToast };
}

// ── Search Controller ───────────────────────────────────────

export class SearchController {
  constructor(onResults) {
    this._generation = 0;
    this._timeout = null;
    this._onResults = onResults;
  }

  search(query, searchFn, delay = 150) {
    clearTimeout(this._timeout);
    const gen = ++this._generation;

    if (!query.trim()) {
      this._onResults(null, '');
      return;
    }

    this._timeout = setTimeout(async () => {
      const results = await searchFn(query);
      // Discard stale results
      if (gen === this._generation) {
        this._onResults(results, query);
      }
    }, delay);
  }

  cancel() {
    clearTimeout(this._timeout);
    this._generation++;
  }
}

// ── Dirty-Form Guard ────────────────────────────────────────

let _dirty = false;

export function markDirty() { _dirty = true; }
export function clearDirty() { _dirty = false; }
export function isDirty() { return _dirty; }

// ── Formatting Helpers ──────────────────────────────────────

export function formatDate(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Header Helpers ──────────────────────────────────────────

export function setHeaderTitle(title) {
  document.getElementById('header-title').textContent = title;
  document.title = `${title} — ComplianceTrack`;
}

export function setHeaderActions(html) {
  document.getElementById('header-actions').innerHTML = html;
}

export function clearHeaderActions() {
  document.getElementById('header-actions').innerHTML = '';
}
