// 中文標點統一:引擎文案與部分畫面字串使用半形標點(, ; : ? ( )),
// 混在中文裡看起來擠又不整齊。這裡把「貼著中文字」的半形標點換成全形,
// 數字裡的標點(3,000、08:30、5.1)與英文網址不動。純字串函式,不依賴 DOM,可單元測試。

const CJK = '\\u3400-\\u9fff\\uf900-\\ufaff\\u3000-\\u303f\\uff00-\\uffef';
const RE_CJK = new RegExp(`[${CJK}]`);
const RE_HAN = /[㐀-鿿]/;
const RE_QUICK = /[,;:!?()]|[㐀-鿿] \d{1,3}[㐀-鿿]/;
const RE_PAREN = /\(([^()]*)\)/g;
const RE_SPACE_NUM = new RegExp(`([\\u3400-\\u9fff] \\d{1,3})(?=[\\u3400-\\u9fff])`, 'g');

const FULL = { ',': '，', ';': '；', ':': '：', '!': '！', '?': '？' };

const isCjk = (ch) => !!ch && RE_CJK.test(ch);
const isDigit = (ch) => !!ch && ch >= '0' && ch <= '9';

/** 把貼著中文字的半形標點換成全形。沒有中文字的字串原樣回傳。 */
export function zhPunct(input) {
  if (typeof input !== 'string' || !RE_HAN.test(input) || !RE_QUICK.test(input)) return input;
  let t = input;

  // 括號成對處理(先內層再外層):括號內有中文,或緊接在中文字後面,就換全形
  for (let pass = 0; pass < 2; pass += 1) {
    t = t.replace(RE_PAREN, (m, inner, off, all) => {
      const prev = off > 0 ? all[off - 1] : '';
      return (RE_HAN.test(inner) || isCjk(prev)) ? `（${inner}）` : m;
    });
  }

  let out = '';
  for (let i = 0; i < t.length; i += 1) {
    const ch = t[i];
    const prev = out.length ? out[out.length - 1] : '';
    if (ch in FULL) {
      let j = i + 1;
      if (t[j] === ' ') j += 1;
      const next = t[j];
      const between = isDigit(prev) && isDigit(next);
      if (!between && (isCjk(prev) || isCjk(next))) {
        out += FULL[ch];
        // 全形標點後面的半形空白多餘,拿掉
        if (t[i + 1] === ' ' && isCjk(next)) i += 1;
        continue;
      }
    } else if (ch === '(' && isCjk(t[i + 1])) {
      out += '（';
      continue;
    } else if (ch === ')' && isCjk(prev)) {
      out += '）';
      continue;
    }
    out += ch;
  }

  // 「次臥 1的右上角」→「次臥 1 的右上角」
  return out.replace(RE_SPACE_NUM, '$1 ');
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'INPUT', 'CANVAS', 'SVG', 'PRE', 'CODE']);
const ATTRS = ['aria-label', 'title', 'placeholder', 'aria-valuetext'];

function fixNode(n) {
  if (n.nodeType === 3) {
    const v = n.data;
    const w = zhPunct(v);
    if (w !== v) n.data = w;
    return;
  }
  if (n.nodeType !== 1 || SKIP_TAGS.has(n.tagName.toUpperCase()) || n.hasAttribute('data-nopunct')) return;
  for (const a of ATTRS) {
    const v = n.getAttribute(a);
    if (v) { const w = zhPunct(v); if (w !== v) n.setAttribute(a, w); }
  }
  for (let c = n.firstChild; c; c = c.nextSibling) fixNode(c);
}

/** 監看整個畫面,新出現或被改寫的文字自動套用 zhPunct(在繪製前完成,不會閃爍)。回傳停止函式。 */
export function installPunct(root = document.body) {
  fixNode(root);
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'childList') r.addedNodes.forEach(fixNode);
      else if (r.type === 'characterData') fixNode(r.target);
      else if (r.type === 'attributes') {
        const v = r.target.getAttribute(r.attributeName);
        const w = zhPunct(v);
        if (v && w !== v) r.target.setAttribute(r.attributeName, w);
      }
    }
  });
  mo.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  return () => mo.disconnect();
}
