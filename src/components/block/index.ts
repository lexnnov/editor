import {
  BlockAPI as BlockAPIInterface,
  BlockTool as IBlockTool,
  BlockToolData,
  BlockTune as IBlockTune,
  SanitizerConfig,
  ToolConfig
} from '../../../types';

import {SavedData} from '../../../types/data-formats';
import $ from '../dom';
import * as _ from '../utils';
import ApiModules from '../modules/api';
import BlockAPI from './api';
import SelectionUtils from '../selection';
import BlockTool from '../tools/block';

import BlockTune from '../tools/tune';
import {BlockTuneData} from '../../../types/block-tunes/block-tune-data';
import ToolsCollection from '../tools/collection';
import EventsDispatcher from '../utils/events';
import I18n from '../i18n';
import {I18nInternalNS} from '../i18n/namespace-internal';

/**
 * Interface describes Block class constructor argument
 */
interface BlockConstructorOptions {

  /**
   * Block's id. Should be passed for existed block, and omitted for a new one.
   */
  id?: string;

  /**
   * Initial Block data
   */
  data: BlockToolData;

  /**
   * Tool object
   */
  tool: BlockTool;

  /**
   * Editor's API methods
   */
  api: ApiModules;

  /**
   * This flag indicates that the Block should be constructed in the read-only mode.
   */
  readOnly: boolean;
  canBeRemoved: boolean;
  canBeEdited: boolean;

  /**
   * Tunes data for current Block
   */
  tunesData: { [name: string]: BlockTuneData };
}

/**
 * @class Block
 * @classdesc This class describes editor`s block, including block`s HTMLElement, data and tool
 *
 * @property {BlockTool} tool — current block tool (Paragraph, for example)
 * @property {object} CSS — block`s css classes
 *
 */

/**
 * Available Block Tool API methods
 */
export enum BlockToolAPI {


  /**
   * @todo remove method in 3.0.0
   * @deprecated — use 'rendered' hook instead
   */
  APPEND_CALLBACK = 'appendCallback',
  RENDERED = 'rendered',
  MOVED = 'moved',
  UPDATED = 'updated',
  REMOVED = 'removed',
  ON_PASTE = 'onPaste',
}

/**
 * Names of events supported by Block class
 */
type BlockEvents = 'didMutated';

/**
 * @classdesc Abstract Block class that contains Block information, Tool name and Tool class instance
 *
 * @property {BlockTool} tool - Tool instance
 * @property {HTMLElement} holder - Div element that wraps block content with Tool's content. Has `ce-block` CSS class
 * @property {HTMLElement} pluginsContent - HTML content that returns by Tool's render function
 */
export default class Block extends EventsDispatcher<BlockEvents> {
  /**
   * CSS classes for the Block
   *
   * @returns {{wrapper: string, content: string}}
   */
  public nodes = {
    toolbox: null,
    buttons: [],
  }

  private displayedToolsCount = 0;
  public static get CSS(): { [name: string]: string } {
    return {
      toolbox: 'ce-toolbox-add1',
      toolboxOpened: 'ce-toolbox-add1--opened',

      toolboxButton: 'ce-toolbox-add1__button',
      toolboxSpan: 'ce-toolbox-add1__span',
      wrapper: 'ce-block',
      wrapperStretched: 'ce-block--stretched',
      content: 'ce-block__content',
      add: 'ce-block__add',
      dnd: 'ce-block__content--dnd',
      remove: 'ce-block__content--remove',
      settings: 'ce-block__content--settings',
      focused: 'ce-block--focused',
      selected: 'ce-block--selected',
      dropTarget: 'ce-block--drop-target',
    };
  }

  /**
   * Block unique identifier
   */
  public id: string;

  /**
   * Block Tool`s name
   */
  public readonly name: string;

  /**
   * Instance of the Tool Block represents
   */
  public readonly tool: BlockTool;

  /**
   * User Tool configuration
   */
  public readonly settings: ToolConfig;

