const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxB3aZOVBhGSebSvsrYDB7ShVAqMekg12a437riystZtTHmyUPMjbJd_GzLdw4cOs7k/exec";
const AGENTES_API_URL = "https://script.google.com/macros/s/AKfycbxg6XocN88LKvq1bv-ngEIWHjGG1XqF0ELSK9dFteunXo8a1R2AHeAH5xdfEulSZPzsgQ/exec";
const BAIRROS_API_URL = "https://script.google.com/macros/s/AKfycbw7VInWajEJflcf43PyWeiCh2IfRxVOlZjw3uiHgbKqO_12Y9ARUDnGxio6abnxxpdy/exec";
const TOTAL_AREAS = 109;

// Inicialização do mapa
const map = L.map('map').setView([-23.1791, -45.8872], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// Variáveis globais
let quadrasLayer;
const selectedQuadras = new Map();
const selectedBairros = new Set();

// Elementos da DOM
const quadrasSelecionadasList = document.getElementById('quadras-list');
const countSpan = document.getElementById('count');
const areaSelector = document.getElementById('area-selector');

// --- FUNÇÕES DE LÓGICA E ESTILO ---

function getColorForArea(areaId) {
    if (!areaId) return '#777';
    const hue = (areaId * 137.508) % 360;
    return `hsl(${hue}, 80%, 50%)`;
}

function getQuadraId(feature) {
    if (feature.properties && feature.properties.title) {
        try { return parseInt(feature.properties.title.replace('QUADRA:', '').trim(), 10); } 
        catch (e) { return null; }
    }
    return null;
}

function getAreaId(feature) {
    if(feature.properties && feature.properties.description){
        try { return parseInt(feature.properties.description.replace('ÁREA:', '').trim(), 10); } 
        catch(e) { return null; }
    }
    return null;
}

/**
 * Calcula a área de um polígono usando a fórmula de Shoelace em coordenadas geográficas.
 * @param {Array<L.LatLng>} latlngs - Um array de coordenadas do Leaflet.
 * @returns {number} - A área em metros quadrados.
 */
function calculatePolygonArea(latlngs) {
    if (!latlngs || latlngs.length < 3) return 0;
    let area = 0.0;
    const R = 6378137; // Raio da Terra em metros
    for (let i = 0; i < latlngs.length; i++) {
        const p1 = latlngs[i];
        const p2 = latlngs[(i + 1) % latlngs.length];
        area += (p2.lng * Math.PI / 180 - p1.lng * Math.PI / 180) * (2 + Math.sin(p1.lat * Math.PI / 180) + Math.sin(p2.lat * Math.PI / 180));
    }
    return Math.abs(area * R * R / 2.0);
}


function updateSidebar() {
    quadrasSelecionadasList.innerHTML = '';
    let totalArea = 0;
    const sortedQuadras = Array.from(selectedQuadras.values()).sort((a, b) => (a.area - b.area) || (a.id - b.id));
    
    sortedQuadras.forEach((quadra) => {
        totalArea += quadra.sqMeters;
        const li = document.createElement('li');
        li.style = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;';
        li.innerHTML = `<span>Área ${quadra.area} - Quadra ${quadra.id} (${quadra.sqMeters.toFixed(2)} m²)</span>
                        <button class="remove-quadra-btn" data-key="${quadra.area}-${quadra.id}" style="width: auto; padding: 2px 8px; margin: 0; background-color: #dc3545; font-size: 12px;">X</button>`;
        quadrasSelecionadasList.appendChild(li);
    });
    
    countSpan.textContent = selectedQuadras.size;
    document.getElementById('total-area').textContent = totalArea.toFixed(2);
}

document.getElementById('quadras-list').addEventListener('click', function(e) {
    if (e.target && e.target.classList.contains('remove-quadra-btn')) {
        const key = e.target.dataset.key;
        selectedQuadras.delete(key);
        if (quadrasLayer) quadrasLayer.setStyle(getStyleForFeature);
        updateSidebar();
    }
});


function getStyleForFeature(feature) {
    const quadraId = getQuadraId(feature);
    const areaId = getAreaId(feature);
    const borderColor = getColorForArea(areaId);
    const compositeKey = `${areaId}-${quadraId}`;
    return selectedQuadras.has(compositeKey) ?
        { color: borderColor, weight: 3, opacity: 1, fillColor: '#ffc107', fillOpacity: 0.7 } :
        { color: borderColor, weight: 2, opacity: 0.8, fillColor: '#6c757d', fillOpacity: 0.3 };
}

function onQuadraClick(e) {
    const layer = e.target;
    const id = getQuadraId(layer.feature);
    const areaId = getAreaId(layer.feature);
    if (id === null || areaId === null) return;
    
    const compositeKey = `${areaId}-${id}`;

    if (selectedQuadras.has(compositeKey)) {
        selectedQuadras.delete(compositeKey);
    } else {
        let areaInSqMeters = 0;
        try {
            const latlngs = layer.getLatLngs();
            // Lógica robusta para lidar com Polygon e MultiPolygon
            const coordsToCalc = Array.isArray(latlngs[0][0]) ? latlngs[0][0] : latlngs[0];
            areaInSqMeters = calculatePolygonArea(coordsToCalc);
        } catch (calcError) {
             console.error(`Erro ao calcular a área da quadra ${id}.`, calcError);
             areaInSqMeters = 0;
        }
        selectedQuadras.set(compositeKey, { id: id, area: areaId, sqMeters: areaInSqMeters });
    }
    
    layer.setStyle(getStyleForFeature(layer.feature));
    updateSidebar();
}

function onEachFeature(feature, layer) {
    layer.on('click', onQuadraClick);
    const quadraId = getQuadraId(feature);
    if (quadraId !== null) {
        layer.bindTooltip(quadraId.toString(), {
            permanent: true, direction: 'center', className: 'quadra-label'
        }).openTooltip();
    }
}

function setupAutocomplete(inputId, listId, sourceArray, onSelectCallback) {
    const input = document.getElementById(inputId);
    const listContainer = document.getElementById(listId);

    input.addEventListener("input", function() {
        const val = this.value;
        listContainer.innerHTML = '';
        if (!val) {
            listContainer.style.display = 'none';
            return;
        }
        
        listContainer.style.display = 'block';
        const suggestions = sourceArray.filter(item => item.toUpperCase().includes(val.toUpperCase()));

        suggestions.forEach(item => {
            const suggestionDiv = document.createElement("DIV");
            suggestionDiv.innerHTML = item.replace(new RegExp(val, "gi"), "<strong>$&</strong>");
            suggestionDiv.addEventListener("click", function() {
                onSelectCallback(item);
                closeAllLists();
            });
            listContainer.appendChild(suggestionDiv);
        });
    });

    function closeAllLists() {
        document.querySelectorAll(".autocomplete-items").forEach(item => {
            item.innerHTML = '';
            item.style.display = 'none';
        });
    }

    document.addEventListener("click", function (e) {
        if (!e.target.closest('.autocomplete-container')) {
            closeAllLists();
        }
    });
}

function renderBairroTags() {
    const container = document.getElementById('bairros-selecionados-container');
    container.innerHTML = '';
    selectedBairros.forEach(bairro => {
        const tag = document.createElement('div');
        tag.className = 'bairro-tag';
        tag.innerHTML = `<span>${bairro}</span><span class="remove-tag" data-bairro="${bairro}">×</span>`;
        container.appendChild(tag);
    });
}

document.getElementById('bairros-selecionados-container').addEventListener('click', function(e) {
    if (e.target && e.target.classList.contains('remove-tag')) {
        selectedBairros.delete(e.target.dataset.bairro);
        renderBairroTags();
    }
});

async function popularDadosIniciais() {
    try {
        const [agentesRes, bairrosRes] = await Promise.all([ fetch(AGENTES_API_URL), fetch(BAIRROS_API_URL) ]);
        const agentesData = await agentesRes.json();
        const bairrosData = await bairrosRes.json();
        
        if (agentesData.error) throw new Error(agentesData.error);
        if (bairrosData.error || !bairrosData.agentes) throw new Error(`API de Bairros: ${bairrosData.error || 'formato de resposta inválido'}`);

        setupAutocomplete('motorista-input', 'motorista-list', agentesData.agentes, val => { document.getElementById('motorista-input').value = val; });
        setupAutocomplete('operador-input', 'operador-list', agentesData.agentes, val => { document.getElementById('operador-input').value = val; });
        
        setupAutocomplete('bairro-input', 'bairro-list', bairrosData.agentes, bairro => {
            selectedBairros.add(bairro);
            renderBairroTags();
            document.getElementById('bairro-input').value = '';
        });
        
        document.getElementById('motorista-input').placeholder = "Digite para buscar...";
        document.getElementById('operador-input').placeholder = "Digite para buscar...";
        document.getElementById('bairro-input').placeholder = "Digite para buscar...";

    } catch(e) { 
        alert("Erro ao carregar dados iniciais (Agentes ou Bairros). " + e.message); 
    }
}

areaSelector.addEventListener('change', async (e) => {
    const areaId = e.target.value;
    if (!areaId) return;
    if (quadrasLayer) map.removeLayer(quadrasLayer);
    try {
        const quadrasResponse = await fetch(`data/${areaId}.geojson?v=${new Date().getTime()}`);
        if (!quadrasResponse.ok) throw new Error(`Arquivo da Área ${areaId} não encontrado.`);
        const quadrasGeoJSON = await quadrasResponse.json();
        quadrasLayer = L.geoJSON(quadrasGeoJSON, { style: getStyleForFeature, onEachFeature: onEachFeature }).addTo(map);
        if(quadrasLayer.getBounds().isValid()) map.fitBounds(quadrasLayer.getBounds());
    } catch (error) {
        alert(`Erro ao carregar dados da área: ${error.message}`);
    }
});

document.getElementById('save-activity').addEventListener('click', async () => {
    const payload = {
        action: 'createActivity',
        id_atividade: document.getElementById('atividade-id').value.trim(),
        veiculo: document.getElementById('veiculo-select').value,
        produto: document.getElementById('produto-select').value,
        motorista: document.getElementById('motorista-input').value.trim(),
        operador: document.getElementById('operador-input').value.trim(),
        bairros: Array.from(selectedBairros).join(', '),
        quadras: Array.from(selectedQuadras.values())
    };

    if (!payload.id_atividade || !payload.veiculo || !payload.produto || !payload.bairros || !payload.motorista || !payload.operador || payload.quadras.length === 0) {
        alert("Preencha todos os campos, incluindo ao menos um bairro e uma quadra."); return;
    }

    try {
        await fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) });
        alert("Atividade enviada para salvamento! Verifique a planilha para confirmar.");
        
        document.getElementById('atividade-id').value = '';
        document.getElementById('veiculo-select').value = '';
        document.getElementById('produto-select').value = '';
        document.getElementById('motorista-input').value = '';
        document.getElementById('operador-input').value = '';
        document.getElementById('bairro-input').value = '';
        selectedBairros.clear();
        renderBairroTags();
        selectedQuadras.clear();
        if (quadrasLayer) quadrasLayer.setStyle(getStyleForFeature);
        updateSidebar();
    } catch (error) {
        alert("Falha grave de rede. Não foi possível enviar a atividade.");
    }
});

function popularSeletorDeAreas() {
    for (let i = 1; i <= TOTAL_AREAS; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `Área ${i}`;
        areaSelector.appendChild(option);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    popularSeletorDeAreas();
    popularDadosIniciais();
});