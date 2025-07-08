// ATENÇÃO: Substitua 'veicular-app' pelo nome EXATO do seu repositório no GitHub.
const REPO_NAME = 'veicular-app'; 
const CACHE_NAME = 'mapa-trabalho-v2'; // Mudei a versão para forçar a atualização do cache

const urlsToCache = [
    `/${REPO_NAME}/`,
    `/${REPO_NAME}/index.html`,
    `/${REPO_NAME}/style.css`,
    `/${REPO_NAME}/app.js`,
    // Os caminhos para os plugins e dados externos continuam os mesmos
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/leaflet-routing-machine@latest/dist/leaflet-routing-machine.css',
    'https://unpkg.com/leaflet-control-geocoder/dist/Control.Geocoder.css',
    'https://unpkg.com/leaflet-routing-machine@latest/dist/leaflet-routing-machine.js',
    'https://unpkg.com/leaflet-control-geocoder/dist/Control.Geocoder.js'
    // IMPORTANTE: Não vamos cachear os arquivos de dados (geojson) por enquanto
    // para simplificar. O usuário precisará de conexão para carregar uma nova área.
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Cache aberto, adicionando URLs principais.');
                return cache.addAll(urlsToCache);
            })
            .catch(error => {
                console.error('Falha ao adicionar arquivos ao cache:', error);
            })
    );
});

// Limpa caches antigos
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
});


self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Se encontrar no cache, retorna. Senão, busca na rede.
                return response || fetch(event.request);
            })
    );
});
