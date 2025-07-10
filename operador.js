const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxB3aZOVBhGSebSvsrYDB7ShVAqMekg12a437riystZtTHmyUPMjbJd_GzLdw4cOs7k/exec";

// Inicializa o mapa
const map = L.map('map').setView([-23.1791, -45.8872], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// Variáveis globais
let quadrasLayer;
let activityStatus = {};
let currentActivityId = null;

function getQuadraId(feature) {
    if (feature.properties && feature.properties.title) {
        try {
            return parseInt(feature.properties.title.replace('QUADRA:', '').trim(), 10);
        } catch (e) {
            console.error("Erro ao extrair ID da quadra:", feature.properties.title);
            return null;
        }
    }
    return null;
}

function getStyle(feature) {
    const id = getQuadraId(feature);
    if (!activityStatus[id]) return { opacity: 0, fillOpacity: 0 };
    
    const status = activityStatus[id];
    switch (status) {
        case 'Trabalhada': return { color: "#28a745", weight: 2, fillOpacity: 0.6 };
        default: return { color: "#dc3545", weight: 2, fillOpacity: 0.6 };
    }
}

window.marcarComoTrabalhada = async function(id) {
    activityStatus[id] = 'Trabalhada';
    if (quadrasLayer) quadrasLayer.setStyle(getStyle);
    map.closePopup();

    const payload = {
        action: 'updateStatus',
        id_atividade: currentActivityId,
        id_quadra: id,
        status: 'Trabalhada'
    };

    try {
        const response = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
        const result = await response.json();
        if (result.success) {
            console.log(result.message);
        } else {
            alert(`Erro ao salvar: ${result.message}`);
            activityStatus[id] = 'Pendente';
            if (quadrasLayer) quadrasLayer.setStyle(getStyle);
        }
    } catch(e) {
        alert("Erro de rede. A alteração não foi salva.");
        activityStatus[id] = 'Pendente';
        if (quadrasLayer) quadrasLayer.setStyle(getStyle);
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
    currentActivityId = document.getElementById('atividade-input').value.trim();
    if (!currentActivityId) {
        alert("Por favor, insira o ID da atividade.");
        return;
    }

    if (quadrasLayer) map.removeLayer(quadrasLayer);
    
    const loadingMessage = document.createElement('div');
    loadingMessage.innerText = "Buscando dados da atividade...";
    loadingMessage.style = "padding:10px; background:white; border-radius:5px;";
    const loadingPopup = L.popup({ closeButton: false, autoClose: false })
      .setLatLng(map.getCenter()).setContent(loadingMessage).openOn(map);

    try {
        // CORREÇÃO: Usando GET e passando parâmetros na URL
        const url = new URL(SCRIPT_URL);
        url.searchParams.append('action', 'getActivity');
        url.searchParams.append('id_atividade', currentActivityId);

        const response = await fetch(url, { method: 'GET' });
        const result = await response.json();

        if (!result.success) throw new Error(result.message);
        
        activityStatus = result.data.quadras;
        const areasParaCarregar = result.data.areas;
        const quadrasDaAtividade = Object.keys(activityStatus);
        
        if (areasParaCarregar.length === 0) {
            alert("Nenhuma quadra encontrada para esta atividade.");
            map.closePopup(loadingPopup);
            return;
        }

        loadingMessage.innerText = `Carregando mapa para as áreas: ${areasParaCarregar.join(', ')}...`;
        const allFeatures = [];
        
        for (const areaId of areasParaCarregar) {
            try {
                const res = await fetch(`data/${areaId}.geojson?v=${new Date().getTime()}`);
                if (!res.ok) {
                    console.warn(`Arquivo da Área ${areaId} não encontrado, pulando.`);
                    continue;
                }
                const areaData = await res.json();
                const featuresFiltradas = areaData.features.filter(feature => {
                    const id = getQuadraId(feature);
                    return quadrasDaAtividade.includes(id.toString()); 
                });
                allFeatures.push(...featuresFiltradas);
            } catch(e) {
                console.error(`Erro ao processar Área ${areaId}:`, e);
            }
        }

        map.closePopup(loadingPopup);

        if(allFeatures.length === 0) {
            alert("As quadras desta atividade não foram encontradas nos arquivos de mapa.");
            return;
        }

        const featureCollection = { type: "FeatureCollection", features: allFeatures };
        quadrasLayer = L.geoJSON(featureCollection, { style: getStyle, onEachFeature: onEachFeature }).addTo(map);
        if (quadrasLayer.getBounds().isValid()) map.fitBounds(quadrasLayer.getBounds());

    } catch(error) {
        map.closePopup(loadingPopup);
        alert(`Falha ao carregar atividade: ${error.message}`);
        console.error("Erro ao carregar atividade:", error);
    }
}

document.getElementById('load-activity').addEventListener('click', carregarAtividade);
