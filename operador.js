// Registra o Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then(reg => console.log('Service Worker registrado:', reg))
      .catch(err => console.log('Falha ao registrar SW:', err));
  });
}

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxB3aZOVBhGSebSvsrYDB7ShVAqMekg12a437riystZtTHmyUPMjbJd_GzLdw4cOs7k/exec";

// --- LÓGICA DO BANCO DE DADOS LOCAL ---
let db;
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('atividadesDB', 2);
        request.onupgradeneeded = e => {
            const dbInstance = e.target.result;
            if (!dbInstance.objectStoreNames.contains('sync_queue')) {
                dbInstance.createObjectStore('sync_queue', { keyPath: 'id_sync' });
            }
        };
        request.onsuccess = e => { db = e.target.result; resolve(db); };
        request.onerror = e => { reject(e.target.error); };
    });
}

// --- LÓGICA PRINCIPAL DA APLICAÇÃO ---
const map = L.map('map', { zoomControl: false }).setView([-23.1791, -45.8872], 13);
L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let quadrasLayer, activityStatus = {}, currentActivityId = null, currentActivityCycle = null, currentActivityData = {}, userMarker = null, watchId = null;
const bulletinModal = document.getElementById('bulletin-modal');
const bulletinForm = document.getElementById('bulletin-form');
const finishBtn = document.getElementById('finish-btn');
const closeBulletinBtn = bulletinModal.querySelector('.modal-close');

function getQuadraId(feature) { if (feature.properties && feature.properties.title) try { return parseInt(feature.properties.title.replace('QUADRA:', '').trim(), 10); } catch (e) { return null; } return null; }
function getAreaId(feature) { if (feature.properties && feature.properties.description) try { return parseInt(feature.properties.description.replace('ÁREA:', '').trim(), 10); } catch (e) { return null; } return null; }
function getColorForArea(areaId) { if (!areaId) return '#777'; const hue = (areaId * 137.508) % 360; return `hsl(${hue}, 80%, 50%)`; }
function getStyle(feature) {
    const id = getQuadraId(feature); const areaId = getAreaId(feature);
    if (id === null || areaId === null) return { opacity: 0, fillOpacity: 0 };
    const compositeKey = `${areaId}-${id}`;
    if (!activityStatus[compositeKey]) return { opacity: 0, fillOpacity: 0 };
    const status = activityStatus[compositeKey];
    const borderColor = getColorForArea(areaId);
    return status === 'Trabalhada' ? { color: borderColor, weight: 2, opacity: 1, fillColor: "#28a745", fillOpacity: 0.6 } : { color: borderColor, weight: 2, opacity: 1, fillColor: "#dc3545", fillOpacity: 0.6 };
}

async function updateSyncBadge() {
    if (!db) return;
    const badge = document.getElementById('sync-badge');
    const clearBtn = document.getElementById('clear-btn');
    const transaction = db.transaction(['sync_queue'], 'readonly');
    const store = transaction.objectStore('sync_queue');
    const countRequest = store.count();
    countRequest.onsuccess = () => {
        const count = countRequest.result;
        badge.textContent = count > 0 ? count : '';
        badge.classList.toggle('visible', count > 0);
        clearBtn.disabled = count === 0;
    };
}

async function clearPendingUpdates() {
    if (!db) return;
    if (confirm("Tem certeza que deseja limpar todas as alterações pendentes? Esta ação irá recarregar o mapa para o estado original da atividade.")) {
        const transaction = db.transaction(['sync_queue'], 'readwrite');
        const store = transaction.objectStore('sync_queue');
        const clearRequest = store.clear();
        clearRequest.onsuccess = () => {
            console.log("Fila de sincronização local foi limpa.");
            updateSyncBadge();
            // Recarrega a atividade para reverter as mudanças visuais no mapa
            if (currentActivityId) {
                carregarAtividade();
            }
        };
        clearRequest.onerror = (e) => {
            alert("Não foi possível limpar as alterações pendentes: " + e.target.error);
        };
    }
}


