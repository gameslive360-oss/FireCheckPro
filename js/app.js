import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, collection, addDoc, query, where, getDocs, orderBy, limit, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { PhraseManager } from "./phrases.js";

// --- Configuração ---
const TABS = ['sumario', 'hidrante', 'extintor', 'luz', 'bomba', 'sinalizacao', 'eletro', 'geral'];

// --- Inicialização Firebase ---
let db, storage, auth, user = null;

try {
    if (firebaseConfig.apiKey) {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        enableIndexedDbPersistence(db)
            .catch((err) => {
                if (err.code == 'failed-precondition') {
                    console.warn("Persistência falhou: Múltiplas abas abertas.");
                } else if (err.code == 'unimplemented') {
                    console.warn("Persistência falhou: Navegador não suporta.");
                }
            });
        storage = getStorage(app);
        auth = getAuth(app);

        onAuthStateChanged(auth, (currentUser) => {
            user = currentUser;
            updateUserUI();
            if (user) loadHistory();
        });
        console.log("Firebase Inicializado");
    }
} catch (error) {
    console.error("Erro na inicialização:", error);
}

// --- Estado da Aplicação ---
let items = [];
let currentType = 'hidrante';
let currentFiles = [];
let pendingAction = null;

// --- DOMContentLoaded ---
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    restoreFormState();

    if (document.getElementById('h-tem-mangueira')) window.toggleMangueiraFields();
    if (!document.getElementById('data-relatorio').value) document.getElementById('data-relatorio').valueAsDate = new Date();
    if (document.getElementById('s-existente')) window.toggleSinalizacaoFields();

    // Listeners
    document.getElementById('btn-login').addEventListener('click', handleLogin);
    document.getElementById('btn-logout-side').addEventListener('click', handleLogout);
    document.getElementById('btn-add-item').addEventListener('click', addItem);
    document.getElementById('btn-save').addEventListener('click', saveToFirebase);
    document.getElementById('camera-input').addEventListener('change', handleFileSelect);
    document.getElementById('upload-input').addEventListener('change', handleFileSelect);
    document.getElementById('btn-pdf').addEventListener('click', () => generatePDF('save'));

    document.getElementById('btn-confirm-action').addEventListener('click', () => {
        if (pendingAction) pendingAction();
        window.closeConfirmModal();
    });

    document.querySelectorAll('.save-state').forEach(input => {
        input.addEventListener('input', () => {
            localStorage.setItem(input.id, input.type === 'checkbox' ? input.checked : input.value);
        });
    });
});

// --- Visualização (Lista vs PDF) ---
window.togglePreviewMode = function (mode) {
    const btnList = document.getElementById('view-btn-list');
    const btnPdf = document.getElementById('view-btn-pdf');
    const divList = document.getElementById('lista-itens');
    const divPdf = document.getElementById('pdf-preview-container');

    if (mode === 'list') {
        btnList.classList.add('bg-white', 'text-slate-800', 'shadow-sm');
        btnList.classList.remove('text-gray-500');
        btnPdf.classList.remove('bg-white', 'text-slate-800', 'shadow-sm');
        btnPdf.classList.add('text-gray-500');
        divList.classList.remove('hidden');
        divPdf.classList.add('hidden');
    } else {
        btnPdf.classList.add('bg-white', 'text-slate-800', 'shadow-sm');
        btnPdf.classList.remove('text-gray-500');
        btnList.classList.remove('bg-white', 'text-slate-800', 'shadow-sm');
        btnList.classList.add('text-gray-500');
        divPdf.classList.remove('hidden');
        divList.classList.add('hidden');
        generatePDF('preview');
    }
};

const phrasesManager = new PhraseManager();
window.phrases = phrasesManager;

// --- Lógica de Abas ---
window.switchTab = function (type) {
    currentType = type;

    // Lógica para esconder os campos de Local/ID nas abas Geral e Sumário
    const inputAndar = document.getElementById('andar');
    // Navega até o container pai (div.grid) para esconder a linha inteira
    const idContainer = inputAndar ? inputAndar.closest('.grid') : null;

    if (idContainer) {
        if (type === 'geral' || type === 'sumario') {
            idContainer.classList.add('hidden');
        } else {
            idContainer.classList.remove('hidden');
        }
    }

    TABS.forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        const form = document.getElementById(`form-${t}`);
        const activeClass = `tab-active-${t}`;

        if (t === type) {
            if (form) form.classList.remove('hidden');
            if (btn) {
                btn.classList.remove('tab-inactive');
                btn.classList.add(activeClass);
            }
        } else {
            if (form) form.classList.add('hidden');
            if (btn) {
                btn.classList.remove(activeClass);
                btn.classList.add('tab-inactive');
            }
        }
    });
};

// --- Modal ---
window.showConfirmModal = function (title, msg, actionCallback, isDestructive = false) {
    const modal = document.getElementById('modal-confirm');
    document.getElementById('modal-confirm-title').innerText = title;
    document.getElementById('modal-confirm-msg').innerText = msg;
    const btn = document.getElementById('btn-confirm-action');

    pendingAction = actionCallback;

    if (isDestructive) {
        btn.className = "px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg shadow-md transition-colors flex items-center gap-2";
        btn.innerText = "Sim, Remover";
    } else {
        btn.className = "px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition-colors flex items-center gap-2";
        btn.innerText = "Sim, Editar";
    }
    modal.classList.remove('hidden');
};

