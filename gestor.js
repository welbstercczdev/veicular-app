const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxB3aZOVBhGSebSvsrYDB7ShVAqMekg12a437riystZtTHmyUPMjbJd_GzLdw4cOs7k/exec";
const TOTAL_AREAS = 109;

// Inicialização do mapa
const map = L.map('map').setView([-23.1791, -45.8872], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// Variáveis globais
let quadrasLayer;
const selectedQuadras = new Map();

// Elementos da DOM
const quadrasSelecionadasList = document.getElementById('quadras-list');
const countSpan = document.getElementById('count');
const areaSelector = document.getElementById('area-selector');


// --- FUNÇÕES DE LÓGICA E ESTILO ---

/**
 * Gera uma cor HSL distinta e consistente para um ID de área.
 */
function getColorForArea(areaId) {
    // Usa uma fórmula para espalhar as cores pelo círculo cromático
    const hue = (areaId * 137.508) % 360; 
    return `hsl(${hue}, 80%, 50%)`;
}

function getQuadraId(feature) {
    if (feature.properties && feature.properties.title) {
        try {
            return parseInt(feature.properties.title.replace('QUADRA:', '').trim(), 10);
        } catch (e) { console.error("Erro ao extrair ID da quadra:", e); return null; }
    }
    return null;
}

function getAreaId(feature) {
    if(feature.properties && feature.properties.description){
        try {
            return parseInt(feature.properties.description.replace('ÁREA:', '').trim(), 10);
        } catch(e) { console.error("Erro ao extrair ID da área:", e); return null; }
    }
    return null;
}

function updateSidebar() {
    quadrasSelecionadasList.innerHTML = '';
    const sortedQuadras = Array.from(selectedQuadras.values()).sort((a, b) => {
        if (a.area !== b.area) return a.area - b.area;
        return a.id - b.id;
    });

    sortedQuadras.forEach((quadra) => {
        const li = document.createElement('li');
        li.style = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; padding: 2px;';
        const text = document.createElement('span');
        text.textContent = `Área ${quadra.area} - Quadra ${quadra.id}`;
        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'X';
        removeBtn.style = 'width: auto; padding: 2px 8px; margin: 0; background-color: #dc3545; font-size: 12px;';
        removeBtn.onclick = () => {
            selectedQuadras.delete(quadra.id);
            if(quadrasLayer) quadrasLayer.setStyle(getStyleForFeature);
            updateSidebar();
        };
        li.appendChild(text);
        li.appendChild(removeBtn);
        quadrasSelecionadasList.appendChild(li);
    });
    countSpan.textContent = selectedQuadras.size;
}

function getStyleForFeature(feature) {
    const quadraId = getQuadraId(feature);
    const areaId = getAreaId(feature);
    const borderColor = getColorForArea(areaId); // Gera a cor da borda

    if (selectedQuadras.has(quadraId)) {
        // Estilo para quadras selecionadas
        return { color: borderColor, weight: 3, opacity: 1, fillColor: '#ffc107', fillOpacity: 0.7 };
    } else {
        // Estilo para quadras não selecionadas
        return { color: borderColor, weight: 2, opacity: 0.8, fillColor: '#6c757d', fillOpacity: 0.3 };
    }
}

function onQuadraClick(e) {
    const layer = e.target;
    const id = getQuadraId(layer.feature);
    const area = getAreaId(layer.feature);
    if (id === null || area === null) return;
    if (selectedQuadras.has(id)) {
        selectedQuadras.delete(id);
    } else {
        selectedQuadras.set(id, { id: id, area: area });
    }
    layer.setStyle(getStyleForFeature(layer.feature));
    updateSidebar();
}

function onEachFeature(feature, layer) {
    layer.on('click', onQuadraClick);
    const quadraId = getQuadraId(feature);
    if (quadraId !== null) {
        layer.bindTooltip(quadraId.toString(), {
            permanent: true,
            direction: 'center',
            className: 'quadra-label'
        }).openTooltip();
    }
}


// --- FUNÇÕES DE CARREGAMENTO E ENVIO ---

areaSelector.addEventListener('change', async (e) => {
    const areaId = e.target.value;
    if (!areaId) return;
    if (quadrasLayer) map.removeLayer(quadrasLayer);
    try {
        const quadrasResponse = await fetch(`data/${areaId}.geojson?v=${new Date().getTime()}`);
        if (!quadrasResponse.ok) throw new Error(`Arquivo da Área ${areaId} não encontrado.`);
        const quadrasGeoJSON = await quadrasResponse.json();
        quadrasLayer = L.geoJSON(quadrasGeoJSON, {
            style: getStyleForFeature,
            onEachFeature: onEachFeature
        }).addTo(map);
        if(quadrasLayer.getBounds().isValid()) map.fitBounds(quadrasLayer.getBounds());
    } catch (error) {
        alert(`Erro ao carregar dados da área: ${error.message}`);
    }
});

document.getElementById('save-activity').addEventListener('click', async () => {
    const id_atividade = document.getElementById('atividade-id').value.trim();
    const veiculo = document.getElementById('veiculo-select').value;
    const produto = document.getElementById('produto-select').value;

    if (!id_atividade || !veiculo || !produto || selectedQuadras.size === 0) {
        alert("Preencha todos os campos e selecione ao menos uma quadra.");
        return;
    }

    const payload = { action: 'createActivity', id_atividade, veiculo, produto, quadras: Array.from(selectedQuadras.values()) };

    try {
        await fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) });
        alert("Atividade enviada para salvamento! Verifique a planilha para confirmar.");
        document.getElementById('atividade-id').value = '';
        document.getElementById('veiculo-select').value = '';
        document.getElementById('produto-select').value = '';
        selectedQuadras.clear();
        if (quadrasLayer) quadrasLayer.setStyle(getStyleForFeature);
        updateSidebar();
    } catch (error) {
        alert("Falha grave de rede. Não foi possível enviar a atividade.");
        console.error('Save Activity Error:', error);
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

// Inicia a aplicação do gestor
popularSeletorDeAreas();