window.atualizarStatusQuadra = async function(id, areaId, novoStatus) {
    const compositeKey = `${areaId}-${id}`;
    const statusAnterior = activityStatus[compositeKey];
    activityStatus[compositeKey] = novoStatus;
    if (quadrasLayer) quadrasLayer.setStyle(getStyle);
    updateProgressCounter();
    if (!db) {
        alert("Erro: Banco de dados local não está disponível.");
        activityStatus[compositeKey] = statusAnterior;
        if (quadrasLayer) quadrasLayer.setStyle(getStyle);
        updateProgressCounter();
        return;
    }
    const transaction = db.transaction(['sync_queue'], 'readwrite');
    const store = transaction.objectStore('sync_queue');
    store.put({ id_sync: `${currentActivityId}-${currentActivityCycle}-${id}`, id_atividade: currentActivityId, ciclo: currentActivityCycle, id_quadra: id, status: novoStatus });
    transaction.oncomplete = () => { console.log(`Quadra ${compositeKey} na fila.`); updateSyncBadge(); };
    transaction.onerror = () => {
        alert("Erro ao salvar localmente.");
        activityStatus[compositeKey] = statusAnterior;
        if (quadrasLayer) quadrasLayer.setStyle(getStyle);
        updateProgressCounter();
    };
}

function onEachFeature(feature, layer) {
    const id = getQuadraId(feature); const areaId = getAreaId(feature); if (id === null || areaId === null) return;
    const compositeKey = `${areaId}-${id}`;
    if (activityStatus[compositeKey]) {
        layer.on('click', () => {
            const statusAtual = activityStatus[compositeKey] || 'Pendente';
            const novoStatus = (statusAtual === 'Pendente') ? 'Trabalhada' : 'Pendente';
            window.atualizarStatusQuadra(id, areaId, novoStatus);
        });
    }
    if (id !== null) layer.bindTooltip(id.toString(), { permanent: true, direction: 'center', className: 'quadra-label' }).openTooltip();
}

let isSyncing = false;
async function syncOfflineUpdates() {
    if (isSyncing) return false;
    updateStatusIndicator();
    if (!navigator.onLine) { alert("Você está offline. Conecte-se à internet para enviar os dados."); return false; }
    if (!db) return false;
    const syncBtn = document.getElementById('sync-btn');
    const transaction = db.transaction(['sync_queue'], 'readonly');
    const allUpdatesRequest = transaction.objectStore('sync_queue').getAll();
    return new Promise(resolve => {
        allUpdatesRequest.onsuccess = async () => {
            const updates = allUpdatesRequest.result;
            if (updates.length === 0) { resolve(true); return; }
            isSyncing = true; syncBtn.disabled = true; syncBtn.classList.add('syncing'); updateStatusIndicator(true);
            const promises = updates.map(upd => fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: 'updateStatus', id_atividade: upd.id_atividade, ciclo: upd.ciclo, id_quadra: upd.id_quadra, status: upd.status }) }));
            try {
                await Promise.all(promises);
                const clearTransaction = db.transaction(['sync_queue'], 'readwrite');
                clearTransaction.objectStore('sync_queue').clear();
                clearTransaction.oncomplete = () => { updateSyncBadge(); };
                resolve(true);
            } catch (error) {
                alert("Falha ao sincronizar. Verifique sua conexão e tente novamente.");
                resolve(false);
            } finally {
                isSyncing = false; syncBtn.disabled = false; syncBtn.classList.remove('syncing'); updateStatusIndicator();
            }
        };
        allUpdatesRequest.onerror = () => resolve(false);
    });
}

let statusIndicatorTimeout;
function updateStatusIndicator(syncing = false) {
    const indicator = document.getElementById('status-indicator'); if (!indicator) return;
    clearTimeout(statusIndicatorTimeout); indicator.classList.add('visible');
    if (syncing) { indicator.textContent = 'Sincronizando...'; indicator.className = 'visible syncing'; }
    else if (navigator.onLine) { indicator.textContent = 'Conectado'; indicator.className = 'visible'; }
    else { indicator.textContent = 'Offline'; indicator.className = 'visible offline'; }
    if (navigator.onLine && !syncing) { statusIndicatorTimeout = setTimeout(() => { indicator.classList.remove('visible'); }, 3000); }
}

