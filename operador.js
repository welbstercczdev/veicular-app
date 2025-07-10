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
 * Extrai o ID numérico da quadra da propriedade "title" do GeoJSON.
 */
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

/**
 * Define o estilo (cor) de cada quadra com base no seu status.
 */
function getStyle(feature) {
    const id = getQuadraId(feature);
    
    // Se a quadra não pertence a esta atividade, a torna invisível.
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

/**
 * Função global chamada pelo botão no popup para marcar uma quadra como trabalhada.
 */
window.marcarComoTrabalhada = async function(id) {
    // 1. Atualização visual imediata para o usuário
    activityStatus[id] = 'Trabalhada';
    if (quadrasLayer) {
        quadrasLayer.setStyle(getStyle);
    }
    map.closePopup();

    // 2. Preparação dos dados para o backend
    const payload = {
        action: 'updateStatus',
        id_atividade: currentActivityId,
        id_quadra: id,
        status: 'Trabalhada'
    };

    // 3. Envio para o backend (usando POST, mas sem esperar resposta para evitar CORS)
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors', // "Disparar e esquecer"
            body: JSON.stringify(payload)
        });
        console.log(`Atualização da quadra ${id} enviada para o servidor.`);
    } catch(e) {
        alert("Erro de rede ao salvar status. A mudança pode não ter sido registrada. Tente novamente quando tiver conexão.");
        // Reverte a mudança visual se houver falha na rede
        activityStatus[id] = 'Pendente';
        if (quadrasLayer) quadrasLayer.setStyle(getStyle);
    }
}

/**
 * Define o que acontece quando uma quadra é clicada no mapa.
 */
function onEachFeature(feature, layer) {
    const id = getQuadraId(feature);
    
    // Adiciona o popup apenas para quadras que fazem parte da atividade
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
    
    const loadingPopup = L.popup({ closeButton: false, autoClose: false })
      .setLatLng(map.getCenter())
      .setContent("Buscando dados da atividade...")
      .openOn(map);

    try {
        // 1. CONSTRUIR A URL PARA A REQUISIÇÃO GET
        const url = new URL(SCRIPT_URL);
        url.searchParams.append('action', 'getActivity');
        url.searchParams.append('id_atividade', currentActivityId);
        
        // 2. FAZER A REQUISIÇÃO GET (Funciona com CORS)
        const response = await fetch(url); 
        if (!response.ok) {
            throw new Error(`Erro de rede: ${response.statusText}`);
        }
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

        loadingPopup.setContent(`Carregando mapa para as áreas: ${areasParaCarregar.join(', ')}...`);
        const allFeatures = [];
        
        // 3. CARREGAR APENAS OS ARQUIVOS GEOJSON NECESSÁRIOS
        for (const areaId of areasParaCarregar) {
            try {
                const res = await fetch(`data/${areaId}.geojson?v=${new Date().getTime()}`);
                if (!res.ok) {
                    console.warn(`Arquivo da Área ${areaId} não encontrado.`);
                    continue; // Pula para a próxima área se esta não existir
                }
                const areaData = await res.json();
                const featuresFiltradas = areaData.features.filter(f => {
                    const id = getQuadraId(f);
                    return id !== null && quadrasDaAtividade.includes(id.toString());
                });
                allFeatures.push(...featuresFiltradas);
            } catch(e) {
                console.error(`Erro ao processar o arquivo da Área ${areaId}:`, e);
            }
        }

        map.closePopup(loadingPopup);
        if(allFeatures.length === 0) {
            alert("As quadras desta atividade não foram encontradas nos arquivos de mapa. Verifique se os arquivos de dados (.geojson) estão corretos e no repositório.");
            return;
        }

        // 4. DESENHAR NO MAPA
        const featureCollection = { type: "FeatureCollection", features: allFeatures };
        quadrasLayer = L.geoJSON(featureCollection, { style: getStyle, onEachFeature: onEachFeature }).addTo(map);

        if (quadrasLayer.getBounds().isValid()) {
            map.fitBounds(quadrasLayer.getBounds());
        }

    } catch(error) {
        map.closePopup(loadingPopup);
        alert(`Falha ao carregar atividade: ${error.message}`);
        console.error("Erro detalhado ao carregar atividade:", error);
    }
}

// Anexa o evento de clique ao botão
document.getElementById('load-activity').addEventListener('click', carregarAtividade);
