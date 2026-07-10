const statusEl = document.getElementById('status');
const artifactsEl = document.getElementById('artifacts');
const rawEl = document.getElementById('raw');
const refreshBtn = document.getElementById('refresh');

function text(value) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function card(label, value) {
  const article = document.createElement('article');
  article.className = 'card';
  const span = document.createElement('span');
  span.textContent = label;
  const strong = document.createElement('strong');
  strong.textContent = text(value);
  article.append(span, strong);
  return article;
}

function render(data) {
  statusEl.replaceChildren(
    card('API', 'online'),
    card('Commit', data.repo?.commit),
    card('Profiles', data.counts?.community_profiles),
    card('Bundles', data.counts?.bundles),
    card('Branch', data.repo?.branch),
    card('Dirty tree', data.repo?.dirty ? 'yes' : 'no'),
    card('Vehicle connected', data.runtime?.vehicle_connected ? 'yes' : 'no'),
    card('Mode', data.runtime?.mode),
  );

  const artifacts = data.artifacts || [];
  artifactsEl.replaceChildren(...(artifacts.length ? artifacts.map((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    return li;
  }) : [document.createElement('li')]));
  if (!artifacts.length) artifactsEl.firstChild.textContent = 'No release bundles found yet.';

  rawEl.textContent = JSON.stringify(data, null, 2);
}

async function loadDashboard() {
  refreshBtn.disabled = true;
  try {
    const response = await fetch('/api/dashboard', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
  } catch (error) {
    statusEl.replaceChildren(card('API', `offline: ${error.message}`));
    artifactsEl.replaceChildren();
    const li = document.createElement('li');
    li.textContent = 'API unreachable. Static frontend loaded.';
    artifactsEl.append(li);
    rawEl.textContent = '';
  } finally {
    refreshBtn.disabled = false;
  }
}

refreshBtn.addEventListener('click', loadDashboard);
loadDashboard();
