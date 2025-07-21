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
        const request = indexedDB.open('atividadesDB', 1);
        request.onupgradeneeded = e => {
            const dbInstance = e.target.result;
            if (!dbInstance.objectStoreNames.contains('sync_queue')) {
                dbInstance.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
            }
        };
        request.onsuccess = e => { db = e.target.result; resolve(db); };
        request.onerror = e => { reject(e.target.error); };
    });
}

// --- LÓGICA PRINCIPAL DA APLICAÇÃO ---
const map = L.map('map', { zoomControl: false }).setView([-23.1791, -45.8872], 13); // Desativa o controle de zoom padrão
L.control.zoom({ position: 'topright' }).addTo(map); // Adiciona o controle de zoom na direita
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
}).addTo(map);

let quadrasLayer;
let activityStatus = {};
let currentActivityId = null;
let userMarker = null;
let watchId = null;

function getQuadraId(feature) { if (feature.properties && feature.properties.title) try { return parseInt(feature.properties.title.replace('QUADRA:', '').trim(), 10); } catch (e) { return null; } return null; }
function getAreaId(feature) { if (feature.properties && feature.properties.description) try { return parseInt(feature.properties.description.replace('ÁREA:', '').trim(), 10); } catch (e) { return null; } return null; }
function getColorForArea(areaId) { if (!areaId) return '#777'; const hue = (areaId * 137.508) % 360; return `hsl(${hue}, 80%, 50%)`; }
function getStyle(feature) {
    const id = getQuadraId(feature); const areaId = getAreaId(feature);
    if (!activityStatus[id]) return { opacity: 0, fillOpacity: 0 };
    const status = activityStatus[id]; const borderColor = getColorForArea(areaId);
    return status === 'Trabalhada' ? { color: borderColor, weight: 2, opacity: 1, fillColor: "#28a745", fillOpacity: 0.6 } : { color: borderColor, weight: 2, opacity: 1, fillColor: "#dc3545", fillOpacity: 0.6 };
}

window.atualizarStatusQuadra = async function(id, novoStatus) {
    const statusAnterior = activityStatus[id]; activityStatus[id] = novoStatus;
    if (quadrasLayer) quadrasLayer.setStyle(getStyle);
    if (!db) { alert("Erro: Banco de dados local não está disponível."); activityStatus[id] = statusAnterior; if (quadrasLayer) quadrasLayer.setStyle(getStyle); return; }
    const transaction = db.transaction(['sync_queue'], 'readwrite');
    const store = transaction.objectStore('sync_queue');
    store.add({ id_atividade: currentActivityId, id_quadra: id, status: novoStatus, timestamp: new Date().getTime() });
    transaction.oncomplete = () => { console.log(`Quadra ${id} salva localmente.`); syncOfflineUpdates(); };
    transaction.onerror = () => { alert("Erro ao salvar localmente."); activityStatus[id] = statusAnterior; if (quadrasLayer) quadrasLayer.setStyle(getStyle); };
}

function onEachFeature(feature, layer) {
    const id = getQuadraId(feature);
    if (id !== null && activityStatus[id]) {
        layer.on('click', () => {
            const statusAtual = activityStatus[id] || 'Pendente';
            const novoStatus = (statusAtual === 'Pendente') ? 'Trabalhada' : 'Pendente';
            window.atualizarStatusQuadra(id, novoStatus);
        });
    }
    if (id !== null) layer.bindTooltip(id.toString(), { permanent: true, direction: 'center', className: 'quadra-label' }).openTooltip();
}

let syncTimeout;
function syncOfflineUpdates() {
    clearTimeout(syncTimeout);
    syncTimeout = setTimeout(async () => {
        updateStatusIndicator();
        if (!navigator.onLine || !db) return;
        const transaction = db.transaction(['sync_queue'], 'readwrite');
        const store = transaction.objectStore('sync_queue');
        const allUpdates = store.getAll();
        allUpdates.onsuccess = async () => {
            const updates = allUpdates.result; if (updates.length === 0) return;
            updateStatusIndicator(true);
            const promises = updates.map(upd => fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: 'updateStatus', id_atividade: upd.id_atividade, id_quadra: upd.id_quadra, status: upd.status }) }));
            try {
                await Promise.all(promises);
                db.transaction(['sync_queue'], 'readwrite').objectStore('sync_queue').clear();
            } catch (error) { console.error("Erro durante a sincronização.", error); } 
            finally { updateStatusIndicator(); }
        };
    }, 500); // Debounce de 500ms para evitar múltiplas sincronizações rápidas
}

