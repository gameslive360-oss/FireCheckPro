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

const drawSectionHeader = (doc, title, y) => {
    doc.setFillColor(241, 245, 249); // Slate-100
    doc.rect(14, y, 182, 8, 'F');
    doc.setFillColor(15, 23, 42); // Slate-900 (Accent fixo)
    doc.rect(14, y, 1.5, 8, 'F');
    doc.setTextColor(30, 41, 59); // Slate-800
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(title.toUpperCase(), 19, y + 5.5);
    return y + 14;
};

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
        let yPos = 20;

        // --- DADOS DO FORMULÁRIO ---
        const cliente = document.getElementById('cliente').value || "CLIENTE NÃO INFORMADO";
        const local = document.getElementById('local').value || "";
        const tecnico = document.getElementById('resp-tecnico').value || "";
        const dataRaw = document.getElementById('data-relatorio').value;
        let dataRelatorio = new Date().toLocaleString('pt-BR');

        if (dataRaw) {
            if (dataRaw.includes('T')) {
                const [datePart, timePart] = dataRaw.split('T');
                const [ano, mes, dia] = datePart.split('-');
                dataRelatorio = `${dia}/${mes}/${ano} às ${timePart}`;
            } else {
                dataRelatorio = dataRaw.split('-').reverse().join('/');
            }
        }

        // CAPTURAR O NOVO CAMPO TIPO DE RELATÓRIO
        const tipoRelatorio = document.getElementById('tipo-relatorio')?.value || 'Relatório de Manutenção Preventiva';

        // --- NOVA CAPA (PÁGINA INTEIRA) ---
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();

        // Faixa superior de design (opcional, mantém a identidade visual)
        doc.setFillColor(15, 23, 42); // Azul escuro
        doc.rect(0, 0, pageWidth, 15, 'F');

        // Título Principal (O Tipo de Relatório selecionado)
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(15, 23, 42);
        const titleText = tipoRelatorio.toUpperCase();
        const titleWidth = doc.getTextWidth(titleText);
        doc.text(titleText, (pageWidth - titleWidth) / 2, 110);

        // Cliente
        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(71, 85, 105);
        const clientText = `Cliente: ${cliente}`;
        const clientWidth = doc.getTextWidth(clientText);
        doc.text(clientText, (pageWidth - clientWidth) / 2, 130);

        // Local
        if (local) {
            const localText = `Local: ${local}`;
            const localWidth = doc.getTextWidth(localText);
            doc.text(localText, (pageWidth - localWidth) / 2, 140);
        }

        // Data
        doc.setFontSize(10);
        const dateText = `Data da Vistoria: ${dataRelatorio}`;
        const dateWidth = doc.getTextWidth(dateText);
        doc.text(dateText, (pageWidth - dateWidth) / 2, 160);

        // Rodapé da Capa (Nome da Empresa)
        doc.setFontSize(12);
        doc.setTextColor(100, 116, 139);
        const empNome = "FireCheck Pro - Inspeções de Segurança";
        const empNomeWidth = doc.getTextWidth(empNome);
        doc.text(empNome, (pageWidth - empNomeWidth) / 2, pageHeight - 30);
        // --- FIM DA CAPA ---

        // --- PÁGINA 2: TABELAS TÉCNICAS ---
        doc.addPage();
        yPos = 20;

        // Como removemos o Sumário (que era o item 1), as tabelas passam a ser o item 1
        yPos = drawSectionHeader(doc, "1. Detalhamento Técnico (Checklists)", yPos);

        const sortById = (list) => list.sort((a, b) => String(a.id || "").localeCompare(String(b.id || ""), undefined, { numeric: true }));

        const generateTable = (title, data, headers, headColor, colStyles) => {
            if (!data || data.length === 0) return;
            if (yPos > 240) { doc.addPage(); yPos = 20; }
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.setTextColor(headColor[0], headColor[1], headColor[2]); // Título na cor da tabela
            doc.text(title, 14, yPos);

            doc.autoTable({
                startY: yPos + 2,
                head: [headers],
                body: data,
                theme: 'striped',
                headStyles: { fillColor: headColor, fontSize: 7, halign: 'center' },
                bodyStyles: { fontSize: 7, valign: 'middle' },
                columnStyles: colStyles,
                margin: { left: 14, right: 14 }
            });
            yPos = doc.lastAutoTable.finalY + 12;
        };

        // --- CONFIGURAÇÃO DE CORES PROFISSIONAIS (MUTED) ---
        const colors = {
            hidrantes: [30, 58, 138],   // Indigo Profundo
            extintores: [159, 18, 57],  // Rosa/Vinho Queimado
            bombas: [15, 23, 42],       // Slate Quase Preto
            alarmes: [180, 83, 9],      // Âmbar Escuro
            luz: [71, 85, 105],         // Slate Médio
            sinalizacao: [13, 148, 136] // Teal/Verde Água Profundo
        };

        // HIDRANTES
        const hid = sortById(items.filter(i => i.type === 'hidrante'));
        generateTable("SISTEMA DE HIDRANTES", hid.map(i => [
            i.andar, i.id, i.acionador_funcional ? 'OK' : 'N/A',
            i.tem_mangueira ? `${i.lances} lances` : 'Falta', i.validade || '-',
            i.check_registro ? 'OK' : 'Falta', i.check_adaptador ? 'OK' : 'Falta',
            i.check_chave ? 'OK' : 'Falta', i.check_esguicho ? 'OK' : 'Falta', i.obs || '-'
        ]), ['Local', 'ID', 'Acion.', 'Mang.', 'Val.', 'Reg.', 'Adap.', 'Chv.', 'Esg.', 'Obs.'], colors.hidrantes, {
            0: { cellWidth: 15 }, 1: { cellWidth: 12 }, 2: { cellWidth: 12 }, 3: { cellWidth: 18 }, 4: { cellWidth: 18 },
            5: { cellWidth: 12 }, 6: { cellWidth: 12 }, 7: { cellWidth: 12 }, 8: { cellWidth: 12 }, 9: { cellWidth: 'auto' }
        });

        // EXTINTORES
        const ext = sortById(items.filter(i => i.type === 'extintor'));
        generateTable("EXTINTORES DE INCÊNDIO", ext.map(i => [
            i.andar, i.id, i.tipo, `${i.peso}kg`, i.recarga, (i.check_lacre && i.check_manometro) ? 'OK' : 'Irreg.', i.obs || '-'
        ]), ['Local', 'ID', 'Tipo', 'Capac.', 'Validade', 'Visual', 'Observações'], colors.extintores, {
            0: { cellWidth: 20 }, 1: { cellWidth: 15 }, 2: { cellWidth: 20 }, 3: { cellWidth: 15 }, 4: { cellWidth: 25 }, 5: { cellWidth: 15 }, 6: { cellWidth: 'auto' }
        });

        // BOMBAS
        const bombas = sortById(items.filter(i => i.type === 'bomba'));
        generateTable("CONJUNTO DE BOMBAS", bombas.map(i => [
            i.andar, i.id, i.operacao ? 'Auto' : 'Manual', i.teste_pressao ? 'OK' : 'Pend.', i.necessita_manutencao ? 'SIM' : 'Não', i.obs || '-'
        ]), ['Local', 'ID', 'Painel', 'Pressão', 'Manut.', 'Observações'], colors.bombas, {
            0: { cellWidth: 25 }, 1: { cellWidth: 20 }, 2: { cellWidth: 25 }, 3: { cellWidth: 25 }, 4: { cellWidth: 20 }, 5: { cellWidth: 'auto' }
        });

        // ALARMES
        const alarmes = sortById(items.filter(i => i.type === 'alarme'));
        generateTable("SISTEMA DE DETECÇÃO E ALARME", alarmes.map(i => [
            i.id, i.status || 'Operante', i.tipo_eq, i.andar, i.obs || '-'
        ]), ['ID', 'Status', 'Equipamento', 'Local', 'Mensagem Central'], colors.alarmes, {
            0: { cellWidth: 15 }, 1: { cellWidth: 25 }, 2: { cellWidth: 35 }, 3: { cellWidth: 25 }, 4: { cellWidth: 'auto' }
        });

        // ILUMINAÇÃO
        const luz = sortById(items.filter(i => i.type === 'luz'));
        generateTable("ILUMINAÇÃO DE EMERGÊNCIA", luz.map(i => [
            i.andar, i.id, i.tipo, i.estado, i.autonomia, i.obs || '-'
        ]), ['Local', 'ID', 'Tipo', 'Estado', 'Autonomia', 'Observações'], colors.luz, {
            0: { cellWidth: 25 }, 1: { cellWidth: 20 }, 2: { cellWidth: 25 }, 3: { cellWidth: 20 }, 4: { cellWidth: 25 }, 5: { cellWidth: 'auto' }
        });

        // SINALIZAÇÃO
        const sin = sortById(items.filter(i => i.type === 'sinalizacao'));
        generateTable("SINALIZAÇÃO DE EMERGÊNCIA", sin.map(i => [
            i.andar, i.id, i.tipo || '-', i.existente === 'Sim' ? 'Presente' : 'Ausente', i.obs || '-'
        ]), ['Local', 'ID', 'Tipo', 'Status', 'Observações'], colors.sinalizacao, {
            0: { cellWidth: 25 }, 1: { cellWidth: 20 }, 2: { cellWidth: 40 }, 3: { cellWidth: 25 }, 4: { cellWidth: 'auto' }
        });

        // --- PÁGINAS FINAIS ---
        doc.addPage();
        yPos = drawSectionHeader(doc, "3. Observações Gerais e Conclusão", 20);
        const geral = items.filter(i => i.type === 'geral');
        if (geral.length > 0) {
            doc.autoTable({ startY: yPos, head: [['Relato de Ocorrências']], body: geral.map(i => [i.obs]), theme: 'striped', margin: { left: 14, right: 14 } });
            yPos = doc.lastAutoTable.finalY + 10;
        }

        const conclusao = document.getElementById('sum-conclusao')?.value || 'Sem considerações adicionais.';
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text(doc.splitTextToSize(conclusao, 182), 14, yPos);

        doc.addPage();
        doc.setFont('helvetica', 'bold');
        doc.text("Validação do Relatório", 105, 40, { align: 'center' });
        const sigY = 100;
        doc.setDrawColor(148, 163, 184);

        if (signatures.tecnico) doc.addImage(signatures.tecnico, 'PNG', 40, sigY - 25, 40, 20);
        doc.line(30, sigY, 90, sigY);
        doc.text("RESPONSÁVEL TÉCNICO", 60, sigY + 5, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.text(tecnico.toUpperCase(), 60, sigY + 10, { align: 'center' });

        if (signatures.cliente) doc.addImage(signatures.cliente, 'PNG', 130, sigY - 25, 40, 20);
        doc.line(120, sigY, 180, sigY);
        doc.setFont('helvetica', 'bold');
        doc.text("CLIENTE / RESPONSÁVEL", 150, sigY + 5, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.text(cliente.toUpperCase(), 150, sigY + 10, { align: 'center' });

        // --- RELATÓRIO FOTOGRÁFICO ---
        const itemsWithPhotos = items.filter(i => i.imageFiles?.length > 0);
        if (itemsWithPhotos.length > 0) {
            doc.addPage();
            yPos = drawSectionHeader(doc, "Anexo: Relatório Fotográfico", 20);
            let x = 14, y = yPos + 5;
            const imgSize = 58, gap = 4;

            for (const item of itemsWithPhotos) {
                if (y + imgSize > 270) { doc.addPage(); y = 20; }
                doc.setFillColor(241, 245, 249);
                doc.rect(14, y, 182, 6, 'F');
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(8);
                doc.text(`${item.type.toUpperCase()} - ${item.id || ''} (${item.andar})`, 16, y + 4);
                y += 8;

                for (const file of item.imageFiles) {
                    try {
                        const imgData = await readFileAsDataURL(file);
                        if (y + imgSize > 280) { doc.addPage(); y = 20; x = 14; }
                        doc.addImage(imgData, 'JPEG', x, y, imgSize, imgSize);
                        doc.rect(x, y, imgSize, imgSize);
                        x += imgSize + gap;
                        if (x > 180) { x = 14; y += imgSize + 5; }
                    } catch (e) { console.error(e); }
                }
                x = 14; y += imgSize + 10;
            }
        }

        addPageNumbers(doc);
        if (mode === 'save') {
            doc.save(`Relatorio_${cliente.replace(/\s+/g, '_')}.pdf`);
        } else {
            const blob = doc.output('bloburl');
            document.getElementById('pdf-frame').src = blob;
        }

    } catch (e) {
        console.error(e);
        alert("Erro ao gerar PDF: " + e.message);
    } finally {
        if (mode === 'save') {
            btn.innerHTML = oldText;
            btn.disabled = false;
        }
    }
}