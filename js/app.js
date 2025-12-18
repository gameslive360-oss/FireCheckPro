import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// Importe sua configuração
import { firebaseConfig } from "./firebase-config.js";

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
        });
        console.log("Firebase Inicializado");
    } else {
        console.warn("API Key não configurada em firebase-config.js");
    }
} catch (error) {
    console.error("Erro na inicialização:", error);
}

// --- Estado da Aplicação ---
let items = [];
let currentType = 'hidrante';
let currentFile = null;

// --- Inicialização de UI ---
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    document.getElementById('data-relatorio').valueAsDate = new Date();

    // Listeners de Botões
    document.getElementById('btn-login').addEventListener('click', handleLogin);
    document.getElementById('btn-logout').addEventListener('click', handleLogout);
    document.getElementById('btn-add-item').addEventListener('click', addItem);
    document.getElementById('btn-pdf').addEventListener('click', generatePDF);
    document.getElementById('btn-save').addEventListener('click', saveToFirebase);
    document.getElementById('camera-input').addEventListener('change', handleFileSelect);
    document.getElementById('upload-input').addEventListener('change', handleFileSelect);
    document.getElementById('btn-clear-file').addEventListener('click', clearFile);
});

// --- Lógica de Abas ---
window.switchTab = function (type) {
    currentType = type;

    // Classes
    const baseClass = "tab-btn ";
    const hidBtn = document.getElementById('tab-hidrante');
    const extBtn = document.getElementById('tab-extintor');
    const luzBtn = document.getElementById('tab-luz');

    hidBtn.className = baseClass + (type === 'hidrante' ? 'tab-active-hidrante' : 'tab-inactive');
    extBtn.className = baseClass + (type === 'extintor' ? 'tab-active-extintor' : 'tab-inactive');
    luzBtn.className = baseClass + (type === 'luz' ? 'tab-active-luz' : 'tab-inactive');

    // Forms
    document.getElementById('form-hidrante').classList.add('hidden');
    document.getElementById('form-extintor').classList.add('hidden');
    document.getElementById('form-luz').classList.add('hidden');
    document.getElementById(`form-${type}`).classList.remove('hidden');
};

// --- Autenticação ---
async function handleLogin() {
    if (!auth) return alert("Firebase não configurado");
    try {
        await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
        alert("Erro login: " + e.message);
    }
}

function handleLogout() {
    if (auth) signOut(auth);
}

function updateUserUI() {
    const loginBtn = document.getElementById('btn-login');
    const userInfo = document.getElementById('user-info');
    const nameSpan = document.getElementById('user-name');

    if (user) {
        loginBtn.classList.add('hidden');
        userInfo.classList.remove('hidden');
        userInfo.classList.add('flex');
        nameSpan.textContent = user.displayName.split(' ')[0];
    } else {
        loginBtn.classList.remove('hidden');
        userInfo.classList.add('hidden');
        userInfo.classList.remove('flex');
    }
}

// --- Manipulação de Arquivo ---
function handleFileSelect(event) {
    if (event.target.files && event.target.files[0]) {
        currentFile = event.target.files[0];
        document.getElementById('file-info').classList.remove('hidden');
        document.getElementById('file-info').classList.add('flex');
    }
}

function clearFile() {
    currentFile = null;
    document.getElementById('camera-input').value = "";
    document.getElementById('upload-input').value = "";
    document.getElementById('file-info').classList.add('hidden');
    document.getElementById('file-info').classList.remove('flex');
}

