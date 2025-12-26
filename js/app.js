import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, collection, addDoc, query, where, getDocs, orderBy, limit } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { PhraseManager } from "./phrases.js";

// --- Configuração ---
const TABS = ['hidrante', 'extintor', 'luz', 'bomba', 'sinalizacao'];

// --- Inicialização Firebase ---
let db, storage, auth, user = null;

try {
    if (firebaseConfig.apiKey) {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
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

    if (document.getElementById('h-tem-mangueira')) {
        window.toggleMangueiraFields();
    }

    if (!document.getElementById('data-relatorio').value) {
        document.getElementById('data-relatorio').valueAsDate = new Date();
    }

    if (document.getElementById('s-existente')) {
        window.toggleSinalizacaoFields();
    }

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

    // Auto-Save
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
    TABS.forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        const form = document.getElementById(`form-${t}`);
        const activeClass = `tab-active-${t}`;

        if (t === type) {
            form.classList.remove('hidden');
            btn.classList.remove('tab-inactive');
            btn.classList.add(activeClass);
        } else {
            form.classList.add('hidden');
            btn.classList.remove(activeClass);
            btn.classList.add('tab-inactive');
        }
    });
};

// --- Modal ---
window.showConfirmModal = function (title, msg, actionCallback, isDestructive = false) {
    const modal = document.getElementById('modal-confirm');
    const titleEl = document.getElementById('modal-confirm-title');
    const msgEl = document.getElementById('modal-confirm-msg');
    const btn = document.getElementById('btn-confirm-action');

    titleEl.innerText = title;
    msgEl.innerText = msg;
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

// --- Mangueira ---
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

// --- Sinalização Toggle ---
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

// --- Persistência ---
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
        's-obs', 's-tipo'
    ];

    idsToClear.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.value = "";
            localStorage.removeItem(id);
        }
    });

    // Reset dos Checkboxes
    document.querySelectorAll('input[type="checkbox"]').forEach(el => {
        // Checkboxes de Sinalização: Padrão é TRUE (Marcado = OK)
        if (['s-foto', 's-fixacao', 's-visivel', 's-legivel'].includes(el.id)) {
            el.checked = true;
        }
        // Checkbox Mangueira: Padrão é TRUE (Tem mangueira)
        else if (el.id === 'h-tem-mangueira') {
            el.checked = true;
        }
        // Outros checkboxes (anomalias): Padrão é FALSE (Desmarcado)
        else {
            el.checked = false;
        }
        localStorage.removeItem(el.id);
    });

    // Reset dos Selects (volta para a primeira opção)
    document.querySelectorAll('select.save-state').forEach(el => {
        el.selectedIndex = 0;
        localStorage.removeItem(el.id);
    });

    // Atualiza a interface visual (bloqueios)
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
    const andar = document.getElementById('andar').value;
    const id = document.getElementById('item-id').value;
    if (!andar || !id) { alert("Preencha o Local e a Identificação do item."); return; }

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
    }

    // Salva o item na lista global
    items.push({ ...baseItem, ...specifics });
    renderList();
    clearFormState();
    clearFiles();
    document.getElementById('item-id').focus();
}

window.editItem = function (uid) {
    const index = items.findIndex(i => i.uid === uid);
    if (index === -1) return;
    const item = items[index];

    window.showConfirmModal("Editar Item", `Deseja trazer o item "${item.id}" de volta para o formulário de edição?`, () => {
        window.switchTab(item.type);
        document.getElementById('andar').value = item.andar;
        document.getElementById('item-id').value = item.id;

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
                    (item.type === 'bomba' ? 'activity' : 'signpost')));

        let color = item.type === 'hidrante' ? 'blue' :
            (item.type === 'extintor' ? 'red' :
                (item.type === 'luz' ? 'amber' :
                    (item.type === 'bomba' ? 'purple' : 'teal')));

        const div = document.createElement('div');
        div.className = `bg-white p-3 rounded shadow-sm border-l-4 border-${color}-500 flex justify-between items-center animate-fade-in`;

        div.innerHTML = `
            <div class="flex items-center gap-3 overflow-hidden">
                <div class="p-2 bg-gray-50 rounded-full text-gray-600 flex-shrink-0">
                    <i data-lucide="${icon}" class="w-5 h-5"></i>
                </div>
                <div class="min-w-0">
                    <div class="font-bold text-gray-800 text-sm truncate" id="item-title-${item.uid}"></div>
                    <div class="text-xs text-gray-500 truncate">
                        ${item.type.toUpperCase()} 
                        ${(item.imageFiles && item.imageFiles.length > 0) ? `<span class="text-xs bg-blue-100 text-blue-700 px-1 rounded ml-1">📷 ${item.imageFiles.length}</span>` : ''}
                    </div>
                </div>
            </div>
            <div class="flex items-center gap-2">
                <button class="btn-edit text-blue-400 hover:text-blue-600 p-2"><i data-lucide="pencil" class="w-4 h-4"></i></button>
                <button class="btn-del text-red-300 hover:text-red-600 p-2"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
            </div>
        `;

        div.querySelector(`#item-title-${item.uid}`).textContent = `${item.id} | ${item.andar}`;
        div.querySelector('.btn-edit').onclick = () => window.editItem(item.uid);
        div.querySelector('.btn-del').onclick = () => window.removeItem(item.uid);

        fragment.appendChild(div);
    });

    listEl.appendChild(fragment);
    lucide.createIcons();
}

