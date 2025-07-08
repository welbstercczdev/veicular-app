// URL do seu App Script implantado
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxB3aZOVBhGSebSvsrYDB7ShVAqMekg12a437riystZtTHmyUPMjbJd_GzLdw4cOs7k/exec";

// Registra o Service Worker (para PWA)
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
        .then(reg => console.log('Service Worker registrado com sucesso!', reg))
        .catch(err => console.error('Erro ao registrar Service Worker:', err));
}

// Inicializa o mapa e o mapa base (OpenStreetMap)
const map = L.map('map').setView([-23.1791, -45.8872], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// Adiciona o controle de rotas
L.Routing.control({
    waypoints: [],
    routeWhileDragging: true,
    show: true,
    geocoder: L.Control.Geocoder.nominatim(),
    router: L.Routing.osrmv1({ serviceUrl: `https://router.project-osrm.org/route/v1` })
}).addTo(map);

// Variáveis globais
let quadrasLayer;
let statusData = {};

// Função para definir a cor da quadra com base no status
function getStyle(feature) {
    const id = feature.properties.id_quadra;
    const status = statusData[id] || 'Pendente';
    switch (status) {
        case 'Trabalhada': return { color: "#28a745", weight: 2, opacity: 0.8, fillOpacity: 0.5 };
        case 'Problema': return { color: "#dc3545", weight: 2, opacity: 0.8, fillOpacity: 0.5 };
        default: return { color: "#6c757d", weight: 1, opacity: 0.7, fillOpacity: 0.3 };
    }
}

// Função para quando uma quadra é clicada - COM DIAGNÓSTICO
function onEachFeature(feature, layer) {
    // PISTA 1: Verifica se esta função está sendo chamada para cada quadra
    console.log("Anexando evento para a quadra:", feature.properties.id_quadra);

    // Garante que temos um ID antes de prosseguir
    if (!feature.properties || !feature.properties.id_quadra) {
        console.error("ERRO: Uma das quadras no GeoJSON está sem a propriedade 'id_quadra'.", feature);
        return; // Pula esta quadra para não quebrar o resto
    }

    const id = feature.properties.id_quadra;
    
    layer.on('click', function(e) {
        // PISTA 2: Verifica se o evento de clique está sendo disparado
        console.log("CLIQUE DETECTADO! Quadra ID:", id);

        const popupContent = `
            <b>Quadra: ${id}</b><br>
            Status atual: ${statusData[id] || 'Pendente'}<br><br>
            <button onclick="marcarComo('Trabalhada', ${id})">Marcar como Trabalhada</button>
            <button onclick="marcarComo('Problema', ${id})">Marcar com Problema</button>
        `;
        L.popup()
            .setLatLng(e.latlng)
            .setContent(popupContent)
            .openOn(map);
    });
}

// Função global para ser chamada pelos botões do popup
window.marcarComo = function(novoStatus, id) {
    console.log(`Marcando quadra ${id} como ${novoStatus}`);
    statusData[id] = novoStatus;
    if (quadrasLayer) {
        quadrasLayer.setStyle(getStyle);
    }
    map.closePopup();

    fetch(SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ id_quadra: id, status: novoStatus, usuario: 'user_app' }),
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            console.log("Status salvo com sucesso!", data.message);
        } else {
            console.error("Erro ao salvar status:", data.message);
            alert("Erro ao salvar. Verifique sua conexão.");
        }
    })
    .catch(error => {
        console.error('Erro de rede ao salvar:', error);
        alert("Erro de rede ao salvar. A alteração será perdida.");
    });
}

// Função para gerar o menu de áreas dinamicamente
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

// Adiciona um "ouvinte" para o seletor de área
document.getElementById('area-selector').addEventListener('change', function(e) {
    const areaId = e.target.value;
    if (areaId) {
        carregarArea(areaId);
    }
});

// Função principal para carregar os dados de uma área específica
async function carregarArea(areaId) {
    if (quadrasLayer) map.removeLayer(quadrasLayer);
    const loadingPopup = L.popup({ closeButton: false, autoClose: false }).setLatLng(map.getCenter()).setContent(`Carregando dados da Área ${areaId}...`).openOn(map);

    try {
        const quadrasResponse = await fetch(`data/${areaId}.geojson?v=${new Date().getTime()}`);
        if (!quadrasResponse.ok) throw new Error(`Arquivo data/${areaId}.geojson não encontrado (erro 404).`);
        
        const quadrasGeoJSON = await quadrasResponse.json();
        console.log(`GeoJSON da Área ${areaId} carregado com sucesso.`, quadrasGeoJSON);
        map.closePopup(loadingPopup);

        quadrasLayer = L.geoJSON(quadrasGeoJSON, {
            style: getStyle,
            onEachFeature: onEachFeature // Esta linha é crucial para o clique funcionar
        }).addTo(map);

        if (quadrasLayer.getBounds().isValid()) {
            map.fitBounds(quadrasLayer.getBounds());
        }
    } catch (error) {
        console.error("Erro CRÍTICO ao carregar a área:", error);
        map.closePopup(loadingPopup);
        alert(`Não foi possível carregar os dados da área: ${error.message}`);
    }
}

// Função que roda uma única vez no início para carregar os status
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

// Função para iniciar a aplicação
function iniciarApp() {
    popularSeletorDeAreas();
    inicializarStatus();
}

// Inicia a aplicação
iniciarApp();
