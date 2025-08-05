// service-worker.js

// Versão do cache incrementada para forçar a atualização definitiva
const CACHE_NAME = 'mapa-trabalho-app-v10'; 
const MAP_CACHE_NAME = 'mapa-trabalho-tiles-v10';

// Lista de arquivos essenciais para a aplicação funcionar offline.
const CORE_ASSETS = [
    './',
    './index.html',
    './gestor.html',
    './operador.html',
    './style.css',
    './login-style.css',
    './gestor.js',
    './operador.js',
    './icon-192.png',
    './icon-512.png',
    
    // ** A CORREÇÃO CRÍTICA ESTÁ AQUI **
    // O manifesto PRECISA ser cacheado para que o critério de instalação do PWA seja cumprido.
    './manifest.json',

    // Arquivos de bibliotecas externas
    'https://unpkg.com/leaflet@1.7.1/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.7.1/dist/leaflet.js',
    'https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.min.css',
    'https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.all.min.js',
    'https://unpkg.com/@turf/turf@6/turf.min.js'
];

// Evento de Instalação: Salva os CORE_ASSETS em cache.
self.addEventListener('install', event => {
    console.log('SW: Instalando nova versão v10...');
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('SW: Salvando assets principais em cache, incluindo o manifest.json.');
            return cache.addAll(CORE_ASSETS);
        })
    );
});

// Evento de Ativação: Limpa caches antigos.
self.addEventListener('activate', event => {
    console.log('SW: Ativando v10 e limpando caches antigos...');
    event.waitUntil(clients.claim());
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME && cacheName !== MAP_CACHE_NAME) {
                        console.log('SW: Deletando cache antigo:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// Evento de Fetch: Intercepta requisições de rede.
self.addEventListener('fetch', event => {
    const requestUrl = new URL(event.request.url);

    // 1. Ignora requisições para a API do Google Script.
    if (requestUrl.hostname.includes('script.google.com')) {
        return; 
    }

    // 2. Estratégia para os tiles do mapa: Cache, depois rede.
    if (requestUrl.hostname.includes('tile.openstreetmap.org')) {
        event.respondWith(
            caches.open(MAP_CACHE_NAME).then(cache => {
                return cache.match(event.request).then(cachedResponse => {
                    const fetchPromise = fetch(event.request).then(networkResponse => {
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    });
                    return cachedResponse || fetchPromise;
                });
            })
        );
        return;
    }

    // 3. Estratégia para todos os outros assets: Cache primeiro.
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            return cachedResponse || fetch(event.request);
        })
    );
});
