import { vi } from "vitest";

export function mockFrames() {
  const frames = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  return {
    frames,
    flush() {
      const batch = [...frames.values()];
      frames.clear();
      for (const callback of batch) callback(performance.now());
    },
  };
}

export async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  document.dispatchEvent(new Event("visibilitychange"));
}

export function tweetMarkup(id = "123") {
  return `<article data-testid="tweet"><div data-testid="User-Name"><a href="/alice/status/${id}"><time>1h</time></a></div>
    <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/test.jpg"></div>
    <div role="group"><button data-testid="reply"></button></div></article>`;
}

export function composerMarkup() {
  return `<div id="composer"><div><a href="/alice" aria-label="プロフィール">Avatar</a><div>
    <div><div contenteditable="true" role="textbox" data-testid="tweetTextarea_0"></div></div>
    <div><button data-testid="tweetButtonInline">Post</button></div>
  </div></div></div>`;
}
