import { DownloadManager } from "../core/download-manager";
import { MediaCache } from "../core/media-cache";
import {
  BRIDGE_NAMESPACE,
  DEFAULT_SETTINGS,
  type BridgeReadyEnvelope,
  type ExtensionSettings,
} from "../core/types";
import { ALLOWED_PAGE_ORIGINS, validateBridgeEnvelope } from "../core/validators";
import { loadSettings, subscribeSettingsChanged } from "../storage/settings";
import { DomObserver } from "./dom-observer";
import {
  DOWNLOAD_BUTTON_ACTION,
  removeAllMediaDownloadButtons,
  removeMediaDownloadButtonFromBar,
  syncDownloadButtonStateInDom,
  upsertMediaDownloadButton,
} from "./media-download-button";
import { NavigationController } from "./navigation-controller";
import {
  handleQuoteButtonClick,
  QUOTE_BUTTON_ACTION,
  removeAllQuoteListButtons,
  removeQuoteListButtonFromBar,
  upsertQuoteListButton,
} from "./quote-list-button";
import { SidebarController } from "./sidebar-controller";
import {
  extractOuterTweetIdentity,
  findOuterActionBar,
  hasOuterDomMedia,
  X_SELECTORS,
} from "./tweet-dom";

/**
 * Content Script エントリーポイント（ISOLATED world: spec.md 4.3）
 *
 * 責務:
 * 1. MAIN world（Page Bridge）からの MEDIA_CAPTURED メッセージを厳格に検証して MediaCache に格納する。
 * 2. API レスポンスが DOM 描画より後に到着するレースコンディションを解消するため、
 *    現在マウント中の <article> と MediaCache を双方向に同期（reconcile）する。
 * 3. ボタンクリックはキャプチャフェーズのイベント委譲（Event Delegation）1か所で処理し、
 *    React (#react-root) によるツイート詳細遷移への誤伝播を完全に防ぐ。
 * 4. 設定変更・マスター ON/OFF をページ再読み込みなしで即時反映する。
 */

const TWEET_ID_MARK_ATTR = "data-yosoix-article-tweet-id";
const ROOT_ENABLED_ATTR = "data-yosoix-enabled";

class ContentApp {
  private settings: ExtensionSettings = {
    ...DEFAULT_SETTINGS,
    hiddenNavItems: [...DEFAULT_SETTINGS.hiddenNavItems],
  };

  private readonly mediaCache = new MediaCache();
  private readonly downloadManager = new DownloadManager(this.mediaCache);
  private readonly navController = new NavigationController();
  private readonly sidebarController = new SidebarController();
  private readonly domObserver: DomObserver;

  constructor() {
    this.domObserver = new DomObserver({
      onTweetArticlesAdded: (articles) => this.reconcileArticles(articles),
      onNavigationMutated: () => this.navController.applyToDocument(),
      onLayoutMutated: () => this.sidebarController.reconcileLayout(),
    });
  }

  async init(): Promise<void> {
    // 1. MAIN world → ISOLATED world ブリッジ受信＆初期バッファ解放ハンドシェイク
    window.addEventListener("message", this.handleWindowMessage);
    this.notifyBridgeReady();

    // 2. ダウンロード状態変化を DOM ボタンへ反映
    this.downloadManager.subscribe((tweetId, status) => {
      if (!this.settings.enabled || !this.settings.enableMediaDownload) return;
      syncDownloadButtonStateInDom(tweetId, status);
    });

    // 3. イベント委譲（React 18 の #react-root リスナーより先に捕捉するため capture: true）
    document.addEventListener("click", this.handleDelegatedClick, { capture: true });
    document.addEventListener("keydown", this.handleDelegatedKeydown, { capture: true });

    // 4. 初期設定ロードと購読
    this.settings = await loadSettings();
    this.applySettings(this.settings);

    subscribeSettingsChanged((nextSettings) => {
      this.applySettings(nextSettings);
    });
  }

  private notifyBridgeReady(): void {
    const origin = window.location.origin;
    if (!ALLOWED_PAGE_ORIGINS.has(origin)) return;
    const readyEnvelope: BridgeReadyEnvelope = {
      [BRIDGE_NAMESPACE]: true,
      type: "BRIDGE_READY",
    };
    window.postMessage(readyEnvelope, origin);
  }

  private applySettings(nextSettings: ExtensionSettings): void {
    this.settings = nextSettings;

    if (!nextSettings.enabled) {
      document.documentElement.removeAttribute(ROOT_ENABLED_ATTR);
      this.domObserver.stop();
      this.navController.restoreAll();
      this.sidebarController.restoreAll();
      removeAllQuoteListButtons();
      removeAllMediaDownloadButtons();
      return;
    }

    document.documentElement.setAttribute(ROOT_ENABLED_ATTR, "true");
    this.navController.updateConfig(true, nextSettings.hiddenNavItems);
    this.sidebarController.updateConfig(true, nextSettings.hideRightSidebar);

    if (!nextSettings.showQuoteListButton) {
      removeAllQuoteListButtons();
    }
    if (!nextSettings.enableMediaDownload) {
      removeAllMediaDownloadButtons();
    }

    this.domObserver.start();
    this.domObserver.reconcileVisibleDom();
  }

