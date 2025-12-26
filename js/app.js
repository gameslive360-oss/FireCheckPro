import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, collection, addDoc, query, where, getDocs, orderBy, limit } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { PhraseManager } from "./phrases.js";

// --- Configuração ---
// Lista de abas do sistema. Para desativar a lógica de uma, basta remover daqui.
const TABS = ['hidrante', 'extintor', 'luz', 'bomba'];

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

    // Listeners
    document.getElementById('btn-login').addEventListener('click', handleLogin);
    document.getElementById('btn-logout-side').addEventListener('click', handleLogout);
    document.getElementById('btn-add-item').addEventListener('click', addItem);
    document.getElementById('btn-pdf').addEventListener('click', generatePDF);
    document.getElementById('btn-save').addEventListener('click', saveToFirebase);
    document.getElementById('camera-input').addEventListener('change', handleFileSelect);
    document.getElementById('upload-input').addEventListener('change', handleFileSelect);

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

const phrasesManager = new PhraseManager();
window.phrases = phrasesManager;

// --- Lógica de Abas (Refatorada para não apagar classes manuais) ---
window.switchTab = function (type) {
    currentType = type;

    TABS.forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        const form = document.getElementById(`form-${t}`);

        // Define a classe de cor específica desta aba (ex: tab-active-hidrante)
        const activeClass = `tab-active-${t}`;

        if (t === type) {
            // -- ATIVAR --
            form.classList.remove('hidden');

            // Remove estilo inativo e adiciona o ativo específico
            btn.classList.remove('tab-inactive');
            btn.classList.add(activeClass);
        } else {
            // -- DESATIVAR --
            form.classList.add('hidden');

            // Remove o estilo ativo específico e adiciona inativo
            btn.classList.remove(activeClass);
            btn.classList.add('tab-inactive');
        }
        // NOTA: Como usamos classList.add/remove, se você colocou 'hidden' 
        // manualmente no HTML do botão, ele SERÁ PRESERVADO.
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
    const idsToClear = ['h-lances', 'h-obs', 'h-validade', 'e-peso', 'e-recarga', 'e-teste', 'l-autonomia', 'b-obs', 'e-obs', 'l-obs'];
    idsToClear.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.value = ""; localStorage.removeItem(id); }
    });
    document.querySelectorAll('input[type="checkbox"]').forEach(el => {
        el.checked = (el.id === 'h-tem-mangueira');
        localStorage.removeItem(el.id);
    });
    document.querySelectorAll('select.save-state').forEach(el => {
        el.selectedIndex = 0;
        localStorage.removeItem(el.id);
    });
    window.toggleMangueiraFields();
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
    }

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
        } else if (item.type === 'luz') {
            document.getElementById('l-tipo').value = item.tipo;
            document.getElementById('l-estado').value = item.estado;
            document.getElementById('l-autonomia').value = item.autonomia;
            document.getElementById('l-acendimento').checked = item.check_acendimento;
            document.getElementById('l-led').checked = item.check_led;
            document.getElementById('l-fixacao').checked = item.check_fixacao;
            document.getElementById('l-lux').checked = item.check_lux;
        } else if (item.type === 'bomba') {
            document.getElementById('b-operacao').checked = item.operacao;
            document.getElementById('b-teste').checked = item.teste_pressao;
            document.getElementById('b-manutencao').checked = item.necessita_manutencao;
            document.getElementById('b-obs').value = item.obs;
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
    if (items.length === 0) { listEl.innerHTML = '<div class="text-center py-10 border-2 border-dashed border-gray-200 rounded-lg text-gray-400 text-sm">Lista vazia.</div>'; return; }
    items.slice().reverse().forEach(item => {
        let icon = item.type === 'hidrante' ? 'droplets' : (item.type === 'extintor' ? 'fire-extinguisher' : (item.type === 'luz' ? 'lightbulb' : 'activity'));
        let color = item.type === 'hidrante' ? 'blue' : (item.type === 'extintor' ? 'red' : (item.type === 'luz' ? 'amber' : 'purple'));
        const photoBadge = (item.imageFiles && item.imageFiles.length > 0) ? `<span class="text-xs bg-blue-100 text-blue-700 px-1 rounded ml-1">📷 ${item.imageFiles.length}</span>` : '';

        const html = `
        <div class="bg-white p-3 rounded shadow-sm border-l-4 border-${color}-500 flex justify-between items-center animate-fade-in">
            <div class="flex items-center gap-3 overflow-hidden">
                <div class="p-2 bg-gray-50 rounded-full text-gray-600 flex-shrink-0"><i data-lucide="${icon}" class="w-5 h-5"></i></div>
                <div class="min-w-0"><div class="font-bold text-gray-800 text-sm truncate">${item.id} <span class="font-normal text-gray-400">|</span> ${item.andar}</div><div class="text-xs text-gray-500 truncate">${item.type.toUpperCase()} ${photoBadge}</div></div>
            </div>
            <div class="flex items-center">
                <button onclick="window.editItem(${item.uid})" class="text-blue-400 hover:text-blue-600 p-2 transition-colors" title="Editar"><i data-lucide="pencil" class="w-4 h-4"></i></button>
                <button onclick="window.removeItem(${item.uid})" class="text-red-300 hover:text-red-600 p-2 transition-colors" title="Excluir"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
            </div>
        </div>`;
        listEl.innerHTML += html;
    });
    lucide.createIcons();
}

