// URL do App Script e inicialização do mapa
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxB3aZOVBhGSebSvsrYDB7ShVAqMekg12a437riystZtTHmyUPMjbJd_GzLdw4cOs7k/exec";
if ('serviceWorker' in navigator) { /* ... código do service worker ... */ }
const map = L.map('map').setView([-23.1791, -45.8872], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
L.Routing.control({ /* ... opções de rota ... */ }).addTo(map);

// Variáveis globais
let quadrasLayer;
let statusData = {};

// --- Funções de Estilo e Popup (sem mudanças) ---
function getStyle(feature) {
    const id = feature.properties.id_quadra;
    const status = statusData[id] || 'Pendente';
    switch (status) {
        case 'Trabalhada': return { color: "#28a745", weight: 2, opacity: 0.8, fillOpacity: 0.5 };
        case 'Problema': return { color: "#dc3545", weight: 2, opacity: 0.8, fillOpacity: 0.5 };
        default: return { color: "#6c757d", weight: 1, opacity: 0.7, fillOpacity: 0.3 };
    }
}
function onEachFeature(feature, layer) { /* ... seu código onEachFeature ... */ }
window.marcarComo = function(novoStatus, id) { /* ... seu código marcarComo ... */ }


// --- NOVA LÓGICA DE CARREGAMENTO E GERAÇÃO DE MENU ---

// NOVO: Função para gerar o menu de áreas dinamicamente
function popularSeletorDeAreas() {
    const seletor = document.getElementById('area-selector');
    const totalDeAreas = 109; // ATENÇÃO: Altere este número se precisar

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
    if (quadrasLayer) {
        map.removeLayer(quadrasLayer);
    }
    const loadingPopup = L.popup({ closeButton: false, autoClose: false }).setLatLng(map.getCenter()).setContent(`Carregando dados da Área ${areaId}...`).openOn(map);

    try {
        // MODIFICADO: O caminho agora busca 'data/1.geojson', 'data/2.geojson', etc.
        const quadrasResponse = await fetch(`data/${areaId}.geojson?v=${new Date().getTime()}`);
        if (!quadrasResponse.ok) throw new Error(`Arquivo para a Área ${areaId} não encontrado.`);
        
        const quadrasGeoJSON = await quadrasResponse.json();
        map.closePopup(loadingPopup);

        quadrasLayer = L.geoJSON(quadrasGeoJSON, {
            style: getStyle,
            onEachFeature: onEachFeature
        }).addTo(map);

        if (quadrasLayer.getBounds().isValid()) {
            map.fitBounds(quadrasLayer.getBounds());
        }
    } catch (error) {
        console.error("Erro ao carregar a área:", error);
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

// NOVO: Função para iniciar a aplicação
function iniciarApp() {
    popularSeletorDeAreas();
    inicializarStatus();
}

// Inicia a aplicação
iniciarApp();
