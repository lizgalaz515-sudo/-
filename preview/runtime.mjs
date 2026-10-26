import { parseWxml, wxssForBrowser } from './wxml.mjs';

const root = document.getElementById('app');
const nativeDialog = document.getElementById('native-dialog');
const expressions = new Map();
let definition;
let instance;
let template;
let rendering = false;
let toastTimeout;
let renderPending = false;
const renderCallbacks = [];

function scheduleRender(callback) {
  if (callback) renderCallbacks.push(callback);
  if (renderPending) return;
  renderPending = true;
  queueMicrotask(() => {
    renderPending = false;
    render();
    for (const afterRender of renderCallbacks.splice(0)) afterRender();
  });
}

function evaluate(expression, scope) {
  try {
    if (!expressions.has(expression)) expressions.set(expression, new Function('scope', `with(scope){ return (${expression}); }`));
    return expressions.get(expression)(scope);
  }
  catch (error) { console.error('Template expression failed:', expression, error); return ''; }
}

function binding(source, scope) {
  if (typeof source !== 'string') return source;
  const exact = /^\{\{([^{}]*?)\}\}$/.exec(source);
  if (exact) return evaluate(exact[1], scope);
  return source.replace(/\{\{([\s\S]*?)\}\}/g, (_, expression) => evaluate(expression, scope) ?? '');
}

function dispatch(handler, element, detail = {}) {
  const fn = instance[handler];
  if (typeof fn !== 'function') { console.error(`Missing page handler: ${handler}`); return; }
  const dataset = { ...element.dataset };
  delete dataset.runtimeId;
  const target = { dataset, value: element.value };
  fn.call(instance, { currentTarget: target, target, detail });
}

function renderChildren(children, scope, parent, key) {
  let inCondition = false;
  let conditionTaken = false;
  children.forEach((node, index) => {
    if (node.type === 'text' && !node.value.trim()) return;
    if (node.type === 'element' && 'wx:if' in node.attrs) {
      inCondition = true;
      conditionTaken = !!binding(node.attrs['wx:if'], scope);
      if (!conditionTaken) return;
    } else if (node.type === 'element' && 'wx:elif' in node.attrs) {
      if (!inCondition || conditionTaken) return;
      conditionTaken = !!binding(node.attrs['wx:elif'], scope);
      if (!conditionTaken) return;
    } else if (node.type === 'element' && 'wx:else' in node.attrs) {
      if (!inCondition || conditionTaken) return;
      conditionTaken = true;
    } else { inCondition = false; conditionTaken = false; }
    renderNode(node, scope, parent, `${key}.${index}`);
  });
}

