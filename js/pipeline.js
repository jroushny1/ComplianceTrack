/**
 * pipeline.js — Kanban board per job using SortableJS
 * Cert-match badges, stage history, drag-and-drop with IndexedDB persistence
 */

import db from './db.js';
import { toast, escapeHtml, setHeaderTitle, setHeaderActions } from './ui.js';

const CARDS_PER_COLUMN = 30;

// Track Sortable instances for cleanup on navigation
let _sortableInstances = [];

// ── Cert Match Logic ───────────────────────────────────────

function getCertMatch(candidate, job) {
  const required = job.requiredCerts || [];
  if (required.length === 0) return 'none';

  const candidateCertNames = new Set(
    (candidate.certifications || [])
      .filter(c => {
        if (!c.expirationDate) return true; // lifetime cert
        return new Date(c.expirationDate) >= new Date();
      })
      .map(c => c.name)
  );

  let matched = 0;
  for (const req of required) {
    if (candidateCertNames.has(req)) matched++;
  }

  if (matched === required.length) return 'full';
  if (matched > 0) return 'partial';
  return 'missing';
}

function certMatchBadge(match) {
  if (match === 'full') return '<span class="cert-match cert-match--full" title="All required certs active">&#10003;</span>';
  if (match === 'partial') return '<span class="cert-match cert-match--partial" title="Some required certs">&#9679;</span>';
  if (match === 'missing') return '<span class="cert-match cert-match--missing" title="Missing required certs">&#10007;</span>';
  return '';
}

// ── Kanban Board ───────────────────────────────────────────

export async function renderPipeline(jobId) {
  const content = document.getElementById('content');

  let job, entries, candidates;
  try {
    job = await db.getJob(jobId);
    if (!job) {
      content.innerHTML = `<div class="empty-state"><p>Job not found.</p></div>`;
      return;
    }
    entries = await db.getPipelineByJob(jobId);
    candidates = await db.getAllCandidates();
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><p>Failed to load pipeline.</p></div>`;
    toast('Error: ' + err.message, { type: 'error' });
    return;
  }

  // Destroy previous Sortable instances
  for (const s of _sortableInstances) s.destroy();
  _sortableInstances = [];

  setHeaderTitle(`Pipeline: ${job.title}`);
  setHeaderActions(`<a href="#/job/${jobId}" class="btn btn-secondary btn-sm">Back to Job</a>`);

  const candidateMap = new Map(candidates.map(c => [c.id, c]));
  const stages = job.stages || ['Sourced'];

  // Group entries by stage
  const columns = new Map();
  for (const stage of stages) columns.set(stage, []);
  for (const entry of entries) {
    const col = columns.get(entry.stage);
    if (col) {
      col.push(entry);
    } else {
      // Entry in a stage that no longer exists — put in first stage
      columns.get(stages[0])?.push(entry);
    }
  }
  // Sort each column by position
  for (const col of columns.values()) {
    col.sort((a, b) => a.position - b.position);
  }

  content.innerHTML = `
    <div class="kanban-board" id="kanban-board">
      ${stages.map(stage => {
        const stageEntries = columns.get(stage) || [];
        const showMore = stageEntries.length > CARDS_PER_COLUMN;
        const visible = stageEntries.slice(0, CARDS_PER_COLUMN);
        return `
          <div class="kanban-column" data-stage="${escapeHtml(stage)}">
            <div class="kanban-column-header">
              <span class="kanban-column-title">${escapeHtml(stage)}</span>
              <span class="kanban-column-count">${stageEntries.length}</span>
            </div>
            <div class="kanban-cards" data-stage="${escapeHtml(stage)}">
              ${visible.map(entry => renderCard(entry, candidateMap, job)).join('')}
            </div>
            ${showMore ? `<button class="btn btn-sm btn-secondary kanban-show-more" data-stage="${escapeHtml(stage)}">Show ${stageEntries.length - CARDS_PER_COLUMN} more</button>` : ''}
          </div>`;
      }).join('')}
    </div>
  `;

  // Initialize SortableJS on each column
  const columnEls = content.querySelectorAll('.kanban-cards');
  for (const el of columnEls) {
    _sortableInstances.push(new Sortable(el, {
      group: 'pipeline',
      animation: 150,
      ghostClass: 'kanban-card--ghost',
      dragClass: 'kanban-card--drag',
      onEnd: (evt) => handleDragEnd(evt, job, candidateMap),
    }));
  }

  // Event delegation for card clicks and show-more
  content.addEventListener('click', (e) => {
    // Show more
    const showMoreBtn = e.target.closest('.kanban-show-more');
    if (showMoreBtn) {
      const stage = showMoreBtn.dataset.stage;
      const stageEntries = columns.get(stage) || [];
      const cardsContainer = content.querySelector(`.kanban-cards[data-stage="${CSS.escape(stage)}"]`);
      cardsContainer.innerHTML = stageEntries.map(entry => renderCard(entry, candidateMap, job)).join('');
      showMoreBtn.remove();
      // Re-init sortable for this column
      _sortableInstances.push(new Sortable(cardsContainer, {
        group: 'pipeline',
        animation: 150,
        ghostClass: 'kanban-card--ghost',
        dragClass: 'kanban-card--drag',
        onEnd: (evt) => handleDragEnd(evt, job, candidateMap),
      }));
      return;
    }

    // Card click → navigate to candidate
    const card = e.target.closest('.kanban-card');
    if (card && !e.target.closest('.kanban-card-remove')) {
      location.hash = `#/candidate/${card.dataset.candidateId}`;
      return;
    }

    // Remove from pipeline
    const removeBtn = e.target.closest('.kanban-card-remove');
    if (removeBtn) {
      const entryId = removeBtn.closest('.kanban-card').dataset.entryId;
      removePipelineEntry(entryId, jobId);
    }
  });
}

