const crypto = require('crypto');

const OPERATOR_KEY_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const OPERATOR_SESSION_TTL_MS = 15 * 60 * 1000;

function mountOperatorRoutes(app, {
    discordFetch,
    resolveDiscordUser,
    operatorUserId = process.env.OPERATOR_DISCORD_ID || '1394655096268394592',
    operatorDiscordId = process.env.OPERATOR_DISCORD_ID || '1394655096268394592',
    operatorUserIds = [operatorUserId, '1408890168928239696'],
    consoleFeed = [],
    executeCommand = async ({ command }) => `Command received: ${command}`
}) {
    const challenges = new Map();
    const verifiedSessions = new Map();

    async function resolveOperatorIdentity(token, resolvedUser) {
        const response = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) return null;
        const discordUser = await response.json();
        return { ...resolvedUser, ...discordUser, userId: discordUser.id };
    }

    async function operatorUser(req, res, next) {
        const header = req.headers.authorization || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : null;
        if (!token) return res.status(401).json({ error: 'Authentication required.' });

        const resolvedUser = await resolveDiscordUser(token).catch(() => null);
        const user = resolvedUser ? await resolveOperatorIdentity(token, resolvedUser).catch(() => null) : null;
        if (!user || !operatorUserIds.includes(user.userId || user.id)) {
            return res.status(403).json({ error: 'Operator access denied.' });
        }

        req.operator = user;
        req.operatorId = user.userId || user.id || operatorDiscordId;
        if (!req.operatorId) return res.status(500).json({ error: 'Operator Discord ID is not configured.' });
        next();
    }

    function securitySession(req) {
        const session = verifiedSessions.get(req.operatorId);
        return session && session.expiresAt > Date.now() ? session : null;
    }

    function requireVerifiedOperator(req, res, next) {
        if (!securitySession(req)) return res.status(403).json({ error: 'Security key verification required.' });
        next();
    }

    async function sendOperatorDm(userId, content) {
        if (!userId) throw new Error('OPERATOR_DISCORD_ID is not configured.');
        const botToken = process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN;
        const channelRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
            method: 'POST',
            headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipient_id: userId })
        });
        if (!channelRes.ok) throw new Error('Unable to open operator DM channel.');
        const channel = await channelRes.json();
        const messageRes = await discordFetch(`/channels/${channel.id}/messages`, {
            method: 'POST',
            body: JSON.stringify({ content })
        });
        if (!messageRes.ok) throw new Error('Unable to send operator security key.');
    }

    app.get('/api/operator/security/status', operatorUser, (req, res) => {
        res.json({ verified: Boolean(securitySession(req)) });
    });

    app.post('/api/operator/security/request', operatorUser, async (req, res) => {
        const key = String(crypto.randomInt(100000, 1000000));
        challenges.set(req.operatorId, { key, expiresAt: Date.now() + OPERATOR_KEY_TTL_MS });
        try {
            await sendOperatorDm(req.operatorId, `Your Ocean One operator security key is: ${key}\nIt expires in 3 days.`);
            res.json({ sent: true });
        } catch (error) {
            challenges.delete(req.operatorId);
            console.error('Failed to send operator security key:', error.message);
            res.status(502).json({ error: 'Could not send the security key by Discord DM.' });
        }
    });

    app.post('/api/operator/security/verify', operatorUser, (req, res) => {
        const challenge = challenges.get(req.operatorId);
        if (!challenge || challenge.expiresAt <= Date.now() || String(req.body?.key || '') !== challenge.key) {
            return res.json({ verified: false });
        }
        challenges.delete(req.operatorId);
        verifiedSessions.set(req.operatorId, { expiresAt: Date.now() + OPERATOR_SESSION_TTL_MS });
        res.json({ verified: true });
    });

    app.get('/api/operator/console', operatorUser, requireVerifiedOperator, (req, res) => {
        const since = Number(req.query.since) || 0;
        res.json({ entries: consoleFeed.filter(entry => entry.id > since), latest: consoleFeed.at(-1)?.id || since });
    });

    app.get('/api/operator/guilds/:guildId/stats', operatorUser, requireVerifiedOperator, async (req, res) => {
        try {
            const guildRes = await discordFetch(`/guilds/${req.params.guildId}?with_counts=true`);
            if (!guildRes.ok) return res.status(guildRes.status).json({ error: 'Could not fetch guild statistics.' });
            const guild = await guildRes.json();
            const stats = { members: guild.approximate_member_count ?? guild.member_count ?? 0, guilds: req.operator.guildCount ?? req.operator.ownedGuildIds?.size ?? 0, securityStatus: 'Protected' };
            console.log(`[operator] stats guild=${req.params.guildId}`, stats);
            res.json(stats);
        } catch (error) {
            console.error('Failed to load operator stats:', error.message);
            res.status(502).json({ error: 'Could not load guild statistics.' });
        }
    });

    app.post('/api/operator/guilds/:guildId/command', operatorUser, requireVerifiedOperator, async (req, res) => {
        const command = typeof req.body?.command === 'string' ? req.body.command.trim() : '';
        if (!command || command.length > 500) return res.status(400).json({ error: 'command must be between 1 and 500 characters.' });
        try {
            const message = await executeCommand({ command, guildId: req.params.guildId, user: req.operator });
            const output = String(message || 'Command completed.');
            console.log(`[operator] command guild=${req.params.guildId} user=${req.operator.username || req.operator.id}: ${command}`);
            console.log(`[operator] response: ${output}`);
            res.json({ success: true, message: output });
        } catch (error) {
            console.error('Operator command failed:', error.message);
            res.status(500).json({ error: error.message || 'Command failed.' });
        }
    });
}

module.exports = { mountOperatorRoutes };
