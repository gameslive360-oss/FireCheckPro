import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, collection, addDoc, query, where, getDocs, orderBy, limit } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
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
            if (user) loadHistory(); // Carrega histórico ao logar
        });
        console.log("Firebase Inicializado");
    }
} catch (error) {
    console.error("Erro na inicialização:", error);
}

// --- Estado da Aplicação ---
let items = [];
let currentType = 'hidrante';
let currentFile = null;

// --- DOMContentLoaded & Persistência ---
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();

    // Restaurar Estado Salvo (Correção do Problema 1)
    restoreFormState();

    // Data padrão se não houver
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
    document.getElementById('btn-clear-file').addEventListener('click', clearFile);

    // Auto-Save em todos os campos com a classe 'save-state'
    document.querySelectorAll('.save-state').forEach(input => {
        input.addEventListener('input', () => {
            localStorage.setItem(input.id, input.type === 'checkbox' ? input.checked : input.value);
        });
    });
});

// --- Funções de Persistência (Local Storage) ---
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
    // Limpa apenas campos do item, mantendo cabeçalho se desejado
    const idsToClear = ['andar', 'item-id', 'h-mangueira', 'h-esguicho', 'h-chave', 'h-validade', 'e-peso', 'e-recarga', 'e-teste', 'l-autonomia', 'b-obs']; // Adicione outros IDs conforme necessário

    idsToClear.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.value = "";
            localStorage.removeItem(id);
        }
    });

    document.querySelectorAll('input[type="checkbox"]').forEach(el => {
        el.checked = false;
        localStorage.removeItem(el.id);
    });

    // Limpa selects para o valor padrão (índice 0)
    document.querySelectorAll('select.save-state').forEach(el => {
        el.selectedIndex = 0;
        localStorage.removeItem(el.id);
    });

    if (!keepHeader) {
        localStorage.clear();
    }
}

// --- Abas ---
window.switchTab = function (type) {
    currentType = type;
    const baseClass = "tab-btn ";

    ['hidrante', 'extintor', 'luz', 'bomba'].forEach(t => {
        const btn = document.getElementById(`tab-${t}`);
        const form = document.getElementById(`form-${t}`);

        if (t === type) {
            form.classList.remove('hidden');
            let color = t === 'hidrante' ? 'blue' : (t === 'extintor' ? 'red' : (t === 'luz' ? 'luz' : 'bomba')); // Ajuste de cor simples
            if (t === 'luz') color = 'luz'; // classe css especifica
            btn.className = baseClass + `tab-active-${t}`;
        } else {
            form.classList.add('hidden');
            btn.className = baseClass + 'tab-inactive';
        }
    });
};

// --- Autenticação ---
async function handleLogin() {
    if (!auth) return alert("Firebase não configurado");
    try {
        await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
        console.error(e);
        alert("Erro login: " + e.message);
    }
}

function handleLogout() {
    if (auth) signOut(auth);
    window.toggleMenu(); // Fecha menu
}

function updateUserUI() {
    const loginBtn = document.getElementById('btn-login');
    const userInfo = document.getElementById('user-info');
    const nameSpan = document.getElementById('user-name');
    const logoutSide = document.getElementById('btn-logout-side');

    if (user) {
        loginBtn.classList.add('hidden');
        userInfo.classList.remove('hidden');
        userInfo.classList.add('flex');
        nameSpan.textContent = user.displayName.split(' ')[0];
        logoutSide.classList.remove('hidden');
    } else {
        loginBtn.classList.remove('hidden');
        userInfo.classList.add('hidden');
        userInfo.classList.remove('flex');
        logoutSide.classList.add('hidden');
        document.getElementById('history-list').innerHTML = '<p class="text-sm text-gray-500 text-center">Faça login para ver.</p>';
    }
}

// --- Histórico (Correção 2 - Menu) ---
window.loadHistory = async function () {
    if (!user || !db) return;
    const listEl = document.getElementById('history-list');
    listEl.innerHTML = '<p class="text-center text-xs">Atualizando...</p>';

    try {
        const q = query(collection(db, "vistorias"), where("userId", "==", user.uid), orderBy("timestamp", "desc"), limit(10));
        const querySnapshot = await getDocs(q);

        listEl.innerHTML = "";
        if (querySnapshot.empty) {
            listEl.innerHTML = '<p class="text-center text-xs text-gray-400">Nenhuma vistoria salva.</p>';
            return;
        }

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const date = data.timestamp ? new Date(data.timestamp.seconds * 1000).toLocaleDateString() : 'Data N/A';

            const item = document.createElement('div');
            item.className = "bg-gray-100 p-3 rounded border border-gray-200 text-sm";
            item.innerHTML = `
                <div class="font-bold text-slate-700">${data.cliente || 'Cliente Sem Nome'}</div>
                <div class="text-xs text-gray-500">${data.local} • ${date}</div>
                <div class="text-xs text-green-600 mt-1">Salvo na nuvem</div>
            `;
            listEl.appendChild(item);
        });
    } catch (e) {
        console.error("Erro histórico:", e);
        listEl.innerHTML = '<p class="text-red-500 text-xs text-center">Erro ao carregar</p>';
    }
};

