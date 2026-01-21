import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, collection, addDoc, setDoc, doc, query, where, getDocs, orderBy, limit, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { PhraseManager } from "./phrases.js";
import { generatePDF } from "./pdf-generator.js";
import { compressImage } from "./image-compressor.js";
import { SignaturePad } from "./signature-pad.js";

/* ==========================================================================
   1. CONFIGURAÇÃO E ESTADO GLOBAL
   ========================================================================== */
const TABS = ['sumario', 'hidrante', 'extintor', 'luz', 'bomba', 'sinalizacao', 'eletro', 'geral', 'assinatura'];

// Estado Global
let db, storage, auth, user = null;
let sigTecnico = null;
let sigCliente = null;
let items = [];
let currentType = 'hidrante';
let currentFiles = [];
let backupItem = null; // Para edição
let pendingAction = null; // Para modal de confirmação
let currentReportId = null;
let deferredPrompt; // PWA
let currentSortOrder = 'newest';

/* ==========================================================================
   2. INICIALIZAÇÃO DO FIREBASE
   ========================================================================== */
try {
    if (firebaseConfig.apiKey) {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        storage = getStorage(app);
        auth = getAuth(app);

        // Tenta ativar persistência offline
        enableIndexedDbPersistence(db).catch((err) => {
            console.warn("Persistência Offline:", err.code === 'failed-precondition' ? 'Múltiplas abas abertas' : 'Não suportado');
        });

        onAuthStateChanged(auth, (currentUser) => {
            user = currentUser;
            updateUserUI();
            if (user) loadHistory();
        });
        console.log("🔥 Firebase Inicializado");
    }
} catch (error) {
    console.error("Erro crítico no Firebase:", error);
}

/* ==========================================================================
   3. LISTENERS E DOM READY
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    refreshIcons();
    restoreFormState();
    initializeDateInput();

    // Inicialização de Componentes
    const phrasesManager = new PhraseManager();
    window.phrases = phrasesManager;
    const chkFuncional = document.getElementById('h-acionador-funcional');
    const chkQuebrado = document.getElementById('h-acionador-quebrado');

    if (chkFuncional && chkQuebrado) {
        // Se marcar "Funcional", desmarca "Quebrado"
        chkFuncional.addEventListener('change', function () {
            if (this.checked) {
                chkQuebrado.checked = false;
                localStorage.setItem('h-acionador-quebrado', 'false'); // Atualiza memória local
            }
        });

        // Se marcar "Quebrado", desmarca "Funcional"
        chkQuebrado.addEventListener('change', function () {
            if (this.checked) {
                chkFuncional.checked = false;
                localStorage.setItem('h-acionador-funcional', 'false'); // Atualiza memória local
            }
        });
    }
    sigTecnico = new SignaturePad('sig-tecnico', 'btn-clear-tecnico');
    sigCliente = new SignaturePad('sig-cliente', 'btn-clear-cliente');

    // Recupera cliente salvo
    const savedCliente = localStorage.getItem('cliente');
    if (savedCliente) window.toggleHeader();

    // Configura Título Inicial
    updatePageTitle('Hidrantes');

    // Configura campos condicionais iniciais
    if (document.getElementById('h-tem-mangueira')) window.toggleMangueiraFields();
    if (document.getElementById('h-tem-acionador')) window.toggleAcionadorFields();
    if (document.getElementById('s-existente')) window.toggleSinalizacaoFields();

    // --- EVENT LISTENERS ---
    // Auth
    document.getElementById('btn-login').addEventListener('click', handleLogin);
    document.getElementById('btn-logout-side').addEventListener('click', handleLogout);

    // CRUD & Forms
    document.getElementById('btn-add-item').addEventListener('click', addItem);
    document.getElementById('btn-cancelar').addEventListener('click', cancelarEdicao);

    // Arquivos
    document.getElementById('camera-input').addEventListener('change', handleFileSelect);
    document.getElementById('upload-input').addEventListener('change', handleFileSelect);

    // Persistência
    document.getElementById('btn-save').addEventListener('click', saveToFirebase);

    // PDF
    document.getElementById('btn-pdf').addEventListener('click', () => {
        const signatures = {
            tecnico: sigTecnico ? sigTecnico.getImageData() : null,
            cliente: sigCliente ? sigCliente.getImageData() : null
        };
        generatePDF(items, 'save', signatures);
    });

    // Modal Confirmação
    document.getElementById('btn-confirm-action').addEventListener('click', () => {
        if (pendingAction) pendingAction();
        window.closeConfirmModal();
    });

    // Auto-Save em Inputs
    document.querySelectorAll('.save-state').forEach(input => {
        input.addEventListener('input', () => {
            localStorage.setItem(input.id, input.type === 'checkbox' ? input.checked : input.value);
        });
    });
});

/* ==========================================================================
   4. UI UX & NAVEGAÇÃO
   ========================================================================== */