  /**
   * Wrapper for Block`s content
   */
  public readonly holder: HTMLDivElement;

  public canBeRemoved: boolean;
  public canBeEdited: boolean;
  public opened = false;
  /**
   * Tunes used by Tool
   */
  public readonly tunes: ToolsCollection<BlockTune>;

  /**
   * Tool's user configuration
   */
  public readonly config: ToolConfig;

  /**
   * Cached inputs
   *
   * @type {HTMLElement[]}
   */
  private cachedInputs: HTMLElement[] = [];

  /**
   * Tool class instance
   */
  private readonly toolInstance: IBlockTool;

  /**
   * User provided Block Tunes instances
   */
  private readonly tunesInstances: Map<string, IBlockTune> = new Map();

  /**
   * Editor provided Block Tunes instances
   */
  private readonly defaultTunesInstances: Map<string, IBlockTune> = new Map();

  /**
   * If there is saved data for Tune which is not available at the moment,
   * we will store it here and provide back on save so data is not lost
   */
  private unavailableTunesData: { [name: string]: BlockTuneData } = {};

  /**
   * Editor`s API module
   */
  private readonly api: ApiModules;

  /**
   * Focused input index
   *
   * @type {number}
   */
  private inputIndex = 0;

  /**
   * Mutation observer to handle DOM mutations
   *
   * @type {MutationObserver}
   */
  private mutationObserver: MutationObserver;

  /**
   * Debounce Timer
   *
   * @type {number}
   */
  private readonly modificationDebounceTimer = 450;

  /**
   * Is fired when DOM mutation has been happened
   */
  private didMutated = _.debounce((mutations: MutationRecord[]): void => {
    const shouldFireUpdate = !mutations.some(({addedNodes = [], removedNodes}) => {
      return [...Array.from(addedNodes), ...Array.from(removedNodes)]
        .some(node => $.isElement(node) && (node as HTMLElement).dataset.mutationFree === 'true');
    });

    /**
     * In case some mutation free elements are added or removed, do not trigger didMutated event
     */
    if (!shouldFireUpdate) {
      return;
    }

    /**
     * Drop cache
     */
    this.cachedInputs = [];

    /**
     * Update current input
     */
    this.updateCurrentInput();

    this.call(BlockToolAPI.UPDATED);

    this.emit('didMutated', this);
  }, this.modificationDebounceTimer);

  /**
   * Current block API interface
   */
  private readonly blockAPI: BlockAPIInterface;

  /**
   * @param {object} options - block constructor options
   * @param {string} [options.id] - block's id. Will be generated if omitted.
   * @param {BlockToolData} options.data - Tool's initial data
   * @param {BlockToolConstructable} options.tool — block's tool
   * @param options.api - Editor API module for pass it to the Block Tunes
   * @param {boolean} options.readOnly - Read-Only flag
   */
  constructor({
                id = _.generateBlockId(),
                data,
                tool,
                api,
                readOnly,
                tunesData,
                canBeRemoved,
                canBeEdited
              }: BlockConstructorOptions) {
    super();

    this.name = tool.name;
    this.id = id;
    this.settings = tool.settings;
    this.config = tool.settings.config || {};
    this.api = api;
    this.canBeRemoved = canBeRemoved;
    this.canBeEdited = canBeEdited;
    this.blockAPI = new BlockAPI(this);

    this.mutationObserver = new MutationObserver(this.didMutated);

    this.tool = tool;
    this.toolInstance = tool.create(data, this.blockAPI, readOnly);

    /**
     * @type {BlockTune[]}
     */
    this.tunes = tool.tunes;

    this.composeTunes(tunesData);

    this.holder = this.compose();
  }

