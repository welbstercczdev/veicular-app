// URL do seu App Script implantado
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxB3aZOVBhGSebSvsrYDB7ShVAqMekg12a437riystZtTHmyUPMjbJd_GzLdw4cOs7k/exec";

// Registra o Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js')
        .then(reg => console.log('Service Worker registrado com sucesso!', reg))
        .catch(err => console.error('Erro ao registrar Service Worker:', err));
}

// Inicializa o mapa
const map = L.map('map').setView([-23.1791, -45.8872], 13); // Centralize em sua cidade

// Adiciona o mapa base (OpenStreetMap é gratuito)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// Adiciona o controle de rotas
L.Routing.control({
    waypoints: [], // Deixe vazio para o usuário adicionar
    routeWhileDragging: true,
    show: true,
    geocoder: L.Control.Geocoder.nominatim(), // Usa o Nominatim para buscar endereços
    lineOptions: {
        styles: [{color: 'blue', opacity: 0.8, weight: 5}]
    },
    router: L.Routing.osrmv1({
        serviceUrl: `https://router.project-osrm.org/route/v1`
    })
}).addTo(map);


let quadrasLayer;
let statusData = {};

// Função para definir a cor da quadra com base no status
function getStyle(feature) {
    const id = feature.properties.id_quadra;
    const status = statusData[id] || 'Pendente'; // Se não tiver status, é pendente

    switch (status) {
        case 'Trabalhada': return { color: "#28a745", weight: 2, opacity: 0.8, fillOpacity: 0.5 };
        case 'Problema': return { color: "#dc3545", weight: 2, opacity: 0.8, fillOpacity: 0.5 };
        default: return { color: "#6c757d", weight: 1, opacity: 0.7, fillOpacity: 0.3 };
    }
}

// Função para quando uma quadra é clicada
function onEachFeature(feature, layer) {
    const id = feature.properties.id_quadra;
    
    layer.on('click', function(e) {
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
    
    // 1. Atualiza o status localmente
    statusData[id] = novoStatus;
    
    // 2. Redesenha a camada de quadras para refletir a nova cor
    if (quadrasLayer) {
        quadrasLayer.setStyle(getStyle);
    }
    map.closePopup();

    // 3. Envia a atualização para o Google Sheets
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

// Carrega os dados e inicia a aplicação
async function inicializar() {
    try {
        const loadingPopup = L.popup({ closeButton: false, closeOnClick: false, autoClose: false })
            .setLatLng(map.getCenter())
            .setContent("Carregando dados das quadras...")
            .openOn(map);

        // 1. Busca os status da planilha
        const statusResponse = await fetch(`${SCRIPT_URL}?v=${new Date().getTime()}`);
        statusData = await statusResponse.json();

        // 2. Busca o arquivo GeoJSON das quadras
        const quadrasResponse = await fetch('quadras.geojson');
        const quadrasGeoJSON = await quadrasResponse.json();
        
        map.closePopup(loadingPopup);

        // 3. Adiciona as quadras ao mapa
        quadrasLayer = L.geoJSON(quadrasGeoJSON, {
            style: getStyle,
            onEachFeature: onEachFeature
        }).addTo(map);

        // Ajusta o zoom para mostrar todas as quadras
        if (quadrasLayer.getBounds().isValid()) {
            map.fitBounds(quadrasLayer.getBounds());
        }

    } catch (error) {
        console.error("Erro ao inicializar o mapa:", error);
        map.closePopup();
        alert("Não foi possível carregar os dados das quadras. Verifique sua conexão e se o arquivo 'quadras.geojson' existe.");
    }
}

inicializar();
