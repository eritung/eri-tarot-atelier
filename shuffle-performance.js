(() => {
  "use strict";

  /*
   * 洗牌動畫本身已用 requestAnimationFrame 更新卡片位置，開始洗牌時
   * 也已經隨機排列牌組。舊版另外每 90ms 觸發一次 React 全牌組重排，
   * 會讓 78 張牌的 DOM 與動畫同步競爭，手機因此明顯掉幀。
   *
   * 目前專案只有編譯後的單檔 bundle；在重新取得原始碼前，精準攔截
   * 這一個舊洗牌計時器，保留動畫與隨機結果，同時移除多餘重繪。
   */
  const nativeSetInterval = window.setInterval.bind(window);

  window.setInterval = (callback, delay, ...args) => {
    const source = typeof callback === "function" ? String(callback) : "";
    const isLegacyShuffleLoop =
      delay === 90 &&
      source.includes("Math.ceil") &&
      source.includes("Math.random");

    if (isLegacyShuffleLoop) {
      return nativeSetInterval(() => {}, 60_000);
    }

    return nativeSetInterval(callback, delay, ...args);
  };
})();