function renderNode(node, scope, parent, key, skipFor = false) {
  if (node.type === 'text') {
    parent.append(document.createTextNode(String(binding(node.value, scope) ?? '')));
    return;
  }
  const attrs = node.attrs;
  if ('wx:for' in attrs && !skipFor) {
    const items = binding(attrs['wx:for'], scope) ?? [];
    Array.from(items).forEach((item, index) => {
      const loopScope = Object.assign(Object.create(scope), { [attrs['wx:for-item'] || 'item']: item, [attrs['wx:for-index'] || 'index']: index });
      renderNode(node, loopScope, parent, `${key}:${index}`, true);
    });
    return;
  }
  if (node.tag === 'block') { renderChildren(node.children, scope, parent, key); return; }
  const tag = ({ view: 'div', text: 'span', image: 'img', 'scroll-view': 'div', picker: 'div' })[node.tag] || node.tag;
  const element = document.createElement(tag);
  element.dataset.runtimeId = key;
  let value;
  for (const [name, raw] of Object.entries(attrs)) {
    if (name.startsWith('wx:') || /^(bind|catch)/.test(name) || ['mode','scroll-y','scroll-x','show-scrollbar','maxlength','focus','cursor','adjust-position','confirm-type','placeholder-class'].includes(name)) continue;
    const resolved = binding(raw, scope);
    if (name === 'value') { value = resolved; continue; }
    if (name === 'hidden') { if (resolved) element.hidden = true; continue; }
    if (name === 'disabled') { element.disabled = !!resolved; continue; }
    if (name === 'type' && tag === 'input') {
      element.type = resolved === 'digit' ? 'text' : resolved || 'text';
      if (resolved === 'digit') element.inputMode = 'decimal';
      if (resolved === 'number') { element.step = '1'; element.inputMode = 'numeric'; }
      continue;
    }
    if (name === 'src' && String(resolved).startsWith('/assets/')) { element.src = '/miniprogram' + resolved; continue; }
    if (name === 'style') {
      element.setAttribute('style', String(resolved ?? '').replace(/([\d.]+)rpx/g, 'calc($1 * var(--rpx))'));
      continue;
    }
    if (resolved !== null && resolved !== undefined) element.setAttribute(name, String(resolved));
  }
  if (tag === 'button') element.type = 'button';
  if (attrs.maxlength && Number(binding(attrs.maxlength, scope)) >= 0) element.maxLength = Number(binding(attrs.maxlength, scope));
  if (tag === 'input' || tag === 'textarea') element.value = value ?? '';
  for (const [eventName, browserEvent] of [['tap','click'],['input','input'],['change','change'],['blur','blur'],['confirm','keydown']]) {
    const bind = attrs[`bind${eventName}`] || attrs[`bind:${eventName}`];
    const caught = attrs[`catch${eventName}`] || attrs[`catch:${eventName}`];
    if (bind || caught) element.addEventListener(browserEvent, (event) => {
      if (rendering && eventName === 'blur') return;
      if (eventName === 'confirm' && event.key !== 'Enter') return;
      if (caught) event.stopPropagation();
      if (tag === 'button') event.preventDefault();
      dispatch(binding(caught || bind, scope), element, { value: element.value });
    });
  }
  if ((attrs.bindtap || attrs['bind:tap']) && tag !== 'button') {
    element.setAttribute('role', 'button');
    element.tabIndex = 0;
    element.addEventListener('keydown', event => { if (event.target === element && ['Enter',' '].includes(event.key)) { event.preventDefault(); element.click(); } });
  }
  renderChildren(node.children, scope, element, key);
  if (node.tag === 'picker' && attrs.mode === 'date') {
    element.classList.add('native-picker');
    const input = document.createElement('input');
    input.type = 'date'; input.value = value ?? ''; input.setAttribute('aria-label', '选择训练日期');
    if (attrs.start) input.min = binding(attrs.start, scope);
    if (attrs.end) input.max = binding(attrs.end, scope);
    input.addEventListener('change', event => { event.stopPropagation(); dispatch(attrs.bindchange, element, { value: input.value }); });
    element.append(input);
  }
  parent.append(element);
}

// Preserve native controls during setData, including cursor/focus and incomplete
// decimal input. Replacing the entire DOM on blur can discard the next input.
function syncChildren(parent, desired) {
  const nextChildren = [...desired.childNodes];
  nextChildren.forEach((next, index) => {
    const current = parent.childNodes[index];
    if (!current) { parent.append(next); return; }
    const same = current.nodeType === next.nodeType && (current.nodeType === Node.TEXT_NODE || current.nodeName === next.nodeName && current.dataset?.runtimeId === next.dataset?.runtimeId);
    if (!same) { current.replaceWith(next); return; }
    if (current.nodeType === Node.TEXT_NODE) {
      if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
      return;
    }
    for (const attribute of [...current.attributes]) if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
    for (const attribute of next.attributes) if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
    if (current instanceof HTMLInputElement || current instanceof HTMLTextAreaElement) {
      if (current.value !== next.value) current.value = next.value;
      current.disabled = next.disabled;
    }
    syncChildren(current, next);
  });
  while (parent.childNodes.length > nextChildren.length) parent.lastChild.remove();
}

function render() {
  if (!template || rendering) return;
  rendering = true;
  const focused = document.activeElement;
  const focusedKey = focused?.dataset?.runtimeId;
  let start, end;
  try { start = focused?.selectionStart; end = focused?.selectionEnd; } catch (_) { /* number inputs */ }
  const positions = [...root.querySelectorAll('[data-runtime-id]')].filter(el => el.scrollTop > 0).map(el => [el.dataset.runtimeId, el.scrollTop]);
  const fragment = document.createDocumentFragment();
  renderChildren(template.children, instance.data, fragment, 'page');
  syncChildren(root, fragment);
  for (const [key, top] of positions) {
    const el = root.querySelector(`[data-runtime-id="${key}"]`);
    if (el) el.scrollTop = top;
  }
  if (focusedKey) {
    const replacement = root.querySelector(`[data-runtime-id="${focusedKey}"]`);
    if (replacement) {
      replacement.focus({ preventScroll: true });
      try { if (start != null) replacement.setSelectionRange(start, end); } catch (_) { /* number inputs */ }
    }
  }
  document.body.style.overflow = instance.data.sheet ? 'hidden' : '';
  rendering = false;
}

