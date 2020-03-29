import { observable, action, autorun, computed } from 'mobx';
import { ipcRenderer } from 'electron';

import { UnzippedFile } from '../unzip';
import { LevelFilter, LogEntry, MergedLogFile, ProcessedLogFile, DateRange, Suggestions, Tool, Bookmark, MergedLogFiles } from '../interfaces';
import { getItemsInSuggestionFolders } from '../suggestions';
import { testDateTimeFormat } from '../../utils/test-date-time';
import { SORT_DIRECTION } from '../components/log-table-constants';
import { changeIcon, ICON_NAMES, getIconPath } from '../../utils/app-icon';
import { setSetting } from '../settings';
import { isProcessedLogFile, isMergedLogFile, isUnzippedFile, isTool } from '../../utils/is-logfile';
import { capitalize } from 'lodash';

const debug = require('debug')('sleuth:state');
export const defaults = {
  dateTimeFormat: 'HH:mm:ss (dd/MM)',
  defaultEditor: 'code --goto {filepath}:{line}',
  font: process.platform === 'darwin' ? 'San Francisco' : 'Segoe UI',
  isDarkMode: true,
  isOpenMostRecent: false,
};

export class SleuthState {
  // ** Cooper log line logging **
  @observable public slackUserId?: string;
  @observable public isCooperSignedIn = false;

  // ** Log file selection **
  // The selected log entry (single log message plus meta data)
  @observable public selectedEntry?: LogEntry;
  // Path to the source directory (zip file, folder path, etc)
  @observable public source?: string;
  // A reference to the selected log file
  @observable.ref public selectedLogFile?: ProcessedLogFile | MergedLogFile | UnzippedFile | Tool;

  //** Cachetool **
  // When looking at the cache using cachetool, we'll keep the selected
  // cache key in this property
  @observable public selectedCacheKey?: string;
  @observable public cachePath?: string;
  @observable public cacheKeys: Array<string> = [];
  @observable public isLoadingCacheKeys?: boolean;

  // ** Search and Filter **
  @observable public levelFilter: LevelFilter = {
    debug: false,
    error: false,
    info: false,
    warn: false
  };
  @observable public searchIndex: number = 0;
  @observable public search: string = '';
  @observable public showOnlySearchResults: boolean = false;

  // ** Various "what are we showing" properties **
  @observable public suggestions: Suggestions = [];
  @observable public webAppLogsWarningDismissed: boolean = false;
  @observable public opened: number = 0;
  @observable public dateRange: DateRange = { from: undefined, to: undefined };
  @observable public isDetailsVisible: boolean = false;
  @observable public isSidebarOpen: boolean = true;
  @observable public isSpotlightOpen: boolean = false;
  @observable public bookmarks: Array<Bookmark> = [];
  @observable public selectedIndex: number | undefined;

  // ** Settings **
  @observable public isDarkMode: boolean = !!this.retrieve('isDarkMode', true);
  @observable public isOpenMostRecent: boolean = !!this.retrieve<boolean>('isOpenMostRecent', true);
  @observable public dateTimeFormat: string
    = testDateTimeFormat(this.retrieve<string>('dateTimeFormat_v3', false)!, defaults.dateTimeFormat);
  @observable public font: string = this.retrieve<string>('font', false)!;
  @observable public defaultEditor: string = this.retrieve<string>('defaultEditor', false)!;
  @observable public defaultSort: SORT_DIRECTION = this.retrieve('defaultSort', false) as SORT_DIRECTION || SORT_DIRECTION.DESC;
  @observable public isMarkIcon: boolean = !!this.retrieve('isMarkIcon', true);

  // ** Giant non-observable arrays **
  public mergedLogFiles?: MergedLogFiles;

  // ** Internal settings **
  private didOpenMostRecent = false;

  constructor(
    public readonly openFile: (file: string) => void,
    public readonly resetApp: () => void
  ) {
    this.getSuggestions();

    // Setup autoruns
    autorun(() => this.save('dateTimeFormat_v3', this.dateTimeFormat));
    autorun(() => this.save('font', this.font));
    autorun(() => this.save('isOpenMostRecent', this.isOpenMostRecent));
    autorun(() => this.save('defaultEditor', this.defaultEditor));
    autorun(() => this.save('defaultSort', this.defaultSort));
    autorun(() => {
      this.save('isDarkMode', this.isDarkMode);

      if (this.isDarkMode) {
        document.body.classList.add('bp3-dark');
      } else {
        document.body.classList.remove('bp3-dark');
      }
    });
    autorun(() => {
      if (this.isSidebarOpen) {
        document.body.classList.add('SidebarOpen');
      } else {
        document.body.classList.remove('SidebarOpen');
      }
    });
    autorun(() => {
      this.save('isMarkIcon', this.isMarkIcon);
      changeIcon(this.isMarkIcon ? ICON_NAMES.mark : ICON_NAMES.default);
    });
    autorun(async () => {
      if (process.platform !== 'darwin') return;

      this.isLoadingCacheKeys = true;

      if (!this.cachePath) return [];

      const { listKeys } = await import('cachetool');
      const keys = await listKeys({ cachePath: this.cachePath });

      // Last entry is sometimes empty
      if (keys.length > 0 && !keys[keys.length - 1]) {
        keys.splice(keys.length - 1, 1);
      }

      this.cacheKeys = keys;
      this.isLoadingCacheKeys = false;
    });

    this.reset = this.reset.bind(this);
    this.toggleDarkMode = this.toggleDarkMode.bind(this);
    this.toggleSidebar = this.toggleSidebar.bind(this);
    this.toggleSpotlight = this.toggleSpotlight.bind(this);
    this.selectLogFile = this.selectLogFile.bind(this);
    this.setMergedFile = this.setMergedFile.bind(this);

    ipcRenderer.on('spotlight', this.toggleSpotlight);
  }

