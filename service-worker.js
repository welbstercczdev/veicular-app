// Versão do cache incrementada para forçar a atualização
const CACHE_NAME = 'mapa-trabalho-app-v9'; 
const MAP_CACHE_NAME = 'mapa-trabalho-tiles-v9';

// Lista de arquivos essenciais para a aplicação funcionar offline.
// Esta lista foi CORRIGIDA para refletir os arquivos que realmente existem.
const CORE_ASSETS = [
    './', // A raiz da aplicação
    './index.html',
    './gestor.html',
    './operador.html',
    './style.css',
    './login-style.css', // ADICIONADO: O novo CSS da tela de login
    './gestor.js',
    './operador.js',
    // REMOVIDO: './login.js', que não existe.
    'https://unpkg.com/leaflet@1.7.1/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.7.1/dist/leaflet.js',
    'https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.min.css',
    'https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.all.min.js'
];

// Evento de Instalação: Salva os CORE_ASSETS em cache.
self.addEventListener('install', event => {
    console.log('SW: Instalando nova versão do Service Worker...');
    self.skipWaiting(); // Força o novo SW a se tornar ativo mais rapidamente.
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('SW: Salvando assets principais em cache.');
            return cache.addAll(CORE_ASSETS);
        })
    );
});

// Evento de Ativação: Limpa caches antigos.
self.addEventListener('activate', event => {
    console.log('SW: Ativando e limpando caches antigos...');
    event.waitUntil(clients.claim()); // Torna o SW o controlador da página imediatamente.
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    // Deleta qualquer cache que não seja o atual
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

    // 1. Ignora completamente as requisições para a API do Google Script.
    // Elas NUNCA devem ser cacheadas.
    if (requestUrl.hostname.includes('script.google.com')) {
        return; 
    }

    // 2. Estratégia para os tiles do mapa: Cache, depois rede (Stale-While-Revalidate)
    if (requestUrl.hostname.includes('tile.openstreetmap.org')) {
        event.respondWith(
            caches.open(MAP_CACHE_NAME).then(cache => {
                return cache.match(event.request).then(cachedResponse => {
                    const fetchPromise = fetch(event.request).then(networkResponse => {
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    });
                    // Retorna do cache se existir, mas sempre busca uma nova versão em segundo plano.
                    return cachedResponse || fetchPromise;
                });
            })
        );
        return;
    }

    // 3. Estratégia para todos os outros assets: Cache primeiro (Cache First)
    // Ideal para arquivos que não mudam com frequência (CSS, JS, HTML principal).
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            return cachedResponse || fetch(event.request);
        })
    );
});