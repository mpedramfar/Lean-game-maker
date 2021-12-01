/// <reference types="monaco-editor" />
import { InfoRecord, LeanJsOpts, Message } from '@bryangingechen/lean-client-js-browser';
import * as React from 'react';
import { findDOMNode, render } from 'react-dom';
import { allMessages, checkInputCompletionChange, checkInputCompletionPosition, currentlyRunning, delayMs,
  registerLeanLanguage, server, tabHandler, editorDataInterface } from './langservice';
import { Container, Section, Bar } from 'react-simple-resizer';
import {
  Accordion,
  AccordionItem,
  AccordionItemHeading,
  AccordionItemButton,
  AccordionItemPanel,
} from 'react-accessible-accordion';
import ForceGraph2D from 'react-force-graph-2d';
import * as d3 from 'd3';

const seedrandom = require("seedrandom");

const showdown = require('showdown');
let markdownConverter = new showdown.Converter({
  openLinksInNewWindow: true,
  literalMidWordUnderscores: true,
});


let gameTexts: Array<Array<string>>;
const CurrentLanguageIndexContext = React.createContext(0);


function renderLaTeX(){
  let MathJax = require('MathJax');
  if(!MathJax){
    delete require.cache[require.resolve("MathJax")];
    MathJax = require("MathJax");
  }
  if(MathJax)
    MathJax.Hub.Queue(["Typeset",MathJax.Hub]);
}



interface LeanStatusProps {
  file: string;
  isReady: (val: boolean) => void;
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
    let cr = currentlyRunning.value.indexOf(nextProps.file) !== -1;
    this.props.isReady(! cr);
    this.setState({
      currentlyRunning: cr,
    });
  }


  render() {
    return this.state.currentlyRunning ? <div><p>Lean is busy ...</p></div> : <div></div>;
  }
}



function leanColorize(text: string): string {
  // TODO: use promises
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
}

interface Position {
  line: number;
  column: number;
}

interface GoalWidgetProps {
  goal: InfoRecord;
  position: Position;
}

function GoalWidget({goal, position}: GoalWidgetProps, solved: boolean) {
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

  const goalState = (solved && goal.state == "no goals") ? "Proof complete!" : goal.state;

  const goalStateHeader = goalState && <div className='info-header'>
    {position.line}:{position.column}: goal</div>;
  const goalStateBody = goalState && <div className='code-block'
    dangerouslySetInnerHTML={{__html: leanColorize(goalState) + '<br/>'}} />;

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
  world: number;
  level: number;
  isInfoMessage: (m: Message) => boolean;
}
interface InfoViewState {
  goal?: GoalWidgetProps;
  messages: Message[];
  solved?: boolean;
}
class InfoView extends React.Component<InfoViewProps, InfoViewState> {
  private subscriptions: monaco.IDisposable[] = [];
  private scheduleCheckIfSolved: boolean = false;
  private messageUpdateCounter: number = 0;

