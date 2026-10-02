const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const setLoading = (button, active, label) => {
  const text = $('[data-button-label]', button);
  if (!text) return;
  if (!button.dataset.defaultLabel) button.dataset.defaultLabel = text.textContent;
  button.dataset.loading = String(active);
  button.disabled = active;
  text.textContent = active ? label : button.dataset.defaultLabel;
};

const menuButton = $('[data-menu-toggle]');
const navigation = $('[data-navigation]');
if (menuButton && navigation) {
  menuButton.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!open));
    navigation.classList.toggle('is-open', !open);
    document.body.classList.toggle('menu-open', !open);
  });
  $$('a', navigation).forEach((link) => link.addEventListener('click', () => {
    menuButton.setAttribute('aria-expanded', 'false');
    navigation.classList.remove('is-open');
    document.body.classList.remove('menu-open');
  }));
}

const form = $('[data-interest-form]');
const firstName = $('[data-name-input]');
const email = $('[data-email-input]');
const status = $('[data-form-status]');
const clearButton = $('[data-clear-interest]');
const role = $('#role');

const normalizeName = (value) => value
  .normalize('NFC')
  .replace(/[^\p{L}\p{M}\s'-]/gu, '')
  .replace(/\s{2,}/g, ' ')
  .slice(0, 50);

const normalizeEmail = (value) => value
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9.!#$%&'*+/=?^_`{|}~@-]/g, '')
  .slice(0, 254);

const validEmail = (value) => /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(value);

const updateClearState = () => {
  let hasInterest = false;
  try { hasInterest = Boolean(sessionStorage.getItem('tikisse-interest')); } catch { hasInterest = false; }
  if (clearButton) clearButton.disabled = !hasInterest;
};

const showStatus = (message, type = '') => {
  status.textContent = message;
  status.className = `form-status ${type}`.trim();
};

const focusField = (field) => {
  window.setTimeout(() => field?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
};

$$('[data-open-interest]').forEach((button) => button.addEventListener('click', () => {
  setLoading(button, true, 'Ouverture…');
  window.setTimeout(() => {
    document.querySelector('#interet')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    focusField(firstName || email);
    setLoading(button, false, '');
  }, 220);
}));

[firstName, email].filter(Boolean).forEach((field) => field.addEventListener('focus', () => focusField(field)));
if (firstName) firstName.addEventListener('input', () => {
  const clean = normalizeName(firstName.value);
  if (firstName.value !== clean) firstName.value = clean;
  firstName.setAttribute('aria-invalid', 'false');
});
if (email) email.addEventListener('input', () => {
  const clean = normalizeEmail(email.value);
  if (email.value !== clean) email.value = clean;
  email.setAttribute('aria-invalid', 'false');
});

if (form && firstName && email && role) form.addEventListener('submit', (event) => {
  event.preventDefault();
  const submit = $('button[type="submit"]', form);
  const safeName = normalizeName(firstName.value).trim();
  const safeEmail = normalizeEmail(email.value);
  const safeRole = ['expediteur', 'livreur', 'partenaire'].includes(role.value) ? role.value : '';
  firstName.value = safeName;
  email.value = safeEmail;
  firstName.setAttribute('aria-invalid', String(Boolean(safeName && safeName.length < 2)));
  email.setAttribute('aria-invalid', String(!validEmail(safeEmail)));
  role.setAttribute('aria-invalid', String(!safeRole));
  if (safeName && safeName.length < 2) return showStatus('Le prénom doit contenir au moins deux lettres.', 'is-error');
  if (!validEmail(safeEmail)) return showStatus('Indiquez une adresse e-mail valide.', 'is-error');
  if (!safeRole) return showStatus('Choisissez le profil qui vous correspond.', 'is-error');
  setLoading(submit, true, 'Enregistrement…');
  showStatus('Vérification locale en cours…');
  window.setTimeout(() => {
    try { sessionStorage.setItem('tikisse-interest', JSON.stringify({ firstName: safeName, email: safeEmail, role: safeRole })); } catch {}
    form.reset();
    updateClearState();
    setLoading(submit, false, '');
    showStatus('Votre intérêt est mémorisé uniquement dans cette session de navigation. Aucun envoi n’a été effectué.', 'is-success');
  }, 600);
});

if (clearButton) clearButton.addEventListener('click', () => {
  setLoading(clearButton, true, 'Effacement…');
  window.setTimeout(() => {
    try { sessionStorage.removeItem('tikisse-interest'); } catch {}
    updateClearState();
    setLoading(clearButton, false, '');
    showStatus('L’intérêt mémorisé dans cette session a été effacé.', 'is-success');
  }, 320);
});

updateClearState();
const year = $('[data-current-year]');
if (year) year.textContent = new Date().getFullYear();
