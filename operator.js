const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxB3aZOVBhGSebSvsrYDB7ShVAqMekg12a437riystZtTHmyUPMjbJd_GzLdw4cOs7k/exec";
const TOTAL_AREAS = 109;

const map = L.map('map').setView([-23.1791, -45.8872], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let quadrasLayer;
let activityStatus = {};
let currentActivityId = null;

function getQuadraId(feature) {
    if (feature.properties && feature.properties.title) {
        return parseInt(feature.properties.title.replace('QUADRA:', '').trim(), 10);
    }
    return null;
}

function getStyle(feature) {
    const id = getQuadraId(feature);
    if (!activityStatus[id]) return { color: '#000000', weight: 1 }; // Preto se não pertencer à atividade
    
    const status = activityStatus[id];
    switch (status) {
        case 'Trabalhada': return { color: "#28a745", weight: 2, fillOpacity: 0.6 }; // Verde
        default: return { color: "#dc3545", weight: 2, fillOpacity: 0.6 }; // Vermelho (Pendente)
    }
}

async function marcarComoTrabalhada(id) {
    activityStatus[id] = 'Trabalhada';
    quadrasLayer.setStyle(getStyle);
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
            activityStatus[id] = 'Pendente'; // Reverte em caso de erro
            quadrasLayer.setStyle(getStyle);
        }
    } catch(e) {
        alert("Erro de rede ao salvar status.");
        activityStatus[id] = 'Pendente'; // Reverte em caso de erro
        quadrasLayer.setStyle(getStyle);
    }
}

function onQuadraClick(e) {
    const layer = e.target;
    const id = getQuadraId(layer.feature);

    const popupContent = `
        <b>Quadra: ${id}</b><br>
        Status: ${activityStatus[id]}<br><br>
        <button onclick="marcarComoTrabalhada(${id})">Marcar como Trabalhada</button>
    `;
    L.popup().setLatLng(e.latlng).setContent(popupContent).openOn(map);
}

document.getElementById('load-activity').addEventListener('click', async () => {
    currentActivityId = document.getElementById('atividade-input').value;
    if (!currentActivityId) {
        alert("Por favor, insira o ID da atividade.");
        return;
    }

    if (quadrasLayer) map.removeLayer(quadrasLayer);

    // 1. Buscar o status das quadras para a atividade
    const response = await fetch(SCRIPT_URL, { 
        method: 'POST',
        body: JSON.stringify({ action: 'getActivity', id_atividade: currentActivityId })
    });
    const result = await response.json();
    if (!result.success) {
        alert(`Erro: ${result.message}`);
        return;
    }
    activityStatus = result.data;
    const quadrasDaAtividade = Object.keys(activityStatus);
    
    // 2. Carregar TODOS os geojsons e filtrar as quadras
    const allFeatures = [];
    for(let i = 1; i <= TOTAL_AREAS; i++) {
        const res = await fetch(`data/${i}.geojson`);
        const areaData = await res.json();
        const featuresFiltradas = areaData.features.filter(feature => {
            const id = getQuadraId(feature);
            return quadrasDaAtividade.includes(id.toString());
        });
        allFeatures.push(...featuresFiltradas);
    }

    const featureCollection = {
        type: "FeatureCollection",
        features: allFeatures
    };
    
    quadrasLayer = L.geoJSON(featureCollection, {
        style: getStyle,
        onEachFeature: onQuadraClick
    }).addTo(map);

    if (quadrasLayer.getBounds().isValid()) map.fitBounds(quadrasLayer.getBounds());
});