  constructor(props: InfoViewProps) {
    super(props);
    this.state = {
      messages: [],
      solved: false
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
  componentWillReceiveProps(nextProps: InfoViewProps) {
    if (this.props.world == nextProps.world && this.props.level == nextProps.level && nextProps.cursor === this.props.cursor) { return; }
    this.updateMessages(nextProps);
    this.refreshGoal(nextProps);
  }

  updateMessages(nextProps: InfoViewProps) {
    // comparing nextProps and this.props is not enough to see if the messages are up to date.
    // In the constructor of the Game, we added a line "#eval ..." at the end of every page.
    let msgs = allMessages.filter((v) => v.file_name === this.props.file);
    let infoIndex = msgs.findIndex(this.props.isInfoMessage);
    
    if(infoIndex == -1){ // moved to a new level but the messages haven't been updated
      this.messageUpdateCounter = 0;
      this.setState({ messages: [] });
    }else{
      this.messageUpdateCounter += 1;
      this.setState({
        messages: msgs.filter((v, i) => (i != infoIndex))
      });
    }
  }

  checkIfSolved(oldMessageUpdateCounter: number){
    if(this.scheduleCheckIfSolved && oldMessageUpdateCounter == this.messageUpdateCounter && oldMessageUpdateCounter > 0){
      if( this.state.messages.filter((v) => (v.severity =='error' || v.severity == 'warning')).length == 0 ){
        this.props.isSolved();
        this.setState({ solved : true });
      } else {
        this.setState({ solved : false });
      }
    }
    this.scheduleCheckIfSolved = false;
  }

  refreshGoal(nextProps?: InfoViewProps) {
    if (!nextProps) {
      nextProps = this.props;
    }
    if (!nextProps.cursor) {
      return;
    }

    const oldMessageUpdateCounter = this.messageUpdateCounter;
    const position = nextProps.cursor;
    server.info(nextProps.file, position.line, position.column).then((res) => {
      this.setState({goal: res.record && { goal: res.record, position }});
      setTimeout(this.checkIfSolved.bind(this, oldMessageUpdateCounter), 500)
    });
  }

  render() {
    const goal = this.state.goal &&
      (<div key={Date.now() + 'goal'}>{GoalWidget(this.state.goal, this.state.solved)}</div>);

    const goalDiv = (
      <div style={{overflowY: 'auto', width: '100%', height: '100%'}}>
        <div style={{ marginRight: '1ex', float: 'right' }}>
          <img src='./display-goal-light.svg' title='Goals' />
        </div>
        {goal}
      </div>
    );
    
    const msgs = this.state.messages.map((msg, i) =>
      (<div key={"" + Date.now() + i}>{MessageWidget({msg})}</div>));

    const msgsDiv = (
      <div style={{overflowY: 'auto', width: '100%', height: '100%', boxSizing: 'border-box', paddingTop: '1em'}}>
        <div style={{ marginRight: '1ex', float: 'right' }}>
          <img src='./display-list-light.svg' title='Messages' />
        </div>
        {msgs}
      </div>
    );

    return ( 
      <div className='no-mathjax info-view'>
        <LeanStatus file={this.props.file} isReady={(val) => {this.scheduleCheckIfSolved = val;}}/>
        <Container vertical={true} style={{ height: '100%' }}>
          <Section minSize={200}>
            {goalDiv}
          </Section>
          <Bar size={10} className='Resizer horizontal'/>
          <Section minSize={200}>
            {msgsDiv}
          </Section>
        </Container>
      </div>
    );

    
  }
}




// **********************************************************
interface ProvableObject { // theorem, lemma, definition or example
  type: string;
  text: string;
  lean: string;
  sideBar: boolean;
  textBefore: string;
  proof: string;
  textAfter: string;
  height: number;
  editorText: string;
  lineOffset: number;
  statement: string;
  name?: string;
}

interface NonProvableObject { // comment, tactic, axiom or lean
  type: boolean;
  content: string;
  name?: string;
  sideBar?: boolean;
  hidden?: boolean;
}

interface LevelData {
  name: string;
  objects: Array<ProvableObject|NonProvableObject>;
  problemIndex: number;
  isSolved?: boolean;
}

interface WorldData {
  name: string;
  levels: Array<LevelData>;
  parents?: Array<number>;
  lastVisitedLevel?: number;
  isSolved?: boolean;
}

interface GameData {
  name: string;
  version: string;
  languages: Array<string>;
  translated_name: string;
  devmode: boolean;
  library_zip_fn: string;
  introData: LevelData;
  worlds: Array<WorldData>;
  texts: Array<Array<string>>;
}
// **********************************************************






interface LeanEditorProps {
  fileName: string;
  editorText: string;
  lineOffset: number;
  textBefore: string;
  textAfter: string;
  readonly: boolean;
  height: number;
  onDidCursorMove: (p: Position) => void;
  updateEditorData: (data: Partial<editorDataInterface>) => void;
}
interface LeanEditorState {
//
}

class LeanEditor extends React.Component<LeanEditorProps, LeanEditorState> {
  model: monaco.editor.IModel;
  editor: monaco.editor.IStandaloneCodeEditor;

  constructor(props: LeanEditorProps) {
    super(props);
    this.state = {
      status: null,
    };

    this.props.updateEditorData({lineOffset: this.props.lineOffset});

    this.model = monaco.editor.getModel(monaco.Uri.file(this.props.fileName));
    if(! this.model){
      this.model = monaco.editor.createModel("", 'lean', monaco.Uri.file(this.props.fileName));
      this.model.updateOptions({ tabSize: 2 });
    }

    this.model.onDidChangeContent((e) => {
      this.props.updateEditorData({
        fileContent: this.props.textBefore + this.model.getValue() + this.props.textAfter,
        text: this.model.getValue(),
      });
      checkInputCompletionChange(e, this.editor, this.model);
    });

    this.model.setValue(this.props.editorText);
  }

  componentDidMount() {
    const node = findDOMNode(this.refs.monaco) as HTMLElement;
    const options: monaco.editor.IEditorConstructionOptions = {
      selectOnLineNumbers: true,
      roundedSelection: false,
      readOnly: this.props.readonly,
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
      this.props.onDidCursorMove({line: e.position.lineNumber + this.props.lineOffset, column: e.position.column - 1});
    });
    this.editor.addCommand(monaco.KeyCode.Tab, () => {
      tabHandler(this.editor, this.model);
    }, 'canTranslate');

    node.focus();
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


interface HintProps {
  title: string;
  content: string;
}
class Hint extends React.Component<HintProps, {}> {
  constructor(props: HintProps) {
    super(props);
  }
  render() {
    let tempDiv = document.createElement("div");
    tempDiv.innerHTML = markdownConverter.makeHtml(this.props.title);
    let markedTitle = tempDiv.children[0].innerHTML; // remove the <p></p> from the showdown output

    return (
      <div style={{fontSize: 'small', width: '100%' }}> 
        <Accordion allowZeroExpanded={true}>
          <AccordionItem>
            <AccordionItemHeading>
              <AccordionItemButton>
                <div style={{display: "inline-block"}} dangerouslySetInnerHTML={{__html: markedTitle}}></div>
              </AccordionItemButton>
            </AccordionItemHeading>
            <AccordionItemPanel>
              <div dangerouslySetInnerHTML={{__html: markdownConverter.makeHtml(this.props.content)}}></div>
            </AccordionItemPanel>
          </AccordionItem>
        </Accordion>
      </div>);
  }
}



interface ProvableProps extends ProvableObject {
  fileName: string;
  isActive: boolean;
  onDidCursorMove: (Position) => void;
  updateEditorData: (data: Partial<editorDataInterface>) => void;
  getCurrentEditorText: () => string;
}
class Provable extends React.Component<ProvableProps, {}> {

  constructor(props: ProvableProps) {
    super(props);
  }

  render() {
    const getGameText = (i) => gameTexts[this.context][i];
    
    let proof, copyButton;
    if( this.props.isActive ){
      proof = <LeanEditor {...this.props} readonly={this.props.type=="example"} />;
      copyButton = <button style={{ border: "none", background: "transparent" }} onClick={()=>{
        navigator.clipboard.writeText(this.props.lean + "begin\n" + this.props.getCurrentEditorText() + "\nend");
      }} title="Copy to clipboard" >&#x1f4cb;</button>;
    } else {
      proof = <LeanColorize text={getGameText(this.props.editorText)}/>;
    }

    const title = (this.props.type == "lemma") ? "Lemma" :
        ((this.props.type == "theorem") ? "Theorem" :
        ((this.props.type == "definition") ? "Definition" : "Example"));

    return <div className="problem_wrapper">
        <span className="problem_label" >{title}</span>
        <div className="problem_content">
	        <div className="problem_text">
	          <Text content={getGameText(this.props.text)}/>
    	    </div>
      	  <div className="problem_lean">
	          <LeanColorize text={this.props.lean} />
    	    </div>
        </div>
        {(this.props.type == "definition") ? null :
        <div style={{ marginTop:"0.5em" }}>
          <span style={{ fontStyle:"italic" }}>Proof :</span>
        </div>
        }
        <div className="problem_proof" >
          <div style={{ display: "flex", justifyContent: "space-between", width: "calc(100% - 2em)"}}>
            <LeanColorize text="begin"/>
            {copyButton}
          </div>
          {proof}
          <LeanColorize text="end"/>
        </div>
      </div>;

  }
}
Provable.contextType = CurrentLanguageIndexContext;



interface LevelProps {
  fileName: string;
  levelData: LevelData;
  onDidCursorMove: (Position) => void;
  updateEditorData: (data: Partial<editorDataInterface>) => void;
  getCurrentEditorText: () => string;
}
interface LevelState {
  //
}
class Level extends React.Component<LevelProps, LevelState> {

  constructor(props: LevelProps) {
    super(props);
  }

  componentDidMount(){
    renderLaTeX();
  }

  render() {
    const getGameText = (i) => gameTexts[this.context][i];

    const content = this.props.levelData.objects.map( (itemData, i) => {
      if( itemData.type == "text" )
      {
        return <Text  key={i} content={getGameText((itemData as any).content)}  />;
      } 
      else if( itemData.type == "hint" )
      {
        return <Hint key={i} title={getGameText((itemData as any).title)}  content={getGameText((itemData as any).content)}  />;
      } 
      else if( itemData.type == "lean" && (! (itemData as any).hidden))
      {
        return <LeanColorize key={i} text={getGameText((itemData as any).content)}/>
      }
      else if( itemData.type == "lemma" || itemData.type == "theorem" || itemData.type == "definition" || itemData.type == "example")
      {
        return <Provable key={i}
                      fileName={this.props.fileName}
                      isActive={this.props.levelData.problemIndex == i} 
                      onDidCursorMove={this.props.onDidCursorMove}
                      updateEditorData={this.props.updateEditorData}
                      getCurrentEditorText={this.props.getCurrentEditorText}
                      {...itemData}
                      />;
      };
    });

    return <div className="level_content">{content}</div>;
  }
}
Level.contextType = CurrentLanguageIndexContext;


interface SideBarProps {
  worlds: Array<WorldData>;
  world: number;
  level: number;
}
interface SideBarState {
}
class SideBar extends React.Component<SideBarProps, SideBarState> {
  sideBarData : ({ 
            'tactics' : NonProvableObject[], 
            'sortedStatements' : (ProvableObject|NonProvableObject)[][], // first dimension is the world number
            'examples' : ProvableObject[] 
          })[][];

  constructor(props: SideBarProps) {
    super(props);


    let getSidebarContentsInLevel = (w: number, l: number) => { // Stuff within this level that should be put in the side bar
      let levelObjects = this.props.worlds[w].levels[l].objects;
      let tactics = [], nonAxiomStatements = [], examples = [], axioms = [];

      for(let i = 0; i < levelObjects.length; i++){
        if(levelObjects[i].sideBar == true){
          if(levelObjects[i].type == "tactic"){
            tactics.push(levelObjects[i]);
          } else if(levelObjects[i].type == "example"){
            examples.push(levelObjects[i]);
          } else if(levelObjects[i].type == "lemma" 
                      || levelObjects[i].type == "theorem"){
            nonAxiomStatements.push(levelObjects[i]);
          } else if(levelObjects[i].type == "axiom"){
            axioms.push(levelObjects[i]);
          }
        }
      }
      return {
          'tactics' : tactics,
          'nonAxiomStatements' : nonAxiomStatements,
          'examples' :  examples,
          'axioms' : axioms
      };
    }

    let getSidebarContentsInWorld = (w: number) => { // Stuff within this world that should be put in the side bar
      let output = {
        'tactics' : [],
        'statements' : [],
        'examples' :  [],
      };

      for(let l = 0; l < this.props.worlds[w].levels.length; l++){
        let curLevelData = getSidebarContentsInLevel(w, l);
        output.tactics.push(...curLevelData.tactics);
        output.examples.push(...curLevelData.examples);
        output.statements.push(...curLevelData.axioms);
        output.statements.push(...curLevelData.nonAxiomStatements);
      }
      return output;
    }

    let isParentOf = (w1: number, w2: number) => { // Is w1 a parent (direct or indirect) of w2 ?
      let world2 = this.props.worlds[w2];
      if(!world2.parents) return false;
      for(let i = 0; i < world2.parents.length; i++){
        if(w1 == world2.parents[i] || isParentOf(w1, world2.parents[i]))
          return true;
      }
      return false;
    }


    this.sideBarData = new Array(this.props.worlds.length).fill([]);
    let worldSidebarData = this.props.worlds.map((w, i) => getSidebarContentsInWorld(i));
    for(let w = 0; w < this.props.worlds.length; w++){
      let worldData = this.props.worlds[w];
      this.sideBarData[w] = new Array(worldData.levels.length).fill([]);

      // Level 0 :
      let tactics = [], sortedStatements = new Array(this.props.worlds.length).fill([]), examples = [];
      for(let w1 = 0; w1 < this.props.worlds.length; w1++){
        if(isParentOf(w1, w)){
          tactics.push(...worldSidebarData[w1].tactics);
          examples.push(...worldSidebarData[w1].examples);
          sortedStatements[w1] = worldSidebarData[w1].statements;
        }
      }

      let curLevelData = getSidebarContentsInLevel(w, 0), prevLevelData;
      tactics.push(...curLevelData.tactics);
      sortedStatements[w] = curLevelData.axioms;
      this.sideBarData[w][0] = {
        'tactics' : tactics,
        'sortedStatements' : sortedStatements,
        'examples' : examples,
      };

      // The rest of the levels :
      for(let l = 1; l < worldData.levels.length; l++){
        prevLevelData = curLevelData;
        curLevelData = getSidebarContentsInLevel(w, l);

        let sortedStatements = new Array(this.props.worlds.length).fill([]);
        for(let w1 = 0; w1 < this.props.worlds.length; w1++){
          if(w1 != w){
            sortedStatements[w1] = this.sideBarData[w][l-1].sortedStatements[w1];
          }else{
            sortedStatements[w] = this.sideBarData[w][l-1].sortedStatements[w].concat(prevLevelData.nonAxiomStatements, curLevelData.axioms);
          }
        }

        this.sideBarData[w][l] = {
            'tactics' : this.sideBarData[w][l-1].tactics.concat(curLevelData.tactics),
            'sortedStatements' : sortedStatements,
            'examples' :  this.sideBarData[w][l-1].examples.concat(prevLevelData.examples),
        };
      }
    }
    
  }


  render(){
    const getGameText = (i) => gameTexts[this.context][i];

    const sideBarAccordion = (label, list) => {
      if(list.length == 0)
        return;
      let tempDiv = document.createElement("div");
      tempDiv.innerHTML = markdownConverter.makeHtml(label);
      let markedLabel = tempDiv.children[0].innerHTML; // remove the <p></p> from the showdown output
      return (
        <AccordionItem key={label}>
          <AccordionItemHeading>
            <AccordionItemButton>
              <div style={{display: "inline-block"}} dangerouslySetInnerHTML={{__html: markedLabel}}></div>
            </AccordionItemButton>
          </AccordionItemHeading>
          <AccordionItemPanel>{list}</AccordionItemPanel>
        </AccordionItem>
      );
    };

    let data = {
      'tactics' : [],
      'sortedStatements' : [],
      'examples' : []
    };
    data = this.sideBarData[this.props.world][this.props.level];


    const tacticsAccordion = sideBarAccordion("Tactics", data.tactics.map((s, i) => {
      return sideBarAccordion(s.name, [<Text key={"tactic,text,"+i} content={getGameText(s.content)} />]);
    }));

    const examplesAccordion = sideBarAccordion("Examples", data.examples.map((s, i) => {
      return (
        <div>
          <LeanColorize key={"example,statement,"+i} text={s.lean} />
          <LeanColorize key={"example,proof,"+i} text={"begin\n" + getGameText(s.proof) + "\nend"} />
          <hr/>
        </div>);
    }));

    const statementsAccordion = data.sortedStatements.some((v) => v.length) ? sideBarAccordion("Theorem statements", data.sortedStatements.map((statements, w) => {
      if(!statements) return [];
      let label = getGameText(this.props.worlds[w].name);
      return sideBarAccordion(label, statements.map((s, i) =>{
        let e = "  " + ((s.type == "axiom") ? getGameText((s as any).content) : (s as any).statement);
        return (
          <div>
            <LeanColorize key={s.type+",name,"+i} text={s.name} />
            <LeanColorize key={s.type+",statement,"+i} text={e} />
            <hr/>
          </div>
        );
      }));
    })) : null;

    if(!tacticsAccordion && !statementsAccordion && !examplesAccordion)
      return null;

    return (
      <div style={{fontSize: "small", overflowY: "auto", height: "100%", overflowX: "hidden"}}>
        <Accordion allowMultipleExpanded={true} allowZeroExpanded={true}>
          {tacticsAccordion}
          {statementsAccordion}
          {examplesAccordion}
        </Accordion>
      </div>
    );
    
  }
}
SideBar.contextType = CurrentLanguageIndexContext;


function getGraphData(worlds : Array<WorldData>){

  let x : Array<number> = new Array(worlds.length).fill(0);
  let y : Array<number> = new Array(worlds.length).fill(0);
  let worldsWithY = [];
  for(let i = 0; i < worlds.length; i++){
    let p = worlds[i].parents;
    if(p){
      for(let j = 0; j < p.length; j++){
        y[i] = y[i] > y[p[j]] + 1 ? y[i] : y[p[j]] + 1;
      }
    }
    if(worldsWithY.length <= y[i]){
      worldsWithY.push([]);
    }
    x[i] = worldsWithY[y[i]].length;
    worldsWithY[y[i]].push(i);
  }

  let find_perm = (a : Array<number>, cost : (a_k:number, k:number) => number ) => { 
    // return the permutation where the cost is minumum
    // cost of [a_0, a_1, a_2, ..., a_{n-1}] = cost(a_0, 0) + cost(a_1, 1) + ... + cost(a_{n-1}, n-1)
    let swap = (a : Array<number>, i : number, j : number) => {
      let t = a[i]; a[i] = a[j]; a[j] = t;
    }
    let permute = (a : Array<number>, n : number) => { // only look at a[0], a[1], ..., a[n-1]
      if(n == 1){
        return [ [a[0]] , cost(a[0], 0)];
      }
      let output = [null, null]; // = [output_array, output_cost]
      for (let i = 0; i < n; i++) {
        swap(a, i, n-1);
        let temp = permute(a, n-1);
        temp[1] += cost(a[n-1], n-1);
        if(!output[1] || output[1] > temp[1]){
          output = [ temp[0].push(a[n-1]), temp[1] ];
        }
        swap(a, i, n-1);
      }
      return output;
    }
    return permute(a, a.length)[0];
  }

  for(let i = 0; i < worlds.length + 1; i++){
    if(!worldsWithY[i]) break;
    let cost = (w, j) => { // keep the x value of worlds[w] close to its parents
      if(!worlds[w].parents) return 0;
      let c = 0;
      for(let p = 0; p < worlds[w].parents.length; p++){
        c += Math.abs(j - x[worlds[w].parents[p]]);
      }
      return c;
    }
    let temp = find_perm(worldsWithY[i], cost);
    for(let j = 0; j < temp.length; j++){
      x[temp[j]] = j;
    }
  }

  x = x.map((t) => t * 60);
  y = y.map((t) => t * 80);

  return {
    nodes : worlds.map((w, i) => ({id : i, x : x[i], y : y[i], worldData : w})),
    links : [].concat(... worlds.map((w, i) =>{
      if(!w.parents) return [];
      return w.parents.map((p)=>({source : p, target : i}));
    })),
    deltaX : Math.max(...x) + 2*60,
    deltaY : Math.max(...y) + 2*80
  };
}


interface GraphProps {
  graphData: any;
  worlds: Array<WorldData>;
  solvedWorlds: Array<number>;
  world: number;
  width: number;
  height: number;
  gotoWorld: (w) => void;
  darkMode: boolean;
}

interface GraphState{
  highlightWorld: number;
}
class Graph extends React.Component<GraphProps, GraphState> {
  graphRef: any;
  scale: number = 1.0;

  constructor(props: GraphProps) {
    super(props);
    this.state = {
      highlightWorld: -1
    };
    this.graphRef = React.createRef();
  }

  handleNodeHover(node){
    if(node && this.state.highlightWorld != node.id)
      this.setState({highlightWorld : node.id});
  }

  paintNode(node, ctx, globalScale, node_R, fontSize){

    if(node.id == this.state.highlightWorld){  // add ring just for highlighted nodes
      ctx.beginPath();
      ctx.arc(node.x, node.y, node_R * 1.4, 0, 2 * Math.PI, false);
      ctx.fillStyle = 'red';
      ctx.fill();
    }

    // draw the node
    ctx.beginPath(); 
    ctx.arc(node.x, node.y, node_R, 0, 2 * Math.PI, false);
    if(this.props.solvedWorlds.indexOf(node.id) != -1){
      ctx.fillStyle = 'green';
    }else{
      let reachableWorlds = [];
      for(let j = 0; j < this.props.worlds.length; j++){
        if(!this.props.worlds[j].parents){
          reachableWorlds.push(j);
        }else if(this.props.worlds[j].parents.every((p) => this.props.solvedWorlds.indexOf(p) != -1) &&
              this.props.worlds[j].parents.every((p) => reachableWorlds.indexOf(p) != -1)){
          reachableWorlds.push(j);
        }
      }
      ctx.fillStyle = reachableWorlds.indexOf(node.id) != -1 ? 'blue' : 'gray';
    }
    ctx.fill();  

    // write the world name
    const label = gameTexts[this.context][node.worldData.name];
    const scaledFontSize = fontSize/globalScale;
    ctx.font = `${scaledFontSize}px Sans-Serif`;
    const textWidth = ctx.measureText(label).width;
    const bckgDimensions = [textWidth, scaledFontSize].map(n => n + scaledFontSize * 0.2); // some padding
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
    ctx.fillRect(node.x - bckgDimensions[0] / 2, node.y - bckgDimensions[1] - node_R * 1.5, ...bckgDimensions);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = getComputedStyle(document.body).color;
    ctx.fillText(label, node.x, node.y - bckgDimensions[1]/2 - node_R * 1.5);
  };

  componentDidMount(){
    let collideValue = 30 * this.scale;
    let linkDistance = 50 * this.scale;
    let chargeStrength = -40 * this.scale;

    const fg = this.graphRef.current;
    if(this.props.world != -1){
      fg.d3Force('collide', null);
      fg.d3Force("link", null)
      fg.d3Force("charge", null)  
    }else{
      fg.d3Force('collide', d3.forceCollide(collideValue));
      fg.d3Force("link", d3.forceLink().id(function (d) { return d.id; }).distance(linkDistance).strength(1));
      fg.d3Force("charge", d3.forceManyBody().strength(chargeStrength));
    }
  }

  render(){
    this.scale = 0.5 * Math.min( this.props.width/this.props.graphData.deltaX, this.props.height/this.props.graphData.deltaY );

    let node_R = 10 * this.scale;
    let dagLevelDistance = 80 * this.scale;
    let fontSize = 12 * this.scale;

    return <ForceGraph2D
      ref={this.graphRef}
      width={this.props.width}
      height={this.props.height}
      graphData={this.props.graphData}
      nodeRelSize={node_R}
      linkWidth={5}
      linkColor={this.props.darkMode ? () => 'rgb(100, 100, 100)' : 'color'}
      linkDirectionalParticles={0}
      linkDirectionalArrowLength={10}
      linkDirectionalArrowColor={this.props.darkMode ? () => getComputedStyle(document.body).color : 'color'}
      nodeCanvasObject={(node, ctx, globalScale) => {this.paintNode.call(this, node, ctx, globalScale, node_R, fontSize)}}
      onNodeHover={this.handleNodeHover.bind(this)}
      onNodeClick={(node) => {this.props.gotoWorld(node.id)}}
      nodeLabel={(node) => {
        return markdownConverter.makeHtml(gameTexts[this.context][this.props.worlds[node.id].name]);
      }}
      enableNodeDrag={false}
      enableZoomPanInteraction={false}
      dagMode="td"
      dagLevelDistance={dagLevelDistance}
    />;
  };
  
}
Graph.contextType = CurrentLanguageIndexContext;


interface LanguageMenuProps {
  languages: Array<string>;
  currentLanguageIndex: number;
  updateLanguageIndex: (i: number)=>void;
}
interface LanguageMenuState {
  value: number;
}

class LanguageMenu extends React.Component<LanguageMenuProps, LanguageMenuState> {
  constructor(props) {
    super(props);
    this.state = {value: this.props.currentLanguageIndex};
    this.handleChange = this.handleChange.bind(this);
  }

  handleChange(event) {
    this.props.updateLanguageIndex(Number(event.target.value));
    this.setState({value: event.target.value});
  }

  render() {
    if(this.props.languages.length == 1)
      return null;
    return (
      <select value={this.state.value} onChange={this.handleChange}
        style={{ float: 'right', width: '8%', height:'100%' }} className='language-menu'>
        {this.props.languages.map((lang, i) => (
          <option value={i}>{lang.toUpperCase()}</option>
        ))}
      </select>
    );
  }
}




interface GameProps {
  fileName: string;
  languages: Array<string>;
  currentLanguageIndex: number;
  worlds: Array<WorldData>;
  introData: LevelData;
  world: number;
  level: number;
  updateLanguageIndex: (i: number)=>void;
  saveGame: ()=>void;
  resetGame: ()=>void;
  updateURL: (world: number, level: number)=>void;
  updateEditorData: (data: Partial<editorDataInterface>) => void;
  isInfoMessage: (m: Message) => boolean;
  getCurrentEditorText: () => string;
  darkMode: boolean;
  updateDarkMode: (mode: boolean) => void;
}
interface GameState {
  currentLanguageIndex: number;
  world: number;
  level: number;
  cursor?: Position;
  solvedWorlds: Array<number>;
  darkMode: boolean;
}
class Game extends React.Component<GameProps, GameState> {
  graphData: any;

  constructor(props: GameProps) {
    super(props);

    let solvedWorlds = [];
    this.props.worlds.forEach((worldData, w)=>{
      if(worldData.isSolved)
        solvedWorlds = solvedWorlds.concat([w]);
    })

    this.state = {
      currentLanguageIndex: this.props.currentLanguageIndex,
      world: this.props.world,
      level: this.props.level,
      solvedWorlds: solvedWorlds,
      darkMode: this.props.darkMode
    };

    if(!this.graphData)
      this.graphData = getGraphData(this.props.worlds);
  }

  goto(world: number, level: number){
    this.props.saveGame();
    
    this.setState({ world: world, level: level });
    if(world != -1)
      this.props.worlds[world].lastVisitedLevel = level;

    this.props.updateURL(world, level);
  }

  gotoWorld(w: number){
    let l = 0;
    if((w != -1) && this.props.worlds[w].lastVisitedLevel){
      l = this.props.worlds[w].lastVisitedLevel;
    }
    this.goto(w, l);  
  }

  gotoLevel(l: number){
    this.goto(this.state.world, l);
  }

  windowResize(){
    this.forceUpdate();
  }

  componentDidMount() {
    window.addEventListener('resize', this.windowResize.bind(this));
  }
  
  componentWillUnmount() {
    window.removeEventListener('resize', this.windowResize.bind(this));
  }

  render() {
    
    
    const resetButton = <button className='ridge-button'
      style={{ 
        float: 'right', height:'100%', fontSize: 'large',
        width: (this.props.languages.length > 1 ? '6%' : '10%')
      }}
      onClick={this.props.resetGame} title={"Reset game"}
      dangerouslySetInnerHTML={{__html: "&#8634;"}}></button>;
    
    const brighnessButton = <button className='ridge-button'
      style={{ 
        float: 'right', height:'100%', fontSize: 'large',
        width: (this.props.languages.length > 1 ? '6%' : '10%')
      }}
      onClick={() => {
        this.props.updateDarkMode(!this.state.darkMode);
        this.setState({darkMode: !this.state.darkMode});
      }} title={this.state.darkMode ? "Day mode" : "Night mode"} 
      dangerouslySetInnerHTML={{__html: this.state.darkMode ? "&#x1f506;" : "&#x1f505;"}}></button>;
    
    const languageMenu = <LanguageMenu languages={this.props.languages} currentLanguageIndex={this.state.currentLanguageIndex}
      updateLanguageIndex={(i: number)=>{
        this.props.updateLanguageIndex(i);
        this.setState({currentLanguageIndex: i});
      }}/>;

    if(this.state.world == -1){

      const buttonsPanel = (
        <div className="first-button-panel">
          {resetButton}
          {brighnessButton}
          {languageMenu}
        </div>
      );  

      const content = <Level fileName={this.props.fileName} key={"intro"} levelData={this.props.introData} 
          onDidCursorMove={(c) => {}} updateEditorData={this.props.updateEditorData} 
          getCurrentEditorText={this.props.getCurrentEditorText} />;

      const graphDiv = <Graph graphData={this.graphData} worlds={this.props.worlds} world={this.state.world} 
                            solvedWorlds={this.state.solvedWorlds} gotoWorld={this.gotoWorld.bind(this)} 
                            width={window.innerWidth*0.4} height={window.innerHeight} darkMode={this.state.darkMode}/>;

      return (
        <CurrentLanguageIndexContext.Provider value={this.state.currentLanguageIndex}>
        <div style={{ position: 'fixed', top: '0', bottom: '0', left: '0', right: '0'}}>
          <Container style={{ height: '100%' }}>
          <Section defaultSize={window.innerWidth*0.6}>
            {content}
          </Section>
          <Bar size={5} hidden={true}/>
          <Section defaultSize={window.innerWidth*0.4}>
            <div style={{
              width: '100%', height: '100%', boxSizing: 'border-box',
              borderStyle: 'double'}}>
                {graphDiv}
            </div>
          </Section>
          </Container>
          {buttonsPanel}
        </div>
        </CurrentLanguageIndexContext.Provider>
      );
    }

    const worldData = this.props.worlds[this.state.world];
    const levelData = worldData.levels[this.state.level];
    const problemKey = "" + (this.state.world+1) + "," + (this.state.level+1);

    const getGameText = (i) => gameTexts[this.state.currentLanguageIndex][i];

    const worldLabel = (
      <div style={{ textAlign: 'center' }}>
        <h3>
          <Text content={
            (worldData.isSolved ? "&#10004; " : "") +
            getGameText(worldData.name)}/>
        </h3>
      </div>
    );
    const worldButtonsPanel = (
      <div key={this.state.world} className="first-button-panel">
        <button className='ridge-button' style={{ float: 'left', width: '20%', height:'100%' }}
          onClick= {() => { this.gotoWorld.call(this, -1); }}> Main Menu </button>
        {resetButton}
        {brighnessButton}
        {languageMenu}
        {worldLabel}
      </div>
    );


    const levelLabel = (
      <div style={{ textAlign: 'center' }}>
        <h4>
          <Text content={
            (levelData.isSolved ? "&#10004; " : "") +
            "Level " + (this.state.level + 1) + "/" + worldData.levels.length + 
            (levelData.name ? " -- " + getGameText(levelData.name) : "")
          }/>
        </h4>
      </div>
    );
    const levelButtonsPanel = (
      <div key={problemKey} className="second-button-panel">
        <button className='ridge-button' disabled={ this.state.level == 0 } 
          style={{ float: 'left', width: '20%', height:'100%' }}
          onClick={() => { this.gotoLevel.call(this, this.state.level - 1); }}> Previous Level </button>
        <button className='ridge-button' disabled={ this.state.level == worldData.levels.length - 1 } 
          style={{ float: 'right', width: '20%', height: '100%' }}
          onClick={() => { this.gotoLevel.call(this, this.state.level + 1); }}> Next Level </button>
        {levelLabel}
      </div>
    );


    const sideBarDiv = <SideBar worlds={this.props.worlds} world={this.state.world} level={this.state.level} ></SideBar>;

    const content = <Level fileName={this.props.fileName} key={problemKey} levelData={levelData} 
      onDidCursorMove={(c) => {this.setState({cursor: c})}} updateEditorData={this.props.updateEditorData} 
      getCurrentEditorText={this.props.getCurrentEditorText} />;


    let statementIsSolved = () => {
      if(levelData.isSolved) // already solved
        return;
      levelData.isSolved = true;
      worldData.isSolved = this.props.worlds[this.state.world].levels.every((levelData)=> levelData.isSolved);
      let solvedWorlds = worldData.isSolved ? this.state.solvedWorlds.concat([this.state.world]) : this.state.solvedWorlds;
      this.setState({solvedWorlds : solvedWorlds});
      return;
    };
        
    const infoViewDiv = <InfoView file={this.props.fileName} cursor={this.state.cursor}
                            world={this.state.world} level={this.state.level} isSolved={statementIsSolved}
                            isInfoMessage={this.props.isInfoMessage} />;

    const mainDiv = (
      <Container style={{ height: '100%' }}>
        <Section defaultSize={sideBarDiv ? window.innerWidth*0.15 : 0}>
          {sideBarDiv}
        </Section>
        <Bar size={10} className='Resizer vertical' />
        <Section minSize={200} defaultSize={sideBarDiv ? window.innerWidth*0.5 : window.innerWidth*0.65}>
          {content}
        </Section>
        <Bar size={10} className='Resizer vertical' />
        <Section minSize={200}>
          {infoViewDiv}
        </Section>
      </Container>
      );

    return (
      <CurrentLanguageIndexContext.Provider value={this.state.currentLanguageIndex}>
      <div>
        {worldButtonsPanel}
        {levelButtonsPanel}
        <div className="main-wrapper"> 
          {mainDiv}
        </div>
      </div>
      </CurrentLanguageIndexContext.Provider>
    );  
  }
}
Game.contextType = CurrentLanguageIndexContext;




// -----------------------------------

class PageManager {

  static gameData: GameData;
  static currentLanguageIndex: number;
  static world: number;
  static level: number;
  static isSaved: boolean;
  static savedGameLocalStorageKey: string;

  static darkMode: boolean;

  static activeEditorData: editorDataInterface = { 
    lineOffset: 0,
    fileContent: "",
    text: "",
  };
    
  static updateEditorData(data: Partial<editorDataInterface>){
    if(data.lineOffset)
      this.activeEditorData.lineOffset = data.lineOffset;
    if(data.fileContent){
      this.activeEditorData.fileContent = data.fileContent;
      this.activeEditorData.text = data.text;
      this.isSaved = false;
    }
  }

  static updateURL(world: number, level: number){
    let u = new URL(window.location.href);
    if(world == -1){
      u.search = "";
    }else{
      u.searchParams.set('world', String(world + 1));
      u.searchParams.set('level', String(level + 1));
    }
    this.world = world;
    this.level = level;
    history.replaceState(null, null, u.href);
  }
  

  static readURL(){
    let world = -1, level = 0;

    let u = new URL(window.location.href);
    if(u.searchParams.has('world')){
      let w = Number(u.searchParams.get('world'));
      if(!isNaN(w) && w >= 1 && w <= this.gameData.worlds.length){
        world = w - 1;
        if(u.searchParams.has('level')){
          let l = Number(u.searchParams.get('level'));
          if(!isNaN(l) && l >= 1 && l <= this.gameData.worlds[w-1].levels.length){
            level = l - 1;
          }
        }
      }
    }
    this.updateURL(world, level);
  }

  
  static resetGame(){
    let confirmationMessage = 'The game will reset and the progress will be lost.';
    if(window.confirm(confirmationMessage)){
      localStorage.removeItem(this.savedGameLocalStorageKey);
      this.isSaved = true;
      this.updateURL(-1, 0);
      location.reload();
    }
  }

  static updateDarkMode(mode: boolean){
    this.darkMode = mode;
    let root = document.documentElement;
    if(this.darkMode){
      root.style.setProperty('--bg-color', 'var(--dark-mode-bg-color)');
      root.style.setProperty('--color', 'var(--dark-mode-color)');
      root.style.setProperty('--resizer-bg-color', 'var(--dark-mode-resizer-bg-color)');
      root.style.setProperty('--a-color', 'var(--dark-mode-a-color)');

      monaco.editor.setTheme('vs-dark');
    } else {
      root.style.removeProperty('--bg-color');
      root.style.removeProperty('--color');
      root.style.removeProperty('--resizer-bg-color');
      root.style.removeProperty('--a-color');

      monaco.editor.setTheme('vs');
    }    
    localStorage.setItem('darkMode', JSON.stringify(this.darkMode));
  }
  
  static saveGame(){
    if(this.isSaved)
      return
    
    if(this.world != -1){
      let levelData = this.gameData.worlds[this.world].levels[this.level]
      if(levelData.problemIndex != -1){
        let problemData = levelData.objects[levelData.problemIndex] as ProvableObject;
        problemData.editorText = this.activeEditorData.text;
      }
    }

    let savedGameData = {
      name: this.gameData.name, 
      version: this.gameData.version, 
      language: this.gameData.languages[this.currentLanguageIndex],
      data: []
    };
    for(let w = 0; w < this.gameData.worlds.length; w++){
      let worldData = this.gameData.worlds[w];
      for(let l = 0; l < worldData.levels.length; l++){
        let levelData = worldData.levels[l];
        if(levelData.problemIndex != -1){
          let problemData = levelData.objects[levelData.problemIndex] as ProvableObject;
          savedGameData.data.push({lean: problemData.lean, isSolved: levelData.isSolved, editorText: problemData.editorText});
        }
      }  
    }

    localStorage.setItem(this.savedGameLocalStorageKey, JSON.stringify(savedGameData));
    this.isSaved = true;
  }


  static loadGame(blankGameData: GameData){

    this.savedGameLocalStorageKey = blankGameData.name + '-' + blankGameData.version.split('.')[0] + '-savedGameData';

    let savedGameData = JSON.parse(localStorage.getItem(this.savedGameLocalStorageKey));

    //--- TODO: This should be removed in a future update.
    // This is included for backward compatibility.
    // In previous versions, the entire "gameData" was saved in the localStrorage.
    let oldStyleSavedGameData = JSON.parse(localStorage.getItem('game_data'));
    if(oldStyleSavedGameData && oldStyleSavedGameData.name == blankGameData.name
          && blankGameData.version.split('.')[0] == oldStyleSavedGameData.version.split('.')[0]){
      savedGameData = {name: oldStyleSavedGameData.name, version: oldStyleSavedGameData.version, data: []};
      for(let w = 0; w < oldStyleSavedGameData.worlds.length; w++){
        let worldData = oldStyleSavedGameData.worlds[w];
        for(let l = 0; l < worldData.levels.length; l++){
          let levelData = worldData.levels[l];
          if(!isNaN(levelData.activeIndex) && levelData.activeIndex != -1){
            let problemData = levelData.objects[levelData.activeIndex] as ProvableObject;
            let t = problemData.editorText == "  sorry" ? "sorry" : problemData.editorText;
            savedGameData.data.push({lean: problemData.lean, isSolved: levelData.isSolved, editorText: t});
          }
        }
      }
      localStorage.removeItem('game_data');
    }
    //---
    
    this.currentLanguageIndex = 0;
    this.isSaved = true;

    if(savedGameData){
      for(let w = 0; w < blankGameData.worlds.length; w++){
        let worldData = blankGameData.worlds[w];
        for(let l = 0; l < worldData.levels.length; l++){
          let levelData = worldData.levels[l];
          if(levelData.problemIndex != -1){
            let problemData = levelData.objects[levelData.problemIndex] as ProvableObject;
            let savedProblemData = savedGameData.data.find((d) => d.lean == problemData.lean);
            if(savedProblemData){
              levelData.isSolved = savedProblemData.isSolved;
              problemData.editorText = savedProblemData.editorText;
            }
          }
        }
        worldData.isSolved = worldData.levels.every((levelData)=> levelData.isSolved );
      }
      this.currentLanguageIndex = blankGameData.languages.findIndex((l) => l==savedGameData.language);
      if(this.currentLanguageIndex == -1){
        this.currentLanguageIndex = 0;
      }
    }


    this.gameData = blankGameData;
    gameTexts = this.gameData.texts;

    document.title = gameTexts[this.currentLanguageIndex][this.gameData.translated_name];

    this.readURL();

    this.updateDarkMode(Boolean(JSON.parse(localStorage.getItem('darkMode'))));

    // The following is used in InfoView to accurately say when a problem is solved.
    this.gameData.worlds.forEach((worldData, w)=>{
      worldData.levels.forEach((levelData, l)=>{
        if(levelData.problemIndex != -1){
          let problemData = levelData.objects[levelData.problemIndex] as ProvableObject;
          problemData.textAfter += '\n\n#eval "' + (w+1) + "," + (l+1) + '"'; 
        }
      })
    })
    return { isInfoMessage : (m: Message) => 
      (m.severity == "information" 
      && m.caption == "eval result"
      && m.pos_line == this.activeEditorData.fileContent.split(/\r\n|\r|\n/).length
      && m.text == '"' + (this.world+1) + "," + (this.level+1) + '"') };
  }

  static updateLanguageIndex(index: number){
    if(this.currentLanguageIndex != index){
      this.isSaved = false;
      document.title = gameTexts[index][this.gameData.translated_name];
      this.currentLanguageIndex = index;
      setTimeout(renderLaTeX, 500);
    }
  }

  static run(){

    seedrandom('0', { global: true }); // makes the behaviour of the graph predictable

    window.addEventListener("beforeunload", this.saveGame.bind(this));
  
    fetch('game_data.json', {cache: "no-store"})
      .then((res)=> res.json())
      .then((blankGameData)=>{

        const isInfoMessage = this.loadGame(blankGameData as GameData).isInfoMessage;

        let dbName = this.gameData.library_zip_fn.slice(0, -4);
        
        let loadLibraryAndRender = () => {
          // tslint:disable-next-line:no-var-requires
          (window as any).require(['vs/editor/editor.main'], () => {
  
            const leanJsOpts: LeanJsOpts = {
              javascript: './lean_js_js.js',
              libraryZip: './' + this.gameData.library_zip_fn,
              webassemblyJs: './lean_js_wasm.js',
              webassemblyWasm: './lean_js_wasm.wasm',
              dbName: dbName
            };
            
            registerLeanLanguage(leanJsOpts, this.activeEditorData, isInfoMessage);
  
            const fn = monaco.Uri.file( this.gameData.library_zip_fn.slice(0, -3) + 'lean').fsPath;

            render(
                <Game fileName={fn} worlds={this.gameData.worlds} 
                        introData={this.gameData.introData} world={this.world} level={this.level}
                        languages={this.gameData.languages} currentLanguageIndex={this.currentLanguageIndex}
                        updateLanguageIndex={this.updateLanguageIndex.bind(this)}
                        saveGame={this.saveGame.bind(this)} resetGame={this.resetGame.bind(this)}
                        updateURL={this.updateURL.bind(this)} updateEditorData={this.updateEditorData.bind(this)}
                        isInfoMessage={isInfoMessage} getCurrentEditorText={() => this.activeEditorData.text}
                        darkMode={this.darkMode} updateDarkMode={this.updateDarkMode.bind(this)}/>,
                document.getElementById('root'),
            );
          });
        }
  
        if(this.gameData.devmode){
          console.log("Game is running in development mode.")
          indexedDB.deleteDatabase(dbName).onsuccess = loadLibraryAndRender;
        }else{
          loadLibraryAndRender();
        }
  
      })      
  }
   
}


PageManager.run();