// HJOI Service Worker — PWA 离线缓存
const CACHE_VERSION = 'hjoi-v2';

const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// 永远走网络的域名（API / 数据接口）
const NETWORK_ONLY_HOSTS = [
  'api.hjoi.com.cn',
  'supabase.co',
  'supabase.com',
];

// 安全判断：只处理 http/https
function isHttpRequest(request) {
  try {
    const url = new URL(request.url);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// 安全缓存：避免 chrome-extension:// 等非法 scheme 报错
async function safePut(cache, request, response) {
  try {
    if (!isHttpRequest(request)) return;
    if (!response || response.status !== 200) return;
    await cache.put(request, response);
  } catch (err) {
    console.warn('[SW] cache.put skipped:', request.url, err);
  }
}

// ── Install：预缓存壳资源 ──────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => {
      return cache.addAll(PRECACHE).catch(err => {
        console.warn('[SW] precache partial fail:', err);
      });
    })
  );
  self.skipWaiting();
});

// ── Activate：清理旧版本缓存 ──────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_VERSION)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch 策略 ────────────────────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;

  // 0. 非 GET 不处理
  if (req.method !== 'GET') return;

  // 1. 非 http/https 请求不处理（修复 chrome-extension 报错）
  if (!isHttpRequest(req)) return;

  const url = new URL(req.url);

  // 2. API 请求永远走网络，不缓存
  if (NETWORK_ONLY_HOSTS.some(h => url.hostname.includes(h))) {
    return;
  }

  // 3. CDN 静态资源 — Cache First
  const isCDN =
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('jsdelivr.net') ||
    url.hostname.includes('cdnjs.cloudflare.com');

  if (isCDN) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;

        return fetch(req)
          .then(async resp => {
            const clone = resp.clone();
            const cache = await caches.open(CACHE_VERSION);
            await safePut(cache, req, clone);
            return resp;
          })
          .catch(() => cached);
      })
    );
    return;
  }

  // 4. 主 HTML — Network First
  if (
    url.origin === self.location.origin &&
    (url.pathname === '/' || url.pathname.endsWith('.html'))
  ) {
    event.respondWith(
      fetch(req)
        .then(async resp => {
          const clone = resp.clone();
          const cache = await caches.open(CACHE_VERSION);
          await safePut(cache, req, clone);
          return resp;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 5. 其他本站静态资源 — Cache First
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;

        return fetch(req).then(async resp => {
          const clone = resp.clone();
          const cache = await caches.open(CACHE_VERSION);
          await safePut(cache, req, clone);
          return resp;
        });
      })
    );
    return;
  }

  // 6. 其他第三方资源默认放行，不缓存
  return;
});
