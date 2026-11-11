(() => {
  'use strict';
  const $ = id => document.getElementById('platform-' + id);
  const state = { password: '', epoch: 0, clients: [], shops: [], editing: null, acting: false, needsRefresh: false, listVersion: 0 };
  const controllers = new Set();
  let signingIn = false;
  const current = epoch => epoch === state.epoch;
  const message = (text, error = false) => { $('status').textContent = text; $('status').className = error ? 'error' : ''; };
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function controls() {
    $('fields').disabled = state.acting || state.needsRefresh;
    $('save').disabled = state.acting || state.needsRefresh;
    $('refresh').disabled = state.acting;
    for (const button of $('list').querySelectorAll('button')) button.disabled = state.acting || state.needsRefresh;
  }
  function resetEditor() {
    state.editing = null; state.shops = [];
    for (const id of ['client-id', 'admin-password', 'gate-password', 'shop-name']) $(id).value = '';
    $('client-id').readOnly = false; $('shop-color').value = '#16a34a';
    $('admin-password').required = true; $('gate-password').required = true;
    $('form-title').textContent = 'Create client'; $('save').textContent = 'Create client';
    $('password-note').textContent = 'Set both passwords for a new client.';
    renderShops();
  }
  function lock(reason = '') {
    state.epoch++; state.listVersion++; state.password = ''; state.clients = [];
    state.acting = false; state.needsRefresh = false; signingIn = false;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    $('password').value = ''; $('login-button').disabled = false;
    $('login').hidden = false; $('management').hidden = true;
    $('list').replaceChildren(); $('login-error').textContent = reason;
    resetEditor(); message(''); controls();
  }
  async function request(method, path, body, password = state.password) {
    const controller = new AbortController(), epoch = state.epoch;
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15000);
    const mutation = method !== 'GET' && path !== '/verify';
    let receivedResponse = false;
    try {
      const headers = method === 'GET' ? { 'X-Super-Admin-Password': password } : { 'Content-Type': 'application/json' };
      const response = await fetch(window.location.origin + '/api/superadmin' + path, {
        method, headers, signal: controller.signal, credentials: 'omit', cache: 'no-store',
        ...(method === 'GET' ? {} : { body: JSON.stringify({ ...body, superAdminPassword: password }) }),
      });
      receivedResponse = true;
      if (response.status === 429) throw Error('Too many attempts. Please try again shortly.');
      if ([401, 403].includes(response.status)) {
        if (state.password && current(epoch)) lock('Platform access ended. Please sign in again.');
        throw Error('Incorrect platform password.');
      }
      let data;
      try { data = await response.json(); }
      catch { throw Object.assign(Error('Invalid server response. Please refresh.'), { uncertain: mutation }); }
      if (!response.ok) throw Object.assign(Error(data?.error || 'Request failed.'), { uncertain: mutation && response.status >= 500, refresh: response.status === 409 });
      if (mutation && data?.success !== true) throw Object.assign(Error('The change was not confirmed.'), { uncertain: true });
      return data;
    } catch (error) {
      if (mutation && !receivedResponse) error.uncertain = true;
      if (mutation && controller.signal.aborted) error.uncertain = true;
      throw error;
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  }
  function renderShops() {
    $('shops').replaceChildren();
    for (const shop of state.shops) {
      const tag = element('span', undefined, 'shop-tag');
      const remove = element('button', '×'); remove.type = 'button';
      remove.setAttribute('aria-label', 'Remove shop ' + (shop.name || shop.id));
      remove.addEventListener('click', () => { if (state.acting) return; state.shops = state.shops.filter(s => s.id !== shop.id); renderShops(); });
      tag.append(element('span', shop.name || shop.id), remove); $('shops').append(tag);
    }
  }
  function editClient(client) {
    if (state.acting || state.needsRefresh) return;
    state.editing = client.clientId; state.shops = client.shops.map(shop => ({ ...shop }));
    $('client-id').value = client.clientId; $('client-id').readOnly = true;
    $('admin-password').value = ''; $('gate-password').value = '';
    $('admin-password').required = false; $('gate-password').required = false;
    $('form-title').textContent = 'Update ' + client.clientId; $('save').textContent = 'Save changes';
    $('password-note').textContent = 'Leave either password blank to keep it unchanged.';
    renderShops(); $('admin-password').focus();
  }
  function renderClients() {
    $('list').replaceChildren();
    if (!state.clients.length) { $('list').append(element('p', 'No clients yet.')); return; }
    for (const client of state.clients) {
      const row = element('article', undefined, 'client');
      const actions = element('div', undefined, 'client-actions');
      const edit = element('button', 'Edit', 'secondary'); edit.type = 'button'; edit.addEventListener('click', () => editClient(client));
      const next = client.status === 'active' ? 'paused' : 'active';
      const toggle = element('button', next === 'paused' ? 'Pause' : 'Resume', 'secondary'); toggle.type = 'button';
      toggle.addEventListener('click', async () => {
        if (state.acting || state.needsRefresh) return;
        const epoch = state.epoch;
        if (!window.confirm(`${next === 'paused' ? 'Pause' : 'Resume'} access for ${client.clientId}?`) || !current(epoch)) return;
        await mutate('/clients/' + encodeURIComponent(client.clientId) + '/status', { expectedStatus: client.status, status: next });
      });
      actions.append(edit, toggle);
      row.append(element('strong', client.clientId), element('p', `${client.shops.length} shop${client.shops.length === 1 ? '' : 's'} · ${client.status === 'active' ? 'Active' : 'Paused'}`), actions);
      $('list').append(row);
    }
    controls();
  }
  async function loadClients() {
    if (!state.password) return;
    const epoch = state.epoch, version = ++state.listVersion;
    const reconcile = state.needsRefresh;
    state.needsRefresh = true; controls();
    message('Loading clients…');
    try {
      const clients = await request('GET', '/clients');
      if (!current(epoch) || version !== state.listVersion) return;
      if (!Array.isArray(clients) || clients.some(c => !c || typeof c.clientId !== 'string' || !c.clientId || !['active', 'paused'].includes(c.status) || !Array.isArray(c.shops) || c.shops.some(s => !s || typeof s.id !== 'string' || !s.id))) throw Error('Client records could not be read. Refresh to retry.');
      state.clients = clients; state.needsRefresh = false;
      if (reconcile) resetEditor();
      renderClients(); message(''); controls();
    } catch (error) {
      if (!current(epoch) || version !== state.listVersion) return;
      state.needsRefresh = true; message(error.message, true); controls();
    }
  }
  async function mutate(path, body, onSuccess) {
    if (!state.password || state.acting || state.needsRefresh) return;
    const epoch = state.epoch;
    state.acting = true; controls(); message('Saving…');
    try {
      await request('POST', path, body);
      if (!current(epoch)) return;
      if (onSuccess) onSuccess();
      await loadClients();
    } catch (error) {
      if (!current(epoch)) return;
      state.needsRefresh = Boolean(error.uncertain || error.refresh);
      message(error.uncertain ? 'Could not confirm the change. Refresh the client list before trying again.' : error.message, true);
    } finally { if (current(epoch)) { state.acting = false; controls(); } }
  }
  $('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (signingIn) return;
    const password = $('password').value, epoch = state.epoch;
    if (!password) return;
    signingIn = true; $('login-button').disabled = true; $('login-error').textContent = '';
    try {
      const result = await request('POST', '/verify', {}, password);
      if (!current(epoch)) return;
      if (result?.ok !== true) throw Error('Platform access was not confirmed.');
      state.password = password; state.needsRefresh = true; $('password').value = '';
      $('login').hidden = true; $('management').hidden = false;
      await loadClients();
    } catch (error) { if (current(epoch)) $('login-error').textContent = error.message; }
    finally { if (current(epoch)) { signingIn = false; $('login-button').disabled = false; } }
  });
  $('add-shop').addEventListener('click', () => {
    if (state.acting) return;
    const name = $('shop-name').value.trim(), color = $('shop-color').value;
    const id = name.replace(/\s+/g, '-').toUpperCase();
    if (!/^[A-Z0-9_-]{1,64}$/.test(id) || !/^#[a-f0-9]{6}$/i.test(color)) { message('Use a shop name with letters, numbers, spaces or hyphens and choose a colour.', true); return; }
    if (state.shops.some(shop => shop.id === id)) { message('That shop is already added.', true); return; }
    state.shops.push({ id, name, color }); renderShops(); $('shop-name').value = ''; $('shop-name').focus();
  });
  $('client-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (state.acting || state.needsRefresh || !state.password) return;
    const clientId = $('client-id').value.trim(), adminPassword = $('admin-password').value, gatePassword = $('gate-password').value;
    if (!state.editing && !/^[A-Za-z0-9_-]{1,64}$/.test(clientId)) { message('Use letters, numbers, underscores or hyphens for the Client ID.', true); return; }
    if (state.editing && clientId !== state.editing) return;
    if (!state.shops.length) { message('Add at least one shop.', true); return; }
    if (!state.editing && (!adminPassword || !gatePassword)) { message('Set both passwords for a new client.', true); return; }
    if (!state.editing && state.clients.some(c => c.clientId === clientId)) { message('That client exists. Choose Edit from the list to update it.', true); return; }
    const epoch = state.epoch;
    if (state.editing && !window.confirm(`Save changes to ${clientId}? Changing passwords or shops signs its users out.`)) return;
    if (!current(epoch)) return;
    await mutate('/clients', { clientId, adminPassword, gatePassword, shops: state.shops.map(shop => ({ ...shop })) }, resetEditor);
  });
  $('cancel').addEventListener('click', () => { if (!state.acting) resetEditor(); });
  $('refresh').addEventListener('click', () => { if (!state.acting) return loadClients(); });
  $('signout').addEventListener('click', () => { lock(); $('password').focus(); });
  window.addEventListener('pagehide', () => lock());
  window.addEventListener('pageshow', event => { if (event.persisted) lock(); });
  lock();
})();