window.closeConfirmModal = function () {
    document.getElementById('modal-confirm').classList.add('hidden');
    pendingAction = null;
};

// --- Funções Auxiliares de UI ---
window.toggleMangueiraFields = function () {
    const checkbox = document.getElementById('h-tem-mangueira');
    const container = document.getElementById('h-detalhes-container');
    if (!checkbox || !container) return;
    const inputs = container.querySelectorAll('input, select, textarea, button');
    if (checkbox.checked) {
        container.classList.remove('opacity-50', 'pointer-events-none');
        inputs.forEach(el => el.disabled = false);
    } else {
        container.classList.add('opacity-50', 'pointer-events-none');
        inputs.forEach(el => el.disabled = true);
    }
};

window.toggleSinalizacaoFields = function () {
    const select = document.getElementById('s-existente');
    const container = document.getElementById('s-detalhes-container');
    if (!select || !container) return;
    const inputs = container.querySelectorAll('input, select');
    if (select.value === 'Sim') {
        container.classList.remove('opacity-50', 'pointer-events-none');
        inputs.forEach(el => el.disabled = false);
    } else {
        container.classList.add('opacity-50', 'pointer-events-none');
        inputs.forEach(el => el.disabled = true);
    }
};

// --- Persistência e Limpeza ---
function restoreFormState() {
    document.querySelectorAll('.save-state').forEach(input => {
        const saved = localStorage.getItem(input.id);
        if (saved !== null) {
            if (input.type === 'checkbox') input.checked = (saved === 'true');
            else input.value = saved;
        }
    });
}

function clearFormState(keepHeader = true) {
    const idsToClear = [
        'h-lances', 'h-obs', 'h-validade',
        'e-peso', 'e-recarga', 'e-teste', 'e-obs',
        'l-autonomia', 'l-obs',
        'b-obs',
        's-obs', 's-tipo',
        'el-tipo', 'el-botoeiras', 'el-manutencao', 'el-obs',
        'g-obs',
        'sum-parecer', 'sum-resumo', 'sum-riscos', 'sum-conclusao'
    ];

    idsToClear.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.value = "";
            localStorage.removeItem(id);
        }
    });

    document.querySelectorAll('input[type="checkbox"]').forEach(el => {
        if (['s-foto', 's-fixacao', 's-visivel', 's-legivel'].includes(el.id)) {
            el.checked = true;
        } else if (el.id === 'h-tem-mangueira') {
            el.checked = true;
        } else if (['el-painel', 'el-piloto', 'el-ruido', 'el-fixacao'].includes(el.id)) {
            el.checked = true;
        } else {
            el.checked = false;
        }
        localStorage.removeItem(el.id);
    });

    document.querySelectorAll('select.save-state').forEach(el => {
        el.selectedIndex = 0;
        localStorage.removeItem(el.id);
    });

    if (document.getElementById('sum-parecer')) {
        document.getElementById('sum-parecer').selectedIndex = 0;
    }

    if (window.toggleMangueiraFields) window.toggleMangueiraFields();
    if (window.toggleSinalizacaoFields) window.toggleSinalizacaoFields();

    if (!keepHeader) localStorage.clear();
}

// --- Autenticação ---
async function handleLogin() {
    if (!auth) return alert("Firebase não configurado");
    try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (e) { alert("Erro login: " + e.message); }
}
function handleLogout() { if (auth) signOut(auth); window.toggleMenu(); }
function updateUserUI() {
    const loginBtn = document.getElementById('btn-login');
    const userInfo = document.getElementById('user-info');
    const nameSpan = document.getElementById('user-name');
    const logoutSide = document.getElementById('btn-logout-side');
    if (user) {
        loginBtn.classList.add('hidden'); userInfo.classList.remove('hidden'); userInfo.classList.add('flex');
        nameSpan.textContent = user.displayName.split(' ')[0]; logoutSide.classList.remove('hidden');
    } else {
        loginBtn.classList.remove('hidden'); userInfo.classList.add('hidden'); userInfo.classList.remove('flex');
        logoutSide.classList.add('hidden'); document.getElementById('history-list').innerHTML = '<p class="text-sm text-gray-500 text-center">Faça login para ver.</p>';
    }
}
window.loadHistory = async function () {
    if (!user || !db) return;
    const listEl = document.getElementById('history-list');
    listEl.innerHTML = '<p class="text-center text-xs">Atualizando...</p>';
    try {
        const q = query(collection(db, "vistorias"), where("userId", "==", user.uid), orderBy("timestamp", "desc"), limit(10));
        const querySnapshot = await getDocs(q);
        listEl.innerHTML = "";
        if (querySnapshot.empty) { listEl.innerHTML = '<p class="text-center text-xs text-gray-400">Nenhuma vistoria salva.</p>'; return; }
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const date = data.timestamp ? new Date(data.timestamp.seconds * 1000).toLocaleDateString() : 'Data N/A';
            const item = document.createElement('div');
            item.className = "bg-gray-100 p-3 rounded border border-gray-200 text-sm";
            item.innerHTML = `<div class="font-bold text-slate-700">${data.cliente || 'Sem Nome'}</div><div class="text-xs text-gray-500">${data.local} • ${date}</div><div class="text-xs text-green-600 mt-1">Salvo na nuvem</div>`;
            listEl.appendChild(item);
        });
    } catch (e) { listEl.innerHTML = '<p class="text-red-500 text-xs text-center">Erro ao carregar</p>'; }
};

