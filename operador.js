const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxB3aZOVBhGSebSvsrYDB7ShVAqMekg12a437riystZtTHmyUPMjbJd_GzLdw4cOs7k/exec";

// Inicialização do mapa
const map = L.map('map').setView([-23.1791, -45.8872], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// Variáveis globais
let quadrasLayer;
let activityStatus = {};
let currentActivityId = null;

// Funções de lógica do mapa
function getQuadraId(feature) {
    if (feature.properties && feature.properties.title) {
        try {
            const idString = feature.properties.title.replace('QUADRA:', '').trim();
            return parseInt(idString, 10);
        } catch (e) {
            console.error("Erro ao extrair ID da quadra:", feature.properties.title, e);
            return null;
        }
    }
    return null;
}

function getStyle(feature) {
    const id = getQuadraId(feature);
    if (!activityStatus[id]) {
        return { opacity: 0, fillOpacity: 0 };
    }
    
    const status = activityStatus[id];
    switch (status) {
        case 'Trabalhada':
            return { color: "#28a745", weight: 2, fillOpacity: 0.6 }; // Verde
        default:
            return { color: "#dc3545", weight: 2, fillOpacity: 0.6 }; // Vermelho (Pendente)
    }
}

window.marcarComoTrabalhada = async function(id) {
    activityStatus[id] = 'Trabalhada';
    if (quadrasLayer) quadrasLayer.setStyle(getStyle);
    map.closePopup();

    const payload = { action: 'updateStatus', id_atividade: currentActivityId, id_quadra: id, status: 'Trabalhada' };

    try {
        await fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) });
        console.log(`Atualização da quadra ${id} enviada.`);
    } catch(e) {
        alert("Erro de rede ao salvar status. A mudança pode não ter sido registrada.");
    }
}

function onEachFeature(feature, layer) {
    const id = getQuadraId(feature);
    if (id !== null && activityStatus[id]) {
        layer.on('click', function(e) {
            const popupContent = `<b>Quadra: ${id}</b><br>Status: ${activityStatus[id]}<br><br><button onclick="marcarComoTrabalhada(${id})">Marcar como Trabalhada</button>`;
            L.popup().setLatLng(e.latlng).setContent(popupContent).openOn(map);
        });
    }
}

async function carregarAtividade() {
    currentActivityId = document.getElementById('atividade-select').value;
    if (!currentActivityId) {
        if (quadrasLayer) map.removeLayer(quadrasLayer);
        return;
    }
    
    if (quadrasLayer) map.removeLayer(quadrasLayer);
    const loadingPopup = L.popup({ closeButton: false, autoClose: false }).setLatLng(map.getCenter()).setContent(`Carregando atividade ${currentActivityId}...`).openOn(map);

    try {
        const url = new URL(SCRIPT_URL);
        url.searchParams.append('action', 'getActivity');
        url.searchParams.append('id_atividade', currentActivityId);
        
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Erro de rede: ${response.statusText}`);
        
        const result = await response.json();
        if (!result.success) throw new Error(result.message);
        
        activityStatus = result.data.quadras;
        const areasParaCarregar = result.data.areas;
        
        if (areasParaCarregar.length === 0) {
            alert("Nenhuma quadra encontrada para esta atividade.");
            map.closePopup(loadingPopup);
            return;
        }

        const allFeatures = [];
        for (const areaId of areasParaCarregar) {
            try {
                const res = await fetch(`data/${areaId}.geojson?v=${new Date().getTime()}`);
                if (!res.ok) { console.warn(`Arquivo da Área ${areaId} não encontrado.`); continue; }
                const areaData = await res.json();
                const featuresFiltradas = areaData.features.filter(f => Object.keys(activityStatus).includes(getQuadraId(f)?.toString()));
                allFeatures.push(...featuresFiltradas);
            } catch(e) { console.error(`Erro ao processar Área ${areaId}:`, e); }
        }

        map.closePopup(loadingPopup);
        if(allFeatures.length === 0) {
            alert("As quadras desta atividade não foram encontradas nos arquivos de mapa.");
            return;
        }

        const featureCollection = { type: "FeatureCollection", features: allFeatures };
        quadrasLayer = L.geoJSON(featureCollection, { style: getStyle, onEachFeature: onEachFeature }).addTo(map);

        if (quadrasLayer.getBounds().isValid()) {
            map.fitBounds(quadrasLayer.getBounds());
        }

    } catch(error) {
        map.closePopup(loadingPopup);
        alert(`Falha ao carregar atividade: ${error.message}`);
    }
}

async function popularAtividadesPendentes() {
    const seletor = document.getElementById('atividade-select');
    
    try {
        const url = new URL(SCRIPT_URL);
        url.searchParams.append('action', 'getPendingActivities');

        const response = await fetch(url);
        if (!response.ok) throw new Error(`Erro de rede ao buscar atividades: ${response.statusText}`);
        
        const result = await response.json();
        if (!result.success) throw new Error(result.message);

        seletor.innerHTML = '<option value="">Selecione uma atividade...</option>';

        if (result.data.length === 0) {
            const option = document.createElement('option');
            option.textContent = "Nenhuma atividade pendente";
            option.disabled = true;
            seletor.appendChild(option);
        } else {
            result.data.forEach(activityId => {
                const option = document.createElement('option');
                option.value = activityId;
                option.textContent = `Atividade ${activityId}`;
                seletor.appendChild(option);
            });
        }
    } catch(error) {
        seletor.innerHTML = '<option value="">Erro ao carregar</option>';
        alert("Não foi possível buscar a lista de atividades: " + error.message);
    }
}

// CORREÇÃO: Garante que o script só vai rodar depois que todo o HTML for carregado
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('atividade-select').addEventListener('change', carregarAtividade);
    popularAtividadesPendentes();
});