  @action
  public setSource(source: string) {
    this.source = source;
  }

  @action
  public toggleDarkMode() {
    this.isDarkMode = !this.isDarkMode;
  }

  @action
  public toggleSidebar() {
    this.isSidebarOpen = !this.isSidebarOpen;
  }

  @action
  public toggleSpotlight() {
    this.isSpotlightOpen = !this.isSpotlightOpen;
  }

  @action
  public async getSuggestions() {
    this.suggestions = await getItemsInSuggestionFolders();

    // This is a side effect. There's probably a better
    // place for it, since we only want to run it once,
    // but here we are.
    this.openMostRecentSuggestionMaybe();
  }

  @action
  public openMostRecentSuggestionMaybe() {
    if (!this.isOpenMostRecent || this.didOpenMostRecent) return;
    if (this.suggestions.length === 0) return;

    let mostRecentStats = this.suggestions[0];

    for (const stats of this.suggestions) {
      if (stats.mtimeMs > mostRecentStats.mtimeMs) {
        mostRecentStats = stats;
      }
    }

    this.didOpenMostRecent = true;
    this.openFile(mostRecentStats.filePath);
  }

  @action
  public reset(goBackToHome: boolean = false) {
    this.selectedEntry = undefined;
    this.selectedLogFile = undefined;
    this.levelFilter.debug = false;
    this.levelFilter.error = false;
    this.levelFilter.info = false;
    this.levelFilter.warn = false;
    this.searchIndex = 0;
    this.showOnlySearchResults = false;
    this.isSpotlightOpen = false;
    this.isDetailsVisible = false;
    this.dateRange = { from: undefined, to: undefined };
    this.cacheKeys = [];
    this.cachePath = undefined;
    this.selectedCacheKey = undefined;
    this.isLoadingCacheKeys = false;

    if (goBackToHome) {
      this.resetApp();
    }
  }

  /**
   * Select a log file. This is a more complex operation than one might think -
   * mostly because we might need to create a merged file on-the-fly.
   *
   * @param {ProcessedLogFile} logFile
   * @param {string} [logType]
   */
  @action
  public selectLogFile(logFile: ProcessedLogFile | UnzippedFile | null, logType?: string): void {
    this.selectedEntry = undefined;

    if (!logFile && logType) {
      debug(`Selecting log type ${logType}`);

      // If our "logtype" is actually a tool (like Cache), we'll set it
      if (logType in Tool) {
        this.selectedLogFile = logType as Tool;
      } else if (this.mergedLogFiles && this.mergedLogFiles[logType]) {
        this.selectedLogFile = this.mergedLogFiles[logType];
      }
    } else if (logFile) {
      const name = isProcessedLogFile(logFile) ? logFile.logType : logFile.fileName;
      debug(`Selecting log file ${name}`);

      this.selectedLogFile = logFile;
    }
  }

  /**
   * Update this component's status with a merged logfile
   *
   * @param {MergedLogFile} mergedFile
   */
  public setMergedFile(mergedFile: MergedLogFile) {
    const newMergedLogFiles = { ...this.mergedLogFiles as MergedLogFiles };

    debug(`Merged log file for ${mergedFile.logType} now created!`);
    newMergedLogFiles[mergedFile.logType] = mergedFile;
    this.mergedLogFiles = newMergedLogFiles;
  }

  /**
   * Return the default icon path
   *
   * @returns {string}
   */
  public getIconPath(): string {
    if (this.isMarkIcon) {
      return getIconPath(ICON_NAMES.mark);
    } else {
      return getIconPath(ICON_NAMES.default);
    }
  }

  /**
   * Return the file name of the currently selected file.
   *
   * @returns {string}
   */
  @computed
  public get selectedFileName(): string {
    if (isProcessedLogFile(this.selectedLogFile)) {
      return this.selectedLogFile.logFile.fileName;
    } else if (isMergedLogFile(this.selectedLogFile)) {
      return this.selectedLogFile.logType;
    } else if (isUnzippedFile(this.selectedLogFile)) {
      return this.selectedLogFile.fileName;
    } else if (isTool(this.selectedLogFile)) {
      return capitalize(this.selectedLogFile);
    } else {
      return '';
    }
  }

  /**
   * Save a key/value to localStorage.
   *
   * @param {string} key
   * @param {(string | number | object)} [value]
   */
  private save(key: string, value?: string | number | object | null | boolean) {
    if (value) {
      const _value = typeof value === 'object'
        ? JSON.stringify(value)
        : value.toString();

      localStorage.setItem(key, _value);
    } else {
      localStorage.removeItem(key);
    }

    setSetting(key, value);
  }

  /**
   * Fetch data from localStorage.
   *
   * @template T
   * @param {string} key
   * @param {boolean} parse
   * @returns {(T | string | null)}
   */
  private retrieve<T>(
    key: string, parse: boolean
  ): T | string | null {
    const value = localStorage.getItem(key);

    if (parse) {
      return JSON.parse(value || 'null') as T;
    }

    if (value === null && defaults[key]) {
      return defaults[key];
    }

    return value;
  }
}