  /**
   * Find and return all editable elements (contenteditables and native inputs) in the Tool HTML
   *
   * @returns {HTMLElement[]}
   */
  public get inputs(): HTMLElement[] {
    /**
     * Return from cache if existed
     */
    if (this.cachedInputs.length !== 0) {
      return this.cachedInputs;
    }

    const inputs = $.findAllInputs(this.holder);

    /**
     * If inputs amount was changed we need to check if input index is bigger then inputs array length
     */
    if (this.inputIndex > inputs.length - 1) {
      this.inputIndex = inputs.length - 1;
    }

    /**
     * Cache inputs
     */
    this.cachedInputs = inputs;

    return inputs;
  }

  /**
   * Return current Tool`s input
   *
   * @returns {HTMLElement}
   */
  public get currentInput(): HTMLElement | Node {
    return this.inputs[this.inputIndex];
  }

  /**
   * Set input index to the passed element
   *
   * @param {HTMLElement | Node} element - HTML Element to set as current input
   */
  public set currentInput(element: HTMLElement | Node) {
    const index = this.inputs.findIndex((input) => input === element || input.contains(element));

    if (index !== -1) {
      this.inputIndex = index;
    }
  }

  /**
   * Return first Tool`s input
   *
   * @returns {HTMLElement}
   */
  public get firstInput(): HTMLElement {
    return this.inputs[0];
  }

  /**
   * Return first Tool`s input
   *
   * @returns {HTMLElement}
   */
  public get lastInput(): HTMLElement {
    const inputs = this.inputs;

    return inputs[inputs.length - 1];
  }

  /**
   * Return next Tool`s input or undefined if it doesn't exist
   *
   * @returns {HTMLElement}
   */
  public get nextInput(): HTMLElement {
    return this.inputs[this.inputIndex + 1];
  }

  /**
   * Return previous Tool`s input or undefined if it doesn't exist
   *
   * @returns {HTMLElement}
   */
  public get previousInput(): HTMLElement {
    return this.inputs[this.inputIndex - 1];
  }

  /**
   * Get Block's JSON data
   *
   * @returns {object}
   */
  public get data(): Promise<BlockToolData> {
    return this.save().then((savedObject) => {
      if (savedObject && !_.isEmpty(savedObject.data)) {
        return savedObject.data;
      } else {
        return {};
      }
    });
  }

  /**
   * Returns tool's sanitizer config
   *
   * @returns {object}
   */
  public get sanitize(): SanitizerConfig {
    return this.tool.sanitizeConfig;
  }

  /**
   * is block mergeable
   * We plugin have merge function then we call it mergable
   *
   * @returns {boolean}
   */
  public get mergeable(): boolean {
    return _.isFunction(this.toolInstance.merge);
  }

  /**
   * Check block for emptiness
   *
   * @returns {boolean}
   */
  public get isEmpty(): boolean {
    const emptyText = $.isEmpty(this.pluginsContent);
    const emptyMedia = !this.hasMedia;

    return emptyText && emptyMedia;
  }

  /**
   * Check if block has a media content such as images, iframes and other
   *
   * @returns {boolean}
   */
  public get hasMedia(): boolean {
    /**
     * This tags represents media-content
     *
     * @type {string[]}
     */
    const mediaTags = [
      'img',
      'iframe',
      'video',
      'audio',
      'source',
      'input',
      'textarea',
      'twitterwidget',
    ];

    return !!this.holder.querySelector(mediaTags.join(','));
  }

  /**
   * Set focused state
   *
   * @param {boolean} state - 'true' to select, 'false' to remove selection
   */
  public set focused(state: boolean) {
    this.holder.classList.toggle(Block.CSS.focused, state);
  }

  /**
   * Get Block's focused state
   */
  public get focused(): boolean {
    return this.holder.classList.contains(Block.CSS.focused);
  }

  /**
   * Set selected state
   * We don't need to mark Block as Selected when it is empty
   *
   * @param {boolean} state - 'true' to select, 'false' to remove selection
   */
  public set selected(state: boolean) {
    if (state) {
      this.holder.classList.add(Block.CSS.selected);

      SelectionUtils.addFakeCursor(this.holder);
    } else {
      this.holder.classList.remove(Block.CSS.selected);

      SelectionUtils.removeFakeCursor(this.holder);
    }
  }

