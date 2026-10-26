const { it } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const utilities = import(pathToFileURL(path.resolve(__dirname, '../preview/wxml.mjs')));

it('parses native templates without treating quoted comparisons as tags', async () => {
  const { parseWxml } = await utilities;
  const tree = parseWxml('<view wx:if="{{value > 0 &amp;&amp; ready}}"><text>重量 {{weight}} kg</text><input value="{{weight}}" /></view>');
  assert.equal(tree.children[0].attrs['wx:if'], '{{value > 0 && ready}}');
  assert.equal(tree.children[0].children[1].tag, 'input');
  assert.equal(tree.children[0].children[0].children[0].value, '重量 {{weight}} kg');
});

it('rejects malformed native markup rather than silently changing the UI', async () => {
  const { parseWxml } = await utilities;
  assert.throws(() => parseWxml('<view><text></view>'), /Mismatched/);
  assert.throws(() => parseWxml('<view>'), /Unclosed/);
});

it('adapts native CSS tag selectors while preserving properties and class names', async () => {
  const { wxssForBrowser } = await utilities;
  const result = wxssForBrowser('page { color: red; } .record > view > text { font-size: 22rpx; text-align: center; } .text-button { color: blue; } @media (min-width:900px) { .volume text { color: green; } }');
  assert.match(result, /body \{/);
  assert.match(result, /\.record > div > span/);
  assert.match(result, /font-size: calc\(22 \* var\(--rpx\)\)/);
  assert.match(result, /text-align: center/);
  assert.match(result, /\.text-button/);
  assert.match(result, /\.volume span/);
});
