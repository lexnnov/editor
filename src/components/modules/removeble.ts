import Module from '../__module';
import { CriticalError } from '../errors/critical';

/**
 * @module ReadOnly
 *
 * Has one important method:
 *    - {Function} toggleReadonly - Set read-only mode or toggle current state
 *
 * @version 1.0.0
 *
 * @typedef {Removeble} Removeble
 * @property {boolean} removebleEnabled - read-only state
 */
export default class Removeble extends Module {
  /**
   * Array of tools name which don't support read-only mode
   */
  private toolsDontSupportReadOnly: string[] = [];

  /**
   * Value to track read-only state
   *
   * @type {boolean}
   */
  private removebleEnabled = false;

  /**
   * Returns state of read only mode
   */
  public get isEnabled(): boolean {
    return this.removebleEnabled;
  }

  /**
   * Set initial state
   */
  public async prepare(): Promise<void> {
    const { Tools } = this.Editor;
    const { blockTools } = Tools;
    const toolsDontSupportReadOnly: string[] = [];

    Array
      .from(blockTools.entries())
      .forEach(([name, tool]) => {
        if (!tool.isReadOnlySupported) {
          toolsDontSupportReadOnly.push(name);
        }
      });

    this.toolsDontSupportReadOnly = toolsDontSupportReadOnly;

    if (this.config.readOnly && toolsDontSupportReadOnly.length > 0) {
      this.throwCriticalError();
    }

    this.toggle(this.config.readOnly);
  }

  /**
   * Set read-only mode or toggle current state
   * Call all Modules `toggleReadOnly` method and re-render Editor
   *
   * @param {boolean} state - (optional) read-only state or toggle
   */
  public async toggle(state = !this.removebleEnabled): Promise<boolean> {
    if (state && this.toolsDontSupportReadOnly.length > 0) {
      this.throwCriticalError();
    }

    const oldState = this.removebleEnabled;

    this.removebleEnabled = state;

    for (const name in this.Editor) {
      /**
       * Verify module has method `toggleReadOnly` method
       */
      if (!this.Editor[name].toggleReadOnly) {
        continue;
      }

      /**
       * set or toggle read-only state
       */
      this.Editor[name].toggleReadOnly(state);
    }

    /**
     * If new state equals old one, do not re-render blocks
     */
    if (oldState === state) {
      return this.removebleEnabled;
    }

    /**
     * Save current Editor Blocks and render again
     */
    const savedBlocks = await this.Editor.Saver.save();

    await this.Editor.BlockManager.clear();
    await this.Editor.Renderer.render(savedBlocks.blocks);

    return this.removebleEnabled;
  }

  /**
   * Throws an error about tools which don't support read-only mode
   */
  private throwCriticalError(): never {
    throw new CriticalError(
      `To enable read-only mode all connected tools should support it. Tools ${this.toolsDontSupportReadOnly.join(', ')} don't support read-only mode.`
    );
  }
}
