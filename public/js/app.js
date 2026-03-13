import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, collection, addDoc, setDoc, doc, query, where, getDocs, getDoc, orderBy, limit, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { PhraseManager } from "./phrases.js";
import { generatePDF } from "./pdf-generator.js";
import { compressImage } from "./image-compressor.js";
import { SignaturePad } from "./signature-pad.js";
import { uploadToCloudinary } from "./cloudinary-manager.js";

/* ==========================================================================
   1. CONFIGURAÇÃO E ESTADO GLOBAL
   ========================================================================== */
const TABS = ['sumario', 'hidrante', 'extintor', 'luz', 'bomba', 'alarme', 'sinalizacao', 'eletro', 'geral', 'assinatura'];

// Estado Global
let db, storage, auth, user = null;
let sigTecnico = null;
let sigCliente = null;
let items = [];
let currentType = 'hidrante';
let currentFiles = [];
let viewingImageIndex = null;
let backupItem = null; // Para edição
let pendingAction = null; // Para modal de confirmação
let currentReportId = null;
let deferredPrompt; // PWA
let currentSortOrder = 'newest';
let reportNumber = localStorage.getItem('reportNumber');
let lastSavedReportNumber = null;

if (!reportNumber) {
    reportNumber = generateUniqueId();
    localStorage.setItem('reportNumber', reportNumber);
}

function generateUniqueId() {
    return Date.now().toString(36).toUpperCase();
}

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
            if (user) {
                loadHistory();
                checkUrlForReport();
                loadUserSettings();
            }
        });
        console.log("🔥 Firebase Inicializado");
    }
} catch (error) {
    console.error("Erro crítico no Firebase:", error);
}

async function loadUserSettings() {
    if (!user) return;
    try {
        const userRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(userRef);

        if (docSnap.exists() && docSnap.data().empresa) {
            const empresa = docSnap.data().empresa;
            // Atualiza o armazenamento local com os dados salvos na nuvem
            localStorage.setItem('empresa_nome', empresa.nome || '');
            localStorage.setItem('empresa_endereco', empresa.endereco || '');
            localStorage.setItem('empresa_cidade', empresa.cidade || '');
            localStorage.setItem('empresa_cep', empresa.cep || '');
            localStorage.setItem('empresa_telefone', empresa.telefone || '');

            // Carrega a logo da nuvem (se existir)
            if (empresa.logo) {
                localStorage.setItem('empresa_logo', empresa.logo);
            } else {
                localStorage.removeItem('empresa_logo');
            }
        }
    } catch (e) {
        console.error("Erro ao buscar configurações da empresa:", e);
    }
}

