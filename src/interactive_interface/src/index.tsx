/// <reference types="monaco-editor" />
import { InfoRecord, LeanJsOpts, Message } from '@bryangingechen/lean-client-js-browser';
import * as React from 'react';
import { createPortal, findDOMNode, render } from 'react-dom';
import * as sp from 'react-split-pane';
import { allMessages, checkInputCompletionChange, checkInputCompletionPosition, currentlyRunning, delayMs,
  registerLeanLanguage, server, tabHandler, editorTextDataInterface } from './langservice';
export const SplitPane: any = sp;

const MathJax = require("MathJax");



interface LeanStatusProps {
  file: string;
}
interface LeanStatusState {
  currentlyRunning: boolean;
}
class LeanStatus extends React.Component<LeanStatusProps, LeanStatusState> {
  private subscriptions: monaco.IDisposable[] = [];

  constructor(props: LeanStatusProps) {
    super(props);
    this.state = { currentlyRunning: true };
  }

  componentWillMount() {
    this.updateRunning(this.props);
    this.subscriptions.push(
      currentlyRunning.updated.on((fns) => this.updateRunning(this.props)),
    );
  }
  componentWillUnmount() {
    for (const s of this.subscriptions) {
      s.dispose();
    }
    this.subscriptions = [];
  }
  componentWillReceiveProps(nextProps) {
    this.updateRunning(nextProps);
  }

  updateRunning(nextProps) {
    this.setState({
      currentlyRunning: currentlyRunning.value.indexOf(nextProps.file) !== -1,
    });
  }


  render() {
    return this.state.currentlyRunning ? <div><p>Lean is busy ...</p></div> : <div></div>;
  }
}



function leanColorize(text: string): string {
  // TODO(gabriel): use promises
  const colorized: string = (monaco.editor.colorize(text, 'lean', {}) as any)._value;
  return colorized.replace(/&nbsp;/g, ' ');
}


interface LeanColorizeProps {
  text: string;
}
interface LeanColorizeStates {
  colorized: string;
}
class LeanColorize extends React.Component<LeanColorizeProps, LeanColorizeStates> {
  constructor(props: LeanColorizeProps) {
    super(props);
    this.state = { colorized: this.props.text };
  }
  componentDidMount(){
    monaco.editor.colorize(this.props.text, 'lean', {}).then( (res) => {
      this.setState({ colorized: res.replace(/&nbsp;/g, ' ') });
    });
  }
  render() {
    return <div className='code-block no-mathjax' dangerouslySetInnerHTML={{__html: this.state.colorized}}></div>;
  }

}


interface MessageWidgetProps {
  msg: Message;
}
function MessageWidget({msg}: MessageWidgetProps) {
  const colorOfSeverity = {
    information: 'green',
    warning: 'orange',
    error: 'red',
  };
  // TODO: links and decorations on hover
  return (
    <div style={{paddingBottom: '1em'}}>
      <div className='info-header' style={{ color: colorOfSeverity[msg.severity] }}>
        {msg.pos_line}:{msg.pos_col}: {msg.severity}: {msg.caption}</div>
      <div className='code-block' dangerouslySetInnerHTML={{__html: leanColorize(msg.text)}}/>
    </div>
  );
}

interface Position {
  line: number;
  column: number;
}

interface GoalWidgetProps {
  goal: InfoRecord;
  position: Position;
}

function GoalWidget({goal, position}: GoalWidgetProps) {
  const tacticHeader = goal.text && <div className='info-header'>
    {position.line}:{position.column}: tactic {
      <span className='code-block' style={{fontWeight: 'normal', display: 'inline'}}>{goal.text}</span>}</div>;
  const docs = goal.doc && <ToggleDoc doc={goal.doc}/>;

  const typeHeader = goal.type && <div className='info-header'>
    {position.line}:{position.column}: type {
      goal['full-id'] && <span> of <span className='code-block' style={{fontWeight: 'normal', display: 'inline'}}>
      {goal['full-id']}</span></span>}</div>;
  const typeBody = (goal.type && !goal.text) // don't show type of tactics
    && <div className='code-block'
    dangerouslySetInnerHTML={{__html: leanColorize(goal.type) + (!goal.doc && '<br />')}}/>;

  const goalStateHeader = goal.state && <div className='info-header'>
    {position.line}:{position.column}: goal</div>;
  const goalStateBody = goal.state && <div className='code-block'
    dangerouslySetInnerHTML={{__html: leanColorize(goal.state) + '<br/>'}} />;

  return (
    // put tactic state first so that there's less jumping around when the cursor moves
    <div>
      {goalStateHeader}
      {goalStateBody}
      {tacticHeader || typeHeader}
      {typeBody}
      {docs}
    </div>
  );
}

