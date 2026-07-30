(() => {
  "use strict";

  const PENDING_KEY = "eriArcana.lineShare.pending.v1";
  const SETTINGS_KEY = "eriArcana.localMemory.settings.v1";
  const PLACEHOLDER_ID = "請在這裡貼上你的_LIFF_ID";

  const MAJOR_NAMES = [
    "愚者",
    "魔術師",
    "女祭司",
    "皇后",
    "皇帝",
    "教皇",
    "戀人",
    "戰車",
    "力量",
    "隱者",
    "命運之輪",
    "正義",
    "倒吊人",
    "死神",
    "節制",
    "惡魔",
    "高塔",
    "星星",
    "月亮",
    "太陽",
    "審判",
    "世界",
  ];
  const SUITS = ["權杖", "聖杯", "寶劍", "錢幣"];
  const RANKS = [
    "一",
    "二",
    "三",
    "四",
    "五",
    "六",
    "七",
    "八",
    "九",
    "十",
    "侍者",
    "騎士",
    "皇后",
    "國王",
  ];
  const CARD_NAMES = [
    ...MAJOR_NAMES,
    ...SUITS.flatMap((suit) => RANKS.map((rank) => `${suit}${rank}`)),
  ];
  const CARD_NUMBER = new Map(
    CARD_NAMES.map((name, index) => [
      name,
      String(index + 1).padStart(2, "0"),
    ]),
  );

  let initPromise;
  let shareBusy = false;
  let modal;
  let permissionModal;
  let failedSharePayload;
  let toastTimer;

  const config = () => window.ERI_LINE_CONFIG || {};

  const hasLiffId = () => {
    const id = String(config().LIFF_ID || "").trim();
    return Boolean(id && id !== PLACEHOLDER_ID && !id.includes("請在這裡"));
  };

  const parseJson = (value, fallback) => {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  };

  const showToast = (message) => {
    let toast = document.querySelector(".line-share-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "line-share-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(
      () => toast.classList.remove("is-visible"),
      2200,
    );
  };

  const getHomeUrl = () => {
    const configured = String(config().HOME_URL || "").trim();
    if (configured) return configured;
    if (hasLiffId()) {
      return `https://liff.line.me/${String(config().LIFF_ID).trim()}`;
    }
    return new URL("./", window.location.href).href;
  };

  const normalizePosition = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .replace(/^\d+\s*·\s*/, "")
      .trim();

  const fallbackImageUrl = (
    cardName,
    orientation = "正位",
    imageDeck = "aurora",
  ) => {
    const number = CARD_NUMBER.get(cardName) || "01";
    const baseFolder = imageDeck === "cat" ? "cat" : "aurora";
    const folder =
      orientation === "逆位" ? `${baseFolder}-reversed` : baseFolder;
    return new URL(
      `./share-cards/${folder}/${number}.jpg`,
      document.baseURI,
    ).href;
  };

  const extractCardImageUrl = (item, cardName, orientation) => {
    const art = item.querySelector(".card-face-art");
    const inline = art?.style?.backgroundImage || "";
    const imageDeck = /(?:^|\/)decks\/cat\//i.test(inline)
      ? "cat"
      : "aurora";

    // LINE Flex images cannot be rotated with CSS. Reversed cards therefore
    // use a bundled, pre-rotated share image.
    if (orientation === "逆位") {
      return {
        imageDeck,
        imageUrl: fallbackImageUrl(cardName, orientation, imageDeck),
      };
    }

    const match = inline.match(/url\((['"]?)(.*?)\1\)/i);
    if (match?.[2] && !/^(data|blob):/i.test(match[2])) {
      try {
        return {
          imageDeck,
          imageUrl: new URL(match[2], document.baseURI).href,
        };
      } catch {
        // Fall through to the bundled share artwork.
      }
    }
    return {
      imageDeck,
      imageUrl: fallbackImageUrl(cardName, orientation, imageDeck),
    };
  };

  const collectResult = () => {
    const root = document.querySelector(".result-shell");
    if (!root) return null;

    const cards = [...root.querySelectorAll(".result-card-item")]
      .map((item) => {
        const name = item.querySelector("h2")?.textContent?.trim() || "";
        const detail = item.querySelector("p")?.textContent?.trim() || "";
        const orientation =
          detail.match(/(正位|逆位)\s*$/)?.[1] ||
          (item.querySelector(".is-reversed") ? "逆位" : "正位");
        const english = detail
          .replace(/\s*·\s*(正位|逆位)\s*$/, "")
          .trim();
        const artwork = extractCardImageUrl(
          item,
          name,
          orientation,
        );
        return {
          name,
          english,
          orientation,
          position: normalizePosition(
            item.querySelector(".result-position")?.textContent,
          ),
          imageDeck: artwork.imageDeck,
          imageUrl: artwork.imageUrl,
        };
      })
      .filter((card) => card.name);

    if (!cards.length) return null;

    const settings = parseJson(
      window.localStorage.getItem(SETTINGS_KEY),
      {},
    );
    const question =
      root.querySelector(".result-heading > p:last-child")?.textContent?.trim() ||
      settings.question ||
      "我目前最需要知道的訊息是什麼？";
    const spread = settings.spread || "塔羅牌陣";
    const deckScope = settings.deckScope || "";
    const promptSpread = deckScope
      ? `${spread}｜牌池：${deckScope}`
      : spread;

    return {
      question,
      spread,
      deck: settings.deck || "",
      deckScope,
      cards,
      prompt: buildPrompt({ question, spread: promptSpread, cards }),
    };
  };

  const buildPrompt = ({ question, spread, cards }) => {
    const date = new Intl.DateTimeFormat("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const cardLines = cards
      .map(
        (card, index) =>
          `${index + 1}. ${card.position || `第 ${index + 1} 張`}：${card.name}（${card.orientation}）`,
      )
      .join("\n");

    const input = { question, date, spread, cardLines };
    const configuredBuilder = window.ERI_READING_PROMPT?.buildPrompt;

    if (typeof configuredBuilder === "function") {
      return configuredBuilder(input);
    }

    return `【問題】${input.question}
【占卜日期】${input.date}
【牌陣】${input.spread}

【抽牌結果】
${input.cardLines}`;
  };

  const isReachableImage = (url) =>
    new Promise((resolve) => {
      const image = new Image();
      const done = (value) => {
        image.onload = null;
        image.onerror = null;
        window.clearTimeout(timer);
        resolve(value);
      };
      const timer = window.setTimeout(() => done(false), 3500);
      image.onload = () => done(true);
      image.onerror = () => done(false);
      image.src = url;
    });

  const resolveCardImages = async (payload) => {
    const cards = await Promise.all(
      payload.cards.map(async (card) => {
        const fallback = fallbackImageUrl(
          card.name,
          card.orientation,
          card.imageDeck,
        );
        if (card.imageUrl === fallback) return card;
        const works = await isReachableImage(card.imageUrl);
        return { ...card, imageUrl: works ? card.imageUrl : fallback };
      }),
    );
    return { ...payload, cards };
  };

  const buildFlexMessage = (payload) => {
    const homeUrl = getHomeUrl();
    const uriAction = {
      type: "uri",
      label: "前往 Eri Arcana",
      uri: homeUrl,
    };
    const bubbles = payload.cards.map((card, index) => ({
      type: "bubble",
      size: "micro",
      hero: {
        type: "image",
        url: card.imageUrl,
        size: "full",
        aspectRatio: "2:3",
        aspectMode: "cover",
        action: uriAction,
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "14px",
        backgroundColor: "#0A2730",
        action: uriAction,
        contents: [
          {
            type: "text",
            text: card.position || `第 ${index + 1} 張`,
            size: "xxs",
            color: "#E9B8AE",
            wrap: true,
          },
          {
            type: "text",
            text: card.name,
            size: "md",
            weight: "bold",
            color: "#F2F5E9",
            wrap: true,
          },
          {
            type: "text",
            text: [card.english, card.orientation].filter(Boolean).join(" · "),
            size: "xxs",
            color: "#B8CCC6",
            wrap: true,
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "10px",
        backgroundColor: "#071F27",
        contents: [
          {
            type: "button",
            height: "sm",
            style: "link",
            color: "#F0B9AF",
            action: uriAction,
          },
        ],
      },
    }));

    const cardNames = payload.cards.map((card) => card.name).join("、");
    return {
      type: "flex",
      altText: `Eri Arcana 抽牌結果：${cardNames}`.slice(0, 400),
      contents: {
        type: "carousel",
        contents: bubbles,
      },
    };
  };

  const savePending = (payload) => {
    try {
      window.sessionStorage.setItem(
        PENDING_KEY,
        JSON.stringify({ ...payload, savedAt: Date.now() }),
      );
    } catch {
      // Session storage is optional; sharing still works in a LIFF browser.
    }
  };

  const readPending = () => {
    const pending = parseJson(
      window.sessionStorage.getItem(PENDING_KEY),
      null,
    );
    if (!pending || Date.now() - Number(pending.savedAt || 0) > 30 * 60 * 1000) {
      window.sessionStorage.removeItem(PENDING_KEY);
      return null;
    }
    return pending;
  };

  const clearPending = () => {
    window.sessionStorage.removeItem(PENDING_KEY);
  };

  const initializeLiff = async () => {
    if (!hasLiffId()) {
      const error = new Error("尚未設定 LIFF ID");
      error.code = "LIFF_ID_MISSING";
      throw error;
    }
    if (!window.liff) {
      throw new Error("LINE 分享元件載入失敗，請確認網路後再試一次。");
    }
    if (!initPromise) {
      initPromise = window.liff
        .init({
          liffId: String(config().LIFF_ID).trim(),
        })
        .catch((error) => {
          // A temporary SDK or network failure should not poison every retry.
          initPromise = null;
          throw error;
        });
    }
    await initPromise;
  };

  const canAttemptTargetPicker = () => {
    const isAvailable = window.liff.isApiAvailable("shareTargetPicker");
    if (isAvailable) return true;

    /*
     * In an external browser the SDK can occasionally report stale
     * availability after the channel setting was just enabled. The API itself
     * supports external browsers, so let the real call return the useful error
     * instead of blocking desktop users here.
     */
    return !window.liff.isInClient();
  };

  const errorCode = (error) =>
    String(error?.code || error?.status || "").trim().toUpperCase();

  const isForbiddenError = (error) => {
    const code = errorCode(error);
    return code === "FORBIDDEN" || code === "403";
  };

  const getTargetPickerDiagnostic = () => {
    let context = null;
    try {
      context = window.liff?.getContext?.() || null;
    } catch {
      // Diagnostic data is optional and must never block the share flow.
    }

    let apiAvailable = null;
    try {
      apiAvailable = Boolean(
        window.liff?.isApiAvailable?.("shareTargetPicker"),
      );
    } catch {
      // Keep null when the SDK cannot report availability.
    }

    return {
      liffId: String(config().LIFF_ID || "").trim(),
      loggedIn: Boolean(window.liff?.isLoggedIn?.()),
      inClient: Boolean(window.liff?.isInClient?.()),
      apiAvailable,
      channelPermission:
        context?.availability?.shareTargetPicker?.permission ?? null,
    };
  };

  const friendlyShareError = (error) => {
    const code = errorCode(error);

    if (code === "UNAUTHORIZED" || code === "401") {
      return "LINE 登入狀態已失效，請重新登入後再試一次。";
    }
    if (code === "EXCEPTION_IN_SUBWINDOW") {
      return "LINE 選擇視窗已逾時，請關閉後再按一次分享。";
    }
    return error?.message || "LINE 分享暫時無法使用";
  };

  const updateShareButtons = (busy, label) => {
    document.querySelectorAll(".line-share-button").forEach((button) => {
      button.disabled = busy;
      const text = button.querySelector(".line-share-label");
      if (text) text.textContent = label || "分享至 LINE";
    });
  };

  const sharePayload = async (rawPayload) => {
    if (shareBusy) return;
    if (!rawPayload?.cards?.length) {
      showToast("找不到這次的抽牌結果");
      return;
    }

    shareBusy = true;
    updateShareButtons(true, "準備 LINE 卡片…");

    try {
      await initializeLiff();

      if (!window.liff.isLoggedIn()) {
        savePending(rawPayload);
        window.liff.login({ redirectUri: window.location.href });
        return;
      }

      if (!canAttemptTargetPicker()) {
        throw new Error(
          "目前的 LINE App 版本不支援聊天室選擇器，請更新 LINE 後再試一次。",
        );
      }

      const payload = await resolveCardImages(rawPayload);
      savePending(payload);
      const result = await window.liff.shareTargetPicker(
        [
          buildFlexMessage(payload),
          { type: "text", text: payload.prompt },
        ],
        { isMultiple: true },
      );

      if (result?.status === "success") {
        clearPending();
        showToast("已分享至 LINE ✦");
      } else {
        showToast("已取消分享");
      }
    } catch (error) {
      if (error?.code === "LIFF_ID_MISSING") {
        openSetupModal();
      } else if (isForbiddenError(error)) {
        console.error("[Eri Arcana LINE share: permission]", {
          error,
          diagnostic: getTargetPickerDiagnostic(),
        });
        openPermissionModal(rawPayload);
      } else {
        console.error("[Eri Arcana LINE share]", error);
        showToast(friendlyShareError(error));
      }
    } finally {
      shareBusy = false;
      updateShareButtons(false, "分享至 LINE");
    }
  };

  const makeShareButton = (pending = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `line-share-button${pending ? " is-pending" : ""}`;
    button.innerHTML = `
      <span class="line-share-icon" aria-hidden="true">LINE</span>
      <span class="line-share-label">${pending ? "繼續分享剛才結果" : "分享至 LINE"}</span>
    `;
    button.addEventListener("click", () => {
      const payload = pending ? readPending() : collectResult();
      void sharePayload(payload);
    });
    return button;
  };

  const ensureResultButton = () => {
    const actions = document.querySelector(".result-shell .prompt-actions");
    if (!actions || actions.querySelector(".line-share-button")) return;
    actions.insertBefore(makeShareButton(false), actions.firstChild);
  };

  const ensurePendingButton = () => {
    const pending = readPending();
    const topbar = document.querySelector(".site-shell .topbar");
    if (!topbar || !pending) return;
    if (topbar.querySelector(".line-share-button.is-pending")) return;
    const button = makeShareButton(true);
    const guide = topbar.querySelector(".quiet-button");
    if (guide) topbar.insertBefore(button, guide);
    else topbar.appendChild(button);
  };

  const ensureSetupModal = () => {
    if (modal) return;
    modal = document.createElement("div");
    modal.className = "line-setup-layer";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <section class="line-setup-modal" role="dialog" aria-modal="true" aria-labelledby="line-setup-title">
        <button type="button" class="line-setup-close" aria-label="關閉">×</button>
        <p class="line-setup-eyebrow">LINE SHARE · 一次設定</p>
        <h2 id="line-setup-title">還差一組 LIFF ID</h2>
        <p>分享功能已經放進網站；請先在 LINE Developers 建立 LIFF app，再把公開的 LIFF ID 貼進 <code>line-share.config.js</code>。</p>
        <ol>
          <li>建立 LINE Login channel，並新增 LIFF app。</li>
          <li>Endpoint URL 填入網站的 HTTPS 首頁。</li>
          <li>啟用 Share Target Picker 並同意資料使用條款。</li>
          <li>將 LIFF ID 貼入設定檔後重新部署。</li>
        </ol>
        <p class="line-setup-note">不需要建立網站帳密，也不必把 Channel Secret 放進前端。</p>
      </section>
    `;
    document.body.appendChild(modal);
    modal.addEventListener("click", (event) => {
      if (
        event.target === modal ||
        event.target.closest(".line-setup-close")
      ) {
        closeSetupModal();
      }
    });
  };

  const openSetupModal = () => {
    ensureSetupModal();
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.documentElement.style.overflow = "hidden";
    modal.querySelector(".line-setup-close")?.focus();
  };

  const closeSetupModal = () => {
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.documentElement.style.overflow = "";
  };

  const closePermissionModal = () => {
    if (!permissionModal) return;
    permissionModal.classList.remove("is-open");
    permissionModal.setAttribute("aria-hidden", "true");
    document.documentElement.style.overflow = "";
  };

  const reauthenticateLine = () => {
    if (failedSharePayload) savePending(failedSharePayload);
    closePermissionModal();

    if (!window.liff || window.liff.isInClient()) {
      window.location.assign(getHomeUrl());
      return;
    }

    try {
      if (window.liff.isLoggedIn()) window.liff.logout();
      window.liff.login({ redirectUri: window.location.href });
    } catch (error) {
      console.error("[Eri Arcana LINE re-login]", error);
      showToast("無法重新登入，請關閉頁面後再試一次");
    }
  };

  const ensurePermissionModal = () => {
    if (permissionModal) return;
    permissionModal = document.createElement("div");
    permissionModal.className = "line-setup-layer";
    permissionModal.setAttribute("aria-hidden", "true");
    permissionModal.innerHTML = `
      <section class="line-setup-modal line-permission-modal" role="dialog" aria-modal="true" aria-labelledby="line-permission-title">
        <button type="button" class="line-setup-close" aria-label="關閉">×</button>
        <p class="line-setup-eyebrow">LINE SHARE · 權限檢查</p>
        <h2 id="line-permission-title">LINE 拒絕了這組 LIFF ID</h2>
        <p>網站已成功呼叫聊天室選擇器，但 LINE 回傳 <code>403 Forbidden</code>。這不是裝置不支援，而是頻道權限或電腦登入狀態尚未通過。</p>
        <div class="line-diagnostic-card">
          <span>網站目前使用的 LIFF ID</span>
          <code class="line-current-liff-id"></code>
          <small class="line-permission-state"></small>
        </div>
        <ol>
          <li>確認上方 LIFF ID，和你在 LINE Developers 啟用 <strong>shareTargetPicker</strong> 的 LIFF app 完全相同。</li>
          <li>若相同，請按「重新登入 LINE」；電腦版需要有效的 SSO 登入，登入頁出現時請使用 LINE 綁定的 Email 與密碼。</li>
        </ol>
        <div class="line-permission-actions">
          <button type="button" class="line-reauth-button">重新登入 LINE</button>
          <a class="line-liff-open-link" href="#">用 LIFF 網址重開</a>
        </div>
        <p class="line-setup-note">重新登入後，這次抽牌結果仍會保留，可按「繼續分享剛才結果」。</p>
      </section>
    `;
    document.body.appendChild(permissionModal);
    permissionModal.addEventListener("click", (event) => {
      if (
        event.target === permissionModal ||
        event.target.closest(".line-setup-close")
      ) {
        closePermissionModal();
        return;
      }
      if (event.target.closest(".line-reauth-button")) {
        reauthenticateLine();
      }
    });
  };

  const openPermissionModal = (payload) => {
    failedSharePayload = payload;
    if (payload) savePending(payload);
    ensurePermissionModal();

    const diagnostic = getTargetPickerDiagnostic();
    const id = diagnostic.liffId || "未讀取到 LIFF ID";
    const permissionText =
      diagnostic.channelPermission === false
        ? "LINE 回報：此頻道的分享權限未開啟"
        : diagnostic.apiAvailable === false
          ? "LINE 回報：目前登入狀態尚未取得分享權限"
          : "LINE 回報：已登入，但伺服器拒絕分享權限";

    permissionModal.querySelector(".line-current-liff-id").textContent = id;
    permissionModal.querySelector(".line-permission-state").textContent =
      permissionText;
    const liffLink = permissionModal.querySelector(".line-liff-open-link");
    liffLink.href = `https://liff.line.me/${encodeURIComponent(id)}`;

    permissionModal.classList.add("is-open");
    permissionModal.setAttribute("aria-hidden", "false");
    document.documentElement.style.overflow = "hidden";
    permissionModal.querySelector(".line-reauth-button")?.focus();
  };

  const refresh = () => {
    ensureResultButton();
    ensurePendingButton();
  };

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal?.classList.contains("is-open")) {
      closeSetupModal();
    }
    if (
      event.key === "Escape" &&
      permissionModal?.classList.contains("is-open")
    ) {
      closePermissionModal();
    }
  });

  const observer = new MutationObserver(refresh);
  observer.observe(document.getElementById("root") || document.body, {
    childList: true,
    subtree: true,
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refresh, { once: true });
  } else {
    refresh();
  }
})();
