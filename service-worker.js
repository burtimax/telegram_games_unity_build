const CACHE_NAME = 'unity-game-cache-v1';
const METADATA_CACHE = 'unity-game-metadata-v1';
const TTL_DAYS = 14;
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

const URLS_TO_CACHE = [
  'https://raw.githubusercontent.com/burtimax/telegram_games_unity_build/refs/heads/master/Build/telegram_games_unity_build.data.unityweb',
  'https://raw.githubusercontent.com/burtimax/telegram_games_unity_build/refs/heads/master/Build/telegram_games_unity_build.wasm.unityweb'
];

// Установка
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Активация
self.addEventListener('activate', (event) => {
  event.waitUntil(cleanupExpiredCache());
  self.clients.claim();
});

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
  const metadata = {
    cachedAt: Date.now()
  };
  await metadataCache.put(
    request.url + ':meta',
    new Response(JSON.stringify(metadata))
  );
}

// Очистка устаревших записей
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

// Обработка fetch-запросов
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
