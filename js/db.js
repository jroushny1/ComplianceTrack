/**
 * db.js — IndexedDB setup, stores, CRUD helpers
 * ComplianceTrack v3 (Phase 1: candidates + settings, Phase 2: jobs/clients/pipeline, Phase 3: activities)
 */

const DB_NAME = 'ComplianceTrackDB';
export const DB_VERSION = 3;

class ComplianceDB {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const oldVersion = event.oldVersion;

        if (oldVersion < 1) {
          // Phase 1 stores
          const candidates = db.createObjectStore('candidates', { keyPath: 'id' });
          candidates.createIndex('email', 'email', { unique: false });
          candidates.createIndex('lastName', 'lastName');
          candidates.createIndex('location', 'location');
          candidates.createIndex('externalId', 'externalId');

          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (oldVersion < 2) {
          // Phase 2 stores
          const clients = db.createObjectStore('clients', { keyPath: 'id' });
          clients.createIndex('companyName', 'companyName');
          clients.createIndex('externalId', 'externalId');

          const jobs = db.createObjectStore('jobs', { keyPath: 'id' });
          jobs.createIndex('clientId', 'clientId');
          jobs.createIndex('status', 'status');
          jobs.createIndex('externalId', 'externalId');

          const pipeline = db.createObjectStore('pipeline', { keyPath: 'id' });
          pipeline.createIndex('jobId', 'jobId');
          pipeline.createIndex('candidateId', 'candidateId');
          pipeline.createIndex('candidateJob', ['candidateId', 'jobId'], { unique: true });
        }
        if (oldVersion < 3) {
          // Phase 3 store
          const activities = db.createObjectStore('activities', { keyPath: 'id' });
          activities.createIndex('candidateId', 'candidateId');
          activities.createIndex('type', 'type');
          activities.createIndex('followUpDate', 'followUpDate');
          activities.createIndex('candidateType', ['candidateId', 'type']);
        }
      };
    });
  }

  // ── Generic CRUD ──────────────────────────────────────────

  async add(storeName, data) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.add(data);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async put(storeName, data) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.put(data);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async get(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAll(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async delete(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clear(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // ── Candidate Helpers ─────────────────────────────────────

  createCandidate(data = {}) {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      firstName: data.firstName || '',
      lastName: data.lastName || '',
      email: data.email || '',
      phone: data.phone || '',
      currentEmployer: data.currentEmployer || '',
      currentTitle: data.currentTitle || '',
      location: data.location || '',
      certifications: data.certifications || [],
      skills: data.skills || [],
      salaryMin: data.salaryMin ?? null,
      salaryMax: data.salaryMax ?? null,
      notes: data.notes || '',
      source: data.source || '',
      externalId: data.externalId ?? null,
      createdAt: data.createdAt || now,
      updatedAt: now,
    };
  }

  async addCandidate(data) {
    const candidate = this.createCandidate(data);
    validateCandidate(candidate);
    await this.add('candidates', candidate);
    return candidate;
  }

  async updateCandidate(candidate) {
    validateCandidate(candidate);
    candidate.updatedAt = new Date().toISOString();
    await this.put('candidates', candidate);
    return candidate;
  }

  async addCandidatesBatch(candidates) {
    for (const c of candidates) {
      validateCandidate(c);
    }
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('candidates', 'readwrite');
      const store = tx.objectStore('candidates');
      for (const c of candidates) {
        store.put(c);
      }
      tx.oncomplete = () => resolve(candidates.length);
      tx.onerror = () => reject(tx.error);
    });
  }

  async deleteCandidate(id) {
    await this.delete('candidates', id);
  }

  async getCandidate(id) {
    return this.get('candidates', id);
  }

  async getAllCandidates() {
    return this.getAll('candidates');
  }

  // ── Client Helpers ──────────────────────────────────────

  createClient(data = {}) {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      companyName: data.companyName || '',
      industrySector: data.industrySector || '',
      contacts: data.contacts || [],
      notes: data.notes || '',
      externalId: data.externalId ?? null,
      createdAt: data.createdAt || now,
      updatedAt: now,
    };
  }

  async addClient(data) {
    const client = this.createClient(data);
    validateClient(client);
    await this.add('clients', client);
    return client;
  }

  async updateClient(client) {
    validateClient(client);
    client.updatedAt = new Date().toISOString();
    await this.put('clients', client);
    return client;
  }

  async deleteClient(id) { await this.delete('clients', id); }
  async getClient(id) { return this.get('clients', id); }
  async getAllClients() { return this.getAll('clients'); }

  // ── Job Helpers ────────────────────────────────────────

  static DEFAULT_STAGES = ['Sourced', 'Screen', 'Submitted', 'Interview', 'Offer', 'Placed'];

  createJob(data = {}) {
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      title: data.title || '',
      clientId: data.clientId || '',
      description: data.description || '',
      requirements: data.requirements || '',
      requiredCerts: data.requiredCerts || [],
      preferredCerts: data.preferredCerts || [],
      compensationMin: data.compensationMin ?? null,
      compensationMax: data.compensationMax ?? null,
      compensationType: data.compensationType || 'salary',
      location: data.location || '',
      remote: data.remote ?? false,
      status: data.status || 'open',
      statusDate: data.statusDate || now,
      stages: data.stages || [...ComplianceDB.DEFAULT_STAGES],
      externalId: data.externalId ?? null,
      createdAt: data.createdAt || now,
      updatedAt: now,
    };
  }

  async addJob(data) {
    const job = this.createJob(data);
    validateJob(job);
    await this.add('jobs', job);
    return job;
  }

  async updateJob(job) {
    validateJob(job);
    job.updatedAt = new Date().toISOString();
    await this.put('jobs', job);
    return job;
  }

  async deleteJob(id) { await this.delete('jobs', id); }
  async getJob(id) { return this.get('jobs', id); }
  async getAllJobs() { return this.getAll('jobs'); }

  async getJobsByClient(clientId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('jobs', 'readonly');
      const index = tx.objectStore('jobs').index('clientId');
      const request = index.getAll(clientId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ── Pipeline Helpers ───────────────────────────────────

  createPipelineEntry(data = {}) {
    const now = new Date().toISOString();
    const stage = data.stage || 'Sourced';
    return {
      id: crypto.randomUUID(),
      candidateId: data.candidateId || '',
      jobId: data.jobId || '',
      stage,
      position: data.position ?? 0,
      history: data.history || [{ stage, date: now, notes: 'Added to pipeline' }],
      createdAt: data.createdAt || now,
      updatedAt: now,
    };
  }

  async addToPipeline(data) {
    const entry = this.createPipelineEntry(data);
    validatePipelineEntry(entry);
    await this.add('pipeline', entry);
    return entry;
  }

  async updatePipelineEntry(entry) {
    validatePipelineEntry(entry);
    entry.updatedAt = new Date().toISOString();
    await this.put('pipeline', entry);
    return entry;
  }

  async batchPut(storeName, items) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      for (const item of items) store.put(item);
      tx.oncomplete = () => resolve(items.length);
      tx.onerror = () => reject(tx.error);
    });
  }

  async batchUpdatePipelinePositions(updates) {
    // Read all entries in one transaction
    const entries = new Map();
    await new Promise((resolve, reject) => {
      const tx = this.db.transaction('pipeline', 'readonly');
      const store = tx.objectStore('pipeline');
      for (const u of updates) {
        const req = store.get(u.id);
        req.onsuccess = () => { if (req.result) entries.set(u.id, req.result); };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // Apply updates in memory
    const now = new Date().toISOString();
    for (const u of updates) {
      const entry = entries.get(u.id);
      if (!entry) continue;
      entry.position = u.position;
      if (u.stage !== undefined) entry.stage = u.stage;
      if (u.historyEntry) entry.history.push(u.historyEntry);
      entry.updatedAt = now;
    }

    // Write all in one transaction
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('pipeline', 'readwrite');
      const store = tx.objectStore('pipeline');
      for (const entry of entries.values()) store.put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async deletePipelineEntry(id) { await this.delete('pipeline', id); }
  async getPipelineEntry(id) { return this.get('pipeline', id); }

  async getPipelineByJob(jobId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('pipeline', 'readonly');
      const index = tx.objectStore('pipeline').index('jobId');
      const request = index.getAll(jobId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getPipelineByCandidate(candidateId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('pipeline', 'readonly');
      const index = tx.objectStore('pipeline').index('candidateId');
      const request = index.getAll(candidateId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deletePipelineByJob(jobId) {
    const entries = await this.getPipelineByJob(jobId);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('pipeline', 'readwrite');
      const store = tx.objectStore('pipeline');
      for (const e of entries) store.delete(e.id);
      tx.oncomplete = () => resolve(entries.length);
      tx.onerror = () => reject(tx.error);
    });
  }

  async deletePipelineByCandidate(candidateId) {
    const entries = await this.getPipelineByCandidate(candidateId);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('pipeline', 'readwrite');
      const store = tx.objectStore('pipeline');
      for (const e of entries) store.delete(e.id);
      tx.oncomplete = () => resolve(entries.length);
      tx.onerror = () => reject(tx.error);
    });
  }

  // ── Activity Helpers ─────────────────────────────────────

  static ACTIVITY_TYPES = ['email', 'call', 'interview', 'note', 'submission'];

  createActivity(data = {}) {
    return {
      id: crypto.randomUUID(),
      type: data.type || 'note',
      candidateId: data.candidateId || '',
      jobId: data.jobId || '',
      subject: data.subject || '',
      body: data.body || '',
      templateUsed: data.templateUsed || null,
      status: data.status || null,
      followUpDate: data.followUpDate || null,
      createdAt: data.createdAt || new Date().toISOString(),
    };
  }

  async addActivity(data) {
    const activity = this.createActivity(data);
    validateActivity(activity);
    await this.add('activities', activity);
    return activity;
  }

  async updateActivity(activity) {
    validateActivity(activity);
    await this.put('activities', activity);
    return activity;
  }

  async deleteActivity(id) { await this.delete('activities', id); }
  async getActivity(id) { return this.get('activities', id); }
  async getAllActivities() { return this.getAll('activities'); }

  async getActivitiesByCandidate(candidateId) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('activities', 'readonly');
      const index = tx.objectStore('activities').index('candidateId');
      const request = index.getAll(candidateId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getActivitiesWithFollowUp() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('activities', 'readonly');
      const index = tx.objectStore('activities').index('followUpDate');
      const range = IDBKeyRange.bound('', '9999-12-31');
      const request = index.getAll(range);
      request.onsuccess = () => resolve(request.result.filter(a => a.followUpDate));
      request.onerror = () => reject(request.error);
    });
  }

  async deleteActivitiesByCandidate(candidateId) {
    const entries = await this.getActivitiesByCandidate(candidateId);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('activities', 'readwrite');
      const store = tx.objectStore('activities');
      for (const e of entries) store.delete(e.id);
      tx.oncomplete = () => resolve(entries.length);
      tx.onerror = () => reject(tx.error);
    });
  }

  // ── Settings Helpers ──────────────────────────────────────

  async getSetting(key) {
    const record = await this.get('settings', key);
    return record ? record.value : null;
  }

  async setSetting(key, value) {
    await this.put('settings', { key, value });
  }

  // ── Export / Import ───────────────────────────────────────

  async exportAll() {
    const [candidates, clients, jobs, pipeline, activities, settings] = await Promise.all([
      this.getAll('candidates'),
      this.getAll('clients'),
      this.getAll('jobs'),
      this.getAll('pipeline'),
      this.getAll('activities'),
      this.getAll('settings'),
    ]);
    return {
      version: DB_VERSION,
      exportedAt: new Date().toISOString(),
      candidates,
      clients,
      jobs,
      pipeline,
      activities,
      settings,
    };
  }

}