interface ToggleDocProps {
  doc: string;
}
interface ToggleDocState {
  showDoc: boolean;
}
class ToggleDoc extends React.Component<ToggleDocProps, ToggleDocState> {
  constructor(props: ToggleDocProps) {
    super(props);
    this.state = { showDoc: this.props.doc.length < 80 };
    this.onClick = this.onClick.bind(this);
  }
  onClick() {
    this.setState({ showDoc: !this.state.showDoc });
  }
  render() {
    return <div onClick={this.onClick} className='toggleDoc'>
      {this.state.showDoc ?
        this.props.doc : // TODO: markdown / highlighting?
        <span>{this.props.doc.slice(0, 75)} <span style={{color: '#246'}}>[...]</span></span>}
        <br/>
        <br/>
    </div>;
  }
}

enum DisplayMode {
  OnlyState, // only the state at the current cursor position including the tactic state
  AllMessage, // all messages
}

interface InfoViewProps {
  file: string;
  cursor?: Position;
}
interface InfoViewState {
  goal?: GoalWidgetProps;
  messages: Message[];
  displayMode: DisplayMode;
}
class InfoView extends React.Component<InfoViewProps, InfoViewState> {
  private subscriptions: monaco.IDisposable[] = [];

  constructor(props: InfoViewProps) {
    super(props);
    this.state = {
      messages: [],
      displayMode: DisplayMode.OnlyState,
    };
  }
  componentWillMount() {
    this.updateMessages(this.props);
    let timer = null; // debounce
    this.subscriptions.push(
      server.allMessages.on((allMsgs) => {
        if (timer) { clearTimeout(timer); }
        timer = setTimeout(() => {
          this.updateMessages(this.props);
          this.refreshGoal(this.props);
        }, 100);
      }),
    );
  }
  componentWillUnmount() {
    for (const s of this.subscriptions) {
      s.dispose();
    }
    this.subscriptions = [];
  }
  componentWillReceiveProps(nextProps) {
    if (nextProps.cursor === this.props.cursor) { return; }
    this.updateMessages(nextProps);
    this.refreshGoal(nextProps);
  }

  updateMessages(nextProps) {
    this.setState({
      messages: allMessages.filter((v) => v.file_name === this.props.file),
    });
  }

  refreshGoal(nextProps?: InfoViewProps) {
    if (!nextProps) {
      nextProps = this.props;
    }
    if (!nextProps.cursor) {
      return;
    }

    const position = nextProps.cursor;
    server.info(nextProps.file, position.line, position.column).then((res) => {
      this.setState({goal: res.record && { goal: res.record, position }});
    });
  }

  render() {
    const goal = (this.state.displayMode === DisplayMode.OnlyState) &&
      this.state.goal &&
      (<div key={'goal'}>{GoalWidget(this.state.goal)}</div>);
    const filteredMsgs = (this.state.displayMode === DisplayMode.AllMessage) ?
      this.state.messages :
      this.state.messages.filter(({pos_col, pos_line, end_pos_col, end_pos_line}) => {
        if (!this.props.cursor) { return false; }
        const {line, column} = this.props.cursor;
        return pos_line <= line &&
          ((!end_pos_line && line === pos_line) || line <= end_pos_line) &&
          (line !== pos_line || pos_col <= column) &&
          (line !== end_pos_line || end_pos_col >= column);
      });
    const msgs = filteredMsgs.map((msg, i) =>
      (<div key={i}>{MessageWidget({msg})}</div>));
    return (
      <div style={{overflow: 'auto', height: '100%'}}>
        <LeanStatus file={this.props.file} />
        <div className='infoview-buttons'>
          <img src='./display-goal-light.svg' title='Display Goal'
            style={{opacity: (this.state.displayMode === DisplayMode.OnlyState ? 1 : 0.25)}}
            onClick={() => {
              this.setState({ displayMode: DisplayMode.OnlyState });
            }}/>
          <img src='./display-list-light.svg' title='Display Messages'
            style={{opacity: (this.state.displayMode === DisplayMode.AllMessage ? 1 : 0.25)}}
            onClick={() => {
              this.setState({ displayMode: DisplayMode.AllMessage });
            }}/>
        </div>
        {goal}
        {msgs}
      </div>
    );
  }
}