// Alterna entre abas do formulário
window.switchTab = function (type) {
    currentType = type;

    // Lógica para esconder inputs globais (ID/Andar) em abas específicas
    const inputAndar = document.getElementById('andar');
    const idContainer = inputAndar ? inputAndar.closest('.grid') : null;
    if (idContainer) {
        if (['geral', 'sumario', 'assinatura'].includes(type)) {
            idContainer.classList.add('hidden');
        } else {
            idContainer.classList.remove('hidden');
        }
    }

    // Ativa/Desativa abas visuais e formulários
    TABS.forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        const form = document.getElementById(`form-${t}`);

        if (t === type) {
            if (form) form.classList.remove('hidden');
            // Redimensiona canvas se for aba de assinatura
            if (type === 'assinatura') {
                setTimeout(() => {
                    if (sigTecnico) sigTecnico.resizeCanvas();
                    if (sigCliente) sigCliente.resizeCanvas();
                }, 100);
            }
        } else {
            if (form) form.classList.add('hidden');
        }
    });
};

// Navegação via Menu Lateral
window.switchTabAndClose = function (type, titleFriendly) {
    if (typeof window.showFormPage === 'function') window.showFormPage();
    window.switchTab(type);
    updatePageTitle(titleFriendly);
    window.toggleMenu();
};

function updatePageTitle(title) {
    const titleEl = document.getElementById('page-title');
    if (titleEl) {
        titleEl.innerHTML = `FireCheck <span class="text-slate-400 text-sm font-normal mx-2">|</span> <span class="text-blue-400">${title}</span>`;
    }
}

// Acordeão do Cabeçalho
window.toggleHeader = function () {
    const content = document.getElementById('header-content');
    const chevron = document.getElementById('header-chevron');
    const summary = document.getElementById('header-summary');
    const clienteVal = document.getElementById('cliente').value;

    if (content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        chevron.classList.add('rotate-180');
        summary.classList.add('hidden');
    } else {
        content.classList.add('hidden');
        chevron.classList.remove('rotate-180');
        summary.innerText = clienteVal || "Clique para editar dados";
        summary.classList.remove('hidden');
    }
};

// Alternar entre Lista e Prévia PDF
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

        const signatures = {
            tecnico: sigTecnico ? sigTecnico.getImageData() : null,
            cliente: sigCliente ? sigCliente.getImageData() : null
        };
        generatePDF(items, 'preview', signatures);
    }
};

// Controle de Telas (Edição vs Meus Relatórios)
window.showReportsPage = function () {
    toggleMainInterface(false); // Esconde Form
    const pageReports = document.getElementById('page-reports');
    if (pageReports) {
        pageReports.classList.remove('hidden');
        window.loadCloudReports();
    }
    window.toggleMenu();
};

window.showFormPage = function () {
    toggleMainInterface(true); // Mostra Form
    const pageReports = document.getElementById('page-reports');
    if (pageReports) pageReports.classList.add('hidden');
};

function toggleMainInterface(show) {
    const els = [
        document.getElementById('building-data-container'),
        document.querySelector('section.bg-white'),
        document.querySelector('section.mt-8'),
        document.querySelector('.fixed.bottom-0')
    ];
    els.forEach(el => {
        if (el) show ? el.classList.remove('hidden') : el.classList.add('hidden');
    });
}

// Helpers de Formulário
window.toggleMangueiraFields = function () { toggleFieldGroup('h-tem-mangueira', 'h-detalhes-container'); };
window.toggleSinalizacaoFields = function () { toggleFieldGroup('s-existente', 's-detalhes-container', true); };

function toggleFieldGroup(triggerId, containerId, isSelect = false) {
    const trigger = document.getElementById(triggerId);
    const container = document.getElementById(containerId);
    if (!trigger || !container) return;

    const isActive = isSelect ? trigger.value === 'Sim' : trigger.checked;
    const inputs = container.querySelectorAll('input, select, textarea, button');

    if (isActive) {
        container.classList.remove('opacity-50', 'pointer-events-none');
        inputs.forEach(el => el.disabled = false);
    } else {
        container.classList.add('opacity-50', 'pointer-events-none');
        inputs.forEach(el => el.disabled = true);
    }
}

