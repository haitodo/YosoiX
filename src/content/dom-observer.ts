import { X_SELECTORS } from "./tweet-dom";

export interface DomObserverOptions {
  tweets: boolean;
  navigation: boolean;
  layout: boolean;
}

export interface DomObserverCallbacks {
  onTweetArticlesAdded: (articles: ReadonlySet<HTMLElement>) => void;
  onTweetArticlesRemoved?: (articles: ReadonlySet<HTMLElement>) => void;
  onNavigationMutated: () => void;
  onLayoutMutated: () => void;
}

/** 必要な UI だけを差分監視する。ルート置換は祖先の直下監視で検出する。 */
export class DomObserver {
  private observer: MutationObserver | null = null;
  private header: Element | null = null;
  private main: Element | null = null;
  private layers: Element | null = null;
  private readonly pendingArticles = new Set<HTMLElement>();
  private pendingNav = false;
  private pendingLayout = false;
  private rafId: number | null = null;
  private options: DomObserverOptions = { tweets: true, navigation: true, layout: true };

  constructor(private readonly callbacks: DomObserverCallbacks) {}

  start(options: DomObserverOptions = this.options): void {
    if (this.observer && Object.keys(options).every(
      (key) => options[key as keyof DomObserverOptions] === this.options[key as keyof DomObserverOptions],
    )) return;
    this.stop();
    this.options = options;
    if (!options.tweets && !options.navigation && !options.layout) return;
    this.observer = new MutationObserver((records) => this.handleMutations(records));
    this.bindTargets();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.header = this.main = this.layers = null;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.pendingArticles.clear();
    this.pendingNav = this.pendingLayout = false;
  }

  enqueueArticles(articles: Iterable<HTMLElement>): void {
    if (!this.observer || !this.options.tweets) return;
    for (const article of articles) {
      if (article.isConnected) this.pendingArticles.add(article);
    }
    this.schedule();
  }

  reconcileVisibleDom(): void {
    if (!this.observer) return;
    this.pendingNav = this.options.navigation;
    this.pendingLayout = this.options.layout;
    if (this.options.tweets) {
      this.enqueueArticles(document.querySelectorAll<HTMLElement>(X_SELECTORS.tweetArticle));
    }
    this.schedule();
  }

  /** URL 通知は履歴変更時だけ受け取る。通常の DOM 更新ごとに URL を調べない。 */
  reconcileRoute(): void {
    if (!this.observer || !this.options.layout) return;
    this.pendingLayout = true;
    this.schedule();
  }

  private bindTargets(): void {
    if (!this.observer) return;
    this.observer.disconnect();
    this.header = this.options.navigation ? document.querySelector(X_SELECTORS.bannerHeader) : null;
    this.main = this.options.tweets || this.options.layout ? document.querySelector(X_SELECTORS.mainRoot) : null;
    this.layers = this.options.navigation || this.options.tweets ? document.querySelector(X_SELECTORS.layersRoot) : null;
    const roots = new Set<Element>();
    for (const target of [this.header, this.main, this.layers]) {
      if (target) roots.add(target);
    }
    const ancestors = new Set<Element>([document.documentElement]);
    for (const target of roots) {
      for (let parent = target.parentElement; parent; parent = parent.parentElement) ancestors.add(parent);
    }
    const missing = (this.options.navigation && !this.header) ||
      ((this.options.tweets || this.options.layout) && !this.main) ||
      ((this.options.navigation || this.options.tweets) && !this.layers);
    if (missing) {
      // 起動途中や特殊画面のみ。必要なルートが揃うと直ちに範囲を絞り直す。
      this.observeRoot(document.documentElement);
    } else {
      for (const parent of ancestors) {
        if (!roots.has(parent)) this.observer.observe(parent, { childList: true });
      }
      for (const root of roots) this.observeRoot(root);
    }
    this.reconcileVisibleDom();
  }

  private observeRoot(root: Element): void {
    this.observer?.observe(root, {
      childList: true,
      subtree: true,
      ...(this.options.layout && (root === this.main || root === document.documentElement) ? {
        attributes: true,
        attributeFilter: ["data-testid", "role", "contenteditable"],
      } : {}),
    });
  }

  private collectArticles(node: Node, output: Set<HTMLElement>): void {
    if (!(node instanceof Element)) return;
    if (node.matches(X_SELECTORS.tweetArticle)) output.add(node as HTMLElement);
    for (const article of node.querySelectorAll<HTMLElement>(X_SELECTORS.tweetArticle)) output.add(article);
  }

