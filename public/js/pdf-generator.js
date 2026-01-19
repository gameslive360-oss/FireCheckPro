// js/pdf-generator.js

/**
 * Converte arquivo para Base64
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
 * --- FUNÇÕES AUXILIARES DE DESIGN ---
 */

// Desenha um título de seção com fundo estilizado
const drawSectionHeader = (doc, title, y) => {
    // Fundo Cinza Claro
    doc.setFillColor(241, 245, 249); // Slate-100
    doc.rect(14, y, 182, 8, 'F');

    // Barra Lateral Azul Escuro (Accent)
    doc.setFillColor(15, 23, 42); // Slate-900
    doc.rect(14, y, 1.5, 8, 'F');

    // Texto
    doc.setTextColor(30, 41, 59); // Slate-800
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(title.toUpperCase(), 19, y + 5.5); // Texto alinhado verticalmente

    return y + 14; // Retorna nova posição Y com margem
};

// Adiciona numeração de página no final
const addPageNumbers = (doc) => {
    const pageCount = doc.internal.getNumberOfPages();
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(150);

    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.text(`Página ${i} de ${pageCount}`, 196, 285, { align: 'right' });
        doc.text("FireCheck Pro - Relatório Digital", 14, 285, { align: 'left' });
    }
};

/**
 * Função principal de geração
 */