function showModal(options) {
  document.getElementById('dialog-title').textContent = options.title || '提示';
  document.getElementById('dialog-content').textContent = options.content || '';
  document.getElementById('clipboard-fallback').hidden = true;
  const cancel = document.getElementById('dialog-cancel');
  const confirm = document.getElementById('dialog-confirm');
  cancel.textContent = options.cancelText || '取消';
  confirm.textContent = options.confirmText || '确定';
  cancel.hidden = options.showCancel === false;
  return new Promise(resolve => {
    const finish = isConfirmed => {
      nativeDialog.close();
      const result = { confirm: isConfirmed, cancel: !isConfirmed, errMsg: 'showModal:ok' };
      options.success?.(result); options.complete?.(result); resolve(result);
    };
    cancel.onclick = () => finish(false); confirm.onclick = () => finish(true);
    nativeDialog.oncancel = event => { event.preventDefault(); finish(false); };
    nativeDialog.showModal();
  });
}

const wx = {
  getStorageSync(key) { const value = localStorage.getItem(key); return value === null ? '' : JSON.parse(value); },
  setStorageSync(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
  removeStorageSync(key) { localStorage.removeItem(key); },
  showToast({ title, duration = 2200 }) {
    const toast = document.getElementById('toast'); toast.textContent = title; toast.classList.add('visible');
    clearTimeout(toastTimeout); toastTimeout = setTimeout(() => toast.classList.remove('visible'), duration);
  },
  showModal,
  async setClipboardData(options) {
    try { await navigator.clipboard.writeText(options.data); options.success?.({ errMsg: 'setClipboardData:ok' }); }
    catch (_) {
      const result = showModal({ title: '训练数据备份', content: '浏览器未授予剪贴板权限，可选中下方内容复制。微信内使用原生剪贴板。', showCancel: false, confirmText: '完成' });
      const fallback = document.getElementById('clipboard-fallback'); fallback.value = options.data; fallback.hidden = false;
      await result; options.success?.({ errMsg: 'setClipboardData:ok' });
    }
  },
  getSystemInfoSync: () => ({ platform: 'devtools', windowWidth: innerWidth, windowHeight: innerHeight, statusBarHeight: 0 }),
  getWindowInfo: () => ({ windowWidth: innerWidth, windowHeight: innerHeight, statusBarHeight: 0 }),
  vibrateShort: () => {}, setKeepScreenOn: () => {},
  setNavigationBarTitle: ({ title }) => { document.title = title + ' · 微信小程序预览'; },
  stopPullDownRefresh: () => {}
};

function setPath(target, path, value) {
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let ref = target;
  for (let i = 0; i < keys.length - 1; i++) ref = ref[keys[i]] ??= {};
  ref[keys.at(-1)] = value;
}

try {
  const paths = ['/miniprogram/utils/model.js', '/miniprogram/pages/index/index.js', '/miniprogram/pages/index/index.wxml', '/miniprogram/app.wxss', '/miniprogram/pages/index/index.wxss'];
  const [modelCode, pageCode, wxml, globalCss, pageCss] = await Promise.all(paths.map(async path => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    return response.text();
  }));
  const style = document.createElement('style');
  style.textContent = wxssForBrowser(globalCss + '\n' + pageCss);
  document.head.append(style);
  const module = { exports: {} };
  new Function('module','exports','wx', modelCode)(module, module.exports, wx);
  const requireLocal = path => {
    if (/utils\/model(?:\.js)?$/.test(path)) return module.exports;
    throw new Error('Unsupported preview module: ' + path);
  };
  new Function('require','Page','wx','getApp', pageCode)(requireLocal, options => { definition = options; }, wx, () => ({ globalData: {} }));
  if (!definition) throw new Error('Page definition not found');
  instance = { ...definition, data: structuredClone(definition.data || {}), setData(update, callback) { for (const [key, value] of Object.entries(update)) setPath(this.data, key, value); scheduleRender(callback); } };
  template = parseWxml(wxml);
  instance.onLoad?.({}); instance.onShow?.(); render();
  document.addEventListener('visibilitychange', () => { if (document.hidden) instance.onHide?.(); else instance.onShow?.(); });
  window.addEventListener('pagehide', () => instance.onUnload?.());
  // Read-only inspection for browser smoke tests; source of truth remains native Page + model.
  window.__lianji = { get data() { return instance.data; }, model: module.exports };
} catch (error) {
  console.error(error);
  root.replaceChildren(Object.assign(document.createElement('div'), { className: 'boot-state', textContent: '预览加载失败：' + error.message }));
}