  /**
   * Returns True if it is Selected
   *
   * @returns {boolean}
   */
  public get selected(): boolean {
    return this.holder.classList.contains(Block.CSS.selected);
  }

  /**
   * Set stretched state
   *
   * @param {boolean} state - 'true' to enable, 'false' to disable stretched statte
   */
  public set stretched(state: boolean) {
    this.holder.classList.toggle(Block.CSS.wrapperStretched, state);
  }

  /**
   * Return Block's stretched state
   *
   * @returns {boolean}
   */
  public get stretched(): boolean {
    return this.holder.classList.contains(Block.CSS.wrapperStretched);
  }

  /**
   * Toggle drop target state
   *
   * @param {boolean} state - 'true' if block is drop target, false otherwise
   */
  public set dropTarget(state) {
    this.holder.classList.toggle(Block.CSS.dropTarget, state);
  }

  /**
   * Returns Plugins content
   *
   * @returns {HTMLElement}
   */
  public get pluginsContent(): HTMLElement {
    const blockContentNodes = this.holder.querySelector(`.${Block.CSS.content}`);
    if (blockContentNodes && blockContentNodes.childNodes.length) {
      /**
       * Editors Block content can contain different Nodes from extensions
       * We use DOM isExtensionNode to ignore such Nodes and return first Block that does not match filtering list
       */
      for (let child = blockContentNodes.childNodes.length - 2; child >= 0; child--) {
        const contentNode = blockContentNodes.childNodes[child];

        if (!$.isExtensionNode(contentNode)) {
          return contentNode as HTMLElement;
        }
      }
    }

    return null;
  }

  /**
   * Calls Tool's method
   *
   * Method checks tool property {MethodName}. Fires method with passes params If it is instance of Function
   *
   * @param {string} methodName - method to call
   * @param {object} params - method argument
   */
  public call(methodName: string, params?: object): void {
    /**
     * call Tool's method with the instance context
     */
    if (_.isFunction(this.toolInstance[methodName])) {
      if (methodName === BlockToolAPI.APPEND_CALLBACK) {
        _.log(
          '`appendCallback` hook is deprecated and will be removed in the next major release. ' +
          'Use `rendered` hook instead',
          'warn'
        );
      }

      try {
        // eslint-disable-next-line no-useless-call
        this.toolInstance[methodName].call(this.toolInstance, params);
      } catch (e) {
        _.log(`Error during '${methodName}' call: ${e.message}`, 'error');
      }
    }
  }

  /**
   * Call plugins merge method
   *
   * @param {BlockToolData} data - data to merge
   */
  public async mergeWith(data: BlockToolData): Promise<void> {
    await this.toolInstance.merge(data);
  }

  /**
   * Extracts data from Block
   * Groups Tool's save processing time
   *
   * @returns {object}
   */
  public async save(): Promise<void | SavedData> {
    const extractedBlock = await this.toolInstance.save(this.pluginsContent as HTMLElement);
    const tunesData: { [name: string]: BlockTuneData } = this.unavailableTunesData;

    [
      ...this.tunesInstances.entries(),
      ...this.defaultTunesInstances.entries(),
    ]
      .forEach(([name, tune]) => {
        if (_.isFunction(tune.save)) {
          try {
            tunesData[name] = tune.save();
          } catch (e) {
            _.log(`Tune ${tune.constructor.name} save method throws an Error %o`, 'warn', e);
          }
        }
      });

    /**
     * Measuring execution time
     */
    const measuringStart = window.performance.now();
    let measuringEnd;

    return Promise.resolve(extractedBlock)
      .then((finishedExtraction) => {
        /** measure promise execution */
        measuringEnd = window.performance.now();

        return {
          id: this.id,
          tool: this.name,
          data: finishedExtraction,
          tunes: tunesData,
          time: measuringEnd - measuringStart,
        };
      })
      .catch((error) => {
        _.log(`Saving proccess for ${this.name} tool failed due to the ${error}`, 'log', 'red');
      });
  }

