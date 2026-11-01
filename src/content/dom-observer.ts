import { X_SELECTORS } from "./tweet-dom";

/**
 * 差分駆動型 DOM 監視オーケストレーター（spec.md 4.3.1, 5.1, 5.2, 6.5）
 *
 * パフォーマンス設計:
 * - setInterval / ポーリングを一切行わない。
 * - 全 DOM の繰り返し走査を行わず、MutationObserver で追加された要素（addedNodes）のみを
 *   requestAnimationFrame 単位でバッチ処理する。
 * - 監視対象は #react-root のルート構造変化と、実際に対象 UI が存在する
 *   header[role="banner"] / main[role="main"] / #layers に限定する。
 * - SPA 画面遷移で main や header が再生成された場合も自動で監視対象を張り直す。
 */

export interface DomObserverCallbacks {
  /** 新規追加・遅延マウントされた個別ツイート <article> 群を処理する */
  onTweetArticlesAdded: (articles: ReadonlySet<HTMLElement>) => void;
  /** 左ナビゲーションまたは「もっと見る」メニューの変化時に呼ばれる */
  onNavigationMutated: () => void;
  /** main レイアウトや SPA ルート遷移時に右サイドバー制御を再調整する */
  onLayoutMutated: () => void;
}

export class DomObserver {
  private readonly callbacks: DomObserverCallbacks;
  private rootLifecycleObserver: MutationObserver | null = null;
  private scopedObserver: MutationObserver | null = null;
  private observedHeader: Element | null = null;
  private observedMain: Element | null = null;
  private observedLayers: Element | null = null;

  private readonly pendingArticles = new Set<HTMLElement>();
  private pendingNavSync = false;
  private pendingLayoutSync = false;
  private rafId: number | null = null;
  private lastPathname = "";
  private running = false;

  private readonly handlePopState = (): void => {
    this.checkUrlTransition();
  };

  constructor(callbacks: DomObserverCallbacks) {
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastPathname = window.location.pathname;

    this.scopedObserver = new MutationObserver((mutations) => {
      this.handleScopedMutations(mutations);
    });

    // #react-root 直下の構造置換（初期マウント・SPA ルート再構築）を監視
    const reactRoot = document.querySelector(X_SELECTORS.reactRoot) ?? document.body;
    if (reactRoot) {
      this.rootLifecycleObserver = new MutationObserver(() => {
        this.rebindScopedTargets();
        this.checkUrlTransition();
      });
      this.rootLifecycleObserver.observe(reactRoot, {
        childList: true,
        subtree: false,
      });
    }

    window.addEventListener("popstate", this.handlePopState, { passive: true });

    this.rebindScopedTargets();
    this.scanInitialTweets();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    this.rootLifecycleObserver?.disconnect();
    this.rootLifecycleObserver = null;

    this.scopedObserver?.disconnect();
    this.scopedObserver = null;

    this.observedHeader = null;
    this.observedMain = null;
    this.observedLayers = null;

    window.removeEventListener("popstate", this.handlePopState);

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingArticles.clear();
    this.pendingNavSync = false;
    this.pendingLayoutSync = false;
  }

  /**
   * 設定変更時など、現在画面上に表示されている投稿・レイアウトを再調整したいときに呼ぶ。
   */
  reconcileVisibleDom(): void {
    if (!this.running) return;
    this.rebindScopedTargets();
    this.callbacks.onNavigationMutated();
    this.callbacks.onLayoutMutated();
    this.scanInitialTweets();
  }

  private rebindScopedTargets(): void {
    if (!this.scopedObserver) return;

    const nextHeader = document.querySelector(X_SELECTORS.bannerHeader);
    const nextMain = document.querySelector(X_SELECTORS.mainRoot);
    const nextLayers = document.querySelector(X_SELECTORS.layersRoot);

    if (
      nextHeader === this.observedHeader &&
      nextMain === this.observedMain &&
      nextLayers === this.observedLayers
    ) {
      return;
    }

    this.scopedObserver.disconnect();
    this.observedHeader = nextHeader;
    this.observedMain = nextMain;
    this.observedLayers = nextLayers;

    if (nextHeader) {
      this.scopedObserver.observe(nextHeader, { childList: true, subtree: true });
      this.pendingNavSync = true;
    }
    if (nextMain) {
      this.scopedObserver.observe(nextMain, { childList: true, subtree: true });
      this.pendingLayoutSync = true;
    }
    if (nextLayers) {
      this.scopedObserver.observe(nextLayers, { childList: true, subtree: true });
      this.pendingNavSync = true;
    }

    // 初期マウント時に header / main / #layers がまだ #react-root の深い階層で生成途中の場合のフォールバック
    if (!nextHeader || !nextMain) {
      const reactRoot = document.querySelector(X_SELECTORS.reactRoot);
      if (reactRoot) {
        this.scopedObserver.observe(reactRoot, { childList: true, subtree: true });
      }
    }

    this.scheduleFlush();
  }

