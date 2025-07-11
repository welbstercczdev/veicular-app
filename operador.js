const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxB3aZOVBhGSebSvsrYDB7ShVAqMekg12a437riystZtTHmyUPMjbJd_GzLdw4cOs7k/exec";

// Inicialização do mapa
const map = L.map('map').setView([-23.1791, -45.8872], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// Variáveis globais para controlar o estado
let quadrasLayer;
let activityStatus = {};
let currentActivityId = null;

// --- FUNÇÕES DE LÓGICA DO MAPA ---

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
    return status === 'Trabalhada' ?
        { color: "#28a745", weight: 2, fillOpacity: 0.6 } : // Verde
        { color: "#dc3545", weight: 2, fillOpacity: 0.6 };   // Vermelho (Pendente)
}

/**
 * Função global para ATUALIZAR O STATUS de uma quadra.
 */
window.atualizarStatusQuadra = async function(id, novoStatus) {
    const statusAnterior = activityStatus[id];

    // Atualização visual imediata
    activityStatus[id] = novoStatus;
    if (quadrasLayer) quadrasLayer.setStyle(getStyle);
    // Não precisamos mais do map.closePopup(), pois não há popup.

    const payload = { action: 'updateStatus', id_atividade: currentActivityId, id_quadra: id, status: novoStatus };

    // Envio para o backend
    try {
        await fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) });
        console.log(`Atualização da quadra ${id} para ${novoStatus} enviada.`);
    } catch(e) {
        alert("Erro de rede ao salvar status. A mudança pode não ter sido registrada.");
        activityStatus[id] = statusAnterior;
        if (quadrasLayer) quadrasLayer.setStyle(getStyle);
    }
}

/**
 * Define o que acontece quando uma quadra é clicada e adiciona o rótulo.
 */
function onEachFeature(feature, layer) {
    const id = getQuadraId(feature);
    
    // Adiciona o evento de clique apenas para quadras que fazem parte da atividade
    if (id !== null && activityStatus[id]) {
        layer.on('click', function(e) {
            // Lógica de "toggle" com um clique
            const statusAtual = activityStatus[id] || 'Pendente';
            const novoStatus = (statusAtual === 'Pendente') ? 'Trabalhada' : 'Pendente';
            
            // Chama a função global para atualizar o status e enviar ao backend
            window.atualizarStatusQuadra(id, novoStatus);
        });
    }

    // Mantém o rótulo permanente com o número da quadra
    if (id !== null) {
        layer.bindTooltip(id.toString(), {
            permanent: true,
            direction: 'center',
            className: 'quadra-label'
        }).openTooltip();
    }
}


// --- FUNÇÕES DE CARREGAMENTO E INICIALIZAÇÃO ---

async function carregarAtividade() {
    currentActivityId = document.getElementById('atividade-select').value;
    if (quadrasLayer) map.removeLayer(quadrasLayer);
    if (!currentActivityId) return;
    
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
        const quadrasDaAtividade = Object.keys(activityStatus);
        
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
                const featuresFiltradas = areaData.features.filter(f => {
                    const quadraId = getQuadraId(f);
                    return quadraId !== null && quadrasDaAtividade.includes(quadraId.toString());
                });
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
            result.data.forEach(activity => {
                const option = document.createElement('option');
                option.value = activity.id;
                option.textContent = `Atividade: ${activity.id} (Veículo: ${activity.veiculo} | Produto: ${activity.produto})`;
                seletor.appendChild(option);
            });
        }
    } catch(error) {
        seletor.innerHTML = '<option value="">Erro ao carregar</option>';
        alert("Não foi possível buscar a lista de atividades: " + error.message);
    }
}

// Garante que o script só vai rodar depois que todo o HTML for carregado
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('atividade-select').addEventListener('change', carregarAtividade);
    popularAtividadesPendentes();
});
