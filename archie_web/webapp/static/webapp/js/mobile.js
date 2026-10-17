// Mobile drawer wiring.
// On phones the two sidebars are off-canvas drawers (see custom.css). This
// module connects the fixed top-bar buttons and the scrim to the existing
// desktop toggle functions, and keeps the backdrop in sync with drawer state.
(function () {
    const MOBILE_BREAKPOINT = 768;
    const isMobile = () => window.innerWidth <= MOBILE_BREAKPOINT;

    document.addEventListener('DOMContentLoaded', () => {
        const leftBtn = document.getElementById('mobile-open-chats');
        const rightBtn = document.getElementById('mobile-open-apps');
        const scrim = document.getElementById('mobile-scrim');
        const left = document.getElementById('left-sidebar');
        const right = document.getElementById('right-sidebar');
        const chatView = document.getElementById('chat-view');
        if (!left || !right) return;

        // A drawer is "open" once the toggle logic has expanded it (w-72).
        const isOpen = (el) => el.classList.contains('w-72');

        // Reflect combined drawer state onto <body> so the scrim can react.
        const syncScrim = () => {
            const open = isOpen(left) || isOpen(right);
            document.body.classList.toggle('drawer-open', open);
        };

        // Sidebar classes are mutated from several call sites (toggle buttons,
        // nav delegation, chat selection). Observing them keeps the scrim
        // correct without having to touch every one of those places.
        const observer = new MutationObserver(syncScrim);
        observer.observe(left, { attributes: true, attributeFilter: ['class'] });
        observer.observe(right, { attributes: true, attributeFilter: ['class'] });

        leftBtn?.addEventListener('click', () => {
            if (isOpen(right)) toggleRightSidebar(true);
            // The chat list only makes sense over the chat view.
            if (chatView && chatView.classList.contains('hidden') &&
                typeof window.showChatView === 'function') {
                window.showChatView();
            }
            toggleLeftSidebar();
        });

        rightBtn?.addEventListener('click', () => {
            if (isOpen(left)) toggleLeftSidebar(true);
            toggleRightSidebar();
        });

        scrim?.addEventListener('click', () => {
            if (isOpen(left)) toggleLeftSidebar(true);
            if (isOpen(right)) toggleRightSidebar(true);
        });

        // Picking a conversation (or any link) in the left drawer closes it.
        left.addEventListener('click', (e) => {
            if (!isMobile()) return;
            if (e.target.closest('a') && isOpen(left)) {
                toggleLeftSidebar(true);
            }
        });

        // Back on a wide viewport the drawers no longer overlay — drop the scrim.
        window.addEventListener('resize', () => {
            if (!isMobile()) document.body.classList.remove('drawer-open');
        });
    });
})();