interface LeanEditorProps {
  file: string;
  initText: string;
  lineOffset: number;
  textBefore: string;
  textAfter: string;
  readonly: boolean;
  height: number;
}
interface LeanEditorState {
  cursor?: Position;
  status: string;
}


var sharedEditorData: editorTextDataInterface = { 
  lineOffset: 0,
  textBefore: "",
  textAfter: "",
  editorText: "",
  activeLeanContent: ""
};
sharedEditorData
class LeanEditor extends React.Component<LeanEditorProps, LeanEditorState> {
  model: monaco.editor.IModel;
  editor: monaco.editor.IStandaloneCodeEditor;

  editorData: editorTextDataInterface;

  constructor(props: LeanEditorProps) {
    super(props);
    this.state = {
      status: null,
    };

    sharedEditorData.lineOffset = this.props.lineOffset;
    sharedEditorData.textBefore = this.props.textBefore;
    sharedEditorData.textAfter  = this.props.textAfter;

    this.model = monaco.editor.getModel(monaco.Uri.file(this.props.file));
    if(! this.model){
      this.model = monaco.editor.createModel("", 'lean', monaco.Uri.file(this.props.file));
      this.model.updateOptions({ tabSize: 2 });
    }

    this.model.onDidChangeContent((e) => {
      sharedEditorData.editorText = this.model.getValue();
      sharedEditorData.activeLeanContent = sharedEditorData.textBefore + this.model.getValue() + sharedEditorData.textAfter;
      checkInputCompletionChange(e, this.editor, this.model);
    });
    this.model.setValue(this.props.initText);
  }

  componentDidMount() {
    const node = findDOMNode(this.refs.monaco) as HTMLElement;
    const options: monaco.editor.IEditorConstructionOptions = {
      selectOnLineNumbers: true,
      roundedSelection: false,
      readOnly: this.props.readonly,
      theme: 'vs',
      cursorStyle: 'line',
      automaticLayout: true,
      cursorBlinking: 'solid',
      model: this.model,
      minimap: {enabled: false},
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      lineNumbers: (num) => (num + this.props.lineOffset).toString(),
    };
    this.editor = monaco.editor.create(node, options);
    const canTranslate = this.editor.createContextKey('canTranslate', false);
    this.editor.onDidChangeCursorPosition((e) => {
      canTranslate.set(checkInputCompletionPosition(e, this.editor, this.model));
      this.setState({cursor: {line: e.position.lineNumber + sharedEditorData.lineOffset, column: e.position.column - 1}});
    });
    this.editor.addCommand(monaco.KeyCode.Tab, () => {
      tabHandler(this.editor, this.model);
    }, 'canTranslate');
  }


  componentWillUnmount() {
    this.editor.dispose();
    this.editor = undefined;
  }


  render() {
    const editorDiv = <div id='editor_div' style={{ height: (1.25 * this.props.height)+'em', 
                              display: 'flex', flexDirection: 'row', marginTop: '1ex', marginBottom: '1ex' }}>
      <div ref='monaco' style={{
        height: '100%', width: 'calc(100% - 2em)',
        marginRight: '1ex',
        overflow: 'hidden',
      }} />
    </div>;

    const infoViewDiv = <div id="tactic_state_wrapper">
      <div id="info_view_div" className='infoContainer' style={{ height: '100%', width: '100%' }}>
        <InfoView file={this.props.file} cursor={this.state.cursor}/>
      </div>
    </div>;

    return <div className='no-mathjax'> {editorDiv} {infoViewDiv} </div>;
  }

}


