import { NAV_ITEM_DEFINITIONS } from "../core/nav-items";
import type { ExtensionSettings, NavItemId } from "../core/types";
import { loadSettings, resetSettings, saveSettings } from "../storage/settings";

/**
 * Options UI コントローラー（spec.md 2.2, 2.7, 3.1 準拠）
 */

let currentSettings: ExtensionSettings;
let statusTimeoutId: ReturnType<typeof setTimeout> | null = null;

function showStatus(text: string): void {
  const statusEl = document.getElementById("status-message");
  if (!statusEl) return;

  statusEl.textContent = text;
  statusEl.classList.add("visible");

  if (statusTimeoutId !== null) {
    clearTimeout(statusTimeoutId);
  }

  statusTimeoutId = setTimeout(() => {
    statusEl.classList.remove("visible");
    statusTimeoutId = null;
  }, 1600);
}

function updateSectionsDisabledState(enabled: boolean): void {
  const dependentCards = document.querySelectorAll(".section-card:not(.master-card)");
  for (const card of dependentCards) {
    if (enabled) {
      card.classList.remove("disabled-by-master");
    } else {
      card.classList.add("disabled-by-master");
    }
  }
}

async function handleSettingChange<K extends keyof ExtensionSettings>(
  key: K,
  value: ExtensionSettings[K],
): Promise<void> {
  currentSettings = { ...currentSettings, [key]: value };
  await saveSettings({ [key]: value });
  showStatus("設定を保存しました");

  if (key === "enabled") {
    updateSectionsDisabledState(value as boolean);
  }
}

