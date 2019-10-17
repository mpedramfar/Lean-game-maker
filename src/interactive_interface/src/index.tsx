/// <reference types="monaco-editor" />
import { InfoRecord, LeanJsOpts, Message } from '@bryangingechen/lean-client-js-browser';
import * as React from 'react';
import { createPortal, findDOMNode, render } from 'react-dom';
import * as sp from 'react-split-pane';
import { allMessages, checkInputCompletionChange, checkInputCompletionPosition, currentlyRunning, delayMs,
  registerLeanLanguage, server, tabHandler, editorTextDataInterface } from './langservice';
export const SplitPane: any = sp;

const MathJax = require("MathJax");

const showdown = require("showdown");
var markdownConverter = new showdown.Converter();


interface LeanStatusProps {
  file: string;
  isReady: () => void;
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
    var cr = currentlyRunning.value.indexOf(nextProps.file) !== -1;
    if(! cr)
      this.props.isReady();
    this.setState({
      currentlyRunning: cr,
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


interface InfoViewProps {
  file: string;
  cursor?: Position;
  isSolved: () => void;
}
interface InfoViewState {
  goal?: GoalWidgetProps;
  messages: Message[];
}
class InfoView extends React.Component<InfoViewProps, InfoViewState> {
  private subscriptions: monaco.IDisposable[] = [];

  constructor(props: InfoViewProps) {
    super(props);
    this.state = {
      messages: []
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

  checkIfSolved(){
    if( this.state.messages.filter((v) => (v.severity =='error' || v.severity == 'warning')).length == 0 )
      this.props.isSolved();
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
    const goal = this.state.goal &&
      (<div key={'goal'}>{GoalWidget(this.state.goal)}</div>);

    const goalDiv = (
      <div style={{overflowY: 'auto', width: '100%', position: 'absolute', top: 0, bottom: 0}}>
        <div style={{ marginRight: '1ex', float: 'right' }}>
          <img src='./display-goal-light.svg' title='Display Goal' />
        </div>
        {goal}
      </div>
    );
    
    const msgs = this.state.messages.map((msg, i) =>
      (<div key={i}>{MessageWidget({msg})}</div>));

    const msgsDiv = (
      <div style={{overflowY: 'auto', width: '100%', position: 'absolute', top: '1em', bottom: 0}}>
        <div style={{ marginRight: '1ex', float: 'right' }}>
          <img src='./display-list-light.svg' title='Display Messages' />
        </div>
        {msgs}
      </div>
    );

    return ( 
      <div className='no-mathjax' style={{ position: 'absolute', top: '1em', bottom: '1em', left: '1em', right: '1em'}}>
        <LeanStatus file={this.props.file} isReady={this.checkIfSolved.bind(this)}/>
        <div>
          <SplitPane split="horizontal" defaultSize={ window.innerHeight * 0.40 }>
            {goalDiv}
            {msgsDiv}
          </SplitPane>
        </div>
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
  onDidCursorMove: (Position) => void;
}
interface LeanEditorState {
  status: string;
}


var activeEditorData: editorTextDataInterface = { 
  lineOffset: 0,
  activeLeanContent: "",
  activeText: ""
};

class LeanEditor extends React.Component<LeanEditorProps, LeanEditorState> {
  model: monaco.editor.IModel;
  editor: monaco.editor.IStandaloneCodeEditor;

  constructor(props: LeanEditorProps) {
    super(props);
    this.state = {
      status: null,
    };

    activeEditorData.lineOffset = this.props.lineOffset;

    this.model = monaco.editor.getModel(monaco.Uri.file(this.props.file));
    if(! this.model){
      this.model = monaco.editor.createModel("", 'lean', monaco.Uri.file(this.props.file));
      this.model.updateOptions({ tabSize: 2 });
    }

    this.model.onDidChangeContent((e) => {
      activeEditorData.activeText = this.model.getValue();
      activeEditorData.activeLeanContent = this.props.textBefore + this.model.getValue() + this.props.textAfter;
      console.log("activeEditorData = ", activeEditorData);
      checkInputCompletionChange(e, this.editor, this.model);
    });

    if(this.props.initText != this.model.getValue())
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
      this.props.onDidCursorMove({line: e.position.lineNumber + activeEditorData.lineOffset, column: e.position.column - 1});
    });
    this.editor.addCommand(monaco.KeyCode.Tab, () => {
      tabHandler(this.editor, this.model);
    }, 'canTranslate');
  }


  componentWillUnmount() {
    this.editor.dispose();
    this.editor = undefined;
    this.model.onDidChangeContent((e) => {});
  }


  render() {
    const editorDiv = (
      <div id='editor_div' style={{ 
        height: (1.25 * this.props.height)+'em', 
        display: 'flex', flexDirection: 'row', 
        marginTop: '1ex', marginBottom: '1ex' 
      }}>
        <div ref='monaco' style={{
          height: '100%', width: 'calc(100% - 2em)',
          marginRight: '1ex',
          overflow: 'hidden',
        }}/>
      </div>
    );


    return <div className='no-mathjax'> {editorDiv} </div>;
  }

}


interface TextProps {
  content: string;
}
class Text extends React.Component<TextProps, {}> {
  constructor(props: TextProps) {
    super(props);
  }
  render() {
    return <div dangerouslySetInnerHTML={{__html: markdownConverter.makeHtml(this.props.content)}}></div>;
  }
}


interface StatementProps extends LeanEditorProps {
  text: string;
  lean: string;
  type : string; // is equal to "lemma", "theorem" or "example"
  isActive: boolean;
  activate: () => void;
  solved : boolean;
}
class Statement extends React.Component<StatementProps, {}> {

  constructor(props: StatementProps) {
    super(props);
  }

  render() {

    var proof;
    if( this.props.isActive ){
      proof = <LeanEditor {...this.props} />;
    } else {
      proof = <LeanColorize text={"  sorry"}/>; // replace it with the proof
    }

    const title = (this.props.type == "lemma") ? "Lemma" :
        ((this.props.type == "theorem") ? "Theorem" : "Example");

    const label = this.props.solved ? 
      <div style={{color:"green"}}> <span>&#x2713;</span><span className="lemma_label" >{title}</span> </div> :
      <span className="lemma_label" >{title}</span>;

    return <div className="lemma_wrapper">
        {label}
        <div className="lemma_content">
	        <div className="lemma_text">
	          { this.props.text }
    	    </div>
      	  <div className="lemma_lean">
	          <LeanColorize text={this.props.lean} />
    	    </div>
        </div>
        <LeanColorize text="begin"/>
        {proof}
        <LeanColorize text="end"/>
      </div>;

  }
}




interface LevelProps {
  fileName: string;
  levelData: any;
  onDidCursorMove: (Position) => void;
}
interface LevelState {
  //
}
class Level extends React.Component<LevelProps, LevelState> {

  constructor(props: LevelProps) {
    super(props);

    let i = 0;
    for(; i < this.props.levelData.objects.length; i++){
      if(this.props.levelData.objects[i].name == "lemma" || this.props.levelData.objects[i].name == "theorem")
        break;
    }

    this.props.levelData.activeIndex = (i < this.props.levelData.objects.length) ? i : -1;

    this.initEditorData.call(this);
  }

  initEditorData(){ // This function could be done in the python code
    var rawText   = this.props.levelData.raw_text + "\n";

    function nthIndex(str: string, pat: string, n: number) {
      var L = str.length, i = -1;
      while (n-- && i++ < L) {
        i = str.indexOf(pat, i);
        if (i < 0) break;
      }
      return i;
    }
  
    this.props.levelData.objects.map( (itemData, i) => {
      var startIndex       = nthIndex(rawText, "\n", itemData.firstLineNumber - 1) + 1;
      var endIndex         = nthIndex(rawText, "\n", itemData.lastLineNumber) + 1;
  
      itemData.rawText     = rawText.substring(startIndex, endIndex);
      if(i == 0)
        this.props.levelData.header  = rawText.substring(0, startIndex);

      if( itemData.name == "lemma" || itemData.name == "theorem" ) {
        var proofStartIndex = nthIndex(rawText, "\n", itemData.firstProofLineNumber - 1) + 1;
        var proofEndIndex   = nthIndex(rawText, "\n", itemData.lastProofLineNumber);

        itemData.leanBeforeProof   = rawText.substring(startIndex, proofStartIndex);
        itemData.proof             = rawText.substring(proofStartIndex, proofEndIndex); 
        itemData.leanAfterProof    = rawText.substring(proofEndIndex, endIndex);

        if( itemData.editorText == undefined )
          itemData.editorText      = "sorry";   // if changed to "itemData.proof", it will show the all the proofs in the beginning

        itemData.height            = itemData.proof.split(/\r\n|\r|\n/).length;

        itemData.rawText           = itemData.leanBeforeProof + itemData.editorText + itemData.leanAfterProof;

      }
    });

    this.updateEditorData.call(this);
  }

  
  updateEditorData(){
    var levelItems = this.props.levelData.objects;

    levelItems.map( (itemData, i) => {
      itemData.textBefore = this.props.levelData.header
      for(var j = 0; j < i; j++)
        itemData.textBefore += levelItems[j].rawText;
      if(itemData.name == "lemma" || itemData.name == "theorem"){
        itemData.textBefore += itemData.leanBeforeProof;
        itemData.lineOffset = itemData.textBefore.split(/\r\n|\r|\n/).length - 1; // number of lines
      }
        
      itemData.textAfter = "";
      for(var j = levelItems.length - 1; j > i; j--)
        itemData.textAfter = levelItems[j].rawText + itemData.textAfter;
      if(itemData.name == "lemma" || itemData.name == "theorem")
        itemData.textAfter = itemData.leanAfterProof + itemData.textAfter;

    });

  }

  componentDidMount(){
    MathJax.Hub.Queue(["Typeset",MathJax.Hub]);
  }

  render() {
    const content = this.props.levelData.objects.map( (itemData, i) => {
      if( itemData.name == "text" )
      {
        return <Text  key={i} content={itemData.content}  />;
      } 
      else if( itemData.name == "lean" && (! itemData.hidden))
      {
        return <LeanColorize key={i} text={itemData.lean}/>
      }
      else if( itemData.name == "lemma" || itemData.name == "theorem" || itemData.name == "example")
      {
        var editorProps : LeanEditorProps = {
          file : this.props.fileName,
          initText : itemData.editorText,
          textBefore : itemData.textBefore,
          textAfter : itemData.textAfter,
          lineOffset : itemData.lineOffset,
          height : itemData.height,
          readonly: itemData.name == "example",
          onDidCursorMove: this.props.onDidCursorMove
        };
  
      return <Statement key={i}
                      activate={() => {}}
                      isActive={this.props.levelData.activeIndex == i} 
                      type={itemData.name}
                      solved={itemData.status == "solved"}
                      text={itemData.text}
                      lean={itemData.lean}
                      {...editorProps}
                      />;
      };
    });

    return <div>{content}</div>;
  }
}


interface GameProps {
  fileName: string;
  gameData: any;
}
interface GameState {
  activeWorldNumber: number;
  activeLevelNumber: number;
  cursor?: Position;
}
class Game extends React.Component<GameProps, GameState> {

  constructor(props: GameProps) {
    super(props);
    this.state = {
      activeWorldNumber: 0,
      activeLevelNumber: 0,
    };
  }

  goto(world: number, level: number){
    let levelData = this.props.gameData[this.state.activeWorldNumber][this.state.activeLevelNumber]
    let statementData = levelData.objects[levelData.activeIndex];

    if(statementData){
      statementData.editorText = activeEditorData.activeText;
      statementData.rawText = statementData.leanBeforeProof + statementData.proof 
               + statementData.leanAfterProof; // We don't want any errors from inactive items and we want to use them in our proofs
    }
    
    this.setState({ activeWorldNumber: world, activeLevelNumber: level });
  }

  gotoWorld(i: number){
    this.goto(i, 0);
  }

  gotoLevel(i: number){
    this.goto(this.state.activeWorldNumber, i);
  }

  render() {
    const worldData = this.props.gameData[this.state.activeWorldNumber];

    const worldButtonsPanel = <div style={{ width: '100%', height: '2em', top: '0', position: 'fixed' }}>
      <button disabled={ this.state.activeWorldNumber == 0 } 
        style={{ 
          float: 'left', borderStyle: 'ridge', width: '20%', height:'100%'
        }} onClick={() => { this.gotoWorld.call(this, this.state.activeWorldNumber - 1); }}> Previous World </button>
      <button disabled={ this.state.activeWorldNumber == this.props.gameData.length - 1 } 
        style={{
          float: 'right', borderStyle: 'ridge', width: '20%', height: '100%'
        }} onClick={() => { this.gotoWorld.call(this, this.state.activeWorldNumber + 1); }}> Next World </button>
      <div style={{ textAlign: 'center' }}><h3> World {this.state.activeWorldNumber + 1} </h3></div>
    </div>;

    const levelButtonsPanel = <div style={{ width: '100%', height: '2em', top: '2em', position: 'fixed' }}>
      <button disabled={ this.state.activeLevelNumber == 0 } 
        style={{
          float: 'left', borderStyle: 'ridge', width: '20%', height:'100%'
        }} onClick={() => { this.gotoLevel.call(this, this.state.activeLevelNumber - 1); }}> Previous Level </button>
      <button disabled={ this.state.activeLevelNumber == worldData.length - 1 } 
        style={{ 
          float: 'right', borderStyle: 'ridge', width: '20%', height: '100%' 
        }} onClick={() => { this.gotoLevel.call(this, this.state.activeLevelNumber + 1); }}> Next Level </button>
      <div style={{ textAlign: 'center' }}><h4> Level {this.state.activeLevelNumber + 1} </h4></div>
    </div>;


    const key = this.state.activeWorldNumber * 1000 + this.state.activeLevelNumber; // We need a unique key for every level.

    const content = <Level fileName={this.props.fileName} key={key} levelData={worldData[this.state.activeLevelNumber]} 
        onDidCursorMove={(c) => {this.setState({cursor: c})}}/>;


    // statementIsSolved: () => { 
    //   if(itemData.status != "solved") {
    //     itemData.status = "solved";
    //     this.forceUpdate();
    //   }},
        
    const infoViewDiv = <InfoView file={this.props.fileName} cursor={this.state.cursor} isSolved={() => {}}/>;

    const divStyle = {
      position: 'absolute',
      top: 0, bottom: 0,
      left: 0, right: 0,
      padding: '1em',
      borderStyle: 'double'
    } as React.CSSProperties;

    return (
      <div>
        {worldButtonsPanel}
        {levelButtonsPanel}
        <div style={{ position: 'fixed', top: '5em', bottom: '1em', left: '1em', right: '1em'}}> 
          <SplitPane split='vertical' defaultSize={ window.innerWidth * 0.6 }>
            <div style={{
              ...divStyle,
              overflowY: 'scroll',
            }}> 
              {content}
            </div>
            <div style={divStyle}>
              {infoViewDiv}
            </div>
          </SplitPane>
        </div>
      </div>
    );
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

// tslint:disable-next-line:no-var-requires
(window as any).require(['vs/editor/editor.main'], () => {

  const fn = monaco.Uri.file('test.lean').fsPath;

  registerLeanLanguage(leanJsOpts, activeEditorData);
  
  render(
      <Game fileName={fn} gameData={gameData}/>,
      document.getElementById('root'),
  );

});

