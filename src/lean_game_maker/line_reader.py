from typing import Match, Callable, Optional, List, Type
from pathlib import Path
import regex
import copy

from lean_game_maker.translator import Translator

blank_line_regex = regex.compile(r'^\s*$')

def dismiss_line(file_reader, line):
    pass


class FileReader:
    def __init__(self, translator: Translator, default_line_handler: Callable[['FileReader', str], None],
            readers: Optional[List[Type['LineReader']]] = None):
        self.readers = [reader() for reader in readers] if readers else []
        self.translator = translator
        self.filename = ''
        self.default_line_handler = default_line_handler
        self.hard_reset()

    def hard_reset(self) -> None:
        self.name = ''
        self.problemIndex = -1 # The object self.objects[self.problemIndex] is the problem in this level.
        self.cur_line_nb = 1
        self.objects: List = []
        self.reset()

    def reset(self) -> None:
        self.status = ''
        self.normal_line_handler = self.default_line_handler
        self.blank_line_handler = dismiss_line

    def read_file(self, path: str, occ: str=None) -> None:
        if not Path(path).exists():
            raise FileNotFoundError(f'The file "{path}" does not exist.')

        self.hard_reset()
        temp_occ = self.translator.occ
        if occ:
            self.translator.occ = occ
        self.filename = path
        with open(str(path), 'r', encoding='utf8') as f:
            self.raw_text = f.read()
            f.seek(0)
            for line in f:
                for reader in self.readers:
                    if reader.read(self, line):
                        if reader.__class__.__name__ == 'ProofBegin':
                            self.objects[-1].firstProofLineNumber = self.cur_line_nb + 1
                        elif reader.__class__.__name__ == 'ProofEnd':
                            self.objects[-1].lastProofLineNumber = self.cur_line_nb - 1
                        break
                else:
                    if blank_line_regex.match(line):
                        self.blank_line_handler(self, line)
                    else:
                        self.normal_line_handler(self, line)

                self.cur_line_nb += 1
            
        if self.objects == []:
            raise Exception(f'The file "{path}" is empty.')

        self.post_process()
        self.translator.occ = temp_occ
 
        return copy.deepcopy({
                'name': self.name, 
                'problemIndex': self.problemIndex, 
                'objects' : self.objects
            })


    def post_process(self) -> None:
        lines = self.raw_text.split("\n")
        for i, o in enumerate(self.objects):
            if o.type not in ['lemma', 'theorem', 'definition', 'example']:
                o.translate(self.translator)
                continue
            if self.problemIndex == -1 and o.type in ['lemma', 'theorem', 'definition']:
                self.problemIndex = i
            o.textBefore = "\n".join(lines[ : o.firstProofLineNumber-1]) + "\n"
            o.proof      = "\n".join(lines[o.firstProofLineNumber-1 : o.lastProofLineNumber])
            o.textAfter  = "\n" + "\n".join(lines[o.lastProofLineNumber : ])
            o.height     = o.lastProofLineNumber - o.firstProofLineNumber + 1
            o.editorText = 'sorry' if (self.problemIndex == i) else self.translator.register(o.proof, True, True)
            o.lineOffset = o.firstProofLineNumber-1

            m = regex.compile(r"^[^:\(\{\s]*([\s\S]*):=\s*$", regex.MULTILINE).match(o.lean)
            try:
                temp = m.group(1).strip()
                if o.type == "example":
                    o.statement = temp[1:].strip() if temp[0] == ':' else temp
                else:
                    m = regex.compile(r"^([^:\(\{\s]*)([\s\S]*)$", regex.MULTILINE).match(temp)
                    o.name = m.group(1)
                    temp = m.group(2).strip()
                    o.statement = temp[1:].strip() if temp[0] == ':' else temp
            except:
                raise Exception(f'Failed to parse :\n{o.lean}')
            
            o.translate(self.translator)




class LineReader:
    regex = regex.compile(r'.*')

    def read(self, file_reader: FileReader, line: str) -> bool:
        m = self.regex.match(line)
        if m:
            return self.run(m, file_reader)
        else:
            return False

    def run(self, m: Match, file_reader: FileReader) -> bool:
        """Defined in subclasses only"""
        raise NotImplemented
