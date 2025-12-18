🛡️ FireCheck Pro - Vistoria de Segurança Contra Incêndio (PWA)

Um Progressive Web App (PWA) desenvolvido para facilitar a inspeção mensal e anual de equipamentos de segurança contra incêndio. O sistema permite coleta de dados offline, registro fotográfico e geração automática de relatórios técnicos em PDF, seguindo rigorosamente as normas brasileiras (ABNT NBR).

📋 Funcionalidades Principais

📱 PWA (Progressive Web App): Instalável no celular, funciona offline e com aparência nativa.

☁️ Sincronização em Nuvem: Integração com Firebase Firestore para salvar vistorias e Firebase Storage para fotos.

🔐 Autenticação Segura: Login via Google Auth para identificar o inspetor responsável.

📄 Relatórios Automáticos: Geração de PDF no próprio dispositivo (Client-side) com tabelas separadas por sistema.

📷 Registro Fotográfico: Upload inteligente com suporte a captura direta da câmera ou seleção da galeria.

✅ Normas Técnicas Atendidas

O sistema valida os itens de inspeção baseado nos checklists das seguintes normas:

Equipamento

Norma ABNT

Verificações

Hidrantes

NBR 13485

Abrigo, mangueiras (aduchamento), esguicho, chave storz e válvulas.

Extintores

NBR 12962

Nível 1 (Lacre, manômetro, sinalização), Nível 2 (Recarga) e Nível 3 (Teste Hidrostático).

Iluminação

NBR 10898

Teste de funcionamento, autonomia de bateria (>1h), LED piloto e fixação.

🛠️ Tecnologias Utilizadas

Frontend: HTML5 Semântico, JavaScript (ES6 Modules), CSS3.

Estilização: Tailwind CSS (Via CDN para agilidade no MVP).

Backend as a Service: Firebase (Auth, Firestore, Storage, Hosting).

Geração de PDF: jspdf e jspdf-autotable.

Ícones: lucide-icons.

🚀 Como Rodar o Projeto

Pré-requisitos

Uma conta no Google (para criar o projeto no Firebase).

Node.js instalado (apenas para rodar o servidor local ou deploy).

Passo a Passo

Clone o repositório:

git clone [https://github.com/SEU-USUARIO/firecheck-pro.git](https://github.com/SEU-USUARIO/firecheck-pro.git)
cd firecheck-pro


Configure o Firebase:

Crie um projeto no Console do Firebase.

Habilite Authentication (Google Provider).

Crie um banco Firestore e um bucket Storage.

Copie suas credenciais web.

Adicione as Chaves:

Renomeie ou crie o arquivo public/js/firebase-config.js.

Cole suas credenciais:

export const firebaseConfig = {
    apiKey: "SUA_API_KEY",
    authDomain: "...",
    projectId: "...",
    storageBucket: "...",
    messagingSenderId: "...",
    appId: "..."
};


Execute Localmente:
Se tiver o firebase-tools instalado:

firebase serve


Ou use qualquer servidor estático (Live Server do VSCode, Python SimpleHTTPServer, etc).

📱 Estrutura de Pastas

/public
  ├── css/            # Estilos personalizados
  ├── js/             # Lógica da aplicação (app.js, firebase-config.js)
  ├── index.html      # Interface principal
  ├── manifest.json   # Configuração PWA
  └── sw.js           # Service Worker (Cache/Offline)


🤝 Contribuição

Contribuições são bem-vindas! Sinta-se à vontade para abrir Issues ou enviar Pull Requests para melhorias nos checklists ou novas funcionalidades.

📄 Licença

Este projeto está sob a licença MIT. Veja o arquivo LICENSE para mais detalhes.
