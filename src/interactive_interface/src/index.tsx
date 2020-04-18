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

import ForceGraph2D from 'react-force-graph-2d';
import * as d3 from "d3";
import { throws } from 'assert';

const seedrandom = require("seedrandom");

const MathJax = require("MathJax");

const showdown = require("showdown");
let markdownConverter = new showdown.Converter({
  openLinksInNewWindow: true,
  literalMidWordUnderscores: true,
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
    let cr = currentlyRunning.value.indexOf(nextProps.file) !== -1;
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
}
interface InfoViewState {
  goal?: GoalWidgetProps;
  messages: Message[];
  solved?: boolean;
}
class InfoView extends React.Component<InfoViewProps, InfoViewState> {
  private subscriptions: monaco.IDisposable[] = [];
  private sceduleCheckIfSolved: boolean = false;

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
    if(this.sceduleCheckIfSolved){
      if( this.state.messages.filter((v) => (v.severity =='error' || v.severity == 'warning')).length == 0 ){
        this.props.isSolved();
        this.setState({ solved : true });
      } else {
        this.setState({ solved : false });
      }
      this.sceduleCheckIfSolved = false;
    }
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
      this.checkIfSolved();
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
      <div className='no-mathjax' style={{ 
          height: "100%", width: "100%", boxSizing: "border-box",
          padding: "1em", border: "double" }}>
        <LeanStatus file={this.props.file} isReady={() => {this.sceduleCheckIfSolved = true;}}/>
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
  activeIndex?: number;
}

interface WorldData {
  name: string;
  levels: Array<LevelData>;
  parents?: Array<number>;
  lastVisitedLevel?: number;
}

interface GameData {
  name: string;
  worlds: Array<WorldData>;
  introData: LevelData;
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
  onDidCursorMove: (Position) => void;
}
interface LeanEditorState {
//
}


let activeEditorData: editorTextDataInterface = { 
  lineOffset: 0,
  fileContent: "",
  text: "",
  world: -1,
  level: 0,
  saved: true,
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

    this.model = monaco.editor.getModel(monaco.Uri.file(this.props.fileName));
    if(! this.model){
      this.model = monaco.editor.createModel("", 'lean', monaco.Uri.file(this.props.fileName));
      this.model.updateOptions({ tabSize: 2 });
    }

    this.model.onDidChangeContent((e) => {
      activeEditorData.text = this.model.getValue();
      activeEditorData.fileContent = this.props.textBefore + this.model.getValue() + this.props.textAfter;
      activeEditorData.saved = false;
      checkInputCompletionChange(e, this.editor, this.model);
    });

    if(this.props.editorText != this.model.getValue())
      this.model.setValue(this.props.editorText);
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
    let t = markdownConverter.makeHtml(this.props.content);
    console.log(t);
    return <div dangerouslySetInnerHTML={{__html: t}}></div>;
  }
}




interface ProvableProps extends ProvableObject {
  fileName: string;
  isActive: boolean;
  onDidCursorMove: (Position) => void;
}
class Provable extends React.Component<ProvableProps, {}> {

  constructor(props: ProvableProps) {
    super(props);
  }

  render() {

    let proof;
    if( this.props.isActive ){
      proof = <LeanEditor {...this.props} readonly={this.props.type=="example"} />;
    } else {
      proof = <LeanColorize text={this.props.editorText}/>;
    }

    const title = (this.props.type == "lemma") ? "Lemma" :
        ((this.props.type == "theorem") ? "Theorem" :
        ((this.props.type == "definition") ? "Definition" : "Example"));

    return <div className="lemma_wrapper">
        <span className="lemma_label" >{title}</span>
        <div className="lemma_content">
	        <div className="lemma_text">
	          { this.props.text }
    	    </div>
      	  <div className="lemma_lean">
	          <LeanColorize text={this.props.lean} />
    	    </div>
        </div>
        {(this.props.type == "definition") ? null :
        <div style={{ marginTop:"0.5em" }}>
          <span style={{ fontStyle:"italic" }}>Proof :</span>
        </div>
        }
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
  levelData: LevelData;
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
      if(this.props.levelData.objects[i].type == "lemma" || 
          this.props.levelData.objects[i].type == "theorem" ||
          this.props.levelData.objects[i].type == "definition")
        break;
    }

