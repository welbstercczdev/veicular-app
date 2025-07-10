const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxB3aZOVBhGSebSvsrYDB7ShVAqMekg12a437riystZtTHmyUPMjbJd_GzLdw4cOs7k/exec";
const TOTAL_AREAS = 109;

const map = L.map('map').setView([-23.1791, -45.8872], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let quadrasLayer;
const selectedQuadras = new Map();
const quadrasSelecionadasList = document.getElementById('quadras-list');
const countSpan = document.getElementById('count');

// --- Funções para extrair IDs (sem mudanças) ---
function getQuadraId(feature) {
    if (feature.properties && feature.properties.title) {
        return parseInt(feature.properties.title.replace('QUADRA:', '').trim(), 10);
    }
    return null;
}

function getAreaId(feature) {
    if(feature.properties && feature.properties.description){
        return parseInt(feature.properties.description.replace('ÁREA:', '').trim(), 10);
    }
    return null;
}

// --- Funções de Interface (COM MELHORIAS) ---

/**
 * Atualiza a barra lateral com a lista de quadras selecionadas.
 * Adiciona um botão "Remover" para cada item da lista.
 */
function updateSidebar() {
    quadrasSelecionadasList.innerHTML = ''; // Limpa a lista
    
    // Transforma o Map em um array, ordena por área e depois por quadra
    const sortedQuadras = Array.from(selectedQuadras.values()).sort((a, b) => {
        if (a.area !== b.area) {
            return a.area - b.area;
        }
        return a.id - b.id;
    });

    sortedQuadras.forEach((quadra) => {
        const li = document.createElement('li');
        li.style = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;';
        
        const text = document.createElement('span');
        text.textContent = `Área ${quadra.area} - Quadra ${quadra.id}`;
        
        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'X';
        removeBtn.style = 'width: auto; padding: 2px 8px; margin: 0; background-color: #dc3545; font-size: 12px;';
        
        // Ação de clique no botão de remover
        removeBtn.onclick = () => {
            // Remove a quadra do set de seleção
            selectedQuadras.delete(quadra.id);
            // Redesenha a camada do mapa para refletir a remoção
            quadrasLayer.setStyle(getStyleForFeature);
            // Atualiza a barra lateral novamente
            updateSidebar();
        };
        
        li.appendChild(text);
        li.appendChild(removeBtn);
        quadrasSelecionadasList.appendChild(li);
    });

    countSpan.textContent = selectedQuadras.size;
}

/**
 * Função de estilo que será chamada para cada quadra, determinando sua cor.
 */
function getStyleForFeature(feature) {
    const id = getQuadraId(feature);
    if (selectedQuadras.has(id)) {
        return { color: '#ffc107', weight: 2, fillOpacity: 0.7 }; // Amarelo (selecionado)
    }
    return { color: '#6c757d', weight: 1, opacity: 0.7, fillOpacity: 0.3 }; // Cinza (padrão)
}

/**
 * Função chamada quando uma quadra é clicada no mapa.
 */
function onQuadraClick(e) {
    const layer = e.target;
    const id = getQuadraId(layer.feature);
    const area = getAreaId(layer.feature);

    if (selectedQuadras.has(id)) {
        selectedQuadras.delete(id);
    } else {
        selectedQuadras.set(id, { id: id, area: area });
    }
    
    // Em vez de estilizar apenas a camada clicada, re-estilizamos toda a camada
    // para garantir consistência, especialmente após a remoção pela barra lateral.
    quadrasLayer.setStyle(getStyleForFeature);
    updateSidebar();
}

// --- Funções de Carregamento e Salvamento (sem mudanças na lógica principal) ---

document.getElementById('area-selector').addEventListener('change', async (e) => {
    const areaId = e.target.value;
    if (!areaId) return;

    if (quadrasLayer) {
        // Antes de remover a camada antiga, salve suas features para não perder a seleção
        quadrasLayer.eachLayer(layer => {
            if (selectedQuadras.has(getQuadraId(layer.feature))) {
                // Se já estiver selecionada, não precisa fazer nada
            }
        });
        map.removeLayer(quadrasLayer);
    }

    const quadrasResponse = await fetch(`data/${areaId}.geojson`);
    const quadrasGeoJSON = await quadrasResponse.json();
    
    quadrasLayer = L.geoJSON(quadrasGeoJSON, {
        style: getStyleForFeature, // Usa a nova função de estilo
        onEachFeature: (feature, layer) => { layer.on('click', onQuadraClick); }
    }).addTo(map);

    if(quadrasLayer.getBounds().isValid()) map.fitBounds(quadrasLayer.getBounds());
});

document.getElementById('save-activity').addEventListener('click', async () => {
    // Esta função permanece a mesma da versão anterior
    const id_atividade = document.getElementById('atividade-id').value;
    if (!id_atividade) {
        alert("Por favor, insira um ID para a atividade.");
        return;
    }
    if (selectedQuadras.size === 0) {
        alert("Selecione pelo menos uma quadra no mapa.");
        return;
    }

    const payload = {
        action: 'createActivity',
        id_atividade: id_atividade,
        quadras: Array.from(selectedQuadras.values())
    };

    try {
        const response = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
        const result = await response.json();
        if (result.success) {
            alert(result.message);
            selectedQuadras.clear();
            quadrasLayer.setStyle(getStyleForFeature);
            updateSidebar();
        } else {
            alert(`Erro: ${result.message}`);
        }
    } catch (error) {
        alert("Erro de comunicação ao salvar a atividade.");
    }
});

// Preencher o seletor de áreas
const areaSelector = document.getElementById('area-selector');
for (let i = 1; i <= TOTAL_AREAS; i++) {
    const option = document.createElement('option');
    option.value = i;
    option.textContent = `Área ${i}`;
    areaSelector.appendChild(option);
}
