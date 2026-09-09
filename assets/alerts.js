(() => {
    const style = document.createElement('style');
    style.textContent = `
        .ow-alert-backdrop { align-items: center; background: rgba(2, 8, 15, .72); backdrop-filter: blur(8px); display: flex; inset: 0; justify-content: center; padding: 20px; position: fixed; z-index: 5000; }
        .ow-alert { background: linear-gradient(145deg, #102b3d, #081622); border: 1px solid rgba(85, 214, 210, .35); border-radius: 14px; box-shadow: 0 24px 80px rgba(0, 0, 0, .42); color: #e8f5f8; max-width: 440px; padding: 26px; width: 100%; }
        .ow-alert-mark { align-items: center; background: rgba(85, 214, 210, .12); border: 1px solid rgba(85, 214, 210, .28); border-radius: 50%; color: #55d6d2; display: flex; font-size: 1.1rem; height: 38px; justify-content: center; margin-bottom: 16px; width: 38px; }
        .ow-alert h2 { font-family: 'Space Grotesk', sans-serif; font-size: 1.25rem; margin: 0 0 8px; }
        .ow-alert p { color: #9fc0ca; line-height: 1.6; margin: 0 0 22px; white-space: pre-wrap; }
        .ow-alert button { background: #55d6d2; border: 0; border-radius: 7px; color: #07131f; cursor: pointer; font-weight: 700; padding: 10px 18px; }
        .ow-alert button:hover { background: #8ce8df; }
    `;
    document.head.appendChild(style);

    function show(message, options = {}) {
        const backdrop = document.createElement('div');
        backdrop.className = 'ow-alert-backdrop';
        backdrop.setAttribute('role', 'presentation');
        const dialog = document.createElement('section');
        dialog.className = 'ow-alert';
        dialog.setAttribute('role', 'alertdialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.innerHTML = `<div class="ow-alert-mark">${options.mark || '!'}</div><h2>${options.title || 'Oceanworks'}</h2><p></p><button type="button">${options.action || 'Okay'}</button>`;
        dialog.querySelector('p').textContent = String(message);
        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);
        const close = () => backdrop.remove();
        dialog.querySelector('button').addEventListener('click', close);
        backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });
        document.addEventListener('keydown', function escape(event) {
            if (event.key === 'Escape') { close(); document.removeEventListener('keydown', escape); }
        });
        dialog.querySelector('button').focus();
        return { close };
    }

    window.OceanworksAlert = { show };
})();
