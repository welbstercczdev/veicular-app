const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxB3aZOVBhGSebSvsrYDB7ShVAqMekg12a437riystZtTHmyUPMjbJd_GzLdw4cOs7k/exec";

const map = L.map('map').setView([-23.1791, -45.8872], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let quadrasLayer;
let activityStatus = {};
let currentActivityId = null;

function getQuadraId(feature) { /* ... */ }
function getStyle(feature) { /* ... */ }
window.marcarComoTrabalhada = function(id) { /* ... */ } // Use a função da sua última versão

// ... Coloque aqui as funções getQuadraId, getStyle, marcarComoTrabalhada da sua versão anterior ...

document.getElementById('load-activity').addEventListener('click', async () => {
    currentActivityId = document.getElementById('atividade-input').value;
    if (!currentActivityId) {
        alert("Por favor, insira o ID da atividade.");
        return;
    }

    if (quadrasLayer) map.removeLayer(quadrasLayer);

    const response = await fetch(SCRIPT_URL, { 
        method: 'POST',
        body: JSON.stringify({ action: 'getActivity', id_atividade: currentActivityId })
    });
    const result = await response.json();
    if (!result.success) {
        alert(`Erro: ${result.message}`);
        return;
    }
    
    // Agora `result.data` tem dois campos: `quadras` e `areas`
    activityStatus = result.data.quadras;
    const areasParaCarregar = result.data.areas; // Array de IDs de área, ex: ["1", "5", "22"]
    const quadrasDaAtividade = Object.keys(activityStatus);
    
    if (areasParaCarregar.length === 0) {
        alert("Nenhuma área encontrada para esta atividade.");
        return;
    }

    const allFeatures = [];
    // MODIFICADO: O loop agora itera apenas sobre as áreas necessárias
    for (const areaId of areasParaCarregar) {
        try {
            const res = await fetch(`data/${areaId}.geojson`);
            if(!res.ok) {
                console.warn(`Arquivo da Área ${areaId} não encontrado, pulando.`);
                continue; // Pula para a próxima área
            }
            const areaData = await res.json();
            const featuresFiltradas = areaData.features.filter(feature => {
                const id = getQuadraId(feature);
                return quadrasDaAtividade.includes(id.toString()); 
            });
            allFeatures.push(...featuresFiltradas);
        } catch(e) {
            console.error(`Erro ao carregar Área ${areaId}:`, e);
        }
    }

    const featureCollection = { type: "FeatureCollection", features: allFeatures };
    
    quadrasLayer = L.geoJSON(featureCollection, { style: getStyle, onEachFeature: onEachFeature }).addTo(map);

    if (quadrasLayer.getBounds().isValid()) {
        map.fitBounds(quadrasLayer.getBounds());
    } else {
        alert("Nenhuma das quadras atribuídas foi encontrada nos arquivos de mapa. Verifique se os arquivos de dados estão corretos.");
    }
});

// ... Adicione as outras funções (onEachFeature, etc) aqui ...