// --- Arquivos ---
function handleFileSelect(event) {
    if (event.target.files && event.target.files.length > 0) {
        currentFiles = [...currentFiles, ...Array.from(event.target.files)];
        updateImagePreview();
        event.target.value = "";
    }
}
function removeFile(index) { currentFiles.splice(index, 1); updateImagePreview(); }
function clearFiles() { currentFiles = []; updateImagePreview(); }
function updateImagePreview() {
    const gallery = document.getElementById('preview-gallery');
    gallery.innerHTML = "";
    if (currentFiles.length > 0) {
        gallery.classList.remove('hidden'); gallery.classList.add('flex');
        currentFiles.forEach((file, index) => {
            const container = document.createElement('div'); container.className = "thumb-container";
            const img = document.createElement('img'); img.src = URL.createObjectURL(file); img.className = "thumb-preview";
            const btn = document.createElement('button'); btn.className = "btn-remove-thumb"; btn.innerHTML = "×"; btn.onclick = () => removeFile(index);
            container.appendChild(img); container.appendChild(btn); gallery.appendChild(container);
        });
    } else { gallery.classList.add('hidden'); gallery.classList.remove('flex'); }
}

// --- CRUD ---
function addItem() {
    if (currentType === 'sumario') {
        alert("A aba Sumário é para dados gerais do relatório. Preencha e clique em Salvar Nuvem ou PDF.");
        return;
    }

    const andarInput = document.getElementById('andar').value;
    const idInput = document.getElementById('item-id').value;

    // Validação: Só exige Andar/ID se NÃO for a aba Geral
    if (currentType !== 'geral') {
        if (!andarInput || !idInput) { alert("Preencha o Local e a Identificação do item."); return; }
    }

    // Define valores padrão para Geral (para não quebrar a estrutura)
    const andar = currentType === 'geral' ? '-' : andarInput;
    const id = currentType === 'geral' ? 'Geral' : idInput;

    const baseItem = { uid: Date.now(), type: currentType, andar, id, imageFiles: [...currentFiles] };
    let specifics = {};

    if (currentType === 'hidrante') {
        const temMangueira = document.getElementById('h-tem-mangueira').checked;
        specifics = {
            check_registro: document.getElementById('h-registro').checked,
            check_adaptador: document.getElementById('h-adaptador').checked,
            check_chave: document.getElementById('h-chave').checked,
            check_esguicho: document.getElementById('h-esguicho').checked,
            tem_mangueira: temMangueira,
            selo: temMangueira ? document.getElementById('h-selo').value : '-',
            validade: temMangueira ? (document.getElementById('h-validade').value || '-') : '-',
            lances: temMangueira ? (document.getElementById('h-lances').value || '1') : '0',
            metragem: temMangueira ? document.getElementById('h-metragem').value : '-',
            obs: temMangueira ? document.getElementById('h-obs').value : ''
        };
    } else if (currentType === 'extintor') {
        specifics = {
            tipo: document.getElementById('e-tipo').value,
            peso: document.getElementById('e-peso').value,
            recarga: document.getElementById('e-recarga').value || '-',
            teste_hidro: document.getElementById('e-teste').value || '-',
            check_lacre: document.getElementById('e-lacre').checked,
            check_manometro: document.getElementById('e-manometro').checked,
            check_sinalizacao: document.getElementById('e-sinalizacao').checked,
            check_mangueira: document.getElementById('e-mangueira').checked,
            obs: document.getElementById('e-obs').value
        };
    } else if (currentType === 'luz') {
        specifics = {
            tipo: document.getElementById('l-tipo').value,
            estado: document.getElementById('l-estado').value,
            autonomia: document.getElementById('l-autonomia').value,
            check_acendimento: document.getElementById('l-acendimento').checked,
            check_led: document.getElementById('l-led').checked,
            check_fixacao: document.getElementById('l-fixacao').checked,
            check_lux: document.getElementById('l-lux').checked,
            obs: document.getElementById('l-obs').value
        };
    } else if (currentType === 'bomba') {
        specifics = {
            operacao: document.getElementById('b-operacao').checked, teste_pressao: document.getElementById('b-teste').checked,
            necessita_manutencao: document.getElementById('b-manutencao').checked, obs: document.getElementById('b-obs').value
        };
        if (specifics.necessita_manutencao && !specifics.obs.trim()) {
            alert("⚠️ ATENÇÃO: Você indicou manutenção na bomba.\n\nPor favor, descreva o problema na observação.");
            document.getElementById('b-obs').focus(); return;
        }
    } else if (currentType === 'sinalizacao') {
        const existe = document.getElementById('s-existente').value;
        specifics = {
            existente: existe,
            tipo: existe === 'Sim' ? document.getElementById('s-tipo').value : '-',
            check_foto: existe === 'Sim' ? document.getElementById('s-foto').checked : false,
            check_fixacao: existe === 'Sim' ? document.getElementById('s-fixacao').checked : false,
            check_visivel: existe === 'Sim' ? document.getElementById('s-visivel').checked : false,
            check_legivel: existe === 'Sim' ? document.getElementById('s-legivel').checked : false,
            obs: document.getElementById('s-obs').value
        };
    } else if (currentType === 'eletro') {
        specifics = {
            tipo_sistema: document.getElementById('el-tipo').value,
            botoeiras: document.getElementById('el-botoeiras').value,
            precisa_manutencao: document.getElementById('el-manutencao').value,
            check_painel: document.getElementById('el-painel').checked,
            check_piloto: document.getElementById('el-piloto').checked,
            check_ruido: document.getElementById('el-ruido').checked,
            check_fixacao: document.getElementById('el-fixacao').checked,
            obs: document.getElementById('el-obs').value
        };
        if (specifics.precisa_manutencao === 'Sim' && !specifics.obs.trim()) {
            alert("⚠️ Por favor, descreva o motivo da manutenção na observação.");
            document.getElementById('el-obs').focus();
            return;
        }
    } else if (currentType === 'geral') {
        specifics = {
            obs: document.getElementById('g-obs').value
        };
        if (!specifics.obs.trim()) {
            alert("⚠️ Digite alguma observação antes de adicionar.");
            document.getElementById('g-obs').focus();
            return;
        }
    }

    items.push({ ...baseItem, ...specifics });
    renderList();
    clearFormState();
    clearFiles();

    // Foca no ID apenas se não for aba Geral (pois o campo está oculto)
    if (currentType !== 'geral') {
        document.getElementById('item-id').focus();
    }
}