// Toast Notification
window.showToast = function (message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const bgColor = type === 'error' ? 'bg-red-500' : (type === 'info' ? 'bg-blue-500' : 'bg-emerald-600');

    toast.className = `${bgColor} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-fade-in transition-all transform translate-x-0`;
    toast.innerHTML = `<span class="font-bold text-sm">${message}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

function refreshIcons() {
    if (window.lucide) window.lucide.createIcons();
}

function initializeDateInput() {
    const dateInput = document.getElementById('data-relatorio');
    if (dateInput && !dateInput.value) {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        dateInput.value = now.toISOString().slice(0, 16);
    }
}

/* ==========================================================================
   5. CRUD (CREATE, READ, UPDATE, DELETE)
   ========================================================================== */

function captureFormData(type) {
    let specifics = {};
    switch (type) {
        case 'hidrante':
            const temMangueira = document.getElementById('h-tem-mangueira').checked;
            const temAcionador = document.getElementById('h-tem-acionador').checked;
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
                tem_acionador: temAcionador,
                acionador_funcional: temAcionador ? document.getElementById('h-acionador-funcional').checked : false,
                acionador_quebrado: temAcionador ? document.getElementById('h-acionador-quebrado').checked : false,
                obs: temMangueira ? document.getElementById('h-obs').value : ''
            };
            break;
        case 'extintor':
            specifics = {
                tipo: document.getElementById('e-tipo').value,
                peso: document.getElementById('e-peso').value,
                recarga: document.getElementById('e-recarga').value || '-',
                teste_hidro: document.getElementById('e-teste').value || '-',
                check_lacre: document.getElementById('e-lacre').checked,
                check_manometro: document.getElementById('e-manometro').checked,
                check_sinalizacao: document.getElementById('e-sinalizacao').checked,
                check_mangueira: document.getElementById('e-mangueira').checked,
                obs: document.getElementById('e-obs').value,
                tem_acionador: temAcionador,
                acionador_funcional: temAcionador ? document.getElementById('h-acionador-funcional').checked : false,
                acionador_quebrado: temAcionador ? document.getElementById('h-acionador-quebrado').checked : false
            };
            break;
        case 'luz':
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
            break;
        case 'bomba':
            specifics = {
                operacao: document.getElementById('b-operacao').checked,
                teste_pressao: document.getElementById('b-teste').checked,
                necessita_manutencao: document.getElementById('b-manutencao').checked,
                obs: document.getElementById('b-obs').value
            };
            break;
        case 'sinalizacao':
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
            break;
        case 'eletro':
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
            break;
        case 'geral':
            specifics = { obs: document.getElementById('g-obs').value };
            break;
    }
    return specifics;
}

function addItem() {
    if (currentType === 'sumario') {
        alert("A aba Sumário é para dados gerais. Preencha e clique em Salvar Nuvem ou PDF.");
        return;
    }

    const andarInput = document.getElementById('andar').value;
    const idInput = document.getElementById('item-id').value;

    if (currentType !== 'geral' && (!andarInput || !idInput)) {
        window.showToast("Preencha o Local e a Identificação", "error");
        return;
    }

    if (currentType === 'bomba' && document.getElementById('b-manutencao').checked && !document.getElementById('b-obs').value.trim()) {
        alert("Descreva o problema da bomba na observação.");
        return;
    }

    const specificData = captureFormData(currentType);

    const newItem = {
        uid: Date.now(),
        type: currentType,
        andar: currentType === 'geral' ? '-' : andarInput,
        id: currentType === 'geral' ? 'Geral' : idInput,
        imageFiles: [...currentFiles],
        ...specificData
    };

    items.push(newItem);

    backupItem = null;
    atualizarBotoesModoEdicao(false);
    renderList();
    clearFormState();
    clearFiles();

    if (currentType !== 'geral') document.getElementById('item-id').focus();
    window.showToast("Item adicionado!", "success");
}

window.editItem = function (uid) {
    const index = items.findIndex(i => i.uid === uid);
    if (index === -1) return;
    const item = items[index];

    if (backupItem) window.cancelarEdicao();

    window.showConfirmModal("Editar Item", `Editar "${item.id}"?`, () => {
        backupItem = item;
        atualizarBotoesModoEdicao(true);
        window.switchTab(item.type);

        document.getElementById('andar').value = item.type === 'geral' ? '' : item.andar;
        document.getElementById('item-id').value = item.type === 'geral' ? '' : item.id;

        // Lógica de Preenchimento Simplificada
        // O app usa o sistema de restauração nativa do localStorage para facilitar,
        // mas em edição precisa setar manual.
        if (item.type === 'hidrante') {
            document.getElementById('h-registro').checked = item.check_registro;
            document.getElementById('h-adaptador').checked = item.check_adaptador;
            document.getElementById('h-chave').checked = item.check_chave;
            document.getElementById('h-esguicho').checked = item.check_esguicho;
            document.getElementById('h-tem-mangueira').checked = item.tem_mangueira ?? true;
            document.getElementById('h-selo').value = item.selo;
            document.getElementById('h-validade').value = item.validade === '-' ? '' : item.validade;
            document.getElementById('h-lances').value = item.lances === '0' ? '' : item.lances;
            document.getElementById('h-metragem').value = item.metragem === '-' ? '15m' : item.metragem;
            if (document.getElementById('h-tem-acionador')) {
                document.getElementById('h-tem-acionador').checked = item.tem_acionador || false;
                document.getElementById('h-acionador-funcional').checked = item.acionador_funcional || false;
                document.getElementById('h-acionador-quebrado').checked = item.acionador_quebrado || false;
                // Chama a função visual se ela existir
                if (window.toggleAcionadorFields) window.toggleAcionadorFields();
            }
            document.getElementById('h-obs').value = item.obs;
            document.getElementById('h-tem-acionador').checked = item.tem_acionador || false;
            document.getElementById('h-acionador-funcional').checked = item.acionador_funcional || false;
            document.getElementById('h-acionador-quebrado').checked = item.acionador_quebrado || false;
            window.toggleAcionadorFields();
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
            document.getElementById('b-obs').value = item.obs || '';
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
    });
};

window.cancelarEdicao = function () {
    if (!backupItem) return;
    items.push(backupItem);
    backupItem = null;
    clearFormState();
    clearFiles();
    renderList();
    atualizarBotoesModoEdicao(false);
    window.showToast("Edição cancelada", "info");
};

window.removeItem = function (uid) {
    window.showConfirmModal("Excluir", "Remover este item?", () => {
        items = items.filter(i => i.uid !== uid);
        renderList();
        window.showToast("Item removido", "info");
    }, true);
};

function renderList() {
    const listEl = document.getElementById('lista-itens');
    const countEl = document.getElementById('count');
    if (countEl) countEl.innerText = items.length;
    listEl.innerHTML = "";

    if (items.length === 0) {
        listEl.innerHTML = '<div class="text-center py-10 border-2 border-dashed border-gray-200 rounded-lg text-gray-400 text-sm">Lista vazia.</div>';
        return;
    }

    // 1. Cria uma cópia para não bagunçar a lista original
    let displayItems = [...items];

    // 2. Aplica a ordenação baseada na escolha
    if (currentSortOrder === 'newest') {
        // UID maior (mais novo) primeiro
        displayItems.sort((a, b) => b.uid - a.uid);
    } else if (currentSortOrder === 'oldest') {
        // UID menor (mais velho) primeiro
        displayItems.sort((a, b) => a.uid - b.uid);
    } else if (currentSortOrder === 'az') {
        // Ordenação Alfabética Inteligente (H-2 vem antes de H-10)
        displayItems.sort((a, b) => {
            const idA = a.id || "";
            const idB = b.id || "";
            return idA.localeCompare(idB, undefined, { numeric: true, sensitivity: 'base' });
        });
    }

    const fragment = document.createDocumentFragment();

    // 3. Loop na lista já ordenada
    displayItems.forEach(item => {
        const div = document.createElement('div');
        let color = 'blue';
        if (item.type === 'extintor') color = 'red';
        else if (item.type === 'luz') color = 'amber';
        else if (item.type === 'bomba') color = 'purple';
        else if (item.type === 'sinalizacao') color = 'teal';
        else if (item.type === 'eletro') color = 'indigo';
        else if (item.type === 'geral') color = 'slate';

        div.className = `bg-white p-3 rounded shadow-sm border-l-4 border-${color}-500 flex justify-between items-center group hover:shadow-md transition-all`;

        const photoBadge = (item.imageFiles?.length)
            ? `<span class="text-xs bg-blue-100 text-blue-700 px-1 rounded ml-1"><i data-lucide="camera" class="w-3 h-3 inline"></i> ${item.imageFiles.length}</span>`
            : '';

        div.innerHTML = `
            <div class="flex items-center gap-3 overflow-hidden">
                <div class="min-w-0">
                    <div class="font-bold text-gray-800 text-sm truncate">${item.type === 'geral' ? (item.obs?.substring(0, 30) || 'Geral') : item.id + ' | ' + item.andar}</div>
                    <div class="text-xs text-gray-500 uppercase">${item.type} ${photoBadge}</div>
                </div>
            </div>
            <div class="flex gap-1">
                <button class="btn-edit text-blue-500 p-2"><i data-lucide="pencil" class="w-4 h-4"></i></button>
                <button class="btn-del text-red-400 p-2"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
            </div>
        `;

        div.querySelector('.btn-edit').onclick = () => window.editItem(item.uid);
        div.querySelector('.btn-del').onclick = () => window.removeItem(item.uid);
        fragment.appendChild(div);
    });
    listEl.appendChild(fragment);
    refreshIcons();
}

function atualizarBotoesModoEdicao(editando) {
    const btnAdd = document.getElementById('btn-add-item');
    const btnCancel = document.getElementById('btn-cancelar');
    const btnTexto = document.getElementById('btn-add-text');

    if (editando) {
        btnCancel.classList.remove('hidden'); btnCancel.classList.add('flex');
        btnAdd.classList.remove('bg-slate-800'); btnAdd.classList.add('bg-blue-600');
        btnTexto.innerText = "Salvar Edição";
    } else {
        btnCancel.classList.add('hidden'); btnCancel.classList.remove('flex');
        btnAdd.classList.add('bg-slate-800'); btnAdd.classList.remove('bg-blue-600');
        btnTexto.innerText = "Adicionar Item";
    }
    refreshIcons();
}

/* ==========================================================================
   6. FILES & IMAGENS
   ========================================================================== */
async function handleFileSelect(event) {
    const input = event.target;
    if (!input.files.length) return;

    const btnText = document.getElementById('btn-add-item');
    const originalHtml = btnText.innerHTML;
    btnText.innerHTML = `<i data-lucide="loader-2" class="animate-spin"></i> Processando...`;
    refreshIcons();

    try {
        const compressed = await Promise.all(Array.from(input.files).map(file => compressImage(file)));
        currentFiles = [...currentFiles, ...compressed];
        updateImagePreview();
    } catch (error) {
        console.error(error);
        alert("Erro ao processar imagens.");
    } finally {
        btnText.innerHTML = originalHtml;
        input.value = "";
        refreshIcons();
    }
}

function updateImagePreview() {
    const gallery = document.getElementById('preview-gallery');
    gallery.innerHTML = "";

    if (currentFiles.length > 0) {
        gallery.classList.remove('hidden');
        gallery.classList.add('flex');

        currentFiles.forEach((file, index) => {
            const container = document.createElement('div');
            // Mantém o container relativo para o botão absoluto funcionar
            container.className = "thumb-container relative w-16 h-16";

            container.innerHTML = `
                <img src="${URL.createObjectURL(file)}" class="w-full h-full object-cover rounded border">
                <button class="btn-remove-thumb" type="button">×</button>
            `;

            // Adiciona o evento de click na classe específica
            container.querySelector('.btn-remove-thumb').onclick = () => {
                currentFiles.splice(index, 1);
                updateImagePreview(); // Recarrega a galeria
            };

            gallery.appendChild(container);
        });
    } else {
        gallery.classList.add('hidden');
        gallery.classList.remove('flex');
    }
}

// Helpers Base64
const fileToBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
});

function getHeaderData() {
    return {
        cliente: document.getElementById('cliente').value || "Sem Cliente",
        local: document.getElementById('local').value || "Sem Local",
        tecnico: document.getElementById('resp-tecnico').value,
        classificacao: document.getElementById('classificacao').value,
        data: document.getElementById('data-relatorio').value,
        parecer: document.getElementById('sum-parecer').value,
        resumo: document.getElementById('sum-resumo').value,
        riscos: document.getElementById('sum-riscos').value,
        conclusao: document.getElementById('sum-conclusao').value
    };
}

const base64ToFile = (dataurl, filename) => {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new File([u8arr], filename, { type: mime });
};

/* ==========================================================================
   7. CLOUD & PERSISTÊNCIA (FIREBASE)
   ========================================================================== */
async function saveToFirebase() {
    if (!auth.currentUser) return alert("Faça login para salvar.");

    const btn = document.getElementById('btn-save');
    const oldHtml = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin"></i> Salvando...`;
    btn.disabled = true;
    refreshIcons();

    try {
        if (!currentReportId) currentReportId = `REL_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

        const itemsReady = await Promise.all(items.map(async (item) => ({
            ...item,
            imageFiles: [],
            _savedImages: item.imageFiles ? await Promise.all(item.imageFiles.map(fileToBase64)) : []
        })));

        const reportData = {
            id: currentReportId,
            version: "2.0",
            timestamp: new Date().toISOString(),
            userId: user.uid,
            header: {
                cliente: document.getElementById('cliente').value,
                local: document.getElementById('local').value,
                tecnico: document.getElementById('resp-tecnico').value,
                classificacao: document.getElementById('classificacao').value,
                data: document.getElementById('data-relatorio').value,
                parecer: document.getElementById('sum-parecer').value,
                resumo: document.getElementById('sum-resumo').value,
                riscos: document.getElementById('sum-riscos').value,
                conclusao: document.getElementById('sum-conclusao').value
            },
            items: itemsReady,
            signatures: {
                tecnico: sigTecnico?.getImageData(),
                cliente: sigCliente?.getImageData()
            }
        };

        const blob = new Blob([JSON.stringify(reportData)], { type: "application/json" });
        const storageRef = ref(storage, `backups/${user.uid}/${currentReportId}.json`);
        await uploadBytes(storageRef, blob);
        const downloadUrl = await getDownloadURL(storageRef);

        await setDoc(doc(db, "reports", currentReportId), {
            reportId: currentReportId,
            userId: user.uid,
            cliente: reportData.header.cliente,
            local: reportData.header.local,
            updatedAt: new Date(),
            fileUrl: downloadUrl,
            itemCount: items.length
        }, { merge: true });

        window.showToast("Salvo na nuvem com sucesso!");

    } catch (e) {
        console.error(e);
        alert("Erro ao salvar: " + e.message);
    } finally {
        btn.innerHTML = oldHtml;
        btn.disabled = false;
        refreshIcons();
    }
}

async function loadCloudReports() {
    const container = document.getElementById('reports-list-container');
    if (!user) { container.innerHTML = '<p class="text-center text-red-400">Faça login.</p>'; return; }

    container.innerHTML = '<div class="text-center"><i data-lucide="loader-2" class="animate-spin"></i></div>';
    refreshIcons();

    try {
        const q = query(collection(db, "reports"), where("userId", "==", user.uid), orderBy("updatedAt", "desc"), limit(20));
        const snapshot = await getDocs(q);

        container.innerHTML = "";
        if (snapshot.empty) { container.innerHTML = "<p class='text-center text-gray-400'>Nenhum relatório.</p>"; return; }

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const date = data.updatedAt?.seconds ? new Date(data.updatedAt.seconds * 1000).toLocaleDateString() : '-';

            const div = document.createElement('div');
            div.className = "bg-white p-4 rounded border mb-2 flex justify-between items-center hover:shadow";
            div.innerHTML = `
                <div>
                    <div class="font-bold">${data.cliente || 'Sem Cliente'}</div>
                    <div class="text-xs text-gray-500">${data.local} • ${date}</div>
                </div>
                <button class="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700">Abrir</button>
            `;
            div.querySelector('button').onclick = () => window.restoreCloudReport(data.fileUrl);
            container.appendChild(div);
        });

    } catch (e) {
        console.error(e);
        container.innerHTML = "<p class='text-red-500 text-center'>Erro ao carregar lista.</p>";
    }
}

window.loadCloudReports = loadCloudReports;
window.restoreCloudReport = async function (url) {
    if (items.length > 0 && !confirm("Substituir relatório atual?")) return;

    const loadMsg = document.createElement('div');
    loadMsg.className = "fixed inset-0 bg-black/50 z-50 flex items-center justify-center text-white";
    loadMsg.innerHTML = "Baixando...";
    document.body.appendChild(loadMsg);

    try {
        const resp = await fetch(url);
        const data = await resp.json();

        currentReportId = data.id || data.reportId;

        document.getElementById('cliente').value = data.header.cliente || '';
        document.getElementById('local').value = data.header.local || '';
        document.getElementById('resp-tecnico').value = data.header.tecnico || '';
        document.getElementById('classificacao').value = data.header.classificacao || '';
        document.getElementById('data-relatorio').value = data.header.data || '';
        document.getElementById('sum-parecer').value = data.header.parecer || 'Aprovado';
        document.getElementById('sum-resumo').value = data.header.resumo || '';
        document.getElementById('sum-riscos').value = data.header.riscos || '';
        document.getElementById('sum-conclusao').value = data.header.conclusao || '';

        window.toggleHeader();

        items = data.items.map(item => ({
            ...item,
            imageFiles: item._savedImages ? item._savedImages.map((b64, i) => base64ToFile(b64, `img_${i}.jpg`)) : [],
            _savedImages: undefined
        }));

        if (data.signatures) {
            if (data.signatures.tecnico && sigTecnico) sigTecnico.fromDataURL(data.signatures.tecnico);
            if (data.signatures.cliente && sigCliente) sigCliente.fromDataURL(data.signatures.cliente);
        }

        renderList();
        window.showFormPage();
        window.showToast("Relatório carregado!");

    } catch (e) {
        alert("Erro ao abrir: " + e.message);
    } finally {
        loadMsg.remove();
    }
};

/* ==========================================================================
   8. BACKUP LOCAL (JSON)
   ========================================================================== */

// EXPORTAR BACKUP
window.exportBackup = async function () {
    if (!items.length) return alert("A lista está vazia. Nada para salvar.");

    const btn = document.getElementById('btn-backup');
    const oldText = btn.innerText;
    btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin"></i> Gerando Backup Completo...`;

    try {
        // 1. Processa itens E CONVERTE imagens para Base64
        const itemsFull = await Promise.all(items.map(async (item) => ({
            ...item,
            imageFiles: [], // Remove o objeto File (não salva em JSON)
            // AQUI ESTÁ O SEGREDO: Convertemos e guardamos a string gigante
            _savedImages: item.imageFiles ? await Promise.all(item.imageFiles.map(fileToBase64)) : []
        })));

        const backupData = {
            version: "2.0-full", // Versão completa
            timestamp: new Date().toISOString(),
            header: getHeaderData(), // Usa o helper
            items: itemsFull,
            signatures: {
                tecnico: sigTecnico?.getImageData(),
                cliente: sigCliente?.getImageData()
            }
        };

        // 2. Cria o arquivo para download
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData));
        const a = document.createElement('a');
        a.href = dataStr;
        a.download = `Backup_FireCheck_COMPLETO_${Date.now()}.json`; // Nome sugere que é completo
        document.body.appendChild(a);
        a.click();
        a.remove();

        window.showToast("Backup completo (com fotos) salvo no dispositivo!");

    } catch (e) {
        console.error(e);
        alert("Erro ao gerar backup: " + e.message);
    } finally {
        btn.innerHTML = oldText;
        if (window.lucide) window.lucide.createIcons();
    }
};

