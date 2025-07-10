const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxB3aZOVBhGSebSvsrYDB7ShVAqMekg12a437riystZtTHmyUPMjbJd_GzLdw4cOs7k/exec";
const TOTAL_AREAS = 109;

const map = L.map('map').setView([-23.1791, -45.8872], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

let quadrasLayer;
const selectedQuadras = new Map();

const quadrasSelecionadasList = document.getElementById('quadras-list');
const countSpan = document.getElementById('count');
const areaSelector = document.getElementById('area-selector');

function getQuadraId(feature) {
    if (feature.properties && feature.properties.title) {
        try {
            const idString = feature.properties.title.replace('QUADRA:', '').trim();
            return parseInt(idString, 10);
        } catch (e) {
            console.error("Não foi possível extrair o ID da quadra de:", feature.properties.title);
            return null;
        }
    }
    return null;
}

function getAreaId(feature) {
    if(feature.properties && feature.properties.description){
        try {
            const areaString = feature.properties.description.replace('ÁREA:', '').trim();
            return parseInt(areaString, 10);
        } catch(e) {
            console.error("Não foi possível extrair o ID da área de:", feature.properties.description);
            return null;
        }
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
            if(quadrasLayer) {
                quadrasLayer.setStyle(getStyleForFeature);
            }
            updateSidebar();
        };
        
        li.appendChild(text);
        li.appendChild(removeBtn);
        quadrasSelecionadasList.appendChild(li);
    });

    countSpan.textContent = selectedQuadras.size;
}

function getStyleForFeature(feature) {
    const id = getQuadraId(feature);
    if (selectedQuadras.has(id)) {
        return { color: '#ffc107', weight: 2, fillOpacity: 0.7 };
    }
    return { color: '#6c757d', weight: 1, opacity: 0.7, fillOpacity: 0.3 };
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

areaSelector.addEventListener('change', async (e) => {
    const areaId = e.target.value;
    if (!areaId) return;

    if (quadrasLayer) {
        map.removeLayer(quadrasLayer);
    }

    try {
        const quadrasResponse = await fetch(`data/${areaId}.geojson?v=${new Date().getTime()}`);
        if (!quadrasResponse.ok) throw new Error(`Arquivo da Área ${areaId} não encontrado.`);
        
        const quadrasGeoJSON = await quadrasResponse.json();
        
        quadrasLayer = L.geoJSON(quadrasGeoJSON, {
            style: getStyleForFeature,
            onEachFeature: (feature, layer) => { layer.on('click', onQuadraClick); }
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

    if (!id_atividade || !veiculo || !produto) {
        alert("Por favor, preencha o ID da atividade, o veículo e o produto.");
        return;
    }
    if (selectedQuadras.size === 0) {
        alert("Selecione pelo menos uma quadra no mapa para atribuir.");
        return;
    }

    const payload = {
        action: 'createActivity',
        id_atividade: id_atividade,
        veiculo: veiculo,
        produto: produto,
        quadras: Array.from(selectedQuadras.values())
    };

    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const result = await response.json();

        if (result.success) {
            alert(result.message);
            document.getElementById('atividade-id').value = '';
            document.getElementById('veiculo-select').value = '';
            document.getElementById('produto-select').value = '';
            selectedQuadras.clear();
            if (quadrasLayer) quadrasLayer.setStyle(getStyleForFeature);
            updateSidebar();
        } else {
            alert(`Erro ao salvar no backend: ${result.message}`);
        }
    } catch (error) {
        alert("Erro de comunicação. Verifique a conexão e o console para mais detalhes.");
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

popularSeletorDeAreas();
