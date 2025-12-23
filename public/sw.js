// MUDE AQUI: Sempre que fizer alterações no código, suba a versão (v3, v4, etc.)
const CACHE_NAME = 'firecheck-v3';

const urlsToCache = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/firebase-config.js',
  './manifest.json',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/lucide@latest',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js'
];

// 1. INSTALAÇÃO: Salva os arquivos no cache
self.addEventListener('install', event => {
  // Força o SW a ativar imediatamente, sem esperar o usuário fechar a aba
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache aberto');
        return cache.addAll(urlsToCache);
      })
  );
});

// 2. ATIVAÇÃO: Limpa caches antigos (IMPORTANTE!)
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];

  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            // Se o cache não for a versão atual (v3), apaga ele
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Garante que o SW controle a página imediatamente
  return self.clients.claim();
});

// 3. FETCH: Intercepta as requisições
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Estratégia "Cache First, Network Fallback"
        // Se estiver no cache, retorna rápido. Se não, busca na rede.
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});