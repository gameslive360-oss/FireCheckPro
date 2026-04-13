export class ExcelManager {
    constructor() {
        this.boolToText = (val) => val === true ? "Sim" : (val === false ? "Não" : val);
        this.textToBool = (val) => String(val).trim().toLowerCase() === "sim";
    }

    export(items) {
        if (!items || !items.length) {
            alert("A lista está vazia.");
            return;
        }

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

        const itemsData = items.map(item => this._formatItemForExport(item));
        const wb = XLSX.utils.book_new();

        const wsHeader = XLSX.utils.aoa_to_sheet(headerData);
        XLSX.utils.book_append_sheet(wb, wsHeader, "Dados Cliente");

        const wsItems = XLSX.utils.json_to_sheet(itemsData);
        XLSX.utils.book_append_sheet(wb, wsItems, "Itens Vistoriados");

        XLSX.writeFile(wb, `Planilha_FireCheck_${Date.now()}.xlsx`);
    }

    import(event, onSuccess) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const wb = XLSX.read(data, { type: 'array' });

                const wsHeader = wb.Sheets["Dados Cliente"];
                let headerMap = {};
                if (wsHeader) {
                    const headerArr = XLSX.utils.sheet_to_json(wsHeader, { header: 1 });
                    headerArr.forEach(row => { if (row[0]) headerMap[row[0]] = row[1]; });
                }

                const wsItems = wb.Sheets["Itens Vistoriados"];
                let newItems = [];
                if (wsItems) {
                    const rows = XLSX.utils.sheet_to_json(wsItems);
                    newItems = rows.map(row => this._parseItemFromImport(row));
                }

                if (onSuccess) onSuccess(newItems, headerMap);

            } catch (err) {
                console.error(err);
                alert("Erro ao ler planilha: " + err.message);
            }
        };
        reader.readAsArrayBuffer(file);
        event.target.value = "";
    }

    _formatItemForExport(item) {
        return {
            "Tipo": item.type,
            "Local/Andar": item.andar,
            "ID": item.id,
            "Observações": item.obs || "",
            "H-Mangueira?": this.boolToText(item.tem_mangueira),
            "H-Validade": item.validade || "",
            "H-Lances": item.lances || "",
            "H-Metragem": item.metragem || "",
            "H-Registro OK": this.boolToText(item.check_registro),
            "H-Adaptador OK": this.boolToText(item.check_adaptador),
            "H-Chave OK": this.boolToText(item.check_chave),
            "H-Esguicho OK": this.boolToText(item.check_esguicho),
            "H-Tem Acionador?": this.boolToText(item.tem_acionador),
            "H-Acionador Funcional": this.boolToText(item.acionador_funcional),
            "H-Acionador Quebrado": this.boolToText(item.acionador_quebrado),
            "E-Tipo": item.tipo || "",
            "E-Peso": item.peso || "",
            "E-Recarga": item.recarga || "",
            "E-Teste Hidro": item.teste_hidro || "",
            "E-Lacre OK": this.boolToText(item.check_lacre),
            "E-Manometro OK": this.boolToText(item.check_manometro),
            "E-Sinalizacao OK": this.boolToText(item.check_sinalizacao),
            "L-Estado": item.estado || "",
            "L-Autonomia": item.autonomia || "",
            "_UID": item.uid
        };
    }

    _parseItemFromImport(row) {
        return {
            uid: row["_UID"] || Date.now() + Math.random(),
            type: row["Tipo"] || "geral",
            id: row["ID"] || "",
            andar: row["Local/Andar"] || "",
            obs: row["Observações"] || "",
            imageFiles: [],
            tem_mangueira: this.textToBool(row["H-Mangueira?"]),
            validade: row["H-Validade"] || "-",
            lances: row["H-Lances"] || "1",
            metragem: row["H-Metragem"] || "15m",
            check_registro: this.textToBool(row["H-Registro OK"]),
            check_adaptador: this.textToBool(row["H-Adaptador OK"]),
            check_chave: this.textToBool(row["H-Chave OK"]),
            check_esguicho: this.textToBool(row["H-Esguicho OK"]),
            tem_acionador: this.textToBool(row["H-Tem Acionador?"]),
            acionador_funcional: this.textToBool(row["H-Acionador Funcional"]),
            acionador_quebrado: this.textToBool(row["H-Acionador Quebrado"]),
            tipo: row["E-Tipo"] || "",
            peso: row["E-Peso"] || "",
            recarga: row["E-Recarga"] || "-",
            teste_hidro: row["E-Teste Hidro"] || "-",
            check_lacre: this.textToBool(row["E-Lacre OK"]),
            check_manometro: this.textToBool(row["E-Manometro OK"]),
            check_sinalizacao: this.textToBool(row["E-Sinalizacao OK"]),
            estado: row["L-Estado"] || "OK",
            autonomia: row["L-Autonomia"] || "Nao Testado"
        };
    }
}

export class DraftManager {
    constructor() {
        localforage.config({
            name: 'FireCheckPro',
            storeName: 'offline_drafts',
            description: 'Armazena rascunhos de relatórios e fotos offline'
        });
    }

    // Salva a lista convertendo as imagens para Base64 (Texto)
    async saveDraft(items, reportNumber) {
        try {
            // Criamos uma cópia da lista para não alterar o que está na tela
            const itemsToSave = await Promise.all(items.map(async (item) => {
                const clonedItem = { ...item };

                // Se o item tem fotos, converte os arquivos físicos para Base64
                if (clonedItem.imageFiles && clonedItem.imageFiles.length > 0) {
                    clonedItem.imageFiles = await Promise.all(clonedItem.imageFiles.map(async (file) => {
                        if (typeof file === 'string') return file; // Já é link ou texto
                        return await this._fileToBase64(file); // Converte o arquivo
                    }));
                }
                return clonedItem;
            }));

            await localforage.setItem('draft_items', itemsToSave);
            await localforage.setItem('draft_report_number', reportNumber);
            console.log('✅ Rascunho blindado com imagens offline!');
        } catch (err) {
            console.error('❌ Erro ao salvar rascunho offline:', err);
        }
    }

    // Carrega o rascunho e converte o Base64 de volta para Arquivo
    async loadDraft() {
        try {
            const items = await localforage.getItem('draft_items');
            const reportNumber = await localforage.getItem('draft_report_number');

            if (items && items.length > 0) {
                const parsedItems = items.map(item => {
                    if (item.imageFiles && item.imageFiles.length > 0) {
                        item.imageFiles = item.imageFiles.map((imgData, i) => {
                            // Se for um texto de imagem (Base64), converte de volta para Arquivo
                            if (typeof imgData === 'string' && imgData.startsWith('data:image')) {
                                return this._base64ToFile(imgData, `draft_img_${Date.now()}_${i}.jpg`);
                            }
                            return imgData;
                        });
                    }
                    return item;
                });
                return { items: parsedItems, reportNumber };
            }
            return null;
        } catch (err) {
            console.error('❌ Erro ao carregar rascunho:', err);
            return null;
        }
    }

    async clearDraft() {
        try {
            await localforage.removeItem('draft_items');
            console.log('🧹 Rascunho offline limpo.');
        } catch (err) {
            console.error('❌ Erro ao limpar rascunho:', err);
        }
    }

    // --- FUNÇÕES AUXILIARES DE CONVERSÃO ---
    _fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    }

    _base64ToFile(dataurl, filename) {
        const arr = dataurl.split(',');
        const mime = arr[0].match(/:(.*?);/)[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) u8arr[n] = bstr.charCodeAt(n);
        return new File([u8arr], filename, { type: mime });
    }
}