    this.props.levelData.activeIndex = (i < this.props.levelData.objects.length) ? i : -1;
  }


  componentDidMount(){
    if(MathJax)
      MathJax.Hub.Queue(["Typeset",MathJax.Hub]);
  }

  render() {
    const content = this.props.levelData.objects.map( (itemData, i) => {
      if( itemData.type == "text" )
      {
        return <Text  key={i} content={(itemData as any).content}  />;
      } 
      else if( itemData.type == "lean" && (! (itemData as any).hidden))
      {
        return <LeanColorize key={i} text={(itemData as any).content}/>
      }
      else if( itemData.type == "lemma" || itemData.type == "theorem" || itemData.type == "definition" || itemData.type == "example")
      {
        return <Provable key={i}
                      fileName={this.props.fileName}
                      isActive={this.props.levelData.activeIndex == i} 
                      onDidCursorMove={this.props.onDidCursorMove}
                      {...itemData}
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
      return sideBarAccordion(s.name, [<Text key={"tactic,text,"+i} content={s.content} />]);
    }));

    const examplesAccordion = sideBarAccordion("Examples", data.examples.map((s, i) => {
      return (
        <div>
          <LeanColorize key={"example,statement,"+i} text={s.lean} />
          <LeanColorize key={"example,proof,"+i} text={"begin\n" + s.proof + "\nend"} />
          <hr/>
        </div>);
    }));

    const statementsAccordion = sideBarAccordion("Theorem statements", data.sortedStatements.map((statements, w) => {
      if(!statements) return [];
      let label = this.props.worlds[w].name;
      return sideBarAccordion(label, statements.map((s, i) =>{
        let e = "  " + ((s.type == "axiom") ? (s as any).content : (s as any).statement);
        return (
          <div>
            <LeanColorize key={s.type+",name,"+i} text={s.name} />
            <LeanColorize key={s.type+",statement,"+i} text={e} />
            <hr/>
          </div>
        );
      }));
    }));


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
    const label = node.worldData.name;
    const scaledFontSize = fontSize/globalScale;
    ctx.font = `${scaledFontSize}px Sans-Serif`;
    const textWidth = ctx.measureText(label).width;
    const bckgDimensions = [textWidth, scaledFontSize].map(n => n + scaledFontSize * 0.2); // some padding
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillRect(node.x - bckgDimensions[0] / 2, node.y - bckgDimensions[1] - node_R * 1.5, ...bckgDimensions);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'black';
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
      linkDirectionalParticles={0}
      linkDirectionalArrowLength={10}
      nodeCanvasObject={(node, ctx, globalScale) => {this.paintNode.call(this, node, ctx, globalScale, node_R, fontSize)}}
      onNodeHover={this.handleNodeHover.bind(this)}
      onNodeClick={(node) => {this.props.gotoWorld(node.id)}}
      nodeLabel={(node) => {
        return markdownConverter.makeHtml(this.props.worlds[node.id].name);
      }}
      enableNodeDrag={false}
      enableZoomPanInteraction={false}
      dagMode="td"
      dagLevelDistance={dagLevelDistance}
    />;
  };
  
}




interface GameProps {
  fileName: string;
  worlds: Array<WorldData>;
  introData: LevelData;
  name: string;
  world: number;
  level: number;
}
interface GameState {
  world: number;
  level: number;
  cursor?: Position;
  latestProblemId?: string;
  solvedLevels: Array<string>;
  solvedWorlds: Array<number>;
}
class Game extends React.Component<GameProps, GameState> {
  graphData : any;