// --- Arquivos ---
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
        imageFile: currentFile // Arquivo cru (File Object)
    };

    let specifics = {};
    // ... (Lógica de coleta de dados igual ao anterior - resumida aqui) ...
    // Para economizar espaço na resposta, mantenha a lógica de 'specifics' que você já tinha
    // Apenas certifique-se de pegar os checkboxes corretamente.

    if (currentType === 'hidrante') {
        specifics = {
            mangueira: document.getElementById('h-mangueira').value,
            esguicho: document.getElementById('h-esguicho').value,
            chave: document.getElementById('h-chave').value,
            validade_mang: document.getElementById('h-validade').value || '-',
            check_acesso: document.getElementById('h-acesso').checked,
            check_abrigo: document.getElementById('h-abrigo').checked,
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
    } else if (currentType === 'bomba') {
        specifics = {
            operacao: document.getElementById('b-operacao').checked,
            teste_pressao: document.getElementById('b-teste').checked,
            necessita_manutencao: document.getElementById('b-manutencao').checked,
            obs: document.getElementById('b-obs').value
        };

        if (specifics.necessita_manutencao && !specifics.obs.trim()) {
            alert("⚠️ ATENÇÃO: Você indicou que a bomba necessita manutenção.\n\nPor favor, descreva o problema no campo 'Observação' antes de salvar.");
            document.getElementById('b-obs').focus(); // Leva o cursor para o campo
            return; // Cancela a função, não salva nada
        }
    }

    items.push({ ...baseItem, ...specifics });
    renderList();

    // Limpar campos e storage
    clearFormState();
    clearFile();
    document.getElementById('item-id').focus();
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
        // ... (Lógica de renderização igual à anterior) ...
        // Simplificado para brevidade, use o mesmo HTML de antes
        let icon = item.type === 'hidrante' ? 'droplets' : (item.type === 'extintor' ? 'fire-extinguisher' : (item.type === 'luz' ? 'lightbulb' : 'activity'));
        let color = item.type === 'hidrante' ? 'blue' :
            (item.type === 'extintor' ? 'red' :
                (item.type === 'luz' ? 'amber' : 'purple'));

        const html = `
            <div class="bg-white p-3 rounded shadow-sm border-l-4 border-${color}-500 flex justify-between items-center">
                <div class="flex items-center gap-3">
                    <div class="p-2 bg-gray-50 rounded-full text-gray-600"><i data-lucide="${icon}" class="w-5 h-5"></i></div>
                    <div>
                        <div class="font-bold text-gray-800 text-sm">${item.id} <span class="font-normal text-gray-400">|</span> ${item.andar}</div>
                        <div class="text-xs text-gray-500">${item.type.toUpperCase()} ${item.imageFile ? '• 📸' : ''}</div>
                    </div>
                </div>
                <button onclick="window.removeItem(${item.uid})" class="text-red-300 hover:text-red-600 p-2"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
            </div>
        `;
        listEl.innerHTML += html;
    });
    lucide.createIcons();
}

// --- PDF com Fotos (Correção 3) ---
// Função auxiliar para ler arquivo como Base64
const readFileAsDataURL = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

