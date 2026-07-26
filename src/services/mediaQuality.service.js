const QUALITY_LABELS = Object.freeze({
  original_confirmed: 'Original confirmé',
  best_declared: 'Meilleure version déclarée',
  thumbnail_only: 'Miniature seulement',
  unverified: 'Qualité non vérifiée'
});

function isVideoUrl(value) {
  return /\.(?:mp4|webm|mov|m4v|m3u8)(?:[?#]|$)/i.test(String(value || ''));
}

function isThumbnailUrl(value) {
  return /(?:^|[\/_.-])(?:thumb|thumbnail|tmb|preview|poster|small|medium|avatar)(?:[\/_.?=-]|$)/i.test(String(value || ''));
}

function hasDimensions(item = {}) {
  return Number(item.width) > 0 && Number(item.height) > 0;
}

function classifyMediaQuality(item = {}, kind = 'image') {
  const url = String(item.url || '');
  const thumbnail = String(item.thumbnail || '');
  let state = 'unverified';
  let reason = 'La résolution du média principal n’a pas encore été vérifiée.';

  if (item.originalConfirmed === true && url) {
    state = 'original_confirmed';
    reason = 'L’adaptateur officiel ou la page source déclare explicitement ce fichier comme original.';
  } else if (kind === 'video' && isVideoUrl(url)) {
    state = 'best_declared';
    reason = 'Un flux vidéo public direct a été déclaré par la source.';
  } else if (item.bestDeclared === true && url) {
    state = 'best_declared';
    reason = 'L’adaptateur a sélectionné la meilleure variante déclarée par la source.';
  } else if (kind === 'image' && hasDimensions(item) && url && !isThumbnailUrl(url)) {
    state = 'best_declared';
    reason = 'La source déclare les dimensions de cette variante principale.';
  } else if (url && thumbnail && url !== thumbnail && !isThumbnailUrl(url)) {
    state = 'best_declared';
    reason = 'Une URL principale distincte de la miniature est disponible.';
  } else if (thumbnail || isThumbnailUrl(url)) {
    state = 'thumbnail_only';
    reason = 'Seule une miniature ou une image d’aperçu est actuellement confirmée.';
  }

  return {
    qualityState: state,
    qualityStateLabel: QUALITY_LABELS[state],
    qualityReason: reason,
    qualityVerified: item.qualityVerified === true
  };
}

function applyIntrinsicImageVerification(item = {}, width, height, loadedUrl = '') {
  const naturalWidth = Math.max(0, Number(width) || 0);
  const naturalHeight = Math.max(0, Number(height) || 0);
  if (!naturalWidth || !naturalHeight) return { ...item, ...classifyMediaQuality(item, 'image') };
  const mainUrl = String(item.url || '');
  const resolvedLoadedUrl = String(loadedUrl || '');
  const mainLoaded = Boolean(mainUrl && resolvedLoadedUrl && mainUrl === resolvedLoadedUrl);
  const next = {
    ...item,
    width: mainLoaded ? naturalWidth : (item.width || 0),
    height: mainLoaded ? naturalHeight : (item.height || 0),
    previewWidth: naturalWidth,
    previewHeight: naturalHeight,
    qualityVerified: true,
    qualityVerifiedAt: new Date().toISOString()
  };
  if (item.originalConfirmed === true && mainLoaded) {
    next.qualityState = 'original_confirmed';
    next.qualityStateLabel = QUALITY_LABELS.original_confirmed;
    next.qualityReason = `Fichier original chargé avec succès en ${naturalWidth}x${naturalHeight}.`;
  } else if (mainLoaded && !isThumbnailUrl(mainUrl)) {
    next.qualityState = 'best_declared';
    next.qualityStateLabel = QUALITY_LABELS.best_declared;
    next.qualityReason = `Variante principale chargée et mesurée en ${naturalWidth}x${naturalHeight}.`;
  } else {
    next.qualityState = 'thumbnail_only';
    next.qualityStateLabel = QUALITY_LABELS.thumbnail_only;
    next.qualityReason = `Aperçu chargé et mesuré en ${naturalWidth}x${naturalHeight}; le fichier principal reste à confirmer.`;
  }
  return next;
}

module.exports = {
  QUALITY_LABELS,
  isThumbnailUrl,
  classifyMediaQuality,
  applyIntrinsicImageVerification
};
