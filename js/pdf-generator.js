const readFileAsDataURL = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

/**
 * Função principal de geração do Relatório
 * @param {Array} items - A lista de itens inspecionados (vinda do app.js)
 * @param {String} mode - 'save' (baixa o arquivo) ou 'preview' (mostra no iframe)
 */
export async function generatePDF(items, mode = 'save') {
    if (items.length === 0 && mode === 'save') return alert("Lista vazia! Adicione itens antes de gerar o relatório.");

    const btn = document.getElementById('btn-pdf');
    let oldText = "";

    // Feedback visual no botão apenas se for salvar
    if (mode === 'save') {
        oldText = btn.innerHTML;
        btn.innerHTML = "Processando...";
        btn.disabled = true;
    }

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // --- 1. CABEÇALHO (DADOS OBRA E DATA) ---
        const cliente = document.getElementById('cliente').value || "Não Informado";
        const local = document.getElementById('local').value || "Não Informado";
        const tecnico = document.getElementById('resp-tecnico').value || "Não Informado";
        const classificacao = document.getElementById('classificacao').value || "-";

        // Datas
        const dataRaw = document.getElementById('data-relatorio').value;
        const dataRelatorio = dataRaw ? dataRaw.split('-').reverse().join('/') : new Date().toLocaleDateString();
        const avcbRaw = document.getElementById('validade-avcb').value;
        const dataAvcb = avcbRaw ? avcbRaw.split('-').reverse().join('/') : "-";

        // Design do Cabeçalho
        doc.setFillColor(30, 41, 59); // Slate 800
        doc.rect(0, 0, 210, 45, 'F');

        doc.setTextColor(255);
        doc.setFontSize(16);
        doc.setFont(undefined, 'bold');
        doc.text("RELATÓRIO TÉCNICO DE VISTORIA", 105, 15, { align: 'center' });

        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        doc.text("Sistemas de Prevenção e Combate a Incêndio", 105, 22, { align: 'center' });

        // Grid de Dados
        doc.setFontSize(9);
        doc.text(`Cliente: ${cliente}`, 14, 32);
        doc.text(`Local: ${local}`, 14, 37);
        doc.text(`Resp. Técnico: ${tecnico}`, 110, 32);
        doc.text(`Classificação: ${classificacao}`, 110, 37);

        doc.setFont(undefined, 'bold');
        doc.setTextColor(147, 197, 253); // Azul claro
        doc.text(`Data: ${dataRelatorio}`, 175, 32);
        doc.text(`AVCB: ${dataAvcb}`, 175, 37);

        let yPos = 55;

        // --- 2. SUMÁRIO EXECUTIVO ---
        const parecer = document.getElementById('sum-parecer') ? document.getElementById('sum-parecer').value : '';
        const resumo = document.getElementById('sum-resumo') ? document.getElementById('sum-resumo').value : '';
        const riscos = document.getElementById('sum-riscos') ? document.getElementById('sum-riscos').value : '';

        if (parecer || resumo || riscos) {
            doc.setTextColor(0);
            doc.setFontSize(12);
            doc.setFont(undefined, 'bold');
            doc.text("1. Sumário Executivo", 14, yPos);
            yPos += 5;

            // Caixa do Parecer
            let corParecer = [220, 252, 231]; // Verde claro
            if (parecer.includes("Restrições")) corParecer = [254, 249, 195]; // Amarelo
            if (parecer.includes("Reprovado")) corParecer = [254, 226, 226]; // Vermelho

            doc.setFillColor(...corParecer);
            doc.roundedRect(14, yPos, 182, 10, 1, 1, 'F');
            doc.setFontSize(10);
            doc.setTextColor(30);
            doc.text(`Situação: ${parecer.toUpperCase()}`, 105, yPos + 6.5, { align: 'center' });
            yPos += 15;

            if (resumo) {
                doc.setFontSize(10);
                doc.setFont(undefined, 'bold');
                doc.text("Resumo das Instalações:", 14, yPos);
                yPos += 5;
                doc.setFont(undefined, 'normal');
                const splitResumo = doc.splitTextToSize(resumo, 180);
                doc.text(splitResumo, 14, yPos);
                yPos += splitResumo.length * 5 + 3;
            }

            if (riscos) {
                doc.setFont(undefined, 'bold');
                doc.setTextColor(185, 28, 28); // Vermelho escuro
                doc.text("Principais Não Conformidades:", 14, yPos);
                yPos += 5;
                doc.setFont(undefined, 'normal');
                doc.setTextColor(0);
                const splitRiscos = doc.splitTextToSize(riscos, 180);
                doc.text(splitRiscos, 14, yPos);
                yPos += splitRiscos.length * 5 + 5;
            }

            // Linha separadora
            doc.setDrawColor(200);
            doc.line(14, yPos, 196, yPos);
            yPos += 10;
        }

        // --- 3. SEÇÕES TÉCNICAS (ITENS VISTORIADOS) ---
        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(0);
        doc.text("2. Detalhamento Técnico", 14, yPos);
        yPos += 5;

        // Função auxiliar para gerar tabelas
        const generateTable = (title, data, headers, color) => {
            if (data.length === 0) return;
            // Verifica se cabe na página
            if (yPos > 250) { doc.addPage(); yPos = 20; }

            doc.setFontSize(11);
            doc.setTextColor(...color);
            doc.text(title, 14, yPos);
            yPos += 2;

            doc.autoTable({
                startY: yPos,
                head: [headers],
                body: data,
                theme: 'grid',
                headStyles: { fillColor: color },
                styles: { fontSize: 8 },
                margin: { left: 14, right: 14 }
            });
            yPos = doc.lastAutoTable.finalY + 10;
        };

        // Hidrantes
        const hid = items.filter(i => i.type === 'hidrante');
        generateTable("Hidrantes", hid.map(i => {
            let faltantes = [];
            if (!i.check_registro) faltantes.push('Reg');
            if (!i.check_adaptador) faltantes.push('Adap');
            if (!i.check_chave) faltantes.push('Chv');
            if (!i.check_esguicho) faltantes.push('Esg');
            const statusComp = faltantes.length === 0 ? 'OK' : faltantes.join(', ');
            const mangueiraInfo = i.tem_mangueira ? `${i.lances}x ${i.metragem}` : 'AUSENTE';
            return [i.andar, i.id, mangueiraInfo, i.tem_mangueira ? i.validade : '-', statusComp, i.obs || '-'];
        }), ['Local', 'ID', 'Mangueira', 'Validade', 'Acessórios', 'Obs'], [37, 99, 235]);

        // Extintores
        const ext = items.filter(i => i.type === 'extintor');
        generateTable("Extintores", ext.map(i => [
            i.andar, i.id, i.tipo, i.peso, i.recarga,
            (i.check_lacre && i.check_manometro) ? 'OK' : 'Verificar', i.obs || '-'
        ]), ['Local', 'ID', 'Tipo', 'Peso', 'Recarga', 'Status', 'Obs'], [220, 38, 38]);

        // Iluminação
        const luz = items.filter(i => i.type === 'luz');
        generateTable("Iluminação de Emergência", luz.map(i => [
            i.andar, i.id, i.tipo, i.estado, i.autonomia, i.obs || '-'
        ]), ['Local', 'ID', 'Tipo', 'Estado', 'Autonomia', 'Obs'], [217, 119, 6]);

        // Sinalização
        const sin = items.filter(i => i.type === 'sinalizacao');
        generateTable("Sinalização", sin.map(i => {
            let status = 'OK';
            if (i.existente === 'Sim') {
                let falhas = [];
                if (!i.check_foto) falhas.push('Fotom.');
                if (!i.check_fixacao) falhas.push('Fixação');
                if (!i.check_visivel) falhas.push('Visib.');
                status = falhas.length === 0 ? 'Conforme' : falhas.join(', ');
            } else { status = 'Inexistente'; }
            return [i.andar, i.id, i.tipo || '-', status, i.obs || '-'];
        }), ['Local', 'ID', 'Tipo', 'Conformidade', 'Obs'], [13, 148, 136]);

        // Eletromecanização
        const eletro = items.filter(i => i.type === 'eletro');
        generateTable("Sistemas Eletromecânicos", eletro.map(i => {
            const manut = i.precisa_manutencao === 'Sim' ? 'SIM' : 'Não';
            return [i.andar, i.tipo_sistema, i.botoeiras, manut, i.obs || '-'];
        }), ['Local', 'Sistema', 'Botoeira', 'Manutenção', 'Obs'], [79, 70, 229]);

        // Bombas
        const bombas = items.filter(i => i.type === 'bomba');
        generateTable("Bombas de Incêndio", bombas.map(i => [
            i.andar, i.id, i.operacao ? 'Auto' : 'Manual/Off', i.teste_pressao ? 'Sim' : 'Não', i.necessita_manutencao ? 'SIM' : 'Não', i.obs || '-'
        ]), ['Local', 'ID', 'Modo', 'Teste', 'Manut.', 'Obs'], [124, 58, 237]);

        // Observações Gerais
        const geral = items.filter(i => i.type === 'geral');
        generateTable("Observações Gerais", geral.map(i => [
            i.obs || '-'
        ]), ['Descrição'], [71, 85, 105]);

        // --- 4. CONCLUSÕES E RECOMENDAÇÕES ---
        if (yPos > 230) { doc.addPage(); yPos = 20; }

        const conclusao = document.getElementById('sum-conclusao') ? document.getElementById('sum-conclusao').value : '';
        if (conclusao) {
            yPos += 5;
            doc.setFontSize(12);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(0);
            doc.text("3. Conclusões e Recomendações", 14, yPos);
            yPos += 7;

            doc.setFontSize(10);
            doc.setFont(undefined, 'normal');
            const splitConclusao = doc.splitTextToSize(conclusao, 180);
            doc.text(splitConclusao, 14, yPos);
            yPos += splitConclusao.length * 5 + 15;
        } else {
            yPos += 15;
        }

        // --- 5. ASSINATURAS ---
        if (yPos > 240) { doc.addPage(); yPos = 40; }

        const sigY = yPos + 10;
        doc.setLineWidth(0.5);
        doc.setDrawColor(0);

        // Assinatura 1 (Técnico)
        doc.line(20, sigY, 90, sigY);
        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        doc.text("Responsável Técnico", 55, sigY + 5, { align: 'center' });
        doc.setFont(undefined, 'normal');
        doc.text(tecnico, 55, sigY + 10, { align: 'center' });

        // Assinatura 2 (Cliente)
        doc.line(120, sigY, 190, sigY);
        doc.setFont(undefined, 'bold');
        doc.text("Recebido por (Cliente)", 155, sigY + 5, { align: 'center' });
        doc.setFont(undefined, 'normal');
        doc.text(cliente, 155, sigY + 10, { align: 'center' });


        // --- 6. ANEXOS / FOTOS ---
        const itemsWithPhotos = items.filter(i => i.imageFiles && i.imageFiles.length > 0);
        if (itemsWithPhotos.length > 0) {
            doc.addPage();
            doc.setTextColor(0);
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.text("Anexo: Relatório Fotográfico", 14, 20);

            let x = 14;
            let y = 30;
            const imgWidth = 85;
            const imgHeight = 85;
            const gap = 10;

            for (const item of itemsWithPhotos) {
                if (y + 10 > 280) { doc.addPage(); y = 20; }
                doc.setFontSize(10);
                doc.setFont(undefined, 'bold');
                doc.setFillColor(240);
                doc.rect(14, y - 4, 182, 6, 'F');

                const itemTitle = (item.type === 'geral')
                    ? `Item: Observação Geral`
                    : `Item: ${item.id} - ${item.andar} (${item.type.toUpperCase()})`;

                doc.text(itemTitle, 16, y);
                y += 5;

                for (let i = 0; i < item.imageFiles.length; i++) {
                    try {
                        const imgData = await readFileAsDataURL(item.imageFiles[i]);

                        if (y + imgHeight > 285) {
                            doc.addPage();
                            y = 20;
                            doc.text(`${itemTitle} (Continuação)`, 14, y - 5);
                        }

                        doc.addImage(imgData, 'JPEG', x, y, imgWidth, imgHeight);
                        doc.setDrawColor(200);
                        doc.rect(x, y, imgWidth, imgHeight);
                        doc.setFont(undefined, 'normal');
                        doc.setFontSize(8);
                        doc.text(`Foto ${i + 1}`, x, y + imgHeight + 4);

                        if (x === 14) {
                            x = 14 + imgWidth + gap;
                        } else {
                            x = 14;
                            y += imgHeight + 12;
                        }

                    } catch (err) { console.error("Erro img PDF", err); }
                }
                if (x > 14) {
                    x = 14;
                    y += imgHeight + 12;
                }
                y += 5;
            }
        }

        // --- SALVAR OU PREVIEW ---
        if (mode === 'save') {
            doc.save(`Relatorio_${cliente.replace(/\s+/g, '_')}.pdf`);
        } else {
            const blob = doc.output('bloburl');
            document.getElementById('pdf-frame').src = blob;
        }

    } catch (e) {
        console.error(e);
        if (mode === 'save') alert("Erro ao gerar PDF: " + e.message);
    } finally {
        if (mode === 'save') {
            btn.innerHTML = oldText;
            btn.disabled = false;
        }
    }
}