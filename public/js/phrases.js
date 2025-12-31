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
            ],
            sinalizacao: [
                "Sinalização em conformidade com NBR 13434.",
                "Placa obstruída visualmente.",
                "Placa desbotada ou ilegível.",
                "Ausência de sinalização de Rota de Fuga.",
                "Ausência de sinalização de Equipamento.",
                "Placa danificada/quebrada.",
                "Instalada em altura incorreta.",
                "Má fixação (solta na parede).",
                "Fotoluminescência fraca ou inexistente.",
                "Sinalização suja/engordurada.",
                "Placa de tipo incorreto para o local."
            ],
            eletro: [
                "Sistema operando em automático, sem anomalias.",
                "Botoeira de acionamento manual travada/danificada.",
                "Necessita manutenção: Vibração excessiva no motor.",
                "Painel apresentando falha de comunicação.",
                "Baterias do gerador com carga baixa.",
                "Sistema de pressurização não partiu no teste manual.",
                "Luzes piloto do painel queimadas.",
                "Dampers atuando corretamente."
            ],
            sumario: [
                "Sistema aprovado. Equipamentos operantes conforme normas vigentes.",
                "Edificação apta para renovação do AVCB.",
                "Necessária adequação dos itens apontados em até 30 dias.",
                "URGENTE: Sistema de bombas inoperante. Risco iminente.",
                "Recomendamos contrato de manutenção mensal para o gerador.",
                "Solicitar recarga imediata dos extintores vencidos.",
                "Rotas de fuga obstruídas. Necessária desobstrução imediata.",
                "Sinalização de emergência incompleta, providenciar instalação conforme NBR 13434.",
                "Sistema de iluminação apresentou falha de autonomia nas baterias.",
                "Providenciar ART de manutenção dos sistemas.",
                "Realizar teste hidrostático nas mangueiras (vencidas há mais de 5 anos)."
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