const readFileAsDataURL = (file) => { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = (e) => resolve(e.target.result); reader.onerror = reject; reader.readAsDataURL(file); }); };

async function generatePDF(mode = 'save') {
    if (items.length === 0 && mode === 'save') return alert("Lista vazia!");

    // Configuração de feedback visual
    const btn = document.getElementById('btn-pdf');
    let oldText = "";
    if (mode === 'save') {
        oldText = btn.innerHTML;
        btn.innerHTML = "Gerando...";
        btn.disabled = true;
    }

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Captura dos dados novos
        const cliente = document.getElementById('cliente').value || "Não Informado";
        const local = document.getElementById('local').value || "Não Informado";
        const tecnico = document.getElementById('resp-tecnico').value || "Não Informado";
        const classificacao = document.getElementById('classificacao').value || "-";

        // Formatação das datas
        const dataRaw = document.getElementById('data-relatorio').value;
        const dataRelatorio = dataRaw ? dataRaw.split('-').reverse().join('/') : new Date().toLocaleDateString();

        const avcbRaw = document.getElementById('validade-avcb').value;
        const dataAvcb = avcbRaw ? avcbRaw.split('-').reverse().join('/') : "Não Informado";

        // --- DESIGN DO CABEÇALHO (Atualizado) ---
        // Fundo Azul Escuro
        doc.setFillColor(30, 41, 59);
        doc.rect(0, 0, 210, 40, 'F');

        // Título Principal
        doc.setTextColor(255);
        doc.setFontSize(18);
        doc.setFont(undefined, 'bold');
        doc.text("RELATÓRIO TÉCNICO DE VISTORIA", 105, 15, { align: 'center' });

        // Subtítulo / Norma
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(200, 200, 200);
        doc.text("Projeto Planejamento e Implatação de Sistemas LTDA", 105, 22, { align: 'center' });

        // Dados do Cabeçalho (Desenhados em caixas brancas virtuais para organização)
        doc.setFontSize(9);
        doc.setTextColor(255);

        // Coluna Esquerda
        doc.text(`Cliente: ${cliente}`, 10, 32);
        doc.text(`Local: ${local}`, 10, 37);

        // Coluna Direita (Alinhada)
        doc.text(`Resp. Técnico: ${tecnico}`, 110, 32, { align: 'center' });
        doc.text(`Classificação: ${classificacao}`, 110, 37, { align: 'center' });

        // Datas (Canto Direito Superior ou na linha)
        doc.setFontSize(8);
        doc.setTextColor(150, 200, 250); // Azul claro
        doc.text(`Data Vistoria: ${dataRelatorio}`, 200, 32, { align: 'right' });
        doc.text(`Valid. AVCB: ${dataAvcb}`, 200, 37, { align: 'right' });

        let yPos = 50;

        // --- HIDRANTES ---
        const hid = items.filter(i => i.type === 'hidrante');
        if (hid.length > 0) {
            doc.setFontSize(12); doc.setTextColor(37, 99, 235); // Blue
            doc.text("Hidrantes", 14, yPos); yPos += 2;
            doc.autoTable({
                startY: yPos,
                head: [['Local', 'ID', 'Mangueira', 'Vencimento', 'Selo', 'Comp. Faltantes', 'Observações']],
                body: hid.map(i => {
                    let faltantes = [];
                    if (!i.check_registro) faltantes.push('Reg');
                    if (!i.check_adaptador) faltantes.push('Adap');
                    if (!i.check_chave) faltantes.push('Chv');
                    if (!i.check_esguicho) faltantes.push('Esg');
                    const statusComp = faltantes.length === 0 ? 'OK' : faltantes.join(', ');
                    const mangueiraInfo = i.tem_mangueira ? `${i.lances}x ${i.metragem}` : 'AUSENTE';
                    return [i.andar, i.id, mangueiraInfo, i.tem_mangueira ? i.validade : '-', i.tem_mangueira ? i.selo : '-', statusComp, i.obs || '-'];
                }),
                theme: 'grid', headStyles: { fillColor: [37, 99, 235] }
            }); yPos = doc.lastAutoTable.finalY + 10;
        }

        // --- EXTINTORES ---
        const ext = items.filter(i => i.type === 'extintor');
        if (ext.length > 0) {
            doc.setFontSize(12); doc.setTextColor(220, 38, 38); // Red
            doc.text("Extintores", 14, yPos); yPos += 2;
            doc.autoTable({
                startY: yPos,
                head: [['Local', 'ID', 'Tipo', 'Peso', 'Recarga', 'Lacre/Manom', 'Obs']],
                body: ext.map(i => [i.andar, i.id, i.tipo, i.peso, i.recarga, (i.check_lacre && i.check_manometro) ? 'OK' : 'Verificar', i.obs || '-']),
                theme: 'grid', headStyles: { fillColor: [220, 38, 38] }
            }); yPos = doc.lastAutoTable.finalY + 10;
        }

        // --- ILUMINAÇÃO ---
        const luzes = items.filter(i => i.type === 'luz');
        if (luzes.length > 0) {
            doc.setFontSize(12); doc.setTextColor(217, 119, 6); // Amber
            doc.text("Iluminação de Emergência", 14, yPos); yPos += 2;
            doc.autoTable({
                startY: yPos,
                head: [['Local', 'ID', 'Tipo', 'Estado', 'Autonomia', 'Obs']],
                body: luzes.map(i => [i.andar, i.id, i.tipo, i.estado, i.autonomia, i.obs || '-']),
                theme: 'grid', headStyles: { fillColor: [217, 119, 6] }
            }); yPos = doc.lastAutoTable.finalY + 10;
        }

        // --- BOMBAS ---
        const bombas = items.filter(i => i.type === 'bomba');
        if (bombas.length > 0) {
            doc.setFontSize(12); doc.setTextColor(124, 58, 237); // Purple
            doc.text("Sistema de Pressurização (Bombas)", 14, yPos); yPos += 2;
            doc.autoTable({
                startY: yPos, head: [['Local', 'ID', 'Operação', 'Teste Pressão', 'Manutenção', 'Obs']],
                body: bombas.map(i => [i.andar, i.id, i.operacao ? 'Normal' : 'FALHA', i.teste_pressao ? 'Realizado' : 'Não Feito', i.necessita_manutencao ? 'SIM' : 'Não', i.obs || '-']),
                theme: 'grid', headStyles: { fillColor: [124, 58, 237] }
            }); yPos = doc.lastAutoTable.finalY + 10;
        }

        // --- SINALIZAÇÃO ---
        const sinalizacao = items.filter(i => i.type === 'sinalizacao');
        if (sinalizacao.length > 0) {
            doc.setFontSize(12); doc.setTextColor(13, 148, 136); // Teal
            doc.text("Sinalização de Emergência", 14, yPos); yPos += 2;

            doc.autoTable({
                startY: yPos,
                head: [['Local', 'ID', 'Existente', 'Tipo', 'Estado/Conformidade', 'Obs']],
                body: sinalizacao.map(i => {
                    let status = '-';
                    let tipoTexto = '-';

                    if (i.existente === 'Sim') {
                        tipoTexto = i.tipo || 'Saida';
                        let falhas = [];
                        if (!i.check_foto) falhas.push('S/ Foto');
                        if (!i.check_fixacao) falhas.push('Solta');
                        if (!i.check_visivel) falhas.push('Obstruída');
                        if (!i.check_legivel) falhas.push('Ilegível');

                        status = falhas.length === 0 ? 'OK' : falhas.join(', ');
                    }

                    return [i.andar, i.id, i.existente, tipoTexto, status, i.obs || '-'];
                }),
                theme: 'grid', headStyles: { fillColor: [13, 148, 136] }
            }); yPos = doc.lastAutoTable.finalY + 10;
        }

        // --- FOTOS ---
        const itemsWithPhotos = items.filter(i => i.imageFiles && i.imageFiles.length > 0);
        if (itemsWithPhotos.length > 0) {
            doc.addPage(); doc.setTextColor(0); doc.setFontSize(14); doc.text("Relatório Fotográfico", 14, 20);
            let x = 14; let y = 30; const imgWidth = 85; const imgHeight = 85; const gap = 10;

            for (const item of itemsWithPhotos) {
                if (y + 10 > 280) { doc.addPage(); y = 20; }
                doc.setFontSize(10); doc.setFont(undefined, 'bold'); doc.text(`Item: ${item.id} - ${item.andar} (${item.type})`, 14, y); y += 5;

                for (let i = 0; i < item.imageFiles.length; i++) {
                    try {
                        const imgData = await readFileAsDataURL(item.imageFiles[i]);
                        if (y + imgHeight > 285) { doc.addPage(); y = 20; doc.text(`Item: ${item.id} (Continuação)`, 14, y - 5); }
                        doc.addImage(imgData, 'JPEG', x, y, imgWidth, imgHeight);
                        doc.setFont(undefined, 'normal'); doc.setFontSize(8);
                        doc.text(`Foto ${i + 1}`, x, y + imgHeight + 3);

                        if (x === 14) { x = 14 + imgWidth + gap; } else { x = 14; y += imgHeight + 10; }
                    } catch (err) { console.error("Erro imagem PDF", err); }
                }
                if (x > 14) { x = 14; y += imgHeight + 10; } y += 5;
            }
        }

        // --- FINALIZAÇÃO ---
        if (mode === 'save') {
            doc.save(`Relatorio_${cliente}.pdf`);
        } else {
            // Modo Preview
            const blob = doc.output('bloburl');
            document.getElementById('pdf-frame').src = blob;
        }

    } catch (e) {
        console.error(e);
        if (mode === 'save') alert("Erro PDF: " + e.message);
    } finally {
        if (mode === 'save') {
            btn.innerHTML = oldText;
            btn.disabled = false;
        }
    }
}

