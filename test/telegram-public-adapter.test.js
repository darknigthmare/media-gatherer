const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TELEGRAM_PUBLIC_ADAPTER,
  normalizeTelegramUsername,
  buildTelegramPublicUrl,
  canonicalTelegramMessageUrl,
  isTelegramMediaUrl,
  parseTelegramPublicHtml,
  runTelegramPublicAdapter
} = require('../src/sources/telegramPublicAdapter');

const TELEGRAM_FIXTURE = `
<!doctype html>
<html>
  <head>
    <meta property="og:url" content="https://t.me/exact_channel">
  </head>
  <body>
    <header class="tgme_channel_info">
      <div class="tgme_channel_info_header_title"><span>Exact Channel</span></div>
      <div class="tgme_channel_info_header_username">@Exact_Channel</div>
      <div class="tgme_channel_info_description">Public creator archive</div>
      <img class="tgme_page_photo_image" src="https://cdn4.telesco.pe/file/avatar.jpg">
    </header>

    <div class="tgme_widget_message js-widget_message" data-post="Exact_Channel/101">
      <a class="tgme_widget_message_owner_name" href="https://t.me/exact_channel">
        <span>Exact Channel</span>
      </a>
      <div class="tgme_widget_message_text js-message_text">
        Original full resolution photo
        <a href="https://outside.example/untrusted">outside link</a>
      </div>
      <a
        class="tgme_widget_message_photo_wrap"
        href="https://t.me/exact_channel/101?single"
        style="background-image:url('https://cdn4.telesco.pe/file/original-photo.jpg')"
      ></a>
      <img
        class="tgme_widget_message_photo"
        src="https://outside.example/forbidden.jpg"
      >
      <img
        class="tgme_widget_message_user_photo"
        src="https://cdn4.telesco.pe/file/ui-avatar.jpg"
      >
      <a class="tgme_widget_message_date" href="https://t.me/Exact_Channel/101?single">
        <time datetime="2026-07-20T10:30:00+00:00">10:30</time>
      </a>
    </div>

    <div class="tgme_widget_message js-widget_message" data-post="exact_channel/102">
      <div class="tgme_widget_message_text">Public video clip</div>
      <a class="tgme_widget_message_video_player" href="https://t.me/exact_channel/102">
        <i
          class="tgme_widget_message_video_thumb"
          style="background-image:url('https://cdn5.cdn-telegram.org/file/video-poster.webp')"
        ></i>
        <video src="https://cdn5.cdn-telegram.org/file/public-video.mp4"></video>
      </a>
      <a class="tgme_widget_message_date" href="https://t.me/exact_channel/102">
        <time datetime="2026-07-21T11:45:00Z">11:45</time>
      </a>
    </div>

    <div class="tgme_widget_message js-widget_message" data-post="other_channel/999">
      <div class="tgme_widget_message_text">Media from another channel</div>
      <a
        class="tgme_widget_message_photo_wrap"
        style="background-image:url('https://cdn4.telesco.pe/file/wrong-channel.jpg')"
      ></a>
      <a class="tgme_widget_message_date" href="https://t.me/other_channel/999">
        <time datetime="2026-07-22T12:00:00Z">12:00</time>
      </a>
    </div>
  </body>
</html>
`;

test('accepte seulement un username Telegram exact et construit la page publique', () => {
  assert.equal(normalizeTelegramUsername('@Exact_Channel'), 'exact_channel');
  assert.equal(normalizeTelegramUsername('exact_channel'), 'exact_channel');
  assert.equal(normalizeTelegramUsername('bad-name'), '');
  assert.equal(normalizeTelegramUsername('https://t.me/exact_channel'), '');
  assert.equal(normalizeTelegramUsername('abc'), '');
  assert.equal(buildTelegramPublicUrl('@Exact_Channel'), 'https://t.me/s/exact_channel');
  assert.throws(() => buildTelegramPublicUrl('channel/101'), /username required/i);
  assert.equal(
    canonicalTelegramMessageUrl('https://t.me/Exact_Channel/101?single', 'exact_channel'),
    'https://t.me/exact_channel/101'
  );
  assert.equal(
    canonicalTelegramMessageUrl('https://t.me/other_channel/101', 'exact_channel'),
    ''
  );
});

