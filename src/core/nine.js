// 洛書九宮的環狀正規化(1..9 循環)。純函式、無依賴,避免各模組各寫一份而漂移。
// 原本 bazhai(mod9)、xuankong/chart(mod9)、wealth/layers(wrap9)、annual(wrap9)各有一份同式實作。
// 差異只在「非整數要不要擋」:本檔給寬鬆版 mod9,嚴格版由 annual.wrap9 自己驗整數後呼叫(錯誤碼是它的公開契約)。

/**
 * 1..9 循環:0 與 9 的倍數回 9,負數也正確(不依賴 JS 的負 modulo 語意)。
 * @param {number} n 任意有限實數(整數才有風水意義;非整數會原樣線性映射,呼叫端自行驗整數)
 * @returns {number} [1,9]
 */
export function mod9(n) {
  return ((((n - 1) % 9) + 9) % 9) + 1;
}
