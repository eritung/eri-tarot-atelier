(() => {
  "use strict";

  const SETTINGS_KEY = "eriArcana.localMemory.settings.v1";
  const HISTORY_KEY = "eriArcana.localMemory.history.v1";
  const HISTORY_LIMIT = 50;

  let modal;
  let toastTimer;
  let resultSaved = false;
  let restoreTimer;

  const parseJson = (value, fallback) => {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  };

  const readSettings = () =>
    parseJson(window.localStorage.getItem(SETTINGS_KEY), {});

  const readHistory = () => {
    const history = parseJson(window.localStorage.getItem(HISTORY_KEY), []);
    return Array.isArray(history) ? history : [];
  };

  const writeSettings = (patch) => {
    const next = {
      ...readSettings(),
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return next;
  };

  const writeHistory = (history) => {
    window.localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(history.slice(0, HISTORY_LIMIT)),
    );
    updateMemoryButtons();
  };

  const escapeHtml = (value = "") =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const showToast = (message) => {
    let toast = document.querySelector(".memory-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "memory-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(
      () => toast.classList.remove("is-visible"),
      1800,
    );
  };

  const formatDate = (iso) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  };

  const selectedText = (selector) =>
    document.querySelector(selector)?.textContent?.trim() || "";

  const collectSettings = () => {
    const patch = {};
    const spread =
      document.querySelector(".spread-select")?.selectedOptions?.[0]
        ?.textContent?.trim() || "";
    const deck = selectedText(".deck-option.is-active strong");
    const deckScope = selectedText(".scope-option.is-active strong");
    const reverse = document.querySelector(".toggle-row input");
    const question = document.querySelector(".question-field textarea");
    const choiceInputs = document.querySelectorAll(".choice-fields input");

    if (spread) patch.spread = spread;
    if (deck) patch.deck = deck;
    if (deckScope) patch.deckScope = deckScope;
    if (reverse) patch.reverse = reverse.checked;
    if (question) patch.question = question.value;
    if (choiceInputs[0]) patch.choiceA = choiceInputs[0].value;
    if (choiceInputs[1]) patch.choiceB = choiceInputs[1].value;

    if (Object.keys(patch).length) writeSettings(patch);
  };

  const setControlledValue = (element, value) => {
    if (!element || element.value === value) return;
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const setControlledChecked = (element, value) => {
    if (!element || element.checked === value) return;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "checked",
    )?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const clickMatchingOption = (selector, value) => {
    if (!value) return;
    const buttons = [...document.querySelectorAll(selector)];
    const target = buttons.find(
      (button) => button.querySelector("strong")?.textContent?.trim() === value,
    );
    if (target && !target.classList.contains("is-active")) target.click();
  };

  const restoreVisibleSettings = () => {
    if (document.querySelector(".spread-dropdown.is-open")) return;
    const settings = readSettings();
    const spreadSelect = document.querySelector(".spread-select");
    if (spreadSelect && settings.spread) {
      const option = [...spreadSelect.options].find(
        (item) => item.textContent?.trim() === settings.spread,
      );
      if (option) setControlledValue(spreadSelect, option.value);
    }
    clickMatchingOption(".deck-option", settings.deck);
    clickMatchingOption(".scope-option", settings.deckScope);

    const reverse = document.querySelector(".toggle-row input");
    if (reverse && typeof settings.reverse === "boolean") {
      setControlledChecked(reverse, settings.reverse);
    }

    const question = document.querySelector(".question-field textarea");
    if (question && typeof settings.question === "string" && !question.value) {
      setControlledValue(question, settings.question);
    }

    const choiceInputs = document.querySelectorAll(".choice-fields input");
    if (
      choiceInputs[0] &&
      typeof settings.choiceA === "string" &&
      !choiceInputs[0].value
    ) {
      setControlledValue(choiceInputs[0], settings.choiceA);
    }
    if (
      choiceInputs[1] &&
      typeof settings.choiceB === "string" &&
      !choiceInputs[1].value
    ) {
      setControlledValue(choiceInputs[1], settings.choiceB);
    }
  };

  const collectResult = () => {
    const result = document.querySelector(".result-shell");
    if (!result) {
      resultSaved = false;
      return;
    }
    if (resultSaved) return;

    const cards = [...result.querySelectorAll(".result-card-item")]
      .map((item) => {
        const detail = item.querySelector("p")?.textContent?.trim() || "";
        const orientation =
          detail.match(/(正位|逆位)\s*$/)?.[1] ||
          (item.querySelector(".is-reversed") ? "逆位" : "正位");
        return {
          position:
            item
              .querySelector(".result-position")
              ?.textContent?.replace(/\s+/g, " ")
              .trim() || "",
          name: item.querySelector("h2")?.textContent?.trim() || "",
          detail,
          orientation,
        };
      })
      .filter((card) => card.name);

    if (!cards.length) return;

    const settings = readSettings();
    const question =
      result.querySelector(".result-heading > p:last-child")?.textContent?.trim() ||
      settings.question ||
      "未填寫問題";
    const history = readHistory();

    history.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      question,
      spread: settings.spread || "",
      deck: settings.deck || "",
      deckScope: settings.deckScope || "",
      reverse: settings.reverse ?? true,
      choiceA: settings.choiceA || "",
      choiceB: settings.choiceB || "",
      cards,
    });
    writeHistory(history);
    showToast("這次抽牌已存進本機紀錄 ✦");
    resultSaved = true;
  };

  const recordToText = (record) => {
    const lines = [
      `【問題】${record.question}`,
      `【日期】${formatDate(record.createdAt)}`,
      record.spread ? `【牌陣】${record.spread}` : "",
      record.deck ? `【牌面】${record.deck}` : "",
      record.deckScope ? `【牌池】${record.deckScope}` : "",
      record.choiceA ? `【選項 A】${record.choiceA}` : "",
      record.choiceB ? `【選項 B】${record.choiceB}` : "",
      "",
      "【抽牌結果】",
      ...record.cards.map(
        (card, index) =>
          `${index + 1}. ${card.name}（${card.orientation || "正位"}）${
            card.position ? `｜${card.position}` : ""
          }`,
      ),
    ];
    return lines.filter((line, index) => line || index > 5).join("\n");
  };

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
  };

  const renderHistory = () => {
    if (!modal) return;
    const history = readHistory();
    const content = modal.querySelector(".memory-content");
    const count = modal.querySelector(".memory-modal-count");
    count.textContent = history.length
      ? `目前保存 ${history.length} 次完成的抽牌`
      : "尚未保存任何抽牌";

    if (!history.length) {
      content.innerHTML = `
        <div class="memory-empty">
          <div><span>☾</span>完成一次抽牌後，結果會自動留在這裡。</div>
        </div>
      `;
      return;
    }

    content.innerHTML = history
      .map(
        (record) => `
          <article class="memory-card" data-memory-id="${escapeHtml(record.id)}">
            <div class="memory-card-top">
              <div>
                <time datetime="${escapeHtml(record.createdAt)}">${escapeHtml(
                  formatDate(record.createdAt),
                )}</time>
                <h3>${escapeHtml(record.question)}</h3>
              </div>
            </div>
            <p class="memory-card-meta">
              ${escapeHtml(
                [record.spread, record.deck, record.deckScope]
                  .filter(Boolean)
                  .join(" · ") ||
                  "塔羅抽牌",
              )}
            </p>
            <ul class="memory-card-list">
              ${record.cards
                .map(
                  (card) =>
                    `<li>${escapeHtml(card.name)} · ${escapeHtml(
                      card.orientation || "正位",
                    )}</li>`,
                )
                .join("")}
            </ul>
            <div class="memory-card-actions">
              <button type="button" data-action="copy">複製紀錄</button>
              <button type="button" class="memory-delete" data-action="delete">刪除</button>
            </div>
          </article>
        `,
      )
      .join("");
  };

  const openModal = () => {
    ensureModal();
    renderHistory();
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.documentElement.style.overflow = "hidden";
    modal.querySelector(".memory-close")?.focus();
  };

  const closeModal = () => {
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.documentElement.style.overflow = "";
  };

  const ensureModal = () => {
    if (modal) return;
    modal = document.createElement("div");
    modal.className = "memory-layer";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <section class="memory-modal" role="dialog" aria-modal="true" aria-labelledby="memory-title">
        <header class="memory-header">
          <div>
            <p>LOCAL ARCHIVE · 本機保存</p>
            <h2 id="memory-title">我的抽牌紀錄</h2>
            <small class="memory-modal-count">尚未保存任何抽牌</small>
          </div>
          <button type="button" class="memory-close" aria-label="關閉抽牌紀錄">×</button>
        </header>
        <div class="memory-content"></div>
        <footer class="memory-footer">
          <small>資料只留在目前這台裝置與瀏覽器，沒有上傳到網路。</small>
          <button type="button" class="memory-clear-all">清除設定與全部紀錄</button>
        </footer>
      </section>
    `;
    document.body.appendChild(modal);

    modal.addEventListener("click", async (event) => {
      if (event.target === modal || event.target.closest(".memory-close")) {
        closeModal();
        return;
      }

      const card = event.target.closest(".memory-card");
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (card && action) {
        const history = readHistory();
        const record = history.find((item) => item.id === card.dataset.memoryId);
        if (!record) return;

        if (action === "copy") {
          await copyText(recordToText(record));
          showToast("抽牌紀錄已複製 ✦");
        }

        if (action === "delete") {
          writeHistory(history.filter((item) => item.id !== record.id));
          renderHistory();
          showToast("已刪除這筆抽牌紀錄");
        }
      }

      if (event.target.closest(".memory-clear-all")) {
        const shouldClear = window.confirm(
          "要清除這台裝置上的設定與所有抽牌紀錄嗎？此動作無法復原。",
        );
        if (!shouldClear) return;
        window.localStorage.removeItem(SETTINGS_KEY);
        window.localStorage.removeItem(HISTORY_KEY);
        updateMemoryButtons();
        renderHistory();
        showToast("本機記憶已清除");
      }
    });
  };

  const updateMemoryButtons = () => {
    const count = readHistory().length;
    document.querySelectorAll(".memory-count").forEach((element) => {
      if (element.textContent !== String(count)) {
        element.textContent = String(count);
      }
      element.setAttribute("aria-label", `${count} 筆抽牌紀錄`);
    });
  };

  const ensureMemoryButton = () => {
    document.querySelectorAll(".topbar, .reading-topbar").forEach((topbar) => {
      if (topbar.querySelector(".memory-button")) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "memory-button";
      button.innerHTML = `
        <span aria-hidden="true">✦</span>
        <span class="memory-button-label">抽牌紀錄</span>
        <span class="memory-count">0</span>
      `;
      button.addEventListener("click", openModal);

      const guide = topbar.querySelector(".quiet-button");
      if (guide) topbar.insertBefore(button, guide);
      else topbar.appendChild(button);
    });
    updateMemoryButtons();
  };

  const refresh = () => {
    ensureMemoryButton();
    collectResult();
    window.clearTimeout(restoreTimer);
    restoreTimer = window.setTimeout(restoreVisibleSettings, 60);
  };

  document.addEventListener(
    "input",
    (event) => {
      if (
        event.target.matches(".question-field textarea, .choice-fields input")
      ) {
        window.setTimeout(collectSettings, 0);
      }
    },
    true,
  );

  document.addEventListener(
    "change",
    (event) => {
      if (event.target.matches(".toggle-row input, .spread-select")) {
        window.setTimeout(collectSettings, 0);
      }
    },
    true,
  );

  document.addEventListener(
    "click",
    (event) => {
      const spreadOption = event.target.closest(
        ".spread-dropdown-menu .spread-option",
      );
      if (spreadOption) {
        const spread = spreadOption.querySelector("strong")?.textContent?.trim();
        if (spread) writeSettings({ spread });
      }
      if (
        event.target.closest(
          ".spread-option, .deck-option, .scope-option, .primary-button, .step-back",
        )
      ) {
        window.setTimeout(collectSettings, 80);
      }
    },
    true,
  );

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal?.classList.contains("is-open")) {
      closeModal();
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
