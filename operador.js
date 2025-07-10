// URL do seu App Script implantado
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxB3aZOVBhGSebSvsrYDB7ShVAqMekg12a437riystZtTHmyUPMjbJd_GzLdw4cOs7k/exec";

// Inicializa o mapa
const map = L.map('map').setView([-23.1791, -45.8872], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// Variáveis globais para controlar o estado da aplicação
let quadrasLayer;
let activityStatus = {};
let currentActivityId = null;

/**
 * Extrai o número da quadra da propriedade "title" (ex: "QUADRA: 398" -> 398)
 * @param {object} feature - A feature do GeoJSON
 * @returns {number|null} O ID da quadra ou nulo se não encontrar.
 */
function getQuadraId(feature) {
    if (feature.properties && feature.properties.title) {
        try {
            const idString = feature.properties.title.replace('QUADRA:', '').trim();
            return parseInt(idString, 10);
        } catch (e) {
            console.error("Erro ao extrair ID da quadra:", feature.properties.title);
            return null;
        }
    }
    return null;
}

/**
 * Define o estilo (cor) de cada quadra com base no seu status na atividade atual.
 * @param {object} feature - A feature do GeoJSON
 */
function getStyle(feature) {
    const id = getQuadraId(feature);
    
    // Se a quadra não pertence a esta atividade, deixa transparente/invisível
    if (!activityStatus[id]) {
        return { opacity: 0, fillOpacity: 0 };
    }
    
    const status = activityStatus[id];
    switch (status) {
        case 'Trabalhada':
            return { color: "#28a745", weight: 2, fillOpacity: 0.6 }; // Verde para 'Trabalhada'
        default:
            return { color: "#dc3545", weight: 2, fillOpacity: 0.6 }; // Vermelho para 'Pendente'
    }
}

/**
 * Função global chamada pelo botão no popup para marcar uma quadra como trabalhada.
 * @param {number} id - O ID da quadra clicada.
 */
window.marcarComoTrabalhada = async function(id) {
    // 1. Atualiza o status localmente e redesenha o mapa para feedback imediato
    activityStatus[id] = 'Trabalhada';
    if (quadrasLayer) {
        quadrasLayer.setStyle(getStyle);
    }
    map.closePopup();

    // 2. Prepara os dados para enviar ao backend
    const payload = {
        action: 'updateStatus',
        id_atividade: currentActivityId,
        id_quadra: id,
        status: 'Trabalhada'
    };

    // 3. Envia a atualização para o Google Sheets
    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (result.success) {
            console.log(result.message);
        } else {
            alert(`Erro ao salvar status: ${result.message}`);
            // Reverte a mudança visual em caso de erro no salvamento
            activityStatus[id] = 'Pendente';
            if (quadrasLayer) quadrasLayer.setStyle(getStyle);
        }
    } catch(e) {
        alert("Erro de rede. A alteração não foi salva. Tente novamente quando tiver conexão.");
        // Reverte a mudança visual em caso de erro de rede
        activityStatus[id] = 'Pendente';
        if (quadrasLayer) quadrasLayer.setStyle(getStyle);
    }
}

/**
 * Define o que acontece quando uma quadra é clicada no mapa.
 * @param {object} feature - A feature do GeoJSON
 * @param {L.Layer} layer - A camada do Leaflet correspondente à feature
 */
function onEachFeature(feature, layer) {
    const id = getQuadraId(feature);
    
    // Só adiciona o popup se a quadra pertencer à atividade atual
    if (id !== null && activityStatus[id]) {
        layer.on('click', function(e) {
            const popupContent = `
                <b>Quadra: ${id}</b><br>
                Status: ${activityStatus[id]}<br><br>
                <button onclick="marcarComoTrabalhada(${id})">Marcar como Trabalhada</button>
            `;
            L.popup().setLatLng(e.latlng).setContent(popupContent).openOn(map);
        });
    }
}


/**
 * Função principal acionada pelo botão "Carregar Trabalho".
 */
async function carregarAtividade() {
    currentActivityId = document.getElementById('atividade-input').value.trim();
    if (!currentActivityId) {
        alert("Por favor, insira o ID da atividade.");
        return;
    }

    if (quadrasLayer) {
        map.removeLayer(quadrasLayer);
    }
    
    const loadingMessage = document.createElement('div');
    loadingMessage.innerText = "Buscando dados da atividade...";
    loadingMessage.style = "padding:10px; background:white; border-radius:5px;";
    const loadingPopup = L.popup({ closeButton: false, autoClose: false })
      .setLatLng(map.getCenter())
      .setContent(loadingMessage)
      .openOn(map);

    // 1. Buscar os dados da atividade (lista de quadras e áreas) no Google Sheets
    try {
        const response = await fetch(SCRIPT_URL, { 
            method: 'POST',
            body: JSON.stringify({ action: 'getActivity', id_atividade: currentActivityId })
        });
        const result = await response.json();

        if (!result.success) {
            throw new Error(result.message);
        }
        
        activityStatus = result.data.quadras;
        const areasParaCarregar = result.data.areas;
        const quadrasDaAtividade = Object.keys(activityStatus);
        
        if (areasParaCarregar.length === 0) {
            alert("Nenhuma quadra encontrada para esta atividade.");
            map.closePopup(loadingPopup);
            return;
        }

        // 2. Carregar apenas os arquivos GeoJSON das áreas necessárias
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
            alert("As quadras desta atividade não foram encontradas nos arquivos de mapa. Verifique se os dados estão corretos.");
            return;
        }

        // 3. Desenhar as quadras encontradas no mapa
        const featureCollection = { type: "FeatureCollection", features: allFeatures };
        
        quadrasLayer = L.geoJSON(featureCollection, {
            style: getStyle,
            onEachFeature: onEachFeature
        }).addTo(map);

        if (quadrasLayer.getBounds().isValid()) {
            map.fitBounds(quadrasLayer.getBounds());
        }

    } catch(error) {
        map.closePopup(loadingPopup);
        alert(`Falha ao carregar atividade: ${error.message}`);
        console.error("Erro ao carregar atividade:", error);
    }
}

// Anexa o evento ao botão
document.getElementById('load-activity').addEventListener('click', carregarAtividade);