// --- Adicionar Item ---
function addItem() {
    const andar = document.getElementById('andar').value;
    const id = document.getElementById('item-id').value;

    if (!andar || !id) {
        alert("Preencha o Local e a Identificação do item.");
        return;
    }

    const baseItem = {
        uid: Date.now(),
        type: currentType,
        andar,
        id,
        imageFile: currentFile
    };

    let specifics = {};

    if (currentType === 'hidrante') {
        specifics = {
            mangueira: document.getElementById('h-mangueira').value,
            esguicho: document.getElementById('h-esguicho').value,
            chave: document.getElementById('h-chave').value,
            validade_mang: document.getElementById('h-validade').value || '-',
            check_acesso: document.getElementById('h-acesso').checked,
            check_abrigo: document.getElementById('h-abrigo').checked,
            check_aduchada: document.getElementById('h-aduchada').checked,
            check_valvula: document.getElementById('h-valvula').checked
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
            check_mangueira: document.getElementById('e-mangueira').checked
        };
    } else if (currentType === 'luz') {
        specifics = {
            tipo: document.getElementById('l-tipo').value,
            estado: document.getElementById('l-estado').value,
            autonomia: document.getElementById('l-autonomia').value,
            check_acendimento: document.getElementById('l-acendimento').checked,
            check_led: document.getElementById('l-led').checked,
            check_fixacao: document.getElementById('l-fixacao').checked,
            check_lux: document.getElementById('l-lux').checked
        };
    }

    items.push({ ...baseItem, ...specifics });
    renderList();

    // Limpar campos de repetição
    document.getElementById('item-id').value = "";
    document.getElementById('item-id').focus();
    clearFile();
    // Desmarcar todos checkboxes
    document.querySelectorAll('input[type="checkbox"]').forEach(el => el.checked = false);
}

window.removeItem = function (uid) {
    if (confirm("Remover este item?")) {
        items = items.filter(i => i.uid !== uid);
        renderList();
    }
};

function renderList() {
    const listEl = document.getElementById('lista-itens');
    document.getElementById('count').innerText = items.length;
    listEl.innerHTML = "";

    if (items.length === 0) {
        listEl.innerHTML = '<div class="text-center py-10 border-2 border-dashed border-gray-200 rounded-lg text-gray-400 text-sm">Lista vazia.</div>';
        return;
    }

    items.forEach(item => {
        let colorClass, icon, details;

        if (item.type === 'hidrante') {
            colorClass = "border-l-blue-500"; icon = "droplets";
            const ok = [item.check_acesso, item.check_abrigo, item.check_valvula].filter(Boolean).length;
            details = `<span class="text-blue-600 text-xs">Hidrante • ${ok}/3 Checks</span>`;
        } else if (item.type === 'extintor') {
            colorClass = "border-l-red-500"; icon = "fire-extinguisher";
            const ok = [item.check_lacre, item.check_manometro, item.check_sinalizacao].filter(Boolean).length;
            details = `<span class="text-red-600 text-xs">Extintor • ${ok}/3 Checks</span>`;
        } else {
            colorClass = "border-l-amber-500"; icon = "lightbulb";
            details = `<span class="text-amber-600 text-xs">Luz • ${item.estado}</span>`;
        }

        const html = `
            <div class="bg-white p-3 rounded shadow-sm border border-gray-100 border-l-4 ${colorClass} flex justify-between items-center animate-fade-in">
                <div class="flex items-center gap-3">
                    <div class="p-2 bg-gray-50 rounded-full text-gray-600"><i data-lucide="${icon}" class="w-5 h-5"></i></div>
                    <div>
                        <div class="font-bold text-gray-800 text-sm">${item.id} <span class="font-normal text-gray-400">|</span> ${item.andar}</div>
                        <div class="mt-0.5">${details}</div>
                    </div>
                </div>
                <button onclick="window.removeItem(${item.uid})" class="text-red-300 hover:text-red-600 p-2"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
            </div>
        `;
        listEl.innerHTML += html;
    });
    lucide.createIcons();
}

