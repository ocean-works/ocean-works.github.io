const express = require('express');
const fs = require('fs');
const path = require('path');
const util = require('util');
const cors = require('cors');
const { ActionRowBuilder } = require('discord.js');

const ticketStore = require('../utils/ticketStore');
const sessionStore = require('../utils/sessionStore');
const moderationStore = require('../utils/moderationStore');
const keyStore = require('../utils/keyStore');
const verification = require('./verification');
const antiPingStore = require('../utils/antiPingStore');
const { mountOperatorRoutes } = require('./operator-routes');

const app = express();

const ALLOWED_ORIGIN = 'https://ocean-works.github.io';
const AUDIT_LOG_GUILD_ID = '1527423025073360967';
const AUDIT_LOG_CHANNEL_ID = '1546981523100536912';
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 100;
const AUTH_CACHE_TTL_MS = 60 * 1000;
const consoleFeed = [];
let consoleSequence = 0;

for (const level of ['log', 'info', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
        const message = util.format(...args);
        consoleFeed.push({ id: ++consoleSequence, level, message, timestamp: new Date().toISOString() });
        if (consoleFeed.length > 200) consoleFeed.shift();
        original(...args);
    };
}

// Needed so req.headers['x-forwarded-for'] reflects the real client IP
// rather than the ngrok tunnel's own address.
app.set('trust proxy', true);

app.use(cors({
    origin: ALLOWED_ORIGIN,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning']
}));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN;
const ROBLOX_CLIENT_ID = process.env.ROBLOX_CLIENT_ID || '6144543399746861341';
const ROBLOX_CLIENT_SECRET = process.env.ROBLOX_CLIENT_SECRET;
const ROBLOX_REDIRECT_URI = process.env.ROBLOX_REDIRECT_URI || 'https://ocean-works.github.io/verification';

async function discordFetch(endpoint, options = {}) {
    return fetch(`https://discord.com/api/v10${endpoint}`, {
        ...options,
        headers: {
            Authorization: `Bot ${BOT_TOKEN}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });
}

// ---------- Audit logging ----------

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return forwarded.split(',')[0].trim();
    return req.socket.remoteAddress || 'unknown';
}

async function auditLog(req, { action, allowed, details }) {
    if (!BOT_TOKEN) return;
    try {
        const embed = {
            title: allowed ? '📝 Ocean One API Request' : '🛡️ Defense Activated — Request Blocked',
            color: allowed ? 0x2b8ce6 : 0xed4245,
            fields: [
                { name: 'IP Address', value: `\`${getClientIp(req)}\``, inline: true },
                { name: 'Origin', value: `\`${req.headers.origin || 'none'}\``, inline: true },
                { name: 'Request', value: `\`${req.method} ${req.originalUrl}\``, inline: false },
                { name: 'Action', value: action || 'N/A', inline: false },
                { name: 'Details', value: details || 'N/A', inline: false }
            ],
            timestamp: new Date().toISOString()
        };
        await discordFetch(`/channels/${AUDIT_LOG_CHANNEL_ID}/messages`, {
            method: 'POST',
            body: JSON.stringify({ embeds: [embed] })
        });
    } catch (e) {
        console.error('Failed to write audit log:', e.message);
    }
}

// ---------- Rate limiting (simple in-memory sliding window per IP) ----------

const rateLimitBuckets = new Map();

function rateLimit(req, res, next) {
    const ip = getClientIp(req);
    const now = Date.now();
    const timestamps = (rateLimitBuckets.get(ip) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    timestamps.push(now);
    rateLimitBuckets.set(ip, timestamps);

    if (timestamps.length > RATE_LIMIT_MAX_REQUESTS) {
        auditLog(req, {
            action: `Rate limit exceeded on ${req.path}`,
            allowed: false,
            details: `${timestamps.length} requests in the last minute from this IP`
        }).catch(() => {});
        return res.status(429).json({ error: 'Defense activated. Too many requests — slow down and try again shortly.' });
    }
    next();
}

app.use(rateLimit);

// ---------- Origin validation (defense in depth beyond the cors() package) ----------
// CORS is a browser-only restriction; a script using curl/Postman ignores it
// entirely. This catches non-browser requests that spoof or omit an Origin
// header — the real gate for those is the auth middleware below, but a
// mismatched Origin from an actual browser is blocked here immediately.

function originIsAllowed(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    return origin === ALLOWED_ORIGIN;
}

// ---------- Discord-token-based per-guild authentication ----------

const authCache = new Map(); // token -> { username, ownedGuildIds, timestamp }

async function resolveDiscordUser(token) {
    const cached = authCache.get(token);
    if (cached && Date.now() - cached.timestamp < AUTH_CACHE_TTL_MS) return cached;

    const meRes = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!meRes.ok) return null;
    const me = await meRes.json();

    const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!guildsRes.ok) return null;
    const guilds = await guildsRes.json();

    const result = {
        userId: me.id,
        username: me.username,
        guildCount: guilds.length,
        ownedGuildIds: new Set(guilds.filter(g => g.owner === true).map(g => g.id)),
        timestamp: Date.now()
    };
    authCache.set(token, result);
    return result;
}

