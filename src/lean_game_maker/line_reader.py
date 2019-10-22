import regex


blank_line_regex = regex.compile(r'^\s*$')

def dismiss_line(file_reader, line):
    pass


class FileReader:
    def __init__(self, default_line_handler, readers = None):
        self.readers = [reader() for reader in readers]
        self.filename = ''
        self.default_line_handler = default_line_handler
        self.hard_reset()

    def reset(self):
        self.status = ''
        self.normal_line_handler = self.default_line_handler
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

                    m = regex.compile(r"^[^:\(\{\s]*(.*):=\s*$").match(o.lean)
                    temp = m.group(1).strip()
                    if o.type == "example":
                        o.statement = temp[1:].strip() if temp[0] == ':' else temp
                    else:
                        m = regex.compile(r"^([^:\(\{\s]*)(.*)$").match(temp)
                        o.name = m.group(1)
                        temp = m.group(2).strip()
                        o.statement = temp[1:].strip() if temp[0] == ':' else temp


class LineReader:
    regex = regex.compile(r'.*')

    def read(self, file_reader, line):
        m = self.regex.match(line)
        if m:
            return self.run(m, file_reader)
        else:
            return False