window.editItem = function (uid) {
    const index = items.findIndex(i => i.uid === uid);
    if (index === -1) return;
    const item = items[index];

    window.showConfirmModal("Editar Item", `Deseja trazer o item "${item.id}" de volta para o formulário de edição?`, () => {
        window.switchTab(item.type);

        // Só restaura ID/Andar se não for 'Geral'
        if (item.type !== 'geral') {
            document.getElementById('andar').value = item.andar;
            document.getElementById('item-id').value = item.id;
        } else {
            document.getElementById('andar').value = '';
            document.getElementById('item-id').value = '';
        }

        if (item.type === 'hidrante') {
            document.getElementById('h-registro').checked = item.check_registro;
            document.getElementById('h-adaptador').checked = item.check_adaptador;
            document.getElementById('h-chave').checked = item.check_chave;
            document.getElementById('h-esguicho').checked = item.check_esguicho;
            const temMangueira = item.tem_mangueira !== undefined ? item.tem_mangueira : true;
            document.getElementById('h-tem-mangueira').checked = temMangueira;
            document.getElementById('h-selo').value = item.selo;
            document.getElementById('h-validade').value = item.validade === '-' ? '' : item.validade;
            document.getElementById('h-lances').value = item.lances === '0' ? '' : item.lances;
            document.getElementById('h-metragem').value = item.metragem === '-' ? '15m' : item.metragem;
            document.getElementById('h-obs').value = item.obs;
            window.toggleMangueiraFields();
        } else if (item.type === 'extintor') {
            document.getElementById('e-tipo').value = item.tipo;
            document.getElementById('e-peso').value = item.peso;
            document.getElementById('e-recarga').value = item.recarga === '-' ? '' : item.recarga;
            document.getElementById('e-teste').value = item.teste_hidro === '-' ? '' : item.teste_hidro;
            document.getElementById('e-lacre').checked = item.check_lacre;
            document.getElementById('e-manometro').checked = item.check_manometro;
            document.getElementById('e-sinalizacao').checked = item.check_sinalizacao;
            document.getElementById('e-mangueira').checked = item.check_mangueira;
            document.getElementById('e-obs').value = item.obs || '';
        } else if (item.type === 'luz') {
            document.getElementById('l-tipo').value = item.tipo;
            document.getElementById('l-estado').value = item.estado;
            document.getElementById('l-autonomia').value = item.autonomia;
            document.getElementById('l-acendimento').checked = item.check_acendimento;
            document.getElementById('l-led').checked = item.check_led;
            document.getElementById('l-fixacao').checked = item.check_fixacao;
            document.getElementById('l-lux').checked = item.check_lux;
            document.getElementById('l-obs').value = item.obs || '';
        } else if (item.type === 'bomba') {
            document.getElementById('b-operacao').checked = item.operacao;
            document.getElementById('b-teste').checked = item.teste_pressao;
            document.getElementById('b-manutencao').checked = item.necessita_manutencao;
            document.getElementById('b-obs').value = item.obs;
        } else if (item.type === 'sinalizacao') {
            document.getElementById('s-existente').value = item.existente;
            document.getElementById('s-tipo').value = item.tipo || 'Saida';
            document.getElementById('s-foto').checked = item.check_foto;
            document.getElementById('s-fixacao').checked = item.check_fixacao;
            document.getElementById('s-visivel').checked = item.check_visivel;
            document.getElementById('s-legivel').checked = item.check_legivel;
            document.getElementById('s-obs').value = item.obs || '';
            window.toggleSinalizacaoFields();
        } else if (item.type === 'eletro') {
            document.getElementById('el-tipo').value = item.tipo_sistema;
            document.getElementById('el-botoeiras').value = item.botoeiras;
            document.getElementById('el-manutencao').value = item.precisa_manutencao;
            document.getElementById('el-painel').checked = item.check_painel;
            document.getElementById('el-piloto').checked = item.check_piloto;
            document.getElementById('el-ruido').checked = item.check_ruido;
            document.getElementById('el-fixacao').checked = item.check_fixacao;
            document.getElementById('el-obs').value = item.obs || '';
        } else if (item.type === 'geral') {
            document.getElementById('g-obs').value = item.obs || '';
        }

        currentFiles = item.imageFiles ? [...item.imageFiles] : [];
        updateImagePreview();
        items.splice(index, 1);
        renderList();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        document.querySelectorAll('.save-state').forEach(el => el.dispatchEvent(new Event('input')));
    }, false);
};

