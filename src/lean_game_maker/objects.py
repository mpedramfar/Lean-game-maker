#!/usr/bin/env python3
from dataclasses import dataclass
import regex

from lean_game_maker.line_reader import LineReader, dismiss_line


############
#  Objects #
############
@dataclass
class Text:
    type: str = 'text'
    content: str = ''

    def append(self, line):
        self.content += line

@dataclass
class LeanLines:
    type: str = 'lean'
    lean: str = ''

    def append(self, line):
        self.lean += line


@dataclass
class Tactic:
    type: str = 'tactic'
    content: str = ''

    def append(self, line):
        self.content += line


    
@dataclass
class Bilingual:
    """
    Base class for objects that contains both text and Lean code.
    """
    text: str = ''
    lean: str = ''

    def text_append(self, line):
        self.text = self.text + line

    def lean_append(self, line):
        self.lean = self.lean + line


@dataclass
class Lemma(Bilingual):
    type: str = 'lemma'


@dataclass
class Theorem(Bilingual):
    type: str = 'theorem'


@dataclass
class Example(Bilingual):
    type: str = 'example'


#################

def default_line_handler(file_reader, line):
    l = LeanLines()
    l.append(line)
    l.hidden = True if regex.compile(r'^[\s\S]*--\s*hide\s*$').match(line) else False
    file_reader.output.append(l)

#################
#  Line readers #
#################

class HiddenBegin(LineReader):
    regex = regex.compile(r'-- begin hide\s*')

    def run(self, m, file_reader):
        if file_reader.status is not '':
            return False
        file_reader.status = 'hidden'
        lean_lines = LeanLines()
        lean_lines.hidden = True
        file_reader.output.append(lean_lines)
        def normal_line(file_reader, line):
            lean_lines.append(line)
        file_reader.normal_line_handler = normal_line
        return True

class HiddenEnd(LineReader):
    regex = regex.compile(r'-- end hide\s*')

    def run(self, m, file_reader):
        if file_reader.status is not 'hidden':
            return False
        file_reader.reset()
        return True



class TextBegin(LineReader):
    regex = regex.compile(r'\s*/-\s*$')

    def run(self, m, file_reader):
        if file_reader.status is not '':
            return False
        file_reader.status = 'text'
        text = Text()
        file_reader.output.append(text)
        def normal_line(file_reader, line):
            text.append(line)
        file_reader.normal_line_handler = normal_line
        file_reader.blank_line_handler = normal_line
        return True


class TextEnd(LineReader):
    regex = regex.compile(r'-/')

    def run(self, m, file_reader):
        if file_reader.status is not 'text':
            return False
        file_reader.reset()
        return True

class TacticBegin(LineReader):
    regex = regex.compile(r'\s*/-\s*Tactic\s*:\s*(.*)$')

    def run(self, m, file_reader):
        if file_reader.status is not '':
            return False
        file_reader.status = 'tactic'
        tactic = Tactic()
        tactic.name = m.group(1).strip()
        file_reader.output.append(tactic)
        def normal_line(file_reader, line):
            tactic.append(line)
        file_reader.normal_line_handler = normal_line
        file_reader.blank_line_handler = normal_line
        return True


class TacticEnd(LineReader):
    regex = regex.compile(r'-/')

    def run(self, m, file_reader):
        if file_reader.status is not 'tactic':
            return False
        file_reader.reset()
        return True


class LemmaBegin(LineReader):
    regex = regex.compile(r'\s*/-\s*Lemma\s*:?(.*)$')

    def run(self, m, file_reader):
        if file_reader.status is not '':
            return False
        file_reader.status = 'lemma_text'
        lemma = Lemma()
        lemma.side_bar = not (m.group(1).strip() == 'no-side-bar')
        file_reader.output.append(lemma)
        def normal_line(file_reader, line):
            lemma.text_append(line)
        file_reader.normal_line_handler = normal_line
        return True


class LemmaEnd(LineReader):
    regex = regex.compile(r'-/')

    def run(self, m, file_reader):
        if file_reader.status is not 'lemma_text':
            return False
        file_reader.status = 'lemma_lean'
        lemma = file_reader.output[-1]
        def normal_line(file_reader, line):
            lemma.lean_append(line)
        file_reader.normal_line_handler = normal_line
        return True


class TheoremBegin(LineReader):
    regex = regex.compile(r'\s*/-\s*Theorem\s*:?(.*)$')

    def run(self, m, file_reader):
        if file_reader.status is not '':
            return False
        file_reader.status = 'theorem_text'
        theorem = Theorem()
        theorem.side_bar = not (m.group(1).strip() == 'no-side-bar')
        file_reader.output.append(theorem)
        def normal_line(file_reader, line):
            theorem.text_append(line)
        file_reader.normal_line_handler = normal_line
        return True


class TheoremEnd(LineReader):
    regex = regex.compile(r'-/')

    def run(self, m, file_reader):
        if file_reader.status is not 'theorem_text':
            return False
        file_reader.status = 'theorem_lean'
        theorem = file_reader.output[-1]
        def normal_line(file_reader, line):
            theorem.lean_append(line)
        file_reader.normal_line_handler = normal_line
        return True


class ExampleBegin(LineReader):
    regex = regex.compile(r'\s*/-\s*Example\s*:?(.*)$')

    def run(self, m, file_reader):
        if file_reader.status is not '':
            return False
        file_reader.status = 'example_text'
        example = Example()
        example.side_bar = not (m.group(1).strip() == 'no-side-bar')
        file_reader.output.append(example)
        def normal_line(file_reader, line):
            example.text_append(line)
        file_reader.normal_line_handler = normal_line
        return True


class ExampleEnd(LineReader):
    regex = regex.compile(r'-/')

    def run(self, m, file_reader):
        if file_reader.status is not 'example_text':
            return False
        file_reader.status = 'example_lean'
        example = file_reader.output[-1]
        def normal_line(file_reader, line):
            example.lean_append(line)
        file_reader.normal_line_handler = normal_line
        return True


class ProofBegin(LineReader):
    regex = regex.compile(r'^begin\s*') # NOTE : this does not require begin to be on a separate line

    def run(self, m, file_reader):
        if file_reader.status not in ['lemma_lean', 'theorem_lean', 'example_lean']:
            return False
        file_reader.status = 'proof'
        file_reader.normal_line_handler = dismiss_line # Proofs shouldn't start with normal line
        return True


class ProofEnd(LineReader):
    regex = regex.compile(r'^end\s*$')  # Beware of match end

    def run(self, m, file_reader):
        if file_reader.status is not 'proof':
            return False
        file_reader.reset()
        return True

