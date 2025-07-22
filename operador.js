// Registra o Service Worker para habilitar as funcionalidades offline (PWA)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then(registration => {
        console.log('Service Worker registrado com sucesso:', registration);
      })
      .catch(error => {
        console.log('Falha ao registrar Service Worker:', error);
      });
  });
}

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxB3aZOVBhGSebSvsrYDB7ShVAqMekg12a437riystZtTHmyUPMjbJd_GzLdw4cOs7k/exec";

// --- LÓGICA DO BANCO DE DADOS LOCAL ---
let db;
function initDB() {
    return new Promise((resolve, reject) => {
        // Versão 2 para permitir a atualização da estrutura (keyPath)
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
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
}).addTo(map);

let quadrasLayer;
let activityStatus = {};
let currentActivityId = null;
let currentActivityCycle = null;
let userMarker = null;
let watchId = null;

function getQuadraId(feature) { if (feature.properties && feature.properties.title) try { return parseInt(feature.properties.title.replace('QUADRA:', '').trim(), 10); } catch (e) { return null; } return null; }
function getAreaId(feature) { if (feature.properties && feature.properties.description) try { return parseInt(feature.properties.description.replace('ÁREA:', '').trim(), 10); } catch (e) { return null; } return null; }
function getColorForArea(areaId) { if (!areaId) return '#777'; const hue = (areaId * 137.508) % 360; return `hsl(${hue}, 80%, 50%)`; }

function getStyle(feature) {
    const id = getQuadraId(feature);
    const areaId = getAreaId(feature);
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
    const transaction = db.transaction(['sync_queue'], 'readonly');
    const store = transaction.objectStore('sync_queue');
    const countRequest = store.count();
    countRequest.onsuccess = () => {
        const count = countRequest.result;
        badge.textContent = count > 0 ? count : '';
        badge.classList.toggle('visible', count > 0);
    };
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
    const id = getQuadraId(feature);
    const areaId = getAreaId(feature);
    if (id === null || areaId === null) return;
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
    if (isSyncing) return;
    updateStatusIndicator();
    if (!navigator.onLine || !db) return;

    const syncBtn = document.getElementById('sync-btn');
    const transaction = db.transaction(['sync_queue'], 'readonly');
    const allUpdatesRequest = transaction.objectStore('sync_queue').getAll();
    allUpdatesRequest.onsuccess = async () => {
        const updates = allUpdatesRequest.result;
        if (updates.length === 0) return;
        isSyncing = true;
        syncBtn.disabled = true;
        syncBtn.classList.add('syncing');
        updateStatusIndicator(true);
        const promises = updates.map(upd => fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: 'updateStatus', id_atividade: upd.id_atividade, ciclo: upd.ciclo, id_quadra: upd.id_quadra, status: upd.status }) }));
        try {
            await Promise.all(promises);
            const clearTransaction = db.transaction(['sync_queue'], 'readwrite');
            const store = clearTransaction.objectStore('sync_queue');
            store.clear();
            clearTransaction.oncomplete = () => { updateSyncBadge(); };
        } catch (error) {
            alert("Algumas atualizações não puderam ser enviadas.");
        } finally {
            isSyncing = false;
            syncBtn.disabled = false;
            syncBtn.classList.remove('syncing');
            updateStatusIndicator();
        }
    };
}

let statusIndicatorTimeout;
function updateStatusIndicator(syncing = false) {
    const indicator = document.getElementById('status-indicator'); if (!indicator) return;
    clearTimeout(statusIndicatorTimeout);
    indicator.classList.add('visible');
    if (syncing) { indicator.textContent = 'Sincronizando...'; indicator.className = 'visible syncing'; }
    else if (navigator.onLine) { indicator.textContent = 'Conectado'; indicator.className = 'visible'; }
    else { indicator.textContent = 'Offline'; indicator.className = 'visible offline'; }
    if (navigator.onLine && !syncing) { statusIndicatorTimeout = setTimeout(() => { indicator.classList.remove('visible'); }, 3000); }
}

