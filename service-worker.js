// ====================================================================
// CORREÇÃO
// PARTE 1: CONFIGURAÇÕES GLOBAIS E ASSETS PRINCIPAIS
// ====================================================================

// Versão do cache incrementada para forçar a instalação do novo Service Worker.
const CACHE_NAME = 'mapa-trabalho-app-v11'; 

// Lista de arquivos essenciais para a aplicação funcionar offline.
// Os tiles do mapa foram intencionalmente removidos desta lógica.
const CORE_ASSETS = [
    './',
    './index.html',
    './gestor.html',
    './operador.html',
    './style.css',
    './login-style.css',
    './gestor.js',
    './operador.js',
    'https://unpkg.com/leaflet@1.7.1/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.7.1/dist/leaflet.js',
    'https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.min.css',
    'https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.all.min.js'
];
// ====================================================================
// PARTE 2: EVENTO DE INSTALAÇÃO (install)
// ====================================================================

// Salva os assets principais da aplicação em cache.
self.addEventListener('install', event => {
    console.log('SW: Instalando nova versão do Service Worker (v11)...');
    self.skipWaiting(); // Força o novo SW a se tornar ativo imediatamente.
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('SW: Salvando assets principais em cache.');
            return cache.addAll(CORE_ASSETS);
        })
    );
});
// ====================================================================
// PARTE 3: EVENTO DE ATIVAÇÃO (activate)
// ====================================================================

// Limpa todos os caches antigos para liberar espaço.
self.addEventListener('activate', event => {
    console.log('SW: Ativando e limpando caches antigos...');
    event.waitUntil(clients.claim()); // Torna o SW o controlador da página imediatamente.
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    // Deleta qualquer cache que não seja o cache principal atual.
                    // Isso garantirá que o antigo 'mapa-trabalho-tiles-vX' seja removido.
                    if (cacheName !== CACHE_NAME) {
                        console.log('SW: Deletando cache antigo:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});
// ====================================================================
// PARTE 4: EVENTO DE BUSCA (fetch)
// ====================================================================

// Intercepta requisições de rede.
self.addEventListener('fetch', event => {
    const requestUrl = new URL(event.request.url);

    // 1. Ignora completamente as requisições para a API do Google Script.
    // Elas NUNCA devem ser cacheadas.
    if (requestUrl.hostname.includes('script.google.com')) {
        return; 
    }

    // 2. CORREÇÃO: Ignora completamente as requisições para os tiles do mapa.
    // Isso impede que o cache de tiles cresça e cause o erro 'QuotaExceededError'.
    // A consequência é que os mapas não funcionarão offline.
    if (requestUrl.hostname.includes('tile.openstreetmap.org')) {
        return;
    }

    // 3. Estratégia para todos os outros assets: Cache primeiro (Cache First).
    // Se o recurso estiver no cache, serve a partir dele. Senão, busca na rede.
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            return cachedResponse || fetch(event.request);
        })
    );
});
