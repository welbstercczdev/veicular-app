const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxB3aZOVBhGSebSvsrYDB7ShVAqMekg12a437riystZtTHmyUPMjbJd_GzLdw4cOs7k/exec";
const TOTAL_AREAS = 109; // AINDA PRECISAMOS DISSO PARA O MENU

const map = L.map('map').setView([-23.1791, -45.8872], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let quadrasLayer;
// MODIFICADO: Agora vamos salvar o objeto completo {id, area}
const selectedQuadras = new Map(); 
const quadrasSelecionadasList = document.getElementById('quadras-list');
const countSpan = document.getElementById('count');

function getQuadraId(feature) {
    if (feature.properties && feature.properties.title) {
        return parseInt(feature.properties.title.replace('QUADRA:', '').trim(), 10);
    }
    return null;
}

// NOVA FUNÇÃO para pegar o ID da área
function getAreaId(feature) {
    if(feature.properties && feature.properties.description){
        return parseInt(feature.properties.description.replace('ÁREA:', '').trim(), 10);
    }
    return null;
}

function updateSidebar() {
    quadrasSelecionadasList.innerHTML = '';
    selectedQuadras.forEach((quadra) => {
        const li = document.createElement('li');
        li.textContent = `Área ${quadra.area} - Quadra ${quadra.id}`;
        quadrasSelecionadasList.appendChild(li);
    });
    countSpan.textContent = selectedQuadras.size;
}

function onQuadraClick(e) {
    const layer = e.target;
    const id = getQuadraId(layer.feature);
    const area = getAreaId(layer.feature);

    if (selectedQuadras.has(id)) {
        selectedQuadras.delete(id);
        layer.setStyle({ color: '#6c757d', fillOpacity: 0.3 }); // Cor padrão
    } else {
        selectedQuadras.set(id, { id: id, area: area }); // Salva o objeto
        layer.setStyle({ color: '#ffc107', fillOpacity: 0.7 }); // Cor de seleção
    }
    updateSidebar();
}

document.getElementById('area-selector').addEventListener('change', async (e) => {
    // ... essa função continua a mesma
    const areaId = e.target.value;
    if (!areaId) return;
    if (quadrasLayer) map.removeLayer(quadrasLayer);
    const quadrasResponse = await fetch(`data/${areaId}.geojson`);
    const quadrasGeoJSON = await quadrasResponse.json();
    quadrasLayer = L.geoJSON(quadrasGeoJSON, {
        style: feature => {
            const id = getQuadraId(feature);
            return selectedQuadras.has(id) 
                ? { color: '#ffc107', fillOpacity: 0.7 } 
                : { color: '#6c757d', weight: 1, opacity: 0.7, fillOpacity: 0.3 };
        },
        onEachFeature: (feature, layer) => { layer.on('click', onQuadraClick); }
    }).addTo(map);
    if(quadrasLayer.getBounds().isValid()) map.fitBounds(quadrasLayer.getBounds());
});

document.getElementById('save-activity').addEventListener('click', async () => {
    const id_atividade = document.getElementById('atividade-id').value;
    if (!id_atividade || selectedQuadras.size === 0) {
        alert("Preencha o ID da atividade e selecione pelo menos uma quadra.");
        return;
    }

    // MODIFICADO: Agora enviamos a lista de objetos {id, area}
    const payload = {
        action: 'createActivity',
        id_atividade: id_atividade,
        quadras: Array.from(selectedQuadras.values())
    };

    // ... o resto da função de salvar continua o mesmo
    try {
        const response = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
        const result = await response.json();
        if (result.success) {
            alert(result.message);
            selectedQuadras.clear();
            quadrasLayer.setStyle({ color: '#6c757d', fillOpacity: 0.3 });
            updateSidebar();
        } else { alert(`Erro: ${result.message}`); }
    } catch (error) { alert("Erro de comunicação ao salvar a atividade."); }
});

// Preencher o seletor de áreas (continua igual)
const areaSelector = document.getElementById('area-selector');
for (let i = 1; i <= TOTAL_AREAS; i++) {
    const option = document.createElement('option');
    option.value = i;
    option.textContent = `Área ${i}`;
    areaSelector.appendChild(option);
}