  private readonly handleWindowMessage = (event: MessageEvent<unknown>): void => {
    // 同一ウィンドウかつ許可された X オリジンからのメッセージのみ受け付ける（spec.md 5.3）
    if (event.source !== window) return;
    if (!ALLOWED_PAGE_ORIGINS.has(event.origin)) return;

    const envelope = validateBridgeEnvelope(event.data);
    if (!envelope) return;

    const updatedTweetIds = this.mediaCache.upsertMany(envelope.entries);
    if (!this.settings.enabled || updatedTweetIds.length === 0) {
      return;
    }

    // すでに画面上に描画されている該当 tweetId の <article> があれば、引用件数・DLボタンを即時更新する
    this.reconcileMountedTweetsById(updatedTweetIds);
  };

  private readonly handleDelegatedClick = (event: MouseEvent): void => {
    if (!this.settings.enabled) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    const actionEl = target.closest<HTMLElement>("[data-yosoix-action]");
    if (!actionEl) return;

    const action = actionEl.getAttribute("data-yosoix-action");

    if (action === QUOTE_BUTTON_ACTION && actionEl instanceof HTMLAnchorElement) {
      handleQuoteButtonClick(event, actionEl);
      return;
    }

    if (action === DOWNLOAD_BUTTON_ACTION && actionEl instanceof HTMLButtonElement) {
      event.preventDefault();
      event.stopPropagation();

      if (event.button !== 0) return;
      const tweetId = actionEl.getAttribute("data-yosoix-tweet-id");
      if (!tweetId) return;
      const screenName = actionEl.getAttribute("data-yosoix-screen-name") ?? undefined;
      void this.downloadManager.downloadTweetMedia(tweetId, screenName);
    }
  };

  private readonly handleDelegatedKeydown = (event: KeyboardEvent): void => {
    if (!this.settings.enabled) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    // 追加ボタン上での Enter / Space が親 <article tabindex="0"> の詳細遷移を発火させないように遮断
    if (target.closest("[data-yosoix-action]")) {
      event.stopPropagation();
    }
  };

  private reconcileArticles(articles: ReadonlySet<HTMLElement>): void {
    if (!this.settings.enabled) return;
    for (const article of articles) {
      this.reconcileSingleArticle(article);
    }
  }

  private reconcileMountedTweetsById(tweetIds: readonly string[]): void {
    const targetSet = new Set(tweetIds);
    const mountedArticles = document.querySelectorAll<HTMLElement>(X_SELECTORS.tweetArticle);
    for (const article of mountedArticles) {
      const markedId = article.getAttribute(TWEET_ID_MARK_ATTR);
      if (markedId && targetSet.has(markedId)) {
        this.reconcileSingleArticle(article);
      } else if (!markedId) {
        const identity = extractOuterTweetIdentity(article);
        if (identity && targetSet.has(identity.tweetId)) {
          this.reconcileSingleArticle(article);
        }
      }
    }
  }

  private reconcileSingleArticle(article: HTMLElement): void {
    const actionBar = findOuterActionBar(article);
    if (!actionBar) return;

    const identity = extractOuterTweetIdentity(article);
    if (!identity) {
      article.removeAttribute(TWEET_ID_MARK_ATTR);
      removeQuoteListButtonFromBar(actionBar);
      removeMediaDownloadButtonFromBar(actionBar);
      return;
    }

    article.setAttribute(TWEET_ID_MARK_ATTR, identity.tweetId);
    const cacheEntry = this.mediaCache.get(identity.tweetId);

    // 1. 引用リポスト一覧ボタン（FR-030）
    if (this.settings.showQuoteListButton) {
      upsertQuoteListButton(actionBar, identity, cacheEntry?.quoteCount);
    } else {
      removeQuoteListButtonFromBar(actionBar);
    }

    // 2. メディアダウンロードボタン（FR-040）
    // キャッシュヒット時は API 解析結果（media.length > 0）を権威ある情報源とし、
    // キャッシュ未到着時のみ引用枠外の DOM メディア要素を補助判定に使う。
    if (this.settings.enableMediaDownload) {
      const hasMedia =
        cacheEntry !== undefined ? cacheEntry.media.length > 0 : hasOuterDomMedia(article);

      if (hasMedia) {
        const dlStatus = this.downloadManager.getStatus(identity.tweetId);
        upsertMediaDownloadButton(actionBar, identity, dlStatus, cacheEntry?.media.length);
      } else {
        removeMediaDownloadButtonFromBar(actionBar);
      }
    } else {
      removeMediaDownloadButtonFromBar(actionBar);
    }
  }
}

const app = new ContentApp();
void app.init();
