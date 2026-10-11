// Generic read-only inventory; selectors are observations and never enter the model.
export const BUTTONS = `() => {
  const roots = [document];
  for (let i = 0; i < roots.length; i++)
    for (const e of roots[i].querySelectorAll('*')) if (e.shadowRoot) roots.push(e.shadowRoot);
  return roots.flatMap(root => [...root.querySelectorAll('button,input[type=button],input[type=submit],[role=button],[role=combobox],[role=option]')]);
}`;
export const SELECTS = `() => {
  const roots = [document];
  for (let i = 0; i < roots.length; i++)
    for (const e of roots[i].querySelectorAll('*')) if (e.shadowRoot) roots.push(e.shadowRoot);
  return roots.flatMap(root => [...root.querySelectorAll('select')]).filter(e => !e.form);
}`;
export const SNAPSHOT = `() => {
  const visible = e => {
    for (let node = e; node; node = node.parentElement || node.getRootNode()?.host)
      if (node.hidden || node.inert || node.getAttribute('aria-hidden') === 'true') return false;
    return !!e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  };
  // Off-screen controls can be scrolled into view by Playwright. For controls
  // already in the viewport, require an exposed point; never force past overlays.
  const actionable = e => {
    if (!visible(e)) return false;
    const rect = e.getBoundingClientRect();
    const inside = hit => {
      for (let node = hit; node; node = node.parentElement || node.getRootNode()?.host)
        if (node === e) return true;
      return false;
    };
    const left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
    const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
    const offscreen = rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth;
    const px = offscreen ? Math.max(1, Math.min(innerWidth - 1, rect.x + rect.width / 2)) : (left + right) / 2;
    const py = offscreen ? innerHeight / 2 : (top + bottom) / 2;
    let hit = document.elementFromPoint(px, py);
    while (hit?.shadowRoot) {
      const child = hit.shadowRoot.elementFromPoint(px, py);
      if (!child || child === hit) break;
      hit = child;
    }
    if (!offscreen) return inside(hit);
    // Scrolling the document cannot expose a control underneath a fixed layer.
    for (let node = hit; node; node = node.parentElement || node.getRootNode()?.host)
      if (['fixed','sticky'].includes(getComputedStyle(node).position) && !node.contains(e)) return false;
    return true;
  };
  const labelText = e => [...(e.labels || [])].map(l => {
    const copy = l.cloneNode(true);
    for (const control of copy.querySelectorAll('input,select,textarea,button')) control.remove();
    return copy.textContent || '';
  }).join(' ').trim();
  const label = e => (e.getAttribute('aria-label') ||
    (e.getAttribute('aria-labelledby') || '').split(/\\s+/).map(id => document.getElementById(id)?.innerText || '').join(' ').trim() ||
    labelText(e) || (e.tagName === 'SELECT' ? e.getAttribute('name') : '') ||
    e.innerText || (['submit','button','reset'].includes(e.type) ? e.value : '') || e.getAttribute('placeholder') || e.getAttribute('name') || e.value || e.tagName).trim().slice(0, 300);
  const fields = form => [...form.elements].map((e, index) => ({
    index, name: e.name || '', label: label(e), tag: e.tagName.toLowerCase(),
    type: e.type || 'text', visible: visible(e), actionable: actionable(e), disabled: e.matches(':disabled'), readonly: e.readOnly || false,
    required: e.required || false, value: e.type === 'password' ? '' : e.value,
    checked: e.checked || false, multiple: e.multiple || false,
    min: e.getAttribute('min'), max: e.getAttribute('max'), step: e.getAttribute('step'),
    minLength: e.getAttribute('minlength'), maxLength: e.getAttribute('maxlength'),
    pattern: e.getAttribute('pattern'), hint: (e.getAttribute('aria-describedby') || '').split(/\\s+/).map(id => document.getElementById(id)?.innerText || '').join(' ').trim(),
    options: e.options ? [...e.options].map(o => ({value: o.value, label: o.label, disabled: o.disabled || !!o.closest('optgroup[disabled]')})) : [],
    action: e.hasAttribute('formaction') ? e.formAction : null,
    method: e.hasAttribute('formmethod') ? e.formMethod : null
  }));
  const headings = [...document.querySelectorAll('h1,h2,[role=heading]')].filter(visible).map(label).slice(0, 30);
  const prominent = headings.length ? null : [...document.querySelectorAll('main *,[role=main] *,span,p,div')].find(e => {
    const text = label(e), style = getComputedStyle(e);
    return visible(e) && !e.children.length && !!e.innerText?.trim() && text.length > 1 && text.length <= 100 &&
      text.toLowerCase() !== document.title.toLowerCase() &&
      !e.closest('a,button,form,nav,[role=button],[role=navigation]') &&
      parseFloat(style.fontSize) >= 18;
  });
  return {
    page_label: headings[0] || (prominent && label(prominent)) || document.title,
    busy: [...document.querySelectorAll('[aria-busy=true],[role=progressbar]')].some(visible),
    url: location.href, title: document.title,
    headings,
    text: (document.body?.innerText || '').slice(0, 12000),
    links: [...document.querySelectorAll('a[href]')].map((e, dom_index) => ({
      label: label(e), url: e.href, download: e.hasAttribute('download'), dom_index, visible: visible(e), actionable: actionable(e)
    })).filter(e => e.visible),
    forms: [...document.forms].map((f, index) => ({
      index, label: f.getAttribute('aria-label') || f.getAttribute('name') || \`Form \${index + 1}\`,
      action: f.action, method: f.method, fields: fields(f)
    })),
    alerts: [...document.querySelectorAll('[role=alert],[role=status]')].filter(visible).map(label),
    buttons: (${BUTTONS})().map((e, index) => ({index, label: label(e), type: e.type || e.getAttribute('role'), role: e.getAttribute('role'), visible: visible(e), actionable: actionable(e), href: e.closest('a[href]')?.href || null, disabled: e.matches(':disabled') || e.getAttribute('aria-disabled') === 'true', submit: !!e.form && ['submit', 'image'].includes(e.type)})).filter(e => e.visible),
    selects: (${SELECTS})().map((e, index) => ({
      index, name: e.name || '', label: label(e), visible: visible(e), actionable: actionable(e),
      disabled: e.matches(':disabled'), multiple: e.multiple, values: [...e.selectedOptions].map(o => o.value),
      options: [...e.options].map(o => ({value: o.value, label: o.label, disabled: o.disabled || !!o.closest('optgroup[disabled]')}))
    })).filter(e => e.visible),
    frames: [...document.querySelectorAll('iframe')].map(e => e.src)
  };
}`;