  /**
   * Uses Tool's validation method to check the correctness of output data
   * Tool's validation method is optional
   *
   * @description Method returns true|false whether data passed the validation or not
   *
   * @param {BlockToolData} data - data to validate
   * @returns {Promise<boolean>} valid
   */
  public async validate(data: BlockToolData): Promise<boolean> {
    let isValid = true;

    if (this.toolInstance.validate instanceof Function) {
      isValid = await this.toolInstance.validate(data);
    }

    return isValid;
  }

  /**
   * Enumerates initialized tunes and returns fragment that can be appended to the toolbars area
   *
   * @returns {DocumentFragment[]}
   */
  public renderTunes(): [DocumentFragment, DocumentFragment] {
    const tunesElement = document.createDocumentFragment();
    const defaultTunesElement = document.createDocumentFragment();

    this.tunesInstances.forEach((tune) => {
      $.append(tunesElement, tune.render());
    });
    this.defaultTunesInstances.forEach((tune) => {
      $.append(defaultTunesElement, tune.render());
    });

    return [tunesElement, defaultTunesElement];
  }

  /**
   * Update current input index with selection anchor node
   */
  public updateCurrentInput(): void {
    /**
     * If activeElement is native input, anchorNode points to its parent.
     * So if it is native input use it instead of anchorNode
     *
     * If anchorNode is undefined, also use activeElement
     */
    this.currentInput = $.isNativeInput(document.activeElement) || !SelectionUtils.anchorNode
      ? document.activeElement
      : SelectionUtils.anchorNode;
  }

  /**
   * Is fired when Block will be selected as current
   */
  public willSelect(): void {
    /**
     * Observe DOM mutations to update Block inputs
     */
    this.mutationObserver.observe(
      this.holder.firstElementChild,
      {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
      }
    );

    /**
     * Mutation observer doesn't track changes in "<input>" and "<textarea>"
     * so we need to track focus events to update current input and clear cache.
     */
    this.addInputEvents();
  }

  /**
   * Is fired when Block will be unselected
   */
  public willUnselect(): void {
    this.mutationObserver.disconnect();
    this.removeInputEvents();
  }

  /**
   * Call Tool instance destroy method
   */
  public destroy(): void {
    super.destroy();

    if (_.isFunction(this.toolInstance.destroy)) {
      this.toolInstance.destroy();
    }
  }

  /**
   * Call Tool instance renderSettings method
   */
  public renderSettings(): HTMLElement | undefined {
    if (_.isFunction(this.toolInstance.renderSettings)) {
      return this.toolInstance.renderSettings();
    }
  }

  /**
   * Make default Block wrappers and put Tool`s content there
   *
   * @returns {HTMLDivElement}
   */
  public toggle(): void {
    if (!this.opened) {
      this.open();
    } else {
      this.close();
    }
  }

  public open(): void {

    this.nodes.toolbox.style.removeProperty('transform');
    this.nodes.toolbox.style.removeProperty('max-height');
    this.api.Editor.UI.nodes.wrapper.classList.add(Block.CSS.openedToolbarHolderModifier);
    this.nodes.toolbox.classList.add(Block.CSS.toolboxOpened);
    this.opened = true;
    // this.flipper.activate();


    if (this.nodes.toolbox.getBoundingClientRect().top + this.nodes.toolbox.offsetHeight > window.innerHeight &&
      this.nodes.toolbox.offsetHeight + 55 <= this.nodes.toolbox.getBoundingClientRect().top) {
      this.nodes.toolbox.style.transform = `translate3D(0, ${-this.nodes.toolbox.offsetHeight - 55}px, 0)`;
    } else if ((this.nodes.toolbox.getBoundingClientRect().top + this.nodes.toolbox.offsetHeight > window.innerHeight &&
      this.nodes.toolbox.offsetHeight + 55 > this.nodes.toolbox.getBoundingClientRect().top)) {
      this.nodes.toolbox.style.maxHeight = '200px'

      if (this.nodes.toolbox.getBoundingClientRect().top + this.nodes.toolbox.offsetHeight > window.innerHeight &&
        this.nodes.toolbox.offsetHeight + 55 <= this.nodes.toolbox.getBoundingClientRect().top) {
        this.nodes.toolbox.style.transform = `translate3D(0, ${-this.nodes.toolbox.offsetHeight - 55}px, 0)`;
      }
    }
  }

