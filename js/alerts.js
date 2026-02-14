/**
 * alerts.js — Follow-up reminder system
 * Checked on app load, rendered on dashboard
 */

import db from './db.js';
import { escapeHtml, formatDate } from './ui.js';

/**
 * Get all overdue and upcoming follow-ups.
 * Returns { overdue: [...], upcoming: [...] } sorted by date.
 */
export async function getFollowUpAlerts(daysAhead = 7) {
  const activities = await db.getActivitiesWithFollowUp();
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const futureDate = new Date(now);
  futureDate.setDate(futureDate.getDate() + daysAhead);
  const futureStr = futureDate.toISOString().slice(0, 10);

  const candidates = await db.getAllCandidates();
  const candidateMap = new Map(candidates.map(c => [c.id, c]));

  const overdue = [];
  const upcoming = [];

  for (const a of activities) {
    if (!a.followUpDate) continue;
    const cand = candidateMap.get(a.candidateId);
    const enriched = {
      ...a,
      candidateName: cand ? `${cand.firstName} ${cand.lastName}` : 'Unknown',
    };

    if (a.followUpDate <= todayStr) {
      overdue.push(enriched);
    } else if (a.followUpDate <= futureStr) {
      upcoming.push(enriched);
    }
  }

  overdue.sort((a, b) => a.followUpDate.localeCompare(b.followUpDate));
  upcoming.sort((a, b) => a.followUpDate.localeCompare(b.followUpDate));

  return { overdue, upcoming };
}

/**
 * Render follow-up alerts into a container element.
 * Used by the dashboard.
 */
export function renderFollowUpAlerts({ overdue, upcoming }) {
  if (overdue.length === 0 && upcoming.length === 0) {
    return '';
  }

  let html = '<div class="followup-alerts">';

  if (overdue.length > 0) {
    html += `
      <div class="followup-group followup-group--overdue">
        <h4 class="followup-group-title">Overdue Follow-ups (${overdue.length})</h4>
        ${overdue.map(a => `
          <div class="followup-item followup-item--overdue">
            <div class="followup-item-info">
              <a href="#/candidate/${a.candidateId}" class="link">${escapeHtml(a.candidateName)}</a>
              <span class="followup-subject">${escapeHtml(a.subject || a.type)}</span>
            </div>
            <span class="followup-date">${formatDate(a.followUpDate)}</span>
          </div>
        `).join('')}
      </div>`;
  }

  if (upcoming.length > 0) {
    html += `
      <div class="followup-group followup-group--upcoming">
        <h4 class="followup-group-title">Upcoming Follow-ups (${upcoming.length})</h4>
        ${upcoming.map(a => `
          <div class="followup-item">
            <div class="followup-item-info">
              <a href="#/candidate/${a.candidateId}" class="link">${escapeHtml(a.candidateName)}</a>
              <span class="followup-subject">${escapeHtml(a.subject || a.type)}</span>
            </div>
            <span class="followup-date">${formatDate(a.followUpDate)}</span>
          </div>
        `).join('')}
      </div>`;
  }

  html += '</div>';
  return html;
}
