from typing import List, Dict, Optional, Tuple, TextIO
from pathlib import Path
from io import StringIO

from dataclasses import dataclass

import regex


blank_line_regex = regex.compile(r'^\s*$')

def dismiss_line(file_reader, line):
    pass


@dataclass
class LeanLines:
    name: str = 'lean'
    lean: str = ''

    def append(self, line):
        self.lean += line


class FileReader:
    def __init__(self, readers: List = None):
        self.readers = [reader() for reader in readers]
        self.status = ''
        self.output = []
        self.filename = ''
        self.cur_line_nb = 1
        self.normal_line_handler = dismiss_line
        self.blank_line_handler = dismiss_line

    def reset(self):
        self.status = ''
        self.normal_line_handler = dismiss_line
        self.blank_line_handler = dismiss_line
        
    def hard_reset(self):
        self.reset()
        self.cur_line_nb = 1
        self.output = []

    def read_file(self, path):
        self.filename = path
        with open(str(path), 'r') as f:
            self.raw_text = f.read()
            f.seek(0)
            for line in f:
                if len(self.output) > 0 and self.status != '':
                    self.output[-1].lastLineNumber = self.cur_line_nb
                for reader in self.readers:
                    if reader.read(self, line):
                        if len(self.output) > 0 and ('firstLineNumber' not in dir(self.output[-1])):
                            self.output[-1].firstLineNumber = self.cur_line_nb
                            self.output[-1].lastLineNumber = self.cur_line_nb
                        if reader.__class__.__name__ == 'ProofBegin':
                            self.output[-1].firstProofLineNumber = self.cur_line_nb + 1
                        elif reader.__class__.__name__ == 'ProofEnd':
                            self.output[-1].lastProofLineNumber = self.cur_line_nb - 1                        
                        break
                else:
                    if blank_line_regex.match(line):
                        self.blank_line_handler(self, line)
                    elif self.status == '':                     # There is a line outside of lemma and everything, and it contains something.
                        l = LeanLines()                         # We will consider it as simply "lean code"
                        l.append(line)
                        l.firstLineNumber = self.cur_line_nb
                        l.lastLineNumber = self.cur_line_nb
                        l.hidden = True if regex.compile(r'^[\s\S]*--\s*hide\s*$').match(line) else False
                        self.output.append(l)
                    else:
                        self.normal_line_handler(self, line)
                
                self.cur_line_nb += 1

class LineReader:
    regex = regex.compile(r'.*')

    def read(self, file_reader, line):
        m = self.regex.match(line)
        if m:
            return self.run(m, file_reader)
        else:
            return False
