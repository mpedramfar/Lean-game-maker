/// <reference types="monaco-editor" />
import { InfoRecord, LeanJsOpts, Message } from '@bryangingechen/lean-client-js-browser';
import * as React from 'react';
import { createPortal, findDOMNode, render } from 'react-dom';
import { allMessages, checkInputCompletionChange, checkInputCompletionPosition, currentlyRunning, delayMs,
  registerLeanLanguage, server, tabHandler, editorTextDataInterface } from './langservice';

import { Container, Section, Bar } from 'react-simple-resizer';

import {
  Accordion,
  AccordionItem,
  AccordionItemHeading,
  AccordionItemButton,
  AccordionItemPanel,
} from 'react-accessible-accordion';

const MathJax = require("MathJax");

const showdown = require("showdown");
showdown.extension('targetlink', function() { // open links in new tabs
  return [{
    type: 'html',
    regex: /(<a [^>]+?)(>.*<\/a>)/g,
    replace: '$1 target="_blank"$2'
  }];
});
var markdownConverter = new showdown.Converter({
  extensions: ['targetlink']
});


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
      <LeanColorize text={msg.text}/>
    </div>
  );
  // return (
  //   <div style={{paddingBottom: '1em'}}>
  //     <div className='info-header' style={{ color: colorOfSeverity[msg.severity] }}>
  //       {msg.pos_line}:{msg.pos_col}: {msg.severity}: {msg.caption}</div>
  //     <div className='code-block' dangerouslySetInnerHTML={{__html: leanColorize(msg.text)}}/>
  //   </div>
  // );
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
      <div style={{overflowY: 'auto', width: '100%', height: '100%'}}>
        <div style={{ marginRight: '1ex', float: 'right' }}>
          <img src='./display-goal-light.svg' title='Display Goal' />
        </div>
        {goal}
      </div>
    );
    
    const msgs = this.state.messages.map((msg, i) =>
      (<div key={i}>{MessageWidget({msg})}</div>));

    const msgsDiv = (
      <div style={{overflowY: 'auto', width: '100%', height: '100%', boxSizing: 'border-box', paddingTop: '1em'}}>
        <div style={{ marginRight: '1ex', float: 'right' }}>
          <img src='./display-list-light.svg' title='Display Messages' />
        </div>
        {msgs}
      </div>
    );

    return ( 
      <div className='no-mathjax' style={{ 
          height: "calc(100% - 2em", width: "calc(100% - 2em",
          boxSizing: "border-box", margin: "1em" }}>
        <LeanStatus file={this.props.file} isReady={this.checkIfSolved.bind(this)}/>
        <Container vertical={true} style={{ height: '100%' }}>
          <Section minSize={200}>
            {goalDiv}
          </Section>
          <Bar size={10} className="Resizer horizontal" />
          <Section minSize={200}>
            {msgsDiv}
          </Section>
        </Container>
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
      proof = <LeanColorize text={this.props.initText}/>; // replace it with the proof
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
        <div style={{ marginTop:"0.5em" }}>
          <span style={{ fontStyle:"italic" }}>Proof :</span>
        </div>
        <div className="lemma_proof" >
          <LeanColorize text="begin"/>
          {proof}
          <LeanColorize text="end"/>
        </div>
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
      if(this.props.levelData.objects[i].type == "lemma" || this.props.levelData.objects[i].type == "theorem")
        break;
    }

    this.props.levelData.activeIndex = (i < this.props.levelData.objects.length) ? i : -1;

  }


  componentDidMount(){
    MathJax.Hub.Queue(["Typeset",MathJax.Hub]);
  }

  render() {
    const content = this.props.levelData.objects.map( (itemData, i) => {
      if( itemData.type == "text" )
      {
        return <Text  key={i} content={itemData.content}  />;
      } 
      else if( itemData.type == "lean" && (! itemData.hidden))
      {
        return <LeanColorize key={i} text={itemData.lean}/>
      }
      else if( itemData.type == "lemma" || itemData.type == "theorem" || itemData.type == "example")
      {
        var editorProps : LeanEditorProps = {
          file : this.props.fileName,
          initText : itemData.editorText,
          textBefore : itemData.textBefore,
          textAfter : itemData.textAfter,
          lineOffset : itemData.lineOffset,
          height : itemData.height,
          readonly: itemData.type == "example",
          onDidCursorMove: this.props.onDidCursorMove
        };
  
      return <Statement key={i}
                      activate={() => {}}
                      isActive={this.props.levelData.activeIndex == i} 
                      type={itemData.type}
                      solved={itemData.status == "solved"}
                      text={itemData.text}
                      lean={itemData.lean}
                      {...editorProps}
                      />;
      };
    });

    return <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      padding: '1em',
      borderStyle: 'double',
      overflowY: 'auto'}}>{content}</div>;
  }
}


