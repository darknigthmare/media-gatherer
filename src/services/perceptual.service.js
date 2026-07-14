function normalizeHash(value) {
  const hash = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{16}$/.test(hash) ? hash : '';
}

function hammingDistance(left, right) {
  const a = normalizeHash(left);
  const b = normalizeHash(right);
  if (!a || !b) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < a.length; index += 1) {
    let value = parseInt(a[index], 16) ^ parseInt(b[index], 16);
    while (value) {
      distance += value & 1;
      value >>= 1;
    }
  }
  return distance;
}

function dedupePerceptual(items = [], maxDistance = 6) {
  const kept = [];
  for (const item of items) {
    const hash = normalizeHash(item?.perceptualHash);
    const duplicateIndex = hash
      ? kept.findIndex(candidate => hammingDistance(hash, candidate.perceptualHash) <= maxDistance)
      : -1;
    if (duplicateIndex === -1) {
      kept.push(item);
      continue;
    }
    const current = kept[duplicateIndex];
    const currentPixels = (Number(current.width) || 0) * (Number(current.height) || 0);
    const candidatePixels = (Number(item.width) || 0) * (Number(item.height) || 0);
    if (candidatePixels > currentPixels) kept[duplicateIndex] = item;
  }
  return kept;
}

module.exports = { normalizeHash, hammingDistance, dedupePerceptual };