  private handleMutations(records: MutationRecord[]): void {
    const removed = new Set<HTMLElement>();
    let needsRebind = [this.header, this.main, this.layers].some((root) => root && !root.isConnected);
    const missingHeader = this.options.navigation && !this.header;
    const missingMain = (this.options.tweets || this.options.layout) && !this.main;
    const missingLayers = (this.options.navigation || this.options.tweets) && !this.layers;
    const missingSelectors = [
      missingHeader ? X_SELECTORS.bannerHeader : "",
      missingMain ? X_SELECTORS.mainRoot : "",
      missingLayers ? X_SELECTORS.layersRoot : "",
    ].filter(Boolean).join(",");
    const layoutSelector = [X_SELECTORS.primaryColumn, X_SELECTORS.sidebarColumn,
      X_SELECTORS.complementaryAside, X_SELECTORS.homeComposerEditor, X_SELECTORS.inlinePostButton].join(", ");
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (target?.closest(".yosoix-action-slot")) continue;
      const inMain = Boolean(this.main?.contains(record.target));
      const inLayers = Boolean(this.layers?.contains(record.target));
      const inTweetScope = inMain || inLayers;
      if (record.type === "attributes" && target) {
        if (missingSelectors && target.matches(missingSelectors)) needsRebind = true;
        if (this.options.layout && inMain &&
          (target.matches(`${X_SELECTORS.homeComposerEditor}, ${X_SELECTORS.inlinePostButton}`) ||
            target.closest("[data-yosoix-home-composer]"))) this.pendingLayout = true;
      }
      // 起動途中に投稿欄の祖先へタイムラインが追加された場合も、非表示範囲を絞り直す。
      if (this.options.layout && inMain && target?.closest("[data-yosoix-home-composer]")) {
        this.pendingLayout = true;
      }
      if (this.options.navigation && (this.header?.contains(record.target) ||
        (inLayers && target?.closest(X_SELECTORS.dropdownMenu)))) {
        this.pendingNav = true;
      }
      for (const node of record.removedNodes) {
        if (this.options.tweets && (inTweetScope || needsRebind)) this.collectArticles(node, removed);
        if (this.options.layout && inMain && node instanceof Element &&
          (node.matches(layoutSelector) || node.querySelector(layoutSelector))) this.pendingLayout = true;
      }
      for (const node of record.addedNodes) {
        if (!(node instanceof Element) || node.classList.contains("yosoix-action-slot")) continue;
        if (!needsRebind && missingSelectors) {
          needsRebind = node.matches(missingSelectors) || Boolean(node.querySelector(missingSelectors));
        }
        if (this.options.navigation && inLayers &&
          (node.matches(X_SELECTORS.dropdownMenu) || node.querySelector(X_SELECTORS.dropdownMenu))) this.pendingNav = true;
        if (this.options.tweets && inTweetScope) {
          const article = node.closest<HTMLElement>(X_SELECTORS.tweetArticle);
          if (article) this.pendingArticles.add(article);
          else this.collectArticles(node, this.pendingArticles);
        }
        if (this.options.layout && inMain && (node.matches(layoutSelector) || node.querySelector(layoutSelector))) {
          this.pendingLayout = true;
        }
      }
    }
    for (const article of removed) {
      if (article.isConnected) removed.delete(article);
      else this.pendingArticles.delete(article);
    }
    if (removed.size) this.callbacks.onTweetArticlesRemoved?.(removed);
    if (needsRebind) this.bindTargets();
    this.schedule();
  }

  private schedule(): void {
    if (!this.observer || this.rafId !== null ||
      (!this.pendingNav && !this.pendingLayout && !this.pendingArticles.size)) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      if (this.pendingNav) {
        this.pendingNav = false;
        this.callbacks.onNavigationMutated();
      }
      if (this.pendingLayout) {
        this.pendingLayout = false;
        this.callbacks.onLayoutMutated();
      }
      const batch = new Set<HTMLElement>();
      for (const article of this.pendingArticles) {
        this.pendingArticles.delete(article);
        if (article.isConnected) batch.add(article);
        if (batch.size >= 25) break;
      }
      if (batch.size) this.callbacks.onTweetArticlesAdded(batch);
      this.schedule();
    });
  }
}