/* ==========================================================================
   3. LISTENERS E DOM READY
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    refreshIcons();
    restoreFormState();
    initializeDateInput();
    // Sincronizar nomes das assinaturas com os dados do cabeçalho
    const syncInputs = (id1, id2, storageKey) => {
        const el1 = document.getElementById(id1);
        const el2 = document.getElementById(id2);
        if (!el1 || !el2) return;

        // Quando digita no cabeçalho, atualiza a assinatura
        el1.addEventListener('input', (e) => el2.value = e.target.value);

        // Quando digita na assinatura, atualiza o cabeçalho e salva
        el2.addEventListener('input', (e) => {
            el1.value = e.target.value;
            localStorage.setItem(storageKey, e.target.value);
            // Se for o cliente, atualiza também a barra azul do topo
            if (id1 === 'cliente') {
                document.getElementById('header-summary').innerText = e.target.value || "Clique para expandir";
            }
        });
    };

    syncInputs('resp-tecnico', 'sig-nome-tecnico', 'resp-tecnico');
    syncInputs('cliente', 'sig-nome-cliente', 'cliente');

    const searchInput = document.getElementById('search-filter');
    const filterProblem = document.getElementById('filter-problems');

    if (searchInput) {
        searchInput.addEventListener('input', () => renderList());
    }
    if (filterProblem) {
        filterProblem.addEventListener('change', () => renderList());
    }

    // Inicialização de Componentes
    const phrasesManager = new PhraseManager();
    window.phrases = phrasesManager;
    const chkFuncional = document.getElementById('h-acionador-funcional');
    const chkQuebrado = document.getElementById('h-acionador-quebrado');

    const btnModalLogin = document.getElementById('btn-modal-login-action');
    if (btnModalLogin) {
        btnModalLogin.addEventListener('click', () => {
            document.getElementById('modal-login-warning').classList.add('hidden');
        });
    }

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
    if (type === 'assinatura') {
        document.getElementById('sig-nome-tecnico').value = document.getElementById('resp-tecnico').value;
        document.getElementById('sig-nome-cliente').value = document.getElementById('cliente').value;
    }

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
// Toast Notification - AGORA NO TOPO E CENTRALIZADO
window.showToast = function (message, type = 'success') {
    let container = document.getElementById('toast-container');

    // Se o container não existir no HTML, cria um dinamicamente
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    // Força a posição do container para o TOPO e CENTRALIZADO usando Tailwind
    // O z-[9999] garante que fique por cima de qualquer menu ou modal
    container.className = "fixed top-5 left-1/2 transform -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none w-[90%] max-w-sm items-center";

    const toast = document.createElement('div');
    const bgColor = type === 'error' ? 'bg-red-500' : (type === 'info' ? 'bg-blue-500' : 'bg-emerald-600');

    // Deixa o visual mais chamativo (arredondado como uma pílula e com sombra mais forte)
    toast.className = `${bgColor} text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 animate-fade-in transition-all transform translate-y-0 pointer-events-auto border border-white/20`;

    // Adiciona um ícone dependendo do tipo de aviso
    let icon = type === 'success' ? 'check-circle' : (type === 'error' ? 'alert-circle' : 'info');
    toast.innerHTML = `<i data-lucide="${icon}" class="w-5 h-5 shrink-0"></i> <span class="font-bold text-sm tracking-wide text-center">${message}</span>`;

    container.appendChild(toast);

    // Renderiza o ícone do Lucide que acabamos de adicionar
    if (window.lucide) window.lucide.createIcons();

    // Faz o Toast sumir depois de 3 segundos
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)'; // Sobe de forma suave ao sumir
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
        case 'alarme':
            specifics = {
                tipo_eq: document.getElementById('a-tipo').value,
                status: document.getElementById('a-status').value, // Novo campo
                obs: document.getElementById('a-obs').value
            };
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
    const rawIdInput = document.getElementById('item-id').value; // Pega o valor bruto
    const idInput = rawIdInput.trim().toUpperCase(); // Limpa espaços e põe em maiúsculo

    // 1. Validação de Campos Vazios
    if (currentType !== 'geral' && (!andarInput || !idInput)) {
        window.showToast("Preencha o Local e a Identificação", "error");
        return;
    }

    // 2. NOVA LOGICA: BLOQUEIO DE ID DUPLICADO
    if (currentType !== 'geral') {
        const duplicado = items.some(item =>
            item.id && item.id.toUpperCase() === idInput
        );

        if (duplicado) {
            // Toca um efeito visual no campo para alertar
            const inputEl = document.getElementById('item-id');
            inputEl.classList.add('border-red-500', 'ring-2', 'ring-red-200');
            setTimeout(() => inputEl.classList.remove('border-red-500', 'ring-2', 'ring-red-200'), 2000);

            // Mostra aviso e para a função
            window.showToast(`O ID "${idInput}" já existe na lista!`, "error");
            return;
        }
    }

    // 3. Validação Específica de Bomba
    if (currentType === 'bomba' && document.getElementById('b-manutencao').checked && !document.getElementById('b-obs').value.trim()) {
        alert("Descreva o problema da bomba na observação.");
        return;
    }

    const specificData = captureFormData(currentType);

    const newItem = {
        uid: Date.now(),
        type: currentType,
        andar: currentType === 'geral' ? '-' : andarInput,
        id: currentType === 'geral' ? 'Geral' : rawIdInput,
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

    // Mostra o toast de sucesso do item na tela
    window.showToast("Item processado na lista!", "success");

    // ==========================================
    // DISPARA O SALVAMENTO AUTOMÁTICO NA NUVEM
    // ==========================================
    saveToFirebase();
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
        } else if (item.type === 'alarme') {
            document.getElementById('a-tipo').value = item.tipo_eq;
            document.getElementById('a-status').value = item.status || 'Operante';
            document.getElementById('a-obs').value = item.obs || '';
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

    // 1. CAPTURA OS FILTROS
    const searchText = document.getElementById('search-filter')?.value.toLowerCase() || "";
    const showProblemsOnly = document.getElementById('filter-problems')?.checked || false;

    // 2. FILTRAGEM INTELIGENTE
    let displayItems = items.filter(item => {
        // A. Filtro de Texto (ID ou Andar)
        const matchText = (item.id || "").toLowerCase().includes(searchText) ||
            (item.andar || "").toLowerCase().includes(searchText);

        // B. Filtro de Problemas (Analisa o resumo em busca de palavras-chave de erro)
        let matchProblem = true;
        if (showProblemsOnly) {
            const summary = generateItemSummary(item).toUpperCase();
            // Lista de palavras que indicam problema
            const badWords = ["DEFEITO", "FALHA", "VENCIDO", "INOPERANTE", "ROMPIDO", "OBSTRUÍDO", "SUJO", "SEM PRESSÃO", "QUEIMADA", "FALTA"];

            // Verifica se tem alguma palavra ruim OU se status é "Falha" (para Alarmes)
            const hasBadWord = badWords.some(w => summary.includes(w));
            const isAlarmFail = item.type === 'alarme' && (item.status === 'Falha' || item.status === 'Avaria');

            matchProblem = hasBadWord || isAlarmFail;
        }

        return matchText && matchProblem;
    });

    // 3. ATUALIZA CONTADOR (Mostra quantos itens sobraram no filtro)
    if (countEl) countEl.innerText = `${displayItems.length} / ${items.length}`;

    // 4. MENSAGEM SE NÃO ACHAR NADA
    listEl.innerHTML = "";
    if (displayItems.length === 0) {
        if (items.length === 0) {
            listEl.innerHTML = '<div class="text-center py-10 border-2 border-dashed border-gray-200 rounded-lg text-gray-400 text-sm">Lista vazia. Adicione itens acima.</div>';
        } else {
            listEl.innerHTML = '<div class="text-center py-8 text-gray-400"><i data-lucide="filter-x" class="w-8 h-8 mx-auto mb-2 opacity-50"></i><p>Nenhum item encontrado com este filtro.</p></div>';
            refreshIcons();
        }
        return;
    }

    // 5. ORDENAÇÃO (Mantida a lógica anterior)
    if (currentSortOrder === 'newest') {
        displayItems.sort((a, b) => Number(b.uid) - Number(a.uid));
    } else if (currentSortOrder === 'oldest') {
        displayItems.sort((a, b) => Number(a.uid) - Number(b.uid));
    } else if (currentSortOrder === 'az') {
        displayItems.sort((a, b) => {
            const idA = String(a.id || "").trim();
            const idB = String(b.id || "").trim();
            return idA.localeCompare(idB, undefined, { numeric: true, sensitivity: 'base' });
        });
    }

    // 6. RENDERIZAÇÃO DA TABELA (Mantida a estrutura visual)
    const tableContainer = document.createElement('div');
    tableContainer.className = "overflow-x-auto rounded-lg border border-gray-200 shadow-sm";

    const table = document.createElement('table');
    table.className = "w-full text-sm text-left text-gray-600 bg-white";

    const thead = document.createElement('thead');
    thead.className = "text-xs text-gray-700 uppercase bg-gray-100 border-b border-gray-200";
    thead.innerHTML = `
        <tr>
            <th class="px-4 py-3 w-16 text-center">Tipo</th>
            <th class="px-4 py-3 w-32">Local</th>
            <th class="px-4 py-3 w-24">ID</th>
            <th class="px-4 py-3">Resumo / Detalhes</th>
            <th class="px-4 py-3">Observações</th>
            <th class="px-4 py-3 w-24 text-center">Ações</th>
        </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    tbody.className = "divide-y divide-gray-100";

    displayItems.forEach(item => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-blue-50 transition-colors group";

        let typeLabel = item.type.substring(0, 3).toUpperCase();
        let typeColor = "bg-slate-100 text-slate-600";
        if (item.type === 'hidrante') { typeLabel = "HID"; typeColor = "bg-blue-100 text-blue-700"; }
        if (item.type === 'extintor') { typeLabel = "EXT"; typeColor = "bg-red-100 text-red-700"; }
        if (item.type === 'luz') { typeLabel = "LUZ"; typeColor = "bg-amber-100 text-amber-700"; }
        if (item.type === 'bomba') { typeLabel = "BOM"; typeColor = "bg-purple-100 text-purple-700"; }
        if (item.type === 'alarme') { typeLabel = "ALM"; typeColor = "bg-orange-100 text-orange-700"; }

        let summary = generateItemSummary(item);

        // Badge de Fotos
        const photoBadge = (item.imageFiles?.length)
            ? `<span class="ml-2 inline-flex items-center text-[10px] bg-gray-200 px-1.5 py-0.5 rounded text-gray-600"><i data-lucide="camera" class="w-3 h-3 mr-1"></i> ${item.imageFiles.length}</span>`
            : '';

        tr.innerHTML = `
            <td class="px-4 py-2 text-center">
                <span class="text-[10px] font-bold px-2 py-1 rounded ${typeColor}">${typeLabel}</span>
            </td>
            
            <td class="px-2 py-1">
                <input type="text" 
                    value="${item.andar || ''}" 
                    onblur="updateItemField(${item.uid}, 'andar', this.value)"
                    class="w-full bg-transparent border-transparent focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-200 rounded px-2 py-1 text-gray-800 font-medium transition-all"
                    placeholder="Local...">
            </td>

            <td class="px-2 py-1">
                <input type="text" 
                    value="${item.id || ''}" 
                    onblur="updateItemField(${item.uid}, 'id', this.value)"
                    class="w-full bg-transparent border-transparent focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-200 rounded px-2 py-1 text-gray-900 font-bold transition-all"
                    placeholder="ID...">
            </td>

            <td class="px-4 py-2 text-xs text-gray-500">
                <div class="truncate max-w-[200px]" title="${summary}">${summary}</div>
                ${photoBadge}
            </td>

            <td class="px-2 py-1">
                <input type="text" 
                    value="${item.obs || ''}" 
                    onblur="updateItemField(${item.uid}, 'obs', this.value)"
                    class="w-full bg-transparent border-transparent focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-200 rounded px-2 py-1 text-gray-600 italic transition-all"
                    placeholder="Sem obs...">
            </td>

            <td class="px-4 py-2 text-center">
                <div class="flex items-center justify-center gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    
                    <button class="btn-save-row text-emerald-600 hover:bg-emerald-100 p-1.5 rounded transition-colors" title="Salvar na Nuvem">
                        <i data-lucide="save" class="w-4 h-4"></i>
                    </button>

                    <button class="btn-edit text-blue-500 hover:bg-blue-100 p-1.5 rounded transition-colors" title="Editar Completo">
                        <i data-lucide="pencil" class="w-4 h-4"></i>
                    </button>

                    <button class="btn-del text-red-400 hover:bg-red-100 p-1.5 rounded transition-colors" title="Excluir">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                </div>
            </td>
        `;

        tr.querySelector('.btn-edit').onclick = () => window.editItem(item.uid);
        tr.querySelector('.btn-del').onclick = () => window.removeItem(item.uid);
        tr.querySelector('.btn-save-row').onclick = (e) => saveToFirebase();

        tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    tableContainer.appendChild(table);
    listEl.appendChild(tableContainer);
    refreshIcons();
}

// Helper para gerar o texto da coluna "Detalhes"
function generateItemSummary(item) {
    if (item.type === 'hidrante') {
        const parts = [];
        if (item.tem_mangueira) parts.push(`Mangueira: ${item.lances || 0}x`);
        else parts.push("S/ Mangueira");

        if (item.tem_acionador) {
            parts.push(item.acionador_quebrado ? "Bomba: DEFEITO" : "Bomba: OK");
        }
        return parts.join(' | ');
    }
    if (item.type === 'extintor') {
        return `${item.tipo} ${item.peso}kg | Val: ${item.validade || '-'}`;
    }
    if (item.type === 'luz') {
        return `${item.tipo} | ${item.estado}`;
    }
    if (item.type === 'geral') {
        return "Item Geral";
    }
    if (item.type === 'alarme') {
        return `${item.tipo_eq} | ${item.status || 'Operante'}`;
    }
    return "-";

}

function atualizarBotoesModoEdicao(editando) {
    const btnAdd = document.getElementById('btn-add-item');
    const btnCancel = document.getElementById('btn-cancelar');
    const btnTexto = document.getElementById('btn-add-text');

    if (editando) {
        // Mostra cancelar
        btnCancel.classList.remove('hidden');
        btnCancel.classList.add('flex');

        // Muda botão principal para Azul (Salvar)
        btnAdd.classList.remove('bg-slate-900'); // Remove cor padrão (escura)
        btnAdd.classList.add('bg-blue-600');     // Adiciona cor de edição

        btnTexto.innerText = "Salvar Edição";
    } else {
        // Esconde cancelar
        btnCancel.classList.add('hidden');
        btnCancel.classList.remove('flex');

        // Volta botão principal para Slate (Adicionar)
        btnAdd.classList.add('bg-slate-900');    // Volta cor padrão
        btnAdd.classList.remove('bg-blue-600');

        btnTexto.innerText = "Adicionar Item";
    }
    refreshIcons();
}

// --- FUNÇÃO DE EDIÇÃO RÁPIDA (PLANILHA) ---
window.updateItemField = function (uid, field, value) {
    const itemIndex = items.findIndex(i => i.uid === parseInt(uid));
    if (itemIndex > -1) {
        // Atualiza o valor no array global
        items[itemIndex][field] = value;

        // Se mudou o ID, precisamos reordenar se o filtro estiver em A-Z
        if (field === 'id' && currentSortOrder === 'az') {
            renderList();
        }

        // Feedback visual discreto (console ou borda)
        console.log(`Item ${uid} atualizado: ${field} = ${value}`);

        // Salva no LocalStorage (opcional, se você quiser persistência local imediata)
        // localStorage.setItem('backup_items', JSON.stringify(items)); 
    }
};

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
            container.className = "thumb-container relative w-16 h-16 group cursor-pointer"; // Adicionado cursor-pointer

            const imgUrl = (typeof file === 'string') ? file : URL.createObjectURL(file);

            container.innerHTML = `
                <img src="${imgUrl}" class="w-full h-full object-cover rounded border border-slate-300 hover:border-blue-500 transition-colors" onclick="window.openImageViewer(${index})">
                <button class="btn-remove-thumb absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow-md z-10 hover:scale-110 transition-transform" onclick="event.stopPropagation(); removeImage(${index})">×</button>
            `;

            container.querySelector('button').onclick = (e) => {
                e.stopPropagation(); // Impede que abra o modal ao clicar no X pequeno
                currentFiles.splice(index, 1);
                updateImagePreview();
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
        tipo_relatorio: document.getElementById('tipo-relatorio') ? document.getElementById('tipo-relatorio').value : "Relatório de manutenção",
        cliente: document.getElementById('cliente').value || "Sem Cliente",
        local: document.getElementById('local').value || "Sem Local",
        tipo_sistema: document.getElementById('tipo-sistema') ? document.getElementById('tipo-sistema').value : "", // Campo adicionado aqui
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
   7. CLOUD - VERSÃO DIRETA (SEM STORAGE / SÓ BANCO DE DADOS)
   ========================================================================== */
