# 🔥 FireCheck Pro - Vistoria de Segurança Contra Incêndio (PWA)

**FireCheck Pro** é um **Progressive Web App (PWA)** desenvolvido para facilitar a inspeção mensal e anual de equipamentos de segurança contra incêndio.  
Permite **coleta de dados offline**, **registro fotográfico** e **geração automática de relatórios técnicos em PDF**, seguindo rigorosamente as **normas brasileiras (ABNT NBR)**.

---

## 📋 Funcionalidades Principais

| Ícone | Funcionalidade | Descrição |
|------|---------------|-----------|
| 📱 | **PWA (Progressive Web App)** | Instalável no celular, funciona offline e com aparência nativa |
| ☁️ | **Sincronização em Nuvem** | Integração com Firebase Firestore (dados) e Storage (fotos) |
| 🔐 | **Autenticação Segura** | Login via Google Auth para identificar o inspetor responsável |
| 📄 | **Relatórios Automáticos** | Geração de PDF no próprio dispositivo (client-side) com tabelas por sistema |
| 📷 | **Registro Fotográfico** | Upload inteligente com suporte à câmera ou galeria |

---

## ✅ Normas Técnicas Atendidas

O sistema valida os itens de inspeção com base nos checklists das seguintes normas:

| Equipamento | Norma ABNT | Verificações Principais |
|------------|-----------|-------------------------|
| **Hidrantes** | NBR 13485 | Abrigo, mangueiras (aduchamento), esguicho, chave storz e válvulas |
| **Extintores** | NBR 12962 | Nível 1 (Lacre, manômetro, sinalização), Nível 2 (Recarga) e Nível 3 (Teste Hidrostático) |
| **Iluminação de Emergência** | NBR 10898 | Funcionamento, autonomia da bateria (>1h), LED piloto e fixação |

---

## 🛠️ Stack Tecnológica

- **Frontend:** HTML5 Semântico, JavaScript (ES6 Modules), CSS3  
- **Estilização:** Tailwind CSS (via CDN)  
- **Backend as a Service:** Firebase (Authentication, Firestore, Storage, Hosting)  
- **Geração de PDF:** `jspdf` e `jspdf-autotable`  
- **Ícones:** `lucide-icons`

---

## 🚀 Como Rodar o Projeto

### Pré-requisitos

- Conta Google (para criar o projeto no Firebase)
- Node.js instalado *(opcional – para servidor local ou deploy)*

---

### 🔧 Configuração Passo a Passo

#### 1️⃣ Clone o repositório

```bash
git clone https://github.com/gameslive360-oss/firecheck-pro.git
cd firecheck-pro
```

## 🔧 Configuração do Firebase

### 2️⃣ Configure o Firebase

- Crie um projeto no **Console do Firebase**
- Habilite **Authentication** (Provedor Google)
- Crie um banco de dados **Firestore**
- Crie um **Storage Bucket**
- Copie as credenciais do **App Web**

---

### 3️⃣ Adicione as Chaves

Crie ou renomeie o arquivo:

```text
public/js/firebase-config.js
```
### Adicione as credenciais no formato abaixo:

```javascript
export const firebaseConfig = {
  apiKey: "SUA_API_KEY",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```
### 4️⃣ Execute Localmente

**Opção 1 (Recomendada):**
 - Utilize a extensão Live Server do VS Code
**Opção 2 (Firebase CLI):**
```bash
firebase serve
```
**Opção 3 (Servidor estático):**
```bash
python -m http.server
```
### 📁 Estrutura de Pastas

```text
/public
├── css/              # Estilos personalizados
├── js/               # Lógica da aplicação (app.js, firebase-config.js)
├── index.html        # Interface principal
├── manifest.json     # Configuração PWA
└── sw.js             # Service Worker (Cache / Offline)
```