window.removeItem = function (uid) {
    window.showConfirmModal("Excluir Item", "Tem certeza que deseja remover este item da lista?", () => {
        items = items.filter(i => i.uid !== uid);
        renderList();
    }, true);
};

function renderList() {
    const listEl = document.getElementById('lista-itens');
    document.getElementById('count').innerText = items.length;
    listEl.innerHTML = "";

    if (items.length === 0) {
        listEl.innerHTML = '<div class="text-center py-10 border-2 border-dashed border-gray-200 rounded-lg text-gray-400 text-sm">Lista vazia.</div>';
        return;
    }

    const fragment = document.createDocumentFragment();

    items.slice().reverse().forEach(item => {
        let icon = item.type === 'hidrante' ? 'droplets' :
            (item.type === 'extintor' ? 'fire-extinguisher' :
                (item.type === 'luz' ? 'lightbulb' :
                    (item.type === 'bomba' ? 'activity' :
                        (item.type === 'sinalizacao' ? 'signpost' :
                            (item.type === 'eletro' ? 'zap' :
                                (item.type === 'geral' ? 'clipboard-list' : 'circle'))))));

        let color = item.type === 'hidrante' ? 'blue' :
            (item.type === 'extintor' ? 'red' :
                (item.type === 'luz' ? 'amber' :
                    (item.type === 'bomba' ? 'purple' :
                        (item.type === 'sinalizacao' ? 'teal' :
                            (item.type === 'eletro' ? 'indigo' :
                                (item.type === 'geral' ? 'slate' : 'gray'))))));

        const photoBadge = (item.imageFiles && item.imageFiles.length > 0)
            ? `<span class="text-xs bg-blue-100 text-blue-700 px-1 rounded ml-1 flex items-center gap-1"><i data-lucide="camera" class="w-3 h-3"></i> ${item.imageFiles.length}</span>`
            : '';

        const div = document.createElement('div');
        div.className = `bg-white p-3 rounded shadow-sm border-l-4 border-${color}-500 flex justify-between items-center animate-fade-in group hover:shadow-md transition-all`;

        // Se for Geral, mostra a descrição resumida no título. Se for outro, mostra ID | Andar
        let titleText = (item.type === 'geral')
            ? (item.obs ? (item.obs.length > 30 ? item.obs.substring(0, 30) + '...' : item.obs) : 'Observação Geral')
            : `${item.id} | ${item.andar}`;

        div.innerHTML = `
            <div class="flex items-center gap-3 overflow-hidden">
                <div class="p-2 bg-gray-50 rounded-full text-gray-600 flex-shrink-0 group-hover:bg-${color}-50 group-hover:text-${color}-600 transition-colors">
                    <i data-lucide="${icon}" class="w-5 h-5"></i>
                </div>
                <div class="min-w-0">
                    <div class="font-bold text-gray-800 text-sm truncate" id="item-title-${item.uid}"></div>
                    <div class="text-xs text-gray-500 truncate flex items-center">
                        ${item.type.toUpperCase()} ${photoBadge}
                    </div>
                </div>
            </div>
            <div class="flex items-center gap-1">
                <button class="btn-edit text-blue-400 hover:text-blue-600 p-2 rounded hover:bg-blue-50 transition-colors" title="Editar">
                    <i data-lucide="pencil" class="w-4 h-4"></i>
                </button>
                <button class="btn-del text-red-300 hover:text-red-600 p-2 rounded hover:bg-red-50 transition-colors" title="Excluir">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </div>
        `;

        div.querySelector(`#item-title-${item.uid}`).textContent = titleText;
        div.querySelector('.btn-edit').addEventListener('click', () => window.editItem(item.uid));
        div.querySelector('.btn-del').addEventListener('click', () => window.removeItem(item.uid));
        fragment.appendChild(div);
    });

    listEl.appendChild(fragment);
    lucide.createIcons();
}

const readFileAsDataURL = (file) => { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = (e) => resolve(e.target.result); reader.onerror = reject; reader.readAsDataURL(file); }); };

