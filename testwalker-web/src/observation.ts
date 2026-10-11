import type { Page } from "playwright";
import type { Json } from "./types.js";
import { Inconclusive } from "./types.js";

// Read-only generic rendered evidence, including offscreen controls and linked errors.
export const SEMANTICS = `(() => {
  const rendered = e => {
    const r = e.getBoundingClientRect();
    return r.width && r.height && e.checkVisibility({checkOpacity:true, checkVisibilityCSS:true});
  };
  const visible = e => {
    const r = e.getBoundingClientRect();
    return r.width && r.height && r.bottom > 0 && r.top < innerHeight &&
      e.checkVisibility({checkOpacity:true, checkVisibilityCSS:true});
  };
  const messages = role => [...document.querySelectorAll(\`[role="\${role}"]\`)]
    .filter(visible).slice(0, 20).map(e => e.innerText.slice(0, 4000));
  const fieldPosition = e => {
    const r = e.getBoundingClientRect(), y = r.y + r.height / 2, x = r.x + r.width / 2;
    return {in_viewport: y >= 0 && y < innerHeight && x >= 0 && x < innerWidth,
      scroll_direction: y < 0 ? 'up' : y >= innerHeight ? 'down' : null};
  };
  return {
    alerts: messages('alert'),
    status: messages('status'),
    editable_fields: [...document.querySelectorAll('input,textarea,select')]
      .filter(e => rendered(e) && !e.disabled && !e.readOnly).slice(0, 50).map(e => ({
        label: [...(e.labels || [])].map(l => l.innerText).join(' ') || e.getAttribute('aria-label') || '',
        current_value: e.value,
        ...fieldPosition(e)
      })),
    available_links: [...document.querySelectorAll('a[href],[role="link"]')]
      .filter(e => rendered(e) && e.getAttribute('aria-disabled') !== 'true')
      .slice(0, 100).map(e => ({
        label: e.getAttribute('aria-label') || e.innerText,
        href: e.href || null,
        in_navigation: Boolean(e.closest('nav,[role="navigation"]')),
        ...fieldPosition(e)
      })),
    available_buttons: [...document.querySelectorAll('button,[role="button"]')]
      .filter(e => rendered(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true')
      .slice(0, 50).map(e => ({
        label: e.getAttribute('aria-label') || e.innerText, ...fieldPosition(e)
      })),
    invalid_fields: [...document.querySelectorAll('[aria-invalid="true"]')]
      .filter(visible).slice(0, 50).map(e => ({
        label: [...(e.labels || [])].map(l => l.innerText).join(' ') || e.getAttribute('aria-label') || '',
        explanation: (e.getAttribute('aria-describedby') || '').split(/\\s+/)
          .map(id => document.getElementById(id)?.innerText || '').join(' ').slice(0, 4000),
        validation_messages: [...new Set([
          ...(e.getAttribute('aria-errormessage') || '').split(/\\s+/).filter(Boolean),
          ...(e.getAttribute('aria-describedby') || '').split(/\\s+/).filter(id =>
            document.getElementById(id)?.closest('[role="alert"]'))
        ])].map(id => document.getElementById(id)?.innerText || '').filter(Boolean)
      }))
  };
})()`;

export async function observe(page: Page): Promise<Json> {
  await page.waitForLoadState("domcontentloaded");
  const snapshot = `(() => ({url: location.href, title: document.title,
    text: document.body.innerText.slice(0, 80000), semantics: ${SEMANTICS}}))()`;
  for (let attempt = 0; attempt < 3; attempt++) {
    // Rendered text, URL and semantics must describe one DOM state.
    const data = await page.evaluate<Json>(snapshot);
    const accessibility_tree = await page.locator("body").ariaSnapshot();
    const current = await page.evaluate<Json>(snapshot);
    if (JSON.stringify(data) === JSON.stringify(current))
      return { ...data, accessibility_tree };
  }
  throw new Inconclusive(
    "The page changed while its evidence was being captured",
  );
}