// IMPORTAR BACKUP (A função que faltava!)
window.importBackup = function (event) {
    const file = event.target.files[0];
    if (!file) return;

    if (items.length > 0 && !confirm("Substituir dados atuais pelo backup?")) {
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.header || !data.items) throw new Error("JSON Inválido");

            // Restaura Header
            document.getElementById('cliente').value = data.header.cliente || '';
            document.getElementById('local').value = data.header.local || '';
            document.getElementById('resp-tecnico').value = data.header.tecnico || '';
            document.getElementById('classificacao').value = data.header.classificacao || '';
            document.getElementById('data-relatorio').value = data.header.data || '';
            document.getElementById('sum-parecer').value = data.header.parecer || 'Aprovado';
            document.getElementById('sum-resumo').value = data.header.resumo || '';
            document.getElementById('sum-riscos').value = data.header.riscos || '';
            document.getElementById('sum-conclusao').value = data.header.conclusao || '';

            window.toggleHeader();

            // Restaura Itens e Imagens
            items = data.items.map(item => ({
                ...item,
                imageFiles: (item._savedImages || []).map((b64, i) => base64ToFile(b64, `restored_${i}.jpg`)),
                _savedImages: undefined
            }));

            // Restaura Assinaturas
            if (data.signatures) {
                if (data.signatures.tecnico && sigTecnico) sigTecnico.fromDataURL(data.signatures.tecnico);
                if (data.signatures.cliente && sigCliente) sigCliente.fromDataURL(data.signatures.cliente);
            }

            renderList();
            window.showToast("Backup restaurado!");

        } catch (err) {
            console.error(err);
            alert("Erro ao ler backup: " + err.message);
        }
    };
    reader.readAsText(file);
    event.target.value = ''; // Permite recarregar o mesmo arquivo
};