async function carregarAtividade() {
    const selectedValue = document.getElementById('atividade-select').value;
    if (quadrasLayer) map.removeLayer(quadrasLayer);

    if (!selectedValue) {
        currentActivityId = null;
        currentActivityCycle = null;
        document.getElementById('progress-container').style.display = 'none';
        return;
    }
    
    const [id, ciclo] = selectedValue.split('::');
    currentActivityId = id;
    currentActivityCycle = ciclo;
    
    const loadingPopup = L.popup({ closeButton: false, autoClose: false }).setLatLng(map.getCenter()).setContent(`Carregando...`).openOn(map);
    try {
        const url = new URL(SCRIPT_URL);
        url.searchParams.append('action', 'getActivity');
        url.searchParams.append('id_atividade', currentActivityId);
        url.searchParams.append('ciclo', currentActivityCycle);
        
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Erro de rede: ${response.statusText}`);
        const result = await response.json();
        if (!result.success) throw new Error(result.message);
        
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
                const featuresFiltradas = areaData.features.filter(f => {
                    const quadraId = getQuadraId(f);
                    const areaIdFeature = getAreaId(f);
                    const compositeKey = `${areaIdFeature}-${quadraId}`;
                    return quadrasDaAtividade.includes(compositeKey);
                });
                allFeatures.push(...featuresFiltradas);
            } catch(e) { console.error(`Erro ao processar Área ${areaId}:`, e); }
        }
        
        map.closePopup(loadingPopup);
        if(allFeatures.length === 0) { alert("Quadras não encontradas nos arquivos de mapa."); updateProgressCounter(); return; }

        const featureCollection = { type: "FeatureCollection", features: allFeatures };
        quadrasLayer = L.geoJSON(featureCollection, { style: getStyle, onEachFeature: onEachFeature }).addTo(map);
        if (quadrasLayer.getBounds().isValid()) map.fitBounds(quadrasLayer.getBounds());
        updateProgressCounter();
    } catch(error) {
        map.closePopup(loadingPopup);
        alert(`Falha ao carregar atividade: ${error.message}`);
        document.getElementById('progress-container').style.display = 'none';
    }
}

async function popularAtividadesPendentes() {
    const seletor = document.getElementById('atividade-select');
    try {
        const url = new URL(SCRIPT_URL);
        url.searchParams.append('action', 'getPendingActivities');
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Erro de rede: ${response.statusText}`);
        const result = await response.json();
        if (!result.success) throw new Error(result.message);
        seletor.innerHTML = '<option value="">Selecione uma atividade...</option>';
        if (result.data.length === 0) {
            const option = document.createElement('option');
            option.textContent = "Nenhuma atividade pendente";
            option.disabled = true;
            seletor.appendChild(option);
        } else {
            result.data.forEach(activity => {
                const option = document.createElement('option');
                option.value = `${activity.id}::${activity.ciclo}`;
                option.textContent = `Atividade ${activity.id} (${activity.ciclo}) - ${activity.veiculo}`;
                option.title = `Produto: ${activity.produto} | Dupla: ${activity.motorista} e ${activity.operador}`;
                seletor.appendChild(option);
            });
        }
    } catch(error) {
        seletor.innerHTML = '<option value="">Erro ao carregar</option>';
        alert("Não foi possível buscar a lista de atividades: " + error.message);
    }
}

function updateProgressCounter() {
    const progressContainer = document.getElementById('progress-container');
    if (!currentActivityId) {
        progressContainer.style.display = 'none';
        return;
    }
    const quadras = Object.values(activityStatus);
    const totalQuadras = quadras.length;
    const quadrasTrabalhadas = quadras.filter(status => status === 'Trabalhada').length;
    document.getElementById('progress-counter').textContent = `${quadrasTrabalhadas} / ${totalQuadras}`;
    progressContainer.style.display = 'flex';
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initDB();
        
        document.getElementById('atividade-select').addEventListener('change', carregarAtividade);
        document.getElementById('sync-btn').addEventListener('click', syncOfflineUpdates);
        window.addEventListener('online', syncOfflineUpdates);
        window.addEventListener('offline', updateStatusIndicator);

        const trackBtn = document.getElementById('track-btn');
        function handleLocationUpdate(position) {
            const { latitude, longitude, heading } = position.coords;
            const userLatLng = L.latLng(latitude, longitude);
            const iconHtml = `<svg style="transform: rotate(${heading || 0}deg);" viewBox="0 0 24 24" width="24px" height="24px" fill="#007bff" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>`;
            const cssIcon = L.divIcon({ html: iconHtml, className: 'user-location-icon', iconSize: [24, 24], iconAnchor: [12, 12] });
            if (!userMarker) {
                userMarker = L.marker(userLatLng, { icon: cssIcon }).addTo(map);
                map.setView(userLatLng, 18);
            } else {
                userMarker.setLatLng(userLatLng);
                userMarker.setIcon(cssIcon);
            }
        }
        function handleLocationError(error) {
            console.error("Erro de Geolocalização:", error);
            alert('Não foi possível obter sua localização contínua.');
            stopTracking();
        }
        function startTracking() {
            if (!navigator.geolocation) return alert('Geolocalização não suportada.');
            trackBtn.classList.add('tracking');
            trackBtn.title = "Parar Rastreamento";
            watchId = navigator.geolocation.watchPosition(handleLocationUpdate, handleLocationError, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
        }
        function stopTracking() {
            if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
            if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
            trackBtn.classList.remove('tracking');
            trackBtn.title = "Iniciar Rastreamento";
        }
        trackBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (watchId !== null) {
                stopTracking();
            } else {
                startTracking();
            }
        });
        
        await popularAtividadesPendentes();
        updateStatusIndicator();
        await updateSyncBadge();
        
    } catch (error) {
        alert("Falha na inicialização: " + error.message);
    }
});