  constructor(props: GameProps) {
    super(props);
    this.state = {
      world: this.props.world,
      level: this.props.level,
      solvedLevels: [],
      solvedWorlds: []
    };

    if(!this.graphData)
      this.graphData = getGraphData(this.props.worlds);
  }

  goto(world: number, level: number){
    if(this.state.world != -1){
      let levelData = this.props.worlds[this.state.world].levels[this.state.level]
      let statementData = levelData.objects[levelData.activeIndex];
  
      if(statementData){
        (statementData as any).editorText = activeEditorData.text;
        saveGame();
        activeEditorData.saved = true;
      }  
    }
    
    this.setState({ world: world, level: level });
    this.props.worlds[world].lastVisitedLevel = level;

    activeEditorData.world = world;
    activeEditorData.level = level;
    updateURL();
  }

  gotoWorld(w: number){
    let l = this.props.worlds[w].lastVisitedLevel;
    l = l ? l : 0;
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
    if(this.state.world == -1){

      const content = <Level fileName={this.props.fileName} key={"intro"} levelData={this.props.introData} 
          onDidCursorMove={(c) => {}}/>;

      const graphDiv = <Graph graphData={this.graphData} worlds={this.props.worlds} world={this.state.world} 
                            solvedWorlds={this.state.solvedWorlds} gotoWorld={this.gotoWorld.bind(this)} 
                            width={window.innerWidth*0.4} height={window.innerHeight}/>;

      return (
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
        </div>
      );
    }

    const worldData = this.props.worlds[this.state.world];
    const key = "" + this.state.world + "," + this.state.level;

    const worldLabel = (
      <div style={{ textAlign: 'center' }}>
        <h3>
          <Text content={
            (this.state.solvedWorlds.indexOf(this.state.world) != -1 ? "&#10004; " : "") +
            worldData.name}/>
        </h3>
      </div>
    );
    const worldButtonsPanel = (
      <div>
        <div key={this.state.world} style={{ width: '100%', height: '2em', top: '0em', position: 'fixed' }}>
          <button style={{ 
              float: 'left', borderStyle: 'ridge', width: '20%', height:'100%'
            }} onClick={() => { 
              this.setState({world : -1});
              activeEditorData.world = -1;
              updateURL();
            }}> Main Menu </button>
          <button style={{ 
              float: 'right', borderStyle: 'ridge', width: '20%', height:'100%'
            }} onClick={() => {
              resetGame();
            }}> Reset </button>
        </div>
        {worldLabel}
      </div>
    );


    const levelLabel = (
      <div style={{ textAlign: 'center' }}>
        <h4>
          <Text content={
            (this.state.solvedLevels.indexOf(key) != -1 ? "&#10004; " : "") +
            "Level " + (this.state.level + 1) + 
            (worldData.levels[this.state.level].name ? " -- " + worldData.levels[this.state.level].name : "")
          }/>
        </h4>
      </div>
    );
    const levelButtonsPanel = (
      <div key={key} style={{ width: '100%', height: '2em', top: '2em', position: 'fixed' }}>
        <button disabled={ this.state.level == 0 } 
          style={{
            float: 'left', borderStyle: 'ridge', width: '20%', height:'100%'
          }} onClick={() => { this.gotoLevel.call(this, this.state.level - 1); }}> Previous Level </button>
        <button disabled={ this.state.level == worldData.levels.length - 1 } 
          style={{ 
            float: 'right', borderStyle: 'ridge', width: '20%', height: '100%' 
          }} onClick={() => { this.gotoLevel.call(this, this.state.level + 1); }}> Next Level </button>
        {levelLabel}
      </div>
    );


    const sideBarDiv = <SideBar worlds={this.props.worlds} world={this.state.world} level={this.state.level} ></SideBar>;

    const content = <Level fileName={this.props.fileName} key={key} levelData={worldData.levels[this.state.level]} 
        onDidCursorMove={(c) => {this.setState({cursor: c, latestProblemId: key})}}/>;


    let statementIsSolved = () => {
      if(this.state.latestProblemId != key) // another level is solved, not this one!
        return;
      if(this.state.solvedLevels.indexOf(key) != -1) // already solved
        return;
      let solvedLevels = this.state.solvedLevels.concat([key]);
      let worldIsSolved = this.props.worlds[this.state.world].levels.every((levelData, l)=>{
        return solvedLevels.indexOf("" + this.state.world + "," + l) > -1;
      });
      let solveWorlds = worldIsSolved ? this.state.solvedWorlds.concat([this.state.world]) : this.state.solvedWorlds;
      this.setState({solvedLevels : solvedLevels, solvedWorlds : solveWorlds});
    };
        
    const infoViewDiv = <InfoView file={this.props.fileName} cursor={this.state.cursor} isSolved={statementIsSolved}/>;

    const mainDiv = (
      <Container style={{ height: '100%' }}>
        <Section defaultSize={window.innerWidth*0.15}>
          {sideBarDiv}
        </Section>
        <Bar size={10} className="Resizer vertical" />
        <Section minSize={200} defaultSize={window.innerWidth*0.5}>
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
          {mainDiv}
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


const localStorageVarName = 'game_data';
let gameData;


function updateURL(){
  let u = new URL(window.location.href);
  if(activeEditorData.world == -1){
    u.search = "";
  }else{
    u.searchParams.set('world', String(activeEditorData.world + 1));
    u.searchParams.set('level', String(activeEditorData.level + 1));
  }
  history.replaceState(null, null, u.href);
}

function readURL(){
  activeEditorData.world = -1;
  activeEditorData.level = 0;

  let u = new URL(window.location.href);
  if(u.searchParams.has('world') && u.searchParams.has('level')){
    let w = Number(u.searchParams.get('world'));
    let l = Number(u.searchParams.get('level'));
    if(!isNaN(w) && !isNaN(l)){
      if(w >= 1 && w <= gameData.worlds.length && l >= 1 && l <= gameData.worlds[w-1].levels.length){
        activeEditorData.world = w - 1;
        activeEditorData.level = l - 1;
      }
    }
  }
  updateURL();
}


function saveGame(){
  localStorage.setItem(localStorageVarName, JSON.stringify(gameData));
}

function loadGame(){
  let temp = JSON.parse(localStorage.getItem(localStorageVarName));
  if(temp && temp['name']==gameData['name'] && temp['version']==gameData['version']){
    gameData=temp;
    return true;
  }else{
    return false;
  }
}

function resetGame(){
  let confirmationMessage = 'The game will reset and the progress will be lost.';
  if(window.confirm(confirmationMessage)){
    localStorage.removeItem(localStorageVarName);
    activeEditorData.world = -1;
    updateURL();
    location.reload();
  }
}



window.indexedDB.deleteDatabase("leanlibrary").onsuccess = function(event) {

  window.addEventListener("beforeunload", function (e) {
    if(activeEditorData.world != -1){
      let levelData = gameData.worlds[activeEditorData.world].levels[activeEditorData.level]
      let statementData = levelData.objects[levelData.activeIndex];
  
      if(statementData){
        (statementData as any).editorText = activeEditorData.text;
        saveGame();
        activeEditorData.saved = true;
      }
    }
  });  
  
  // tslint:disable-next-line:no-var-requires
  (window as any).require(['vs/editor/editor.main'], () => {

    seedrandom('0', { global: true }); // makes the behaviour of the graph predictable

    registerLeanLanguage(leanJsOpts, activeEditorData);

    const blankGameData = require('game_data') as GameData;
    document.title = blankGameData.name;
    gameData = blankGameData;
    loadGame();

    readURL();
    
    const fn = monaco.Uri.file('test.lean').fsPath;

    render(
        <Game fileName={fn} worlds={gameData.worlds} name={gameData.name} 
                introData={gameData.introData} world={activeEditorData.world} level={activeEditorData.level}/>,
        document.getElementById('root'),
    );
  
  });
  
};