/* ==========================================================================
   9. AUTH & ESTADO
   ========================================================================== */
async function handleLogin() {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (e) { alert(e.message); }
}

function handleLogout() {
    signOut(auth);
    window.toggleMenu();
}

function updateUserUI() {
    const loginBtn = document.getElementById('btn-login');
    const userInfo = document.getElementById('user-info');
    const userName = document.getElementById('user-name');
    const logoutSide = document.getElementById('btn-logout-side');

    if (user) {
        loginBtn.classList.add('hidden');
        userInfo.classList.remove('hidden'); userInfo.classList.add('flex');
        userName.innerText = user.displayName.split(' ')[0];
        logoutSide.classList.remove('hidden');
    } else {
        loginBtn.classList.remove('hidden');
        userInfo.classList.add('hidden'); userInfo.classList.remove('flex');
        logoutSide.classList.add('hidden');
    }
}

async function loadHistory() {
    // Implementação simplificada
}

/* ==========================================================================
   10. UTILITÁRIOS (Helpers)
   ========================================================================== */
function restoreFormState() {
    document.querySelectorAll('.save-state').forEach(input => {
        const saved = localStorage.getItem(input.id);
        if (saved !== null) input.type === 'checkbox' ? input.checked = (saved === 'true') : input.value = saved;
    });
}