  /**
   * Close Toolbox
   */
  public close(): void {
    this.nodes.toolbox.classList.remove(Block.CSS.toolboxOpened);
    this.api.Editor.UI.nodes.wrapper.classList.remove(Block.CSS.openedToolbarHolderModifier);

    this.opened = false;
    // this.flipper.deactivate();
  }


  private compose(): HTMLDivElement {
    const wrapper = $.make('div', Block.CSS.wrapper) as HTMLDivElement,
      contentNode = $.make('div', Block.CSS.content),
      add = $.make('div', Block.CSS.add),
      pluginsContent = this.toolInstance.render();

    const dnd = $.make('div', Block.CSS.dnd)
    const settings = $.make('div', Block.CSS.settings)
    const svgDrag = $.svg('drag', 13, 13)
    const svgAdd = $.svg('intermediate_plus', 13, 13)
    const svgSettings = $.svg('settings', 13, 13)

    dnd.appendChild(svgDrag)
    add.appendChild(svgAdd)
    settings.appendChild(svgSettings)
    dnd.setAttribute('draggable', 'true')

    this.nodes.toolbox = $.make('div', Block.CSS.toolbox);

    add.appendChild(this.nodes.toolbox)
    this.addTools()

    contentNode.appendChild(dnd);

    contentNode.appendChild(pluginsContent);
    svgAdd.addEventListener('click', ()=> {
      this.toggle()
    })

    contentNode.appendChild(settings);

    settings.addEventListener('click', (event)=> {
      if(this.api.Editor.BlockSettings.opened) {
        this.api.Editor.BlockSettings.close();
      } else {
        this.api.Editor.BlockSettings.open();
      }
    })

    /**
     * Block Tunes might wrap Block's content node to provide any UI changes
     *
     * <tune2wrapper>
     *   <tune1wrapper>
     *     <blockContent />
     *   </tune1wrapper>
     * </tune2wrapper>
     */
    let wrappedContentNode: HTMLElement = contentNode;


    [...this.tunesInstances.values(), ...this.defaultTunesInstances.values()]
      .forEach((tune) => {
        if (_.isFunction(tune.wrap)) {
          try {
            wrappedContentNode = tune.wrap(wrappedContentNode);
          } catch (e) {
            _.log(`Tune ${tune.constructor.name} wrap method throws an Error %o`, 'warn', e);
          }
        }
      });

    wrapper.appendChild(wrappedContentNode);
    wrapper.appendChild(add);

    return wrapper;
  }

  private addTools(): void {
    const tools = this.api.Editor.Tools.blockTools;

    Array
      .from(tools.values())
      .forEach((tool) => this.addTool(tool));
  }

