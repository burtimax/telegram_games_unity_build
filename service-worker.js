const CACHE_NAME = 'unity-game-cache-v30';
const METADATA_CACHE = 'unity-game-metadata-v30';
const TTL_DAYS = 14;
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

const URLS_TO_CACHE = [
  'https://telegram-games-tma.tg-projects.ru/Build/telegram_games_unity_build.data.unityweb',
  'https://raw.githubusercontent.com/burtimax/telegram_games_unity_build/refs/heads/master/Build/telegram_games_unity_build.data.unityweb',
  'https://telegram-games-tma.tg-projects.ru/Build/telegram_games_unity_build.wasm.unityweb',
  'https://raw.githubusercontent.com/burtimax/telegram_games_unity_build/refs/heads/master/Build/telegram_games_unity_build.wasm.unityweb'
];

// --- Helpers ---

// Проверка TTL по метаданным
async function isExpired(request) {
  const metadataCache = await caches.open(METADATA_CACHE);
  const metadataResponse = await metadataCache.match(request.url + ':meta');
  if (!metadataResponse) return true;

  const metadata = await metadataResponse.json();
  const now = Date.now();
  return now - metadata.cachedAt > TTL_MS;
}

// Обновление метаданных
async function updateMetadata(request) {
  const metadataCache = await caches.open(METADATA_CACHE);
  const metadata = { cachedAt: Date.now() };
  await metadataCache.put(
      request.url + ':meta',
      new Response(JSON.stringify(metadata))
  );
}

// Очистка устаревших записей (по TTL)
async function cleanupExpiredCache() {
  const cache = await caches.open(CACHE_NAME);
  const metadataCache = await caches.open(METADATA_CACHE);
  const requests = await cache.keys();

  const now = Date.now();
  for (const request of requests) {
    const metadataResponse = await metadataCache.match(request.url + ':meta');
    let expired = true;

    if (metadataResponse) {
      const metadata = await metadataResponse.json();
      expired = now - metadata.cachedAt > TTL_MS;
    }

    if (expired) {
      await cache.delete(request);
      await metadataCache.delete(request.url + ':meta');
    }
  }
}

// Предкеширование нужных ресурсов + запись метаданных
async function precacheOnInstall() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(URLS_TO_CACHE);

  const metadataCache = await caches.open(METADATA_CACHE);
  const now = Date.now();
  await Promise.all(
      URLS_TO_CACHE.map((url) =>
          metadataCache.put(
              url + ':meta',
              new Response(JSON.stringify({ cachedAt: now }))
          )
      )
  );
}

// --- SW Lifecycle ---

// Установка: предкеш + мгновенная активация новой версии
self.addEventListener('install', (event) => {
  event.waitUntil(precacheOnInstall());
  self.skipWaiting();
});

// Активация: чистка устаревших по TTL и удаление старых версий кеша
self.addEventListener('activate', (event) => {
  const ALLOWED = [CACHE_NAME, METADATA_CACHE];

  event.waitUntil(
      (async () => {
        // 1) Удаляем записи, просроченные по TTL
        await cleanupExpiredCache();

        // 2) Удаляем кеши старых версий по имени
        const keys = await caches.keys();
        await Promise.all(
            keys.map((k) => (ALLOWED.includes(k) ? Promise.resolve() : caches.delete(k)))
        );
      })()
  );

  self.clients.claim();
});

// Обработка fetch-запросов только для whitelisted URL
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!URLS_TO_CACHE.includes(request.url)) return;

  event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(request);
        const expired = cachedResponse ? await isExpired(request) : true;

        if (!cachedResponse || expired) {
          try {
            const networkResponse = await fetch(request);
            await cache.put(request, networkResponse.clone());
            await updateMetadata(request);
            return networkResponse;
          } catch (err) {
            // fallback на устаревший кеш, если он есть
            if (cachedResponse) return cachedResponse;
            throw err;
          }
        }

        return cachedResponse;
      })
  );
});
