// Arquivo: public/js/cloudinary-manager.js

/**
 * Faz o upload de uma imagem para o Cloudinary (Sem precisar de servidor/backend).
 * @param {File|Blob} file - O arquivo de imagem comprimido.
 * @returns {Promise<string|null>} - Retorna o link (URL) da imagem salva ou null se der erro.
 */
export async function uploadToCloudinary(file) {
    // ⚠️ SUBSTITUA PELOS SEUS DADOS DO CLOUDINARY:
    const cloudName = 'dviqtpd2c';
    const uploadPreset = 'firecheck';

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);

    try {
        const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Erro na API do Cloudinary: ${response.statusText}`);
        }

        const data = await response.json();
        return data.secure_url; // Link HTTPS gerado pelo Cloudinary

    } catch (error) {
        console.error("Erro no upload do Cloudinary:", error);
        return null;
    }
}