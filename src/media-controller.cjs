const crypto = require('node:crypto');
const { listDownloads, publicCandidate } = require('./realdebrid.cjs');
const { planCart, volumeKey } = require('./placement.cjs');
const { downloadToLibrary } = require('./downloader.cjs');

function createMediaController({ getToken, getDestinations, onImported, onJobsChanged = () => {}, savedJobs = [], listImpl = listDownloads, planImpl = planCart, downloadImpl = downloadToLibrary }) {
  let candidates = new Map();
  let candidateFetchedAt = 0;
  const plans = new Map();
  const jobSources = new Map();
  const jobs = new Map(savedJobs.map(job => [job.id, ['queued', 'downloading'].includes(job.state) ? { ...job, state: 'interrupted', error: 'Host restarted before this download finished; preview and submit again' } : job]));
  const aborts = new Map();
  let pumping = false;

  const visibleJobs = () => [...jobs.values()].map(({ sourceId, ...job }) => ({ ...job, sourceId }));
  const changed = () => onJobsChanged(visibleJobs());
  const reservedBytes = () => {
    const reserved = new Map();
    for (const job of jobs.values()) if (['queued', 'downloading'].includes(job.state)) {
      const destination = getDestinations().find(item => item.id === job.destinationId);
      if (destination) { const key = volumeKey(destination); reserved.set(key, (reserved.get(key) || 0) + job.sizeBytes); }
    }
    return reserved;
  };

  async function refreshCandidates(force = false) {
    if (!force && Date.now() - candidateFetchedAt < 60_000) return [...candidates.values()].map(publicCandidate);
    const token = await getToken('real-debrid');
    const found = await listImpl(token);
    candidates = new Map(found.map(item => [item.id, item]));
    candidateFetchedAt = Date.now();
    return found.map(publicCandidate);
  }

  async function preview(ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some(id => typeof id !== 'string')) throw new Error('Choose 1–50 account files');
    await refreshCandidates();
    const selected = ids.map(id => candidates.get(id));
    if (selected.some(item => !item || !item.sourceUrl || !item.sizeBytes)) throw new Error('Selected account file has no ready link or exact size; refresh the account list');
    const placements = await planImpl(selected.map(item => ({ name: item.filename, sizeBytes: item.sizeBytes })), getDestinations(), undefined, undefined, reservedBytes());
    const id = crypto.randomUUID();
    plans.set(id, { selected, placements, createdAt: Date.now() });
    return { planId: id, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), items: placements };
  }

  async function submit(planId) {
    const plan = plans.get(planId);
    plans.delete(planId);
    if (!plan || Date.now() - plan.createdAt > 10 * 60_000) throw new Error('Placement preview expired; preview again');
    const fresh = await planImpl(plan.selected.map(item => ({ name: item.filename, sizeBytes: item.sizeBytes })), getDestinations(), undefined, undefined, reservedBytes());
    if (fresh.some((item, index) => item.destinationId !== plan.placements[index].destinationId || item.relativePath !== plan.placements[index].relativePath)) throw new Error('Drive placement changed; review a fresh preview before submitting');
    const created = plan.selected.map((candidate, index) => {
      const placement = fresh[index];
      const job = { id: crypto.randomUUID(), sourceId: candidate.id, provider: candidate.provider, filename: candidate.filename, sizeBytes: candidate.sizeBytes, destinationId: placement.destinationId, destinationLabel: placement.destinationLabel, relativePath: placement.relativePath, state: 'queued', receivedBytes: 0, createdAt: new Date().toISOString(), error: null };
      jobs.set(job.id, job);
      jobSources.set(job.id, candidate);
      return job.id;
    });
    changed();
    void pump();
    return created;
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        const job = [...jobs.values()].find(item => item.state === 'queued');
        if (!job) break;
        const candidate = jobSources.get(job.id);
        const destination = getDestinations().find(item => item.id === job.destinationId);
        if (!candidate || !destination) { job.state = 'error'; job.error = 'Source or destination is no longer available'; changed(); continue; }
        const controller = new AbortController();
        aborts.set(job.id, controller);
        job.state = 'downloading';
        changed();
        try {
          const result = await downloadImpl({ id: job.id, candidate, placement: { destinationId: job.destinationId, filename: job.filename, sizeBytes: job.sizeBytes, relativePath: job.relativePath }, destination, signal: controller.signal, onProgress: received => { job.receivedBytes = received; changed(); }, onImported });
          job.state = result.indexed ? 'completed' : 'completed-with-warning';
          job.error = result.warning || null;
          job.receivedBytes = job.sizeBytes;
        } catch (error) { job.state = controller.signal.aborted ? 'cancelled' : 'error'; job.error = error.message; }
        finally { aborts.delete(job.id); jobSources.delete(job.id); changed(); }
      }
    } finally { pumping = false; }
  }

  function cancel(id) {
    const job = jobs.get(id);
    if (!job) throw new Error('Unknown job');
    if (job.state === 'queued') { job.state = 'cancelled'; job.error = 'Cancelled before download'; changed(); return true; }
    if (job.state === 'downloading') { aborts.get(id)?.abort(); return true; }
    return false;
  }

  return { refreshCandidates, preview, submit, visibleJobs, cancel };
}

module.exports = { createMediaController };
