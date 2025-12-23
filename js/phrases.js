// js/phrases.js

export class PhraseManager {
    constructor() {
        this.modalId = 'modal-phrases';
        this.listId = 'phrases-list';
        this.inputId = 'new-phrase-input';

        // Estado interno
        this.currentTargetInputId = null;
        this.currentCategory = null;

        // Frases Padrão (Hardcoded)
        this.defaults = {
            hidrante: [
                "Abrigo obstruído.",
                "Visor do abrigo quebrado.",
                "Mangueira furada no teste.",
                "Registro emperrado.",
                "Falta sinalização fotoluminescente.",
                "Esguicho com defeito.",
                "Tudo em conformidade."
            ],
            bomba: [
                "Pressão nominal atingida.",
                "Bomba não partiu no automático.",
                "Vazamento na gaxeta.",
                "Manômetro danificado.",
                "Painel elétrico sem energia."
            ],
            extintor: [
                "Despressurizado.",
                "Lacre rompido.",
                "Teste hidrostático vencido.",
                "Obstruído."
            ],
            luz: [
                "Bateria viciada.",
                "Lâmpada queimada.",
                "Não acendeu no teste."
            ]
        };
    }

    /**
     * Abre o modal e define o contexto
     * @param {string} targetId - ID do textarea onde o texto será inserido
     * @param {string} category - Categoria (hidrante, bomba, etc)
     */
    open(targetId, category) {
        this.currentTargetInputId = targetId;
        this.currentCategory = category;
        this.render();
        document.getElementById(this.modalId).classList.remove('hidden');
    }

    /**
     * Fecha o modal e limpa estado
     */
    close() {
        document.getElementById(this.modalId).classList.add('hidden');
        this.currentTargetInputId = null;
    }

    /**
     * Insere a frase no input selecionado e salva estado
     */
    insert(text) {
        const input = document.getElementById(this.currentTargetInputId);
        if (input) {
            const prefix = input.value ? input.value + "\n" : "";
            input.value = prefix + text;

            // Dispara evento para o auto-save do app.js funcionar
            input.dispatchEvent(new Event('input'));

            // Salva explicitamente no localStorage (redundância de segurança)
            localStorage.setItem(input.id, input.value);
        }
        this.close();
    }

    /**
     * Adiciona nova frase personalizada
     */
    addCustom() {
        const input = document.getElementById(this.inputId);
        const text = input.value.trim();

        if (!text) return;

        const customStored = this._getCustomStorage();

        if (!customStored[this.currentCategory]) {
            customStored[this.currentCategory] = [];
        }

        customStored[this.currentCategory].push(text);
        this._saveCustomStorage(customStored);

        input.value = "";
        this.render();
    }

    /**
     * Remove frase personalizada
     */
    removeCustom(textToDelete) {
        if (!confirm("Excluir esta frase?")) return;

        const customStored = this._getCustomStorage();
        if (customStored[this.currentCategory]) {
            customStored[this.currentCategory] = customStored[this.currentCategory].filter(t => t !== textToDelete);
            this._saveCustomStorage(customStored);
            this.render();
        }
    }

    /**
     * Renderiza a lista na tela
     */
    render() {
        const listEl = document.getElementById(this.listId);
        listEl.innerHTML = "";

        const standards = this.defaults[this.currentCategory] || [];
        const customs = (this._getCustomStorage())[this.currentCategory] || [];
        const allPhrases = [...standards, ...customs];

        if (allPhrases.length === 0) {
            listEl.innerHTML = '<p class="text-gray-400 text-sm text-center">Nenhuma frase disponível.</p>';
            return;
        }

        allPhrases.forEach(text => {
            const isCustom = customs.includes(text);
            const btn = document.createElement('div'); // Div container para flex
            btn.className = "w-full p-3 bg-slate-50 hover:bg-blue-50 border border-slate-200 rounded text-sm text-slate-700 transition-colors flex justify-between items-center cursor-pointer group";

            // Texto (clique para inserir)
            const textSpan = document.createElement('span');
            textSpan.className = "flex-1";
            textSpan.textContent = text;
            textSpan.onclick = () => this.insert(text);

            btn.appendChild(textSpan);

            // Botão de deletar (se for custom)
            if (isCustom) {
                const delBtn = document.createElement('button');
                delBtn.className = "text-red-300 hover:text-red-500 p-2 ml-2";
                delBtn.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i>';
                delBtn.onclick = (e) => {
                    e.stopPropagation(); // Evita inserir ao deletar
                    this.removeCustom(text);
                };
                btn.appendChild(delBtn);
            }

            listEl.appendChild(btn);
        });

        // Atualiza ícones do Lucide
        if (window.lucide) window.lucide.createIcons();
    }

    // --- Helpers Privados (Simulados) ---

    _getCustomStorage() {
        return JSON.parse(localStorage.getItem('customPhrases') || '{}');
    }

    _saveCustomStorage(data) {
        localStorage.setItem('customPhrases', JSON.stringify(data));
    }
}