  /**
   * Append Tool to the Toolbox
   *
   * @param {BlockToolConstructable} tool - BlockTool object
   */
  private addTool(tool: BlockTool): void {
    const toolToolboxSettings = tool.toolbox;

    /**
     * Skip tools that don't pass 'toolbox' property
     */
    if (!toolToolboxSettings) {
      return;
    }

    if (toolToolboxSettings && !toolToolboxSettings.icon) {
      _.log('Toolbar icon is missed. Tool %o skipped', 'warn', tool.name);

      return;
    }

    /**
     * @todo Add checkup for the render method
     */
      // if (typeof tool.render !== 'function') {
      //   _.log('render method missed. Tool %o skipped', 'warn', tool);
      //   return;
      // }

    const button = $.make('li', [Block.CSS.toolboxButton]);
    const span = $.make('span', [Block.CSS.toolboxSpan]);

    button.dataset.tool = tool.name;
    button.innerHTML = toolToolboxSettings.icon;
    span.innerHTML = I18n.t(I18nInternalNS.toolNames, toolToolboxSettings.title || tool.name);

    button.appendChild(span)

    $.append(this.nodes.toolbox, button);

    this.nodes.toolbox.appendChild(button);
    // this.nodes.toolbox.appendChild(span);
    this.nodes.buttons.push(button);

    /**
     * Add click listener
     */
    this.api.listeners.on(button, 'click', (event: KeyboardEvent | MouseEvent) => {
      this.toolButtonActivate(event, tool.name);
    });

    /**
     * Add listeners to show/hide toolbox tooltip
     */
      // const tooltipContent = this.drawTooltip(tool);

      // this.tooltip.onHover(button, tooltipContent, {
      //   placement: 'bottom',
      //   hidingDelay: 200,
      // });

    const shortcut = tool.shortcut;

    if (shortcut) {
      // this.enableShortcut(tool.name, shortcut);
    }

    /** Increment Tools count */
    this.displayedToolsCount++;
  }

  public toolButtonActivate(event: MouseEvent | KeyboardEvent, toolName: string): void {
    this.insertNewBlock(toolName);
  }

  private insertNewBlock(toolName: string): void {
    const { BlockManager, Caret } = this.api.Editor;
    const { currentBlock } = BlockManager;

    const newBlock = BlockManager.insert({
      tool: toolName,
      replace: currentBlock.isEmpty,
    });

    /**
     * Apply callback before inserting html
     */
    newBlock.call(BlockToolAPI.APPEND_CALLBACK);

    this.api.Editor.Caret.setToBlock(newBlock);

    /** If new block doesn't contain inpus, insert new paragraph above */
    if (newBlock.inputs.length === 0) {
      if (newBlock === BlockManager.lastBlock) {
        BlockManager.insertAtEnd();
        Caret.setToBlock(BlockManager.lastBlock);
      } else {
        Caret.setToBlock(BlockManager.nextBlock);
      }
    }

    /**
     * close toolbar when node is changed
     */

    this.close();
  }

  /**
   * Instantiate Block Tunes
   *
   * @param tunesData - current Block tunes data
   * @private
   */
  private composeTunes(tunesData: { [name: string]: BlockTuneData }): void {
    Array.from(this.tunes.values()).forEach((tune) => {
      const collection = tune.isInternal ? this.defaultTunesInstances : this.tunesInstances;

      collection.set(tune.name, tune.create(tunesData[tune.name], this.blockAPI));
    });

    /**
     * Check if there is some data for not available tunes
     */
    Object.entries(tunesData).forEach(([name, data]) => {
      if (!this.tunesInstances.has(name)) {
        this.unavailableTunesData[name] = data;
      }
    });
  }

  /**
   * Is fired when text input or contentEditable is focused
   */
  private handleFocus = (): void => {
    /**
     * Drop cache
     */
    this.cachedInputs = [];

    /**
     * Update current input
     */
    this.updateCurrentInput();
  }

  /**
   * Adds focus event listeners to all inputs and contentEditables
   */
  private addInputEvents(): void {
    this.inputs.forEach(input => {
      input.addEventListener('focus', this.handleFocus);

      /**
       * If input is native input add oninput listener to observe changes
       */
      if ($.isNativeInput(input)) {
        input.addEventListener('input', this.didMutated);
      }
    });
  }

  /**
   * removes focus event listeners from all inputs and contentEditables
   */
  private removeInputEvents(): void {
    this.inputs.forEach(input => {
      input.removeEventListener('focus', this.handleFocus);

      if ($.isNativeInput(input)) {
        input.removeEventListener('input', this.didMutated);
      }
    });
  }
}