const readFileAsDataURL = (file) => { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = (e) => resolve(e.target.result); reader.onerror = reject; reader.readAsDataURL(file); }); };

async function generatePDF() {
    if (items.length === 0) return alert("Lista vazia!");
    const btn = document.getElementById('btn-pdf'); const oldText = btn.innerHTML; btn.innerHTML = "Gerando..."; btn.disabled = true;
    try {
        const { jsPDF } = window.jspdf; const doc = new jsPDF();
        const cliente = document.getElementById('cliente').value || "Cliente"; const local = document.getElementById('local').value || "Local"; const data = document.getElementById('data-relatorio').value.split('-').reverse().join('/');

        doc.setFillColor(30, 41, 59); doc.rect(0, 0, 210, 28, 'F'); doc.setTextColor(255);
        doc.setFontSize(16); doc.text("Relatório Técnico de Segurança", 14, 12); doc.setFontSize(10); doc.setTextColor(200); doc.text(`Cliente: ${cliente} | Local: ${local} | Data: ${data}`, 14, 22);

        let yPos = 40;

        // Bloco Hidrantes
        const hid = items.filter(i => i.type === 'hidrante');
        if (hid.length > 0) {
            doc.setFontSize(12); doc.setTextColor(37, 99, 235); doc.text("Hidrantes", 14, yPos); yPos += 2;
            doc.autoTable({
                startY: yPos, head: [['Local', 'ID', 'Mangueira', 'Vencimento', 'Selo', 'Comp. Faltantes', 'Observações']],
                body: hid.map(i => {
                    let faltantes = [];
                    if (!i.check_registro) faltantes.push('Reg'); if (!i.check_adaptador) faltantes.push('Adap'); if (!i.check_chave) faltantes.push('Chv'); if (!i.check_esguicho) faltantes.push('Esg');
                    const statusComp = faltantes.length === 0 ? 'OK' : faltantes.join(', ');
                    const mangueiraInfo = i.tem_mangueira ? `${i.lances}x ${i.metragem}` : 'AUSENTE';
                    return [i.andar, i.id, mangueiraInfo, i.tem_mangueira ? i.validade : '-', i.tem_mangueira ? i.selo : '-', statusComp, i.obs || '-'];
                }), theme: 'grid', headStyles: { fillColor: [37, 99, 235] }
            }); yPos = doc.lastAutoTable.finalY + 10;
        }
        // Bloco extintor
        const ext = items.filter(i => i.type === 'extintor');
        if (ext.length > 0) {
            doc.setFontSize(12); doc.setTextColor(220, 38, 38); doc.text("Extintores", 14, yPos); yPos += 2;
            doc.autoTable({
                startY: yPos,
                // Adicionado 'Obs' no final do head
                head: [['Local', 'ID', 'Tipo', 'Peso', 'Recarga', 'Lacre/Manom', 'Obs']],
                // Adicionado i.obs no final do body
                body: ext.map(i => [i.andar, i.id, i.tipo, i.peso, i.recarga, (i.check_lacre && i.check_manometro) ? 'OK' : 'Verificar', i.obs || '-']),
                theme: 'grid', headStyles: { fillColor: [220, 38, 38] }
            }); yPos = doc.lastAutoTable.finalY + 10;
        }
        // Bloco Bombas
        const bombas = items.filter(i => i.type === 'bomba');
        if (bombas.length > 0) {
            doc.setFontSize(12); doc.setTextColor(124, 58, 237); doc.text("Sistema de Pressurização (Bombas)", 14, yPos); yPos += 2;
            doc.autoTable({
                startY: yPos, head: [['Local', 'ID', 'Operação', 'Teste Pressão', 'Manutenção', 'Obs']],
                body: bombas.map(i => [i.andar, i.id, i.operacao ? 'Normal' : 'FALHA', i.teste_pressao ? 'Realizado' : 'Não Feito', i.necessita_manutencao ? 'SIM' : 'Não', i.obs || '-']),
                theme: 'grid', headStyles: { fillColor: [124, 58, 237] }
            }); yPos = doc.lastAutoTable.finalY + 10;
        }

        // Bloco Iluminação
        const luzes = items.filter(i => i.type === 'luz');
        if (luzes.length > 0) {
            doc.setFontSize(12); doc.setTextColor(217, 119, 6); doc.text("Iluminação de Emergência", 14, yPos); yPos += 2;
            doc.autoTable({
                startY: yPos,
                head: [['Local', 'ID', 'Tipo', 'Estado', 'Autonomia', 'Obs']],
                body: luzes.map(i => [i.andar, i.id, i.tipo, i.estado, i.autonomia, i.obs || '-']),
                theme: 'grid', headStyles: { fillColor: [217, 119, 6] }
            }); yPos = doc.lastAutoTable.finalY + 10;
        }

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
                        doc.addImage(imgData, 'JPEG', x, y, imgWidth, imgHeight); doc.setFont(undefined, 'normal'); doc.setFontSize(8); doc.text(`Foto ${i + 1}`, x, y + imgHeight + 3);
                        if (x === 14) { x = 14 + imgWidth + gap; } else { x = 14; y += imgHeight + 10; }
                    } catch (err) { console.error("Erro imagem PDF", err); }
                }
                if (x > 14) { x = 14; y += imgHeight + 10; } y += 5;
            }
        }
        doc.save(`Relatorio_${cliente}.pdf`);
    } catch (e) { console.error(e); alert("Erro PDF: " + e.message); } finally { btn.innerHTML = oldText; btn.disabled = false; }
}

