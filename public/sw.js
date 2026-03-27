// MUDE AQUI: Suba a versão para forçar a atualização
const CACHE_NAME = 'firecheck-v1.3.6';

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

// 3. FETCH (Estratégia: Stale-While-Revalidate)
self.addEventListener('fetch', event => {
  // Ignora requisições de outras origens (como APIs do Firebase e Cloudinary)
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    // ignoreSearch: true garante que URLs com ?id=123 funcionem offline pegando o index.html
    caches.match(event.request, { ignoreSearch: true }).then(cachedResponse => {

      const fetchPromise = fetch(event.request).then(networkResponse => {
        // Atualiza o cache silenciosamente com a versão mais nova
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch((err) => {
        console.log("Modo Offline ativado", err);
      });

      // Retorna o cache IMEDIATAMENTE se existir. Se não, espera a rede.
      return cachedResponse || fetchPromise;
    })
  );
});