async function generatePDF() {
    if (items.length === 0) return alert("Lista vazia!");

    const btn = document.getElementById('btn-pdf');
    const oldText = btn.innerHTML;
    btn.innerHTML = "Gerando...";
    btn.disabled = true;

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        const cliente = document.getElementById('cliente').value || "Cliente";
        const local = document.getElementById('local').value || "Local";
        const data = document.getElementById('data-relatorio').value.split('-').reverse().join('/');

        doc.setFillColor(30, 41, 59);
        doc.rect(0, 0, 210, 28, 'F');
        doc.setTextColor(255);
        doc.setFontSize(16); doc.text("Relatório Técnico de Segurança", 14, 12);
        doc.setFontSize(10); doc.setTextColor(200); doc.text(`Cliente: ${cliente} | Local: ${local} | Data: ${data}`, 14, 22);

        let yPos = 40;

        const hid = items.filter(i => i.type === 'hidrante');
        if (hid.length > 0) {
            doc.setFontSize(12); doc.setTextColor(37, 99, 235); doc.text("Hidrantes", 14, yPos); yPos += 2;
            doc.autoTable({
                startY: yPos,
                head: [['Local', 'ID', 'Mang', 'Esg', 'Validade', 'Obs']],
                body: hid.map(i => [i.andar, i.id, i.mangueira, i.esguicho, i.validade_mang, i.check_abrigo ? 'OK' : 'Verificar']),
                theme: 'grid', headStyles: { fillColor: [37, 99, 235] }
            });
            yPos = doc.lastAutoTable.finalY + 10;
        }

        const ext = items.filter(i => i.type === 'extintor');
        if (ext.length > 0) {
            doc.setFontSize(12); doc.setTextColor(220, 38, 38); doc.text("Extintores", 14, yPos); yPos += 2;
            doc.autoTable({
                startY: yPos,
                head: [['Local', 'ID', 'Tipo', 'Peso', 'Recarga', 'Lacre/Manom']],
                body: ext.map(i => [i.andar, i.id, i.tipo, i.peso, i.recarga, (i.check_lacre && i.check_manometro) ? 'OK' : 'Verificar']),
                theme: 'grid', headStyles: { fillColor: [220, 38, 38] }
            });
            yPos = doc.lastAutoTable.finalY + 10;
        }

        const bombas = items.filter(i => i.type === 'bomba');
        if (bombas.length > 0) {
            doc.setFontSize(12);
            doc.setTextColor(124, 58, 237); // Cor Roxa (RGB)
            doc.text("Sistema de Pressurização (Bombas)", 14, yPos);
            yPos += 2;

            doc.autoTable({
                startY: yPos,
                // Cabeçalho da tabela
                head: [['Local', 'ID', 'Operação', 'Teste Pressão', 'Manutenção', 'Obs']],
                // Corpo da tabela (Convertendo true/false em Sim/Não)
                body: bombas.map(i => [
                    i.andar,
                    i.id,
                    i.operacao ? 'Normal' : 'FALHA',
                    i.teste_pressao ? 'Realizado' : 'Não Feito',
                    i.necessita_manutencao ? 'SIM' : 'Não',
                    i.obs || '-'
                ]),
                theme: 'grid',
                headStyles: { fillColor: [124, 58, 237] } // Cabeçalho Roxo
            });
            yPos = doc.lastAutoTable.finalY + 10;
        }

        // --- Anexar Fotos no Final ---
        const itemsWithPhotos = items.filter(i => i.imageFile);

        if (itemsWithPhotos.length > 0) {
            doc.addPage();
            doc.setTextColor(0);
            doc.setFontSize(14);
            doc.text("Relatório Fotográfico", 14, 20);

            let x = 14;
            let y = 30;
            const width = 80;
            const height = 80;

            for (const item of itemsWithPhotos) {
                try {
                    const imgData = await readFileAsDataURL(item.imageFile);

                    // Verifica se cabe na página
                    if (y + height > 280) {
                        doc.addPage();
                        y = 20;
                    }

                    doc.addImage(imgData, 'JPEG', x, y, width, height);
                    doc.setFontSize(10);
                    doc.text(`Item: ${item.id} - ${item.andar}`, x, y + height + 5);

                    // Lógica para 2 colunas
                    if (x === 14) {
                        x = 110; // Move para direita
                    } else {
                        x = 14; // Move para esquerda
                        y += height + 20; // Desce linha
                    }

                } catch (err) {
                    console.error("Erro ao processar imagem", err);
                }
            }
        }

        doc.save(`Relatorio_${cliente}.pdf`);

    } catch (e) {
        console.error(e);
        alert("Erro PDF: " + e.message);
    } finally {
        btn.innerHTML = oldText;
        btn.disabled = false;
    }
}

// --- Salvar Firebase ---
async function saveToFirebase() {
    if (!db) return alert("Erro configuração DB");
    if (!user) return alert("Faça login para salvar!");

    const btn = document.getElementById('btn-save');
    const oldText = btn.innerHTML;
    btn.innerHTML = "Salvando...";
    btn.disabled = true;

    try {
        // Cria cabeçalho da vistoria
        const vistoriaRef = await addDoc(collection(db, "vistorias"), {
            userId: user.uid,
            cliente: document.getElementById('cliente').value,
            local: document.getElementById('local').value,
            data: document.getElementById('data-relatorio').value,
            timestamp: new Date(),
            totalItens: items.length
        });

        // Salva itens
        const promises = items.map(async (item) => {
            let url = null;
            if (item.imageFile) {
                const imgRef = ref(storage, `fotos/${user.uid}/${vistoriaRef.id}/${item.id}_${Date.now()}`);
                await uploadBytes(imgRef, item.imageFile);
                url = await getDownloadURL(imgRef);
            }

            // Remove o arquivo 'imageFile' antes de salvar no JSON do Firestore
            const { imageFile, ...itemData } = item;

            return addDoc(collection(db, `vistorias/${vistoriaRef.id}/itens`), {
                ...itemData,
                fotoUrl: url
            });
        });

        await Promise.all(promises);

        alert("Vistoria salva com sucesso!");
        loadHistory(); // Atualiza a lista lateral

    } catch (e) {
        console.error(e);
        alert("Erro ao salvar: " + e.message);
    } finally {
        btn.innerHTML = oldText;
        btn.disabled = false;
    }
}