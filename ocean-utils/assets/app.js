const STORAGE_KEY = 'ocean-utils-local-state-v1';
const DEFAULT_TEMPLATE_KEY = 'ocean-utils-default-template';

const demoTemplate = {
  id: 'demo-template',
  name: 'Welcome board',
  content: {
    content: '',
    embeds: [{
      title: 'Ocean Utils',
      description: 'Design embeds and bot-ready components from one clean local workspace.',
      color: 16760480,
      image: { url: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1200&q=80' },
      thumbnail: { url: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=300&q=80' },
      footer: { text: 'Oceanworks • Local builder', icon_url: 'https://i.imgur.com/3NwUQhR.png' },
      author: { name: 'Ocean Utils', icon_url: 'https://i.imgur.com/7eQZ3tt.png' }
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 1, label: 'Open portal', custom_id: 'open_portal' },
        { type: 2, style: 2, label: 'View docs', custom_id: 'view_docs' }
      ]
    }, {
      type: 1,
      components: [{
        type: 3,
        custom_id: 'ops_menu',
        placeholder: 'Choose a task',
        min_values: 1,
        max_values: 1,
        options: [
          { label: 'Announcements', value: 'announcements', description: 'Send an announcement message' },
          { label: 'Backups', value: 'backups', description: 'Restore an older template' },
          { label: 'Reports', value: 'reports', description: 'Review recent activity' }
        ]
      }]
    }]
  }
};

const defaultState = {
  session: null,
  templates: [demoTemplate],
  selectedTemplateId: demoTemplate.id,
  builder: {
    title: '',
    description: '',
    color: '#ff8f70',
    imageUrl: '',
    thumbnailUrl: '',
    author: 'Ocean Utils',
    authorIcon: '',
    footerText: 'Oceanworks • Local builder',
    footerIcon: '',
    components: []
  }
};

const state = loadState();
const templateList = document.getElementById('template-list');
const jsonPreview = document.getElementById('json-preview');
const componentsList = document.getElementById('components-list');

