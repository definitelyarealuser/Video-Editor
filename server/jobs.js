const { EventEmitter } = require('events');

/** Simple in-memory job store. Fine for a single-user local tool; not meant to survive a restart. */
class JobStore extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map();
  }

  create(jobId, initial) {
    const job = { id: jobId, status: 'queued', progress: 0, error: null, createdAt: Date.now(), ...initial };
    this.jobs.set(jobId, job);
    return job;
  }

  update(jobId, patch) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    Object.assign(job, patch);
    this.emit(`update:${jobId}`, job);
  }

  get(jobId) {
    return this.jobs.get(jobId);
  }

  delete(jobId) {
    this.jobs.delete(jobId);
  }
}

module.exports = new JobStore();
