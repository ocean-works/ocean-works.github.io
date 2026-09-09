const crypto = require('crypto');

const OPERATOR_KEY_VISIBLE_MS = 12 * 60 * 60 * 1000;
const OPERATOR_KEY_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;
const OPERATOR_KEY_RENEWAL_DELAY_MS = 30 * 1000;
const OPERATOR_SESSION_TTL_MS = 15 * 60 * 1000;
const DEFAULT_OPERATOR_IDS = ['1394655096268394592', '1408890168928239696'];

function mountOperatorRoutes(app, {
	discordFetch,
	resolveDiscordUser,
	operatorUserId = process.env.OPERATOR_DISCORD_ID || DEFAULT_OPERATOR_IDS[0],
	operatorDiscordId = process.env.OPERATOR_DISCORD_ID || DEFAULT_OPERATOR_IDS[0],
	operatorUserIds = [operatorUserId, DEFAULT_OPERATOR_IDS[1]],
	consoleFeed = [],
	executeCommand = async ({ command }) => `Command received: ${command}`
}) {
	const challenges = new Map();
	const verifiedSessions = new Map();
	let renewalTimer;

	function base15(value) {
		return value.toString(15).toUpperCase();
	}

	function createSecurityKey(username) {
		const randomPart = crypto.randomBytes(8).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10).padEnd(10, '0');
		const sentAt = Date.now();
		return {
			value: `oceanworks-${username}-${randomPart}-${base15(sentAt)}`,
			sentAt,
			visibleUntil: sentAt + OPERATOR_KEY_VISIBLE_MS,
			renewAt: sentAt + OPERATOR_KEY_INTERVAL_MS + OPERATOR_KEY_RENEWAL_DELAY_MS
		};
	}

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

	function isPrimaryOperator(req) {
		return req.operatorId === operatorUserId;
	}

	function securitySession(req) {
		const session = verifiedSessions.get(req.operatorId);
		return session && session.expiresAt > Date.now() ? session : null;
	}

	function requireVerifiedOperator(req, res, next) {
		if (isPrimaryOperator(req) || securitySession(req)) return next();
		res.status(403).json({ error: 'Security key verification required.' });
	}

	async function sendOperatorDm(userId, content) {
		const botToken = process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN;
		if (!botToken) throw new Error('Bot token is not configured.');
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

	async function issueKey(userId, username) {
		const key = createSecurityKey(username);
		challenges.set(userId, { key: key.value, ...key });
		await sendOperatorDm(userId, `Your new security key is ${key.value}\n\nThis expires in ${new Date(key.visibleUntil).toISOString()}`);
	}

	async function issueKeys() {
		for (const userId of operatorUserIds) {
			try {
				const userRes = await fetch(`https://discord.com/api/v10/users/${userId}`, {
					headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN}` }
				});
				const user = userRes.ok ? await userRes.json() : { username: userId };
				await issueKey(userId, user.username || userId);
			} catch (error) {
				console.error(`Failed to issue operator key for ${userId}:`, error.message);
			}
		}
	}

	function scheduleRenewal() {
		clearTimeout(renewalTimer);
		const renewalTimes = [...challenges.values()].map(challenge => challenge.renewAt);
		if (!renewalTimes.length) return;
		const nextRenewal = Math.min(...renewalTimes);
		renewalTimer = setTimeout(async () => {
			await issueKeys();
			scheduleRenewal();
		}, Math.max(0, nextRenewal - Date.now()));
	}

	app.get('/api/operator/security/status', operatorUser, (req, res) => {
		res.json({ verified: isPrimaryOperator(req) || Boolean(securitySession(req)) });
	});

	app.post('/api/operator/security/reset', operatorUser, async (req, res) => {
		if (!isPrimaryOperator(req)) return res.status(403).json({ error: 'Only the primary operator can reset security keys.' });
		challenges.clear();
		try {
			await issueKeys();
			scheduleRenewal();
			res.json({ success: true, message: 'All operator security keys were reset and sent.' });
		} catch (error) {
			res.status(502).json({ error: 'Could not reset all operator security keys.' });
		}
	});

	app.post('/api/operator/security/verify', operatorUser, (req, res) => {
		const challenge = challenges.get(req.operatorId);
		if (!challenge || challenge.visibleUntil <= Date.now() || String(req.body?.key || '') !== challenge.key) {
			return res.json({ verified: false });
		}
		verifiedSessions.set(req.operatorId, { expiresAt: Date.now() + OPERATOR_SESSION_TTL_MS });
		res.json({ verified: true });
	});

	app.get('/api/operator/security/current', operatorUser, (req, res) => {
		const challenge = challenges.get(req.operatorId);
		if (!challenge || challenge.visibleUntil <= Date.now()) return res.json({ visible: false });
		res.json({ visible: true, key: challenge.key, expiresAt: new Date(challenge.visibleUntil).toISOString() });
	});

	app.get('/api/operator/console', operatorUser, requireVerifiedOperator, (req, res) => {
		const since = Number(req.query.since) || 0;
		res.json({ entries: consoleFeed.filter(entry => entry.id > since), latest: consoleFeed.at(-1)?.id || since });
	});

	app.get('/api/operator/guilds', operatorUser, requireVerifiedOperator, async (req, res) => {
		const guildsRes = await discordFetch('/users/@me/guilds');
		if (!guildsRes.ok) return res.status(guildsRes.status).json({ error: 'Could not fetch the bot guild list.' });
		const guilds = await guildsRes.json();
		res.json({ guilds: guilds.map(guild => ({ id: guild.id, name: guild.name })) });
	});

	app.get('/api/operator/guilds/:guildId/stats', operatorUser, requireVerifiedOperator, async (req, res) => {
		const guildRes = await discordFetch(`/guilds/${req.params.guildId}?with_counts=true`);
		if (!guildRes.ok) return res.status(guildRes.status).json({ error: 'Could not fetch guild statistics.' });
		const guild = await guildRes.json();
		res.json({ members: guild.approximate_member_count ?? guild.member_count ?? 0, guilds: req.operator.guildCount ?? 0, securityStatus: 'Protected' });
	});

	app.post('/api/operator/guilds/:guildId/command', operatorUser, requireVerifiedOperator, async (req, res) => {
		const command = typeof req.body?.command === 'string' ? req.body.command.trim() : '';
		if (!command || command.length > 500) return res.status(400).json({ error: 'command must be between 1 and 500 characters.' });
		try {
			const normalizedCommand = command.toLowerCase().replace(/^\/+/, '');
			let message;
			if (isPrimaryOperator(req) && normalizedCommand === 'security reset') {
				challenges.clear();
				await issueKeys();
				scheduleRenewal();
				message = 'All operator security keys were reset and sent.';
			} else if (isPrimaryOperator(req) && normalizedCommand === 'security view') {
				const visibleKeys = [...challenges.entries()]
					.filter(([, challenge]) => challenge.visibleUntil > Date.now())
					.map(([userId, challenge]) => `${userId}: ${challenge.key}`);
				message = visibleKeys.length ? visibleKeys.join('\n') : 'No security keys are currently visible.';
			} else {
				message = await executeCommand({ command, guildId: req.params.guildId, user: req.operator });
			}
			res.json({ success: true, message: String(message || 'Command completed.') });
		} catch (error) {
			console.error('Operator command failed:', error.message);
			res.status(500).json({ error: error.message || 'Command failed.' });
		}
	});
}

module.exports = { mountOperatorRoutes };