export async function generatePDF(items, mode = 'save', signatures = {}) {
    const btn = document.getElementById('btn-pdf');
    let oldText = "";

    if (mode === 'save') {
        oldText = btn.innerHTML;
        btn.innerHTML = "Gerando Design...";
        btn.disabled = true;
    }

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // --- DADOS ---
        const cliente = document.getElementById('cliente').value || "CLIENTE NÃO INFORMADO";
        const local = document.getElementById('local').value || "";
        const tecnico = document.getElementById('resp-tecnico').value || "";
        const classificacao = document.getElementById('classificacao').value || "-";
        const dataRaw = document.getElementById('data-relatorio').value;
        let dataRelatorio = new Date().toLocaleString('pt-BR'); // Fallback padrão

        if (dataRaw) {
            // Verifica se é o formato novo com hora (YYYY-MM-DDTHH:MM)
            if (dataRaw.includes('T')) {
                const [datePart, timePart] = dataRaw.split('T');
                const [ano, mes, dia] = datePart.split('-');
                dataRelatorio = `${dia}/${mes}/${ano} às ${timePart}`;
            } else {
                // Caso seja formato antigo só data
                dataRelatorio = dataRaw.split('-').reverse().join('/');
            }
        }
        // --- CABEÇALHO PRINCIPAL (CAPA) ---
        // Fundo Azul Escuro Profundo
        doc.setFillColor(15, 23, 42); // Slate-900
        doc.rect(0, 0, 210, 50, 'F');

        // Título Principal
        doc.setTextColor(255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(18);
        doc.text("RELATÓRIO TÉCNICO DE VISTORIA", 105, 18, { align: 'center' });

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(148, 163, 184); // Slate-400
        doc.text("SISTEMAS DE PREVENÇÃO E COMBATE A INCÊNDIO", 105, 25, { align: 'center' });

        // Box de Informações do Cliente (Dentro do cabeçalho escuro)
        doc.setDrawColor(51, 65, 85); // Slate-700
        doc.setFillColor(30, 41, 59); // Slate-800
        doc.roundedRect(14, 32, 182, 14, 1, 1, 'FD');

        doc.setFontSize(9);
        doc.setTextColor(226, 232, 240); // Texto Claro

        // Linha 1
        doc.setFont('helvetica', 'bold');
        doc.text("CLIENTE:", 18, 38);
        doc.setFont('helvetica', 'normal');
        doc.text(cliente.substring(0, 35), 34, 38);

        doc.setFont('helvetica', 'normal');
        doc.text(dataRelatorio, 192, 38, { align: 'right' });

        const wData = doc.getTextWidth(dataRelatorio);

        doc.setFont('helvetica', 'bold');
        doc.text("DATA:", 192 - wData - 3, 38, { align: 'right' });

        // Linha 2
        doc.setFont('helvetica', 'bold');
        doc.text("LOCAL:", 18, 43);
        doc.setFont('helvetica', 'normal');
        doc.text(local.substring(0, 60), 34, 43);


        // --- PÁGINA 1: SUMÁRIO EXECUTIVO ---
        let yPos = 65; // Começa após o cabeçalho

        yPos = drawSectionHeader(doc, "1. Sumário Executivo", yPos);

        const parecer = document.getElementById('sum-parecer') ? document.getElementById('sum-parecer').value : '';
        const resumo = document.getElementById('sum-resumo') ? document.getElementById('sum-resumo').value : '';
        const riscos = document.getElementById('sum-riscos') ? document.getElementById('sum-riscos').value : '';

        // Box de Parecer (Status)
        let fillColor = [220, 252, 231]; // Verde
        let textColor = [22, 101, 52];
        let statusText = "SISTEMA APROVADO";

        if (parecer && parecer.includes("Restrições")) {
            fillColor = [254, 249, 195]; // Amarelo
            textColor = [133, 77, 14];
            statusText = "APROVADO COM RESTRIÇÕES";
        }
        if (parecer && parecer.includes("Reprovado")) {
            fillColor = [254, 226, 226]; // Vermelho
            textColor = [153, 27, 27];
            statusText = "SISTEMA REPROVADO / INOPERANTE";
        }

        doc.setFillColor(...fillColor);
        doc.setDrawColor(...textColor); // Borda da mesma cor do texto
        doc.roundedRect(14, yPos, 182, 12, 1, 1, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(...textColor);
        doc.text(statusText, 105, yPos + 7.5, { align: 'center' });
        yPos += 20;

        // Textos descritivos
        doc.setTextColor(30, 41, 59); // Slate-800

        if (resumo) {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.text("Resumo das Instalações", 14, yPos);
            yPos += 5;

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(10);
            const splitResumo = doc.splitTextToSize(resumo, 182);
            doc.text(splitResumo, 14, yPos);
            yPos += splitResumo.length * 5 + 10;
        }

        if (riscos) {
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(185, 28, 28); // Vermelho
            doc.text("Principais Não Conformidades / Riscos", 14, yPos);
            yPos += 5;

            doc.setFont('helvetica', 'normal');
            doc.setTextColor(30, 41, 59);
            const splitRiscos = doc.splitTextToSize(riscos, 182);
            doc.text(splitRiscos, 14, yPos);
        }

        // --- PÁGINA 2: TABELAS TÉCNICAS ---
        doc.addPage();
        yPos = 20;

        yPos = drawSectionHeader(doc, "2. Detalhamento Técnico (Checklists)", yPos);

        // Função de tabela aprimorada
        const generateTable = (title, data, headers, headColor) => {
            if (!data || data.length === 0) return;

            if (yPos > 240) { doc.addPage(); yPos = 20; }

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.setTextColor(71, 85, 105); // Slate-600
            doc.text(title, 14, yPos);
            yPos += 2;

            doc.autoTable({
                startY: yPos,
                head: [headers],
                body: data,
                theme: 'striped', // Tema listrado é mais profissional que grid simples
                headStyles: {
                    fillColor: headColor,
                    fontSize: 8,
                    fontStyle: 'bold',
                    halign: 'center'
                },
                bodyStyles: {
                    fontSize: 8,
                    textColor: 50
                },
                columnStyles: {
                    0: { cellWidth: 25, halign: 'center' }, // Local
                    1: { cellWidth: 20, halign: 'center' }, // ID
                    2: { halign: 'center' },                // <--- ADICIONE ISSO (Centraliza a 3ª coluna)
                    3: { halign: 'center' },                // (Opcional) Centraliza a Validade/Recarga também
                    4: { halign: 'center' }                 // (Opcional) Centraliza o Status/Abrigo
                },
                margin: { left: 14, right: 14 }
            });
            yPos = doc.lastAutoTable.finalY + 12;
        };

        // Geração das tabelas (Mesma lógica, estilo novo)
        // --- SUBSTITUA ESTE BLOCO NO SEU ARQUIVO ---

        const hid = items.filter(i => i.type === 'hidrante');
        generateTable("SISTEMA DE HIDRANTES", hid.map(i => {
            let faltantes = [];
            if (!i.check_registro) faltantes.push('Reg');
            if (!i.check_adaptador) faltantes.push('Adap');
            if (!i.check_chave) faltantes.push('Chv');
            if (!i.check_esguicho) faltantes.push('Esg');
            const statusComp = faltantes.length === 0 ? 'Completo' : 'Falta: ' + faltantes.join(',');

            // NOVA LÓGICA: Combina Lances + Metragem na mesma coluna
            const infoMangueira = i.tem_mangueira
                ? `${i.lances} lance(s) / ${i.metragem}`
                : 'S/ Mangueira';

            return [
                i.andar,
                i.id,
                i.tem_mangueira ? `${i.lances} lance(s)` : 'S/ Mangueira',
                i.tem_mangueira ? i.validade : '-',
                i.check_registro ? 'OK' : 'Falta',
                i.check_adaptador ? 'OK' : 'Falta',
                i.check_chave ? 'OK' : 'Falta',
                i.check_esguicho ? 'OK' : 'Falta',
                i.obs || '-' // Aqui fica SOMENTE a sua observação manual (ou traço se vazio)
            ];
        }),
            // Cabeçalho (9 colunas no total)
            ['Local', 'ID', 'Mangueira', 'Validade', 'Registro', 'Adaptador', 'Chave', 'Esguicho', 'Observações'],
            [51, 65, 85]);


        const ext = items.filter(i => i.type === 'extintor');
        generateTable("EXTINTORES DE INCÊNDIO", ext.map(i => [
            i.andar, i.id, i.tipo, `${i.peso} kg`, i.recarga,
            (i.check_lacre && i.check_manometro) ? 'OK' : 'Irregular', i.obs || '-'
        ]), ['Local', 'ID', 'Tipo', 'Capac.', 'Recarga', 'Visual', 'Observações'], [51, 65, 85]);

        const luz = items.filter(i => i.type === 'luz');
        generateTable("ILUMINAÇÃO DE EMERGÊNCIA", luz.map(i => [
            i.andar, i.id, i.tipo, i.estado, i.autonomia, i.obs || '-'
        ]), ['Local', 'ID', 'Tipo', 'Estado', 'Autonomia', 'Observações'], [51, 65, 85]);

        const sin = items.filter(i => i.type === 'sinalizacao');
        generateTable("SINALIZAÇÃO DE EMERGÊNCIA", sin.map(i => {
            let status = i.existente === 'Sim' ? 'Presente' : 'Ausente';
            return [i.andar, i.id, i.tipo || '-', status, i.obs || '-'];
        }), ['Local', 'ID', 'Tipo', 'Status', 'Observações'], [51, 65, 85]);

        const eletro = items.filter(i => i.type === 'eletro');
        generateTable("ELETROMECÂNICA / ALARME", eletro.map(i => {
            const manut = i.precisa_manutencao === 'Sim' ? 'SIM' : 'Não';
            return [i.andar, i.tipo_sistema, i.botoeiras, manut, i.obs || '-'];
        }), ['Local', 'Sistema', 'Acionador', 'Manut.', 'Observações'], [51, 65, 85]);

        const bombas = items.filter(i => i.type === 'bomba');
        generateTable("CONJUNTO DE BOMBAS", bombas.map(i => [
            i.andar, i.id, i.operacao ? 'Automático' : 'Manual/Off', i.teste_pressao ? 'OK' : 'Pend.', i.necessita_manutencao ? 'SIM' : 'Não', i.obs || '-'
        ]), ['Local', 'ID', 'Painel', 'Pressão', 'Manut.', 'Observações'], [51, 65, 85]);


        // --- PÁGINA 3: OBSERVAÇÕES GERAIS ---
        doc.addPage();
        yPos = 20;
        yPos = drawSectionHeader(doc, "3. Observações Gerais", yPos);

        const geral = items.filter(i => i.type === 'geral');
        if (geral.length > 0) {
            doc.autoTable({
                startY: yPos,
                head: [['Descrição da Ocorrência']],
                body: geral.map(i => [i.obs]),
                theme: 'striped',
                headStyles: { fillColor: [71, 85, 105] },
                margin: { left: 14, right: 14 }
            });
        } else {
            doc.setFont('helvetica', 'italic');
            doc.setTextColor(150);
            doc.text("Nenhuma ocorrência geral registrada.", 14, yPos + 10);
        }

        // --- PÁGINA 4: CONCLUSÃO ---
        doc.addPage();
        yPos = 20;
        yPos = drawSectionHeader(doc, "4. Parecer Técnico Final", yPos);

        const conclusao = document.getElementById('sum-conclusao') ? document.getElementById('sum-conclusao').value : '';

        if (conclusao) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(10);
            doc.setTextColor(30, 41, 59);
            const splitConclusao = doc.splitTextToSize(conclusao, 182);
            doc.text(splitConclusao, 14, yPos + 5);
        } else {
            doc.setFont('helvetica', 'italic');
            doc.setTextColor(150);
            doc.text("Sem considerações finais.", 14, yPos + 5);
        }

        // --- PÁGINA 5: ASSINATURAS ---
        doc.addPage();
        yPos = 60;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(30, 41, 59);
        doc.text("Validação do Relatório", 105, 40, { align: 'center' });

        const sigY = yPos + 40;
        doc.setLineWidth(0.5);
        doc.setDrawColor(148, 163, 184);

        // --- Assinatura 1: TÉCNICO ---
        // Se tiver imagem digital, insere ela
        if (signatures.tecnico) {
            doc.addImage(signatures.tecnico, 'PNG', 40, sigY - 20, 40, 20);
        }

        doc.line(30, sigY, 90, sigY); // Linha
        doc.setFontSize(10);
        doc.text("RESPONSÁVEL TÉCNICO", 60, sigY + 5, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(tecnico.toUpperCase(), 60, sigY + 10, { align: 'center' });

        // --- Assinatura 2: CLIENTE ---
        // Se tiver imagem digital, insere ela
        if (signatures.cliente) {
            doc.addImage(signatures.cliente, 'PNG', 130, sigY - 20, 40, 20);
        }

        doc.line(120, sigY, 180, sigY); // Linha
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text("CLIENTE / RESPONSÁVEL", 150, sigY + 5, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(cliente.toUpperCase(), 150, sigY + 10, { align: 'center' });

        // --- PÁGINA 6: FOTOS ---
        const itemsWithPhotos = items.filter(i => i.imageFiles && i.imageFiles.length > 0);
        const typeOrder = {
            'hidrante': 1,
            'extintor': 2,
            'luz': 3,
            'sinalizacao': 4,
            'eletro': 5,
            'bomba': 6,
            'geral': 7
        };

        itemsWithPhotos.sort((a, b) => {
            // 1. Ordena pelo Tipo (Para agrupar Hidrantes com Hidrantes, etc.)
            const orderA = typeOrder[a.type] || 99;
            const orderB = typeOrder[b.type] || 99;
            if (orderA !== orderB) return orderA - orderB;

            // 2. Ordena pelo ID de forma Crescente (Natural: H-2 vem antes de H-10)
            const idA = a.id || "";
            const idB = b.id || "";
            return idA.localeCompare(idB, undefined, { numeric: true, sensitivity: 'base' });
        });
        if (itemsWithPhotos.length > 0) {
            doc.addPage();
            yPos = 20;
            yPos = drawSectionHeader(doc, "Anexo: Relatório Fotográfico", yPos);

            let x = 14;
            let y = yPos + 5;
            const imgWidth = 85;
            const imgHeight = 85;
            const gap = 12;

            for (const item of itemsWithPhotos) {
                // Se não couber título + foto, nova página
                if (y + imgHeight + 20 > 280) { doc.addPage(); y = 20; }

                // Faixa cinza para o item da foto
                doc.setFillColor(241, 245, 249);
                doc.rect(14, y, 182, 6, 'F');

                doc.setFont('helvetica', 'bold');
                doc.setFontSize(8);
                doc.setTextColor(71, 85, 105);
                const label = item.type === 'geral' ? "OBSERVAÇÃO GERAL" : `${item.type.toUpperCase()} - ${item.id} (${item.andar})`;
                doc.text(label, 16, y + 4);

                y += 8;

                for (let i = 0; i < item.imageFiles.length; i++) {
                    try {
                        const imgData = await readFileAsDataURL(item.imageFiles[i]);

                        if (y + imgHeight > 280) { doc.addPage(); y = 20; }

                        doc.addImage(imgData, 'JPEG', x, y, imgWidth, imgHeight);
                        // Borda fina na foto
                        doc.setDrawColor(203, 213, 225);
                        doc.rect(x, y, imgWidth, imgHeight);

                        // Grid 2 colunas
                        if (x === 14) {
                            x = 14 + imgWidth + gap;
                        } else {
                            x = 14;
                            y += imgHeight + 10;
                        }
                    } catch (err) { console.error(err); }
                }

                // Reset de linha
                if (x > 14) { x = 14; y += imgHeight + 10; }
                y += 5; // Espaço extra entre itens
            }
        }

        // --- FINALIZAÇÃO ---
        addPageNumbers(doc);

        if (mode === 'save') {
            // Modo Salvar: Baixa direto
            doc.save(`Relatorio_${cliente.replace(/\s+/g, '_')}.pdf`);
        } else {
            // Modo Preview: Lógica inteligente para Mobile vs PC
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 1024;

            if (isMobile) {
                // NO CELULAR: Não tenta usar iframe. Abre direto ou baixa.

                // Opção A: Tenta abrir em nova aba (Funciona na maioria)
                const blob = doc.output('blob');
                const url = URL.createObjectURL(blob);
                window.open(url, '_blank');

                // Feedback na tela do app (para não ficar branco)
                const iframe = document.getElementById('pdf-frame');
                if (iframe) {
                    iframe.srcdoc = `
                        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;font-family:sans-serif;text-align:center;color:#475569;padding:20px;">
                            <h3 style="margin-bottom:10px;font-weight:bold;">Visualização Externa</h3>
                            <p>Em celulares, o PDF é aberto em uma nova aba ou baixado automaticamente.</p>
                            <p style="font-size:12px;margin-top:10px;color:#94a3b8;">Verifique suas notificações ou a aba ao lado.</p>
                        </div>
                    `;
                }

                // Fallback: Se o popup falhar, forçamos o download após 1 segundo
                setTimeout(() => {
                    doc.save(`Relatorio_${cliente.replace(/\s+/g, '_')}_PREVIA.pdf`);
                }, 1000);

            } else {
                // NO COMPUTADOR: Usa o iframe normalmente
                const blob = doc.output('bloburl');
                document.getElementById('pdf-frame').src = blob;
            }
        }

    } catch (e) {
        console.error(e);
        if (mode === 'save') alert("Erro: " + e.message);
    } finally {
        if (mode === 'save') {
            btn.innerHTML = oldText;
            btn.disabled = false;
        }
    }
}