// --- Gerar PDF ---
function generatePDF() {
    if (items.length === 0) return alert("Lista vazia!");

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const cliente = document.getElementById('cliente').value || "Cliente";
    const local = document.getElementById('local').value || "Local";
    const data = document.getElementById('data-relatorio').value.split('-').reverse().join('/');

    // Header Colorido
    doc.setFillColor(30, 41, 59);
    doc.rect(0, 0, 210, 28, 'F');
    doc.setTextColor(255);
    doc.setFontSize(16); doc.text("Relatório Técnico de Segurança", 14, 12);
    doc.setFontSize(10); doc.setTextColor(200); doc.text(`Cliente: ${cliente} | Local: ${local} | Data: ${data}`, 14, 22);

    let yPos = 40;

    // Hidrantes
    const hid = items.filter(i => i.type === 'hidrante');
    if (hid.length > 0) {
        doc.setFontSize(12); doc.setTextColor(37, 99, 235); doc.text("Hidrantes (NBR 13485)", 14, yPos); yPos += 2;
        doc.autoTable({
            startY: yPos,
            head: [['Local', 'ID', 'Mang', 'Esg', 'Val.Mang', 'Aces', 'Abrigo', 'Valv']],
            body: hid.map(i => [i.andar, i.id, i.mangueira, i.esguicho, i.validade_mang, i.check_acesso ? 'OK' : 'X', i.check_abrigo ? 'OK' : 'X', i.check_valvula ? 'OK' : 'X']),
            theme: 'grid', headStyles: { fillColor: [37, 99, 235] }, styles: { fontSize: 8 }
        });
        yPos = doc.lastAutoTable.finalY + 10;
    }

    // Extintores
    const ext = items.filter(i => i.type === 'extintor');
    if (ext.length > 0) {
        doc.setFontSize(12); doc.setTextColor(220, 38, 38); doc.text("Extintores (NBR 12962)", 14, yPos); yPos += 2;
        doc.autoTable({
            startY: yPos,
            head: [['Local', 'ID', 'Tipo', 'Recarga', 'Lacre', 'Manom', 'Sinal', 'Mang']],
            body: ext.map(i => [i.andar, i.id, i.tipo, i.recarga, i.check_lacre ? 'OK' : 'X', i.check_manometro ? 'OK' : 'X', i.check_sinalizacao ? 'OK' : 'X', i.check_mangueira ? 'OK' : 'X']),
            theme: 'grid', headStyles: { fillColor: [220, 38, 38] }, styles: { fontSize: 8 }
        });
        yPos = doc.lastAutoTable.finalY + 10;
    }

    // Luz
    const luz = items.filter(i => i.type === 'luz');
    if (luz.length > 0) {
        if (yPos > 250) { doc.addPage(); yPos = 20; }
        doc.setFontSize(12); doc.setTextColor(217, 119, 6); doc.text("Iluminação (NBR 10898)", 14, yPos); yPos += 2;
        doc.autoTable({
            startY: yPos,
            head: [['Local', 'ID', 'Tipo', 'Estado', 'Autonomia', 'Funcional', 'LED']],
            body: luz.map(i => [i.andar, i.id, i.tipo, i.estado, i.autonomia, i.check_acendimento ? 'OK' : 'X', i.check_led ? 'OK' : 'X']),
            theme: 'grid', headStyles: { fillColor: [217, 119, 6] }, styles: { fontSize: 8 }
        });
    }

    doc.save(`Relatorio_${cliente}.pdf`);
}

// --- Salvar Firebase ---
async function saveToFirebase() {
    if (!db) return alert("Firebase não configurado");
    if (!user) {
        if (confirm("É necessário login para salvar na nuvem. Fazer login?")) handleLogin();
        return;
    }

    const btn = document.getElementById('btn-save');
    const originalContent = btn.innerHTML;
    btn.innerHTML = "Salvando...";
    btn.disabled = true;

    try {
        const header = {
            cliente: document.getElementById('cliente').value,
            local: document.getElementById('local').value,
            data: document.getElementById('data-relatorio').value,
            timestamp: new Date(),
            userId: user.uid,
            userName: user.displayName
        };

        const docRef = await addDoc(collection(db, "vistorias"), header);

        const promises = items.map(async (item) => {
            let url = "";
            if (item.imageFile) {
                const sRef = ref(storage, `vistorias/${user.uid}/${docRef.id}/${item.id}-${Date.now()}.jpg`);
                await uploadBytes(sRef, item.imageFile);
                url = await getDownloadURL(sRef);
            }
            const { imageFile, ...data } = item;
            return addDoc(collection(db, `vistorias/${docRef.id}/itens`), { ...data, fotoUrl: url });
        });

        await Promise.all(promises);
        alert("Vistoria salva com sucesso!");
    } catch (e) {
        console.error(e);
        alert("Erro ao salvar: " + e.message);
    } finally {
        btn.innerHTML = originalContent;
        btn.disabled = false;
    }
}