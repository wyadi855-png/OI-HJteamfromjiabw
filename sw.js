// HJOI Service Worker — PWA 离线缓存
// 版本号：每次部署时更新，会触发旧缓存清理
const CACHE_VERSION = 'hjoi-v1';

// 立即缓存的静态资源（壳资源，不含 API 数据）
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  // 字体（CDN）会单独走 network-first 策略
];

// 永远走网络的域名（Supabase API / Railway 后端）
const NETWORK_ONLY_HOSTS = [
  'supabase.co',
  'railway.app',
  'supabase.com',
];

// ── Install：预缓存壳资源 ──────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => {
      return cache.addAll(PRECACHE).catch(err => {
        // 某个资源失败不阻断安装
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
  const url = new URL(event.request.url);

  // 1. API 请求 — 永远走网络，不缓存
  if (NETWORK_ONLY_HOSTS.some(h => url.hostname.includes(h))) {
    return; // 不拦截，直接走浏览器默认
  }

  // 2. POST / 非 GET — 不缓存
  if (event.request.method !== 'GET') return;

  // 3. 字体 / CDN 静态资源 — Cache First（有缓存用缓存，没有才请求网络）
  const isCDN = url.hostname.includes('googleapis.com')
    || url.hostname.includes('gstatic.com')
    || url.hostname.includes('jsdelivr.net')
    || url.hostname.includes('cdnjs.cloudflare.com')
    || url.hostname.includes('katex');

  if (isCDN) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(resp => {
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE_VERSION).then(c => c.put(event.request, clone));
          }
          return resp;
        }).catch(() => cached); // 离线时返回旧缓存
      })
    );
    return;
  }

  // 4. 主 HTML — Network First（优先最新内容，离线降级到缓存）
  if (url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE_VERSION).then(c => c.put(event.request, clone));
          }
          return resp;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 5. 其他本站资源 — Cache First
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(resp => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_VERSION).then(c => c.put(event.request, clone));
        }
        return resp;
      });
    })
  );
});
