// A small, local-only interpreter for this project's native WXML templates.
// This is a browser interaction preview, not a replacement for WeChat's runtime.
export function parseWxml(source) {
  const root = { type: 'root', children: [] };
  const stack = [root];
  let position = 0;
  while (position < source.length) {
    if (source.startsWith('<!--', position)) {
      const end = source.indexOf('-->', position + 4);
      if (end < 0) throw new Error('Unclosed WXML comment');
      position = end + 3;
      continue;
    }
    if (source[position] !== '<') {
      const end = source.indexOf('<', position);
      const text = source.slice(position, end < 0 ? source.length : end);
      stack.at(-1).children.push({ type: 'text', value: decode(text) });
      position = end < 0 ? source.length : end;
      continue;
    }
    let end = position + 1;
    let quote = '';
    for (; end < source.length; end++) {
      const ch = source[end];
      if (quote) { if (ch === quote) quote = ''; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
    }
    if (end === source.length) throw new Error('Unclosed WXML tag');
    const raw = source.slice(position + 1, end).trim();
    position = end + 1;
    if (raw.startsWith('/')) {
      const tag = raw.slice(1).trim();
      if (stack.length < 2 || stack.at(-1).tag !== tag) throw new Error(`Mismatched closing tag ${tag}`);
      stack.pop();
      continue;
    }
    const match = /^([\w-]+)([\s\S]*?)(\/?)$/.exec(raw);
    if (!match) throw new Error(`Invalid WXML tag ${raw}`);
    const attrs = {};
    const attrPattern = /([:@\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    for (const attribute of match[2].matchAll(attrPattern)) {
      attrs[attribute[1]] = decode(attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
    }
    const node = { type: 'element', tag: match[1], attrs, children: [], id: position };
    stack.at(-1).children.push(node);
    if (!match[3]) stack.push(node);
  }
  if (stack.length !== 1) throw new Error(`Unclosed WXML tag ${stack.at(-1).tag}`);
  return root;
}

function decode(value) {
  return value.replace(/&(?:amp|lt|gt|quot|apos);/g, key => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }[key]));
}

export function wxssForBrowser(css) {
  const tags = { page: 'body', view: 'div', text: 'span', image: 'img', 'scroll-view': 'div', picker: '.native-picker' };
  return css.replace(/([^{}]+)\{/g, (all, selector) => {
    if (selector.trimStart().startsWith('@')) return all;
    return selector.replace(/(^|[\s>+~,])(scroll-view|picker|image|page|view|text)(?=[\s.#:[>+~,]|$)/g, (_, before, tag) => before + tags[tag]) + '{';
  }).replace(/([\d.]+)rpx/g, 'calc($1 * var(--rpx))');
}
