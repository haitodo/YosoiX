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
import { ComposerController } from "./composer-controller";
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
import {
  handleRetweetButtonClick,
  removeAllRetweetListButtons,
  removeRetweetListButtonFromBar,
  RETWEET_BUTTON_ACTION,
  upsertRetweetListButton,
} from "./retweet-list-button";
import { SidebarController } from "./sidebar-controller";
import { extractOuterTweetIdentity, findOuterActionBar, hasOuterDomMedia } from "./tweet-dom";
import {
  extractUsernameFromProfilePath,
  toUserProfileAllPath,
} from "../core/user-profile";

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

const ROOT_ENABLED_ATTR = "data-yosoix-enabled";

export class ContentApp {
  private settings: ExtensionSettings = {
    ...DEFAULT_SETTINGS,
    hiddenNavItems: [...DEFAULT_SETTINGS.hiddenNavItems],
  };

  private readonly mediaCache = new MediaCache();
  private readonly downloadManager = new DownloadManager(this.mediaCache);
  private readonly navController = new NavigationController();
  private readonly sidebarController = new SidebarController();
  private readonly composerController = new ComposerController();
  private readonly domObserver: DomObserver;
  private readonly articlesById = new Map<string, Set<HTMLElement>>();
  private readonly articleIds = new WeakMap<HTMLElement, string>();
  private uiListeners: AbortController | null = null;
  private initialized = false;
  private suspended = false;
  private readonly lifecycle = new AbortController();
  private unsubscribeSettings = (): void => {};
  private unsubscribeDownloads = (): void => {};

  constructor() {
    this.domObserver = new DomObserver({
      onTweetArticlesAdded: (articles) => this.reconcileArticles(articles),
      onTweetArticlesRemoved: (articles) => {
        for (const article of articles) this.forgetArticle(article);
      },
      onNavigationMutated: () => this.navController.applyToDocument(),
      onLayoutMutated: () => {
        this.sidebarController.reconcileLayout();
        this.composerController.reconcileLayout();
      },
    });
  }

  async init(): Promise<void> {
    // 1. MAIN world → ISOLATED world ブリッジ受信＆初期バッファ解放ハンドシェイク
    const signal = this.lifecycle.signal;
    window.addEventListener("message", this.handleWindowMessage, { signal });

    // 2. ダウンロード状態変化を DOM ボタンへ反映
    this.unsubscribeDownloads = this.downloadManager.subscribe((tweetId, status) => {
      if (!this.isActive() || !this.settings.enableMediaDownload) return;
      syncDownloadButtonStateInDom(tweetId, status);
    });

    document.addEventListener("visibilitychange", () => this.syncActivity(), { signal });
    window.addEventListener("pagehide", () => { this.suspended = true; this.syncActivity(); }, { signal });
    window.addEventListener("pageshow", () => { this.suspended = false; this.syncActivity(); }, { signal });
    let settingsChangedDuringLoad = false;
    this.unsubscribeSettings = subscribeSettingsChanged((nextSettings) => {
      settingsChangedDuringLoad = true;
      this.applySettings(nextSettings);
    });
    const settings = await loadSettings();
    if (!signal.aborted && !settingsChangedDuringLoad) this.applySettings(settings);
  }

  destroy(): void {
    this.suspended = true;
    this.stopActivity();
    this.lifecycle.abort();
    this.unsubscribeSettings();
    this.unsubscribeDownloads();
    this.mediaCache.clear();
  }

  private notifyBridgeReady(): void {
    const origin = window.location.origin;
    if (!ALLOWED_PAGE_ORIGINS.has(origin)) return;
    const readyEnvelope: BridgeReadyEnvelope = {
      [BRIDGE_NAMESPACE]: true,
      type: "BRIDGE_READY",
      captureEnabled: this.settings.enabled && this.needsTweets(),
      includeMedia: this.settings.enableMediaDownload,
      trackNavigation: this.settings.enabled && (this.settings.redirectToUserProfileAll || this.needsLayout()),
    };
    window.postMessage(readyEnvelope, origin);
  }

