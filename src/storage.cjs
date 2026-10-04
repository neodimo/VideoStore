const GiB = 1024 ** 3;

function evaluateDestination(destination, fileBytes, stats, reservedBytes = 0) {
  if (!Number.isSafeInteger(fileBytes) || fileBytes <= 0) throw new Error('An exact positive file size is required before placement');
  const totalBytes = stats.blocks * stats.bsize;
  const freeBytes = stats.bavail * stats.bsize - reservedBytes;
  const reservePercent = Number.isFinite(destination.reservePercent) ? destination.reservePercent : 10;
  const reserveBytes = Number.isFinite(destination.reserveBytes) ? destination.reserveBytes : 500 * GiB;
  if (reservePercent < 0 || reservePercent > 90 || reserveBytes < 0) throw new Error('Invalid storage reserve');
  const floorBytes = Math.max(Math.ceil(totalBytes * reservePercent / 100), reserveBytes);
  const afterBytes = freeBytes - fileBytes;
  const headroomBytes = afterBytes - floorBytes;
  return {
    id: destination.id, label: destination.label, path: destination.path, type: destination.type,
    totalBytes, freeBytes, fileBytes, afterBytes, floorBytes, headroomBytes,
    eligible: afterBytes >= floorBytes,
    reason: afterBytes >= floorBytes ? 'Above configured free-space floor' : 'Would cross configured free-space floor'
  };
}

function recommend(evaluations, type) {
  return evaluations.filter(item => item.type === type && item.eligible)
    .sort((a, b) => b.headroomBytes / b.totalBytes - a.headroomBytes / a.totalBytes)[0] || null;
}

module.exports = { GiB, evaluateDestination, recommend };
