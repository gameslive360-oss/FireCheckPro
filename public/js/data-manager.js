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