async function saveToFirebase() {
    if (!auth.currentUser) {
        window.showLoginModal();
        return;
    }

    const btn = document.getElementById('btn-save');
    const oldHtml = btn.innerHTML;

    // Feedback visual
    btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin"></i> Salvando dados e fotos...`;
    btn.disabled = true;
    refreshIcons();

    try {
        currentReportId = `REL_${reportNumber}`;
        lastSavedReportNumber = reportNumber;

        // --- PREPARAÇÃO DOS ITENS E UPLOAD DE FOTOS ---
        const itemsReady = [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const clean = { ...item };

            // Se o item tem fotos, envia pro Cloudinary
            if (clean.imageFiles && clean.imageFiles.length > 0) {
                const urls = await Promise.all(clean.imageFiles.map(async (file) => {
                    // Se já é uma string (URL antiga), ignora. Se é arquivo novo, faz upload.
                    if (file instanceof File || file instanceof Blob) {
                        return await uploadToCloudinary(file);
                    }
                    return file;
                }));

                const linksValidos = urls.filter(url => url !== null);
                clean.imageFiles = linksValidos;
                item.imageFiles = linksValidos; // Atualiza local para não dar re-upload duplo
            } else {
                clean.imageFiles = [];
            }

            delete clean._savedImages;
            itemsReady.push(clean);
        }

        const reportData = {
            id: currentReportId,
            reportNumber: reportNumber,
            version: "3.2-cloudinary",
            timestamp: new Date().toISOString(),
            userId: user.uid,
            header: getHeaderData(),
            items: itemsReady,
            signatures: {
                tecnico: sigTecnico?.getImageData(),
                cliente: sigCliente?.getImageData()
            },
            cliente: document.getElementById('cliente').value || "Sem Cliente",
            local: document.getElementById('local').value || "",
            updatedAt: new Date(),
            itemCount: items.length,
            lastEditorName: user.displayName || "Usuário",
            lastEditorPhoto: user.photoURL || "",
            fileUrl: null
        };

        const docRef = doc(db, "reports", currentReportId);
        await setDoc(docRef, reportData, { merge: true });

        lastSavedReportNumber = reportNumber;
        const newUrl = `${window.location.pathname}?id=${currentReportId}`;
        window.history.pushState({ path: newUrl }, '', newUrl);

        localStorage.setItem('lastEditorName', user.displayName || "Usuário");
        localStorage.setItem('lastEditorPhoto', user.photoURL || "");

        window.showToast("Salvo com sucesso! (#" + reportNumber + ")");

    } catch (e) {
        console.error("ERRO AO SALVAR:", e);
        alert(`Erro ao salvar: ${e.message}`);
    } finally {
        btn.innerHTML = oldHtml;
        btn.disabled = false;
        refreshIcons();
    }
}

