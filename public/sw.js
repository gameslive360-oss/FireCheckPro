// MUDE AQUI: Suba a versão para forçar a atualização
const CACHE_NAME = 'firecheck-v11'; // Mudei para v5

const urlsToCache = [
  './',
  './index.html',
  './css/style.css',
  './css/tailwind.css',
  './js/app.js', // O navegador vai baixar este arquivo novamente
  './js/phrases.js', // Incluímos o novo arquivo de frases
  './js/firebase-config.js',
  './js/pdf-generator.js',
  './js/image-compressor.js',
  './manifest.json',
  './js/vendor/jspdf.umd.min.js',
  './js/vendor/jspdf.plugin.autotable.min.js',
  './js/vendor/lucide.min.js',
  './js/signature-pad.js',
];

// 1. INSTALAÇÃO
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

// 2. ATIVAÇÃO (Limpa caches antigos)
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// 3. FETCH
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});