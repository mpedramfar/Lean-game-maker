#!/usr/bin/env python3
from typing import ClassVar, Match
from dataclasses import dataclass
import regex # type: ignore

from lean_game_maker.line_reader import LineReader, dismiss_line, FileReader


############
#  Objects #
############
@dataclass
class Text:
    type: ClassVar[str] = 'text'
    content: str = ''

    def append(self, line: str) -> None:
        self.content += line

@dataclass
class LeanLines(Text):
    type: ClassVar[str] = 'lean'
    hidden: bool = False

@dataclass
class Hint(Text):
    type: ClassVar[str] = 'hint'
    title: str = ''


@dataclass
class Tactic(Text):
    type: ClassVar[str] = 'tactic'
    name: str = ''
    sideBar: bool = True

@dataclass
class Axiom(Text):
    type: ClassVar[str] = 'axiom'
    name: str = ''
    sideBar: bool = True


@dataclass
class Bilingual:
    """
    Base class for objects that contains both text and Lean code.
    """
    type: ClassVar[str] = ''
    text: str = ''
    lean: str = ''
    sideBar: bool = True

    def text_append(self, line):
        self.text += line

    def lean_append(self, line):
        self.lean += line


@dataclass
class Lemma(Bilingual):
    type: ClassVar[str] = 'lemma'


@dataclass
class Theorem(Bilingual):
    type: ClassVar[str] = 'theorem'


@dataclass
class Example(Bilingual):
    type: ClassVar[str] = 'example'


@dataclass
class Definition(Bilingual):
    type: ClassVar[str] = 'definition'

#################
LEVEL_NAME_RE = regex.compile(r'^\s*--\s*Level name\s*:\s*(.*)', flags=regex.IGNORECASE)
WORLD_NAME_RE = regex.compile(r'^\s*--\s*World name\s*:\s*(.*)', flags=regex.IGNORECASE)
HIDDEN_LINE_RE = regex.compile(r'^.*--\s*hide\s*$', flags=regex.IGNORECASE)

def default_line_handler(file_reader: FileReader, line: str) -> None:
    m = LEVEL_NAME_RE.match(line)
    if m:
        file_reader.name = m.group(1).strip()
        return
    m = WORLD_NAME_RE.match(line)
    if m:
        file_reader.world_name = m.group(1).strip()
        return

    if HIDDEN_LINE_RE.match(line):
        file_reader.output.append(LeanLines(line, hidden=True))
    elif file_reader.output and file_reader.output[-1].type == 'lean':
        file_reader.output[-1].append(line)
    else:
        file_reader.output.append(LeanLines(line))

#################
#  Line readers #
#################

class HiddenBegin(LineReader):
    regex = regex.compile(r'-- begin hide\s*', flags=regex.IGNORECASE)

    def run(self, m: Match, file_reader: FileReader) -> bool:
        if file_reader.status:
            return False
        file_reader.status = 'hidden'
        lean_lines = LeanLines(hidden=True)
        file_reader.output.append(lean_lines)
        def normal_line(file_reader: FileReader, line: str) -> None:
            lean_lines.append(line)
        file_reader.normal_line_handler = normal_line
        return True

class HiddenEnd(LineReader):
    regex = regex.compile(r'-- end hide\s*', flags=regex.IGNORECASE)

    def run(self, m: Match, file_reader: FileReader) -> bool:
        if file_reader.status != 'hidden':
            return False
        file_reader.reset()
        return True



class TextBegin(LineReader):
    regex = regex.compile(r'\s*/-\s*$')

    def run(self, m: Match, file_reader: FileReader) -> bool:
        if file_reader.status:
            return False
        file_reader.status = 'text'
        text = Text()
        file_reader.output.append(text)
        def normal_line(file_reader: FileReader, line: str) -> None:
            text.append(line)
        file_reader.normal_line_handler = normal_line
        file_reader.blank_line_handler = normal_line
        return True


class TextEnd(LineReader):
    regex = regex.compile(r'-/')

    def run(self, m: Match, file_reader: FileReader) -> bool:
        if file_reader.status != 'text':
            return False
        file_reader.reset()
        return True

class HintBegin(LineReader):
    regex = regex.compile(r'\s*/-\s*Hint\s*:\s*(.*)$', flags=regex.IGNORECASE)

    def run(self, m: Match, file_reader: FileReader) -> bool:
        if file_reader.status:
            return False
        file_reader.status = 'hint'
        hint = Hint()
        hint.title = m.group(1).strip()
        file_reader.output.append(hint)
        def normal_line(file_reader: FileReader, line: str) -> None:
            hint.append(line)
        file_reader.normal_line_handler = normal_line
        file_reader.blank_line_handler = normal_line
        return True


class HintEnd(LineReader):
    regex = regex.compile(r'-/')

    def run(self, m: Match, file_reader: FileReader) -> bool:
        if file_reader.status != 'hint':
            return False
        file_reader.reset()
        return True


class TacticBegin(LineReader):
    regex = regex.compile(r'\s*/-\s*Tactic\s*:\s*(.*)$', flags=regex.IGNORECASE)

    def run(self, m: Match, file_reader: FileReader) -> bool:
        if file_reader.status:
            return False
        file_reader.status = 'tactic'
        tactic = Tactic()
        tactic.sideBar = True
        tactic.name = m.group(1).strip()
        file_reader.output.append(tactic)
        def normal_line(file_reader: FileReader, line: str) -> None:
            tactic.append(line)
        file_reader.normal_line_handler = normal_line
        file_reader.blank_line_handler = normal_line
        return True


class TacticEnd(LineReader):
    regex = regex.compile(r'-/')

    def run(self, m: Match, file_reader: FileReader) -> bool:
        if file_reader.status != 'tactic':
            return False
        file_reader.reset()
        return True

