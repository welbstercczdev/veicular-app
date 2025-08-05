document.addEventListener('DOMContentLoaded', () => {
    // --- VERIFICAÇÃO DE AUTENTICAÇÃO ---
    const token = sessionStorage.getItem('authToken');
    const userName = sessionStorage.getItem('userName');
    const userProfile = sessionStorage.getItem('userProfile');
    const userEmail = sessionStorage.getItem('userEmail');

    if (!token || userProfile !== 'Gestor') {
        sessionStorage.clear();
        window.location.href = 'index.html';
        return;
    }

    // --- CONSTANTES ---
    const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxB3aZOVBhGSebSvsrYDB7ShVAqMekg12a437riystZtTHmyUPMjbJd_GzLdw4cOs7k/exec";
    const AGENTES_API_URL = "https://script.google.com/macros/s/AKfycbxg6XocN88LKvq1bv-ngEIWHjGG1XqF0ELSK9dFteunXo8a1R2AHeAH5xdfEulSZPzsgQ/exec";
    const BAIRROS_API_URL = "https://script.google.com/macros/s/AKfycbw7VInWajEJflcf43PyWeiCh2IfRxVOlZjw3uiHgbKqO_12Y9ARUDnGxio6abnxxpdy/exec";
    const TOTAL_AREAS = 109;

    // --- INICIALIZAÇÃO DO MAPA ---
    const map = L.map('map').setView([-23.1791, -45.8872], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    // --- VARIÁVEIS GLOBAIS ---
    let quadrasLayer;
    let imoveisLookup = {};
    const selectedQuadras = new Map();
    const selectedBairros = new Set();
    let geojsonFeatures = new Map();

    // --- ELEMENTOS DA DOM ---
    const welcomeMessage = document.getElementById('welcome-message');
    const logoutBtn = document.getElementById('logout-btn');
    const manageActivitiesBtn = document.getElementById('manage-activities-btn');
    const manageUsersBtn = document.getElementById('manage-users-btn');
    const changePasswordBtn = document.getElementById('change-password-btn');
    const manageModal = document.getElementById('manage-modal');
    const userManagementModal = document.getElementById('user-management-modal');
    const changePasswordModal = document.getElementById('change-password-modal');
    const activitiesTableBody = document.getElementById('activities-table-body');
    const usersTableBody = document.getElementById('users-table-body');
    const historyTableBody = document.getElementById('history-table-body');
    const createUserForm = document.getElementById('create-user-form');
    const changePasswordForm = document.getElementById('change-password-form');
    const searchHistoryBtn = document.getElementById('search-history-btn');
    const areaSelector = document.getElementById('area-selector');
    const quadrasSelecionadasList = document.getElementById('quadras-list');
    const countSpan = document.getElementById('count');
    const totalAreaSpan = document.getElementById('total-area');
    const totalImoveisSpan = document.getElementById('total-imoveis');
    const formContainer = document.getElementById('form-container');

    // --- FUNÇÃO CENTRAL DE API ---
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

    // --- LÓGICA DE GERENCIAMENTO DO FORMULÁRIO (CORRIGIDA) ---
    function setFormEnabled(enabled) {
        const formElements = formContainer.querySelectorAll('input, select, button');
        formElements.forEach(el => el.disabled = !enabled);
    }
    
    function clearForm() {
        document.getElementById('atividade-id').value = '';
        document.querySelectorAll('input[name="ciclo"]:checked').forEach(cb => cb.checked = false);
        document.getElementById('veiculo-select').value = '';
        document.getElementById('produto-select').value = '';
        document.getElementById('motorista-input').value = '';
        document.getElementById('operador-input').value = '';
        document.getElementById('bairro-input').value = '';
        areaSelector.value = '';
        
        selectedBairros.clear();
        selectedQuadras.clear();
        
        renderBairroTags();
        updateSidebar();
        
        if (quadrasLayer) {
            map.removeLayer(quadrasLayer);
            quadrasLayer = null;
        }
    }

    // --- GESTÃO DE USUÁRIOS ---
    function renderUsersTable(users) {
        usersTableBody.innerHTML = '';
        if (!users || users.length === 0) {
            usersTableBody.innerHTML = '<tr><td colspan="4">Nenhum usuário encontrado.</td></tr>'; return;
        }
        users.sort((a, b) => a.nome.localeCompare(b.nome)).forEach(user => {
            const isCurrentUser = user.email && userEmail && (user.email.toLowerCase() === userEmail.toLowerCase());
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${user.nome || 'N/A'}</td><td>${user.email || 'N/A'}</td><td>${user.perfil || 'N/A'}</td>
                <td class="action-buttons">
                    <button class="btn-reset-pass" data-email="${user.email}">Resetar Senha</button>
                    <button class="btn-delete-user" data-email="${user.email}" ${isCurrentUser ? 'disabled title="Você não pode excluir sua própria conta"' : ''}>Excluir</button>
                </td>`;
            if (user.email) { usersTableBody.appendChild(row); }
        });
    }

    async function openUserManagementModal() {
        userManagementModal.style.display = 'flex';
        usersTableBody.innerHTML = '<tr><td colspan="4">Carregando usuários...</td></tr>';
        const result = await fetchFromApi('listUsers');
        if (result.success) { renderUsersTable(result.data); }
    }

    // --- GESTÃO DE ATIVIDADES ---
    function renderActivitiesTable(activities) {
        activitiesTableBody.innerHTML = '';
        if (!activities || activities.length === 0) {
            activitiesTableBody.innerHTML = '<tr><td colspan="5">Nenhuma atividade em andamento.</td></tr>'; return;
        }
        activities.forEach(act => {
            const progresso = act.totalQuadras > 0 ? (act.quadrasTrabalhadas / act.totalQuadras) * 100 : 0;
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${act.id} (${act.ciclo})</td><td>${act.data}</td><td>${act.veiculo}</td>
                <td><div class="progress-bar"><div class="progress-bar-fill" style="width: ${progresso.toFixed(1)}%;">${progresso.toFixed(0)}%</div></div><small>${act.quadrasTrabalhadas} de ${act.totalQuadras}</small></td>
                <td class="action-buttons">
                    <button class="btn-edit" data-id="${act.id}" data-ciclo="${act.ciclo}">Editar</button>
                    <button class="btn-delete" data-id="${act.id}" data-ciclo="${act.ciclo}">Excluir</button>
                </td>`;
            activitiesTableBody.appendChild(row);
        });
    }
    
    async function openManageModal() {
        manageModal.style.display = 'flex';
        activitiesTableBody.innerHTML = '<tr><td colspan="5">Carregando...</td></tr>';
        historyTableBody.innerHTML = '<tr><td colspan="5">Use os filtros acima para buscar no histórico.</td></tr>';
        const result = await fetchFromApi('getActivitiesList');
        if (result.success) { renderActivitiesTable(result.data); }
    }
    
    // --- LÓGICA DO MAPA E SELEÇÃO ---
    function getColorForArea(areaId) { if (!areaId) return '#777'; const hue = (areaId * 137.508) % 360; return `hsl(${hue}, 80%, 50%)`; }
    function getQuadraId(feature) { return feature?.properties?.title ? parseInt(feature.properties.title.replace(/\D/g, '')) : null; }
    function getAreaId(feature) { return feature?.properties?.description ? parseInt(feature.properties.description.replace(/\D/g, '')) : null; }

    function getStyleForFeature(feature) {
        const compositeKey = `${getAreaId(feature)}-${getQuadraId(feature)}`;
        const borderColor = getColorForArea(getAreaId(feature));
        return selectedQuadras.has(compositeKey)
            ? { color: borderColor, weight: 3, opacity: 1, fillColor: '#ffc107', fillOpacity: 0.7 }
            : { color: borderColor, weight: 2, opacity: 0.8, fillColor: '#6c757d', fillOpacity: 0.3 };
    }

    function updateSidebar() {
        quadrasSelecionadasList.innerHTML = '';
        let totalArea = 0;
        let totalImoveis = 0;
        const sortedQuadras = Array.from(selectedQuadras.values()).sort((a, b) => (a.area - b.area) || (a.id - b.id));
        sortedQuadras.forEach(quadra => {
            totalArea += quadra.sqMeters;
            totalImoveis += quadra.totalImoveis;
            const li = document.createElement('li');
            li.innerHTML = `<span>Área ${quadra.area} - Q ${quadra.id} (${quadra.totalImoveis} imóveis)</span><button class="remove-quadra-btn" data-key="${quadra.area}-${quadra.id}">X</button>`;
            quadrasSelecionadasList.appendChild(li);
        });
        countSpan.textContent = selectedQuadras.size;
        totalAreaSpan.textContent = totalArea.toFixed(2);
        totalImoveisSpan.textContent = totalImoveis;
    }

    function displayHistoryDetailsInSidebar(activity, workedFeatures) {
        setFormEnabled(false);
        selectedBairros.clear();
        selectedQuadras.clear();

        document.getElementById('atividade-id').value = activity.id;
        document.querySelectorAll('input[name="ciclo"]').forEach(cb => { cb.checked = activity.ciclo.split(',').map(c => c.trim()).includes(cb.value); });
        document.getElementById('veiculo-select').value = activity.veiculo;
        document.getElementById('produto-select').value = activity.produto;
        document.getElementById('motorista-input').value = activity.motorista;
        document.getElementById('operador-input').value = activity.operador;
        if (activity.bairros) { activity.bairros.split(',').forEach(b => selectedBairros.add(b.trim())); }
        renderBairroTags();

        quadrasSelecionadasList.innerHTML = '';
        let workedCount = 0;
        let totalArea = 0;
        let totalImoveis = 0;
        workedFeatures.sort((a, b) => (getAreaId(a) - getAreaId(b)) || (getQuadraId(a) - getQuadraId(b)));
        workedFeatures.forEach(feature => {
            const areaId = getAreaId(feature);
            const quadraId = getQuadraId(feature);
            const key = `${areaId}-${quadraId}`;
            const lookupData = imoveisLookup[key] || { total_imoveis: 0 };
            const area = turf.area(feature);
            workedCount++;
            totalArea += area;
            totalImoveis += lookupData.total_imoveis;
            const li = document.createElement('li');
            li.innerHTML = `<span>Área ${areaId} - Q ${quadraId} (${lookupData.total_imoveis} imóveis)</span>`;
            quadrasSelecionadasList.appendChild(li);
        });
        countSpan.textContent = workedCount;
        totalAreaSpan.textContent = totalArea.toFixed(2);
        totalImoveisSpan.textContent = totalImoveis;
    }

    function onQuadraClick(e) {
        const layer = e.target;
        const feature = layer.feature;
        const id = getQuadraId(feature);
        const areaId = getAreaId(feature);
        if (id === null || areaId === null) return;
        const compositeKey = `${areaId}-${id}`;

        if (selectedQuadras.has(compositeKey)) {
            selectedQuadras.delete(compositeKey);
        } else {
            const areaInSqMeters = turf.area(feature);
            const lookupData = imoveisLookup[compositeKey] || { total_imoveis: 0, censitario: 'N/A' };
            selectedQuadras.set(compositeKey, { id, area: areaId, sqMeters: areaInSqMeters, totalImoveis: lookupData.total_imoveis, setor_censitario: lookupData.censitario });
        }
        layer.setStyle(getStyleForFeature(feature));
        updateSidebar();
    }
    
    // --- DADOS INICIAIS E AUTOCOMPLETE ---
    async function popularDadosIniciais() {
        try {
            const [agentesRes, bairrosRes, imoveisRes] = await Promise.all([ fetch(AGENTES_API_URL), fetch(BAIRROS_API_URL), fetch('data/imoveis_lookup.json') ]);
            if (!agentesRes.ok || !bairrosRes.ok || !imoveisRes.ok) throw new Error("Falha ao buscar dados essenciais.");
            
            const agentesData = await agentesRes.json();
            const bairrosData = await bairrosRes.json();
            imoveisLookup = await imoveisRes.json();
            
            const popular = (data, id, listId, placeholder, onSelect) => {
                const input = document.getElementById(id);
                input.placeholder = placeholder;
                setupAutocomplete(id, listId, data, onSelect);
            };

            popular(agentesData.agentes, 'motorista-input', 'motorista-list', "Digite para buscar...", val => document.getElementById('motorista-input').value = val);
            popular(agentesData.agentes, 'operador-input', 'operador-list', "Digite para buscar...", val => document.getElementById('operador-input').value = val);
            popular(bairrosData.agentes, 'bairro-input', 'bairro-list', "Digite para adicionar...", bairro => {
                selectedBairros.add(bairro); renderBairroTags(); document.getElementById('bairro-input').value = '';
            });
        } catch(e) { Swal.fire('Erro Crítico', 'Não foi possível carregar os dados iniciais: ' + e.message, 'error'); }
    }

    function setupAutocomplete(inputId, listId, sourceArray, onSelectCallback) {
        const input = document.getElementById(inputId);
        const listContainer = document.getElementById(listId);
        input.addEventListener("input", function() {
            closeAllLists(listId);
            const val = this.value; if (!val) { listContainer.style.display = 'none'; return; }
            listContainer.innerHTML = ''; listContainer.style.display = "block";
            sourceArray.filter(item => item.toUpperCase().includes(val.toUpperCase())).forEach(item => {
                const b = document.createElement("DIV");
                b.innerHTML = item.replace(new RegExp(val, "gi"), "<strong>$&</strong>");
                b.addEventListener("click", () => { onSelectCallback(item); closeAllLists(); });
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

    // --- LÓGICA DO HISTÓRICO DE ATIVIDADES ---
    async function searchHistory() {
        historyTableBody.innerHTML = '<tr><td colspan="5">Buscando...</td></tr>';
        const params = {
            id_atividade: document.getElementById('search-id-input').value,
            startDate: document.getElementById('search-start-date').value,
            endDate: document.getElementById('search-end-date').value,
        };
        const result = await fetchFromApi('getCompletedActivities', params);
        if (result.success) { renderHistoryTable(result.data); }
    }

    function renderHistoryTable(activities) {
        historyTableBody.innerHTML = '';
        if (!activities || activities.length === 0) {
            historyTableBody.innerHTML = '<tr><td colspan="5">Nenhum resultado encontrado.</td></tr>'; return;
        }
        activities.forEach(act => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${act.id} (${act.ciclo})</td><td>${act.data}</td><td>${act.viatura}</td><td>${act.ocorrencias || 'Nenhuma'}</td>
                <td class="action-buttons"><button class="btn-view-map" data-id="${act.id}" data-ciclo="${act.ciclo}">Ver Mapa</button></td>`;
            historyTableBody.appendChild(row);
        });
    }

    // --- EVENT LISTENERS ---
    welcomeMessage.textContent = `Bem-vindo(a), ${userName || 'Usuário'}`;
    logoutBtn.addEventListener('click', () => { sessionStorage.clear(); window.location.href = 'index.html'; });
    manageActivitiesBtn.addEventListener('click', openManageModal);
    manageUsersBtn.addEventListener('click', openUserManagementModal);
    changePasswordBtn.addEventListener('click', () => changePasswordModal.style.display = 'flex');
    searchHistoryBtn.addEventListener('click', searchHistory);

    [manageModal, userManagementModal, changePasswordModal].forEach(modal => {
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
        modal.querySelector('.modal-close').addEventListener('click', () => modal.style.display = 'none');
    });

    createUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const button = e.target.querySelector('button');
        button.disabled = true;
        const userData = {
            nome: document.getElementById('new-user-name').value.trim(),
            email: document.getElementById('new-user-email').value.trim(),
            perfil: document.getElementById('new-user-profile').value,
            password: document.getElementById('new-user-password').value
        };
        const result = await fetchFromApi('manageUser', { sub_action: 'create', userData }, 'POST');
        if (result.success) {
            Swal.fire('Sucesso!', result.message, 'success');
            createUserForm.reset();
            openUserManagementModal();
        }
        button.disabled = false;
    });

    usersTableBody.addEventListener('click', async (e) => {
        const userEmail = e.target.dataset.email;
        if (!userEmail) return;
        if (e.target.classList.contains('btn-delete-user')) {
            const confirmation = await Swal.fire({
                title: 'Tem certeza?', text: `O usuário ${userEmail} será excluído permanentemente.`,
                icon: 'warning', showCancelButton: true, confirmButtonText: 'Sim, excluir!',
                cancelButtonText: 'Cancelar', confirmButtonColor: '#d33',
                target: userManagementModal, customClass: { popup: 'swal-in-modal' }
            });
            if (confirmation.isConfirmed) {
                const result = await fetchFromApi('manageUser', { sub_action: 'delete', userEmail }, 'POST');
                if (result.success) {
                    Swal.fire({
                        title: 'Excluído!', text: result.message, icon: 'success',
                        target: userManagementModal, customClass: { popup: 'swal-in-modal' }
                    });
                    openUserManagementModal();
                }
            }
        }
        if (e.target.classList.contains('btn-reset-pass')) {
            const { value: newPassword } = await Swal.fire({
                title: `Resetar senha para ${userEmail}`, input: 'password',
                inputLabel: 'Nova Senha', inputPlaceholder: 'Digite a nova senha forte',
                showCancelButton: true, confirmButtonText: 'Resetar',
                target: userManagementModal, customClass: { popup: 'swal-in-modal' }
            });
            if (newPassword) {
                const result = await fetchFromApi('manageUser', { sub_action: 'reset_password', userEmail, newPassword }, 'POST');
                 if (result.success) {
                    Swal.fire({
                        title: 'Sucesso!', text: result.message, icon: 'success',
                        target: userManagementModal, customClass: { popup: 'swal-in-modal' }
                    });
                }
            }
        }
    });

    changePasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const button = e.target.querySelector('button');
        button.disabled = true;
        const oldPassword = document.getElementById('current-password').value;
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;
        if (newPassword !== confirmPassword) {
            Swal.fire('Erro', 'As novas senhas não coincidem.', 'error');
            button.disabled = false; return;
        }
        const result = await fetchFromApi('manageUser', { sub_action: 'change_own_password', passwordData: { oldPassword, newPassword } }, 'POST');
        if (result.success) {
            Swal.fire('Sucesso!', result.message, 'success');
            changePasswordModal.style.display = 'none';
            changePasswordForm.reset();
        }
        button.disabled = false;
    });

    activitiesTableBody.addEventListener('click', async (e) => {
        const target = e.target;
        const activityId = target.dataset.id;
        const activityCycle = target.dataset.ciclo;
        if (!activityId || !activityCycle) return;

        if (target.classList.contains('btn-delete')) {
            const confirmation = await Swal.fire({
                title: 'Tem certeza?', text: `A atividade ${activityId} (${activityCycle}) será excluída.`,
                icon: 'warning', showCancelButton: true, confirmButtonText: 'Sim, excluir!', cancelButtonText: 'Cancelar',
                target: manageModal, customClass: { popup: 'swal-in-modal' }
            });
            if (confirmation.isConfirmed) {
                const result = await fetchFromApi('deleteActivity', { id_atividade: activityId, ciclo: activityCycle }, 'POST');
                if (result.success) {
                    Swal.fire({title: 'Excluído!', text: result.message, icon: 'success', target: manageModal, customClass: { popup: 'swal-in-modal' }});
                    openManageModal();
                }
            }
        }

        if (target.classList.contains('btn-edit')) {
            clearForm();
            setFormEnabled(true);
            const result = await fetchFromApi('getActivityDetails', { id_atividade: activityId, ciclo: activityCycle });
            if (result.success) {
                const activity = result.data;
                document.getElementById('atividade-id').value = activity.id;
                document.querySelectorAll('input[name="ciclo"]').forEach(cb => { cb.checked = activity.ciclo.split(',').map(c => c.trim()).includes(cb.value); });
                document.getElementById('veiculo-select').value = activity.veiculo;
                document.getElementById('produto-select').value = activity.produto;
                document.getElementById('motorista-input').value = activity.motorista;
                document.getElementById('operador-input').value = activity.operador;
                if (activity.bairros) activity.bairros.split(',').forEach(b => selectedBairros.add(b.trim()));
                renderBairroTags();
                const areasNecessarias = [...new Set(activity.quadras.map(q => q.area))];
                for (const areaId of areasNecessarias) {
                    if (!geojsonFeatures.has(areaId)) {
                        try {
                            const res = await fetch(`data/${areaId}.geojson?v=${new Date().getTime()}`);
                            const geojsonData = await res.json();
                            geojsonFeatures.set(areaId, geojsonData.features);
                        } catch (err) { console.error(`Falha ao carregar geojson da área ${areaId}`); }
                    }
                }
                activity.quadras.forEach(q => {
                    const compositeKey = `${q.area}-${q.id}`;
                    const lookupData = imoveisLookup[compositeKey] || { total_imoveis: 0, censitario: 'N/A' };
                    let areaInSqMeters = 0;
                    const featuresDaArea = geojsonFeatures.get(q.area);
                    if (featuresDaArea) {
                        const featureDaQuadra = featuresDaArea.find(f => getQuadraId(f) === q.id);
                        if (featureDaQuadra) { areaInSqMeters = turf.area(featureDaQuadra); }
                    }
                    selectedQuadras.set(compositeKey, { id: parseInt(q.id), area: parseInt(q.area), sqMeters: areaInSqMeters, totalImoveis: lookupData.total_imoveis, setor_censitario: lookupData.censitario });
                });
                if (activity.quadras.length > 0) {
                    areaSelector.value = activity.quadras[0].area;
                    areaSelector.dispatchEvent(new Event('change'));
                } else { if (quadrasLayer) map.removeLayer(quadrasLayer); }
                updateSidebar();
                manageModal.style.display = 'none';
                Swal.fire({ icon: 'info', title: 'Atividade Carregada', text: `Dados da atividade ${activityId} carregados.`, toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });
            }
        }
    });

    historyTableBody.addEventListener('click', async (e) => {
        if (e.target.classList.contains('btn-view-map')) {
            clearForm();
            const activityId = e.target.dataset.id;
            const activityCycle = e.target.dataset.ciclo;
            const result = await fetchFromApi('getActivityDetails', { id_atividade: activityId, ciclo: activityCycle });
            if (!result.success) return;

            const activity = result.data;
            if (quadrasLayer) map.removeLayer(quadrasLayer);
            
            const areasNecessarias = [...new Set(activity.quadras.map(q => q.area))];
            let allFeatures = [];
            for (const areaId of areasNecessarias) {
                if (!geojsonFeatures.has(areaId)) {
                    try {
                        const res = await fetch(`data/${areaId}.geojson?v=${new Date().getTime()}`);
                        const geojsonData = await res.json();
                        geojsonFeatures.set(areaId, geojsonData.features);
                    } catch(err) { console.error("Erro ao carregar geojson para mapa histórico"); }
                }
                const featuresDaArea = geojsonFeatures.get(areaId) || [];
                const quadrasDaAtividadeNaArea = activity.quadras.filter(q => q.area == areaId).map(q => q.id);
                allFeatures.push(...featuresDaArea.filter(f => quadrasDaAtividadeNaArea.includes(getQuadraId(f))));
            }

            if (allFeatures.length > 0) {
                quadrasLayer = L.geoJSON({ type: "FeatureCollection", features: allFeatures }, {
                    style: (feature) => {
                        const key = `${getAreaId(feature)}-${getQuadraId(feature)}`;
                        const status = activity.statusMap[key] || 'Pendente';
                        return { color: getColorForArea(getAreaId(feature)), weight: 2, fillColor: status === 'Trabalhada' ? '#28a745' : '#dc3545', fillOpacity: 0.6 };
                    },
                    onEachFeature: (feature, layer) => {
                        const quadraId = getQuadraId(feature);
                        if (quadraId !== null) layer.bindTooltip(quadraId.toString(), { permanent: true, direction: 'center', className: 'quadra-label' }).openTooltip();
                    }
                }).addTo(map);
                if (quadrasLayer.getBounds().isValid()) map.fitBounds(quadrasLayer.getBounds());
            }
            
            const workedFeatures = allFeatures.filter(feature => activity.statusMap[`${getAreaId(feature)}-${getQuadraId(feature)}`] === 'Trabalhada');
            displayHistoryDetailsInSidebar(activity, workedFeatures);
            manageModal.style.display = 'none';
        }
    });

    document.getElementById('save-activity').addEventListener('click', async () => {
        setFormEnabled(true);
        const payload = {
            id_atividade: document.getElementById('atividade-id').value.trim(),
            ciclos: Array.from(document.querySelectorAll('input[name="ciclo"]:checked')).map(cb => cb.value),
            veiculo: document.getElementById('veiculo-select').value,
            produto: document.getElementById('produto-select').value,
            motorista: document.getElementById('motorista-input').value.trim(),
            operador: document.getElementById('operador-input').value.trim(),
            bairros: Array.from(selectedBairros).join(', '),
            quadras: Array.from(selectedQuadras.values())
        };
        if (!payload.id_atividade || payload.ciclos.length === 0 || !payload.veiculo || !payload.produto || !payload.bairros || !payload.motorista || !payload.operador || payload.quadras.length === 0) {
            Swal.fire('Campos Incompletos', 'Preencha todos os campos, incluindo ciclo, bairro e ao menos uma quadra.', 'warning');
            return;
        }
        const result = await fetchFromApi('createActivity', payload, 'POST');
        if (result.success) {
            Swal.fire('Sucesso!', result.message, 'success');
            clearForm();
            if (quadrasLayer) quadrasLayer.setStyle(getStyleForFeature);
        }
    });

    areaSelector.addEventListener('change', async (e) => {
        setFormEnabled(true); // Garante que o form está ativo ao selecionar nova área
        const areaId = e.target.value;
        if (!areaId) { if (quadrasLayer) map.removeLayer(quadrasLayer); return; };
        if (quadrasLayer) map.removeLayer(quadrasLayer);
        
        try {
            if (!geojsonFeatures.has(areaId)) {
                const res = await fetch(`data/${areaId}.geojson?v=${new Date().getTime()}`);
                if (!res.ok) throw new Error(`Arquivo da Área ${areaId} não encontrado.`);
                const geojsonData = await res.json();
                geojsonFeatures.set(areaId, geojsonData.features);
            }
            const features = geojsonFeatures.get(areaId);
            quadrasLayer = L.geoJSON({ type: "FeatureCollection", features }, {
                style: getStyleForFeature,
                onEachFeature: (feature, layer) => {
                    layer.on('click', onQuadraClick);
                    const quadraId = getQuadraId(feature);
                    if (quadraId !== null) layer.bindTooltip(quadraId.toString(), { permanent: true, direction: 'center', className: 'quadra-label' }).openTooltip();
                }
            }).addTo(map);
            
            if (quadrasLayer.getBounds().isValid()) map.fitBounds(quadrasLayer.getBounds());
        } catch (error) {
            Swal.fire('Erro ao Carregar Área', error.message, 'error');
        }
    });

    document.getElementById('bairros-selecionados-container').addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-tag')) {
            selectedBairros.delete(e.target.dataset.bairro);
            renderBairroTags();
        }
    });

    quadrasSelecionadasList.addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-quadra-btn')) {
            selectedQuadras.delete(e.target.dataset.key);
            if (quadrasLayer) {
                quadrasLayer.eachLayer(layer => {
                    const key = `${getAreaId(layer.feature)}-${getQuadraId(layer.feature)}`;
                    if (key === e.target.dataset.key) {
                        layer.setStyle(getStyleForFeature(layer.feature));
                    }
                });
            }
            updateSidebar();
        }
    });

    // --- INICIALIZAÇÃO ---
    for (let i = 1; i <= TOTAL_AREAS; i++) {
        areaSelector.appendChild(new Option(`Área ${i}`, i));
    }
    popularDadosIniciais();
});