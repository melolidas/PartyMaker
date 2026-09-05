/** Offsets are distance from the newest end of an inverted FlatList.
 * Older pages append at the far end, so they never change the reading offset.
 * When newer rows are prepended while reading history, compensate their measured
 * height instead of forcing the reader to the newest end. No timer per message.
 */
export class LiveChatScroll {
  private head: string | undefined;
  private count = 0;
  private sends = 0;
  private height = 0;
  private offset = 0;
  private following = true;
  private reveal = false;
  private anchor: { height: number; offset: number } | null = null;

  update(ids: readonly string[], confirmedSends: number): void {
    const firstLoad = this.count === 0 && ids.length > 0;
    const sent = confirmedSends !== this.sends;
    if (firstLoad || sent) { this.reveal = true; this.following = true; this.anchor = null; }
    else if (ids[0] !== this.head && ids.length > 0) {
      this.anchor = this.following ? null : { height: this.height, offset: this.offset };
    } else if (ids.length !== this.count) this.anchor = null; // older-page append
    this.head = ids[0]; this.count = ids.length; this.sends = confirmedSends;
  }
  onScroll(offset: number): void {
    this.offset = Math.max(0, offset);
    if (!this.reveal && !this.anchor) this.following = this.offset < 80;
  }
  onDrag = (): void => { this.reveal = false; this.anchor = null; };
  onSize(height: number): number | null {
    this.height = height;
    if (this.reveal || this.following) { this.reveal = false; this.offset = 0; return 0; }
    if (this.anchor) { this.offset = Math.max(0, this.anchor.offset + height - this.anchor.height); return this.offset; }
    return null;
  }
  onViewport(): number | null { return this.reveal || this.following ? 0 : null; }
}