function renderCard(entry, candidateMap, job) {
  const cand = candidateMap.get(entry.candidateId);
  if (!cand) return '';
  const match = getCertMatch(cand, job);
  return `
    <div class="kanban-card" data-entry-id="${entry.id}" data-candidate-id="${cand.id}">
      <div class="kanban-card-header">
        <span class="kanban-card-name">${escapeHtml(cand.firstName)} ${escapeHtml(cand.lastName)}</span>
        ${certMatchBadge(match)}
      </div>
      <div class="kanban-card-meta">${escapeHtml(cand.currentTitle || '')}${cand.currentEmployer ? ` at ${escapeHtml(cand.currentEmployer)}` : ''}</div>
      <button class="kanban-card-remove" title="Remove from pipeline">&times;</button>
    </div>
  `;
}

// ── Drag Handler ───────────────────────────────────────────

async function handleDragEnd(evt, job, candidateMap) {
  const entryId = evt.item.dataset.entryId;
  const newStage = evt.to.dataset.stage;

  // Collect new order for the target column
  const cards = evt.to.querySelectorAll('.kanban-card');
  const updates = [];

  for (let i = 0; i < cards.length; i++) {
    const id = cards[i].dataset.entryId;
    updates.push({ id, position: i });
  }

  // Also renumber the source column if different
  if (evt.from !== evt.to) {
    const fromCards = evt.from.querySelectorAll('.kanban-card');
    for (let i = 0; i < fromCards.length; i++) {
      updates.push({ id: fromCards[i].dataset.entryId, position: i });
    }
  }

  try {
    // Build batch update descriptors
    const batchUpdates = updates.map(u => {
      const desc = { id: u.id, position: u.position };
      if (u.id === entryId) {
        desc.stage = newStage;
        desc.historyEntry = {
          stage: newStage,
          date: new Date().toISOString(),
          notes: `Moved from previous stage`,
        };
      }
      return desc;
    });
    await db.batchUpdatePipelinePositions(batchUpdates);

    // Update column counts
    const board = document.getElementById('kanban-board');
    if (board) {
      board.querySelectorAll('.kanban-column').forEach(col => {
        const stage = col.dataset.stage;
        const count = col.querySelectorAll('.kanban-card').length;
        col.querySelector('.kanban-column-count').textContent = count;
      });
    }
  } catch (err) {
    toast('Failed to save position: ' + err.message, { type: 'error' });
  }
}

// ── Remove Entry ───────────────────────────────────────────

async function removePipelineEntry(entryId, jobId) {
  try {
    await db.deletePipelineEntry(entryId);
    toast('Removed from pipeline', { type: 'info' });
    renderPipeline(jobId);
  } catch (err) {
    toast('Error: ' + err.message, { type: 'error' });
  }
}