class AxiomBegin(LineReader):
    regex = regex.compile(r'\s*/-\s*Axiom\s*:\s*(.*)$', flags=regex.IGNORECASE)

    def run(self, m: Match, file_reader: FileReader) -> bool:
        if file_reader.status:
            return False
        file_reader.status = 'axiom'
        axiom = Axiom()
        axiom.sideBar = True
        axiom.name = m.group(1).strip()
        file_reader.output.append(axiom)
        def normal_line(file_reader: FileReader, line: str) -> None:
            axiom.append(line)
        file_reader.normal_line_handler = normal_line
        file_reader.blank_line_handler = normal_line
        return True


class AxiomEnd(LineReader):
    regex = regex.compile(r'-/')

    def run(self, m: Match, file_reader: FileReader) -> bool:
        if file_reader.status != 'axiom':
            return False
        file_reader.reset()
        return True


class LemmaBegin(LineReader):
    regex = regex.compile(r'\s*/-\s*Lemma\s*:?(.*)$', flags=regex.IGNORECASE)

    def run(self, m: Match, file_reader: FileReader) -> bool:
        if file_reader.status:
            return False
        file_reader.status = 'lemma_text'
        lemma = Lemma()
        lemma.sideBar = (m.group(1).strip() != 'no-side-bar')
        file_reader.output.append(lemma)
        def normal_line(file_reader: FileReader, line: str) -> None:
            lemma.text_append(line)
        file_reader.normal_line_handler = normal_line
        return True


class LemmaEnd(LineReader):
    regex = regex.compile(r'-/')

    def run(self, m: Match, file_reader: FileReader) -> bool:
        if file_reader.status != 'lemma_text':
            return False
        file_reader.status = 'lemma_lean'
        lemma = file_reader.output[-1]
        def normal_line(file_reader: FileReader, line: str) -> None:
            lemma.lean_append(line)
        file_reader.normal_line_handler = normal_line
        return True


class TheoremBegin(LineReader):
    regex = regex.compile(r'\s*/-\s*Theorem\s*:?(.*)$', flags=regex.IGNORECASE)

    def run(self, m: Match, file_reader: FileReader) -> bool:
        if file_reader.status:
            return False
        file_reader.status = 'theorem_text'
        theorem = Theorem()
        theorem.sideBar = not (m.group(1).strip() == 'no-side-bar')
        file_reader.output.append(theorem)
        def normal_line(file_reader: FileReader, line: str) -> None:
            theorem.text_append(line)
        file_reader.normal_line_handler = normal_line
        return True


class TheoremEnd(LineReader):
    regex = regex.compile(r'-/')

    def run(self, m: Match, file_reader: FileReader) -> bool:
        if file_reader.status != 'theorem_text':
            return False
        file_reader.status = 'theorem_lean'
        theorem = file_reader.output[-1]
        def normal_line(file_reader: FileReader, line: str) -> None:
            theorem.lean_append(line)
        file_reader.normal_line_handler = normal_line
        return True


class DefinitionBegin(LineReader):
    regex = regex.compile(r'\s*/-\s*Definition\s*:?(.*)$', flags=regex.IGNORECASE)

    def run(self, m: Match, file_reader: FileReader) -> bool:
        if file_reader.status:
            return False
        file_reader.status = 'definition_text'
        defn = Definition()
        defn.sideBar = False
        file_reader.output.append(defn)
        def normal_line(file_reader: FileReader, line: str) -> None:
            defn.text_append(line)
        file_reader.normal_line_handler = normal_line
        return True


class DefinitionEnd(LineReader):
    regex = regex.compile(r'-/')

    def run(self, m: Match, file_reader: FileReader) -> bool:
        if file_reader.status != 'definition_text':
            return False
        file_reader.status = 'definition_lean'
        theorem = file_reader.output[-1]
        def normal_line(file_reader: FileReader, line: str) -> None:
            theorem.lean_append(line)
        file_reader.normal_line_handler = normal_line
        return True



class ExampleBegin(LineReader):
    regex = regex.compile(r'\s*/-\s*Example\s*:?(.*)$', flags=regex.IGNORECASE)

    def run(self, m: Match, file_reader: FileReader) -> bool:
        if file_reader.status:
            return False
        file_reader.status = 'example_text'
        example = Example()
        example.sideBar = not (m.group(1).strip() == 'no-side-bar')
        file_reader.output.append(example)
        def normal_line(file_reader: FileReader, line: str) -> None:
            example.text_append(line)
        file_reader.normal_line_handler = normal_line
        return True


class ExampleEnd(LineReader):
    regex = regex.compile(r'-/')

    def run(self, m: Match, file_reader: FileReader) -> bool:
        if file_reader.status != 'example_text':
            return False
        file_reader.status = 'example_lean'
        example = file_reader.output[-1]
        def normal_line(file_reader: FileReader, line: str) -> None:
            example.lean_append(line)
        file_reader.normal_line_handler = normal_line
        return True


class ProofBegin(LineReader):
    regex = regex.compile(r'^begin\s*') # NOTE : this does not require begin to be on a separate line

    def run(self, m: Match, file_reader: FileReader) -> bool:
        if file_reader.status not in ['lemma_lean', 'theorem_lean', 'example_lean', 'definition_lean']:
            return False
        file_reader.status = 'proof'
        file_reader.normal_line_handler = dismiss_line # Proofs shouldn't start with normal line
        return True


class ProofEnd(LineReader):
    regex = regex.compile(r'^end\s*$')  # Beware of match end

    def run(self, m: Match, file_reader: FileReader) -> bool:
        if file_reader.status != 'proof':
            return False
        file_reader.reset()
        return True