interface SideBarProps {
  gameData: any;
  world: number;
  level: number;
}
interface SideBarState {
}
class SideBar extends React.Component<SideBarProps, SideBarState> {

  constructor(props: SideBarProps) {
    super(props);
  }

  getStatements(type: string){

    let statements = [];
    for(let w = 0; w <= this.props.world; w++){
      for(let l = 0; (w < this.props.world && l < this.props.gameData[w].length) || (w == this.props.world && l < this.props.level); l++){
        let levelData = gameData[w][l];
        for(let i = 0; i < levelData.objects.length; i++){
          if(levelData.objects[i].type == type)
            statements.push(levelData.objects[i]);
        }
      }
    }

    return statements.map((s, i) => {
      let text = s.lean.trim();
      let j = text.indexOf(" "), k = text.indexOf(":=");
      text = text.substring(j+1, k);

      if(type == "example"){
        k = 30000;
        return (
          <div>
            <LeanColorize key={k + 2*i} text={s.lean} />
            <LeanColorize key={k + 2*i+1} text={"begin\n" + s.proof + "\nend"} />
          </div>
        );
      } else {
        let j1 = text.indexOf(" ");   j1 = j1 < 0 ? text.length : j1;
        let j2 = text.indexOf(":");   j2 = j2 < 0 ? text.length : j2;
        let j3 = text.indexOf("(");   j3 = j3 < 0 ? text.length : j3;
        let j4 = text.indexOf("{");   j4 = j4 < 0 ? text.length : j4;
        j = Math.min(j1, j2, j3, j4);
        let name = text.substring(0, j), statement = text.substring(j).trim();
        k = (type == "theorem") ? 10000 : 20000;
        return (
          <div>
            <LeanColorize key={k + 2*i} text={name} />
            <LeanColorize key={k + 2*i+1} text={"  " + statement} />
          </div>
        );
      }
    });
  }

  render(){
    const theorems = this.getStatements("theorem");
    const lemmas   = this.getStatements("lemma");
    const examples = this.getStatements("example");

    return (
      <div style={{fontSize: "small", overflowY: "auto", height: "100%", overflowX: "hidden"}}>
      <Accordion allowMultipleExpanded={true} allowZeroExpanded={true}>
        <AccordionItem key={0}>
          <AccordionItemHeading>
            <AccordionItemButton>Theorems</AccordionItemButton>
          </AccordionItemHeading>
          <AccordionItemPanel>
            {theorems}
          </AccordionItemPanel>
        </AccordionItem>
        <AccordionItem key={1}>
          <AccordionItemHeading>
            <AccordionItemButton>Lemmas</AccordionItemButton>
          </AccordionItemHeading>
          <AccordionItemPanel>
            {lemmas}
          </AccordionItemPanel>
        </AccordionItem>
        <AccordionItem key={2}>
          <AccordionItemHeading>
            <AccordionItemButton>Examples</AccordionItemButton>
          </AccordionItemHeading>
          <AccordionItemPanel>
            {examples}
          </AccordionItemPanel>
        </AccordionItem>
      </Accordion>
      </div>
    );
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


    const sideBarDiv = <SideBar gameData={this.props.gameData} world={this.state.activeWorldNumber} level={this.state.activeLevelNumber} ></SideBar>;

    const key = this.state.activeWorldNumber * 1000 + this.state.activeLevelNumber; // We need a unique key for every level.

    const content = <Level fileName={this.props.fileName} key={key} levelData={worldData[this.state.activeLevelNumber]} 
        onDidCursorMove={(c) => {this.setState({cursor: c})}}/>;


    // statementIsSolved: () => { 
    //   if(itemData.status != "solved") {
    //     itemData.status = "solved";
    //     this.forceUpdate();
    //   }},
        
    const infoViewDiv = <InfoView file={this.props.fileName} cursor={this.state.cursor} isSolved={() => {}}/>;

    const levelDiv = (
      <Container style={{ height: '100%' }}>
        <Section>
          {sideBarDiv}
        </Section>
        <Bar size={10} className="Resizer vertical" />
        <Section minSize={200}>
          {content}
        </Section>
        <Bar size={10} className="Resizer vertical" />
        <Section minSize={200}>
          {infoViewDiv}
        </Section>
      </Container>
    );

    return (
      <div>
        {worldButtonsPanel}
        {levelButtonsPanel}
        <div style={{ position: 'fixed', top: '5em', bottom: '1em', left: '1em', right: '1em'}} > 
          {levelDiv}
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

