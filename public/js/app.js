import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, collection, addDoc, query, where, getDocs, orderBy, limit, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { PhraseManager } from "./phrases.js";
import { generatePDF } from "./pdf-generator.js";
import { compressImage } from "./image-compressor.js";
import { SignaturePad } from "./signature-pad.js";

// --- Configuração ---
const TABS = ['sumario', 'hidrante', 'extintor', 'luz', 'bomba', 'sinalizacao', 'eletro', 'geral', 'assinatura'];

// --- Inicialização Firebase ---
let db, storage, auth, user = null;
let sigTecnico = null;
let sigCliente = null;

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
    const savedCliente = localStorage.getItem('cliente');
    if (savedCliente) {
        window.toggleHeader();
    }

    if (document.getElementById('h-tem-mangueira')) window.toggleMangueiraFields();
    if (!document.getElementById('data-relatorio').value) {
        const now = new Date();
        // Formata para YYYY-MM-DDTHH:MM (Padrão do input datetime-local)
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');

        document.getElementById('data-relatorio').value = `${year}-${month}-${day}T${hours}:${minutes}`;
    }
    if (document.getElementById('s-existente')) window.toggleSinalizacaoFields();
    // Listeners
    document.getElementById('btn-login').addEventListener('click', handleLogin);
    document.getElementById('btn-logout-side').addEventListener('click', handleLogout);
    document.getElementById('btn-add-item').addEventListener('click', addItem);
    document.getElementById('btn-save').addEventListener('click', saveToFirebase);
    document.getElementById('camera-input').addEventListener('change', handleFileSelect);
    document.getElementById('upload-input').addEventListener('change', handleFileSelect);
    document.getElementById('btn-pdf').addEventListener('click', () => {
        const currentSignatures = {
            tecnico: sigTecnico ? sigTecnico.getImageData() : null,
            cliente: sigCliente ? sigCliente.getImageData() : null
        };
        generatePDF(items, 'save', currentSignatures);
    });
    document.getElementById('btn-confirm-action').addEventListener('click', () => {
        if (pendingAction) pendingAction();
        window.closeConfirmModal();
    });

    document.querySelectorAll('.save-state').forEach(input => {
        input.addEventListener('input', () => {
            localStorage.setItem(input.id, input.type === 'checkbox' ? input.checked : input.value);
        });
    });
    sigTecnico = new SignaturePad('sig-tecnico', 'btn-clear-tecnico');
    sigCliente = new SignaturePad('sig-cliente', 'btn-clear-cliente');
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

        // --- NOVO: Captura as assinaturas também na prévia ---
        const currentSignatures = {
            tecnico: sigTecnico ? sigTecnico.getImageData() : null,
            cliente: sigCliente ? sigCliente.getImageData() : null
        };
        generatePDF(items, 'preview', currentSignatures);
    }
};

const phrasesManager = new PhraseManager();
window.phrases = phrasesManager;

// --- Lógica de Abas ---
window.switchTab = function (type) {
    currentType = type;

    const inputAndar = document.getElementById('andar');
    const idContainer = inputAndar ? inputAndar.closest('.grid') : null;

    if (idContainer) {
        if (type === 'geral' || type === 'sumario' || type === 'assinatura') { // Adicionei assinatura aqui para esconder ID/Andar
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
                btn.classList.add(activeClass); // Note: Para assinatura, certifique-se que o CSS existe ou use um genérico
            }

            // --- NOVO: Redimensiona o Canvas ao abrir a aba ---
            if (type === 'assinatura') {
                setTimeout(() => {
                    if (sigTecnico) sigTecnico.resizeCanvas();
                    if (sigCliente) sigCliente.resizeCanvas();
                }, 50); // Pequeno delay para garantir que o elemento está visível
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

// --- Lógica do Acordeão (Dados da Edificação) ---
window.toggleHeader = function () {
    const content = document.getElementById('header-content');
    const chevron = document.getElementById('header-chevron');
    const summary = document.getElementById('header-summary');
    const clienteVal = document.getElementById('cliente').value;

    if (content.classList.contains('hidden')) {
        // ABRIR
        content.classList.remove('hidden');
        chevron.classList.add('rotate-180'); // Seta aponta para cima
        summary.classList.add('hidden');
    } else {
        // FECHAR
        content.classList.add('hidden');
        chevron.classList.remove('rotate-180'); // Seta aponta para baixo

        // UX: Mostra o nome do cliente no resumo quando fecha
        if (clienteVal) {
            summary.innerText = clienteVal;
            summary.classList.remove('hidden');
        } else {
            summary.innerText = "Clique para editar dados";
            summary.classList.remove('hidden');
        }
    }
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
async function handleFileSelect(event) {
    const input = event.target;
    if (input.files && input.files.length > 0) {
        const btnText = document.getElementById('btn-add-item');
        const originalText = btnText.innerHTML;

        // Feedback visual simples
        btnText.innerHTML = `<i data-lucide="loader-2" class="animate-spin"></i> Comprimindo fotos...`;
        if (window.lucide) window.lucide.createIcons();

        try {
            // Converte FileList para Array
            const filesArray = Array.from(input.files);

            // Processa todas as imagens em paralelo
            const compressedFiles = await Promise.all(
                filesArray.map(file => compressImage(file))
            );

            // Adiciona ao array global
            currentFiles = [...currentFiles, ...compressedFiles];
            updateImagePreview();

        } catch (error) {
            console.error("Erro ao processar imagens:", error);
            alert("Erro ao processar algumas imagens.");
        } finally {
            // Restaura o botão e limpa o input
            btnText.innerHTML = originalText;
            if (window.lucide) window.lucide.createIcons();
            input.value = "";
        }
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

    // --- Sistema de Notificações (Toast) ---
    window.showToast = function (message, type = 'success') {
        const container = document.getElementById('toast-container');

        // Configuração de cores e ícones baseada no tipo
        const styles = {
            success: { bg: 'bg-emerald-600', icon: 'check-circle-2' },
            error: { bg: 'bg-red-600', icon: 'alert-circle' },
            info: { bg: 'bg-blue-600', icon: 'info' }
        };

        const style = styles[type] || styles.success;

        // Cria o elemento da notificação
        const toast = document.createElement('div');
        toast.className = `${style.bg} text-white px-4 py-3 rounded-lg shadow-xl flex items-center gap-3 transform transition-all duration-300 translate-x-10 opacity-0 min-w-[300px] pointer-events-auto`;

        toast.innerHTML = `
        <i data-lucide="${style.icon}" class="w-6 h-6 flex-shrink-0"></i>
        <span class="font-bold text-sm">${message}</span>
    `;

        // Adiciona ao container
        container.appendChild(toast);

        // Renderiza o ícone
        if (window.lucide) window.lucide.createIcons();

        // Animação de Entrada (pequeno delay para o navegador renderizar)
        requestAnimationFrame(() => {
            toast.classList.remove('translate-x-10', 'opacity-0');
        });

        // Remove automaticamente após 3 segundos
        setTimeout(() => {
            toast.classList.add('opacity-0', 'translate-x-10'); // Animação de saída
            setTimeout(() => toast.remove(), 300); // Remove do DOM após a animação
        }, 3000);
    };

}