async function saveToFirebase() {
    if (!db || !user) return alert("Faça login para salvar!");

    // Feedback visual no botão
    const btn = document.getElementById('btn-save');
    const oldText = btn.innerHTML;
    btn.innerHTML = "Salvando...";
    btn.disabled = true;

    try {
        // Criação do objeto com os dados do cabeçalho, incluindo os novos campos técnicos
        const headerData = {
            userId: user.uid,
            cliente: document.getElementById('cliente').value || "Não Informado",
            local: document.getElementById('local').value || "Não Informado",

            // Novos Campos adicionados conforme NBR/Padrão de Mercado
            respTecnico: document.getElementById('resp-tecnico').value || "Não Informado",
            classificacao: document.getElementById('classificacao').value || "-",
            validadeAvcb: document.getElementById('validade-avcb').value || null,

            data: document.getElementById('data-relatorio').value,
            timestamp: new Date(), // Data/Hora do salvamento real
            totalItens: items.length
        };

        // 1. Salva o documento principal da vistoria
        const vistoriaRef = await addDoc(collection(db, "vistorias"), headerData);

        // 2. Processa cada item e suas fotos para salvar na subcoleção
        const promises = items.map(async (item) => {
            let urls = [];

            // Upload de imagens (se houver)
            if (item.imageFiles && item.imageFiles.length > 0) {
                const uploadPromises = item.imageFiles.map(async (file, index) => {
                    // Cria uma referência única para a imagem no Storage
                    const imgRef = ref(storage, `fotos/${user.uid}/${vistoriaRef.id}/${item.id}_${index}_${Date.now()}`);
                    await uploadBytes(imgRef, file);
                    return await getDownloadURL(imgRef);
                });
                urls = await Promise.all(uploadPromises);
            }

            // Remove o array de arquivos brutos (imageFiles) antes de salvar no banco
            // pois o Firestore não aceita objetos File, apenas as URLs geradas acima
            const { imageFiles, ...itemData } = item;

            // Salva o item na subcoleção 'itens'
            return addDoc(collection(db, `vistorias/${vistoriaRef.id}/itens`), {
                ...itemData,
                fotoUrls: urls
            });
        });

        // Aguarda todos os itens serem salvos
        await Promise.all(promises);

        alert("Vistoria salva com sucesso!");
        loadHistory(); // Atualiza a barra lateral

    } catch (e) {
        console.error(e);
        alert("Erro ao salvar: " + e.message);
    } finally {
        // Restaura o botão
        btn.innerHTML = oldText;
        btn.disabled = false;
    }
}