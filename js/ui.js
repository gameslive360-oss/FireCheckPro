// js/ui.js

// 1. Sidebar Direita (Menu)
function toggleRightSidebar() {
    const sidebar = document.getElementById('right-sidebar');
    const backdrop = document.getElementById('backdrop');

    if (sidebar.classList.contains('translate-x-full')) {
        sidebar.classList.remove('translate-x-full');
        backdrop.classList.remove('hidden');
        // Pequeno delay para a animação do backdrop
        setTimeout(() => backdrop.classList.remove('opacity-0'), 10);

        // Chama a função de histórico se ela existir (carregada pelo app.js)
        if (window.loadHistory) window.loadHistory();
    } else {
        sidebar.classList.add('translate-x-full');
        backdrop.classList.add('opacity-0');
        setTimeout(() => backdrop.classList.add('hidden'), 300);
    }
}

// 2. Sidebar Esquerda (Navegação)
function toggleLeftSidebar() {
    const sidebar = document.getElementById('left-sidebar');
    const texts = document.querySelectorAll('.sidebar-text');
    const main = document.querySelector('main');
    const bottomBar = document.getElementById('bottom-bar');
    const backdrop = document.getElementById('backdrop');

    // Verifica se está expandido (baseado na largura)
    const isExpanded = sidebar.classList.contains('w-64');

    if (!isExpanded) {
        // EXPANDIR
        sidebar.classList.remove('w-16');
        sidebar.classList.add('w-64');

        // Mostrar textos com delay suave
        texts.forEach(el => {
            el.style.display = 'block';
            setTimeout(() => el.style.opacity = '1', 150);
        });

        // No mobile, usamos backdrop. No desktop, empurramos o conteúdo.
        if (window.innerWidth < 768) {
            backdrop.classList.remove('hidden');
            setTimeout(() => backdrop.classList.remove('opacity-0'), 10);
        } else {
            main.style.marginLeft = '16rem';
            bottomBar.style.paddingLeft = '17rem';
        }

    } else {
        // RECOLHER
        sidebar.classList.add('w-16');
        sidebar.classList.remove('w-64');

        texts.forEach(el => {
            el.style.opacity = '0';
        });

        if (window.innerWidth < 768) {
            backdrop.classList.add('opacity-0');
            setTimeout(() => backdrop.classList.add('hidden'), 300);
        } else {
            main.style.marginLeft = '4rem';
            bottomBar.style.paddingLeft = '4.5rem';
        }
    }
}

// 3. Fechar tudo ao clicar no fundo escuro
function closeAllSidebars() {
    const rightSidebar = document.getElementById('right-sidebar');
    const leftSidebar = document.getElementById('left-sidebar');
    const isLeftExpanded = leftSidebar.classList.contains('w-64');
    const isRightOpen = !rightSidebar.classList.contains('translate-x-full');

    if (isRightOpen) toggleRightSidebar();

    // Só fecha a esquerda no mobile (no desktop ela empurra o conteúdo)
    if (isLeftExpanded && window.innerWidth < 768) toggleLeftSidebar();
}

// Expor funções globalmente para funcionarem com o 'onclick' do HTML
window.toggleRightSidebar = toggleRightSidebar;
window.toggleLeftSidebar = toggleLeftSidebar;
window.closeAllSidebars = closeAllSidebars;