(() => {
    const clientId = '1530208568392028302';
    const ownerPanelPath = '/ocean-one/owner-panel/';
    const tokenKey = 'discord_token';
    const returnKey = 'auth_return';

    function currentReturnPath() {
        return `${window.location.pathname}${window.location.search}${window.location.hash}`;
    }

    function login() {
        const returnPath = currentReturnPath();
        sessionStorage.setItem(returnKey, returnPath);
        const authUrl = new URL('https://discord.com/api/oauth2/authorize');
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', `${window.location.origin}${ownerPanelPath}`);
        authUrl.searchParams.set('response_type', 'token');
        authUrl.searchParams.set('scope', 'identify guilds');
        authUrl.searchParams.set('state', returnPath);
        window.location.assign(authUrl.toString());
    }

    function logout() {
        sessionStorage.removeItem(tokenKey);
        window.location.reload();
    }

    function setProfile(user) {
        document.querySelectorAll('.auth-link').forEach((link) => {
            link.classList.add('auth-profile');
            link.href = '#';
            link.title = 'Sign out of Discord';
            link.innerHTML = '';

            const avatar = document.createElement('img');
            avatar.className = 'auth-avatar';
            avatar.alt = '';
            avatar.src = user.avatar
                ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
                : `https://cdn.discordapp.com/embed/avatars/${Number(user.id) % 5}.png`;

            const name = document.createElement('span');
            name.textContent = user.global_name || user.username;
            link.append(avatar, name);
            link.addEventListener('click', (event) => {
                event.preventDefault();
                logout();
            }, { once: true });
        });
    }

    async function loadProfile() {
        const token = sessionStorage.getItem(tokenKey);
        if (!token) {
            document.querySelectorAll('.auth-link').forEach((link) => {
                link.addEventListener('click', (event) => {
                    event.preventDefault();
                    login();
                }, { once: true });
            });
            return;
        }

        try {
            const response = await fetch('https://discord.com/api/users/@me', {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) throw new Error('Discord session expired');
            setProfile(await response.json());
        } catch (error) {
            sessionStorage.removeItem(tokenKey);
            document.querySelectorAll('.auth-link').forEach((link) => {
                link.addEventListener('click', (event) => {
                    event.preventDefault();
                    login();
                }, { once: true });
            });
        }
    }

    window.OceanworksAuth = { login, logout };
    loadProfile();
})();