window.loadCloudReports = async function () {
    const container = document.getElementById('reports-list-container');

    // Loading
    container.innerHTML = '<div class="flex flex-col items-center justify-center py-10 text-blue-600"><i data-lucide="loader-2" class="animate-spin w-8 h-8"></i><span class="text-xs text-slate-400 mt-2 font-medium">Sincronizando...</span></div>';
    refreshIcons();

    // 1. DADOS LOCAIS
    const currentClient = document.getElementById('cliente').value.trim();
    const hasLocalData = items.length > 0 || currentClient !== "";
    const localReportNum = localStorage.getItem('reportNumber') || 'Novo';

    // 2. DADOS NUVEM
    let cloudDocs = [];
    if (user) {
        try {
            const q = query(collection(db, "reports"), where("userId", "==", user.uid), limit(50));
            const snapshot = await getDocs(q);
            snapshot.forEach(doc => {
                const data = doc.data();
                data.id = data.id || doc.id;
                cloudDocs.push(data);
            });
            cloudDocs.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
        } catch (e) { console.error(e); }
    }

    container.innerHTML = "";

    // === 3. BARRA DE PESQUISA (NOVA) ===
    // Só mostra se tiver algum relatório (local ou nuvem)
    if (hasLocalData || cloudDocs.length > 0) {
        const searchDiv = document.createElement('div');
        searchDiv.className = "sticky top-0 bg-gray-50 pt-2 pb-4 z-10 mb-2"; // Sticky para ficar fixo no topo ao rolar
        searchDiv.innerHTML = `
            <div class="flex items-center border border-slate-300 rounded-lg px-3 py-2 bg-white focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 shadow-sm">
                <i data-lucide="search" class="text-slate-400 w-5 h-5 mr-3 shrink-0"></i>
                <input type="text" 
                    oninput="window.filterReportsList(this.value)"
                    class="w-full text-sm border-none outline-none focus:ring-0 p-0 text-slate-700 placeholder:text-slate-400 h-full bg-transparent"
                    placeholder="Buscar cliente, local ou ID...">
            </div>
            <div id="no-report-result" class="hidden text-center text-slate-400 text-xs mt-4 py-4 border border-dashed rounded bg-slate-100">
                Nenhum relatório encontrado para essa busca.
            </div>
        `;
        container.appendChild(searchDiv);
    }

    // === 4. RENDERIZAR CARTÕES ===

    // LOCAL
    if (hasLocalData) {
        const localDiv = document.createElement('div');
        // Adicionamos a classe 'report-card' aqui
        localDiv.className = "report-card bg-white border-l-4 border-emerald-500 rounded-lg shadow-sm mb-6 p-4 border border-gray-100 relative overflow-hidden group hover:shadow-md transition-all";

        localDiv.innerHTML = `
            <div class="flex justify-between items-start mb-3">
                <div>
                    <div class="flex items-center gap-2 mb-1">
                        <span class="font-mono text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">RASCUNHO ATUAL</span>
                        <span class="font-mono text-xs font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">#${localReportNum}</span>
                    </div>
                    <h3 class="font-bold text-slate-800 text-lg leading-tight truncate pr-4">${currentClient || 'Relatório Sem Nome'}</h3>
                    <div class="text-xs text-slate-500 mt-1 flex items-center gap-2">
                        <i data-lucide="smartphone" class="w-3 h-3"></i> Memória do Dispositivo <span class="text-slate-300">|</span> ${items.length} itens
                    </div>
                </div>
            </div>
            <div class="flex gap-2 mt-2">
                 <button onclick="window.showFormPage()" class="flex-1 bg-white text-blue-600 border border-blue-200 px-3 py-2 rounded-lg text-sm font-bold hover:bg-blue-600 hover:text-white shadow-sm flex items-center justify-center gap-2 transition-all active:scale-95">
                    Continuar <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-lucide="arrow-right" class="lucide lucide-arrow-right w-4 h-4"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>
                </button>
                
                <button onclick="window.useReportAsBase('local')" class="bg-purple-50 text-purple-600 border border-purple-200 px-3 py-2 rounded-lg text-sm font-bold hover:bg-purple-600 hover:text-white shadow-sm flex items-center gap-2 transition-all active:scale-95" title="Criar novo usando este como base (Zera vistorias)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-lucide="copy" class="lucide lucide-copy w-4 h-4"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg> Usar Base
                </button>
            </div>
        `;
        container.appendChild(localDiv);
    }

    // NUVEM
    if (cloudDocs.length === 0 && !hasLocalData) {
        container.innerHTML += `<div class="text-center py-10 px-6 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50"><p class="text-slate-500 text-sm font-medium">Nenhum relatório na nuvem.</p></div>`;
    } else if (cloudDocs.length > 0) {
        const title = document.createElement('div');
        title.className = "flex items-center gap-3 mb-4 mt-8 report-card"; // report-card aqui para sumir se a busca não bater com "Nuvem"
        title.innerHTML = `<h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider">Salvos na Nuvem (${cloudDocs.length})</h4><div class="h-px bg-slate-200 flex-1"></div>`;
        container.appendChild(title);

        cloudDocs.forEach(data => {
            let dateStr = data.updatedAt?.seconds ? new Date(data.updatedAt.seconds * 1000).toLocaleDateString('pt-BR') : '-';
            const reportNum = data.reportNumber || '---';

            const div = document.createElement('div');
            // Adicionamos a classe 'report-card' aqui também
            div.className = "report-card bg-white p-4 rounded-xl border border-slate-200 mb-3 shadow-sm hover:shadow-md hover:border-blue-300 transition-all duration-200 group";

            div.innerHTML = `
                <div class="flex justify-between items-start mb-3">
                    <div class="flex-1 min-w-0 pr-3">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="font-mono text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">#${reportNum}</span>
                            <span class="text-[10px] text-slate-400 font-medium">${dateStr}</span>
                        </div>
                        <div class="font-bold text-slate-700 truncate text-base group-hover:text-blue-600 transition-colors">${data.cliente || 'Sem Cliente'}</div>
                        <div class="flex items-center gap-1 text-xs text-slate-400 mt-1">
                             <i data-lucide="map-pin" class="w-3 h-3"></i> <span class="truncate max-w-[200px]">${data.local || 'Sem local'}</span>
                        </div>
                    </div>
                    <div class="text-center">
                        <span class="text-xs font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded-full border border-slate-200 block">${data.itemCount || 0}</span>
                        <span class="text-[9px] text-slate-400 uppercase mt-1 block">Itens</span>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-3 pt-3 border-t border-slate-50">
                    <button onclick="window.restoreCloudReport(null, '${data.id}')" class="flex items-center justify-center gap-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 py-2 rounded-lg transition-colors active:scale-95 shadow-sm">
                        <i data-lucide="folder-open" class="w-4 h-4"></i> Abrir
                    </button>
                    <button onclick="window.useReportAsBase('cloud', '${data.id}')" class="flex items-center justify-center gap-2 text-sm font-bold text-slate-600 bg-white border border-slate-200 hover:bg-purple-50 hover:text-purple-600 hover:border-purple-200 py-2 rounded-lg transition-colors active:scale-95">
                        <i data-lucide="copy" class="w-4 h-4"></i> Base
                    </button>
                </div>
            `;
            container.appendChild(div);
        });
    }

    refreshIcons();
};

