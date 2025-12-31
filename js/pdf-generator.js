// js/pdf-generator.js

/**
 * Converte arquivo para Base64 (necessário para imagens no PDF)
 */
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
 */
export async function generatePDF(items, mode = 'save') {
    // Permite gerar PDF vazio se o usuário quiser ver apenas a estrutura
    // if (items.length === 0 && mode === 'save') return alert("Lista vazia..."); 

    const btn = document.getElementById('btn-pdf');
    let oldText = "";

    if (mode === 'save') {
        oldText = btn.innerHTML;
        btn.innerHTML = "Processando...";
        btn.disabled = true;
    }

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // --- DADOS DO CABEÇALHO ---
        const cliente = document.getElementById('cliente').value || "Não Informado";
        const local = document.getElementById('local').value || "Não Informado";
        const tecnico = document.getElementById('resp-tecnico').value || "Não Informado";
        const classificacao = document.getElementById('classificacao').value || "-";

        const dataRaw = document.getElementById('data-relatorio').value;
        const dataRelatorio = dataRaw ? dataRaw.split('-').reverse().join('/') : new Date().toLocaleDateString();
        const avcbRaw = document.getElementById('validade-avcb').value;
        const dataAvcb = avcbRaw ? avcbRaw.split('-').reverse().join('/') : "-";

        // Função auxiliar para desenhar o Cabeçalho (pode ser repetido se quiser, aqui desenhamos só na capa)
        const drawHeader = () => {
            doc.setFillColor(30, 41, 59); // Slate 800
            doc.rect(0, 0, 210, 45, 'F');
            doc.setTextColor(255);
            doc.setFontSize(16);
            doc.setFont(undefined, 'bold');
            doc.text("RELATÓRIO TÉCNICO DE VISTORIA", 105, 15, { align: 'center' });
            doc.setFontSize(10);
            doc.setFont(undefined, 'normal');
            doc.text("Sistemas de Prevenção e Combate a Incêndio", 105, 22, { align: 'center' });

            doc.setFontSize(9);
            doc.text(`Cliente: ${cliente}`, 14, 32);
            doc.text(`Local: ${local}`, 14, 37);
            doc.text(`Resp. Técnico: ${tecnico}`, 110, 32);
            doc.text(`Classificação: ${classificacao}`, 110, 37);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(147, 197, 253);
            doc.text(`Data: ${dataRelatorio}`, 175, 32);
            doc.text(`AVCB: ${dataAvcb}`, 175, 37);
        };

        // --- PÁGINA 1: CAPA E SUMÁRIO ---
        drawHeader();
        let yPos = 55;

        const parecer = document.getElementById('sum-parecer') ? document.getElementById('sum-parecer').value : '';
        const resumo = document.getElementById('sum-resumo') ? document.getElementById('sum-resumo').value : '';
        const riscos = document.getElementById('sum-riscos') ? document.getElementById('sum-riscos').value : '';

        doc.setTextColor(0);
        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.text("1. Sumário Executivo", 14, yPos);
        yPos += 10;

        // Parecer (Sempre desenha, mesmo se vazio mostra status padrão)
        let corParecer = [220, 252, 231];
        if (parecer && parecer.includes("Restrições")) corParecer = [254, 249, 195];
        if (parecer && parecer.includes("Reprovado")) corParecer = [254, 226, 226];

        doc.setFillColor(...corParecer);
        doc.roundedRect(14, yPos, 182, 10, 1, 1, 'F');
        doc.setFontSize(10);
        doc.setTextColor(30);
        doc.text(`Situação: ${(parecer || "NÃO AVALIADO").toUpperCase()}`, 105, yPos + 6.5, { align: 'center' });
        yPos += 20;

        // Resumo e Riscos (Textos)
        doc.setTextColor(0);
        if (resumo) {
            doc.setFont(undefined, 'bold');
            doc.text("Resumo das Instalações:", 14, yPos);
            yPos += 5;
            doc.setFont(undefined, 'normal');
            const splitResumo = doc.splitTextToSize(resumo, 180);
            doc.text(splitResumo, 14, yPos);
            yPos += splitResumo.length * 5 + 10;
        } else {
            doc.setFont(undefined, 'italic');
            doc.setTextColor(150);
            doc.text("(Sem resumo informado)", 14, yPos);
            yPos += 15;
        }

        if (riscos) {
            doc.setFont(undefined, 'bold');
            doc.setTextColor(185, 28, 28);
            doc.text("Principais Não Conformidades:", 14, yPos);
            yPos += 5;
            doc.setFont(undefined, 'normal');
            doc.setTextColor(0);
            const splitRiscos = doc.splitTextToSize(riscos, 180);
            doc.text(splitRiscos, 14, yPos);
        } else {
            // Deixa espaço vazio se não tiver riscos
        }


        // --- PÁGINA 2: TABELAS TÉCNICAS ---
        doc.addPage(); // <--- FORÇA PÁGINA NOVA
        yPos = 20; // Reseta topo

        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(0);
        doc.text("2. Detalhamento Técnico (Tabelas)", 14, yPos);
        yPos += 10;

        // Helper de Tabela
        const generateTable = (title, data, headers, color) => {
            if (!data || data.length === 0) return;

            // Verifica espaço na página atual
            if (yPos > 260) { doc.addPage(); yPos = 20; }

            doc.setFontSize(11);
            doc.setFont(undefined, 'bold');
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

        // Gerar tabelas apenas dos itens técnicos (excluindo Geral)
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

        const ext = items.filter(i => i.type === 'extintor');
        generateTable("Extintores", ext.map(i => [
            i.andar, i.id, i.tipo, i.peso, i.recarga,
            (i.check_lacre && i.check_manometro) ? 'OK' : 'Verificar', i.obs || '-'
        ]), ['Local', 'ID', 'Tipo', 'Peso', 'Recarga', 'Status', 'Obs'], [220, 38, 38]);

        const luz = items.filter(i => i.type === 'luz');
        generateTable("Iluminação de Emergência", luz.map(i => [
            i.andar, i.id, i.tipo, i.estado, i.autonomia, i.obs || '-'
        ]), ['Local', 'ID', 'Tipo', 'Estado', 'Autonomia', 'Obs'], [217, 119, 6]);

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

        const eletro = items.filter(i => i.type === 'eletro');
        generateTable("Sistemas Eletromecânicos", eletro.map(i => {
            const manut = i.precisa_manutencao === 'Sim' ? 'SIM' : 'Não';
            return [i.andar, i.tipo_sistema, i.botoeiras, manut, i.obs || '-'];
        }), ['Local', 'Sistema', 'Botoeira', 'Manutenção', 'Obs'], [79, 70, 229]);

        const bombas = items.filter(i => i.type === 'bomba');
        generateTable("Bombas de Incêndio", bombas.map(i => [
            i.andar, i.id, i.operacao ? 'Auto' : 'Manual/Off', i.teste_pressao ? 'Sim' : 'Não', i.necessita_manutencao ? 'SIM' : 'Não', i.obs || '-'
        ]), ['Local', 'ID', 'Modo', 'Teste', 'Manut.', 'Obs'], [124, 58, 237]);


        // --- PÁGINA 3: OBSERVAÇÕES GERAIS ---
        doc.addPage(); // <--- FORÇA PÁGINA NOVA
        yPos = 20;

        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(0);
        doc.text("3. Observações Gerais", 14, yPos);
        yPos += 10;

        const geral = items.filter(i => i.type === 'geral');

        if (geral.length > 0) {
            // Se tiver observações, cria a tabela
            generateTable("", geral.map(i => [i.obs || '-']), ['Descrição da Ocorrência'], [71, 85, 105]);
        } else {
            // Se NÃO tiver, escreve mensagem placeholder
            doc.setFontSize(11);
            doc.setFont(undefined, 'italic');
            doc.setTextColor(150);
            doc.text("Nenhuma observação geral registrada para esta vistoria.", 14, yPos);
        }


        // --- PÁGINA 4: CONCLUSÕES ---
        doc.addPage(); // <--- FORÇA PÁGINA NOVA
        yPos = 20;

        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(0);
        doc.text("4. Conclusões e Recomendações Finais", 14, yPos);
        yPos += 15;

        const conclusao = document.getElementById('sum-conclusao') ? document.getElementById('sum-conclusao').value : '';

        doc.setFontSize(11);
        doc.setFont(undefined, 'normal');

        if (conclusao) {
            const splitConclusao = doc.splitTextToSize(conclusao, 180);
            doc.text(splitConclusao, 14, yPos);
        } else {
            doc.setFont(undefined, 'italic');
            doc.setTextColor(150);
            doc.text("Campo de conclusões não preenchido.", 14, yPos);
        }


        // --- PÁGINA 5: ASSINATURAS ---
        doc.addPage(); // <--- FORÇA PÁGINA NOVA
        yPos = 60; // Desce um pouco para centralizar na folha

        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(0);
        doc.text("Assinaturas", 105, 40, { align: 'center' });

        const sigY = yPos + 30;
        doc.setLineWidth(0.5);
        doc.setDrawColor(0);

        // Assinatura 1 (Técnico)
        doc.line(30, sigY, 90, sigY);
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text("Responsável Técnico", 60, sigY + 5, { align: 'center' });
        doc.setFont(undefined, 'normal');
        doc.text(tecnico, 60, sigY + 10, { align: 'center' });

        // Assinatura 2 (Cliente)
        doc.line(120, sigY, 180, sigY);
        doc.setFont(undefined, 'bold');
        doc.text("Recebido por (Cliente)", 150, sigY + 5, { align: 'center' });
        doc.setFont(undefined, 'normal');
        doc.text(cliente, 150, sigY + 10, { align: 'center' });

        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(`Documento gerado em: ${new Date().toLocaleString()}`, 105, 280, { align: 'center' });


        // --- PÁGINA 6+: ANEXOS / FOTOS ---
        const itemsWithPhotos = items.filter(i => i.imageFiles && i.imageFiles.length > 0);
        if (itemsWithPhotos.length > 0) {
            doc.addPage(); // <--- FORÇA PÁGINA NOVA
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
                // Título do item (Mini cabeçalho antes da foto)
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

                        // Verifica se a foto cabe na página, senão cria nova
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

                        // Lógica de 2 colunas
                        if (x === 14) {
                            x = 14 + imgWidth + gap;
                        } else {
                            x = 14;
                            y += imgHeight + 12;
                        }

                    } catch (err) { console.error("Erro img PDF", err); }
                }
                // Reseta X para esquerda e desce o cursor se a linha ficou incompleta
                if (x > 14) {
                    x = 14;
                    y += imgHeight + 12;
                }
                y += 5;
            }
        }

        // --- FINALIZAÇÃO ---
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