// js/signature-pad.js

export class SignaturePad {
    constructor(canvasId, clearBtnId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.clearBtn = document.getElementById(clearBtnId);
        this.isDrawing = false;

        // Ajusta tamanho do canvas para a tela
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());

        // Eventos de Mouse
        this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
        this.canvas.addEventListener('mousemove', (e) => this.draw(e));
        this.canvas.addEventListener('mouseup', () => this.stopDrawing());
        this.canvas.addEventListener('mouseout', () => this.stopDrawing());

        // Eventos de Toque (Celular)
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault(); // Impede rolagem da tela
            this.startDrawing(e);
        }, { passive: false });

        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            this.draw(e);
        }, { passive: false });

        this.canvas.addEventListener('touchend', () => this.stopDrawing());

        // Botão Limpar
        if (this.clearBtn) {
            this.clearBtn.addEventListener('click', () => this.clear());
        }
    }

    resizeCanvas() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = 200; // Altura fixa
        this.ctx.lineWidth = 2;
        this.ctx.lineCap = 'round';
        this.ctx.strokeStyle = '#000';
    }

    // CORREÇÃO AQUI: Pega a posição correta tanto do mouse quanto do toque na tela
    getPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        const clientY = e.clientY || (e.touches && e.touches[0].clientY);

        return {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    }

    startDrawing(e) {
        this.isDrawing = true;
        const pos = this.getPos(e);
        this.ctx.beginPath();
        this.ctx.moveTo(pos.x, pos.y);
    }

    draw(e) {
        if (!this.isDrawing) return;
        const pos = this.getPos(e);
        this.ctx.lineTo(pos.x, pos.y);
        this.ctx.stroke();
    }

    stopDrawing() {
        this.isDrawing = false;
        this.ctx.closePath();
    }

    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    isEmpty() {
        const blank = document.createElement('canvas');
        blank.width = this.canvas.width;
        blank.height = this.canvas.height;
        return this.canvas.toDataURL() === blank.toDataURL();
    }

    getImageData() {
        return this.isEmpty() ? null : this.canvas.toDataURL('image/png');
    }

    // NOVO MÉTODO: Carrega uma imagem Base64 de volta para o canvas
    fromDataURL(dataUrl) {
        if (!dataUrl) return;

        const img = new Image();
        img.onload = () => {
            this.clear(); // Limpa o canvas antes de desenhar a nova assinatura
            // Desenha a imagem restaurada no tamanho atual do canvas
            this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
        };
        img.src = dataUrl;
    }
}