interface TextProps {
  textData: any;
}
class Text extends React.Component<TextProps, {}> {
  constructor(props: TextProps) {
    super(props);
  }
  render() {
    return <div>
      {this.props.textData.paragraphs.map((paragraph, i) => {
        return <p key={i}>{paragraph.content}</p>;
      })}
      </div>;
  }
}


interface StatementProps {
  fileName: string;
  statementData: any;
  type : string; // is equal to "lemma", "theorem" or "example"
  isActive: boolean;
  activate: () => void;
  readonly: boolean;
}
interface StatementState {
  temp : any;
}
class Statement extends React.Component<StatementProps, StatementState> {

  constructor(props: StatementProps) {
    super(props);
    this.state = {
      temp : 0,
    };
  }

  render() {


    var proof;
    if( this.props.isActive ){
      var editorProps = {
        file : this.props.fileName,
        initText : this.props.statementData.editorText,
        textBefore : this.props.statementData.textBefore,
        textAfter : this.props.statementData.textAfter,
        lineOffset : this.props.statementData.lineOffset,
        height : this.props.statementData.height,
        readonly: this.props.readonly,
        };
      proof = <LeanEditor {...editorProps} />;
    } else {
      proof = <button onClick={this.props.activate}>Click here to prove !</button>;
    }


    if (this.props.type == "lemma"){
      return <div className="lemma_wrapper">
        <span className="lemma_label">Lemma</span>
        <div className="lemma_content">
	        <div className="lemma_text">
	          { this.props.statementData.text }
    	    </div>
      	  <div className="lemma_lean">
	          <LeanColorize text={this.props.statementData.lean} />
    	    </div>
        </div>
        <LeanColorize text="begin"/>
        {proof}
        <LeanColorize text="end"/>
      </div>;
    } else if (this.props.type == "theorem"){
      return <div className="lemma_wrapper">
        <span className="lemma_label">Theorem</span>
        <div className="lemma_content">
	        <div className="lemma_text">
	          { this.props.statementData.text }
    	    </div>
      	  <div className="lemma_lean">
	          <LeanColorize text={this.props.statementData.lean} />
    	    </div>
        </div>
        <LeanColorize text="begin"/>
        {proof}
        <LeanColorize text="end"/>
      </div>;
    } else if (this.props.type == "example"){
      return <div className="lemma_wrapper">
        <span className="lemma_label">Example</span>
        <div className="lemma_content">
	        <div className="lemma_text">
	          { this.props.statementData.text }
    	    </div>
      	  <div className="lemma_lean">
	          <LeanColorize text={this.props.statementData.lean} />
    	    </div>
        </div>
        <LeanColorize text="begin"/>
        {proof}
        <LeanColorize text="end"/>
      </div>;
    }

  }
}




var activeStatement = null;


interface PageProps {
  fileName: string;
  pageData: any;
}
interface PageState {
  activeItemIndex: number;
}
class Page extends React.Component<PageProps, PageState> {
  activeEditorText: string;

  constructor(props: PageProps) {
    super(props);

    var pageItems = this.props.pageData.objects;
    var i = 0;
    for(; i < pageItems.length; i++){
      if( pageItems[i].name == "lemma" || pageItems[i].name == "theorem" )
        break;
    }
    this.state = {
      activeItemIndex: i
    };
    activeStatement = pageItems[i];
    this.initEditorData.call(this);
  }

