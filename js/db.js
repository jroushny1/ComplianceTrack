/**
 * db.js — IndexedDB setup, stores, CRUD helpers
 * ComplianceTrack v1 (Phase 1: candidates + settings)
 */

const DB_NAME = 'ComplianceTrackDB';
export const DB_VERSION = 1;

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
        // Phase 2: if (oldVersion < 2) { ... jobs, clients, pipeline }
        // Phase 3: if (oldVersion < 3) { ... activities }
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

  async count(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getByIndex(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);
      request.onsuccess = () => resolve(request.result);
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

  async findByExternalId(externalId) {
    const results = await this.getByIndex('candidates', 'externalId', externalId);
    return results[0] || null;
  }

  async findByEmail(email) {
    return this.getByIndex('candidates', 'email', email);
  }

  // ── Settings Helpers ──────────────────────────────────────

  async getSetting(key) {
    const record = await this.get('settings', key);
    return record ? record.value : null;
  }

  async setSetting(key, value) {
    await this.put('settings', { key, value });
  }

  async getSettings() {
    const all = await this.getAll('settings');
    const map = {};
    for (const { key, value } of all) {
      map[key] = value;
    }
    return map;
  }

  // ── Export / Import ───────────────────────────────────────

  async exportAll() {
    const candidates = await this.getAll('candidates');
    const settings = await this.getAll('settings');
    return {
      version: DB_VERSION,
      exportedAt: new Date().toISOString(),
      candidates,
      settings,
    };
  }

  async importCandidates(candidates) {
    const BATCH_SIZE = 100;
    let imported = 0;
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction('candidates', 'readwrite');
        const store = tx.objectStore('candidates');
        for (const c of batch) {
          store.put(c);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      imported += batch.length;
      // Yield to main thread between batches
      await new Promise(r => setTimeout(r, 0));
    }
    return imported;
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
