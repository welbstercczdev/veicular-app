// service-worker.js

const CACHE_NAME = 'mapa-trabalho-app-v7'; // Incremente a versão
const MAP_CACHE_NAME = 'mapa-trabalho-tiles-v7';

const CORE_ASSETS = [
    './',
    './index.html',
    './gestor.html',
    './operador.html',
    './style.css',
    './gestor.js',
    './operador.js',
    'https://unpkg.com/leaflet@1.7.1/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.7.1/dist/leaflet.js'
];

self.addEventListener('install', event => {
    console.log('SW: Instalando...');
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS))
    );
});

self.addEventListener('activate', event => {
    console.log('SW: Ativando e limpando caches antigos...');
    event.waitUntil(clients.claim());
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME && cacheName !== MAP_CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});


self.addEventListener('fetch', event => {
    const requestUrl = new URL(event.request.url);

    // --- INÍCIO DA CORREÇÃO ---
    // Se a requisição for para a nossa API do Google, NÃO FAÇA NADA.
    // Deixe o navegador lidar com ela normalmente.
    if (requestUrl.hostname.includes('script.google.com')) {
        return; // Isso efetivamente ignora a requisição
    }
    // --- FIM DA CORREÇÃO ---


    // Estratégia para os tiles do mapa
    if (requestUrl.hostname.includes('tile.openstreetmap.org')) {
        event.respondWith(
            caches.match(event.request).then(cachedResponse => {
                // Se estiver no cache, retorna.
                if (cachedResponse) {
                    return cachedResponse;
                }
                // Senão, busca na rede, salva no cache e retorna.
                return fetch(event.request).then(networkResponse => {
                    return caches.open(MAP_CACHE_NAME).then(cache => {
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    });
                }).catch(error => {
                    // Falha graciosamente se estiver offline
                });
            })
        );
        return;
    }

    // Estratégia para os assets principais da aplicação
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            return cachedResponse || fetch(event.request);
        })
    );
});