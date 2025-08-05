document.addEventListener('DOMContentLoaded', async () => {
    // --- VERIFICAÇÃO DE AUTENTICAÇÃO ---
    const token = sessionStorage.getItem('authToken');
    const userProfile = sessionStorage.getItem('userProfile');

    if (!token || (userProfile !== 'Operador' && userProfile !== 'Gestor')) {
        sessionStorage.clear();
        window.location.href = 'index.html';
        return;
    }
    
    // --- CONSTANTES E VARIÁVEIS GLOBAIS ---
    const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxB3aZOVBhGSebSvsrYDB7ShVAqMekg12a437riystZtTHmyUPMjbJd_GzLdw4cOs7k/exec";
    let db;
    let quadrasLayer, activityStatus = {}, currentActivityData = {}, userMarker = null, watchId = null;
    let isSyncing = false;
    let currentActivityId = null;
    let currentActivityCycle = null;
    
    // --- ELEMENTOS DOM ---
    const map = L.map('map', { zoomControl: false }).setView([-23.1791, -45.8872], 13);
    const logoutBtn = document.getElementById('logout-btn-op');
    const changePasswordBtn = document.getElementById('change-password-btn');
    const changePasswordModal = document.getElementById('change-password-modal');
    const changePasswordForm = document.getElementById('change-password-form');
    const atividadeSelect = document.getElementById('atividade-select');
    const bulletinModal = document.getElementById('bulletin-modal');
    const bulletinForm = document.getElementById('bulletin-form');
    const finishBtn = document.getElementById('finish-btn');
    const clearBtn = document.getElementById('clear-btn');
    const syncBtn = document.getElementById('sync-btn');
    const trackBtn = document.getElementById('track-btn');
    const statusIndicator = document.getElementById('status-indicator');
    const syncBadge = document.getElementById('sync-badge');
    const progressContainer = document.getElementById('progress-container');
    const progressCounter = document.getElementById('progress-counter');
    const camposBoletimParaSalvar = [
        'bulletin-patrimonio', 'bulletin-vol-inicial', 'bulletin-vol-final', 'bulletin-consumo-gasolina',
        'bulletin-hora-inicio', 'bulletin-temp-inicio', 'bulletin-hora-termino', 'bulletin-temp-termino',
        'bulletin-interrupcao', 'bulletin-odo-inicio', 'bulletin-odo-termino', 'bulletin-obs'
    ];

    // --- INICIALIZAÇÃO DA APLICAÇÃO ---
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js').catch(err => console.error('Falha ao registrar Service Worker:', err));
    }
    
    try {
        await initDB();
        await popularAtividadesPendentes();
        setupEventListeners();
        setupBulletinCalculations();
        updateStatusIndicator();
        await updateSyncBadge();
    } catch (error) {
        Swal.fire({ icon: 'error', title: 'Erro Crítico de Inicialização', text: error.message, allowOutsideClick: false });
    }

    // --- FUNÇÕES DE API ---
    async function fetchFromApi(action, params = {}, method = 'GET') {
        const spinner = Swal.fire({ title: 'Processando...', didOpen: () => Swal.showLoading(), allowOutsideClick: false, allowEscapeKey: false });
        try {
            let response;
            if (method === 'GET') {
                const url = new URL(SCRIPT_URL);
                url.searchParams.append('action', action);
                url.searchParams.append('token', token);
                for (const key in params) { if(params[key]) url.searchParams.append(key, params[key]); }
                response = await fetch(url);
            } else { // POST
                response = await fetch(SCRIPT_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({ action, token, ...params })
                });
            }
            spinner.close();
            const result = await response.json();
            if (!result.success) { throw new Error(result.message || 'Ocorreu um erro no servidor.'); }
            return result;
        } catch (error) {
            spinner.close();
            Swal.fire('Operação Falhou', error.message, 'error');
            return { success: false, message: error.message };
        }
    }

    // --- BANCO DE DADOS LOCAL (INDEXEDDB) ---
    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('atividadesDB', 2);
            request.onupgradeneeded = e => {
                if (!e.target.result.objectStoreNames.contains('sync_queue')) {
                    e.target.result.createObjectStore('sync_queue', { keyPath: 'id_sync' });
                }
            };
            request.onsuccess = e => { db = e.target.result; resolve(db); };
            request.onerror = e => reject(e.target.error);
        });
    }

    // --- LÓGICA DE SINCRONIZAÇÃO E STATUS OFFLINE ---
    // ** CORREÇÃO: FUNÇÃO RESTAURADA **
    async function updateSyncBadge() {
        if (!db) return;
        const transaction = db.transaction('sync_queue', 'readonly');
        const store = transaction.objectStore('sync_queue');
        const countRequest = store.count();
        
        return new Promise(resolve => {
            countRequest.onsuccess = () => {
                const count = countRequest.result;
                syncBadge.textContent = count > 0 ? count : '';
                syncBadge.classList.toggle('visible', count > 0);
                clearBtn.disabled = count === 0;
                resolve();
            };
            countRequest.onerror = () => resolve(); // Resolve mesmo em caso de erro para não travar a aplicação
        });
    }

    async function syncOfflineUpdates() {
        if (isSyncing || !navigator.onLine || !db) return false;
        
        const transaction = db.transaction(['sync_queue'], 'readonly');
        const allUpdatesRequest = transaction.objectStore('sync_queue').getAll();

        return new Promise(resolve => {
            allUpdatesRequest.onsuccess = async () => {
                const updates = allUpdatesRequest.result;
                if (updates.length === 0) { resolve(true); return; }

                isSyncing = true;
                syncBtn.classList.add('syncing');
                updateStatusIndicator(true, `Sincronizando ${updates.length} item(s)...`);
                
                try {
                    await fetchFromApi('batchUpdateStatus', { updates }, 'POST');
                    const clearTransaction = db.transaction(['sync_queue'], 'readwrite');
                    clearTransaction.objectStore('sync_queue').clear();
                    await new Promise(res => clearTransaction.oncomplete = res);
                    await updateSyncBadge();
                    resolve(true);
                } catch (error) {
                    resolve(false);
                } finally {
                    isSyncing = false;
                    syncBtn.classList.remove('syncing');
                    updateStatusIndicator();
                }
            };
            allUpdatesRequest.onerror = () => resolve(false);
        });
    }

    function updateStatusIndicator(syncing = false, text) {
        if (!statusIndicator) return;
        clearTimeout(window.statusTimeout);
        statusIndicator.classList.add('visible');
        if (syncing) {
            statusIndicator.textContent = text || 'Sincronizando...';
            statusIndicator.className = 'visible syncing';
        } else if (navigator.onLine) {
            statusIndicator.textContent = 'Conectado';
            statusIndicator.className = 'visible';
            window.statusTimeout = setTimeout(() => statusIndicator.classList.remove('visible'), 3000);
        } else {
            statusIndicator.textContent = 'Offline - Alterações salvas localmente';
            statusIndicator.className = 'visible offline';
        }
    }
    
    async function clearPendingUpdates() {
        const result = await Swal.fire({
            title: 'Limpar Alterações Locais?',
            text: "Isso removerá todas as marcações de quadras pendentes que ainda não foram enviadas. A atividade será recarregada do servidor.",
            icon: 'warning', showCancelButton: true, confirmButtonText: 'Sim, limpar!', cancelButtonText: 'Cancelar'
        });
        if (result.isConfirmed) {
            const tx = db.transaction('sync_queue', 'readwrite');
            tx.objectStore('sync_queue').clear();
            await new Promise(res => tx.oncomplete = res);
            await updateSyncBadge();
            await carregarAtividade();
            Swal.fire('Limpo!', 'As alterações locais foram removidas.', 'success');
        }
    }

    // --- GESTÃO DE ATIVIDADES E MAPA ---
    async function popularAtividadesPendentes() {
        atividadeSelect.innerHTML = '<option value="">Carregando...</option>';
        const result = await fetchFromApi('getPendingActivities');
        if (result.success) {
            atividadeSelect.innerHTML = '<option value="">Selecione uma atividade...</option>';
            if (result.data.length === 0) {
                 atividadeSelect.innerHTML = '<option value="" disabled>Nenhuma atividade pendente</option>';
            }
            result.data.forEach(activity => {
                const option = new Option(`Atividade ${activity.id} (${activity.ciclo}) - ${activity.veiculo}`, `${activity.id}::${activity.ciclo}`);
                option.dataset.activity = JSON.stringify(activity);
                atividadeSelect.appendChild(option);
            });
        } else {
            atividadeSelect.innerHTML = '<option value="">Erro ao carregar</option>';
        }
    }

    async function carregarAtividade() {
        if (quadrasLayer) map.removeLayer(quadrasLayer);
        progressContainer.style.display = 'none';
        finishBtn.style.display = 'none';

        if (!currentActivityId || !currentActivityCycle) return;
        
        const result = await fetchFromApi('getActivity', { id_atividade: currentActivityId, ciclo: currentActivityCycle });
        
        if (result.success) {
            activityStatus = result.data.quadras;
            const areasParaCarregar = result.data.areas;
            if (areasParaCarregar.length === 0) {
                Swal.fire('Atividade Vazia', 'Nenhuma quadra encontrada para esta atividade.', 'info');
                return;
            }

            const allFeatures = [];
            for (const areaId of areasParaCarregar) {
                try {
                    const res = await fetch(`data/${areaId}.geojson?v=${new Date().getTime()}`);
                    if (!res.ok) throw new Error(`Arquivo da Área ${areaId} não encontrado.`);
                    const areaData = await res.json();
                    allFeatures.push(...areaData.features.filter(f => `${getAreaId(f)}-${getQuadraId(f)}` in activityStatus));
                } catch(e) { console.error(`Erro ao carregar área ${areaId}:`, e); }
            }
            
            quadrasLayer = L.geoJSON({ type: "FeatureCollection", features: allFeatures }, { style: getStyle, onEachFeature }).addTo(map);
            if (quadrasLayer.getBounds().isValid()) map.fitBounds(quadrasLayer.getBounds());
            updateProgressCounter();
            finishBtn.style.display = 'flex';
        }
    }

    function getQuadraId(feature) { return feature?.properties?.title ? parseInt(feature.properties.title.replace(/\D/g, '')) : null; }
    function getAreaId(feature) { return feature?.properties?.description ? parseInt(feature.properties.description.replace(/\D/g, '')) : null; }
    function getColorForArea(areaId) { return `hsl(${(areaId * 137.508) % 360}, 80%, 50%)`; }

    function getStyle(feature) {
        const compositeKey = `${getAreaId(feature)}-${getQuadraId(feature)}`;
        const status = activityStatus[compositeKey];
        if (!status) return { opacity: 0, fillOpacity: 0 };
        
        return {
            color: getColorForArea(getAreaId(feature)),
            weight: 2,
            opacity: 1,
            fillColor: status === 'Trabalhada' ? "#28a745" : "#dc3545",
            fillOpacity: 0.6
        };
    }

    function onEachFeature(feature, layer) {
        const id = getQuadraId(feature);
        if (id !== null) {
            layer.bindTooltip(id.toString(), { permanent: true, direction: 'center', className: 'quadra-label' }).openTooltip();
            layer.on('click', () => {
                const areaId = getAreaId(feature);
                const novoStatus = (activityStatus[`${areaId}-${id}`] === 'Pendente') ? 'Trabalhada' : 'Pendente';
                atualizarStatusQuadra(id, areaId, novoStatus);
            });
        }
    }

    async function atualizarStatusQuadra(id, areaId, novoStatus) {
        const compositeKey = `${areaId}-${id}`;
        activityStatus[compositeKey] = novoStatus;
        if (quadrasLayer) {
            quadrasLayer.eachLayer(layer => {
                if (`${getAreaId(layer.feature)}-${getQuadraId(layer.feature)}` === compositeKey) {
                    layer.setStyle(getStyle(layer.feature));
                }
            });
        }
        updateProgressCounter();
        
        if (!db) return;
        const tx = db.transaction(['sync_queue'], 'readwrite');
        tx.objectStore('sync_queue').put({
            id_sync: `${currentActivityId}-${currentActivityCycle}-${id}`,
            id_atividade: currentActivityId, ciclo: currentActivityCycle, id_quadra: id, status: novoStatus
        });
        await new Promise(res => tx.oncomplete = res);
        await updateSyncBadge();
    }

    function updateProgressCounter() {
        const quadras = Object.values(activityStatus);
        const total = quadras.length;
        if (total === 0) {
            progressContainer.style.display = 'none';
            return;
        }
        const trabalhadas = quadras.filter(s => s === 'Trabalhada').length;
        progressCounter.textContent = `${trabalhadas} / ${total}`;
        progressContainer.style.display = 'flex';
    }

    // --- LÓGICA DO BOLETIM ---
    function openBulletinModal() {
        bulletinForm.reset();
        document.getElementById('bulletin-data').value = new Date().toLocaleDateString('pt-BR');
        document.getElementById('bulletin-viatura').value = currentActivityData.veiculo || '';
        document.getElementById('bulletin-inseticida').value = currentActivityData.produto || '';
        carregarRascunhoBoletim();
        bulletinModal.style.display = 'flex';
    }

    async function handleBulletinSubmit(e) {
        e.preventDefault();
        const submitButton = e.target.querySelector('button[type="submit"]');
        submitButton.disabled = true; submitButton.textContent = 'Sincronizando Quadras...';
        
        const syncSuccess = await syncOfflineUpdates();
        if (!syncSuccess) {
            Swal.fire('Envio Interrompido', 'A sincronização das quadras falhou. Verifique sua conexão e tente novamente.', 'error');
            submitButton.disabled = false; submitButton.textContent = 'Enviar Boletim';
            return;
        }
        submitButton.textContent = 'Enviando boletim...';

        const payload = { id_atividade: currentActivityId, ciclo: currentActivityCycle };
        camposBoletimParaSalvar.forEach(id => {
            const key = id.replace('bulletin-', '').replace(/-/g, '_');
            payload[key] = document.getElementById(id).value;
        });
        payload.ocorrencias = Array.from(document.querySelectorAll('input[name="ocorrencia"]:checked')).map(cb => cb.value).join(', ');
        
        const result = await fetchFromApi('submitBulletin', payload, 'POST');
        if (result.success) {
            Swal.fire('Sucesso!', 'Boletim enviado!', 'success');
            localStorage.removeItem(`rascunhoBoletim_${currentActivityId}_${currentActivityCycle}`);
            bulletinModal.style.display = 'none';
            if (quadrasLayer) map.removeLayer(quadrasLayer);
            progressContainer.style.display = 'none';
            finishBtn.style.display = 'none';
            await popularAtividadesPendentes();
        }
        submitButton.disabled = false; submitButton.textContent = 'Enviar Boletim';
    }
    
    function salvarRascunhoBoletim() {
        if (!currentActivityId || !currentActivityCycle) return;
        const rascunho = {};
        camposBoletimParaSalvar.forEach(id => rascunho[id] = document.getElementById(id).value);
        rascunho.ocorrencias = Array.from(document.querySelectorAll('input[name="ocorrencia"]:checked')).map(cb => cb.value);
        localStorage.setItem(`rascunhoBoletim_${currentActivityId}_${currentActivityCycle}`, JSON.stringify(rascunho));
    }

    function carregarRascunhoBoletim() {
        const rascunhoSalvo = localStorage.getItem(`rascunhoBoletim_${currentActivityId}_${currentActivityCycle}`);
        if (rascunhoSalvo) {
            const rascunho = JSON.parse(rascunhoSalvo);
            camposBoletimParaSalvar.forEach(id => {
                if(document.getElementById(id) && typeof rascunho[id] !== 'undefined') document.getElementById(id).value = rascunho[id];
            });
            document.querySelectorAll('input[name="ocorrencia"]').forEach(cb => {
                cb.checked = rascunho.ocorrencias && rascunho.ocorrencias.includes(cb.value);
            });
            document.getElementById('bulletin-vol-inicial').dispatchEvent(new Event('input'));
        }
    }

    function setupBulletinCalculations() {
        const fields = {
            volInicial: document.getElementById('bulletin-vol-inicial'), volFinal: document.getElementById('bulletin-vol-final'), consumo: document.getElementById('bulletin-consumo'),
            horaInicio: document.getElementById('bulletin-hora-inicio'), horaTermino: document.getElementById('bulletin-hora-termino'), interrupcao: document.getElementById('bulletin-interrupcao'), tempoTotal: document.getElementById('bulletin-tempo-total'),
            odoInicio: document.getElementById('bulletin-odo-inicio'), odoTermino: document.getElementById('bulletin-odo-termino'), kmRodado: document.getElementById('bulletin-km-rodado')
        };
        const update = () => {
            const timeToMinutes = t => t ? t.split(':').reduce((h, m) => h * 60 + +m, 0) : 0;
            const minutesToTime = m => {
                if (isNaN(m) || m < 0) return "00:00";
                const h = Math.floor(m / 60); const M = Math.round(m % 60);
                return `${String(h).padStart(2, '0')}:${String(M).padStart(2, '0')}`;
            };
            fields.consumo.value = Math.max(0, (parseFloat(fields.volInicial.value) || 0) - (parseFloat(fields.volFinal.value) || 0));
            const duracao = Math.max(0, timeToMinutes(fields.horaTermino.value) - timeToMinutes(fields.horaInicio.value));
            fields.tempoTotal.value = minutesToTime(duracao - timeToMinutes(fields.interrupcao.value));
            fields.kmRodado.value = Math.max(0, (parseFloat(fields.odoTermino.value) || 0) - (parseFloat(fields.odoInicio.value) || 0));
        };
        Object.values(fields).forEach(el => el?.addEventListener('input', update));
    }

    // --- LÓGICA DE GEOLOCALIZAÇÃO ---
    function startTracking() {
        if (!navigator.geolocation) {
            return Swal.fire('Indisponível', 'A geolocalização não é suportada por este navegador.', 'error');
        }
        trackBtn.classList.add('tracking');
        watchId = navigator.geolocation.watchPosition(
            (pos) => {
                const { latitude, longitude, heading } = pos.coords;
                const userLatLng = L.latLng(latitude, longitude);
                const iconHtml = `<svg style="width:24px;height:24px;transform: rotate(${heading || 0}deg);" viewBox="0 0 24 24"><path fill="#007bff" d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>`;
                const cssIcon = L.divIcon({ html: iconHtml, className: 'user-location-icon', iconSize: [24, 24]});

                if (!userMarker) {
                    userMarker = L.marker(userLatLng, { icon: cssIcon }).addTo(map).bindPopup("Você está aqui");
                    map.setView(userLatLng, 18);
                } else {
                    userMarker.setLatLng(userLatLng).setIcon(cssIcon);
                }
            }, 
            () => {
                Swal.fire('Erro de Geolocalização', 'Não foi possível obter sua localização. Verifique as permissões.', 'error');
                stopTracking();
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }
    
    function stopTracking() {
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        if (userMarker) map.removeLayer(userMarker);
        watchId = null;
        userMarker = null;
        trackBtn.classList.remove('tracking');
    }

    // --- EVENT LISTENERS E CONFIGURAÇÃO FINAL ---
    function setupEventListeners() {
        logoutBtn.addEventListener('click', () => { sessionStorage.clear(); window.location.href = 'index.html'; });
        changePasswordBtn.addEventListener('click', () => changePasswordModal.style.display = 'flex');
        syncBtn.addEventListener('click', syncOfflineUpdates);
        clearBtn.addEventListener('click', clearPendingUpdates);
        finishBtn.addEventListener('click', openBulletinModal);
        trackBtn.addEventListener('click', () => watchId ? stopTracking() : startTracking());
        
        atividadeSelect.addEventListener('change', () => {
            const selectedOption = atividadeSelect.options[atividadeSelect.selectedIndex];
            if (!selectedOption.value) {
                currentActivityId = null; currentActivityCycle = null;
                if (quadrasLayer) map.removeLayer(quadrasLayer);
                progressContainer.style.display = 'none';
                finishBtn.style.display = 'none';
                return;
            };
            currentActivityData = JSON.parse(selectedOption.dataset.activity || '{}');
            [currentActivityId, currentActivityCycle] = selectedOption.value.split('::');
            carregarAtividade();
        });

        changePasswordModal.querySelector('.modal-close').addEventListener('click', () => changePasswordModal.style.display = 'none');
        changePasswordModal.addEventListener('click', (e) => { if (e.target === changePasswordModal) changePasswordModal.style.display = 'none'; });
        changePasswordForm.addEventListener('submit', handleChangePassword);
        
        bulletinModal.querySelector('.modal-close').addEventListener('click', () => bulletinModal.style.display = 'none');
        bulletinForm.addEventListener('submit', handleBulletinSubmit);
        bulletinForm.addEventListener('input', salvarRascunhoBoletim);

        window.addEventListener('online', syncOfflineUpdates);
        window.addEventListener('offline', () => updateStatusIndicator());
    }

    async function handleChangePassword(e) {
        e.preventDefault();
        const button = e.target.querySelector('button');
        button.disabled = true; button.textContent = "Salvando...";

        const passwordData = { oldPassword: e.target.elements['current-password'].value, newPassword: e.target.elements['new-password'].value };
        if (passwordData.newPassword !== e.target.elements['confirm-password'].value) {
            Swal.fire('Erro', 'As novas senhas não coincidem.', 'error');
            button.disabled = false; button.textContent = "Salvar Nova Senha";
            return;
        }

        const result = await fetchFromApi('manageUser', { sub_action: 'change_own_password', passwordData }, 'POST');
        if (result.success) {
            Swal.fire('Sucesso!', result.message, 'success');
            changePasswordModal.style.display = 'none';
            changePasswordForm.reset();
        }
        button.disabled = false; button.textContent = "Salvar Nova Senha";
    }
});