  initEditorData(){ // This function could be done in the python code
    var rawText   = this.props.pageData.raw_text + "\n";

    function nthIndex(str: string, pat: string, n: number) {
      var L = str.length, i = -1;
      while (n-- && i++ < L) {
        i = str.indexOf(pat, i);
        if (i < 0) break;
      }
      return i;
    }
  
    var pageItems = this.props.pageData.objects;
    pageItems.map( (itemData, i) => {
      var startIndex       = nthIndex(rawText, "\n", itemData.firstLineNumber - 1) + 1;
      var endIndex         = nthIndex(rawText, "\n", itemData.lastLineNumber) + 1;
  
      itemData.rawText     = rawText.substring(startIndex, endIndex);
      if(i == 0)
        this.props.pageData.header  = rawText.substring(0, startIndex);

      if( itemData.name == "lemma" || itemData.name == "theorem" ) {
        var proofStartIndex = nthIndex(rawText, "\n", itemData.firstProofLineNumber - 1) + 1;
        var proofEndIndex   = nthIndex(rawText, "\n", itemData.lastProofLineNumber);

        itemData.leanBeforeProof   = rawText.substring(startIndex, proofStartIndex);
        itemData.proof             = rawText.substring(proofStartIndex, proofEndIndex); 
        itemData.leanAfterProof    = rawText.substring(proofEndIndex, endIndex);

        if( itemData.editorText == undefined )
          itemData.editorText      = itemData.proof;             // TODO : change it to "sorry"

        itemData.height            = itemData.proof.split(/\r\n|\r|\n/).length;

        itemData.rawText           = itemData.leanBeforeProof + itemData.editorText + itemData.leanAfterProof;

      }
    });

    this.updateEditorData.call(this);
  }

  
  updateEditorData(){
    var pageItems = this.props.pageData.objects;

    pageItems.map( (itemData, i) => {
      itemData.textBefore = this.props.pageData.header
      for(var j = 0; j < i; j++)
        itemData.textBefore += pageItems[j].rawText;
      if(itemData.name == "lemma" || itemData.name == "theorem"){
        itemData.textBefore += itemData.leanBeforeProof;
        itemData.lineOffset = itemData.textBefore.split(/\r\n|\r|\n/).length - 1; // number of lines
      }
        
      itemData.textAfter = "";
      for(var j = pageItems.length - 1; j > i; j--)
        itemData.textAfter = pageItems[j].rawText + itemData.textAfter;
      if(itemData.name == "lemma" || itemData.name == "theorem")
        itemData.textAfter = itemData.leanAfterProof + itemData.textAfter;

    });

  }

  activateEditor(prevIndex:number, index: number){
    activeStatement.editorText = sharedEditorData.editorText;
    activeStatement.rawText    = activeStatement.leanBeforeProof + activeStatement.proof 
                                   + activeStatement.leanAfterProof; // We don't want any errors from inactive items


    this.updateEditorData.call(this);
    activeStatement = this.props.pageData.objects[index];
    this.setState({ activeItemIndex: index });
  }

  componentDidMount(){
    MathJax.Hub.Queue(["Typeset",MathJax.Hub]);
  }

  render() {
    const content = this.props.pageData.objects.map( (itemData, i) => {
      if( itemData.name == "text" )
      {
        return <Text  key={i} textData={itemData}  />;
      } 
      else if( itemData.name == "lean" && (! itemData.hidden))
      {
        return <LeanColorize key={i} text={itemData.lean}/>
      }
      else if( itemData.name == "lemma" || itemData.name == "theorem" || itemData.name == "example")
      {
        return <Statement key={i}
                      activate={this.activateEditor.bind(this, this.state.activeItemIndex, i)} 
                      isActive={this.state.activeItemIndex == i} 
                      fileName={this.props.fileName} 
                      statementData={itemData} 
                      type={itemData.name} 
                      readonly={itemData.name == "example"} />;
      };
    });

    return <div id="wrapper">
      <div id="content"> {content} </div>
    </div>;
  }
}


interface LevelProps {
  fileName: string;
  levelData: any;
}
interface LevelState {
  activePageNumber: number;
}
class Level extends React.Component<LevelProps, LevelState> {
  constructor(props: LevelProps) {
    super(props);
    this.state = {
      activePageNumber: 0
    };
  }

  gotoPage(index){
    if(activeStatement){
      activeStatement.editorText = sharedEditorData.editorText;
      activeStatement = null;  
    }
    this.setState({ activePageNumber: index });
  }

  render() {
    // key value guarantees that a new item is created when key is different
    const content = <Page fileName={this.props.fileName} key={this.state.activePageNumber}
                      pageData={this.props.levelData[this.state.activePageNumber]} />;

    const pageButtonsPanel = <div style={{ width: '100%', height: '2em', top: '2em', position: 'fixed' }}>
      <button style={{ display: this.state.activePageNumber > 0 ? 'block': 'none',
        marginLeft: 0, borderStyle: 'ridge', width: '20%', height:'100%'
      }} onClick={() => { this.gotoPage.call(this, this.state.activePageNumber - 1); }}> Previous Page </button>
      <button style={{ display: this.state.activePageNumber < this.props.levelData.length - 1 ? 'block': 'none',
        marginLeft: '80%', borderStyle: 'ridge', width: '20%', height: '100%'
      }} onClick={() => { this.gotoPage.call(this, this.state.activePageNumber + 1); }}> Next Page </button>
    </div>

    return <div>
      {pageButtonsPanel}
      <div id="page_wrapper"> {content} </div>
    </div>;
  }
}