function extractBearerToken(req) {
    const header = req.headers.authorization || '';
    return header.startsWith('Bearer ') ? header.slice(7) : null;
}

// Full guard: used on every route that reads or changes a specific guild's
// configuration. Requires a valid Discord token AND that the token's user
// either owns the guild or holds an owner-panel key for it.
async function requireGuildAccess(req, res, next) {
    if (!originIsAllowed(req)) {
        await auditLog(req, { action: `Blocked request to ${req.path}`, allowed: false, details: `Origin mismatch: ${req.headers.origin}` });
        return res.status(403).json({ error: 'Defense activated. This request has been blocked and logged.' });
    }

    const guildId = req.params.guildId;
    const token = extractBearerToken(req);

    if (!token) {
        await auditLog(req, { action: `Blocked request to ${req.path}`, allowed: false, details: 'Missing Authorization token' });
        return res.status(401).json({ error: 'Defense activated. Authentication required.' });
    }

    const user = await resolveDiscordUser(token).catch(() => null);
    if (!user) {
        await auditLog(req, { action: `Blocked request to ${req.path}`, allowed: false, details: 'Invalid or expired Discord token' });
        return res.status(401).json({ error: 'Defense activated. Invalid session — please log in again.' });
    }

    const isOwner = user.ownedGuildIds.has(guildId);
    const isKeyHolder = !isOwner && keyStore.hasKeyAccess(guildId, user.username);

    if (!isOwner && !isKeyHolder) {
        await auditLog(req, {
            action: `Blocked request to ${req.path} for guild ${guildId}`,
            allowed: false,
            details: `User "${user.username}" has no owner or key access to this guild`
        });
        return res.status(403).json({ error: 'Defense activated. You do not have access to this server.' });
    }

    req.discordUser = user;
    req.isOwner = isOwner;

    auditLog(req, {
        action: `${req.method} ${req.path} for guild ${guildId}`,
        allowed: true,
        details: `Authenticated as "${user.username}" (${isOwner ? 'owner' : 'key holder'})`
    }).catch(() => {});

    next();
}

// Lighter guard for /keys/check specifically — that endpoint IS the access
// check itself (used during login before we know if someone has key access
// to anything), so it only requires a valid Discord identity, not guild access.
async function requireValidToken(req, res, next) {
    if (!originIsAllowed(req)) {
        await auditLog(req, { action: `Blocked request to ${req.path}`, allowed: false, details: `Origin mismatch: ${req.headers.origin}` });
        return res.status(403).json({ error: 'Defense activated. This request has been blocked and logged.' });
    }

    const token = extractBearerToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Defense activated. Authentication required.' });
    }

    const user = await resolveDiscordUser(token).catch(() => null);
    if (!user) {
        return res.status(401).json({ error: 'Defense activated. Invalid session — please log in again.' });
    }

    req.discordUser = user;
    next();
}

// ---------- Anti-Ping system ----------

app.get('/api/guilds/:guildId/antiping', requireGuildAccess, (req, res) => {
    const { guildId } = req.params;
    res.json(antiPingStore.getGuildConfig(guildId));
});

app.post('/api/guilds/:guildId/antiping', requireGuildAccess, (req, res) => {
    const { guildId } = req.params;
    const { roleId, deleteOffenderMessage } = req.body;

    if (roleId !== undefined && roleId !== null && typeof roleId !== 'string') {
        return res.status(400).json({ error: 'roleId must be a string or null.' });
    }

    const saved = antiPingStore.saveGuildConfig(guildId, {
        roleId: roleId || null,
        deleteOffenderMessage: deleteOffenderMessage !== false
    });

    res.json({ success: true, config: saved });
});