// ── Schema Validation ─────────────────────────────────────────

export function validateCandidate(data) {
  if (!data.firstName || !String(data.firstName).trim()) {
    throw new Error('Missing required field: firstName');
  }
  if (!data.lastName || !String(data.lastName).trim()) {
    throw new Error('Missing required field: lastName');
  }
  if (data.certifications && !Array.isArray(data.certifications)) {
    throw new Error('certifications must be an array');
  }
  if (data.skills && !Array.isArray(data.skills)) {
    throw new Error('skills must be an array');
  }
}

export function validateClient(data) {
  if (!data.companyName || !String(data.companyName).trim()) {
    throw new Error('Missing required field: companyName');
  }
  if (data.contacts && !Array.isArray(data.contacts)) {
    throw new Error('contacts must be an array');
  }
}

export function validateJob(data) {
  if (!data.title || !String(data.title).trim()) {
    throw new Error('Missing required field: title');
  }
  if (data.requiredCerts && !Array.isArray(data.requiredCerts)) {
    throw new Error('requiredCerts must be an array');
  }
  if (data.preferredCerts && !Array.isArray(data.preferredCerts)) {
    throw new Error('preferredCerts must be an array');
  }
  if (data.stages && !Array.isArray(data.stages)) {
    throw new Error('stages must be an array');
  }
}