  private applySettings(nextSettings: ExtensionSettings): void {
    if (this.initialized && JSON.stringify(this.settings) === JSON.stringify(nextSettings)) return;
    const previous = this.settings;
    this.settings = nextSettings;
    this.initialized = true;
    this.notifyBridgeReady();
    this.stopActivity();

    if (!nextSettings.enabled) {
      document.documentElement.removeAttribute(ROOT_ENABLED_ATTR);
      this.navController.updateConfig(false, []);
      this.sidebarController.updateConfig(false, false);
      this.composerController.updateConfig(false, false);
      removeAllQuoteListButtons();
      removeAllRetweetListButtons();
      removeAllMediaDownloadButtons();
      this.mediaCache.clear();
      return;
    }

    document.documentElement.setAttribute(ROOT_ENABLED_ATTR, "true");

    if (!nextSettings.showQuoteListButton && previous.showQuoteListButton) {
      removeAllQuoteListButtons();
    }
    if (!nextSettings.showRetweetListButton && previous.showRetweetListButton) {
      removeAllRetweetListButtons();
    }
    if (!nextSettings.enableMediaDownload && previous.enableMediaDownload) {
      removeAllMediaDownloadButtons();
    }

    if (!this.needsTweets() || (previous.enableMediaDownload && !nextSettings.enableMediaDownload)) this.mediaCache.clear();
    this.syncActivity();
  }

  private needsTweets(): boolean {
    return this.settings.showQuoteListButton || this.settings.showRetweetListButton || this.settings.enableMediaDownload;
  }

  private needsLayout(): boolean {
    return this.settings.hideRightSidebar || this.settings.hideHomeComposer;
  }

  private isActive(): boolean {
    return this.initialized && this.settings.enabled && !this.suspended && document.visibilityState !== "hidden";
  }

  private stopActivity(): void {
    this.domObserver.stop();
    this.uiListeners?.abort();
    this.uiListeners = null;
    this.articlesById.clear();
  }

  private syncActivity(): void {
    if (!this.isActive()) { this.stopActivity(); return; }
    if (this.uiListeners) return;
    this.navController.updateConfig(true, this.settings.hiddenNavItems, false);
    this.sidebarController.updateConfig(true, this.settings.hideRightSidebar, false);
    this.composerController.updateConfig(true, this.settings.hideHomeComposer, false);
    this.domObserver.start({
      tweets: this.needsTweets(),
      navigation: this.settings.hiddenNavItems.length > 0,
      layout: this.needsLayout(),
    });
    this.uiListeners = new AbortController();
    const signal = this.uiListeners.signal;
    if (this.needsTweets() || this.settings.redirectToUserProfileAll) {
      document.addEventListener("click", this.handleDelegatedClick, { capture: true, signal });
    }
    if (this.needsTweets()) document.addEventListener("keydown", this.handleDelegatedKeydown, { capture: true, signal });
    if (this.settings.redirectToUserProfileAll) {
      document.addEventListener("mouseover", this.handleDelegatedMouseOver, { passive: true, signal });
    }
    if (this.settings.redirectToUserProfileAll || this.needsLayout()) {
      window.addEventListener("popstate", this.handleRouteChanged, { passive: true, signal });
    }
    this.checkCurrentPathForProfileAllRedirect();
  }

  private readonly handleRouteChanged = (): void => {
    if (!this.isActive()) return;
    this.domObserver.reconcileRoute();
    this.checkCurrentPathForProfileAllRedirect();
  };

  private forgetArticle(article: HTMLElement): void {
    const id = this.articleIds.get(article);
    if (!id) return;
    const articles = this.articlesById.get(id);
    articles?.delete(article);
    if (!articles?.size) this.articlesById.delete(id);
    this.articleIds.delete(article);
  }

  private readonly handleWindowMessage = (event: MessageEvent<unknown>): void => {
    // 同一ウィンドウかつ許可された X オリジンからのメッセージのみ受け付ける（spec.md 5.3）
    if (event.source !== window) return;
    if (!ALLOWED_PAGE_ORIGINS.has(event.origin)) return;
    if (!this.isActive()) return;
    if (typeof event.data === "object" && event.data !== null &&
      (event.data as Record<string, unknown>)[BRIDGE_NAMESPACE] === true &&
      (event.data as Record<string, unknown>).type === "ROUTE_CHANGED") {
      this.handleRouteChanged();
      return;
    }
    if (!this.needsTweets()) return;

    const envelope = validateBridgeEnvelope(event.data);
    if (!envelope) return;
    if (!this.settings.enableMediaDownload) {
      for (const entry of envelope.entries) entry.media = [];
    }

    const updatedTweetIds = this.mediaCache.upsertMany(envelope.entries);
    if (!this.settings.enabled || updatedTweetIds.length === 0) {
      return;
    }

    for (const id of updatedTweetIds) {
      const articles = this.articlesById.get(id);
      if (articles) this.domObserver.enqueueArticles(articles);
    }
  };

