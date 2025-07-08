// URL do seu App Script implantado
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxB3aZOVBhGSebSvsrYDB7ShVAqMekg12a437riystZtTHmyUPMjbJd_GzLdw4cOs7k/exec";

// Registra o Service Worker (para PWA)
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js')
        .then(reg => console.log('Service Worker registrado com sucesso!', reg))
        .catch(err => console.error('Erro ao registrar Service Worker:', err));
}

// Inicializa o mapa
const map = L.map('map').setView([-23.1791, -45.8872], 13);

// Adiciona o mapa base
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// Adiciona o controle de rotas com Geocoder configurado
L.Routing.control({
    waypoints: [],
    routeWhileDragging: true,
    show: true,
    geocoder: L.Control.Geocoder.nominatim({
        geocodingQueryParams: {
            "addressdetails": 1,
            "format": "json"
        }
    }),
    router: L.Routing.osrmv1({
        serviceUrl: `https://router.project-osrm.org/route/v1`
    })
}).addTo(map);

// Variáveis globais
let quadrasLayer;
let statusData = {};

function getQuadraId(feature) {
    if (feature.properties && feature.properties.title) {
        try {
            const idString = feature.properties.title.replace('QUADRA:', '').trim();
            return parseInt(idString, 10);
        } catch (e) {
            console.error("Erro ao extrair ID de:", feature.properties.title);
            return null;
        }
    }
    return null;
}

function getStyle(feature) {
    const id = getQuadraId(feature);
    if (id === null) return { color: "#ff00ff", weight: 2 };
    const status = statusData[id] || 'Pendente';
    switch (status) {
        case 'Trabalhada': return { color: "#28a745", weight: 2, opacity: 0.8, fillOpacity: 0.5 };
        case 'Problema': return { color: "#dc3545", weight: 2, opacity: 0.8, fillOpacity: 0.5 };
        default: return { color: "#6c757d", weight: 1, opacity: 0.7, fillOpacity: 0.3 };
    }
}

function onEachFeature(feature, layer) {
    const id = getQuadraId(feature);
    if (id === null) {
        console.error("Quadra sem ID válido, clique desativado:", feature.properties);
        return;
    }
    layer.on('click', function(e) {
        const popupContent = `<b>Quadra: ${id}</b><br>Status atual: ${statusData[id] || 'Pendente'}<br><br><button onclick="marcarComo('Trabalhada', ${id})">Marcar como Trabalhada</button><button onclick="marcarComo('Problema', ${id})">Marcar com Problema</button>`;
        L.popup().setLatLng(e.latlng).setContent(popupContent).openOn(map);
    });
}

window.marcarComo = function(novoStatus, id) {
    console.log(`Marcando quadra ${id} como ${novoStatus}`);
    statusData[id] = novoStatus;
    if (quadrasLayer) quadrasLayer.setStyle(getStyle);
    map.closePopup();

    fetch(SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ id_quadra: id, status: novoStatus, usuario: 'user_app' }),
    })
    .then(response => response.json())
    .then(data => {
        if(data.success) console.log("Status salvo com sucesso!");
        else {
            console.error("Erro ao salvar status:", data.message);
            alert("Erro ao salvar. Verifique sua conexão.");
        }
    })
    .catch(error => {
        console.error('Erro de rede ao salvar:', error);
        alert("Erro de rede ao salvar.");
    });
}

function popularSeletorDeAreas() {
    const seletor = document.getElementById('area-selector');
    const totalDeAreas = 109;
    for (let i = 1; i <= totalDeAreas; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `Área ${i}`;
        seletor.appendChild(option);
    }
}

document.getElementById('area-selector').addEventListener('change', e => {
    const areaId = e.target.value;
    if (areaId) carregarArea(areaId);
});

async function carregarArea(areaId) {
    if (quadrasLayer) map.removeLayer(quadrasLayer);
    const loadingPopup = L.popup({ closeButton: false, autoClose: false }).setLatLng(map.getCenter()).setContent(`Carregando Área ${areaId}...`).openOn(map);

    try {
        const quadrasResponse = await fetch(`data/${areaId}.geojson?v=${new Date().getTime()}`);
        if (!quadrasResponse.ok) throw new Error(`Arquivo data/${areaId}.geojson não encontrado.`);
        const quadrasGeoJSON = await quadrasResponse.json();
        map.closePopup(loadingPopup);
        quadrasLayer = L.geoJSON(quadrasGeoJSON, { style: getStyle, onEachFeature: onEachFeature }).addTo(map);
        if (quadrasLayer.getBounds().isValid()) map.fitBounds(quadrasLayer.getBounds());
    } catch (error) {
        console.error("Erro ao carregar a área:", error);
        map.closePopup(loadingPopup);
        alert(`Erro ao carregar dados: ${error.message}`);
    }
}

async function inicializarStatus() {
    try {
        const statusResponse = await fetch(`${SCRIPT_URL}?v=${new Date().getTime()}`);
        statusData = await statusResponse.json();
        console.log("Status de todas as quadras carregados com sucesso.");
    } catch (error) {
        console.error("Erro ao carregar os status da planilha:", error);
        alert("Não foi possível conectar ao banco de dados de status.");
    }
}

function iniciarApp() {
    popularSeletorDeAreas();
    inicializarStatus();
}

iniciarApp();
