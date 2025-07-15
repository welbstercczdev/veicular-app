const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxB3aZOVBhGSebSvsrYDB7ShVAqMekg12a437riystZtTHmyUPMjbJd_GzLdw4cOs7k/exec";
const AGENTES_API_URL = "https://script.google.com/macros/s/AKfycbxg6XocN88LKvq1bv-ngEIWHjGG1XqF0ELSK9dFteunXo8a1R2AHeAH5xdfEulSZPzsgQ/exec";
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

function getColorForArea(areaId) {
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
            const compositeKey = `${quadra.area}-${quadra.id}`;
            selectedQuadras.delete(compositeKey);
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
    const borderColor = getColorForArea(areaId);
    const compositeKey = `${areaId}-${quadraId}`;
    return selectedQuadras.has(compositeKey) ?
        { color: borderColor, weight: 3, opacity: 1, fillColor: '#ffc107', fillOpacity: 0.7 } :
        { color: borderColor, weight: 2, opacity: 0.8, fillColor: '#6c757d', fillOpacity: 0.3 };
}

function onQuadraClick(e) {
    const layer = e.target;
    const id = getQuadraId(layer.feature);
    const area = getAreaId(layer.feature);
    if (id === null || area === null) return;
    const compositeKey = `${area}-${id}`;
    if (selectedQuadras.has(compositeKey)) {
        selectedQuadras.delete(compositeKey);
    } else {
        selectedQuadras.set(compositeKey, { id: id, area: area });
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
    const motorista = document.getElementById('motorista-select').value;
    const operador = document.getElementById('operador-select').value;

    if (!id_atividade || !veiculo || !produto || !motorista || !operador) {
        alert("Por favor, preencha todos os campos da atividade.");
        return;
    }
    if (selectedQuadras.size === 0) {
        alert("Selecione pelo menos uma quadra no mapa.");
        return;
    }

    const payload = { action: 'createActivity', id_atividade, veiculo, produto, motorista, operador, quadras: Array.from(selectedQuadras.values()) };

    try {
        await fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) });
        alert("Atividade enviada para salvamento! Verifique a planilha para confirmar.");
        document.getElementById('atividade-id').value = '';
        document.getElementById('veiculo-select').value = '';
        document.getElementById('produto-select').value = '';
        document.getElementById('motorista-select').value = '';
        document.getElementById('operador-select').value = '';
        document.getElementById('motorista-search').value = ''; // Limpa o campo de busca
        document.getElementById('operador-search').value = '';   // Limpa o campo de busca
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

/**
 * Filtra as opções de um elemento <select> com base no texto de um <input>.
 */
function setupSearchableSelect(inputId, selectId) {
    const input = document.getElementById(inputId);
    const select = document.getElementById(selectId);

    input.addEventListener('keyup', function() {
        const filter = input.value.toUpperCase();
        const options = select.getElementsByTagName('option');

        for (let i = 0; i < options.length; i++) {
            const txtValue = options[i].textContent || options[i].innerText;
            // Mantém a primeira opção (ex: "Selecione...") sempre visível
            if (options[i].value === "") {
                options[i].classList.remove('option-hidden');
                continue;
            }
            
            if (txtValue.toUpperCase().indexOf(filter) > -1) {
                options[i].classList.remove('option-hidden');
            } else {
                options[i].classList.add('option-hidden');
            }
        }
    });
}

/**
 * Busca a lista de agentes da API e preenche os menus.
 */
async function popularAgentes() {
    const motoristaSelect = document.getElementById('motorista-select');
    const operadorSelect = document.getElementById('operador-select');
    try {
        const response = await fetch(AGENTES_API_URL);
        if (!response.ok) throw new Error('Falha ao buscar a lista de agentes.');
        const data = await response.json();
        if (data.error) throw new Error(data.error);

        motoristaSelect.innerHTML = '<option value="">Selecione o motorista...</option>';
        operadorSelect.innerHTML = '<option value="">Selecione o operador...</option>';

        data.agentes.forEach(nome => {
            const optionMotorista = document.createElement('option');
            optionMotorista.value = nome;
            optionMotorista.textContent = nome;
            motoristaSelect.appendChild(optionMotorista);

            const optionOperador = document.createElement('option');
            optionOperador.value = nome;
            optionOperador.textContent = nome;
            operadorSelect.appendChild(optionOperador);
        });

    } catch (error) {
        alert("Não foi possível carregar a lista de nomes: " + error.message);
    }
}

// Inicia a aplicação do gestor
document.addEventListener('DOMContentLoaded', () => {
    popularSeletorDeAreas();
    popularAgentes();

    // Conecta a busca aos menus de seleção
    setupSearchableSelect('motorista-search', 'motorista-select');
    setupSearchableSelect('operador-search', 'operador-select');
});