function renderOptions(root: HTMLElement): void {
  root.innerHTML = "";

  // 1. 一般（マスタースイッチ）
  const masterCard = document.createElement("div");
  masterCard.className = "section-card master-card";
  masterCard.innerHTML = `
    <div class="section-header">
      <div>
        <h2 class="section-title">拡張機能を有効にする</h2>
        <p class="section-desc">OFFにするとナビゲーション・投稿エリア・サイドバーの非表示と追加ボタンが無効化されます</p>
      </div>
      <label class="switch-label">
        <input type="checkbox" id="setting-enabled" ${currentSettings.enabled ? "checked" : ""} />
        <span class="switch-slider"></span>
      </label>
    </div>
  `;
  const enabledInput = masterCard.querySelector<HTMLInputElement>("#setting-enabled")!;
  enabledInput.addEventListener("change", () => {
    void handleSettingChange("enabled", enabledInput.checked);
  });
  root.appendChild(masterCard);

  // 2. 左ナビゲーションの個別非表示
  const navCard = document.createElement("div");
  navCard.className = "section-card";
  navCard.innerHTML = `
    <div class="section-header">
      <div>
        <h2 class="section-title">左ナビゲーション項目の非表示</h2>
        <p class="section-desc">チェックを入れた項目が、左サイドバーおよび「もっと見る」メニューから非表示になります</p>
      </div>
    </div>
    <div class="nav-items-toolbar">
      <button type="button" id="btn-nav-hide-all" class="btn-link">すべて非表示</button>
      <button type="button" id="btn-nav-show-all" class="btn-link">すべて表示</button>
    </div>
    <div class="nav-items-grid" id="nav-items-grid"></div>
  `;

  const grid = navCard.querySelector<HTMLElement>("#nav-items-grid")!;
  const hiddenSet = new Set(currentSettings.hiddenNavItems);

  for (const def of NAV_ITEM_DEFINITIONS) {
    const row = document.createElement("label");
    row.className = "nav-item-row";
    row.htmlFor = `nav-item-${def.id}`;

    const isHidden = hiddenSet.has(def.id);
    row.innerHTML = `
      <input type="checkbox" id="nav-item-${def.id}" value="${def.id}" ${isHidden ? "checked" : ""} />
      <div class="nav-item-info">
        <span class="nav-item-label">${def.label}</span>
        <span class="nav-item-desc">${def.description}</span>
      </div>
    `;

    const checkbox = row.querySelector<HTMLInputElement>("input")!;
    checkbox.addEventListener("change", () => {
      const nextHidden = new Set(currentSettings.hiddenNavItems);
      if (checkbox.checked) {
        nextHidden.add(def.id);
      } else {
        nextHidden.delete(def.id);
      }
      void handleSettingChange("hiddenNavItems", Array.from(nextHidden));
    });

    grid.appendChild(row);
  }

  const hideAllBtn = navCard.querySelector<HTMLButtonElement>("#btn-nav-hide-all")!;
  hideAllBtn.addEventListener("click", () => {
    const allIds: NavItemId[] = NAV_ITEM_DEFINITIONS.map((d) => d.id);
    const checkboxes = grid.querySelectorAll<HTMLInputElement>("input[type='checkbox']");
    for (const cb of checkboxes) cb.checked = true;
    void handleSettingChange("hiddenNavItems", allIds);
  });

  const showAllBtn = navCard.querySelector<HTMLButtonElement>("#btn-nav-show-all")!;
  showAllBtn.addEventListener("click", () => {
    const checkboxes = grid.querySelectorAll<HTMLInputElement>("input[type='checkbox']");
    for (const cb of checkboxes) cb.checked = false;
    void handleSettingChange("hiddenNavItems", []);
  });

  root.appendChild(navCard);

  // ホーム上部の投稿エリアの非表示
  const composerCard = document.createElement("div");
  composerCard.className = "section-card";
  composerCard.innerHTML = `
    <div class="section-header">
      <div>
        <h2 class="section-title">ホーム上部の投稿エリアを非表示にする</h2>
        <p class="section-desc">ホームタイムライン上部の投稿入力欄を非表示にします（初期設定はON）。投稿ダイアログや返信欄はそのまま使えます</p>
      </div>
      <label class="switch-label">
        <input type="checkbox" id="setting-hide-composer" aria-label="ホーム上部の投稿エリアを非表示にする" ${currentSettings.hideHomeComposer ? "checked" : ""} />
        <span class="switch-slider"></span>
      </label>
    </div>
  `;
  const composerInput = composerCard.querySelector<HTMLInputElement>("#setting-hide-composer")!;
  composerInput.addEventListener("change", () => {
    void handleSettingChange("hideHomeComposer", composerInput.checked);
  });
  root.appendChild(composerCard);

  // 3. 右サイドバー全体の非表示
  const sidebarCard = document.createElement("div");
  sidebarCard.className = "section-card";
  sidebarCard.innerHTML = `
    <div class="section-header">
      <div>
        <h2 class="section-title">右サイドバーを非表示にする</h2>
        <p class="section-desc">中央のタイムラインの幅・位置を保ったまま、トレンドやおすすめユーザーのサイドバー全体を非表示にします</p>
      </div>
      <label class="switch-label">
        <input type="checkbox" id="setting-hide-sidebar" ${currentSettings.hideRightSidebar ? "checked" : ""} />
        <span class="switch-slider"></span>
      </label>
    </div>
  `;
  const sidebarInput = sidebarCard.querySelector<HTMLInputElement>("#setting-hide-sidebar")!;
  sidebarInput.addEventListener("change", () => {
    void handleSettingChange("hideRightSidebar", sidebarInput.checked);
  });
  root.appendChild(sidebarCard);

  // 4. ツイート: 引用一覧ボタン
  const quoteCard = document.createElement("div");
  quoteCard.className = "section-card";
  quoteCard.innerHTML = `
    <div class="section-header">
      <div>
        <h2 class="section-title">引用リポスト一覧ボタン</h2>
        <p class="section-desc">各ツイートのアクションバーに引用一覧を開くリンクボタンを追加します（タイムラインから直接遷移可能）</p>
      </div>
      <label class="switch-label">
        <input type="checkbox" id="setting-quote-btn" ${currentSettings.showQuoteListButton ? "checked" : ""} />
        <span class="switch-slider"></span>
      </label>
    </div>
  `;
  const quoteInput = quoteCard.querySelector<HTMLInputElement>("#setting-quote-btn")!;
  quoteInput.addEventListener("change", () => {
    void handleSettingChange("showQuoteListButton", quoteInput.checked);
  });
  root.appendChild(quoteCard);

  // 5. ツイート: リポスト一覧ボタン
  const retweetCard = document.createElement("div");
  retweetCard.className = "section-card";
  retweetCard.innerHTML = `
    <div class="section-header">
      <div>
        <h2 class="section-title">リポスト（リツイート）一覧ボタン</h2>
        <p class="section-desc">各ツイートのアクションバーにリツイート一覧を開くリンクボタンを追加します（引用ボタンの右隣）</p>
      </div>
      <label class="switch-label">
        <input type="checkbox" id="setting-retweet-btn" ${currentSettings.showRetweetListButton ? "checked" : ""} />
        <span class="switch-slider"></span>
      </label>
    </div>
  `;
  const retweetInput = retweetCard.querySelector<HTMLInputElement>("#setting-retweet-btn")!;
  retweetInput.addEventListener("change", () => {
    void handleSettingChange("showRetweetListButton", retweetInput.checked);
  });
  root.appendChild(retweetCard);

  // 6. ユーザープロフィール: /all 誘導
  const profileCard = document.createElement("div");
  profileCard.className = "section-card";
  profileCard.innerHTML = `
    <div class="section-header">
      <div>
        <h2 class="section-title">プロフィールの初期表示を「すべて (/all)」にする</h2>
        <p class="section-desc">ユーザー名やアイコンをクリックしてプロフィールを開いた際、リポストを含む全投稿が表示される /all ページを初期表示します</p>
      </div>
      <label class="switch-label">
        <input type="checkbox" id="setting-profile-all-btn" ${currentSettings.redirectToUserProfileAll ? "checked" : ""} />
        <span class="switch-slider"></span>
      </label>
    </div>
  `;
  const profileAllInput = profileCard.querySelector<HTMLInputElement>("#setting-profile-all-btn")!;
  profileAllInput.addEventListener("change", () => {
    void handleSettingChange("redirectToUserProfileAll", profileAllInput.checked);
  });
  root.appendChild(profileCard);

  // 7. メディア: ダウンロードボタン
  const mediaCard = document.createElement("div");
  mediaCard.className = "section-card";
  mediaCard.innerHTML = `
    <div class="section-header">
      <div>
        <h2 class="section-title">画像・動画一括ダウンロードボタン</h2>
        <p class="section-desc">画像（原寸）や動画・GIF（最高画質MP4）を含む投稿に一括保存ボタンを追加します</p>
      </div>
      <label class="switch-label">
        <input type="checkbox" id="setting-media-btn" ${currentSettings.enableMediaDownload ? "checked" : ""} />
        <span class="switch-slider"></span>
      </label>
    </div>
  `;
  const mediaInput = mediaCard.querySelector<HTMLInputElement>("#setting-media-btn")!;
  mediaInput.addEventListener("change", () => {
    void handleSettingChange("enableMediaDownload", mediaInput.checked);
  });
  root.appendChild(mediaCard);

  updateSectionsDisabledState(currentSettings.enabled);
}

async function init(): Promise<void> {
  const root = document.getElementById("options-root");
  if (!root) return;

  currentSettings = await loadSettings();
  renderOptions(root);

  const resetBtn = document.getElementById("reset-button");
  resetBtn?.addEventListener("click", async () => {
    if (!window.confirm("設定をすべて初期値に戻しますか？")) return;
    currentSettings = await resetSettings();
    renderOptions(root);
    showStatus("設定を初期値に戻しました");
  });
}

void init();
