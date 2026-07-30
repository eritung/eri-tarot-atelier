/**
 * Eri Arcana × LINE LIFF 設定
 *
 * 1. 在 LINE Developers Console 建立 LINE Login channel 與 LIFF app。
 * LIFF ID 已直接內建；不需要再手動輸入。
 * HOME_URL 留白時，卡片會連到 https://liff.line.me/{LIFF_ID}。
 */
window.ERI_LINE_CONFIG = {
  ...(window.ERI_LINE_CONFIG || {}),
  LIFF_ID: "2010900471-Lp7tUAMy",
  HOME_URL: window.ERI_LINE_CONFIG?.HOME_URL || "",
};

