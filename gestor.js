const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxB3aZOVBhGSebSvsrYDB7ShVAqMekg12a437riystZtTHmyUPMjbJd_GzLdw4cOs7k/exec";
const AGENTES_API_URL = "https://script.google.com/macros/s/AKfycbxg6XocN88LKvq1bv-ngEIWHjGG1XqF0ELSK9dFteunXo8a1R2AHeAH5xdfEulSZPzsgQ/exec";
const BAIRROS_API_URL = "https://script.google.com/macros/s/AKfycbw7VInWajEJflcf43PyWeiCh2IfRxVOlZjw3uiHgbKqO_12Y9ARUDnGxio6abnxxpdy/exec";
const TOTAL_AREAS = 109;

// Inicialização do mapa
const map = L.map('map').setView([-23.1791, -45.8872], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// Variáveis globais
let quadrasLayer;
let imoveisLookup = {};
const selectedQuadras = new Map();
const selectedBairros = new Set();

// Elementos da DOM
const quadrasSelecionadasList = document.getElementById('quadras-list');
const countSpan = document.getElementById('count');
const areaSelector = document.getElementById('area-selector');
const manageModal = document.getElementById('manage-modal');
const closeModalBtn = manageModal.querySelector('.modal-close');
const openModalBtn = document.getElementById('manage-activities-btn');
const activitiesTableBody = document.getElementById('activities-table-body');
const searchHistoryBtn = document.getElementById('search-history-btn');
const historyTableBody = document.getElementById('history-table-body');

// --- Lógica da Janela Modal ---

function renderActivitiesTable(activities) {
    activitiesTableBody.innerHTML = '';
    if (!activities || activities.length === 0) {
        activitiesTableBody.innerHTML = '<tr><td colspan="5">Nenhuma atividade em andamento encontrada.</td></tr>';
        return;
    }
    activities.forEach(act => {
        const progresso = act.totalQuadras > 0 ? (act.quadrasTrabalhadas / act.totalQuadras) * 100 : 0;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${act.id} (${act.ciclo})</td>
            <td>${act.data}</td>
            <td>${act.veiculo}</td>
            <td>
                <div class="progress-bar"><div class="progress-bar-fill" style="width: ${progresso.toFixed(2)}%;">${progresso.toFixed(0)}%</div></div>
                <small>${act.quadrasTrabalhadas} de ${act.totalQuadras} quadras</small>
            </td>
            <td class="action-buttons">
                <button class="btn-edit" data-id="${act.id}" data-ciclo="${act.ciclo}">Editar</button>
                <button class="btn-delete" data-id="${act.id}" data-ciclo="${act.ciclo}">Excluir</button>
            </td>
        `;
        activitiesTableBody.appendChild(row);
    });
}

async function openManageModal() {
    manageModal.style.display = 'flex';
    activitiesTableBody.innerHTML = '<tr><td colspan="5">Carregando...</td></tr>';
    try {
        const url = new URL(SCRIPT_URL);
        url.searchParams.append('action', 'getActivitiesList');
        const response = await fetch(url);
        const result = await response.json();
        if (result.success) renderActivitiesTable(result.data);
        else throw new Error(result.message);
    } catch(e) {
        activitiesTableBody.innerHTML = `<tr><td colspan="5">Erro ao carregar: ${e.message}</td></tr>`;
    }
}

function closeModal() {
    manageModal.style.display = 'none';
}

activitiesTableBody.addEventListener('click', async (e) => {
    const target = e.target;
    const activityId = target.dataset.id;
    const activityCycle = target.dataset.ciclo;
    if (!activityId || !activityCycle) return;

    if (target.classList.contains('btn-delete')) {
        if (confirm(`Tem certeza que deseja excluir a atividade ${activityId} (${activityCycle})?`)) {
            try {
                const payload = { action: 'deleteActivity', id_atividade: activityId, ciclo: activityCycle };
                await fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) });
                alert(`Solicitação para excluir a atividade ${activityId} (${activityCycle}) foi enviada.`);
                openManageModal();
            } catch (err) { alert("Erro de rede ao tentar excluir."); }
        }
    }
    if (target.classList.contains('btn-edit')) {
        try {
            const url = new URL(SCRIPT_URL);
            url.searchParams.append('action', 'getActivityDetails');
            url.searchParams.append('id_atividade', activityId);
            url.searchParams.append('ciclo', activityCycle);
            const response = await fetch(url);
            const result = await response.json();
            if (!result.success) throw new Error(result.message);
            const activity = result.data;
            document.getElementById('atividade-id').value = activity.id;
            document.querySelectorAll('input[name="ciclo"]').forEach(cb => { cb.checked = (activity.ciclo === cb.value); });
            document.getElementById('veiculo-select').value = activity.veiculo;
            document.getElementById('produto-select').value = activity.produto;
            document.getElementById('motorista-input').value = activity.motorista;
            document.getElementById('operador-input').value = activity.operador;
            selectedBairros.clear();
            if (activity.bairros) activity.bairros.split(',').forEach(b => selectedBairros.add(b.trim()));
            renderBairroTags();
            selectedQuadras.clear();
            activity.quadras.forEach(q => {
                const compositeKey = `${q.area}-${q.id}`;
                const lookupData = imoveisLookup[compositeKey] || { total_imoveis: 0, censitario: 'N/A' };
                selectedQuadras.set(compositeKey, { id: parseInt(q.id), area: parseInt(q.area), sqMeters: 0, totalImoveis: lookupData.total_imoveis, setor_censitario: lookupData.censitario });
            });
            if (activity.quadras.length > 0) {
                areaSelector.value = activity.quadras[0].area;
                areaSelector.dispatchEvent(new Event('change'));
            } else { if (quadrasLayer) map.removeLayer(quadrasLayer); }
            updateSidebar();
            closeModal();
            alert(`Atividade ${activityId} (${activityCycle}) carregada para edição.`);
        } catch (err) { alert("Erro ao carregar detalhes: " + err.message); }
    }
});

async function searchHistory() {
    const searchId = document.getElementById('search-id-input').value;
    const startDate = document.getElementById('search-start-date').value;
    const endDate = document.getElementById('search-end-date').value;
    historyTableBody.innerHTML = '<tr><td colspan="5">Buscando...</td></tr>';
    try {
        const url = new URL(SCRIPT_URL);
        url.searchParams.append('action', 'getCompletedActivities');
        if (searchId) url.searchParams.append('id_atividade', searchId);
        if (startDate) url.searchParams.append('startDate', startDate);
        if (endDate) url.searchParams.append('endDate', endDate);
        const response = await fetch(url);
        const result = await response.json();
        if (!result.success) throw new Error(result.message);
        renderHistoryTable(result.data);
    } catch (error) {
        historyTableBody.innerHTML = `<tr><td colspan="5">Erro ao buscar: ${error.message}</td></tr>`;
    }
}

function renderHistoryTable(activities) {
    historyTableBody.innerHTML = '';
    if (activities.length === 0) {
        historyTableBody.innerHTML = '<tr><td colspan="5">Nenhum resultado encontrado.</td></tr>';
        return;
    }
    activities.forEach(act => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${act.id} (${act.ciclo})</td>
            <td>${act.data}</td>
            <td>${act.viatura}</td>
            <td>${act.ocorrencias || 'Nenhuma'}</td>
            <td class="action-buttons">
                <button class="btn-view-map" data-id="${act.id}" data-ciclo="${act.ciclo}">Ver Mapa</button>
            </td>
        `;
        historyTableBody.appendChild(row);
    });
}

historyTableBody.addEventListener('click', async (e) => {
    const target = e.target;
    if (target.classList.contains('btn-view-map')) {
        const activityId = target.dataset.id;
        const activityCycle = target.dataset.ciclo;
        if (!activityId || !activityCycle) return;
        try {
            const url = new URL(SCRIPT_URL);
            url.searchParams.append('action', 'getActivityDetails');
            url.searchParams.append('id_atividade', activityId);
            url.searchParams.append('ciclo', activityCycle);
            const response = await fetch(url);
            const result = await response.json();
            if (!result.success) throw new Error(result.message);
            
            const activity = result.data;
            const statusMap = activity.statusMap;
            closeModal();
            
            // --- INÍCIO DA CORREÇÃO ---
            // 1. Preenche o formulário com os dados da atividade visualizada
            document.getElementById('atividade-id').value = activity.id;
            document.querySelectorAll('input[name="ciclo"]').forEach(cb => { cb.checked = (activity.ciclo === cb.value); });
            document.getElementById('veiculo-select').value = activity.veiculo;
            document.getElementById('produto-select').value = activity.produto;
            document.getElementById('motorista-input').value = activity.motorista;
            document.getElementById('operador-input').value = activity.operador;
            selectedBairros.clear();
            if (activity.bairros) activity.bairros.split(',').forEach(b => selectedBairros.add(b.trim()));
            renderBairroTags();
            
            // Limpa o mapa e a seleção
            if (quadrasLayer) map.removeLayer(quadrasLayer);
            selectedQuadras.clear();

            const quadrasDaAtividade = activity.quadras.map(q => `${q.area}-${q.id}`);
            const areasParaCarregar = [...new Set(activity.quadras.map(q => q.area))];
            let allFeatures = [];
            for (const areaId of areasParaCarregar) {
                try {
                    const res = await fetch(`data/${areaId}.geojson?v=${new Date().getTime()}`);
                    const areaData = await res.json();
                    const featuresFiltradas = areaData.features.filter(f => quadrasDaAtividade.includes(`${getAreaId(f)}-${getQuadraId(f)}`));
                    allFeatures.push(...featuresFiltradas);
                } catch (fetchError) { console.warn(`Não foi possível carregar a área ${areaId}.`); }
            }
            if (allFeatures.length === 0) { alert("Nenhuma geometria de quadra foi encontrada para esta atividade."); return; }
            const featureCollection = { type: "FeatureCollection", features: allFeatures };
            
            // 2. Desenha o mapa e popula 'selectedQuadras' ao mesmo tempo
            quadrasLayer = L.geoJSON(featureCollection, {
                style: (feature) => {
                    const areaId = getAreaId(feature);
                    const quadraId = getQuadraId(feature);
                    const compositeKey = `${areaId}-${quadraId}`;
                    const status = statusMap[compositeKey] || 'Pendente';
                    const fillColor = status === 'Trabalhada' ? '#28a745' : '#dc3545';
                    return { color: getColorForArea(areaId), weight: 2, opacity: 1, fillColor: fillColor, fillOpacity: 0.6 };
                },
                onEachFeature: (feature, layer) => {
                    const quadraId = getQuadraId(feature);
                    const areaId = getAreaId(feature);
                    const compositeKey = `${areaId}-${quadraId}`;
                    const lookupData = imoveisLookup[compositeKey] || { total_imoveis: 0, censitario: 'N/A' };
                    let areaInSqMeters = 0;
                    try {
                        const latlngs = layer.getLatLngs();
                        const coordsToCalc = Array.isArray(latlngs[0][0]) ? latlngs[0][0] : latlngs[0];
                        areaInSqMeters = calculatePolygonArea(coordsToCalc);
                    } catch(e) {}
                    selectedQuadras.set(compositeKey, { id: quadraId, area: areaId, sqMeters: areaInSqMeters, totalImoveis: lookupData.total_imoveis, setor_censitario: lookupData.censitario });
                    if (quadraId !== null) {
                        layer.bindTooltip(quadraId.toString(), { permanent: true, direction: 'center', className: 'quadra-label' }).openTooltip();
                    }
                }
            }).addTo(map);
            if (quadrasLayer.getBounds().isValid()) map.fitBounds(quadrasLayer.getBounds());
            
            // 3. Atualiza a sidebar com os dados calculados
            updateSidebar();
            // --- FIM DA CORREÇÃO ---

        } catch (err) {
            alert("Erro ao carregar o mapa da atividade: " + err.message);
        }
    }
});

// --- RESTANTE DAS FUNÇÕES (sem alterações) ---
function getColorForArea(areaId) { if (!areaId) return '#777'; const hue = (areaId * 137.508) % 360; return `hsl(${hue}, 80%, 50%)`; }
function getQuadraId(feature) { if (feature.properties && feature.properties.title) try { return parseInt(feature.properties.title.replace('QUADRA:', '').trim(), 10); } catch (e) { return null; } return null; }
function getAreaId(feature) { if(feature.properties && feature.properties.description) try { return parseInt(feature.properties.description.replace('ÁREA:', '').trim(), 10); } catch(e) { return null; } return null; }
function calculatePolygonArea(latlngs) { if (!latlngs || latlngs.length < 3) return 0; let area = 0.0; const R = 6378137; for (let i = 0; i < latlngs.length; i++) { let p1 = latlngs[i]; let p2 = latlngs[(i + 1) % latlngs.length]; area += (p2.lng * Math.PI / 180 - p1.lng * Math.PI / 180) * (2 + Math.sin(p1.lat * Math.PI / 180) + Math.sin(p2.lat * Math.PI / 180)); } return Math.abs(area * R * R / 2.0); }

function updateSidebar() {
    quadrasSelecionadasList.innerHTML = ''; let totalArea = 0; let totalImoveis = 0;
    const sortedQuadras = Array.from(selectedQuadras.values()).sort((a, b) => (a.area - b.area) || (a.id - b.id));
    sortedQuadras.forEach(quadra => {
        totalArea += quadra.sqMeters; totalImoveis += quadra.totalImoveis;
        const li = document.createElement('li'); li.style = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;';
        li.innerHTML = `<span>Área ${quadra.area} - Q ${quadra.id} (${quadra.totalImoveis} imóveis)</span><button class="remove-quadra-btn" data-key="${quadra.area}-${quadra.id}" style="width: auto; padding: 2px 8px; margin: 0; background-color: #dc3545; font-size: 12px;">X</button>`;
        quadrasSelecionadasList.appendChild(li);
    });
    countSpan.textContent = selectedQuadras.size; document.getElementById('total-area').textContent = totalArea.toFixed(2); document.getElementById('total-imoveis').textContent = totalImoveis;
}

document.getElementById('quadras-list').addEventListener('click', function(e) {
    if (e.target && e.target.classList.contains('remove-quadra-btn')) {
        const key = e.target.dataset.key; selectedQuadras.delete(key);
        if (quadrasLayer) quadrasLayer.setStyle(getStyleForFeature);
        updateSidebar();
    }
});

function getStyleForFeature(feature) {
    const quadraId = getQuadraId(feature); const areaId = getAreaId(feature);
    const borderColor = getColorForArea(areaId); const compositeKey = `${areaId}-${quadraId}`;
    return selectedQuadras.has(compositeKey) ? { color: borderColor, weight: 3, opacity: 1, fillColor: '#ffc107', fillOpacity: 0.7 } : { color: borderColor, weight: 2, opacity: 0.8, fillColor: '#6c757d', fillOpacity: 0.3 };
}

function onQuadraClick(e) {
    const layer = e.target; const id = getQuadraId(layer.feature); const areaId = getAreaId(layer.feature);
    if (id === null || areaId === null) return;
    const compositeKey = `${areaId}-${id}`;
    if (selectedQuadras.has(compositeKey)) { selectedQuadras.delete(compositeKey); }
    else {
        let areaInSqMeters = 0;
        try { const latlngs = layer.getLatLngs(); const coordsToCalc = Array.isArray(latlngs[0][0]) ? latlngs[0][0] : latlngs[0]; areaInSqMeters = calculatePolygonArea(coordsToCalc); }
        catch (calcError) { areaInSqMeters = 0; }
        const lookupData = imoveisLookup[compositeKey];
        const totalImoveis = lookupData ? lookupData.total_imoveis : 0;
        const setorCensitario = lookupData ? lookupData.censitario : 'N/A';
        selectedQuadras.set(compositeKey, { id, area: areaId, sqMeters: areaInSqMeters, totalImoveis, setor_censitario: setorCensitario });
    }
    layer.setStyle(getStyleForFeature(layer.feature));
    updateSidebar();
}

function onEachFeature(feature, layer) {
    layer.on('click', onQuadraClick); const quadraId = getQuadraId(feature);
    if (quadraId !== null) layer.bindTooltip(quadraId.toString(), { permanent: true, direction: 'center', className: 'quadra-label' }).openTooltip();
}

function setupAutocomplete(inputId, listId, sourceArray, onSelectCallback) {
    const input = document.getElementById(inputId); const listContainer = document.getElementById(listId);
    input.addEventListener("input", function() {
        closeAllLists(listId); const val = this.value; if (!val) { listContainer.style.display = 'none'; return; }
        listContainer.innerHTML = ''; listContainer.style.display = "block";
        sourceArray.filter(item => item.toUpperCase().includes(val.toUpperCase())).forEach(item => {
            const b = document.createElement("DIV");
            b.innerHTML = item.replace(new RegExp(val, "gi"), "<strong>$&</strong>");
            b.addEventListener("click", function() { onSelectCallback(item); closeAllLists(); });
            listContainer.appendChild(b);
        });
    });
    function closeAllLists(exceptListId) { document.querySelectorAll(".autocomplete-items").forEach(item => { if (item.id !== exceptListId) item.style.display = 'none'; }); }
    document.addEventListener("click", e => { if (!e.target.closest('.autocomplete-container')) closeAllLists(); });
}

function renderBairroTags() {
    const container = document.getElementById('bairros-selecionados-container');
    container.innerHTML = '';
    selectedBairros.forEach(bairro => {
        const tag = document.createElement('div'); tag.className = 'bairro-tag';
        tag.innerHTML = `<span>${bairro}</span><span class="remove-tag" data-bairro="${bairro}">×</span>`;
        container.appendChild(tag);
    });
}

document.getElementById('bairros-selecionados-container').addEventListener('click', function(e) {
    if (e.target && e.target.classList.contains('remove-tag')) {
        selectedBairros.delete(e.target.dataset.bairro); renderBairroTags();
    }
});

async function popularDadosIniciais() {
    try {
        const [agentesRes, bairrosRes, imoveisRes, lastActivityRes] = await Promise.all([
            fetch(AGENTES_API_URL), fetch(BAIRROS_API_URL), fetch('data/imoveis_lookup.json'),
            fetch(`${SCRIPT_URL}?action=getLastActivityData`)
        ]);
        const agentesData = await agentesRes.json(); const bairrosData = await bairrosRes.json(); imoveisLookup = await imoveisRes.json();
        const lastActivityData = await lastActivityRes.json();
        if (agentesData.error) throw new Error(agentesData.error);
        if (bairrosData.error || !bairrosData.agentes) throw new Error(`API de Bairros: ${bairrosData.error || 'formato inválido'}`);
        setupAutocomplete('motorista-input', 'motorista-list', agentesData.agentes, val => { document.getElementById('motorista-input').value = val; });
        setupAutocomplete('operador-input', 'operador-list', agentesData.agentes, val => { document.getElementById('operador-input').value = val; });
        setupAutocomplete('bairro-input', 'bairro-list', bairrosData.agentes, bairro => { selectedBairros.add(bairro); renderBairroTags(); document.getElementById('bairro-input').value = ''; });
        if (lastActivityData.success && lastActivityData.data) {
            const data = lastActivityData.data;
            document.getElementById('veiculo-select').value = data.veiculo || '';
            document.getElementById('produto-select').value = data.produto || '';
            document.getElementById('motorista-input').value = data.motorista || '';
            document.getElementById('operador-input').value = data.operador || '';
            if (data.bairros) {
                data.bairros.split(',').forEach(b => selectedBairros.add(b.trim()));
                renderBairroTags();
            }
        }
        document.getElementById('motorista-input').placeholder = "Digite para buscar...";
        document.getElementById('operador-input').placeholder = "Digite para buscar...";
        document.getElementById('bairro-input').placeholder = "Digite para buscar...";
    } catch(e) { alert("Erro ao carregar dados iniciais: " + e.message); }
}

areaSelector.addEventListener('change', async (e) => {
    const areaId = e.target.value; if (!areaId) return; if (quadrasLayer) map.removeLayer(quadrasLayer);
    try {
        const quadrasResponse = await fetch(`data/${areaId}.geojson?v=${new Date().getTime()}`);
        if (!quadrasResponse.ok) throw new Error(`Arquivo da Área ${areaId} não encontrado.`);
        const quadrasGeoJSON = await quadrasResponse.json();
        quadrasLayer = L.geoJSON(quadrasGeoJSON, { style: getStyleForFeature, onEachFeature: onEachFeature }).addTo(map);
        if(quadrasLayer.getBounds().isValid()) map.fitBounds(quadrasLayer.getBounds());
    } catch (error) { alert(`Erro ao carregar dados da área: ${error.message}`); }
});

document.getElementById('save-activity').addEventListener('click', async () => {
    const ciclosSelecionados = Array.from(document.querySelectorAll('input[name="ciclo"]:checked')).map(cb => cb.value);
    const payload = {
        action: 'createActivity',
        id_atividade: document.getElementById('atividade-id').value.trim(),
        ciclos: ciclosSelecionados,
        veiculo: document.getElementById('veiculo-select').value,
        produto: document.getElementById('produto-select').value,
        motorista: document.getElementById('motorista-input').value.trim(),
        operador: document.getElementById('operador-input').value.trim(),
        bairros: Array.from(selectedBairros).join(', '),
        quadras: Array.from(selectedQuadras.values())
    };
    if (!payload.id_atividade || payload.ciclos.length === 0 || !payload.veiculo || !payload.produto || !payload.bairros || !payload.motorista || !payload.operador || payload.quadras.length === 0) {
        alert("Preencha todos os campos, incluindo ciclo, bairro e quadras."); return;
    }
    try {
        await fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) });
        alert("Atividade(s) enviada(s) para salvamento!");
        document.getElementById('atividade-id').value = '';
        document.querySelectorAll('input[name="ciclo"]:checked').forEach(cb => cb.checked = false);
        document.getElementById('veiculo-select').value = '';
        document.getElementById('produto-select').value = '';
        document.getElementById('motorista-input').value = '';
        document.getElementById('operador-input').value = '';
        document.getElementById('bairro-input').value = '';
        selectedBairros.clear(); renderBairroTags();
        selectedQuadras.clear();
        if (quadrasLayer) quadrasLayer.setStyle(getStyleForFeature);
        updateSidebar();
    } catch (error) {
        alert("Falha grave de rede.");
    }
});

function popularSeletorDeAreas() {
    for (let i = 1; i <= TOTAL_AREAS; i++) {
        const option = document.createElement('option');
        option.value = i; option.textContent = `Área ${i}`;
        areaSelector.appendChild(option);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    popularSeletorDeAreas();
    popularDadosIniciais();
    openModalBtn.addEventListener('click', openManageModal);
    closeModalBtn.addEventListener('click', closeModal);
    window.addEventListener('click', e => { if (e.target === manageModal) closeModal(); });
    searchHistoryBtn.addEventListener('click', searchHistory);
});