async function carregarAtividade() {
    const selectedValue = document.getElementById('atividade-select').value;
    if (quadrasLayer) map.removeLayer(quadrasLayer);
    if (!selectedValue) {
        currentActivityId = null; currentActivityCycle = null;
        document.getElementById('progress-container').style.display = 'none';
        finishBtn.style.display = 'none'; return;
    }
    const [id, ciclo] = selectedValue.split('::');
    currentActivityId = id; currentActivityCycle = ciclo;
    const loadingPopup = L.popup({ closeButton: false, autoClose: false }).setLatLng(map.getCenter()).setContent(`Carregando...`).openOn(map);
    try {
        const url = new URL(SCRIPT_URL); url.searchParams.append('action', 'getActivity');
        url.searchParams.append('id_atividade', currentActivityId);
        url.searchParams.append('ciclo', currentActivityCycle);
        const response = await fetch(url);
        const result = await response.json(); if (!result.success) throw new Error(result.message);
        activityStatus = result.data.quadras;
        const areasParaCarregar = result.data.areas;
        const quadrasDaAtividade = Object.keys(activityStatus);
        if (areasParaCarregar.length === 0) { alert("Nenhuma quadra para esta atividade."); map.closePopup(loadingPopup); updateProgressCounter(); return; }
        const allFeatures = [];
        for (const areaId of areasParaCarregar) {
            try {
                const res = await fetch(`data/${areaId}.geojson?v=${new Date().getTime()}`);
                if (!res.ok) continue;
                const areaData = await res.json();
                const featuresFiltradas = areaData.features.filter(f => quadrasDaAtividade.includes(`${getAreaId(f)}-${getQuadraId(f)}`));
                allFeatures.push(...featuresFiltradas);
            } catch(e) { console.error(`Erro ao processar Área ${areaId}:`, e); }
        }
        map.closePopup(loadingPopup); if(allFeatures.length === 0) { alert("Quadras não encontradas nos arquivos de mapa."); updateProgressCounter(); return; }
        const featureCollection = { type: "FeatureCollection", features: allFeatures };
        quadrasLayer = L.geoJSON(featureCollection, { style: getStyle, onEachFeature: onEachFeature }).addTo(map);
        if (quadrasLayer.getBounds().isValid()) map.fitBounds(quadrasLayer.getBounds());
        updateProgressCounter();
        finishBtn.style.display = 'flex';
    } catch(error) {
        map.closePopup(loadingPopup); alert(`Falha ao carregar atividade: ${error.message}`);
        document.getElementById('progress-container').style.display = 'none';
    }
}

async function popularAtividadesPendentes() {
    const seletor = document.getElementById('atividade-select');
    try {
        const url = new URL(SCRIPT_URL); url.searchParams.append('action', 'getPendingActivities');
        const response = await fetch(url);
        const result = await response.json(); if (!result.success) throw new Error(result.message);
        seletor.innerHTML = '<option value="">Selecione uma atividade...</option>';
        if (result.data.length === 0) {
            const option = document.createElement('option'); option.textContent = "Nenhuma atividade pendente"; option.disabled = true; seletor.appendChild(option);
        } else {
            const activitiesData = result.data;
            activitiesData.forEach(activity => {
                const option = document.createElement('option');
                option.value = `${activity.id}::${activity.ciclo}`;
                option.textContent = `Atividade ${activity.id} (${activity.ciclo}) - ${activity.veiculo}`;
                option.title = `Produto: ${activity.produto} | Dupla: ${activity.motorista} e ${activity.operador}`;
                seletor.appendChild(option);
            });
            seletor.addEventListener('change', () => {
                const selectedValue = seletor.value;
                currentActivityData = activitiesData.find(act => `${act.id}::${act.ciclo}` === selectedValue) || {};
                carregarAtividade();
            });
        }
    } catch(error) {
        seletor.innerHTML = '<option value="">Erro ao carregar</option>';
        alert("Não foi possível buscar a lista de atividades: " + error.message);
    }
}

function updateProgressCounter() {
    const progressContainer = document.getElementById('progress-container'); if (!currentActivityId) { progressContainer.style.display = 'none'; return; }
    const quadras = Object.values(activityStatus); const totalQuadras = quadras.length;
    const quadrasTrabalhadas = quadras.filter(status => status === 'Trabalhada').length;
    document.getElementById('progress-counter').textContent = `${quadrasTrabalhadas} / ${totalQuadras}`;
    progressContainer.style.display = 'flex';
}

