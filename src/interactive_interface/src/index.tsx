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

const MathJax = require("MathJax");

const showdown = require("showdown");
let markdownConverter = new showdown.Converter({
  openLinksInNewWindow: true,
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
interface StatementObject { // theorem, lemma, definition or example
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

interface NonStatementObject { // comment, tactic, axiom or lean
  type: boolean;
  content: string;
  name?: string;
  sideBar?: boolean;
  hidden?: boolean;
}

interface LevelData {
  name: string;
  objects: Array<StatementObject|NonStatementObject>;
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
  text: ""
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
    return <div dangerouslySetInnerHTML={{__html: markdownConverter.makeHtml(this.props.content)}}></div>;
  }
}




interface StatementProps extends StatementObject {
  fileName: string;
  isActive: boolean;
  onDidCursorMove: (Position) => void;
}
class Statement extends React.Component<StatementProps, {}> {

  constructor(props: StatementProps) {
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
        return <Statement key={i}
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
            'tactics' : NonStatementObject[], 
            'sortedStatements' : (StatementObject|NonStatementObject)[][], // first dimension is the world number
            'examples' : StatementObject[] 
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


interface GameProps {
  fileName: string;
  worlds: Array<WorldData>;
  introData: LevelData;
  name: string;
}
interface GameState {
  world: number;
  level: number;
  cursor?: Position;
  latestProblemId?: string;
  introPage: boolean;
}
class Game extends React.Component<GameProps, GameState> {

  constructor(props: GameProps) {
    super(props);
    this.state = {
      world: 0,
      level: 0,
      introPage: true
    };
  }

  goto(world: number, level: number){
    let levelData = this.props.worlds[this.state.world].levels[this.state.level]
    let statementData = levelData.objects[levelData.activeIndex];

    if(statementData){
      (statementData as any).editorText = activeEditorData.text;
    }
    
    this.setState({ world: world, level: level, introPage: false });
    this.props.worlds[world].lastVisitedLevel = level;

  }

  gotoWorld(w: number){
    let l = this.props.worlds[w].lastVisitedLevel;
    l = l ? l : 0;
    this.goto(w, l);
  }

  gotoLevel(l: number){
    this.goto(this.state.world, l);
  }

  render() {

    if(this.state.introPage){
      let graphData = {
        'nodes' : this.props.worlds.map((w, i) => ({"id" : i})), 
        'links' : [].concat(... this.props.worlds.map((w, i) =>{
          if(!w.parents) return [];
          return w.parents.map((p)=>({'source' : p, 'target' : i}));
        }))
      };

      const TheGraph = (props) => {
        let NODE_R = 10;
        const [highlightNodes, setHighlightNodes] = React.useState([]);
        const handleNodeHover = React.useCallback(node => {
          setHighlightNodes(node ? [node] : []);
        }, [setHighlightNodes]);
        const paintRing = React.useCallback((node, ctx) => {
          // add ring just for highlighted nodes
          ctx.beginPath();
          ctx.arc(node.x, node.y, NODE_R * 1.4, 0, 2 * Math.PI, false);
          ctx.fillStyle = 'red';
          ctx.fill();
        }, []);
        return <ForceGraph2D
          width={props.width}
          height={props.height}
          graphData={graphData}
          nodeRelSize={NODE_R}
          linkWidth={5}
          linkDirectionalParticles={5}
          linkDirectionalArrowLength={4}
          linkDirectionalParticleWidth={4}
          nodeCanvasObjectMode={node => highlightNodes.indexOf(node) !== -1 ? 'before' : undefined}
          nodeCanvasObject={paintRing}
          onNodeHover={handleNodeHover}
          onNodeClick={(node) => {this.gotoWorld(node.id)}}
          nodeLabel={(node) => {
            return markdownConverter.makeHtml(this.props.worlds[node.id].name);
          }}
          dagMode="td"
          dagLevelDistance={30}
        />;
      };

      const content = <Level fileName={this.props.fileName} key={"intto"} levelData={this.props.introData} 
      onDidCursorMove={(c) => {}}/>;

      return (
        <div>
          <Container style={{ height: '100%' }}>
          <Section size={window.innerWidth*0.6}>
            {content}
          </Section>
          <Section size={window.innerWidth*0.4}>
            <TheGraph width={window.innerWidth*0.5} height={window.innerHeight}/>
          </Section>
        </Container>
        </div>
      );
    }

    const worldData = this.props.worlds[this.state.world];
    const key = "" + this.state.world + "," + this.state.level;

    let worldLabel = worldData.name;
    let worldButtonsPanel = (
      <div key={this.state.world} style={{ width: '100%', height: '2em', top: '0em', position: 'fixed' }}>
        <button disabled={ this.state.world == 0 } 
          style={{ 
            float: 'left', borderStyle: 'ridge', width: '20%', height:'100%'
          }} onClick={() => { this.gotoWorld.call(this, this.state.world - 1); }}> Previous World </button>
        <button disabled={ this.state.world == this.props.worlds.length - 1 } 
          style={{
            float: 'right', borderStyle: 'ridge', width: '20%', height: '100%'
          }} onClick={() => { this.gotoWorld.call(this, this.state.world + 1); }}> Next World </button>
        <div style={{ textAlign: 'center' }}><h3><Text content={worldLabel}/></h3></div>
      </div>
    );

    worldButtonsPanel = (
      <div>
        <div key={this.state.world} style={{ width: '100%', height: '2em', top: '0em', position: 'fixed' }}>
          <button
            style={{ 
              float: 'left', borderStyle: 'ridge', width: '20%', height:'100%'
            }} onClick={() => { this.setState({introPage : true}) }}> Main Menu </button>
        </div>
        <div style={{ textAlign: 'center' }}><h3><Text content={worldLabel}/></h3></div>
      </div>
    );


    let levelLabel = "Level " + (this.state.level + 1);
    if(worldData.levels[this.state.level].name){
      levelLabel += " -- " + worldData.levels[this.state.level].name
    }
    const levelButtonsPanel = <div key={key} style={{ width: '100%', height: '2em', top: '2em', position: 'fixed' }}>
      <button disabled={ this.state.level == 0 } 
        style={{
          float: 'left', borderStyle: 'ridge', width: '20%', height:'100%'
        }} onClick={() => { this.gotoLevel.call(this, this.state.level - 1); }}> Previous Level </button>
      <button disabled={ this.state.level == worldData.levels.length - 1 } 
        style={{ 
          float: 'right', borderStyle: 'ridge', width: '20%', height: '100%' 
        }} onClick={() => { this.gotoLevel.call(this, this.state.level + 1); }}> Next Level </button>
      <div style={{ textAlign: 'center' }}><h4><Text content={levelLabel}/></h4></div>
    </div>;


    const sideBarDiv = <SideBar worlds={this.props.worlds} world={this.state.world} level={this.state.level} ></SideBar>;

    const content = <Level fileName={this.props.fileName} key={key} levelData={worldData.levels[this.state.level]} 
        onDidCursorMove={(c) => {this.setState({cursor: c, latestProblemId: key})}}/>;


    let statementIsSolved = () => {
      if(this.state.latestProblemId != key) // another level is solved, not this one!
        return;
      // console.log(key + " is SOLVED!");
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

window.indexedDB.deleteDatabase("leanlibrary").onsuccess = function(event) {

  window.addEventListener("beforeunload", function (e) {
    let confirmationMessage = 'Do you want to leave the game?'
                            + '\nYour progress will be lost.';
    (e || window.event).returnValue = confirmationMessage;
    return confirmationMessage;
  });
  
  // tslint:disable-next-line:no-var-requires
  (window as any).require(['vs/editor/editor.main'], () => {

    registerLeanLanguage(leanJsOpts, activeEditorData);

    const gameData = require('game_data') as GameData;
    document.title = gameData.name;

    const fn = monaco.Uri.file('test.lean').fsPath;

    render(
        <Game fileName={fn} worlds={gameData.worlds} name={gameData.name} introData={gameData.introData}/>,
        document.getElementById('root'),
    );
  
  });
  
};