interface GameProps {
  fileName: string;
  gameData: any;
}
interface GameState {
  activeLevelNumber: number;
  activePageNumber: number;
}
class Game extends React.Component<GameProps, GameState> {

  constructor(props: GameProps) {
    super(props);
    this.state = {
      activeLevelNumber: 0,
      activePageNumber: 0,
    };
  }

  gotoLevel(index){
    if(activeStatement){
      activeStatement.editorText = sharedEditorData.editorText;
      activeStatement = null;  
    }
    this.setState({ activeLevelNumber: index });
  }

  gotoPage(index){
    if(activeStatement){
      activeStatement.editorText = sharedEditorData.editorText;
      activeStatement = null;  
    }
    this.setState({ activePageNumber: index });
  }

  render() {
    // we need a unique key for every page
    const key = this.state.activeLevelNumber * 100 + this.state.activePageNumber; // TODO : This should be changed

    const levelData = this.props.gameData[this.state.activeLevelNumber];

    const content = <Page fileName={this.props.fileName} key={key}
        pageData={levelData[this.state.activePageNumber]} />;

    const levelButtonsPanel = <div style={{ width: '100%', height: '2em', top: '0', position: 'fixed' }}>
      <button disabled={ this.state.activeLevelNumber == 0 } 
        style={{ 
          float: 'left', borderStyle: 'ridge', width: '20%', height:'100%'
        }} onClick={() => { this.gotoLevel.call(this, this.state.activeLevelNumber - 1); }}> Previous Level </button>
      <button disabled={ this.state.activeLevelNumber == this.props.gameData.length - 1 } 
        style={{
          float: 'right', borderStyle: 'ridge', width: '20%', height: '100%'
        }} onClick={() => { this.gotoLevel.call(this, this.state.activeLevelNumber + 1); }}> Next Level </button>
      <div style={{ textAlign: 'center' }}><h3> Level {this.state.activeLevelNumber + 1} </h3></div>
    </div>;

    const pageButtonsPanel = <div style={{ width: '100%', height: '2em', top: '2em', position: 'fixed' }}>
      <button disabled={ this.state.activePageNumber == 0 } 
        style={{
          float: 'left', borderStyle: 'ridge', width: '20%', height:'100%'
        }} onClick={() => { this.gotoPage.call(this, this.state.activePageNumber - 1); }}> Previous Page </button>
      <button disabled={ this.state.activePageNumber == levelData.length - 1 } 
        style={{ 
          float: 'right', borderStyle: 'ridge', width: '20%', height: '100%' 
        }} onClick={() => { this.gotoPage.call(this, this.state.activePageNumber + 1); }}> Next Page </button>
      <div style={{ textAlign: 'center' }}><h4> Page {this.state.activePageNumber + 1} </h4></div>
    </div>


    return <div>
      {levelButtonsPanel}
      {pageButtonsPanel}
      <div style={{ marginTop: '4em' }} id="page_wrapper"> {content} </div>
    </div>;
  }
}




const leanJsOpts: LeanJsOpts = {
  javascript: './lean_js_js.js',
  libraryZip: './library.zip',
  webassemblyJs: './lean_js_wasm.js',
  webassemblyWasm: './lean_js_wasm.wasm',
};

let info = null;
const metaPromise = fetch(leanJsOpts.libraryZip.slice(0, -3) + 'info.json')
  .then((res) => res.json())
  .then((j) => info = j);

const gameData = require('game_data');

console.log(gameData);

// tslint:disable-next-line:no-var-requires
(window as any).require(['vs/editor/editor.main'], () => {

  const fn = monaco.Uri.file('test.lean').fsPath;

  registerLeanLanguage(leanJsOpts, sharedEditorData);
  
  render(
      <Game fileName={fn} gameData={gameData}/>,
      document.getElementById('root'),
  );

});

