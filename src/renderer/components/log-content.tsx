import { isLogFile, isUnzippedFile, isTool } from '../../utils/is-logfile';
import { ProcessedLogFile, LogType } from '../../interfaces';
import { StateTable } from './state-table';
import { SleuthState } from '../state/sleuth';
import { LogTable } from './log-table';
import { observer } from 'mobx-react';
import React from 'react';

import { LogLineDetails } from './log-line-details/details';
import { Scrubber } from './scrubber';
import { getFontForCSS } from './preferences-font';
import { getTypeForFile } from '../processor';
import { NetLogView } from './net-log-view';
import { ToolView } from './tool-view';
import { LogTimeView } from './log-time-view';
import { DevtoolsView } from './devtools-view';

export interface LogContentProps {
  state: SleuthState;
}

export interface LogContentState {
  tableHeight: number;
}

@observer
export class LogContent extends React.Component<LogContentProps, Partial<LogContentState>> {
  constructor(props: LogContentProps) {
    super(props);

    this.state = {
      tableHeight: 600
    };

    this.resizeHandler = this.resizeHandler.bind(this);
  }

  public resizeHandler(height: number) {
    if (height < 100 || height > (window.innerHeight - 100)) return;
    this.setState({ tableHeight: height });
  }

  public render(): JSX.Element | null {
    const {
      selectedLogFile,
      levelFilter,
      search,
      dateTimeFormat_v3: dateTimeFormat,
      font,
      showOnlySearchResults,
      searchIndex,
      dateRange,
      selectedEntry
    } = this.props.state;

    if (!selectedLogFile) return null;
    const isLog = isLogFile(selectedLogFile);
    const scrubber = <Scrubber elementSelector='LogTableContainer' onResizeHandler={this.resizeHandler} />;

    // In most cases, we're dealing with a log file
    if (isLog) {
      return (
        <div className='LogContent' style={{ fontFamily: getFontForCSS(font) }}>
          <div id='LogTableContainer' style={{ height: this.state.tableHeight }}>
            <LogTable
              state={this.props.state}
              dateTimeFormat={dateTimeFormat}
              logFile={selectedLogFile as ProcessedLogFile}
              levelFilter={levelFilter}
              search={search}
              showOnlySearchResults={showOnlySearchResults}
              searchIndex={searchIndex}
              dateRange={dateRange}
              selectedEntry={selectedEntry}
            />
          </div>
          {scrubber}
          <LogLineDetails state={this.props.state} />
          <LogTimeView state={this.props.state} />
        </div>
      );
    }

    // If we're not a log file, we're probably a state file
    if (isUnzippedFile(selectedLogFile)) {
      const logType = getTypeForFile(selectedLogFile);

      if (logType === LogType.NETLOG) {
        return <NetLogView file={selectedLogFile} state={this.props.state} />;
      } else if (logType === LogType.TRACE) {
        return <DevtoolsView file={selectedLogFile} state={this.props.state} />;
      }
    }

    // If _that's_ not the case, we're probably a tool
    if (isTool(selectedLogFile)) {
      return <ToolView state={this.props.state} />;
    }

    return <StateTable state={this.props.state} />;
  }
}