export function validateActivity(data) {
  const validTypes = ['email', 'call', 'interview', 'note', 'submission'];
  if (!data.type || !validTypes.includes(data.type)) {
    throw new Error('Activity type must be one of: ' + validTypes.join(', '));
  }
  if (!data.candidateId) {
    throw new Error('Missing required field: candidateId');
  }
}

export function validatePipelineEntry(data) {
  if (!data.candidateId) {
    throw new Error('Missing required field: candidateId');
  }
  if (!data.jobId) {
    throw new Error('Missing required field: jobId');
  }
  if (!data.stage) {
    throw new Error('Missing required field: stage');
  }
}

// ── Cert Status Helpers (computed, never stored) ────────────

export function getCertStatus(cert) {
  if (!cert.expirationDate) return 'active';    // lifetime cert
  if (!cert.dateObtained) return 'pending';
  const now = new Date();
  const expiry = new Date(cert.expirationDate);
  if (expiry < now) return 'expired';
  return 'active';
}

export function getCertUrgency(cert, alertDays = 60) {
  if (!cert.expirationDate) return 'none';
  const daysRemaining = Math.ceil((new Date(cert.expirationDate) - new Date()) / 86400000);
  if (daysRemaining < 0) return 'expired';
  if (daysRemaining <= alertDays) return 'expiring-soon';
  return 'none';
}