function clearFormState(keepHeader = true) {
    const formInputs = document.querySelectorAll('#form-hidrante input, #form-extintor input, textarea');
    formInputs.forEach(el => {
        if (el.type === 'checkbox') el.checked = false;
        else el.value = '';
        localStorage.removeItem(el.id);
    });
    document.querySelectorAll('select.save-state').forEach(el => el.selectedIndex = 0);

    if (!keepHeader) {
        document.getElementById('cliente').value = '';
        localStorage.clear();
    }
}

function clearFiles() {
    currentFiles = [];
    updateImagePreview();
}

window.showConfirmModal = function (title, msg, callback, isDestructive = false) {
    const modal = document.getElementById('modal-confirm');
    document.getElementById('modal-confirm-title').innerText = title;
    document.getElementById('modal-confirm-msg').innerText = msg;
    const btn = document.getElementById('btn-confirm-action');

    btn.className = `px-6 py-2 text-white font-bold rounded-lg shadow-md flex items-center gap-2 ${isDestructive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`;
    btn.innerText = isDestructive ? "Sim, Remover" : "Confirmar";

    pendingAction = callback;
    modal.classList.remove('hidden');
};

window.closeConfirmModal = function () {
    document.getElementById('modal-confirm').classList.add('hidden');
    pendingAction = null;
};

