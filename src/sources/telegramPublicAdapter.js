const cheerio = require('cheerio');

const TELEGRAM_ORIGIN = 'https://t.me';
const TELEGRAM_PUBLIC_ADAPTER = 'telegram-web-public-bounded';
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGES = 40;
const MAX_IMAGES = 60;
const MAX_VIDEOS = 40;

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function normalizeTelegramUsername(value) {
  const input = String(value || '').trim();
  if (!/^@?[A-Za-z][A-Za-z0-9_]{4,31}$/.test(input)) return '';
  return input.replace(/^@/, '').toLowerCase();
}

function buildTelegramPublicUrl(value) {
  const username = normalizeTelegramUsername(value);
  if (!username) throw new TypeError('Exact public Telegram username required');
  return `${TELEGRAM_ORIGIN}/s/${username}`;
}

function safeHttpsUrl(value, base = TELEGRAM_ORIGIN) {
  if (!value) return '';
  try {
    const url = new URL(String(value).trim(), base);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function canonicalTelegramMessageUrl(value, username, fallbackMessageId = '') {
  const expectedUsername = normalizeTelegramUsername(username);
  if (!expectedUsername) return '';

  const candidate = safeHttpsUrl(value);
  if (candidate) {
    const url = new URL(candidate);
    const segments = url.pathname.split('/').filter(Boolean);
    if (
      url.hostname.toLowerCase() === 't.me' &&
      normalizeTelegramUsername(segments[0]) === expectedUsername &&
      /^\d+$/.test(segments[1] || '')
    ) {
      return `${TELEGRAM_ORIGIN}/${expectedUsername}/${segments[1]}`;
    }
  }

  return /^\d+$/.test(String(fallbackMessageId || ''))
    ? `${TELEGRAM_ORIGIN}/${expectedUsername}/${fallbackMessageId}`
    : '';
}

function extractCssUrl(style) {
  const match = String(style || '').match(/url\(\s*(['"]?)(.*?)\1\s*\)/i);
  return match ? match[2].replace(/\\(['"])/g, '$1').trim() : '';
}

function isTelegramMediaUrl(value, expectedType) {
  const candidate = safeHttpsUrl(value);
  if (!candidate) return false;

  const url = new URL(candidate);
  const hostname = url.hostname.toLowerCase();
  const telegramHost = (
    hostname === 't.me' ||
    hostname === 'telegram.org' ||
    hostname.endsWith('.telegram.org') ||
    hostname.endsWith('.telesco.pe') ||
    hostname.endsWith('.telegram-cdn.org') ||
    hostname.endsWith('.cdn-telegram.org')
  );
  if (!telegramHost) return false;

  const assetKey = `${url.pathname}${url.search}`.toLowerCase();
  if (/(?:^|[/_.-])(?:avatar|emoji|icon|logo|reaction|sprite|button|placeholder)(?:[/_.-]|$)/.test(assetKey)) {
    return false;
  }

  const extension = url.pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() || '';
  if (expectedType === 'image' && ['mp4', 'webm', 'mov', 'm3u8'].includes(extension)) return false;
  if (expectedType === 'video' && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension)) return false;
  return true;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeDate(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function exactPostIdentity(dataPost, username) {
  const match = String(dataPost || '').trim().match(/^([A-Za-z][A-Za-z0-9_]{4,31})\/(\d+)$/);
  if (!match || normalizeTelegramUsername(match[1]) !== username) return null;
  return { messageId: match[2], namespace: `${username}/${match[2]}` };
}

function firstTelegramAsset($element, type, $) {
  const values = [
    $element.attr('src'),
    $element.attr('data-src'),
    type === 'image' ? $element.attr('data-original') : '',
    extractCssUrl($element.attr('style'))
  ];

  if (type === 'image') {
    $element.find('[src], [data-src], [data-original], [style*="url("]').each((_, node) => {
      const $node = $(node);
      values.push(
        $node.attr('src'),
        $node.attr('data-src'),
        $node.attr('data-original'),
        extractCssUrl($node.attr('style'))
      );
    });
  }

  return values
    .map(value => safeHttpsUrl(value))
    .find(value => isTelegramMediaUrl(value, type)) || '';
}

function videoThumbnail($video, $) {
  const $wrapper = $video.closest(
    '.tgme_widget_message_video_player, .tgme_widget_message_video_wrap, .tgme_widget_message_video'
  );
  const candidates = [
    $video.attr('poster'),
    $video.attr('data-poster'),
    extractCssUrl($wrapper.attr('style'))
  ];
  $wrapper.find('[poster], [data-poster], .tgme_widget_message_video_thumb, [style*="url("]').each((_, node) => {
    const $node = $(node);
    candidates.push(
      $node.attr('poster'),
      $node.attr('data-poster'),
      extractCssUrl($node.attr('style'))
    );
  });
  return candidates
    .map(value => safeHttpsUrl(value))
    .find(value => isTelegramMediaUrl(value, 'image')) || '';
}

function uniqueEvidence(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = `${item.kind}:${item.value}:${item.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseTelegramPublicHtml(html, requestedUsername, options = {}) {
  const username = normalizeTelegramUsername(requestedUsername);
  if (!username) throw new TypeError('Exact public Telegram username required');
  if (typeof html !== 'string') throw new TypeError('Telegram HTML must be a string');

  const maxHtmlBytes = boundedInteger(options.maxHtmlBytes, MAX_HTML_BYTES, 1024, MAX_HTML_BYTES);
  if (Buffer.byteLength(html, 'utf8') > maxHtmlBytes) {
    throw new RangeError(`Telegram HTML exceeds ${maxHtmlBytes} bytes`);
  }

  const messageLimit = boundedInteger(options.messageLimit, 20, 1, MAX_MESSAGES);
  const imageLimit = boundedInteger(options.imageLimit, 35, 1, MAX_IMAGES);
  const videoLimit = boundedInteger(options.videoLimit, 20, 1, MAX_VIDEOS);
  const $ = cheerio.load(html);
  const channelUrl = `${TELEGRAM_ORIGIN}/${username}`;
  const publicUrl = buildTelegramPublicUrl(username);
  const headerUsername = normalizeTelegramUsername(
    cleanText($('.tgme_channel_info_header_username').first().text())
  );

  if (headerUsername && headerUsername !== username) {
    throw new Error('Telegram page identity does not match requested username');
  }

  const displayName = cleanText(
    $('.tgme_channel_info_header_title').first().text() ||
    $('.tgme_widget_message_owner_name').first().text()
  );
  const channelDescription = cleanText($('.tgme_channel_info_description').first().text());
  const headerEvidence = headerUsername === username
    ? [{
        kind: 'exact_public_username',
        value: `@${username}`,
        url: channelUrl
      }]
    : [];
  const identityEvidence = [...headerEvidence];
  const images = [];
  const videos = [];
  const seenImages = new Set();
  const seenVideos = new Set();
  let messagesParsed = 0;

  $('.tgme_widget_message[data-post], .js-widget_message[data-post]')
    .toArray()
    .slice(0, messageLimit)
    .forEach(node => {
      const $message = $(node);
      const postIdentity = exactPostIdentity($message.attr('data-post'), username);
      if (!postIdentity) return;

      const dateLink = $message.find('.tgme_widget_message_date[href]').first().attr('href');
      const messageUrl = canonicalTelegramMessageUrl(dateLink, username, postIdentity.messageId);
      if (!messageUrl) return;
      messagesParsed += 1;

      const text = cleanText(
        $message.find('.tgme_widget_message_text, .js-message_text, .tgme_widget_message_caption')
          .first()
          .text()
      );
      const ownerName = cleanText($message.find('.tgme_widget_message_owner_name').first().text());
      const title = text.slice(0, 140) || `${ownerName || displayName || `@${username}`} - Telegram message ${postIdentity.messageId}`;
      const date = normalizeDate($message.find('time[datetime]').first().attr('datetime'));
      const messageEvidence = {
        kind: 'exact_message_namespace',
        value: postIdentity.namespace,
        url: messageUrl
      };
      identityEvidence.push(messageEvidence);
      const evidence = uniqueEvidence([...headerEvidence, messageEvidence]);
      const common = {
        link: messageUrl,
        sourceUrl: messageUrl,
        accountUrl: channelUrl,
        title,
        description: text,
        date,
        messageId: postIdentity.messageId,
        identityEvidence: evidence,
        trustedContext: true
      };

      $message.find('.tgme_widget_message_photo_wrap, .tgme_widget_message_photo').each((_, photo) => {
        if (images.length >= imageLimit) return;
        const mediaUrl = firstTelegramAsset($(photo), 'image', $);
        if (!mediaUrl || seenImages.has(mediaUrl)) return;
        seenImages.add(mediaUrl);
        images.push({
          ...common,
          type: 'image',
          url: mediaUrl,
          thumbnail: mediaUrl
        });
      });

      $message.find(
        '.tgme_widget_message_video_player video, video.tgme_widget_message_video, .tgme_widget_message_video_wrap video'
      ).each((_, video) => {
        if (videos.length >= videoLimit) return;
        const $video = $(video);
        const sourceValue = (
          $video.attr('src') ||
          $video.attr('data-src') ||
          $video.find('source[src], source[data-src]').first().attr('src') ||
          $video.find('source[src], source[data-src]').first().attr('data-src')
        );
        const mediaUrl = safeHttpsUrl(sourceValue);
        const thumbnail = videoThumbnail($video, $);
        if (
          !mediaUrl ||
          !thumbnail ||
          !isTelegramMediaUrl(mediaUrl, 'video') ||
          seenVideos.has(mediaUrl)
        ) {
          return;
        }
        seenVideos.add(mediaUrl);
        videos.push({
          ...common,
          type: 'video',
          url: mediaUrl,
          thumbnail,
          playback: 'direct'
        });
      });
    });

  return {
    username,
    channelUrl,
    publicUrl,
    displayName,
    description: channelDescription,
    identityEvidence: uniqueEvidence(identityEvidence),
    messagesParsed,
    images,
    videos
  };
}

async function runTelegramPublicAdapter(requestedUsername, options = {}, deps = {}) {
  if (typeof deps.fetchText !== 'function') {
    throw new TypeError('fetchText dependency required for Telegram public adapter');
  }

  const username = normalizeTelegramUsername(requestedUsername);
  const publicUrl = buildTelegramPublicUrl(username);
  const timeout = boundedInteger(options.timeout, 12000, 1000, 20000);
  const html = await deps.fetchText(publicUrl, {
    timeout,
    headers: {
      accept: 'text/html,application/xhtml+xml'
    }
  });
  const parsed = parseTelegramPublicHtml(html, username, options);
  const total = parsed.images.length + parsed.videos.length;

  return {
    ...parsed,
    status: {
      success: true,
      available: true,
      adapter: TELEGRAM_PUBLIC_ADAPTER,
      imagesCount: parsed.images.length,
      videosCount: parsed.videos.length,
      zeroReason: total ? '' : 'no_matching_public_media',
      note: `${parsed.messagesParsed} bounded public messages parsed`,
      accounts: parsed.identityEvidence.length ? [parsed.channelUrl] : [],
      identityAliases: parsed.identityEvidence.length
        ? [{
            value: `@${parsed.username}`,
            kind: 'username',
            confidence: 98,
            evidence: parsed.identityEvidence.map(item => item.url)
          }]
        : [],
      pageSamples: [{
        url: parsed.publicUrl,
        title: parsed.displayName || `@${parsed.username}`,
        description: parsed.description
      }]
    }
  };
}

module.exports = {
  TELEGRAM_ORIGIN,
  TELEGRAM_PUBLIC_ADAPTER,
  MAX_HTML_BYTES,
  normalizeTelegramUsername,
  buildTelegramPublicUrl,
  canonicalTelegramMessageUrl,
  extractCssUrl,
  isTelegramMediaUrl,
  parseTelegramPublicHtml,
  runTelegramPublicAdapter
};