let statusIndicatorTimeout;
function updateStatusIndicator(syncing = false) {
    const indicator = document.getElementById('status-indicator'); if (!indicator) return;
    clearTimeout(statusIndicatorTimeout);
    indicator.classList.add('visible');
    if (syncing) {
        indicator.textContent = 'Sincronizando...';
        indicator.className = 'visible syncing';
    } else if (navigator.onLine) {
        indicator.textContent = 'Conectado';
        indicator.className = 'visible';
    } else {
        indicator.textContent = 'Offline';
        indicator.className = 'visible offline';
    }
    if (navigator.onLine && !syncing) {
        statusIndicatorTimeout = setTimeout(() => {
            indicator.classList.remove('visible');
        }, 3000);
    }
}

async function carregarAtividade() {
    currentActivityId = document.getElementById('atividade-select').value; if (quadrasLayer) map.removeLayer(quadrasLayer); if (!currentActivityId) return;
    const loadingPopup = L.popup({ closeButton: false, autoClose: false }).setLatLng(map.getCenter()).setContent(`Carregando...`).openOn(map);
    try {
        const url = new URL(SCRIPT_URL); url.searchParams.append('action', 'getActivity'); url.searchParams.append('id_atividade', currentActivityId);
        const response = await fetch(url); if (!response.ok) throw new Error(`Erro de rede: ${response.statusText}`);
        const result = await response.json(); if (!result.success) throw new Error(result.message);
        activityStatus = result.data.quadras; const areasParaCarregar = result.data.areas; const quadrasDaAtividade = Object.keys(activityStatus);
        if (areasParaCarregar.length === 0) { alert("Nenhuma quadra para esta atividade."); map.closePopup(loadingPopup); return; }
        const allFeatures = [];
        for (const areaId of areasParaCarregar) {
            try {
                const res = await fetch(`data/${areaId}.geojson?v=${new Date().getTime()}`); if (!res.ok) continue;
                const areaData = await res.json();
                const featuresFiltradas = areaData.features.filter(f => Object.keys(activityStatus).includes(getQuadraId(f)?.toString()));
                allFeatures.push(...featuresFiltradas);
            } catch(e) { console.error(`Erro ao processar Área ${areaId}:`, e); }
        }
        map.closePopup(loadingPopup); if(allFeatures.length === 0) { alert("Quadras não encontradas nos arquivos de mapa."); return; }
        const featureCollection = { type: "FeatureCollection", features: allFeatures };
        quadrasLayer = L.geoJSON(featureCollection, { style: getStyle, onEachFeature: onEachFeature }).addTo(map);
        if (quadrasLayer.getBounds().isValid()) map.fitBounds(quadrasLayer.getBounds());
    } catch(error) { map.closePopup(loadingPopup); alert(`Falha ao carregar atividade: ${error.message}`); }
}

async function popularAtividadesPendentes() {
    const seletor = document.getElementById('atividade-select');
    try {
        const url = new URL(SCRIPT_URL); url.searchParams.append('action', 'getPendingActivities');
        const response = await fetch(url); if (!response.ok) throw new Error(`Erro de rede: ${response.statusText}`);
        const result = await response.json(); if (!result.success) throw new Error(result.message);
        seletor.innerHTML = '<option value="">Selecione uma atividade...</option>';
        if (result.data.length === 0) {
            const option = document.createElement('option'); option.textContent = "Nenhuma atividade pendente"; option.disabled = true; seletor.appendChild(option);
        } else {
            result.data.forEach(activity => {
                const option = document.createElement('option'); option.value = activity.id; option.textContent = `Atividade ${activity.id} - ${activity.veiculo}`; option.title = `Produto: ${activity.produto} | Dupla: ${activity.motorista} e ${activity.operador}`; seletor.appendChild(option);
            });
        }
    } catch(error) { seletor.innerHTML = '<option value="">Erro ao carregar</option>'; alert("Não foi possível buscar a lista de atividades: " + error.message); }
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initDB();
        
        document.getElementById('atividade-select').addEventListener('change', carregarAtividade);
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
            if (watchId !== null) { stopTracking(); } 
            else { startTracking(); }
        });
        
        await popularAtividadesPendentes();
        updateStatusIndicator();
        await syncOfflineUpdates();
        
    } catch (error) {
        alert("Falha na inicialização: " + error.message);
    }
});