window.resetApp = function () {
    if (items.length && !confirm("Limpar tudo?")) return;
    items = [];
    currentReportId = null;
    clearFormState(false);
    renderList();
    window.showToast("Novo relatório iniciado");
    window.toggleMenu();
};

window.toggleAcionadorFields = function () {
    toggleFieldGroup('h-tem-acionador', 'h-acionador-container');
};

/* ==========================================================================
   11. PWA INSTALL
   ========================================================================== */
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = document.getElementById('btn-install-app');
    if (btn) btn.classList.remove('hidden');
});

window.installPWA = async function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') deferredPrompt = null;
    document.getElementById('btn-install-app').classList.add('hidden');
};

/* ==========================================================================
   12. EXCEL IMPORT / EXPORT (NOVO)
   ========================================================================== */

// Função auxiliar para converter Booleano em "Sim/Não"
const boolToText = (val) => val === true ? "Sim" : (val === false ? "Não" : val);
// Função auxiliar para converter "Sim/Não" em Booleano
const textToBool = (val) => String(val).trim().toLowerCase() === "sim";

window.exportToExcel = function () {
    if (!items.length) return alert("A lista está vazia.");

    // 1. Preparar Dados do Cabeçalho (Sheet 1)
    const headerData = [
        ["Campo", "Valor"],
        ["Cliente", document.getElementById('cliente').value],
        ["Local", document.getElementById('local').value],
        ["Técnico", document.getElementById('resp-tecnico').value],
        ["Classificação", document.getElementById('classificacao').value],
        ["Data", document.getElementById('data-relatorio').value],
        ["Parecer", document.getElementById('sum-parecer').value],
        ["Resumo", document.getElementById('sum-resumo').value],
        ["Riscos", document.getElementById('sum-riscos').value],
        ["Conclusão", document.getElementById('sum-conclusao').value]
    ];

    // 2. Preparar Lista de Itens (Sheet 2)
    // Achatamos os dados para caberem em colunas
    const itemsData = items.map(item => {
        return {
            "Tipo": item.type,
            "Local/Andar": item.andar,
            "ID": item.id,
            "Observações": item.obs || "",

            // Hidrantes
            "H-Mangueira?": boolToText(item.tem_mangueira),
            "H-Validade": item.validade || "",
            "H-Lances": item.lances || "",
            "H-Metragem": item.metragem || "",
            "H-Registro OK": boolToText(item.check_registro),
            "H-Adaptador OK": boolToText(item.check_adaptador),
            "H-Chave OK": boolToText(item.check_chave),
            "H-Esguicho OK": boolToText(item.check_esguicho),
            // Novos campos da Bomba
            "H-Tem Acionador?": boolToText(item.tem_acionador),
            "H-Acionador Funcional": boolToText(item.acionador_funcional),
            "H-Acionador Quebrado": boolToText(item.acionador_quebrado),

            // Extintores
            "E-Tipo": item.tipo || "",
            "E-Peso": item.peso || "",
            "E-Recarga": item.recarga || "",
            "E-Teste Hidro": item.teste_hidro || "",
            "E-Lacre OK": boolToText(item.check_lacre),
            "E-Manometro OK": boolToText(item.check_manometro),
            "E-Sinalizacao OK": boolToText(item.check_sinalizacao),

            // Luz
            "L-Estado": item.estado || "",
            "L-Autonomia": item.autonomia || "",

            // Identificador Único (Não edite isso na planilha)
            "_UID": item.uid
        };
    });

    // 3. Criar Workbook e Sheets
    const wb = XLSX.utils.book_new();

    // Sheet 1: Cabeçalho
    const wsHeader = XLSX.utils.aoa_to_sheet(headerData);
    XLSX.utils.book_append_sheet(wb, wsHeader, "Dados Cliente");

    // Sheet 2: Itens
    const wsItems = XLSX.utils.json_to_sheet(itemsData);
    XLSX.utils.book_append_sheet(wb, wsItems, "Itens Vistoriados");

    // 4. Download
    XLSX.writeFile(wb, `Planilha_FireCheck_${Date.now()}.xlsx`);
};

