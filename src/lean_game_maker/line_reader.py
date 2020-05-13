from typing import Match, Callable, Optional, List, Type
import regex # type: ignore


blank_line_regex = regex.compile(r'^\s*$')

def dismiss_line(file_reader, line):
    pass


class FileReader:
    def __init__(self, default_line_handler: Callable[['FileReader', str], None],
            readers: Optional[List[Type['LineReader']]] = None):
        self.readers = [reader() for reader in readers] if readers else []
        self.filename = ''
        self.status = ''
        self.default_line_handler = default_line_handler
        self.normal_line_handler = self.default_line_handler
        self.hard_reset()
        self.output: List = []
        self.cur_line_nb = 1
        self.name = ""
        self.world_name = ""

    def reset(self) -> None:
        self.status = ''
        self.normal_line_handler = self.default_line_handler
        self.blank_line_handler = dismiss_line

    def hard_reset(self) -> None:
        self.name = ""
        self.world_name = ""
        self.reset()
        self.cur_line_nb = 1
        self.output = []

    def read_file(self, path: str) -> None:
        self.filename = path
        with open(str(path), 'r') as f:
            self.raw_text = f.read()
            f.seek(0)
            for line in f:
                for reader in self.readers:
                    if reader.read(self, line):
                        if reader.__class__.__name__ == 'ProofBegin':
                            self.output[-1].firstProofLineNumber = self.cur_line_nb + 1
                        elif reader.__class__.__name__ == 'ProofEnd':
                            self.output[-1].lastProofLineNumber = self.cur_line_nb - 1
                        break
                else:
                    if blank_line_regex.match(line):
                        self.blank_line_handler(self, line)
                    else:
                        self.normal_line_handler(self, line)

                self.cur_line_nb += 1

            lines = self.raw_text.split("\n")
            for o in self.output:
                if hasattr(o, "firstProofLineNumber"):
                    o.textBefore = "\n".join(lines[ : o.firstProofLineNumber-1]) + "\n"
                    o.proof      = "\n".join(lines[o.firstProofLineNumber-1 : o.lastProofLineNumber])
                    o.textAfter  = "\n" + "\n".join(lines[o.lastProofLineNumber : ])
                    o.height     = o.lastProofLineNumber - o.firstProofLineNumber + 1
                    o.editorText = o.proof if (o.type == "example") else "  sorry"
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
                        raise Exception("Failed to parse :\n" + o.lean)


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