const formEls = {
  title: document.getElementById('embed-title'),
  color: document.getElementById('embed-color'),
  description: document.getElementById('embed-description'),
  image: document.getElementById('embed-image'),
  thumbnail: document.getElementById('embed-thumbnail'),
  footerText: document.getElementById('embed-footer-text'),
  footerIcon: document.getElementById('embed-footer-icon'),
  author: document.getElementById('embed-author'),
  authorIcon: document.getElementById('embed-author-icon')
};

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return structuredClone(defaultState);

  try {
    return { ...structuredClone(defaultState), ...JSON.parse(raw) };
  } catch (error) {
    console.warn('Could not parse saved Ocean Utils state. Falling back to default.', error);
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadDemoSetup() {
  state.builder = {
    title: demoTemplate.content.embeds[0].title,
    description: demoTemplate.content.embeds[0].description,
    color: '#ff8f70',
    imageUrl: demoTemplate.content.embeds[0].image?.url || '',
    thumbnailUrl: demoTemplate.content.embeds[0].thumbnail?.url || '',
    author: demoTemplate.content.embeds[0].author?.name || 'Ocean Utils',
    authorIcon: demoTemplate.content.embeds[0].author?.icon_url || '',
    footerText: demoTemplate.content.embeds[0].footer?.text || 'Oceanworks • Local builder',
    footerIcon: demoTemplate.content.embeds[0].footer?.icon_url || '',
    components: buildComponentArrayFromPayload(demoTemplate.content.components)
  };

  syncBuilderForm();
  renderTemplateList();
  renderComponents();
  renderPreview();
}

function buildComponentArrayFromPayload(components = []) {
  return components.map((row, rowIndex) => ({
    id: `row-${rowIndex}-${Date.now()}`,
    rowIndex,
    buttons: (row.components || []).filter(item => item.type === 2).map(button => ({
      id: `${button.custom_id || 'button'}-${Date.now()}-${Math.random()}`,
      label: button.label || 'Button',
      style: String(button.style || 1),
      customId: button.custom_id || `button_${Math.random().toString(16).slice(2, 8)}`,
      url: button.url || ''
    })),
    select: (row.components || []).find(item => item.type === 3) ? {
      id: `${Date.now()}-${Math.random()}`,
      customId: (row.components || []).find(item => item.type === 3).custom_id || `select_${Math.random().toString(16).slice(2, 8)}`,
      placeholder: (row.components || []).find(item => item.type === 3).placeholder || 'Choose one',
      minValues: (row.components || []).find(item => item.type === 3).min_values || 1,
      maxValues: (row.components || []).find(item => item.type === 3).max_values || 1,
      options: ((row.components || []).find(item => item.type === 3).options || []).map(opt => ({
        label: opt.label || 'Option',
        value: opt.value || opt.label || 'value',
        description: opt.description || ''
      }))
    } : null
  }));
}

function syncBuilderForm() {
  formEls.title.value = state.builder.title || '';
  formEls.description.value = state.builder.description || '';
  formEls.color.value = state.builder.color || '#ff8f70';
  formEls.image.value = state.builder.imageUrl || '';
  formEls.thumbnail.value = state.builder.thumbnailUrl || '';
  formEls.footerText.value = state.builder.footerText || '';
  formEls.footerIcon.value = state.builder.footerIcon || '';
  formEls.author.value = state.builder.author || 'Ocean Utils';
  formEls.authorIcon.value = state.builder.authorIcon || '';
}

function bindFormInputs() {
  Object.entries(formEls).forEach(([key, element]) => {
    element.addEventListener('input', () => {
      state.builder[key === 'title' ? 'title' : key === 'description' ? 'description' : key === 'color' ? 'color' : key === 'image' ? 'imageUrl' : key === 'thumbnail' ? 'thumbnailUrl' : key === 'footerText' ? 'footerText' : key === 'footerIcon' ? 'footerIcon' : key === 'author' ? 'author' : 'authorIcon'] = element.value;
      renderPreview();
      saveState();
    });
  });
}

function getSelectedTemplate() {
  return state.templates.find(template => template.id === state.selectedTemplateId) || state.templates[0];
}

function renderTemplateList() {
  templateList.innerHTML = '';

  state.templates.forEach((template) => {
    const item = document.createElement('div');
    item.className = 'template-item';
    item.innerHTML = `
      <div>
        <strong>${template.name}</strong>
        <span>${template.content.embeds?.[0]?.title || 'Untitled embed'}</span>
      </div>
      <button type="button" data-id="${template.id}">Use</button>
    `;

    const useButton = item.querySelector('button');
    useButton.addEventListener('click', () => {
      state.selectedTemplateId = template.id;
      seedBuilderFromTemplate(template);
      renderTemplateList();
    });

    templateList.appendChild(item);
  });
}

function seedBuilderFromTemplate(template) {
  const embed = template.content.embeds?.[0] || {};
  state.builder = {
    title: embed.title || '',
    description: embed.description || '',
    color: embed.color ? `#${Number(embed.color).toString(16).padStart(6, '0')}` : '#ff8f70',
    imageUrl: embed.image?.url || '',
    thumbnailUrl: embed.thumbnail?.url || '',
    author: embed.author?.name || 'Ocean Utils',
    authorIcon: embed.author?.icon_url || '',
    footerText: embed.footer?.text || '',
    footerIcon: embed.footer?.icon_url || '',
    components: buildComponentArrayFromPayload(template.content.components || [])
  };
  syncBuilderForm();
  renderComponents();
  renderPreview();
}

function renderComponents() {
  componentsList.innerHTML = '';

  if (!state.builder.components.length) {
    componentsList.innerHTML = '<div class="component-card"><p>No components yet. Add a button or dropdown to build the bot message.</p></div>';
    return;
  }

  state.builder.components.forEach((row, rowIndex) => {
    const card = document.createElement('div');
    card.className = 'component-card';

    const header = document.createElement('div');
    header.className = 'component-card-header';
    header.innerHTML = `
      <strong>Action Row ${rowIndex + 1}</strong>
      <button class="remove-item" type="button" data-row-index="${rowIndex}">Remove</button>
    `;
    header.querySelector('button').addEventListener('click', () => {
      state.builder.components.splice(rowIndex, 1);
      renderComponents();
      renderPreview();
      saveState();
    });

    const body = document.createElement('div');
    body.className = 'component-card-body';

    if (row.buttons.length) {
      row.buttons.forEach((button, buttonIndex) => {
        const fieldGroup = document.createElement('div');
        fieldGroup.className = 'mini-field-grid';
        fieldGroup.innerHTML = `
          <label>
            Label
            <input type="text" value="${button.label}" data-row-index="${rowIndex}" data-button-index="${buttonIndex}" data-field="label" />
          </label>
          <label>
            Style
            <select data-row-index="${rowIndex}" data-button-index="${buttonIndex}" data-field="style">
              <option value="1" ${button.style === '1' ? 'selected' : ''}>Primary</option>
              <option value="2" ${button.style === '2' ? 'selected' : ''}>Secondary</option>
              <option value="3" ${button.style === '3' ? 'selected' : ''}>Success</option>
              <option value="4" ${button.style === '4' ? 'selected' : ''}>Danger</option>
              <option value="5" ${button.style === '5' ? 'selected' : ''}>Link</option>
            </select>
          </label>
          <label class="full-span">
            Custom ID
            <input type="text" value="${button.customId}" data-row-index="${rowIndex}" data-button-index="${buttonIndex}" data-field="customId" />
          </label>
          <label class="full-span">
            URL (for link buttons)
            <input type="text" value="${button.url}" data-row-index="${rowIndex}" data-button-index="${buttonIndex}" data-field="url" placeholder="https://example.com" />
          </label>
        `;
        body.appendChild(fieldGroup);
      });
    }

    if (row.select) {
      const selectCard = document.createElement('div');
      selectCard.className = 'mini-field-grid';
      selectCard.innerHTML = `
        <label>
          Placeholder
          <input type="text" value="${row.select.placeholder}" data-row-index="${rowIndex}" data-field="selectPlaceholder" />
        </label>
        <label>
          Custom ID
          <input type="text" value="${row.select.customId}" data-row-index="${rowIndex}" data-field="selectCustomId" />
        </label>
        <label>
          Min values
          <input type="number" value="${row.select.minValues}" min="1" max="25" data-row-index="${rowIndex}" data-field="selectMinValues" />
        </label>
        <label>
          Max values
          <input type="number" value="${row.select.maxValues}" min="1" max="25" data-row-index="${rowIndex}" data-field="selectMaxValues" />
        </label>
      `;

      const optionsWrap = document.createElement('div');
      optionsWrap.className = 'option-list';
      (row.select.options || []).forEach((option, optionIndex) => {
        const optionItem = document.createElement('div');
        optionItem.className = 'option-item';
        optionItem.innerHTML = `
          <input type="text" value="${option.label}" data-row-index="${rowIndex}" data-option-index="${optionIndex}" data-field="optionLabel" />
          <input type="text" value="${option.value}" data-row-index="${rowIndex}" data-option-index="${optionIndex}" data-field="optionValue" />
          <button type="button" class="remove-item" data-row-index="${rowIndex}" data-option-index="${optionIndex}">Delete</button>
        `;
        optionItem.querySelector('button').addEventListener('click', () => {
          row.select.options.splice(optionIndex, 1);
          renderComponents();
          renderPreview();
          saveState();
        });
        optionsWrap.appendChild(optionItem);
      });

      const addOption = document.createElement('button');
      addOption.type = 'button';
      addOption.className = 'btn tiny secondary';
      addOption.textContent = 'Add option';
      addOption.addEventListener('click', () => {
        row.select.options.push({ label: 'Option', value: `option_${Date.now()}` });
        renderComponents();
        renderPreview();
        saveState();
      });

      selectCard.appendChild(optionsWrap);
      selectCard.appendChild(addOption);
      body.appendChild(selectCard);
    }

    body.querySelectorAll('input, select').forEach((field) => {
      field.addEventListener('input', () => {
        const rowIndexValue = Number(field.dataset.rowIndex);
        const row = state.builder.components[rowIndexValue];
        if (!row) return;

        if (field.dataset.field === 'selectPlaceholder') row.select.placeholder = field.value;
        if (field.dataset.field === 'selectCustomId') row.select.customId = field.value;
        if (field.dataset.field === 'selectMinValues') row.select.minValues = Number(field.value || 1);
        if (field.dataset.field === 'selectMaxValues') row.select.maxValues = Number(field.value || 1);

        if (field.dataset.buttonIndex !== undefined) {
          const button = row.buttons[Number(field.dataset.buttonIndex)];
          if (!button) return;
          button[field.dataset.field] = field.dataset.field === 'style' ? field.value : field.value;
        }

        if (field.dataset.optionIndex !== undefined) {
          const option = row.select?.options?.[Number(field.dataset.optionIndex)];
          if (!option) return;
          option[field.dataset.field.replace('option', '').toLowerCase()] = field.value;
        }

        renderPreview();
        saveState();
      });
    });

    card.appendChild(header);
    card.appendChild(body);
    componentsList.appendChild(card);
  });
}

function addButtonRow() {
  state.builder.components.push({
    id: `row-${Date.now()}`,
    buttons: [{
      id: `button-${Date.now()}`,
      label: 'Action',
      style: '1',
      customId: `action_${Date.now().toString(16)}`,
      url: ''
    }],
    select: null
  });
  renderComponents();
  renderPreview();
  saveState();
}

function addSelectRow() {
  state.builder.components.push({
    id: `row-${Date.now()}`,
    buttons: [],
    select: {
      id: `select-${Date.now()}`,
      customId: `select_${Date.now().toString(16)}`,
      placeholder: 'Choose an option',
      minValues: 1,
      maxValues: 1,
      options: [
        { label: 'Option 1', value: 'option_1', description: 'Primary option' },
        { label: 'Option 2', value: 'option_2', description: 'Secondary option' }
      ]
    }
  });
  renderComponents();
  renderPreview();
  saveState();
}

function generatePayload() {
  const payload = {
    content: '',
    embeds: [],
    components: []
  };

  const embed = {
    title: state.builder.title || 'Ocean Utils',
    description: state.builder.description || '',
    color: Number.parseInt(state.builder.color.replace('#', ''), 16) || 16760480,
    image: state.builder.imageUrl ? { url: state.builder.imageUrl } : undefined,
    thumbnail: state.builder.thumbnailUrl ? { url: state.builder.thumbnailUrl } : undefined,
    footer: state.builder.footerText ? { text: state.builder.footerText, icon_url: state.builder.footerIcon || undefined } : undefined,
    author: state.builder.author ? { name: state.builder.author, icon_url: state.builder.authorIcon || undefined } : undefined
  };

  if (embed.title || embed.description || embed.image || embed.thumbnail || embed.footer || embed.author) {
    payload.embeds.push(Object.fromEntries(Object.entries(embed).filter(([, value]) => value !== undefined && value !== null && !(Array.isArray(value) && !value.length))));
  }

  payload.components = state.builder.components.map((row) => {
    const rowComponents = [];

    if (row.buttons?.length) {
      row.buttons.forEach(button => {
        rowComponents.push({
          type: 2,
          style: Number(button.style || 1),
          label: button.label || 'Action',
          custom_id: button.customId || `action_${Date.now()}`,
          url: Number(button.style) === 5 ? (button.url || '') : undefined
        });
      });
    }

    if (row.select) {
      rowComponents.push({
        type: 3,
        custom_id: row.select.customId || `select_${Date.now()}`,
        placeholder: row.select.placeholder || 'Choose an option',
        min_values: Number(row.select.minValues || 1),
        max_values: Number(row.select.maxValues || 1),
        options: (row.select.options || []).map((option) => ({
          label: option.label || 'Option',
          value: option.value || option.label || 'option',
          description: option.description || undefined
        }))
      });
    }

    return { type: 1, components: rowComponents.filter(Boolean) };
  }).filter(row => row.components.length > 0);

  return payload;
}

function renderPreview() {
  jsonPreview.textContent = JSON.stringify(generatePayload(), null, 2);
}

function saveCurrentTemplate() {
  const payload = generatePayload();
  const templateName = window.prompt('Name this template:', getSelectedTemplate()?.name || 'New template') || 'Untitled template';

  const existing = state.templates.find(template => template.id === state.selectedTemplateId);
  if (existing) {
    existing.name = templateName;
    existing.content = payload;
  } else {
    const newTemplate = {
      id: `template-${Date.now()}`,
      name: templateName,
      content: payload
    };
    state.templates.push(newTemplate);
    state.selectedTemplateId = newTemplate.id;
  }

  saveState();
  renderTemplateList();
}

function exportJson() {
  const payload = generatePayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'ocean-utils-embed.json';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function loadSession() {
  const session = state.session;
  if (!session) {
    document.getElementById('login-panel').classList.remove('hidden');
    document.getElementById('workspace-panel').classList.add('hidden');
    return;
  }

  document.getElementById('login-panel').classList.add('hidden');
  document.getElementById('workspace-panel').classList.remove('hidden');
  document.getElementById('active-session').textContent = `Active: ${session.botName || 'Ocean Utils'}`;
}

function persistSession(session) {
  state.session = session;
  saveState();
  loadSession();
}

function submitLogin(event) {
  event.preventDefault();

  const session = {
    botToken: document.getElementById('bot-token').value.trim(),
    guildId: document.getElementById('guild-id').value.trim(),
    channelId: document.getElementById('channel-id').value.trim(),
    botName: document.getElementById('bot-name').value.trim() || 'Ocean Utils'
  };

  if (!session.botToken) {
    alert('You need a Discord bot token to use Ocean Utils. Guild and channel IDs are optional unless you want to send directly to a server channel.');
    return;
  }

  persistSession(session);
}

function logoutSession() {
  state.session = null;
  saveState();
  loadSession();
}

function copyJsonPayload() {
  const payload = JSON.stringify(generatePayload(), null, 2);
  navigator.clipboard.writeText(payload)
    .then(() => alert('Discord JSON payload copied to clipboard.'))
    .catch(() => alert('Copy failed. You can still copy the preview manually.'));
}

function init() {
  bindFormInputs();
  renderTemplateList();
  renderComponents();
  renderPreview();
  loadSession();

  document.getElementById('login-form').addEventListener('submit', submitLogin);
  document.getElementById('load-demo').addEventListener('click', () => {
    loadDemoSetup();
    persistSession({
      botToken: 'demo-token',
      guildId: 'demo-guild',
      channelId: 'demo-channel',
      botName: 'Ocean Utils'
    });
  });
  document.getElementById('new-template').addEventListener('click', () => {
    state.selectedTemplateId = null;
    state.builder = {
      title: '',
      description: '',
      color: '#ff8f70',
      imageUrl: '',
      thumbnailUrl: '',
      author: 'Ocean Utils',
      authorIcon: '',
      footerText: 'Oceanworks • Local builder',
      footerIcon: '',
      components: []
    };
    syncBuilderForm();
    renderComponents();
    renderPreview();
    saveState();
  });
  document.getElementById('save-template').addEventListener('click', saveCurrentTemplate);
  document.getElementById('export-json').addEventListener('click', exportJson);
  document.getElementById('logout').addEventListener('click', logoutSession);
  document.getElementById('add-button').addEventListener('click', addButtonRow);
  document.getElementById('add-select').addEventListener('click', addSelectRow);
  document.getElementById('copy-json').addEventListener('click', copyJsonPayload);
}

init();