window.loadCloudReports = loadCloudReports;
window.restoreCloudReport = async function (url, reportId) {
    if (items.length > 0 && !confirm("Substituir relatório atual?")) return;

    const loadMsg = document.createElement('div');
    loadMsg.className = "fixed inset-0 bg-black/50 z-50 flex items-center justify-center text-white";
    loadMsg.innerHTML = '<div class="text-center"><i data-lucide="loader-2" class="animate-spin w-8 h-8 mx-auto"></i><br>Carregando...</div>';
    document.body.appendChild(loadMsg);
    if (window.lucide) window.lucide.createIcons();

    try {
        let data = null;

        if (reportId) {
            const docRef = doc(db, "reports", reportId);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) data = docSnap.data();
        }

        if (!data && url) {
            const resp = await fetch(url);
            data = await resp.json();
        }

        if (!data) throw new Error("Relatório não encontrado.");

        currentReportId = data.id || data.reportId || reportId;

        // --- AQUI ESTÁ A CORREÇÃO ---
        reportNumber = data.reportNumber || generateUniqueId();
        localStorage.setItem('reportNumber', reportNumber);
        lastSavedReportNumber = reportNumber; // Sincroniza a proteção
        // -----------------------------

        // Restaura Header
        if (document.getElementById('tipo-relatorio')) document.getElementById('tipo-relatorio').value = data.header.tipo_relatorio || 'Relatório de manutenção';
        if (document.getElementById('tipo-sistema')) document.getElementById('tipo-sistema').value = data.header.tipo_sistema || '';
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

        items = (data.items || []).map(item => ({
            ...item,
            imageFiles: [],
            _savedImages: []
        }));

        if (data.signatures) {
            if (data.signatures.tecnico && sigTecnico) sigTecnico.fromDataURL(data.signatures.tecnico);
            if (data.signatures.cliente && sigCliente) sigCliente.fromDataURL(data.signatures.cliente);
        }

        renderList();
        window.showFormPage();

        const newUrl = `${window.location.pathname}?id=${currentReportId}`;
        window.history.pushState({ path: newUrl }, '', newUrl);

        window.showToast(`Carregado: #${reportNumber}`);

    } catch (e) {
        console.error(e);
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
    btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin"></i> Gerando...`;

    try {
        const itemsFull = await Promise.all(items.map(async (item) => {
            // 1. Processar imagens: Enviar para Cloudinary e guardar os links
            let linksProcessados = [];

            if (item.imageFiles && item.imageFiles.length > 0) {
                linksProcessados = await Promise.all(item.imageFiles.map(async (file) => {
                    // Se já for uma URL (String), mantém
                    if (typeof file === 'string') return file;

                    // Se for um arquivo novo, faz upload para o Cloudinary
                    const urlCloudinary = await uploadToCloudinary(file);

                    // Se o upload falhar (ex: sem internet), usa Base64 como plano B de segurança
                    if (urlCloudinary) {
                        return urlCloudinary;
                    } else {
                        console.warn("Falha no Cloudinary. A usar Base64 como plano B.");
                        return await fileToBase64(file);
                    }
                }));
            }

            // Atualiza a lista de ficheiros do item atual para que não volte a fazer upload
            item.imageFiles = linksProcessados;

            // 2. Retorna a estrutura final para o JSON
            return {
                ...item,
                imageFiles: [], // O sistema antigo pedia este campo vazio
                _savedImages: linksProcessados // Aqui ficam guardados os links gerados!
            };
        }));

        const backupData = {
            version: "2.2-cloudinary", // Versão atualizada
            reportNumber: reportNumber,
            timestamp: new Date().toISOString(),
            header: getHeaderData(),
            items: itemsFull,
            signatures: {
                tecnico: sigTecnico?.getImageData(),
                cliente: sigCliente?.getImageData()
            }
        };

        const jsonString = JSON.stringify(backupData);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        // --- LÓGICA DO NOME DO ARQUIVO ---
        const clienteRaw = document.getElementById('cliente').value || "Sem_Cliente";
        const clienteSafe = clienteRaw.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_');
        const filename = `Relatorio_${clienteSafe}_${reportNumber}.json`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 100);

        window.showToast("Backup salvo: " + filename);

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

            // Restaura o número e já avisa o sistema que o ID atual é este
            reportNumber = data.reportNumber || generateUniqueId();
            currentReportId = `REL_${reportNumber}`; // Trava o ID para evitar duplicação!
            localStorage.setItem('reportNumber', reportNumber);

            window.toggleHeader();

            // Restaura Itens e Imagens (Suporta Base64 antigo e Links Cloudinary novos)
            items = data.items.map(item => ({
                ...item,
                imageFiles: (item._savedImages || []).map((imgData, i) => {
                    if (typeof imgData === 'string' && imgData.startsWith('http')) {
                        return imgData; // Se for link do Cloudinary, mantém o link
                    }
                    return base64ToFile(imgData, `restored_${i}.jpg`); // Se for Base64 antigo, converte
                }),
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
    if (items.length && !confirm("Limpar tudo e iniciar novo relatório?")) return;

    items = [];
    currentReportId = null;

    window.history.pushState({}, '', window.location.pathname);

    // GERA UM NOVO NÚMERO ÚNICO
    reportNumber = generateUniqueId();
    localStorage.setItem('reportNumber', reportNumber);

    clearFormState(false);
    renderList();
    window.showToast(`Novo relatório iniciado (#${reportNumber})`);
    window.toggleMenu();
};

window.toggleAcionadorFields = function () {
    toggleFieldGroup('h-tem-acionador', 'h-acionador-container');
};

// Função auxiliar para limpar dados e manter apenas a "base" (Local e ID)
function createCleanItemFromBase(oldItem) {
    const base = {
        uid: Date.now() + Math.random(), // Novo UID único
        type: oldItem.type,
        id: oldItem.id,
        andar: oldItem.andar,
        obs: '', // Zera observação
        imageFiles: [] // Zera imagens
    };

    // Define defaults baseados no tipo (estado "zerado")
    switch (oldItem.type) {
        case 'hidrante':
            return {
                ...base,
                check_registro: false,
                check_adaptador: false,
                check_chave: false,
                check_esguicho: false,
                tem_mangueira: true, // Assume true para abrir os campos, mas vazios
                selo: '-',
                validade: '',
                lances: '1',
                metragem: '15m',
                tem_acionador: false,
                acionador_funcional: false,
                acionador_quebrado: false
            };
        case 'extintor':
            return {
                ...base,
                tipo: 'PQS', // Default
                peso: '',
                recarga: '',
                teste_hidro: '',
                check_lacre: false,
                check_manometro: false,
                check_sinalizacao: false,
                check_mangueira: false
            };
        case 'luz':
            return {
                ...base,
                tipo: 'Aclaramento',
                estado: 'OK',
                autonomia: 'Nao Testado',
                check_acendimento: false,
                check_led: false,
                check_fixacao: false,
                check_lux: false
            };
        case 'bomba':
            return {
                ...base,
                operacao: false,
                teste_pressao: false,
                necessita_manutencao: false
            };
        case 'alarme':
            return {
                ...base,
                tipo_eq: 'Detector de Fumaça',
                status: 'Operante'
            };
        case 'sinalizacao':
            return {
                ...base,
                existente: 'Sim',
                tipo: 'Saida',
                check_foto: false,
                check_fixacao: false,
                check_visivel: false,
                check_legivel: false
            };
        case 'eletro':
            return {
                ...base,
                tipo_sistema: 'Pressurizacao',
                botoeiras: 'Nao',
                precisa_manutencao: 'Nao',
                check_painel: false,
                check_piloto: false,
                check_ruido: false,
                check_fixacao: false
            };
        case 'geral':
            return base;
        default:
            return base;
    }
}

window.useReportAsBase = async function (sourceType, reportId = null) {
    if (items.length > 0 && !confirm("Iniciar novo relatório com esta base? (Os dados atuais não salvos serão perdidos)")) {
        return;
    }

    // Modal de Loading
    const btnMsg = document.createElement('div');
    btnMsg.className = "fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[200] flex items-center justify-center text-white font-bold animate-fade-in";
    btnMsg.innerHTML = '<div class="text-center"><i data-lucide="loader-2" class="animate-spin w-10 h-10 mx-auto mb-3 text-purple-400"></i><p>Clonando estrutura...</p></div>';
    document.body.appendChild(btnMsg);
    refreshIcons();

    try {
        let sourceItems = [];
        let sourceHeader = {};

        // 1. FONTE LOCAL
        if (sourceType === 'local') {
            sourceItems = [...items];
            sourceHeader = {
                tipo_relatorio: document.getElementById('tipo-relatorio').value,
                cliente: document.getElementById('cliente').value,
                local: document.getElementById('local').value,
                tipo_sistema: document.getElementById('tipo-sistema').value,
                tecnico: document.getElementById('resp-tecnico').value,
                classificacao: document.getElementById('classificacao').value
            };
        }
        // 2. FONTE NUVEM
        else if (sourceType === 'cloud' && reportId) {
            const docRef = doc(db, "reports", reportId);
            const docSnap = await getDoc(docRef);

            if (!docSnap.exists()) throw new Error("Relatório base não encontrado no banco.");

            const data = docSnap.data();
            sourceItems = data.items || [];
            sourceHeader = {
                tipo_relatorio: data.header?.tipo_relatorio || 'Relatório de manutenção',
                cliente: data.header?.cliente || data.cliente || '',
                local: data.header?.local || data.local || '',
                tipo_sistema: data.header?.tipo_sistema || '',
                tecnico: data.header?.tecnico || '',
                classificacao: data.header?.classificacao || ''
            };
        }

        if (sourceItems.length === 0) throw new Error("O relatório base está vazio.");

        // 3. PROCESSO DE CLONAGEM (Limpa vistorias)
        const newItems = sourceItems.map(item => createCleanItemFromBase(item));

        // 4. RESET GLOBAL
        items = newItems;
        currentReportId = null; // IMPORTANTE: Zera o ID para criar um NOVO na nuvem depois
        currentFiles = [];

        // Novo Número
        reportNumber = generateUniqueId();
        localStorage.setItem('reportNumber', reportNumber);

        // Preenche Cabeçalho
        if (document.getElementById('tipo-relatorio')) document.getElementById('tipo-relatorio').value = sourceHeader.tipo_relatorio;
        if (document.getElementById('tipo-sistema')) document.getElementById('tipo-sistema').value = sourceHeader.tipo_sistema;
        document.getElementById('cliente').value = sourceHeader.cliente;
        document.getElementById('local').value = sourceHeader.local;
        document.getElementById('resp-tecnico').value = sourceHeader.tecnico;
        document.getElementById('classificacao').value = sourceHeader.classificacao;

        // Limpa Variáveis
        initializeDateInput();
        document.getElementById('sum-parecer').value = 'Aprovado';
        document.getElementById('sum-resumo').value = '';
        document.getElementById('sum-riscos').value = '';
        document.getElementById('sum-conclusao').value = '';
        if (sigTecnico) sigTecnico.clear();
        if (sigCliente) sigCliente.clear();

        // Limpa URL
        window.history.pushState({}, '', window.location.pathname);

        // UI
        window.toggleHeader();
        renderList();
        window.showFormPage();
        window.showToast("Base clonada com sucesso!", "success");

    } catch (e) {
        console.error(e);
        alert("Erro ao usar base: " + e.message);
    } finally {
        btnMsg.remove();
    }
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

    // Cria o Workbook
    const wb = XLSX.utils.book_new();

    // =========================================================
    // ABA 1: LISTA GERAL (Padrão do Sistema)
    // =========================================================

    // Preparar Dados do Cabeçalho
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

    // Preparar Itens Gerais
    const itemsData = items.map(item => {
        return {
            "Tipo": item.type,
            "Local/Andar": item.andar,
            "ID": item.id,
            "Observações": item.obs || "",
            // ... Mantenha os outros campos se necessário para backup ...
            "_UID": item.uid
        };
    });

    const wsHeader = XLSX.utils.aoa_to_sheet(headerData);
    XLSX.utils.book_append_sheet(wb, wsHeader, "Dados Cliente");

    const wsItems = XLSX.utils.json_to_sheet(itemsData);
    XLSX.utils.book_append_sheet(wb, wsItems, "Todos os Itens");


    // =========================================================
    // ABA 2: DETECTORES (Igual ao seu Modelo)
    // =========================================================

    // 1. Filtra apenas os alarmes
    const alarmes = items.filter(i => i.type === 'alarme');

    if (alarmes.length > 0) {
        // 2. Mapeia para as colunas exatas que você pediu
        // Ordena por ID numericamente se possível, ou alfabético
        alarmes.sort((a, b) => {
            return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
        });

        const detectoresData = alarmes.map(item => ({
            "END.": item.id || "",
            "STATUS": (item.status || "Operante").toUpperCase(),
            "EQUIPAMENTO": (item.tipo_eq || "").toUpperCase(),
            "ANDAR": (item.andar || "").toUpperCase(),
            "MENSAGEM CENTRAL": (item.obs || "").toUpperCase()
        }));

        // 3. Cria a planilha a partir do JSON
        const wsDetectores = XLSX.utils.json_to_sheet(detectoresData);

        // 4. ESTILO: Define a largura das colunas (em caracteres)
        // Coluna A (0) até E (4)
        wsDetectores['!cols'] = [
            { wch: 10 }, // A: END. (Largura 10)
            { wch: 15 }, // B: STATUS (Largura 15)
            { wch: 30 }, // C: EQUIPAMENTO (Largura 30)
            { wch: 20 }, // D: ANDAR (Largura 20)
            { wch: 60 }  // E: MENSAGEM CENTRAL (Largura 60 - Bem larga)
        ];

        // 5. Adiciona a aba ao arquivo com o nome "Detectores"
        XLSX.utils.book_append_sheet(wb, wsDetectores, "Detectores");
    }

    // =========================================================
    // DOWNLOAD
    // =========================================================
    const clienteNome = document.getElementById('cliente').value || "Cliente";
    XLSX.writeFile(wb, `Relatorio_${clienteNome.replace(/\s+/g, '_')}.xlsx`);
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

            // 1. TENTA LER DADOS DO CLIENTE (Se existir a aba padrão)
            const wsHeader = wb.Sheets["Dados Cliente"];
            if (wsHeader) {
                const headerArr = XLSX.utils.sheet_to_json(wsHeader, { header: 1 });
                const headerMap = {};
                headerArr.forEach(row => { if (row[0]) headerMap[row[0]] = row[1]; });

                if (headerMap["Cliente"]) document.getElementById('cliente').value = headerMap["Cliente"];
                if (headerMap["Local"]) document.getElementById('local').value = headerMap["Local"];
                window.toggleHeader();
            }

            let novosItens = [];

            // 2. TENTA LER A ABA "DETECTORES" (Ou a primeira aba se for um CSV único)
            // Se existir aba "Detectores", usa ela. Senão, pega a primeira aba visível.
            const sheetName = wb.SheetNames.includes("Detectores") ? "Detectores" : wb.SheetNames[0];
            const ws = wb.Sheets[sheetName];

            if (ws) {
                // Converte tudo para uma matriz (linhas x colunas) para acharmos o cabeçalho
                const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

                // Procura em qual linha está o cabeçalho "END." ou "ID"
                let headerRowIndex = -1;
                let colMap = {}; // Mapa para saber qual coluna é qual índice (0, 1, 2...)

                for (let i = 0; i < Math.min(rows.length, 20); i++) { // Procura nas primeiras 20 linhas
                    const row = rows[i].map(c => String(c).trim().toUpperCase()); // Normaliza

                    // Verifica se essa linha parece ser o cabeçalho
                    if (row.includes("END.") || row.includes("ID") || row.includes("EQUIPAMENTO")) {
                        headerRowIndex = i;
                        // Mapeia as colunas
                        row.forEach((colName, idx) => {
                            colMap[colName] = idx;
                        });
                        break;
                    }
                }

                if (headerRowIndex !== -1) {
                    // Começa a ler DADOS a partir da linha seguinte ao cabeçalho
                    for (let i = headerRowIndex + 1; i < rows.length; i++) {
                        const row = rows[i];
                        if (!row || row.length === 0) continue; // Pula linhas vazias

                        // Função auxiliar para pegar valor seguro pelo nome da coluna
                        const getVal = (name) => {
                            const idx = colMap[name];
                            return (idx !== undefined && row[idx] !== undefined) ? String(row[idx]).trim() : "";
                        };

                        // Se não tiver ID/END, provavelmente é linha vazia ou rodapé
                        const idVal = getVal("END.") || getVal("ID");
                        if (!idVal) continue;

                        // Cria o objeto do item
                        const item = {
                            uid: Date.now() + Math.random(),
                            type: 'alarme', // Força como alarme
                            id: idVal,
                            andar: getVal("ANDAR") || getVal("LOCAL/ANDAR") || "-",

                            // Mapeia STATUS -> status
                            status: capitalize(getVal("STATUS") || "Operante"),

                            // Mapeia EQUIPAMENTO -> tipo_eq
                            tipo_eq: capitalize(getVal("EQUIPAMENTO") || "Detector de Fumaça"),

                            // Mapeia MENSAGEM CENTRAL -> obs
                            obs: getVal("MENSAGEM CENTRAL") || getVal("OBSERVAÇÕES") || "",

                            // Define flags padrões baseadas no status
                            check_funcional: true,
                            check_sinalizacao: true,
                            check_fixacao: true,
                            check_placa: true,
                            imageFiles: []
                        };

                        // Lógica extra: Se o status for FALHA ou defeito, desmarca o checkbox
                        if (item.status.toUpperCase().includes("FALHA") || item.status.toUpperCase().includes("DEFEITO")) {
                            item.check_funcional = false;
                        }

                        novosItens.push(item);
                    }
                }
            }

            // 3. SE NÃO ACHOU NADA, TENTA O MODO PADRÃO ANTIGO ("Itens Vistoriados")
            if (novosItens.length === 0 && wb.Sheets["Itens Vistoriados"]) {
                const wsStandard = wb.Sheets["Itens Vistoriados"];
                const standardRows = XLSX.utils.sheet_to_json(wsStandard);
                // ... (lógica antiga de importação padrão) ...
                // Para simplificar, se você usa só o novo formato, o bloco acima já resolve.
                // Se quiser manter compatibilidade total, avise que eu mesclo os códigos.
            }

            if (novosItens.length > 0) {
                items = novosItens;
                renderList();
                window.showToast(`Importados ${items.length} detectores com sucesso!`);
            } else {
                alert("Não foi possível encontrar dados válidos na planilha. Verifique se as colunas 'END.', 'STATUS' e 'EQUIPAMENTO' existem.");
            }

        } catch (err) {
            console.error(err);
            alert("Erro ao ler planilha: " + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = "";
};

// Função auxiliar para deixar Bonito (Ex: "DETECTOR FUMAÇA" -> "Detector Fumaça")
function capitalize(str) {
    if (!str) return "";
    return str.toLowerCase().replace(/(?:^|\s)\S/g, function (a) { return a.toUpperCase(); });
}

/* ==========================================================================
    13. FILTRO DE ORDEM
    ========================================================================== */

window.handleSort = function (order) {
    currentSortOrder = order;
    renderList(); // Apenas renderiza novamente com a nova ordem
};

/* ==========================================================================
   14. VISUALIZADOR DE IMAGENS (NOVO)
   ========================================================================== */

window.openImageViewer = function (index) {
    if (!currentFiles[index]) return;

    viewingImageIndex = index;
    const file = currentFiles[index];
    const imgUrl = (typeof file === 'string') ? file : URL.createObjectURL(file);

    const modal = document.getElementById('image-viewer');
    const imgEl = document.getElementById('viewer-img');

    imgEl.src = imgUrl;
    modal.classList.remove('hidden');

    // Atualiza ícones caso necessário
    if (window.lucide) window.lucide.createIcons();
};

window.closeImageViewer = function () {
    const modal = document.getElementById('image-viewer');
    modal.classList.add('hidden');
    viewingImageIndex = null;

    // Limpa src para liberar memória
    setTimeout(() => { document.getElementById('viewer-img').src = ""; }, 200);
};

window.downloadCurrentImage = function () {
    if (viewingImageIndex === null) return;

    const file = currentFiles[viewingImageIndex];

    // Se for link do Cloudinary, abre em nova aba para o usuário salvar
    if (typeof file === 'string') {
        window.open(file, '_blank');
        return;
    }

    // Se for arquivo local
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FireCheck_Img_${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
};

window.deleteCurrentImage = function () {
    if (viewingImageIndex === null) return;

    window.showConfirmModal(
        "Excluir Imagem",
        "Tem certeza que deseja apagar esta foto permanentemente?",
        () => {
            currentFiles.splice(viewingImageIndex, 1);
            updateImagePreview();
            window.closeImageViewer();
            window.showToast("Imagem removida", "info");
        },
        true
    );
};

window.showLoginModal = function () {
    document.getElementById('modal-login-warning').classList.remove('hidden');
};

window.replaceCurrentImage = async function (event) {
    if (viewingImageIndex === null || !event.target.files.length) return;

    const file = event.target.files[0];
    const btnIcon = document.querySelector('#image-viewer .fa-refresh'); // Se usar font-awesome, ou apenas feedback visual

    try {
        window.showToast("Processando substituição...", "info");

        // Usa a função de compressão existente importada no topo do app.js
        const compressed = await compressImage(file);

        // Substitui no array
        currentFiles[viewingImageIndex] = compressed;

        // Atualiza a visualização no modal IMEDIATAMENTE
        const newUrl = URL.createObjectURL(compressed);
        document.getElementById('viewer-img').src = newUrl;

        // Atualiza a galeria de fundo
        updateImagePreview();

        window.showToast("Imagem substituída com sucesso!");

    } catch (error) {
        console.error(error);
        alert("Erro ao substituir imagem.");
    } finally {
        // Limpa o input para permitir selecionar a mesma foto se quiser
        event.target.value = "";
    }
};
/* ==========================================================================
   FUNÇÃO DE GPS / GEOLOCALIZAÇÃO (CORRIGIDA)
   ========================================================================== */
window.getLocation = function () {
    const btn = document.querySelector('button[onclick="window.getLocation()"]');
    const input = document.getElementById('local');

    const originalContent = btn.innerHTML;

    if (!navigator.geolocation) {
        alert("Seu navegador não suporta geolocalização.");
        return;
    }

    // Muda ícone para loading
    btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin w-5 h-5"></i>`;
    if (window.lucide) window.lucide.createIcons();
    btn.disabled = true;

    navigator.geolocation.getCurrentPosition(async (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;

        try {
            // Usa OpenStreetMap (Nominatim) para converter
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
            const data = await response.json();

            if (data && data.display_name) {
                // Tenta limpar o endereço para ficar mais curto (opcional)
                // Pega logradouro, número, bairro e cidade
                let address = data.display_name;

                // Se quiser tentar pegar partes específicas (melhor UX):
                if (data.address) {
                    const rua = data.address.road || data.address.pedestrian || '';
                    const num = data.address.house_number || '';
                    const bairro = data.address.suburb || data.address.neighbourhood || '';
                    const cidade = data.address.city || data.address.town || data.address.municipality || '';
                    const estado = data.address.state_district || data.address.state || '';

                    if (rua) {
                        address = `${rua}, ${num} - ${bairro}, ${cidade} - ${estado}`;
                    }
                }

                input.value = address;
                input.dispatchEvent(new Event('input'));
                window.showToast("Endereço localizado!", "success");
            } else {
                throw new Error("Endereço não encontrado.");
            }
        } catch (error) {
            console.error(error);
            window.showToast("Erro ao buscar endereço.", "error");
        } finally {
            btn.innerHTML = originalContent;
            btn.disabled = false;
            if (window.lucide) window.lucide.createIcons();
        }

    }, (error) => {
        console.error(error);
        let msg = "Erro ao obter localização.";
        if (error.code === 1) msg = "Permissão negada. Ative o GPS no navegador.";
        if (error.code === 2) msg = "Sinal indisponível.";
        if (error.code === 3) msg = "Tempo esgotado. Tente novamente.";

        alert(msg);

        btn.innerHTML = originalContent;
        btn.disabled = false;
        if (window.lucide) window.lucide.createIcons();
    }, {
        enableHighAccuracy: false, // <--- O SEGREDO: False é mais rápido e funciona indoor
        timeout: 30000,           // <--- Aumentado para 30 segundos
        maximumAge: 0
    });
};

// --- NOVO: BUSCA RELATÓRIO PELA URL AO RECARREGAR ---
async function checkUrlForReport() {
    const urlParams = new URLSearchParams(window.location.search);
    const reportId = urlParams.get('id');

    if (reportId && user) {
        if (currentReportId === reportId && items.length > 0) return;

        console.log("Buscando relatório da URL:", reportId);
        window.showToast("Recarregando relatório...", "info");

        try {
            const docRef = doc(db, "reports", reportId);
            const docSnap = await getDoc(docRef); // Usa getDoc aqui também

            if (docSnap.exists()) {
                const data = docSnap.data();
                await window.restoreCloudReport(null, data.id);
            } else {
                console.warn("Relatório da URL não encontrado.");
                window.history.pushState({}, '', window.location.pathname);
            }
        } catch (error) {
            console.error("Erro ao buscar URL:", error);
        }
    }
}

/* ==========================================================================
   FILTRO DE RELATÓRIOS (NUVEM/LOCAL)
   ========================================================================== */
window.filterReportsList = function (query) {
    const term = query.toLowerCase();
    const cards = document.querySelectorAll('.report-card'); // Pega todos os cartões
    let found = 0;

    cards.forEach(card => {
        // Busca no texto visível do cartão (Cliente, Data, ID, Local)
        const content = card.innerText.toLowerCase();

        if (content.includes(term)) {
            card.classList.remove('hidden');
            found++;
        } else {
            card.classList.add('hidden');
        }
    });

    // Mostra/Esconde msg de "Nenhum resultado"
    const noResultMsg = document.getElementById('no-report-result');
    if (noResultMsg) {
        if (found === 0 && term.length > 0) noResultMsg.classList.remove('hidden');
        else noResultMsg.classList.add('hidden');
    }
};

/* ==========================================================================
   MENU DO USUÁRIO, LOGOUT E CONFIGURAÇÕES DA EMPRESA
   ========================================================================== */

window.toggleUserMenu = function (event) {
    if (event) event.stopPropagation(); // Evita que o clique feche na mesma hora
    const dropdown = document.getElementById('user-dropdown');
    if (dropdown) dropdown.classList.toggle('hidden');
};

// Fechar o menu se clicar em qualquer outro lugar da tela
window.addEventListener('click', function (e) {
    const dropdown = document.getElementById('user-dropdown');
    const userInfo = document.getElementById('user-info');
    if (dropdown && !dropdown.classList.contains('hidden')) {
        if (userInfo && !userInfo.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    }
});

window.fazerLogout = function () {
    if (confirm('Tem certeza que deseja sair da conta?')) {
        signOut(auth).then(() => {
            window.location.reload();
        }).catch((error) => {
            console.error('Erro ao sair:', error);
            alert('Erro ao sair da conta.');
        });
    }
};

window.abrirConfiguracoes = function () {
    document.getElementById('config-empresa').value = localStorage.getItem('empresa_nome') || '';
    document.getElementById('config-endereco').value = localStorage.getItem('empresa_endereco') || '';
    document.getElementById('config-cidade').value = localStorage.getItem('empresa_cidade') || '';
    document.getElementById('config-cep').value = localStorage.getItem('empresa_cep') || '';
    document.getElementById('config-telefone').value = localStorage.getItem('empresa_telefone') || '';

    document.getElementById('config-modal').classList.remove('hidden');
};

window.fecharConfiguracoes = function () {
    document.getElementById('config-modal').classList.add('hidden');
};

window.salvarConfiguracoes = async function () {
    // Coleta os valores digitados
    const empresa_nome = document.getElementById('config-empresa').value;
    const empresa_endereco = document.getElementById('config-endereco').value;
    const empresa_cidade = document.getElementById('config-cidade').value;
    const empresa_cep = document.getElementById('config-cep').value;
    const empresa_telefone = document.getElementById('config-telefone').value;

    // Trata a logo (pega o Base64 gerado pelo Canvas)
    const logoPreview = document.getElementById('config-logo-preview');
    let empresa_logo = null;
    if (logoPreview.src && !logoPreview.classList.contains('hidden')) {
        empresa_logo = logoPreview.src;
        localStorage.setItem('empresa_logo', empresa_logo);
    } else {
        localStorage.removeItem('empresa_logo');
    }

    // 1. Salva no LocalStorage (Memória do Navegador para carregamento rápido)
    localStorage.setItem('empresa_nome', empresa_nome);
    localStorage.setItem('empresa_endereco', empresa_endereco);
    localStorage.setItem('empresa_cidade', empresa_cidade);
    localStorage.setItem('empresa_cep', empresa_cep);
    localStorage.setItem('empresa_telefone', empresa_telefone);

    // 2. Salva na Nuvem (Firestore) vinculado ao usuário
    if (user) { // Verifica se o usuário está logado
        try {
            window.showToast('Salvando na nuvem...', 'info');

            // Cria ou atualiza o documento na coleção "users" usando o UID do usuário
            const userRef = doc(db, "users", user.uid);
            await setDoc(userRef, {
                empresa: {
                    nome: empresa_nome,
                    endereco: empresa_endereco,
                    cidade: empresa_cidade,
                    cep: empresa_cep,
                    telefone: empresa_telefone,
                    logo: empresa_logo // A logo comprimida vai como String Base64
                }
            }, { merge: true }); // O merge true garante que não vai apagar outros dados do usuário

            window.showToast('Configurações salvas na nuvem com sucesso!', 'success');
        } catch (error) {
            console.error("Erro ao salvar configurações na nuvem:", error);
            window.showToast('Salvo localmente, mas houve erro ao enviar para a nuvem.', 'error');
        }
    } else {
        // Se não tiver login, avisa que ficou só no aparelho
        window.showToast('Salvo apenas no dispositivo. Faça login para salvar na nuvem.', 'info');
    }

    // Fecha o modal
    window.fecharConfiguracoes();
};

// ==========================================
// 1. MÁSCARA DO TELEFONE
// ==========================================
document.getElementById('config-telefone').addEventListener('input', function (e) {
    let value = e.target.value;

    // Remove tudo o que não é número
    value = value.replace(/\D/g, "");

    // Formata: (XX) XXXXX-XXXX ou (XX) XXXX-XXXX
    value = value.replace(/^(\d{2})(\d)/g, "($1) $2");
    value = value.replace(/(\d)(\d{4})$/, "$1-$2");

    e.target.value = value;
});

// ==========================================
// 2. MÁSCARA DO CEP E BUSCA DA CIDADE
// ==========================================
document.getElementById('config-cep').addEventListener('input', async function (e) {
    let value = e.target.value;

    // Remove tudo o que não é número
    value = value.replace(/\D/g, "");

    // Formata o CEP: XXXXX-XXX (coloca o traço após o 5º número)
    value = value.replace(/^(\d{5})(\d)/, "$1-$2");

    // Atualiza o valor no input com a máscara
    e.target.value = value;

    // --- Início da busca automática da cidade ---

    // Pega apenas os números do CEP para consultar na API
    let cepLimpo = value.replace(/\D/g, "");

    // Se o CEP tiver exatamente 8 números (tamanho completo)
    if (cepLimpo.length === 8) {
        try {
            // Mostra indicação ao utilizador enquanto procura
            document.getElementById('config-cidade').value = "A procurar...";

            // Faz o pedido à API pública do ViaCEP
            let resposta = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
            let dados = await resposta.json();

            if (dados.erro) {
                // Se o CEP não existir
                document.getElementById('config-cidade').value = "CEP não encontrado";
            } else {
                // Preenche com "Cidade - UF"
                document.getElementById('config-cidade').value = `${dados.localidade} - ${dados.uf}`;
            }
        } catch (erro) {
            document.getElementById('config-cidade').value = "";
            console.error("Erro ao procurar o CEP:", erro);
        }
    }
});

// ATUALIZAR E ADICIONAR NO FINAL DO app.js

window.handleLogoUpload = function (event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
            // Cria um canvas para redimensionar a imagem
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 400; // Largura máxima ideal para logo
            const MAX_HEIGHT = 400; // Altura máxima ideal para logo
            let width = img.width;
            let height = img.height;

            // Calcula a nova proporção mantendo o aspecto da imagem
            if (width > height) {
                if (width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                }
            } else {
                if (height > MAX_HEIGHT) {
                    width *= MAX_HEIGHT / height;
                    height = MAX_HEIGHT;
                }
            }

            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            // Desenha a imagem redimensionada no canvas
            ctx.drawImage(img, 0, 0, width, height);

            // Exporta a imagem muito mais leve (mantendo transparência do PNG)
            const compressedBase64 = canvas.toDataURL('image/png');

            // Atualiza a interface
            const logoPreview = document.getElementById('config-logo-preview');
            const logoIcon = document.getElementById('config-logo-icon');

            logoPreview.src = compressedBase64;
            logoPreview.classList.remove('hidden');
            logoIcon.classList.add('hidden');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

window.removeLogo = function () {
    const logoPreview = document.getElementById('config-logo-preview');
    const logoIcon = document.getElementById('config-logo-icon');
    const logoInput = document.getElementById('config-logo-input');

    logoPreview.src = '';
    logoPreview.classList.add('hidden');
    logoIcon.classList.remove('hidden');
    logoInput.value = '';
};

window.abrirConfiguracoes = function () {
    document.getElementById('config-empresa').value = localStorage.getItem('empresa_nome') || '';
    document.getElementById('config-endereco').value = localStorage.getItem('empresa_endereco') || '';
    document.getElementById('config-cidade').value = localStorage.getItem('empresa_cidade') || '';
    document.getElementById('config-cep').value = localStorage.getItem('empresa_cep') || '';
    document.getElementById('config-telefone').value = localStorage.getItem('empresa_telefone') || '';

    // Carregar a logo salva
    const savedLogo = localStorage.getItem('empresa_logo');
    const logoPreview = document.getElementById('config-logo-preview');
    const logoIcon = document.getElementById('config-logo-icon');

    if (savedLogo) {
        logoPreview.src = savedLogo;
        logoPreview.classList.remove('hidden');
        logoIcon.classList.add('hidden');
    } else {
        window.removeLogo();
    }

    document.getElementById('config-modal').classList.remove('hidden');
};

window.salvarConfiguracoes = function () {
    localStorage.setItem('empresa_nome', document.getElementById('config-empresa').value);
    localStorage.setItem('empresa_endereco', document.getElementById('config-endereco').value);
    localStorage.setItem('empresa_cidade', document.getElementById('config-cidade').value);
    localStorage.setItem('empresa_cep', document.getElementById('config-cep').value);
    localStorage.setItem('empresa_telefone', document.getElementById('config-telefone').value);

    // Salvar a logo
    const logoPreview = document.getElementById('config-logo-preview');
    if (logoPreview.src && !logoPreview.classList.contains('hidden')) {
        localStorage.setItem('empresa_logo', logoPreview.src);
    } else {
        localStorage.removeItem('empresa_logo');
    }

    window.fecharConfiguracoes();
    window.showToast('Configurações salvas com sucesso!', 'success');
};