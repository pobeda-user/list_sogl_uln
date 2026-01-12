(function () {
  const DEFAULT_API_BASE = 'https://script.google.com/macros/s/AKfycbxrJairDbTrXGCoCYJ3T6a8jOPBWPl1mdYw8te3LwNeWbw-LVkPBZ0mMFpmltXVnevS/exec';
  const LS_API_BASE = 'lk_api_base';
  const LS_OWNER = 'lk_owner';
  const LS_MANAGER = 'lk_manager';
  const LS_MANAGERS_CACHE_PREFIX = 'lk_cached_managers_v2_';

  const el = (id) => document.getElementById(id);

  const viewSettings = el('viewSettings');
  const viewSelect = el('viewSelect');
  const viewRequests = el('viewRequests');
  const viewError = el('viewError');

  const ownerLogo = el('ownerLogo');

  const apiBaseInput = el('apiBase');
  const btnOpenRequests = el('btnOpenRequests');
  const btnRefreshManagers = el('btnRefreshManagers');
  const managerSearch = el('managerSearch');
  const managersGrid = el('managersGrid');
  const btnSettings = el('btnSettings');
  const btnCloseSettings = el('btnCloseSettings');
  const btnSaveApi = el('btnSaveApi');
  const btnBack = el('btnBack');

  const selectMeta = el('selectMeta');
  const requestsMeta = el('requestsMeta');
  const requestsList = el('requestsList');
  const requestsTitle = el('requestsTitle');
  const requestsSubtitle = el('requestsSubtitle');

  const btnRefreshRequests = el('btnRefreshRequests');
  const btnHome = el('btnHome');

  const footerStatus = el('footerStatus');
  const statusFilter = el('statusFilter');
  const searchInput = el('searchInput');

  const errorSubtitle = el('errorSubtitle');
  const btnErrorToSettings = el('btnErrorToSettings');

  let state = {
    owner: localStorage.getItem(LS_OWNER) || '',
    apiBase: localStorage.getItem(LS_API_BASE) || DEFAULT_API_BASE,
    manager: safeJsonParse_(localStorage.getItem(LS_MANAGER)) || null,
    managers: [],
    managersLoading: false,
    requests: [],
    lastFetch: null
  };

  const managersInFlight_ = new Map();
  let managersLoadToken_ = 0;

  function normalizeStoredManager_(m) {
    if (!m || typeof m !== 'object') return null;

    // New format: { name, emails: [] }
    if (m.name && Array.isArray(m.emails)) {
      const emails = m.emails.filter(Boolean).map(e => String(e).trim().toLowerCase()).filter(Boolean);
      if (!emails.length) return null;
      return { name: String(m.name).trim(), emails, owner: m.owner || '' };
    }

    // Old format: { name, email }
    if (m.name && m.email) {
      const email = String(m.email).trim().toLowerCase();
      if (!email) return null;
      return { name: String(m.name).trim(), emails: [email], owner: m.owner || '' };
    }

    return null;
  }

  function safeJsonParse_(s) {
    try {
      if (!s) return null;
      return JSON.parse(s);
    } catch {
      return null;
    }
  }

  function setStatus(text) {
    footerStatus.textContent = text;
  }

  function setButtonLoading_(button, isLoading) {
    if (!button) return;
    button.disabled = !!isLoading;
    button.setAttribute('data-loading', isLoading ? '1' : '0');
  }

  function setManagersLoading_(isLoading) {
    state.managersLoading = !!isLoading;
    // Render skeletons inside the grid
    if (!managersGrid) return;
    if (!isLoading) return;
    const skeletonCount = 12;
    managersGrid.innerHTML = '';
    for (let i = 0; i < skeletonCount; i++) {
      const d = document.createElement('div');
      d.className = 'cardItem skeleton';
      d.innerHTML = '<div class="cardItem__name">&nbsp;</div><div class="cardItem__emails">&nbsp;</div>';
      managersGrid.appendChild(d);
    }
  }

  function clearManagersLoading_() {
    state.managersLoading = false;
  }

  function show(view) {
    viewSettings.classList.add('hidden');
    viewSelect.classList.add('hidden');
    viewRequests.classList.add('hidden');
    viewError.classList.add('hidden');

    view.classList.remove('hidden');
  }

  function setOwnerButtonsActive(owner) {
    document.querySelectorAll('[data-owner]').forEach((btn) => {
      btn.setAttribute('data-active', btn.getAttribute('data-owner') === owner ? '1' : '0');
    });
  }

  function requireApiBase_() {
    if (!state.apiBase) {
      showError('Не указан URL API. Открой Настройки и вставь URL Web App (gs2).');
      return false;
    }
    return true;
  }

  function normalizeApiBase_(base) {
    if (!base) return '';
    let b = base.trim();
    b = b.replace(/\/+$/, '');
    return b;
  }

  function jsonp_(url, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const cbName = `__lkcb_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
      const sep = url.includes('?') ? '&' : '?';
      const fullUrl = `${url}${sep}callback=${cbName}`;

      const script = document.createElement('script');
      script.src = fullUrl;
      script.async = true;

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('timeout'));
      }, timeoutMs);

      function cleanup() {
        clearTimeout(timer);
        delete window[cbName];
        if (script && script.parentNode) script.parentNode.removeChild(script);
      }

      window[cbName] = (data) => {
        cleanup();
        resolve(data);
      };

      script.onerror = () => {
        cleanup();
        reject(new Error('network'));
      };

      document.head.appendChild(script);
    });
  }

  function showError(msg) {
    errorSubtitle.textContent = msg;
    show(viewError);
  }

  function cacheKey_(suffix) {
    return `lk_cache_${suffix}`;
  }

  function managersCacheKey_(owner) {
    return `${LS_MANAGERS_CACHE_PREFIX}${owner}`;
  }

  function saveManagersCache_(owner, managers) {
    if (!owner) return;
    const today = new Date();
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    localStorage.setItem(managersCacheKey_(owner), JSON.stringify({ day, managers }));
  }

  function loadManagersCache_(owner) {
    if (!owner) return null;
    const raw = localStorage.getItem(managersCacheKey_(owner));
    const parsed = safeJsonParse_(raw);
    if (!parsed || !parsed.day || !Array.isArray(parsed.managers)) return null;
    return parsed;
  }

  function saveCache_(owner, email, payload) {
    const key = cacheKey_(`requests_${owner}_${email}`);
    localStorage.setItem(key, JSON.stringify({
      savedAt: new Date().toISOString(),
      payload: payload
    }));
  }

  function loadCache_(owner, email) {
    const key = cacheKey_(`requests_${owner}_${email}`);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return safeJsonParse_(raw);
  }

  function badgeClass_(status) {
    const s = (status || '').toString().trim().toLowerCase();
    if (s === 'не согласовано') return 'badge badge--bad';
    if (s === 'согласовано') return 'badge badge--ok';
    if (s === 'ожидание росписи') return 'badge badge--sign';
    if (s === 'частично согласовано') return 'badge badge--partial';
    if (s.includes('ожида')) return 'badge badge--wait';
    return 'badge';
  }

  function setOwnerLogo_(owner) {
    const o = (owner || '').toString().trim();
    let src = '';
    if (o === 'Победа') src = './assets/pobeda.png';
    if (o === 'Гулливер') src = './assets/gulliver.png';

    if (!src) {
      ownerLogo.style.display = 'none';
      ownerLogo.removeAttribute('src');
      return;
    }

    ownerLogo.style.display = 'block';
    ownerLogo.src = src;
  }

  function fmtDate_(val) {
    if (!val) return '';
    try {
      const d = new Date(val);
      if (Number.isNaN(d.getTime())) return String(val);
      return d.toLocaleString('ru-RU');
    } catch {
      return String(val);
    }
  }

  function normalize_(s) {
    return (s || '').toString().trim().toLowerCase();
  }

  function filteredManagers_() {
    const q = normalize_(managerSearch ? managerSearch.value : '');
    if (!q) return state.managers || [];
    return (state.managers || []).filter(m => normalize_(m.name).includes(q));
  }

  function renderManagers_() {
    if (!managersGrid) return;

    if (!state.owner) {
      managersGrid.innerHTML = '';
      selectMeta.textContent = 'Выбери объект';
      btnOpenRequests.disabled = true;
      return;
    }

    if (state.managersLoading && (!state.managers || !state.managers.length)) {
      // Keep skeletons / loading UI; don't flash empty-state.
      btnOpenRequests.disabled = true;
      return;
    }

    const list = filteredManagers_();
    managersGrid.innerHTML = '';

    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'hint';
      empty.innerHTML = '<div class="hint__title">Список пуст</div><div class="hint__text">Нажми “Обновить список” или проверь фильтр.</div>';
      managersGrid.appendChild(empty);
      selectMeta.textContent = 'Менеджеров: 0';
      btnOpenRequests.disabled = true;
      return;
    }

    const selectedKey = state.manager ? `${state.manager.name}::${(state.manager.emails || []).join(',')}` : '';

    for (const m of list) {
      const emails = Array.isArray(m.emails) ? m.emails : [];
      const key = `${m.name}::${emails.join(',')}`;

      const card = document.createElement('div');
      card.className = 'cardItem';
      card.setAttribute('data-active', key === selectedKey ? '1' : '0');
      card.innerHTML = `
        <div class="cardItem__name">${escapeHtml_(m.name || '')}</div>
        <div class="cardItem__emails">${escapeHtml_(emails.join(', '))}</div>
      `;

      card.addEventListener('click', () => {
        state.manager = { name: m.name, emails: emails, owner: m.owner };
        localStorage.setItem(LS_MANAGER, JSON.stringify(state.manager));
        btnOpenRequests.disabled = !(emails && emails.length);
        renderManagers_();
      });

      managersGrid.appendChild(card);
    }

    selectMeta.textContent = `Менеджеров: ${state.managers.length} · Показано: ${list.length}`;
    btnOpenRequests.disabled = !(state.manager && Array.isArray(state.manager.emails) && state.manager.emails.length);
  }

  async function loadManagers_() {
    if (!requireApiBase_()) return;
    if (!state.owner) return;

    const owner = state.owner;
    const token = ++managersLoadToken_;

    // Fast path: show cached list first (no spinner)
    const cached = loadManagersCache_(owner);
    const hasCached = !!(cached && Array.isArray(cached.managers) && cached.managers.length);
    if (hasCached) {
      state.managers = cached.managers;
      renderManagers_();
      setStatus('Менеджеры из кеша');
    } else {
      setManagersLoading_(true);
      setStatus('Загрузка менеджеров...');
      selectMeta.textContent = 'Загрузка списка менеджеров…';
    }

    // Deduplicate in-flight request per owner
    if (!managersInFlight_.has(owner)) {
      const url = `${state.apiBase}?action=managers&owner=${encodeURIComponent(owner)}`;
      const p = jsonp_(url)
        .finally(() => {
          managersInFlight_.delete(owner);
        });
      managersInFlight_.set(owner, p);
    }

    try {
      const data = await managersInFlight_.get(owner);

      if (!data || !data.ok) {
        throw new Error((data && data.error) ? data.error : 'Не удалось загрузить менеджеров');
      }

      // Only apply if user is still on same owner
      if (token === managersLoadToken_ && state.owner === owner) {
        state.managers = data.managers || [];
        saveManagersCache_(owner, state.managers);
        renderManagers_();
        setStatus('Готово');
      }
    } catch (e) {
      // If we already showed cached managers, don't crash the UI.
      if (!hasCached) {
        throw e;
      }
    } finally {
      // Always hide spinner even on error
      if (token === managersLoadToken_) {
        clearManagersLoading_();
      }
    }
  }

  function computeRequestSearchText_(req) {
    const parts = [
      req.requestId,
      req.supplierName,
      req.status,
      req.managerName
    ];

    const pos = req.positions || [];
    for (const p of pos) {
      parts.push(p.lkInputCode, p.lkOutputCode, p.inputName, p.outputName);
    }

    return parts.filter(Boolean).join(' ').toLowerCase();
  }

  function filterRequests_() {
    const q = (searchInput.value || '').trim().toLowerCase();
    const st = (statusFilter.value || '').trim();

    return (state.requests || []).filter((r) => {
      if (st && (r.status || '') !== st) return false;
      if (!q) return true;
      const text = r.__searchText || (r.__searchText = computeRequestSearchText_(r));
      return text.includes(q);
    });
  }

  function renderRequests_() {
    const filtered = filterRequests_();

    const metaParts = [];
    metaParts.push(`Заявок: ${filtered.length}/${(state.requests || []).length}`);
    if (state.lastFetch) metaParts.push(`Обновлено: ${state.lastFetch.toLocaleString('ru-RU')}`);
    requestsMeta.textContent = metaParts.join(' · ');

    requestsList.innerHTML = '';

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'hint';
      empty.innerHTML = '<div class="hint__title">Ничего не найдено</div><div class="hint__text">Поменяй фильтр/поиск или нажми “Обновить”.</div>';
      requestsList.appendChild(empty);
      return;
    }

    for (const req of filtered) {
      const wrap = document.createElement('div');
      wrap.className = 'req';

      const top = document.createElement('div');
      top.className = 'req__top';

      const left = document.createElement('div');
      left.innerHTML = `<div class="req__id">${escapeHtml_(req.requestId || '')}</div>`;

      const right = document.createElement('div');
      right.innerHTML = `<span class="${badgeClass_(req.status)}">${escapeHtml_(req.status || '—')}</span>`;

      top.appendChild(left);
      top.appendChild(right);

      const sub = document.createElement('div');
      sub.className = 'req__sub';
      const positionsCount = (req.positions || []).length;
      sub.innerHTML = `
        <div>Поставщик: <b>${escapeHtml_(req.supplierName || '—')}</b></div>
        <div>Дата: <b>${escapeHtml_(fmtDate_(req.createdAt) || '—')}</b></div>
        <div>Позиций: <b>${positionsCount}</b></div>
      `;

      const table = document.createElement('table');
      table.className = 'table';
      table.innerHTML = `
        <thead>
          <tr>
            <th>ЛК Ввод</th>
            <th>Наим. Ввод</th>
            <th>ЛК Вывод</th>
            <th>Наим. Вывод</th>
            <th>Склад</th>
            <th>Кластер</th>
            <th>Статус</th>
            <th>Комментарий</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;

      const tbody = table.querySelector('tbody');
      for (const p of (req.positions || [])) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml_(p.lkInputCode || '')}</td>
          <td>${escapeHtml_(p.inputName || '')}</td>
          <td>${escapeHtml_(p.lkOutputCode || '')}</td>
          <td>${escapeHtml_(p.outputName || '')}</td>
          <td>${escapeHtml_(p.warehouseType || '')}</td>
          <td>${escapeHtml_(p.cluster || '')}</td>
          <td><span class="${badgeClass_(p.status)}">${escapeHtml_(p.status || '—')}</span></td>
          <td>${escapeHtml_(p.approverComment || '')}</td>
        `;
        tbody.appendChild(tr);
      }

      wrap.appendChild(top);
      wrap.appendChild(sub);
      wrap.appendChild(table);

      requestsList.appendChild(wrap);
    }
  }

  function escapeHtml_(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  async function loadRequests_() {
    if (!requireApiBase_()) return;
    if (!state.owner) return;
    if (!state.manager || !Array.isArray(state.manager.emails) || !state.manager.emails.length) {
      throw new Error('Менеджер не выбран');
    }

    setStatus('Загрузка заявок...');

    const emailList = state.manager.emails.join(',');
    const url = `${state.apiBase}?action=requests&owner=${encodeURIComponent(state.owner)}&email=${encodeURIComponent(emailList)}`;

    try {
      const data = await jsonp_(url);

      if (!data || !data.ok) {
        throw new Error((data && data.error) ? data.error : 'Не удалось загрузить заявки');
      }

      state.requests = data.requests || [];
      state.lastFetch = new Date();
      saveCache_(state.owner, state.manager.emails.join(','), data);

      setStatus('Готово');
    } catch (err) {
      const cached = loadCache_(state.owner, state.manager.emails.join(','));
      if (cached && cached.payload && cached.payload.ok) {
        state.requests = cached.payload.requests || [];
        state.lastFetch = new Date(cached.savedAt);
        setStatus('Оффлайн: показаны последние данные');
      } else {
        throw err;
      }
    }
  }

  function openRequestsView_() {
    requestsTitle.textContent = `Заявки — ${state.owner}`;
    requestsSubtitle.textContent = `${state.manager.name} · ${state.manager.emails.join(', ')}`;
    show(viewRequests);
    renderRequests_();
  }

  function openSelectView_() {
    show(viewSelect);
  }

  function openSettingsView_() {
    apiBaseInput.value = state.apiBase || '';
    show(viewSettings);
  }

  async function refreshAll_() {
    if (!requireApiBase_()) return;

    if (viewRequests.classList.contains('hidden')) {
      if (state.owner) {
        await loadManagers_();
      }
      return;
    }

    await loadRequests_();
    renderRequests_();
  }

  function bindEvents_() {
    document.querySelectorAll('[data-owner]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const owner = btn.getAttribute('data-owner');
        if (!owner) return;

        state.owner = owner;
        localStorage.setItem(LS_OWNER, owner);

        setOwnerLogo_(owner);

        state.manager = null;
        localStorage.removeItem(LS_MANAGER);

        setOwnerButtonsActive(owner);
        btnOpenRequests.disabled = true;

        if (managerSearch) managerSearch.value = '';
        setManagersLoading_(true);

        try {
          await loadManagers_();
        } catch (err) {
          showError(String(err && err.message ? err.message : err));
        }
      });
    });

    if (managerSearch) {
      managerSearch.addEventListener('input', () => renderManagers_());
    }

    if (btnRefreshManagers) {
      btnRefreshManagers.addEventListener('click', async () => {
        try {
          // force reload ignoring cache by clearing cached entry
          localStorage.removeItem(managersCacheKey_(state.owner));
          await loadManagers_();
        } catch (err) {
          showError(String(err && err.message ? err.message : err));
        }
      });
    }

    btnOpenRequests.addEventListener('click', async () => {
      try {
        if (!state.manager || !Array.isArray(state.manager.emails) || !state.manager.emails.length) {
          showError('Выбери менеджера перед открытием заявок');
          return;
        }
        await loadRequests_();
        openRequestsView_();
      } catch (err) {
        showError(String(err && err.message ? err.message : err));
      }
    });

    btnSettings.addEventListener('click', openSettingsView_);
    btnCloseSettings.addEventListener('click', openSelectView_);

    btnSaveApi.addEventListener('click', () => {
      state.apiBase = normalizeApiBase_(apiBaseInput.value);
      localStorage.setItem(LS_API_BASE, state.apiBase);
      setStatus('Сохранено');
      openSelectView_();
    });

    btnBack.addEventListener('click', () => {
      openSelectView_();
    });

    if (btnRefreshRequests) {
      btnRefreshRequests.addEventListener('click', async () => {
        try {
          setButtonLoading_(btnRefreshRequests, true);
          await refreshAll_();
        } catch (err) {
          showError(String(err && err.message ? err.message : err));
        } finally {
          setButtonLoading_(btnRefreshRequests, false);
        }
      });
    }

    if (btnHome) {
      btnHome.addEventListener('click', () => {
        openSelectView_();
      });
    }

    statusFilter.addEventListener('change', () => renderRequests_());
    searchInput.addEventListener('input', () => renderRequests_());

    btnErrorToSettings.addEventListener('click', openSettingsView_);
  }

  function init_() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    // Migrate old stored manager format if needed
    state.manager = normalizeStoredManager_(state.manager);
    if (state.manager) {
      localStorage.setItem(LS_MANAGER, JSON.stringify(state.manager));
    } else {
      localStorage.removeItem(LS_MANAGER);
    }

    bindEvents_();

    if (state.owner) {
      setOwnerButtonsActive(state.owner);
      setOwnerLogo_(state.owner);
    }

    if (!state.apiBase) {
      setStatus('Нужен URL API');
    }

    renderManagers_();

    // If owner is already selected from previous session, load managers immediately.
    if (state.owner) {
      loadManagers_().catch((err) => {
        showError(String(err && err.message ? err.message : err));
      });
    }
  }

  init_();
})();