test('parse images, videos, miniatures et preuves sans assets UI ni liens hors canal', () => {
  const parsed = parseTelegramPublicHtml(TELEGRAM_FIXTURE, '@Exact_Channel');

  assert.equal(parsed.username, 'exact_channel');
  assert.equal(parsed.channelUrl, 'https://t.me/exact_channel');
  assert.equal(parsed.publicUrl, 'https://t.me/s/exact_channel');
  assert.equal(parsed.displayName, 'Exact Channel');
  assert.equal(parsed.description, 'Public creator archive');
  assert.equal(parsed.messagesParsed, 2);
  assert.equal(parsed.images.length, 1);
  assert.equal(parsed.videos.length, 1);

  assert.deepEqual(parsed.images[0], {
    type: 'image',
    url: 'https://cdn4.telesco.pe/file/original-photo.jpg',
    thumbnail: 'https://cdn4.telesco.pe/file/original-photo.jpg',
    link: 'https://t.me/exact_channel/101',
    sourceUrl: 'https://t.me/exact_channel/101',
    accountUrl: 'https://t.me/exact_channel',
    title: 'Original full resolution photo outside link',
    description: 'Original full resolution photo outside link',
    date: '2026-07-20T10:30:00.000Z',
    messageId: '101',
    identityEvidence: [
      {
        kind: 'exact_public_username',
        value: '@exact_channel',
        url: 'https://t.me/exact_channel'
      },
      {
        kind: 'exact_message_namespace',
        value: 'exact_channel/101',
        url: 'https://t.me/exact_channel/101'
      }
    ],
    trustedContext: true
  });

  assert.equal(parsed.videos[0].url, 'https://cdn5.cdn-telegram.org/file/public-video.mp4');
  assert.equal(parsed.videos[0].thumbnail, 'https://cdn5.cdn-telegram.org/file/video-poster.webp');
  assert.equal(parsed.videos[0].link, 'https://t.me/exact_channel/102');
  assert.equal(parsed.videos[0].playback, 'direct');
  assert.equal(parsed.videos[0].date, '2026-07-21T11:45:00.000Z');

  const serialized = JSON.stringify(parsed);
  assert.doesNotMatch(serialized, /outside\.example|wrong-channel|ui-avatar/);
  assert.match(serialized, /exact_message_namespace/);
  assert.equal(isTelegramMediaUrl('https://outside.example/image.jpg', 'image'), false);
  assert.equal(isTelegramMediaUrl('https://cdn4.telesco.pe/file/logo.svg', 'image'), false);
});

test('runner injecte fetchText une seule fois et borne timeout, messages et medias', async () => {
  const calls = [];
  const result = await runTelegramPublicAdapter('@Exact_Channel', {
    timeout: 999999,
    messageLimit: 999,
    imageLimit: 999,
    videoLimit: 999
  }, {
    fetchText: async (url, requestOptions) => {
      calls.push({ url, requestOptions });
      return TELEGRAM_FIXTURE;
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://t.me/s/exact_channel');
  assert.equal(calls[0].requestOptions.timeout, 20000);
  assert.equal(result.status.adapter, TELEGRAM_PUBLIC_ADAPTER);
  assert.equal(result.status.imagesCount, 1);
  assert.equal(result.status.videosCount, 1);
  assert.equal(result.status.zeroReason, '');
  assert.deepEqual(result.status.accounts, ['https://t.me/exact_channel']);
  assert.equal(result.status.identityAliases[0].value, '@exact_channel');
});

test('rejette une page d un autre canal et un HTML trop volumineux', () => {
  const wrongIdentity = TELEGRAM_FIXTURE.replace('@Exact_Channel', '@Other_Channel');
  assert.throws(
    () => parseTelegramPublicHtml(wrongIdentity, 'exact_channel'),
    /identity does not match/
  );
  assert.throws(
    () => parseTelegramPublicHtml('x'.repeat(2049), 'exact_channel', { maxHtmlBytes: 2048 }),
    /exceeds 2048 bytes/
  );
});