async function saveToFirebase() {
    if (!db || !user) return alert("Faça login para salvar!");
    const btn = document.getElementById('btn-save'); const oldText = btn.innerHTML; btn.innerHTML = "Salvando..."; btn.disabled = true;
    try {
        const vistoriaRef = await addDoc(collection(db, "vistorias"), { userId: user.uid, cliente: document.getElementById('cliente').value, local: document.getElementById('local').value, data: document.getElementById('data-relatorio').value, timestamp: new Date(), totalItens: items.length });
        const promises = items.map(async (item) => {
            let urls = [];
            if (item.imageFiles && item.imageFiles.length > 0) {
                const uploadPromises = item.imageFiles.map(async (file, index) => {
                    const imgRef = ref(storage, `fotos/${user.uid}/${vistoriaRef.id}/${item.id}_${index}_${Date.now()}`); await uploadBytes(imgRef, file); return await getDownloadURL(imgRef);
                }); urls = await Promise.all(uploadPromises);
            }
            const { imageFiles, ...itemData } = item;
            return addDoc(collection(db, `vistorias/${vistoriaRef.id}/itens`), { ...itemData, fotoUrls: urls });
        });
        await Promise.all(promises); alert("Vistoria salva com sucesso!"); loadHistory();
    } catch (e) { console.error(e); alert("Erro ao salvar: " + e.message); } finally { btn.innerHTML = oldText; btn.disabled = false; }
}