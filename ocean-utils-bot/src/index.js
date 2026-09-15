const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder } = require('discord.js');
const dotenv = require('dotenv');

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const token = process.env.DISCORD_TOKEN;

client.on('ready', () => {
  console.log(`Ocean Utils bot ready: ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

  const customId = interaction.customId;

  if (customId === 'open_portal') {
    await interaction.reply({ content: 'Opening the portal for Ocean Utils.', ephemeral: true });
    return;
  }

  if (customId === 'view_docs') {
    await interaction.reply({ content: 'Documentation is available from the Oceanworks website.', ephemeral: true });
    return;
  }

  if (customId === 'ops_menu') {
    await interaction.reply({ content: `You selected: ${interaction.values.join(', ')}`, ephemeral: true });
    return;
  }

  await interaction.reply({ content: `Interaction received: ${customId}`, ephemeral: true });
});

async function sendMessageToChannel(payload) {
  if (!payload || !payload.channelId) {
    throw new Error('Missing channelId in payload');
  }

  const channel = await client.channels.fetch(payload.channelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error('Channel not found or not text-based');
  }

  const embedPayload = payload.embeds?.[0];
  const embed = new EmbedBuilder()
    .setTitle(embedPayload?.title || null)
    .setDescription(embedPayload?.description || null)
    .setColor(embedPayload?.color || 0xff8f70)
    .setImage(embedPayload?.image?.url || null)
    .setThumbnail(embedPayload?.thumbnail?.url || null)
    .setFooter(embedPayload?.footer ? { text: embedPayload.footer.text || '', iconURL: embedPayload.footer.icon_url || undefined } : null)
    .setAuthor(embedPayload?.author ? { name: embedPayload.author.name || 'Ocean Utils', iconURL: embedPayload.author.icon_url || undefined } : null);

  const actionRows = [];
  for (const row of payload.components || []) {
    if (!row?.components?.length) continue;

    const rowBuilder = new ActionRowBuilder();
    for (const component of row.components) {
      if (component.type === 2) {
        const button = new ButtonBuilder()
          .setCustomId(component.custom_id || `button_${Date.now()}`)
          .setLabel(component.label || 'Action')
          .setStyle(component.style || 1);

        if (component.url) button.setURL(component.url);
        rowBuilder.addComponents(button);
      }

      if (component.type === 3) {
        const select = new StringSelectMenuBuilder()
          .setCustomId(component.custom_id || `select_${Date.now()}`)
          .setPlaceholder(component.placeholder || 'Choose one')
          .setMinValues(component.min_values || 1)
          .setMaxValues(component.max_values || 1)
          .addOptions(
            (component.options || []).map((option) => ({
              label: option.label || 'Option',
              value: option.value || option.label || 'option',
              description: option.description || undefined
            }))
          );
        rowBuilder.addComponents(select);
      }
    }

    actionRows.push(rowBuilder);
  }

  await channel.send({
    content: payload.content || '',
    embeds: [embed],
    components: actionRows
  });
}

if (!token) {
  console.error('Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

client.login(token);

module.exports = { sendMessageToChannel };