export function getCertDaysRemaining(cert) {
  if (!cert.expirationDate) return null;
  return Math.ceil((new Date(cert.expirationDate) - new Date()) / 86400000);
}

// ── Pre-populated Cert Reference Data ───────────────────────

export const FINRA_LICENSES = [
  { name: 'Series 7', description: 'General Securities Representative', renewal: 'Lapses 2yr after termination', issuingBody: 'FINRA' },
  { name: 'Series 24', description: 'General Securities Principal', renewal: 'Lapses 2yr after termination', issuingBody: 'FINRA' },
  { name: 'Series 63', description: 'Uniform Securities Agent', renewal: 'Lapses 2yr after termination', issuingBody: 'FINRA' },
  { name: 'Series 65', description: 'Investment Adviser Rep', renewal: 'EVEP: up to 5yr with annual CE', issuingBody: 'FINRA' },
  { name: 'Series 66', description: 'Combined State Law', renewal: 'EVEP: up to 5yr with annual CE', issuingBody: 'FINRA' },
  { name: 'Series 79', description: 'Investment Banking', renewal: 'Lapses 2yr after termination', issuingBody: 'FINRA' },
];

export const COMPLIANCE_CERTS = [
  { name: 'CRCM', description: 'Certified Regulatory Compliance Manager', renewal: 'Annual (CE + fee)', issuingBody: 'ABA' },
  { name: 'CAMS', description: 'Certified Anti-Money Laundering Specialist', renewal: '3 years', issuingBody: 'ACAMS' },
  { name: 'CFE', description: 'Certified Fraud Examiner', renewal: '2 years (20 CPE/yr)', issuingBody: 'ACFE' },
  { name: 'CCEP', description: 'Certified Compliance & Ethics Professional', renewal: '12 months (20 CEUs)', issuingBody: 'SCCE' },
  { name: 'CISA', description: 'Certified Information Systems Auditor', renewal: '3 years (20 CPE/yr)', issuingBody: 'ISACA' },
];

// Singleton
const db = new ComplianceDB();
export default db;