  private readonly handleDelegatedClick = (event: MouseEvent): void => {
    if (!this.settings.enabled) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    const actionEl = target.closest<HTMLElement>("[data-yosoix-action]");
    const action = actionEl?.getAttribute("data-yosoix-action");

    if (action === QUOTE_BUTTON_ACTION && actionEl instanceof HTMLAnchorElement) {
      handleQuoteButtonClick(event, actionEl);
      return;
    }

    if (action === RETWEET_BUTTON_ACTION && actionEl instanceof HTMLAnchorElement) {
      handleRetweetButtonClick(event, actionEl);
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
      return;
    }

    // 2. ユーザープロフィールリンクのクリック時、リポストを含む全投稿 (/all) へ誘導
    if (this.settings.redirectToUserProfileAll) {
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (anchor && !anchor.closest("[data-yosoix-slot]")) {
        const rawHref = anchor.getAttribute("href") ?? "";
        const allPath = toUserProfileAllPath(rawHref);
        if (allPath) {
          anchor.setAttribute("href", allPath);

          const isPlainPrimaryClick =
            event.button === 0 &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.shiftKey &&
            !event.altKey;

          if (isPlainPrimaryClick) {
            event.preventDefault();
            event.stopPropagation();
            if (window.location.pathname !== allPath) {
              window.history.pushState(null, "", allPath);
              window.dispatchEvent(new PopStateEvent("popstate"));
            }
          }
        }
      }
    }
  };

  private readonly handleDelegatedMouseOver = (event: MouseEvent): void => {
    if (!this.settings.enabled || !this.settings.redirectToUserProfileAll) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor.closest("[data-yosoix-slot]")) return;

    const rawHref = anchor.getAttribute("href") ?? "";
    const allPath = toUserProfileAllPath(rawHref);
    if (allPath && rawHref !== allPath) {
      anchor.setAttribute("href", allPath);
    }
  };

  private checkCurrentPathForProfileAllRedirect(): void {
    if (!this.settings.enabled || !this.settings.redirectToUserProfileAll) return;
    const username = extractUsernameFromProfilePath(window.location.pathname);
    if (username) {
      const allPath = `/${username}/all${window.location.search}${window.location.hash}`;
      window.history.replaceState(null, "", allPath);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }

  private readonly handleDelegatedKeydown = (event: KeyboardEvent): void => {
    if (!this.isActive() || !this.needsTweets()) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    // 追加ボタン上での Enter / Space が親 <article tabindex="0"> の詳細遷移を発火させないように遮断
    if (target.closest("[data-yosoix-action]")) {
      event.stopPropagation();
    }
  };

  private reconcileArticles(articles: ReadonlySet<HTMLElement>): void {
    if (!this.isActive() || !this.needsTweets()) return;
    for (const article of articles) {
      this.reconcileSingleArticle(article);
    }
  }

  private reconcileSingleArticle(article: HTMLElement): void {
    const actionBar = findOuterActionBar(article);
    if (!actionBar) return;

    const identity = extractOuterTweetIdentity(article);
    if (!identity) {
      this.forgetArticle(article);
      removeQuoteListButtonFromBar(actionBar);
      removeRetweetListButtonFromBar(actionBar);
      removeMediaDownloadButtonFromBar(actionBar);
      return;
    }

    if (this.articleIds.get(article) !== identity.tweetId) this.forgetArticle(article);
    this.articleIds.set(article, identity.tweetId);
    let articles = this.articlesById.get(identity.tweetId);
    if (!articles) { articles = new Set(); this.articlesById.set(identity.tweetId, articles); }
    articles.add(article);
    const cacheEntry = this.mediaCache.get(identity.tweetId);

    // 1. 引用リポスト一覧ボタン（FR-030）
    if (this.settings.showQuoteListButton) {
      upsertQuoteListButton(actionBar, identity, cacheEntry?.quoteCount);
    } else {
      removeQuoteListButtonFromBar(actionBar);
    }

    // 2. リポスト（リツイート）一覧ボタン
    if (this.settings.showRetweetListButton) {
      upsertRetweetListButton(actionBar, identity, cacheEntry?.retweetCount);
    } else {
      removeRetweetListButtonFromBar(actionBar);
    }

    // 3. メディアダウンロードボタン（FR-040）
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