  private scanInitialTweets(): void {
    const articles = document.querySelectorAll<HTMLElement>(X_SELECTORS.tweetArticle);
    if (articles.length === 0) return;
    for (const article of articles) {
      this.pendingArticles.add(article);
    }
    this.scheduleFlush();
  }

  private checkUrlTransition(): void {
    const currentPath = window.location.pathname;
    if (currentPath !== this.lastPathname) {
      this.lastPathname = currentPath;
      this.pendingLayoutSync = true;
      this.pendingNavSync = true;
      this.scheduleFlush();
    }
  }

  private handleScopedMutations(mutations: MutationRecord[]): void {
    // 初期フォールバック監視中に対象ルートが出現した場合はスコープを絞り直す
    if (!this.observedHeader || !this.observedMain) {
      if (
        document.querySelector(X_SELECTORS.bannerHeader) !== this.observedHeader ||
        document.querySelector(X_SELECTORS.mainRoot) !== this.observedMain
      ) {
        this.rebindScopedTargets();
      }
    }

    this.checkUrlTransition();

    for (const mutation of mutations) {
      if (mutation.addedNodes.length === 0) continue;

      for (const added of mutation.addedNodes) {
        if (!(added instanceof HTMLElement)) continue;
        // 自身が挿入した YosoiX ボタンの DOM 変更は再処理しない（無限ループ防止）
        if (added.classList.contains("yosoix-action-slot")) continue;

        // 1. ツイート <article> 自身、子孫の <article>、または既存 <article> 内への遅延要素挿入
        if (added.matches(X_SELECTORS.tweetArticle)) {
          this.pendingArticles.add(added);
        } else {
          const ancestorArticle = added.closest<HTMLElement>(X_SELECTORS.tweetArticle);
          if (ancestorArticle) {
            this.pendingArticles.add(ancestorArticle);
          } else {
            const innerArticles = added.querySelectorAll<HTMLElement>(X_SELECTORS.tweetArticle);
            for (const art of innerArticles) {
              this.pendingArticles.add(art);
            }
          }
        }

        // 2. ナビゲーション・メニュー関連の更新判定
        if (
          (this.observedHeader && this.observedHeader.contains(added)) ||
          (this.observedLayers && this.observedLayers.contains(added))
        ) {
          this.pendingNavSync = true;
        }

        // 3. 右サイドバー・メインカラム構造の更新判定
        if (
          added.matches(`${X_SELECTORS.primaryColumn}, ${X_SELECTORS.sidebarColumn}`) ||
          added.querySelector(`${X_SELECTORS.primaryColumn}, ${X_SELECTORS.sidebarColumn}`)
        ) {
          this.pendingLayoutSync = true;
        }
      }
    }

    if (this.pendingArticles.size > 0 || this.pendingNavSync || this.pendingLayoutSync) {
      this.scheduleFlush();
    }
  }

  private scheduleFlush(): void {
    if (this.rafId !== null || !this.running) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.flush();
    });
  }

  private flush(): void {
    if (!this.running) return;

    if (this.pendingNavSync) {
      this.pendingNavSync = false;
      this.callbacks.onNavigationMutated();
    }

    if (this.pendingLayoutSync) {
      this.pendingLayoutSync = false;
      this.callbacks.onLayoutMutated();
    }

    if (this.pendingArticles.size > 0) {
      const batch = new Set<HTMLElement>();
      for (const article of this.pendingArticles) {
        if (article.isConnected) {
          batch.add(article);
        }
      }
      this.pendingArticles.clear();

      if (batch.size > 0) {
        this.callbacks.onTweetArticlesAdded(batch);
      }
    }
  }
}