// ---------- Endpoint to fetch accurate text channels, categories, roles & plus status ----------

app.get('/api/guilds/:guildId/channels', requireGuildAccess, async (req, res) => {
    const { guildId } = req.params;
    try {
        if (!BOT_TOKEN) {
            return res.status(500).json({ error: 'Bot token is not configured in environment variables' });
        }

        const [channelsRes, rolesRes] = await Promise.all([
            discordFetch(`/guilds/${guildId}/channels`),
            discordFetch(`/guilds/${guildId}/roles`)
        ]);

        if (!channelsRes.ok) {
            return res.status(channelsRes.status).json({ error: 'Failed to fetch channels from Discord API' });
        }

        const allChannels = await channelsRes.json();
        const textChannels = allChannels
            .filter(c => c.type === 0)
            .map(c => ({ id: c.id, name: c.name }));
        const categories = allChannels
            .filter(c => c.type === 4)
            .map(c => ({ id: c.id, name: c.name }));

        let roles = [];
        if (rolesRes.ok) {
            const allRoles = await rolesRes.json();
            roles = allRoles
                .filter(r => r.id !== guildId && !r.managed)
                .map(r => ({ id: r.id, name: r.name }));
        }

        const isPlus = ticketStore.isGuildPlus(guildId);

        res.json({ channels: textChannels, categories, roles, isPlus });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ---------- Simple key/value module config (anti-nuke, verification, logs, bot profile) ----------

app.get('/api/guilds/:guildId/config', requireGuildAccess, (req, res) => {
    const { guildId } = req.params;
    const filePath = path.join(__dirname, '..', 'data', 'configs', `${guildId}.json`);
    if (!fs.existsSync(filePath)) return res.json({});
    try {
        res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch (e) {
        res.json({});
    }
});

app.post('/api/guilds/:guildId/config', requireGuildAccess, (req, res) => {
    const { guildId } = req.params;
    const { moduleKey, configData } = req.body;

    const configDir = path.join(__dirname, '..', 'data', 'configs');
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

    const filePath = path.join(configDir, `${guildId}.json`);
    let existingConfig = {};
    if (fs.existsSync(filePath)) {
        try {
            existingConfig = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) {}
    }

    existingConfig[moduleKey] = configData;
    fs.writeFileSync(filePath, JSON.stringify(existingConfig, null, 2));

    res.json({ success: true, message: `Configuration for ${moduleKey} saved successfully.` });
});

// ---------- Ticket system ----------

app.get('/api/guilds/:guildId/tickets', requireGuildAccess, (req, res) => {
    const { guildId } = req.params;
    const config = ticketStore.getGuildConfig(guildId);
    const isPlus = ticketStore.isGuildPlus(guildId);
    const limit = ticketStore.getTypeLimit(guildId);

    res.json({
        types: config.types,
        staffRoleId: config.staffRoleId,
        categoryId: config.categoryId,
        limit,
        isPlus
    });
});

app.post('/api/guilds/:guildId/tickets', requireGuildAccess, (req, res) => {
    const { guildId } = req.params;
    const { types, staffRoleId, categoryId } = req.body;

    if (!Array.isArray(types)) {
        return res.status(400).json({ error: 'types must be an array of strings.' });
    }

    const cleanTypes = [];
    for (const raw of types) {
        const name = String(raw).trim();
        if (!name) continue;
        if (cleanTypes.some(t => t.toLowerCase() === name.toLowerCase())) continue;
        cleanTypes.push(name);
    }

    if (cleanTypes.length === 0) {
        return res.status(400).json({ error: 'You need at least one ticket type.' });
    }

    const limit = ticketStore.getTypeLimit(guildId);
    if (cleanTypes.length > limit) {
        return res.status(400).json({
            error: ticketStore.isGuildPlus(guildId)
                ? `This server is limited to ${limit} ticket types.`
                : `This server is limited to ${limit} ticket types. Upgrade to Ocean+ to raise the limit to ${ticketStore.PLUS_TYPE_LIMIT}.`
        });
    }

    const config = ticketStore.getGuildConfig(guildId);
    config.types = cleanTypes;
    config.staffRoleId = staffRoleId || null;
    config.categoryId = categoryId || null;
    ticketStore.saveGuildConfig(guildId, config);

    res.json({ success: true, config });
});

app.post('/api/guilds/:guildId/tickets/panel', requireGuildAccess, async (req, res) => {
    const { guildId } = req.params;
    const { channelId, guildName } = req.body;

    if (!channelId) {
        return res.status(400).json({ error: 'channelId is required.' });
    }
    if (!BOT_TOKEN) {
        return res.status(500).json({ error: 'Bot token is not configured in environment variables' });
    }

    const config = ticketStore.getGuildConfig(guildId);
    if (!config.types.length) {
        return res.status(400).json({ error: 'This server has no ticket types configured yet.' });
    }

    const embed = ticketStore.buildPanelEmbed(guildName || 'this server');
    const row = new ActionRowBuilder().addComponents(ticketStore.buildPanelSelectMenu(config));

    try {
        const sendRes = await discordFetch(`/channels/${channelId}/messages`, {
            method: 'POST',
            body: JSON.stringify({
                embeds: [embed.toJSON()],
                components: [row.toJSON()]
            })
        });

        if (!sendRes.ok) {
            const errBody = await sendRes.json().catch(() => ({}));
            return res.status(sendRes.status).json({ error: errBody.message || 'Discord rejected the panel message.' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ---------- Owner panel keys ----------

app.get('/api/guilds/:guildId/keys', requireGuildAccess, (req, res) => {
    const { guildId } = req.params;
    const keys = keyStore.getKeys(guildId);
    const isPlus = ticketStore.isGuildPlus(guildId);
    res.json({ keys, limit: isPlus ? 3 : 1, isPlus });
});

app.post('/api/guilds/:guildId/keys', requireGuildAccess, (req, res) => {
    const { guildId } = req.params;

    if (!req.isOwner) {
        return res.status(403).json({ error: 'Only the server owner can manage owner panel keys.' });
    }

    const { keys } = req.body;

    if (!Array.isArray(keys)) {
        return res.status(400).json({ error: 'keys must be an array of Discord usernames.' });
    }

    const cleanKeys = [...new Set(keys.map(k => String(k).trim()).filter(Boolean))];
    const isPlus = ticketStore.isGuildPlus(guildId);
    const limit = isPlus ? 3 : 1;

    if (cleanKeys.length > limit) {
        return res.status(400).json({
            error: isPlus
                ? `This server is limited to ${limit} owner panel keys.`
                : `This server is limited to ${limit} owner panel key. Upgrade to Ocean+ to allow up to 3.`
        });
    }

    const saved = keyStore.saveKeys(guildId, cleanKeys);
    res.json({ success: true, keys: saved });
});

// Used by the panel at login time to see if a non-owner has key access to a guild.
// This is intentionally lighter than requireGuildAccess — it IS the access check.
app.get('/api/guilds/:guildId/keys/check', requireValidToken, (req, res) => {
    const { guildId } = req.params;
    const { username } = req.query;
    res.json({ hasAccess: keyStore.hasKeyAccess(guildId, username) });
});

// ---------- Moderation controls ----------

app.get('/api/guilds/:guildId/moderation', requireGuildAccess, (req, res) => {
    const { guildId } = req.params;
    res.json(moderationStore.getGuildConfig(guildId));
});

app.post('/api/guilds/:guildId/moderation', requireGuildAccess, (req, res) => {
    const { guildId } = req.params;
    const { enabled, exemptRoleIds, exemptChannelIds, exemptUserIds } = req.body;

    if (enabled !== undefined && typeof enabled !== 'object') {
        return res.status(400).json({ error: 'enabled must be an object.' });
    }
    if (exemptRoleIds !== undefined && !Array.isArray(exemptRoleIds)) {
        return res.status(400).json({ error: 'exemptRoleIds must be an array.' });
    }
    if (exemptChannelIds !== undefined && !Array.isArray(exemptChannelIds)) {
        return res.status(400).json({ error: 'exemptChannelIds must be an array.' });
    }
    if (exemptUserIds !== undefined && !Array.isArray(exemptUserIds)) {
        return res.status(400).json({ error: 'exemptUserIds must be an array.' });
    }

    const saved = moderationStore.saveGuildConfig(guildId, {
        enabled: enabled || {},
        exemptRoleIds: exemptRoleIds || [],
        exemptChannelIds: exemptChannelIds || [],
        exemptUserIds: exemptUserIds || []
    });

    res.json({ success: true, config: saved });
});

// ---------- Session management ----------

app.get('/api/guilds/:guildId/sessions', requireGuildAccess, (req, res) => {
    const { guildId } = req.params;
    res.json(sessionStore.getGuildConfig(guildId));
});

app.post('/api/guilds/:guildId/sessions', requireGuildAccess, (req, res) => {
    const { guildId } = req.params;
    const { channelId, hostRoleIds } = req.body;

    if (hostRoleIds !== undefined && !Array.isArray(hostRoleIds)) {
        return res.status(400).json({ error: 'hostRoleIds must be an array.' });
    }

    const saved = sessionStore.saveGuildConfig(guildId, {
        channelId: channelId || null,
        hostRoleIds: hostRoleIds || []
    });

    res.json({ success: true, config: saved });
});

// ---------- Roblox verification ----------
// Not guild-scoped (an individual end-user linking their own account), so
// requireGuildAccess doesn't apply here — but it's still origin- and
// rate-limited like everything else above.

app.get('/api/verify', async (req, res) => {
    if (!originIsAllowed(req)) {
        await auditLog(req, { action: 'Blocked request to /api/verify', allowed: false, details: `Origin mismatch: ${req.headers.origin}` });
        return res.status(403).json({ success: false, error: 'Defense activated. This request has been blocked and logged.' });
    }

    const { code, state: discordUserId } = req.query;

    if (!code || !discordUserId) {
        return res.status(400).json({ success: false, error: 'Missing authorization code or Discord user ID.' });
    }
    if (!ROBLOX_CLIENT_SECRET) {
        return res.status(500).json({ success: false, error: 'Roblox OAuth is not configured on the backend (missing ROBLOX_CLIENT_SECRET).' });
    }

    try {
        const tokenRes = await fetch('https://apis.roblox.com/oauth/v1/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: ROBLOX_CLIENT_ID,
                client_secret: ROBLOX_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: ROBLOX_REDIRECT_URI
            })
        });

        const tokenData = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok || !tokenData.access_token) {
            return res.status(400).json({
                success: false,
                error: tokenData.error_description || tokenData.error || 'Failed to exchange the Roblox authorization code.'
            });
        }

        const userInfoRes = await fetch('https://apis.roblox.com/oauth/v1/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });

        const userInfo = await userInfoRes.json().catch(() => ({}));
        if (!userInfoRes.ok || !userInfo.sub) {
            return res.status(400).json({ success: false, error: 'Failed to fetch the Roblox account details.' });
        }

        const robloxId = userInfo.sub;
        const robloxUsername = userInfo.preferred_username || userInfo.nickname || userInfo.name || robloxId;

        const result = verification.linkRobloxAccount(discordUserId, robloxId, robloxUsername);
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Internal server error during verification.' });
    }
});

mountOperatorRoutes(app, {
    discordFetch,
    resolveDiscordUser,
    operatorUserId: '1394655096268394592',
    operatorDiscordId: '1394655096268394592',
    operatorUserIds: ['1394655096268394592', '1408890168928239696'],
    consoleFeed,
    executeCommand: async ({ command, guildId }) => {
        const [name, ...argumentsList] = command.split(/\s+/);
        if (name.toLowerCase() === 'status') return `Backend online. Target guild: ${guildId}.`;
        if (name.toLowerCase() === 'announce') {
            const channelId = argumentsList.shift();
            const content = argumentsList.join(' ').trim();
            if (!channelId || !content) throw new Error('Usage: announce <channelId> <message>');
            const response = await discordFetch(`/channels/${channelId}/messages`, {
                method: 'POST',
                body: JSON.stringify({ content })
            });
            if (!response.ok) throw new Error('Discord rejected the announcement.');
            return `Announcement sent to channel ${channelId}.`;
        }
        return `Command received: ${command}`;
    }
});

app.listen(PORT, async () => {
    console.log(`Ocean One Backend running on port ${PORT}`);

    if (process.env.NGROK_AUTHTOKEN) {
        try {
            const ngrok = require('@ngrok/ngrok');
            const listener = await ngrok.connect({
                addr: PORT,
                authtoken: process.env.NGROK_AUTHTOKEN,
                domain: process.env.NGROK_DOMAIN || undefined
            });
            console.log(`Public HTTPS URL: ${listener.url()}`);
        } catch (err) {
            console.error('Failed to start ngrok tunnel:', err);
        }
    } else {
        console.log('NGROK_AUTHTOKEN not set — backend is only reachable over plain HTTP.');
    }
});