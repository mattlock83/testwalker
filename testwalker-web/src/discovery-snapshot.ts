// Generic read-only inventory; selectors are observations and never enter the model.
export const BUTTONS = `() => {
  const roots = [document];
  for (let i = 0; i < roots.length; i++)
    for (const e of roots[i].querySelectorAll('*')) if (e.shadowRoot) roots.push(e.shadowRoot);
  return roots.flatMap(root => [...root.querySelectorAll('button,input[type=button],input[type=submit],[role=button],[role=combobox],[role=option]')]);
}`;
export const SNAPSHOT = `() => {
  const visible = e => !!e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  const label = e => (e.getAttribute('aria-label') ||
    (e.getAttribute('aria-labelledby') || '').split(/\\s+/).map(id => document.getElementById(id)?.innerText || '').join(' ').trim() ||
    [...(e.labels || [])].map(l => l.innerText).join(' ').trim() ||
    e.innerText || e.getAttribute('placeholder') || e.getAttribute('name') || e.value || e.tagName).trim().slice(0, 300);
  const fields = form => [...form.elements].map((e, index) => ({
    index, name: e.name || '', label: label(e), tag: e.tagName.toLowerCase(),
    type: e.type || 'text', visible: visible(e), disabled: e.disabled, readonly: e.readOnly || false,
    required: e.required || false, value: e.type === 'password' ? '' : e.value,
    checked: e.checked || false, multiple: e.multiple || false,
    min: e.getAttribute('min'), max: e.getAttribute('max'), step: e.getAttribute('step'),
    minLength: e.getAttribute('minlength'), maxLength: e.getAttribute('maxlength'),
    pattern: e.getAttribute('pattern'), hint: (e.getAttribute('aria-describedby') || '').split(/\\s+/).map(id => document.getElementById(id)?.innerText || '').join(' ').trim(),
    options: e.options ? [...e.options].map(o => ({value: o.value, label: o.label, disabled: o.disabled})) : [],
    action: e.hasAttribute('formaction') ? e.formAction : null,
    method: e.hasAttribute('formmethod') ? e.formMethod : null
  }));
  return {
    url: location.href, title: document.title,
    headings: [...document.querySelectorAll('h1,h2,[role=heading]')].filter(visible).map(label).slice(0, 30),
    text: (document.body?.innerText || '').slice(0, 12000),
    links: [...document.querySelectorAll('a[href]')].filter(visible).map(e => ({
      label: label(e), url: e.href, download: e.hasAttribute('download')
    })),
    forms: [...document.forms].map((f, index) => ({
      index, label: f.getAttribute('aria-label') || f.getAttribute('name') || \`Form \${index + 1}\`,
      action: f.action, method: f.method, fields: fields(f)
    })),
    alerts: [...document.querySelectorAll('[role=alert],[role=status]')].filter(visible).map(label),
    buttons: (${BUTTONS})().map((e, index) => ({index, label: label(e), type: e.type || e.getAttribute('role'), role: e.getAttribute('role'), visible: visible(e), disabled: e.disabled || e.getAttribute('aria-disabled') === 'true', submit: !!e.form && ['submit', 'image'].includes(e.type)})).filter(e => e.visible),
    frames: [...document.querySelectorAll('iframe')].map(e => e.src)
  };
}`;
