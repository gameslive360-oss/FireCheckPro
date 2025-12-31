/**
 * Comprime e redimensiona uma imagem no navegador via Canvas.
 * @param {File} file - O arquivo de imagem original.
 * @param {number} quality - Qualidade de 0 a 1 (padrão 0.7).
 * @param {number} maxWidth - Largura máxima em pixels (padrão 1200).
 * @returns {Promise<File>} - Retorna uma Promise com o novo arquivo comprimido.
 */
export async function compressImage(file, quality = 0.7, maxWidth = 1200) {
    // Se não for imagem, retorna o original
    if (!file.type.match(/image.*/)) return file;

    return new Promise((resolve, reject) => {
        const img = new Image();
        const reader = new FileReader();

        reader.onload = (e) => {
            img.src = e.target.result;
        };
        reader.onerror = (err) => reject(err);

        img.onload = () => {
            // 1. Calcular novas dimensões mantendo proporção
            let width = img.width;
            let height = img.height;

            if (width > maxWidth) {
                height = Math.round(height * (maxWidth / width));
                width = maxWidth;
            }

            // 2. Criar Canvas e desenhar imagem redimensionada
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // 3. Converter Canvas para Blob (JPEG)
            canvas.toBlob(
                (blob) => {
                    if (!blob) {
                        reject(new Error("Falha na compressão da imagem"));
                        return;
                    }

                    // Recria o objeto File com os dados comprimidos
                    const compressedFile = new File([blob], file.name, {
                        type: 'image/jpeg',
                        lastModified: Date.now(),
                    });

                    resolve(compressedFile);
                },
                'image/jpeg',
                quality
            );
        };

        // Inicia leitura
        reader.readAsDataURL(file);
    });
}