window.importFromExcel = function (event) {
    const file = event.target.files[0];
    if (!file) return;

    if (items.length > 0 && !confirm("Isso substituirá a lista atual. Deseja continuar?")) {
        event.target.value = "";
        return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, { type: 'array' });

            // 1. Ler Cabeçalho (Sheet 1)
            const wsHeader = wb.Sheets["Dados Cliente"];
            if (wsHeader) {
                const headerArr = XLSX.utils.sheet_to_json(wsHeader, { header: 1 });
                // Transforma array de arrays em objeto chave-valor
                const headerMap = {};
                headerArr.forEach(row => { if (row[0]) headerMap[row[0]] = row[1]; });

                document.getElementById('cliente').value = headerMap["Cliente"] || "";
                document.getElementById('local').value = headerMap["Local"] || "";
                document.getElementById('resp-tecnico').value = headerMap["Técnico"] || "";
                document.getElementById('classificacao').value = headerMap["Classificação"] || "";
                document.getElementById('data-relatorio').value = headerMap["Data"] || "";
                document.getElementById('sum-parecer').value = headerMap["Parecer"] || "Aprovado";
                document.getElementById('sum-resumo').value = headerMap["Resumo"] || "";
                document.getElementById('sum-riscos').value = headerMap["Riscos"] || "";
                document.getElementById('sum-conclusao').value = headerMap["Conclusão"] || "";

                window.toggleHeader();
            }

            // 2. Ler Itens (Sheet 2)
            const wsItems = wb.Sheets["Itens Vistoriados"];
            if (wsItems) {
                const rows = XLSX.utils.sheet_to_json(wsItems);

                items = rows.map(row => {
                    // Reconstrói o objeto item
                    const type = row["Tipo"] || "geral";

                    return {
                        uid: row["_UID"] || Date.now() + Math.random(), // Mantém UID ou cria novo
                        type: type,
                        id: row["ID"] || "",
                        andar: row["Local/Andar"] || "",
                        obs: row["Observações"] || "",
                        imageFiles: [], // Planilha não importa imagens

                        // Hidrante Mappers
                        tem_mangueira: textToBool(row["H-Mangueira?"]),
                        validade: row["H-Validade"] || "-",
                        lances: row["H-Lances"] || "1",
                        metragem: row["H-Metragem"] || "15m",
                        check_registro: textToBool(row["H-Registro OK"]),
                        check_adaptador: textToBool(row["H-Adaptador OK"]),
                        check_chave: textToBool(row["H-Chave OK"]),
                        check_esguicho: textToBool(row["H-Esguicho OK"]),
                        // Mappers da Bomba
                        tem_acionador: textToBool(row["H-Tem Acionador?"]),
                        acionador_funcional: textToBool(row["H-Acionador Funcional"]),
                        acionador_quebrado: textToBool(row["H-Acionador Quebrado"]),

                        // Extintor Mappers
                        tipo: row["E-Tipo"] || "",
                        peso: row["E-Peso"] || "",
                        recarga: row["E-Recarga"] || "-",
                        teste_hidro: row["E-Teste Hidro"] || "-",
                        check_lacre: textToBool(row["E-Lacre OK"]),
                        check_manometro: textToBool(row["E-Manometro OK"]),
                        check_sinalizacao: textToBool(row["E-Sinalizacao OK"]),

                        // Luz Mappers
                        estado: row["L-Estado"] || "OK",
                        autonomia: row["L-Autonomia"] || "Nao Testado"
                    };
                });

                renderList();
                window.showToast("Importado do Excel com sucesso!");
            }

        } catch (err) {
            console.error(err);
            alert("Erro ao ler planilha: " + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = "";
};

/* ==========================================================================
    13. FILTRO DE ORDEM
    ========================================================================== */

window.handleSort = function (order) {
    currentSortOrder = order;
    renderList(); // Apenas renderiza novamente com a nova ordem
};