function timeToMinutes(timeStr) { if (!timeStr) return 0; const [h, m] = timeStr.split(':').map(Number); return (h * 60) + (m || 0); }
function minutesToTime(totalMinutes) { if (isNaN(totalMinutes) || totalMinutes < 0) return "00:00"; const h = Math.floor(totalMinutes / 60); const m = Math.round(totalMinutes % 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }

function setupBulletinCalculations() {
    const fields = {
        volInicial: document.getElementById('bulletin-vol-inicial'),
        volFinal: document.getElementById('bulletin-vol-final'),
        consumo: document.getElementById('bulletin-consumo'),
        horaInicio: document.getElementById('bulletin-hora-inicio'),
        horaTermino: document.getElementById('bulletin-hora-termino'),
        interrupcao: document.getElementById('bulletin-interrupcao'),
        tempoTotal: document.getElementById('bulletin-tempo-total'),
        odoInicio: document.getElementById('bulletin-odo-inicio'),
        odoTermino: document.getElementById('bulletin-odo-termino'),
        kmRodado: document.getElementById('bulletin-km-rodado')
    };
    const update = () => {
        fields.consumo.value = Math.max(0, (parseFloat(fields.volInicial.value) || 0) - (parseFloat(fields.volFinal.value) || 0));
        const duracao = Math.max(0, timeToMinutes(fields.horaTermino.value) - timeToMinutes(fields.horaInicio.value));
        fields.tempoTotal.value = minutesToTime(duracao + timeToMinutes(fields.interrupcao.value));
        fields.kmRodado.value = Math.max(0, (parseFloat(fields.odoTermino.value) || 0) - (parseFloat(fields.odoInicio.value) || 0));
    };
    Object.values(fields).forEach(el => el.addEventListener('input', update));
}

function openBulletinModal() {
    bulletinForm.reset();
    document.getElementById('bulletin-data').value = new Date().toLocaleDateString('pt-BR');
    document.getElementById('bulletin-viatura').value = currentActivityData.veiculo || '';
    document.getElementById('bulletin-inseticida').value = currentActivityData.produto || '';
    bulletinModal.style.display = 'flex';
}

function closeBulletinModal() {
    bulletinModal.style.display = 'none';
}

bulletinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitButton = bulletinForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Sincronizando quadras...';
    const quadrasSincronizadas = await syncOfflineUpdates();
    if (!quadrasSincronizadas) {
        alert("Não foi possível sincronizar. O boletim não foi enviado.");
        submitButton.disabled = false; submitButton.textContent = 'Enviar Boletim';
        return;
    }
    submitButton.textContent = 'Enviando boletim...';
    const payload = {
        action: 'submitBulletin', id_atividade: currentActivityId, ciclo: currentActivityCycle,
        patrimonio: document.getElementById('bulletin-patrimonio').value,
        viatura: document.getElementById('bulletin-viatura').value,
        inseticida: document.getElementById('bulletin-inseticida').value,
        vol_inicial: document.getElementById('bulletin-vol-inicial').value,
        vol_final: document.getElementById('bulletin-vol-final').value,
        consumo: document.getElementById('bulletin-consumo').value,
        hora_inicio: document.getElementById('bulletin-hora-inicio').value,
        temp_inicio: document.getElementById('bulletin-temp-inicio').value,
        hora_termino: document.getElementById('bulletin-hora-termino').value,
        temp_termino: document.getElementById('bulletin-temp-termino').value,
        tempo_interrupcao: document.getElementById('bulletin-interrupcao').value,
        tempo_aplicacao: document.getElementById('bulletin-tempo-total').value,
        km_rodado: document.getElementById('bulletin-km-rodado').value,
        ocorrencias: Array.from(document.querySelectorAll('input[name="ocorrencia"]:checked')).map(cb => cb.value).join(', '),
        observacao: document.getElementById('bulletin-obs').value
    };
    try {
        await fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) });
        alert("Boletim enviado com sucesso!");
        closeBulletinModal();
        popularAtividadesPendentes();
        if (quadrasLayer) map.removeLayer(quadrasLayer);
        document.getElementById('progress-container').style.display = 'none';
        finishBtn.style.display = 'none';
    } catch (error) {
        alert("As quadras foram salvas, mas houve um erro ao enviar o boletim.");
    } finally {
        submitButton.disabled = false; submitButton.textContent = 'Enviar Boletim';
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initDB();
        finishBtn.addEventListener('click', openBulletinModal);
        closeBulletinBtn.addEventListener('click', closeBulletinModal);
        window.addEventListener('click', e => { if (e.target === bulletinModal) closeBulletinModal(); });
        document.getElementById('atividade-select').addEventListener('change', () => {});
        document.getElementById('sync-btn').addEventListener('click', syncOfflineUpdates);
        document.getElementById('clear-btn').addEventListener('click', clearPendingUpdates);
        window.addEventListener('online', syncOfflineUpdates);
        window.addEventListener('offline', updateStatusIndicator);
        const trackBtn = document.getElementById('track-btn');
        function handleLocationUpdate(position) { /* ...código anterior... */ }
        function handleLocationError(error) { /* ...código anterior... */ }
        function startTracking() { /* ...código anterior... */ }
        function stopTracking() { /* ...código anterior... */ }
        trackBtn.addEventListener('click', (e) => { e.preventDefault(); if (watchId !== null) { stopTracking(); } else { startTracking(); } });
        setupBulletinCalculations();
        await popularAtividadesPendentes();
        updateStatusIndicator();
        await updateSyncBadge();
    } catch (error) {
        alert("Falha na inicialização: " + error.message);
    }
});