async function generatePDF(mode = 'save') {
    if (items.length === 0 && mode === 'save') return alert("Lista vazia! Adicione itens antes de gerar o relatório.");

    const btn = document.getElementById('btn-pdf');
    let oldText = "";
    if (mode === 'save') {
        oldText = btn.innerHTML;
        btn.innerHTML = "Processando...";
        btn.disabled = true;
    }

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // --- 1. CABEÇALHO (DADOS OBRA E DATA) ---
        const cliente = document.getElementById('cliente').value || "Não Informado";
        const local = document.getElementById('local').value || "Não Informado";
        const tecnico = document.getElementById('resp-tecnico').value || "Não Informado";
        const classificacao = document.getElementById('classificacao').value || "-";

        // Datas
        const dataRaw = document.getElementById('data-relatorio').value;
        const dataRelatorio = dataRaw ? dataRaw.split('-').reverse().join('/') : new Date().toLocaleDateString();
        const avcbRaw = document.getElementById('validade-avcb').value;
        const dataAvcb = avcbRaw ? avcbRaw.split('-').reverse().join('/') : "-";

        // Design do Cabeçalho
        doc.setFillColor(30, 41, 59); // Slate 800
        doc.rect(0, 0, 210, 45, 'F');

        doc.setTextColor(255);
        doc.setFontSize(16);
        doc.setFont(undefined, 'bold');
        doc.text("RELATÓRIO TÉCNICO DE VISTORIA", 105, 15, { align: 'center' });

        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        doc.text("Sistemas de Prevenção e Combate a Incêndio", 105, 22, { align: 'center' });

        // Grid de Dados
        doc.setFontSize(9);
        doc.text(`Cliente: ${cliente}`, 14, 32);
        doc.text(`Local: ${local}`, 14, 37);
        doc.text(`Resp. Técnico: ${tecnico}`, 110, 32);
        doc.text(`Classificação: ${classificacao}`, 110, 37);

        doc.setFont(undefined, 'bold');
        doc.setTextColor(147, 197, 253); // Azul claro
        doc.text(`Data: ${dataRelatorio}`, 175, 32);
        doc.text(`AVCB: ${dataAvcb}`, 175, 37);

        let yPos = 55;

        // --- 2. SUMÁRIO EXECUTIVO ---
        const parecer = document.getElementById('sum-parecer') ? document.getElementById('sum-parecer').value : '';
        const resumo = document.getElementById('sum-resumo') ? document.getElementById('sum-resumo').value : '';
        const riscos = document.getElementById('sum-riscos') ? document.getElementById('sum-riscos').value : '';

        if (parecer || resumo || riscos) {
            doc.setTextColor(0);
            doc.setFontSize(12);
            doc.setFont(undefined, 'bold');
            doc.text("1. Sumário Executivo", 14, yPos);
            yPos += 5;

            // Caixa do Parecer
            let corParecer = [220, 252, 231]; // Verde claro
            if (parecer.includes("Restrições")) corParecer = [254, 249, 195]; // Amarelo
            if (parecer.includes("Reprovado")) corParecer = [254, 226, 226]; // Vermelho

            doc.setFillColor(...corParecer);
            doc.roundedRect(14, yPos, 182, 10, 1, 1, 'F');
            doc.setFontSize(10);
            doc.setTextColor(30);
            doc.text(`Situação: ${parecer.toUpperCase()}`, 105, yPos + 6.5, { align: 'center' });
            yPos += 15;

            if (resumo) {
                doc.setFontSize(10);
                doc.setFont(undefined, 'bold');
                doc.text("Resumo das Instalações:", 14, yPos);
                yPos += 5;
                doc.setFont(undefined, 'normal');
                const splitResumo = doc.splitTextToSize(resumo, 180);
                doc.text(splitResumo, 14, yPos);
                yPos += splitResumo.length * 5 + 3;
            }

            if (riscos) {
                doc.setFont(undefined, 'bold');
                doc.setTextColor(185, 28, 28); // Vermelho escuro
                doc.text("Principais Não Conformidades:", 14, yPos);
                yPos += 5;
                doc.setFont(undefined, 'normal');
                doc.setTextColor(0);
                const splitRiscos = doc.splitTextToSize(riscos, 180);
                doc.text(splitRiscos, 14, yPos);
                yPos += splitRiscos.length * 5 + 5;
            }

            // Linha separadora
            doc.setDrawColor(200);
            doc.line(14, yPos, 196, yPos);
            yPos += 10;
        }

        // --- 3. SEÇÕES TÉCNICAS (ITENS VISTORIADOS) ---
        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(0);
        doc.text("2. Detalhamento Técnico", 14, yPos);
        yPos += 5;

        // Função auxiliar para gerar tabelas
        const generateTable = (title, data, headers, color) => {
            if (data.length === 0) return;
            // Verifica se cabe na página
            if (yPos > 250) { doc.addPage(); yPos = 20; }

            doc.setFontSize(11);
            doc.setTextColor(...color);
            doc.text(title, 14, yPos);
            yPos += 2;

            doc.autoTable({
                startY: yPos,
                head: [headers],
                body: data,
                theme: 'grid',
                headStyles: { fillColor: color },
                styles: { fontSize: 8 },
                margin: { left: 14, right: 14 }
            });
            yPos = doc.lastAutoTable.finalY + 10;
        };

        // Hidrantes
        const hid = items.filter(i => i.type === 'hidrante');
        generateTable("Hidrantes", hid.map(i => {
            let faltantes = [];
            if (!i.check_registro) faltantes.push('Reg');
            if (!i.check_adaptador) faltantes.push('Adap');
            if (!i.check_chave) faltantes.push('Chv');
            if (!i.check_esguicho) faltantes.push('Esg');
            const statusComp = faltantes.length === 0 ? 'OK' : faltantes.join(', ');
            const mangueiraInfo = i.tem_mangueira ? `${i.lances}x ${i.metragem}` : 'AUSENTE';
            return [i.andar, i.id, mangueiraInfo, i.tem_mangueira ? i.validade : '-', statusComp, i.obs || '-'];
        }), ['Local', 'ID', 'Mangueira', 'Validade', 'Acessórios', 'Obs'], [37, 99, 235]);

        // Extintores
        const ext = items.filter(i => i.type === 'extintor');
        generateTable("Extintores", ext.map(i => [
            i.andar, i.id, i.tipo, i.peso, i.recarga,
            (i.check_lacre && i.check_manometro) ? 'OK' : 'Verificar', i.obs || '-'
        ]), ['Local', 'ID', 'Tipo', 'Peso', 'Recarga', 'Status', 'Obs'], [220, 38, 38]);

        // Iluminação
        const luz = items.filter(i => i.type === 'luz');
        generateTable("Iluminação de Emergência", luz.map(i => [
            i.andar, i.id, i.tipo, i.estado, i.autonomia, i.obs || '-'
        ]), ['Local', 'ID', 'Tipo', 'Estado', 'Autonomia', 'Obs'], [217, 119, 6]);

        // Sinalização
        const sin = items.filter(i => i.type === 'sinalizacao');
        generateTable("Sinalização", sin.map(i => {
            let status = 'OK';
            if (i.existente === 'Sim') {
                let falhas = [];
                if (!i.check_foto) falhas.push('Fotom.');
                if (!i.check_fixacao) falhas.push('Fixação');
                if (!i.check_visivel) falhas.push('Visib.');
                status = falhas.length === 0 ? 'Conforme' : falhas.join(', ');
            } else { status = 'Inexistente'; }
            return [i.andar, i.id, i.tipo || '-', status, i.obs || '-'];
        }), ['Local', 'ID', 'Tipo', 'Conformidade', 'Obs'], [13, 148, 136]);

        // Eletromecanização
        const eletro = items.filter(i => i.type === 'eletro');
        generateTable("Sistemas Eletromecânicos", eletro.map(i => {
            const manut = i.precisa_manutencao === 'Sim' ? 'SIM' : 'Não';
            return [i.andar, i.tipo_sistema, i.botoeiras, manut, i.obs || '-'];
        }), ['Local', 'Sistema', 'Botoeira', 'Manutenção', 'Obs'], [79, 70, 229]);

        // Bombas
        const bombas = items.filter(i => i.type === 'bomba');
        generateTable("Bombas de Incêndio", bombas.map(i => [
            i.andar, i.id, i.operacao ? 'Auto' : 'Manual/Off', i.teste_pressao ? 'Sim' : 'Não', i.necessita_manutencao ? 'SIM' : 'Não', i.obs || '-'
        ]), ['Local', 'ID', 'Modo', 'Teste', 'Manut.', 'Obs'], [124, 58, 237]);

        // Observações Gerais (Tabela Simplificada sem Local/ID)
        const geral = items.filter(i => i.type === 'geral');
        generateTable("Observações Gerais", geral.map(i => [
            i.obs || '-'
        ]), ['Descrição'], [71, 85, 105]);

        // --- 4. CONCLUSÕES E RECOMENDAÇÕES ---
        if (yPos > 230) { doc.addPage(); yPos = 20; }

        const conclusao = document.getElementById('sum-conclusao') ? document.getElementById('sum-conclusao').value : '';
        if (conclusao) {
            yPos += 5;
            doc.setFontSize(12);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(0);
            doc.text("3. Conclusões e Recomendações", 14, yPos);
            yPos += 7;

            doc.setFontSize(10);
            doc.setFont(undefined, 'normal');
            const splitConclusao = doc.splitTextToSize(conclusao, 180);
            doc.text(splitConclusao, 14, yPos);
            yPos += splitConclusao.length * 5 + 15;
        } else {
            yPos += 15;
        }

        // --- 5. ASSINATURAS ---
        if (yPos > 240) { doc.addPage(); yPos = 40; } // Garante espaço para assinaturas

        // Área de assinaturas
        const sigY = yPos + 10;

        doc.setLineWidth(0.5);
        doc.setDrawColor(0);

        // Assinatura 1 (Técnico)
        doc.line(20, sigY, 90, sigY);
        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        doc.text("Responsável Técnico", 55, sigY + 5, { align: 'center' });
        doc.setFont(undefined, 'normal');
        doc.text(tecnico, 55, sigY + 10, { align: 'center' });

        // Assinatura 2 (Cliente)
        doc.line(120, sigY, 190, sigY);
        doc.setFont(undefined, 'bold');
        doc.text("Recebido por (Cliente)", 155, sigY + 5, { align: 'center' });
        doc.setFont(undefined, 'normal');
        doc.text(cliente, 155, sigY + 10, { align: 'center' });


        // --- 6. ANEXOS / FOTOS (Nova Página) ---
        const itemsWithPhotos = items.filter(i => i.imageFiles && i.imageFiles.length > 0);
        if (itemsWithPhotos.length > 0) {
            doc.addPage();
            doc.setTextColor(0);
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.text("Anexo: Relatório Fotográfico", 14, 20);

            let x = 14;
            let y = 30;
            const imgWidth = 85;
            const imgHeight = 85;
            const gap = 10;

            for (const item of itemsWithPhotos) {
                // Título do item
                if (y + 10 > 280) { doc.addPage(); y = 20; }
                doc.setFontSize(10);
                doc.setFont(undefined, 'bold');
                doc.setFillColor(240);
                doc.rect(14, y - 4, 182, 6, 'F');

                // Título ajustado para Geral
                const itemTitle = (item.type === 'geral')
                    ? `Item: Observação Geral`
                    : `Item: ${item.id} - ${item.andar} (${item.type.toUpperCase()})`;

                doc.text(itemTitle, 16, y);
                y += 5;

                // Loop das fotos
                for (let i = 0; i < item.imageFiles.length; i++) {
                    try {
                        const imgData = await readFileAsDataURL(item.imageFiles[i]);

                        if (y + imgHeight > 285) {
                            doc.addPage();
                            y = 20;
                            doc.text(`${itemTitle} (Continuação)`, 14, y - 5);
                        }

                        // Desenha a imagem
                        doc.addImage(imgData, 'JPEG', x, y, imgWidth, imgHeight);

                        // Borda na imagem
                        doc.setDrawColor(200);
                        doc.rect(x, y, imgWidth, imgHeight);

                        // Legenda
                        doc.setFont(undefined, 'normal');
                        doc.setFontSize(8);
                        doc.text(`Foto ${i + 1}`, x, y + imgHeight + 4);

                        // Lógica de Grid (2 colunas)
                        if (x === 14) {
                            x = 14 + imgWidth + gap;
                        } else {
                            x = 14;
                            y += imgHeight + 12;
                        }

                    } catch (err) { console.error("Erro img PDF", err); }
                }
                // Reseta X e ajusta Y se a linha ficou incompleta
                if (x > 14) {
                    x = 14;
                    y += imgHeight + 12;
                }
                y += 5; // Espaço entre itens
            }
        }

        // Salvar
        if (mode === 'save') {
            doc.save(`Relatorio_${cliente.replace(/\s+/g, '_')}.pdf`);
        } else {
            const blob = doc.output('bloburl');
            document.getElementById('pdf-frame').src = blob;
        }

    } catch (e) {
        console.error(e);
        if (mode === 'save') alert("Erro ao gerar PDF: " + e.message);
    } finally {
        if (mode === 'save') {
            btn.innerHTML = oldText;
            btn.disabled = false;
        }
    }
}

