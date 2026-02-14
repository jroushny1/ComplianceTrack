# ComplianceTrack

Applicant tracking system for solo compliance recruiting in financial services. Zero-cost PWA deployed to GitHub Pages.

## Architecture

- **Stack:** Vanilla HTML/CSS/JS with ES modules — no framework, no build tools
- **Storage:** IndexedDB (browser-local, via `js/db.js`)
- **Offline:** Service worker (`sw.js`) with versioned cache
- **Deployment:** Push to `main` → GitHub Pages auto-deploys to `jroushny1.github.io/ComplianceTrack/`
- **CSP:** `script-src 'self'` — no inline event handlers (`onclick`, etc.) allowed

## File Structure

```
index.html          Single-page app shell
manifest.json       PWA manifest
sw.js               Service worker (bump CACHE_NAME version after changes)
css/styles.css      All styles (CSS custom properties at top)
js/
  app.js            Router, dashboard, keyboard shortcuts
  db.js             IndexedDB wrapper (all data access)
  ui.js             Shared UI helpers (modal, toast, escapeHtml, formatDate)
  candidates.js     People list + detail views
  jobs.js           Jobs CRUD
  clients.js        Clients CRUD
  pipeline.js       Kanban board (drag-and-drop via Sortable.js)
  outreach.js       Activity logging, email templates, timeline
  alerts.js         Follow-up reminder system
  import-export.js  JSON backup/restore, CSV import/export
  sw-register.js    Service worker registration
icons/              PWA icons (192px, 512px)
lib/                Third-party: PapaParse (CSV), Sortable (drag-drop)
guide.html          User-facing getting started guide
```

## Key Conventions

1. **No inline handlers.** Use event delegation or `addEventListener`. CSP blocks inline `onclick`.
2. **Escape all user content.** Use `escapeHtml()` from `ui.js` before inserting into innerHTML.
3. **Atomic transactions.** Multi-store IndexedDB operations use single transactions (see `deleteCandidateCascade`).
4. **Bump SW cache.** After changing any JS/CSS file, increment the version in `sw.js` (`CACHE_NAME`). Current: `v5`.
5. **CSS class names must match JS.** No build-time checks — manually verify class names in templates match CSS selectors.
6. **No external API calls.** Everything runs client-side. No servers, no cloud services.

## Making Changes

- Edit files directly — no build step needed
- Test locally by opening `index.html` in a browser (or use VS Code Live Server)
- After changes: `git add <files> && git commit -m "description" && git push`
- Site updates within ~1 minute of push

## Data Model (IndexedDB stores)

- **candidates** — firstName, lastName, email, phone, currentTitle, currentEmployer, location, certifications, licenses, status, notes
- **jobs** — title, clientId, status (open/closed/on-hold), requiredCerts, salaryRange, location
- **clients** — name, industry, contacts, billingInfo
- **pipeline** — candidateId, jobId, stage (sourced/contacted/screening/interview/offer/placed)
- **activities** — candidateId, jobId, type (email/call/interview/note/submission), subject, body, status, followUpDate
- **templates** — name, subject, body (with {{placeholder}} support)
