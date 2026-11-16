/** Keyboard input: held state + edge triggers. */
export class Input {
  constructor() {
    this.held = new Set();
    this.pressed = new Set(); // consumed each frame
    this.onKey = null; // raw hook for UI (Esc etc. handled by main)
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const c = e.code;
      if (
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab',
         'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight'].includes(c)
      ) e.preventDefault();
      this.held.add(c);
      this.pressed.add(c);
      if (this.onKey) this.onKey(e);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
  }
  down(...codes) { return codes.some((c) => this.held.has(c)); }
  hit(...codes) { return codes.some((c) => this.pressed.has(c)); }
  endFrame() { this.pressed.clear(); }
  /** Flight axes, -1..1 */
  axes() {
    let cyclic = 0, roll = 0, yaw = 0, coll = 0;
    if (this.down('KeyW', 'ArrowUp')) cyclic += 1;     // stick forward → nose down → speed
    if (this.down('KeyS', 'ArrowDown')) cyclic -= 1;
    if (this.down('KeyD', 'ArrowRight')) roll += 1;
    if (this.down('KeyA', 'ArrowLeft')) roll -= 1;
    if (this.down('KeyE')) yaw += 1;
    if (this.down('KeyQ')) yaw -= 1;
    if (this.down('ShiftLeft', 'ShiftRight')) coll += 1;
    if (this.down('KeyC')) coll -= 1; // C = collective down (Ctrl+W would close the tab!)
    return { cyclic, roll, yaw, coll };
  }
}