async function saveToFirebase() {
    if (!db || !user) return alert("Faça login para salvar!");
    const btn = document.getElementById('btn-save'); const oldText = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Salvando...`;
    lucide.createIcons();
    btn.disabled = true;

    try {
        const headerData = {
            userId: user.uid,
            cliente: document.getElementById('cliente').value || "Não Informado",
            local: document.getElementById('local').value || "Não Informado",
            respTecnico: document.getElementById('resp-tecnico').value || "Não Informado",
            classificacao: document.getElementById('classificacao').value || "-",
            validadeAvcb: document.getElementById('validade-avcb').value || null,

            // Novos campos do Sumário
            parecerTecnico: document.getElementById('sum-parecer').value,
            resumoInstalacoes: document.getElementById('sum-resumo').value,
            principaisRiscos: document.getElementById('sum-riscos').value,
            conclusaoFinal: document.getElementById('sum-conclusao').value,

            data: document.getElementById('data-relatorio').value,
            timestamp: new Date(),
            totalItens: items.length
        };

        const vistoriaRef = await addDoc(collection(db, "vistorias"), headerData);
        const promises = items.map(async (item) => {
            let urls = [];
            if (item.imageFiles && item.imageFiles.length > 0) {
                const uploadPromises = item.imageFiles.map(async (file, index) => {
                    const imgRef = ref(storage, `fotos/${user.uid}/${vistoriaRef.id}/${item.id}_${index}_${Date.now()}`);
                    await uploadBytes(imgRef, file);
                    return await getDownloadURL(imgRef);
                });
                urls = await Promise.all(uploadPromises);
            }
            const { imageFiles, ...itemData } = item;
            return addDoc(collection(db, `vistorias/${vistoriaRef.id}/itens`), {
                ...itemData,
                fotoUrls: urls
            });
        });
        await Promise.all(promises);
        alert("Vistoria salva com sucesso na nuvem!");
        loadHistory();
    } catch (e) {
        console.error(e);
        alert("Erro ao salvar: " + e.message);
    } finally {
        btn.innerHTML = oldText;
        btn.disabled = false;
        lucide.createIcons();
    }
}