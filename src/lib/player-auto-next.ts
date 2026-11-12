interface AutoNextOptions {
  enabled: boolean;
  index: number;
  count: number;
  onEpisode: (index: number) => void;
}

/** Own the short gap after an episode ends so user navigation can cancel it. */
export class PlayerAutoNext {
  private timer: ReturnType<typeof setTimeout> | null = null;

  cancel() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  schedule({ enabled, index, count, onEpisode }: AutoNextOptions) {
    this.cancel();
    if (!enabled || index < 0 || index >= count - 1) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      onEpisode(index + 1);
    }, 800);
  }
}
